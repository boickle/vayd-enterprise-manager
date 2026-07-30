import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ClipboardList,
  Lock,
  Stethoscope,
  Activity,
  ListChecks,
  CheckCircle2,
  PawPrint,
} from 'lucide-react';
import './SoapEncounterPage.css';
import {
  completeEncounter,
  createEncounter,
  getHouseholdRoster,
  getInvoiceByAppointment,
  listEncounters,
  listOrders,
  listProblems,
  updateEncounter,
  type EncounterOrder,
  type HouseholdRosterEntry,
  type PatientProblem,
  type SoapEncounter,
  type SoapEncounterMode,
  type VisitInvoice,
  VISIT_WORKFLOW_PRACTICE_ID,
} from '../api/visitWorkflow';
import { summarizeIntakeHistory } from '../api/soapScribe';
import type { ForwardBookingDisposition } from '../api/forwardBookingDisposition';
import { fetchPatientProfileForRow } from '../api/patients';
import {
  defaultPeExamState,
  peExamFromValue,
  type PeExamState,
} from '../components/soap/peTemplate';
import PhysicalExamSection from '../components/soap/PhysicalExamSection';
import MasterProblemListSection from '../components/soap/MasterProblemListSection';
import PlanOrdersSection from '../components/soap/PlanOrdersSection';
import ForwardBookingGate from '../components/soap/ForwardBookingGate';
import VisitCheckoutPanel from '../components/soap/VisitCheckoutPanel';
import HouseholdInvoiceSummary from '../components/soap/HouseholdInvoiceSummary';
import EuthanasiaPrepayModal from '../components/soap/EuthanasiaPrepayModal';
import ScribePanel from '../components/soap/ScribePanel';
import ScribeDocumentView from '../components/soap/ScribeDocumentView';
import ScribeSuggestedPlanItems, {
  type SuggestedPlanItem,
} from '../components/soap/ScribeSuggestedPlanItems';
import type { PeSystemFinding } from '../components/soap/peTemplate';
import {
  appointmentReasonFromSentToClient,
  buildSubjectiveTextFromRoomLoaderResponse,
  findSubmittedRoomLoaderForAppointment,
  looksLikeRawRoomLoaderSubjective,
  withRoomLoaderSubjectivePrefix,
} from '../utils/roomLoaderSubjectiveText';

export type Vitals = {
  tempF: string;
  weight: string;
  hr: string;
  rr: string;
  bcs: string;
  painScore: string;
};

type SoapTabId = 'subjective' | 'objective' | 'assessment' | 'plan' | 'followup';

const SOAP_TABS: {
  id: SoapTabId;
  label: string;
  short: string;
  icon: typeof ClipboardList;
}[] = [
  { id: 'subjective', label: 'Subjective', short: 'S', icon: ClipboardList },
  { id: 'objective', label: 'Objective', short: 'O', icon: Activity },
  { id: 'assessment', label: 'Assessment', short: 'A', icon: ListChecks },
  { id: 'plan', label: 'Plan', short: 'P', icon: ClipboardList },
  { id: 'followup', label: 'Follow-up', short: 'FB', icon: CheckCircle2 },
];

export function vitalsFromValue(v: unknown): Vitals {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s = (k: string) => (o[k] == null ? '' : String(o[k]));
  return {
    tempF: s('tempF'),
    weight: s('weight'),
    hr: s('hr'),
    rr: s('rr'),
    bcs: s('bcs'),
    painScore: s('painScore'),
  };
}

function emailDraftFromSubjective(subjective: Record<string, unknown> | null | undefined): {
  subject: string;
  body: string;
} {
  if (!subjective || typeof subjective !== 'object') return { subject: '', body: '' };
  const subject =
    typeof subjective.clientEmailSubject === 'string' ? subjective.clientEmailSubject : '';
  const body = typeof subjective.clientEmailBody === 'string' ? subjective.clientEmailBody : '';
  return { subject, body };
}

function buildSubjectivePayload(
  history: string,
  email: { subject: string; body: string }
): Record<string, unknown> {
  return {
    history,
    clientEmailSubject: email.subject.trim() ? email.subject : null,
    clientEmailBody: email.body.trim() ? email.body : null,
  };
}

export default function SoapEncounterPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const appointmentId = Number(params.appointmentId);
  const patientId = Number(params.patientId);
  const clientIdParam = searchParams.get('clientId');

  const [encounter, setEncounter] = useState<SoapEncounter | null>(null);
  const [problems, setProblems] = useState<PatientProblem[]>([]);
  const [orders, setOrders] = useState<EncounterOrder[]>([]);
  const [invoice, setInvoice] = useState<VisitInvoice | null>(null);
  const [patientName, setPatientName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEuthanasia, setShowEuthanasia] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [subjective, setSubjective] = useState('');
  const [vitals, setVitals] = useState<Vitals>(vitalsFromValue(null));
  const [exam, setExam] = useState<PeExamState>(defaultPeExamState());
  const [objectiveNotes, setObjectiveNotes] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [linkedProblemIds, setLinkedProblemIds] = useState<string[]>([]);
  const [visitCompleted, setVisitCompleted] = useState(false);
  const [activeTab, setActiveTab] = useState<SoapTabId>('subjective');
  const [entryMode, setEntryMode] = useState<'manual' | 'scribe'>('manual');
  const [emailDraft, setEmailDraft] = useState<{
    subject: string;
    body: string;
  }>({ subject: '', body: '' });
  const emailDraftRef = useRef(emailDraft);
  emailDraftRef.current = emailDraft;
  const [scribePlanItems, setScribePlanItems] = useState<SuggestedPlanItem[]>([]);
  const [roster, setRoster] = useState<HouseholdRosterEntry[]>([]);
  const [householdRefreshTick, setHouseholdRefreshTick] = useState(0);

  const locked = encounter?.status === 'completed';
  const mode: SoapEncounterMode = encounter?.mode ?? 'comprehensive';
  const scribeEnabled = String(import.meta.env.VITE_ENABLE_SCRIBE ?? '').toLowerCase() === 'true';

  const refreshInvoice = useCallback(async () => {
    try {
      const inv = await getInvoiceByAppointment(appointmentId);
      setInvoice(inv);
    } catch {
      /* invoice may not exist yet */
    }
    setHouseholdRefreshTick((t) => t + 1);
  }, [appointmentId]);

  // Other pets from the same household visit (docs/ai-scribe.md "Multi-pet visits") — drives the
  // pet-switcher tabs below the header and the combined checkout summary in the aside. Keyed off
  // `encounter?.id` (stable across in-place saves) rather than the whole `encounter` object, and
  // independent of ScribePanel's own roster fetch so tabs show up even before AI Scribe is used.
  useEffect(() => {
    if (!encounter) {
      setRoster([]);
      return;
    }
    let canceled = false;
    getHouseholdRoster(encounter.id)
      .then((entries) => {
        if (!canceled) setRoster(entries);
      })
      .catch(() => {
        if (!canceled) setRoster([]);
      });
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter?.id]);

  const switchToPet = useCallback(
    (entry: HouseholdRosterEntry) => {
      if (entry.isCurrent) return;
      const qs = clientIdParam ? `?clientId=${encodeURIComponent(clientIdParam)}` : '';
      navigate(`/schedule/soap/${entry.appointmentId}/${entry.patientId}${qs}`);
    },
    [navigate, clientIdParam]
  );

  useEffect(() => {
    let canceled = false;
    (async () => {
      setLoading(true);
      setError(null);
      // Switching pet tabs navigates within the same page instance (no remount), so transient
      // scribe UI state from the previous pet needs an explicit reset here — everything else
      // (subjective/vitals/orders/invoice/etc.) is already fully re-derived from the freshly
      // loaded encounter below.
      setEmailDraft({ subject: '', body: '' });
      setScribePlanItems([]);
      setVisitCompleted(false);
      setShowEuthanasia(false);
      try {
        const existing = await listEncounters({ appointmentId, patientId });
        let enc = existing[0] ?? null;
        if (!enc) {
          enc = await createEncounter({
            appointmentId,
            patientId,
            clientId: clientIdParam ? Number(clientIdParam) : undefined,
          });
        }
        if (canceled) return;

        let subjectiveHistory =
          typeof enc.subjective?.history === 'string' ? enc.subjective.history : '';

        // Prefill / polish Room Loader intake into a short Subjective narrative (auto, no button).
        try {
          let intakeSource = '';
          if (!subjectiveHistory.trim()) {
            const roomLoader = await findSubmittedRoomLoaderForAppointment(appointmentId);
            const response = roomLoader?.responseFromClient;
            if (response) {
              intakeSource = buildSubjectiveTextFromRoomLoaderResponse(response, patientId, {
                appointmentReason: appointmentReasonFromSentToClient(
                  roomLoader.sentToClient,
                  patientId
                ),
              });
            }
          } else if (looksLikeRawRoomLoaderSubjective(subjectiveHistory)) {
            intakeSource = subjectiveHistory;
          }

          if (intakeSource.trim()) {
            let historyToSave = intakeSource.trim();
            if (scribeEnabled) {
              try {
                const summary = await summarizeIntakeHistory(enc.id, intakeSource);
                if (summary.trim()) historyToSave = summary.trim();
              } catch {
                /* keep raw Room Loader text if summarize fails */
              }
            }
            historyToSave = withRoomLoaderSubjectivePrefix(historyToSave);
              if (historyToSave !== subjectiveHistory.trim()) {
              subjectiveHistory = historyToSave;
              const emailFields = emailDraftFromSubjective(enc.subjective);
              enc = await updateEncounter(enc.id, {
                subjective: buildSubjectivePayload(historyToSave, emailFields),
              });
            }
          }
        } catch {
          /* Room Loader preload is best-effort */
        }

        setEncounter(enc);
        setSubjective(subjectiveHistory);
        setEmailDraft(emailDraftFromSubjective(enc.subjective));
        setVitals(vitalsFromValue(enc.objectiveVitals));
        setExam(peExamFromValue(enc.objectiveExam));
        setObjectiveNotes(enc.objectiveNotes ?? '');
        setReasoning(enc.assessmentReasoning ?? '');
        setPlanNotes(enc.planNotes ?? '');
        setLinkedProblemIds(enc.assessmentProblemIds ?? []);

        const [probs] = await Promise.all([
          listProblems(patientId).catch(() => [] as PatientProblem[]),
          (async () => {
            try {
              const profile = await fetchPatientProfileForRow({ id: String(patientId) });
              if (!canceled) {
                const name = (profile as { name?: string } | null)?.name ?? `Patient #${patientId}`;
                setPatientName(name);
              }
            } catch {
              if (!canceled) setPatientName(`Patient #${patientId}`);
            }
          })(),
        ]);
        if (canceled) return;
        setProblems(probs);

        const [ords] = await Promise.all([
          listOrders(enc.id).catch(() => [] as EncounterOrder[]),
          refreshInvoice(),
        ]);
        if (canceled) return;
        setOrders(ords);
      } catch (e) {
        if (!canceled) {
          setError(e instanceof Error ? e.message : 'Failed to load the encounter');
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, patientId]);

  const save = useCallback(
    async (patch: Parameters<typeof updateEncounter>[1]) => {
      if (!encounter || locked) return;
      try {
        const updated = await updateEncounter(encounter.id, patch);
        setEncounter(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save');
      }
    },
    [encounter, locked]
  );

  const effectiveEntryMode = scribeEnabled ? entryMode : 'manual';

  const saveSubjective = useCallback(
    async (history: string, email: { subject: string; body: string } = emailDraftRef.current) => {
      await save({ subjective: buildSubjectivePayload(history, email) });
    },
    [save]
  );

  const applyScribeSubjective = useCallback(
    (text: string) => {
      setSubjective(text);
      void saveSubjective(text);
    },
    [saveSubjective]
  );

  const onNarrativeUpdate = useCallback(
    (n: { emailSubject: string | null; emailBody: string | null }) => {
      const next = {
        subject: n.emailSubject ?? '',
        body: n.emailBody ?? '',
      };
      setEmailDraft(next);
      emailDraftRef.current = next;
      void save({
        subjective: buildSubjectivePayload(subjective, next),
      });
    },
    [save, subjective]
  );

  const applyScribeVitals = useCallback(
    (patch: Partial<Vitals>) => {
      setVitals((prev) => {
        const next = { ...prev, ...patch };
        void save({ objectiveVitals: { ...next } });
        return next;
      });
    },
    [save]
  );

  const applyScribeExam = useCallback(
    (patch: Record<string, PeSystemFinding>) => {
      setExam((prev) => {
        const next = { ...prev, ...patch };
        void save({ objectiveExam: next });
        return next;
      });
    },
    [save]
  );

  const applyScribeReasoning = useCallback(
    (text: string) => {
      setReasoning(text);
      void save({ assessmentReasoning: text });
    },
    [save]
  );

  const applyScribeObjectiveNotes = useCallback(
    (text: string) => {
      setObjectiveNotes(text);
      void save({ objectiveNotes: text });
    },
    [save]
  );

  const applyScribePlanNotes = useCallback(
    (text: string) => {
      setPlanNotes(text);
      void save({ planNotes: text });
    },
    [save]
  );

  const dispositionValue = useMemo<ForwardBookingDisposition | null>(() => {
    const d = encounter?.forwardBookingDisposition;
    if (d && typeof d === 'object' && typeof (d as { mode?: unknown }).mode === 'string') {
      return d as unknown as ForwardBookingDisposition;
    }
    return null;
  }, [encounter?.forwardBookingDisposition]);

  const gateSatisfied = Boolean(dispositionValue?.mode);

  const onCompleteEncounter = async () => {
    if (!encounter) return;
    setCompleting(true);
    setError(null);
    try {
      const updated = await completeEncounter(encounter.id);
      setEncounter(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete the encounter');
    } finally {
      setCompleting(false);
    }
  };

  const toggleProblemLink = (problemId: string, linked: boolean) => {
    setLinkedProblemIds((prev) => {
      const next = linked
        ? Array.from(new Set([...prev, problemId]))
        : prev.filter((id) => id !== problemId);
      void save({ assessmentProblemIds: next });
      return next;
    });
  };

  const onScribeProblemCreated = (problem: PatientProblem) => {
    setProblems((prev) => [...prev, problem]);
    toggleProblemLink(problem.id, true);
  };

  const onScribeOrderCreated = (order: EncounterOrder) => {
    setOrders((prev) => [...prev, order]);
  };

  if (loading) {
    return <div className="soap-page soap-loading">Loading encounter…</div>;
  }
  if (error && !encounter) {
    return <div className="soap-page soap-error-page">{error}</div>;
  }

  return (
    <div className="soap-page">
      <header className="soap-header">
        <div className="soap-header-main">
          <Stethoscope size={20} />
          <div>
            <h1>{patientName || `Patient #${patientId}`}</h1>
            <span className="soap-header-sub">
              Visit #{appointmentId} · {mode === 'quick' ? 'Quick' : 'Comprehensive'} SOAP
            </span>
          </div>
        </div>
        <div className="soap-header-actions">
          {!locked && scribeEnabled && (
            <div className="soap-mode-switch">
              <button
                type="button"
                className={effectiveEntryMode === 'manual' ? 'active' : ''}
                onClick={() => setEntryMode('manual')}
              >
                Manual
              </button>
              <button
                type="button"
                className={effectiveEntryMode === 'scribe' ? 'active' : ''}
                onClick={() => setEntryMode('scribe')}
              >
                AI Scribe
              </button>
            </div>
          )}
          {locked ? (
            <span className="soap-locked-badge">
              <Lock size={14} /> Completed
            </span>
          ) : (
            <button
              type="button"
              className="soap-btn primary"
              disabled={!gateSatisfied || completing}
              title={
                gateSatisfied
                  ? 'Lock the medical record'
                  : 'Select a forward-booking disposition first'
              }
              onClick={onCompleteEncounter}
            >
              <CheckCircle2 size={15} /> {completing ? 'Completing…' : 'Mark Completed'}
            </button>
          )}
        </div>
      </header>

      {error && <div className="soap-error soap-error-banner">{error}</div>}

      {roster.length > 1 && (
        <div className="soap-pet-tabs" role="tablist" aria-label="Pets at this visit">
          {roster.map((r) => (
            <button
              key={r.patientId}
              type="button"
              role="tab"
              aria-selected={r.isCurrent}
              className={`soap-pet-tab${r.isCurrent ? ' active' : ''}`}
              onClick={() => switchToPet(r)}
            >
              <PawPrint size={13} /> {r.patientName}
            </button>
          ))}
        </div>
      )}

      {effectiveEntryMode === 'scribe' && encounter && (
        <ScribePanel
          // Switching pet tabs navigates within this same page instance rather than remounting it
          // (docs/ai-scribe.md "Multi-pet visits") — keying on the encounter forces a fresh
          // ScribePanel per pet so a leftover transcript/suggestion review from the previous pet
          // never bleeds into the next one's chart.
          key={encounter.id}
          soapEncounterId={encounter.id}
          patientId={patientId}
          disabled={locked}
          examEnabled={mode === 'comprehensive'}
          currentSubjective={subjective}
          currentVitals={vitals}
          currentExam={exam}
          currentObjectiveNotes={objectiveNotes}
          currentReasoning={reasoning}
          currentPlanNotes={planNotes}
          problems={problems}
          orders={orders}
          onApplySubjective={applyScribeSubjective}
          onApplyVitals={applyScribeVitals}
          onApplyExam={applyScribeExam}
          onApplyObjectiveNotes={applyScribeObjectiveNotes}
          onApplyReasoning={applyScribeReasoning}
          onApplyPlanNotes={applyScribePlanNotes}
          onProblemCreated={onScribeProblemCreated}
          onOrderCreated={onScribeOrderCreated}
          onNarrativeUpdate={onNarrativeUpdate}
          onPlanItemsChange={setScribePlanItems}
          onHouseholdOrdersChanged={() => setHouseholdRefreshTick((t) => t + 1)}
        />
      )}

      <div className="soap-body">
        <main className="soap-main">
          {effectiveEntryMode === 'scribe' ? (
            <ScribeDocumentView
              patientName={patientName || `Patient #${patientId}`}
              visitDate={
                encounter?.created
                  ? new Date(encounter.created).toLocaleDateString()
                  : new Date().toLocaleDateString()
              }
              disabled={locked}
              subjective={subjective}
              onSubjectiveChange={setSubjective}
              onSubjectiveBlur={() => void saveSubjective(subjective)}
              objectiveNotes={objectiveNotes}
              onObjectiveNotesChange={setObjectiveNotes}
              onObjectiveNotesBlur={() => save({ objectiveNotes })}
              assessment={reasoning}
              onAssessmentChange={setReasoning}
              onAssessmentBlur={() => save({ assessmentReasoning: reasoning })}
              planNotes={planNotes}
              onPlanNotesChange={setPlanNotes}
              onPlanNotesBlur={() => save({ planNotes })}
              planItemsSlot={
                encounter && (
                  <>
                    <ScribeSuggestedPlanItems
                      key={`plan-items-${encounter.id}`}
                      encounterId={encounter.id}
                      suggestions={scribePlanItems}
                      planNotes={planNotes}
                      orders={orders}
                      disabled={locked}
                      patientId={patientId}
                      clientId={clientIdParam ? Number(clientIdParam) : undefined}
                      practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                      onOrderAdded={onScribeOrderCreated}
                      onInvoiceShouldRefresh={() => void refreshInvoice()}
                    />
                    <PlanOrdersSection
                      key={`plan-orders-${encounter.id}`}
                      encounterId={encounter.id}
                      orders={orders}
                      disabled={locked}
                      patientId={patientId}
                      clientId={clientIdParam ? Number(clientIdParam) : undefined}
                      practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                      onChange={setOrders}
                      onInvoiceShouldRefresh={() => void refreshInvoice()}
                    />
                  </>
                )
              }
              emailSubject={emailDraft.subject}
              emailBody={emailDraft.body}
              onEmailSubjectChange={(text) => {
                const next = { ...emailDraftRef.current, subject: text };
                emailDraftRef.current = next;
                setEmailDraft(next);
              }}
              onEmailBodyChange={(text) => {
                const next = { ...emailDraftRef.current, body: text };
                emailDraftRef.current = next;
                setEmailDraft(next);
              }}
              onEmailBlur={() => void saveSubjective(subjective)}
            />
          ) : (
            <>
              <div className="soap-tabs" role="tablist" aria-label="SOAP sections">
                {SOAP_TABS.map(({ id, label, short, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    className={`soap-tab${activeTab === id ? ' active' : ''}${
                      id === 'followup' && !gateSatisfied && !locked ? ' needs-attention' : ''
                    }`}
                    onClick={() => setActiveTab(id)}
                  >
                    <Icon size={15} aria-hidden />
                    <span className="soap-tab-label">{label}</span>
                    <span className="soap-tab-short">{short}</span>
                  </button>
                ))}
              </div>

              <div className="soap-tab-panel">
                {activeTab === 'subjective' && (
                  <section className="soap-section">
                    <h2>
                      <ClipboardList size={16} /> Subjective
                    </h2>
                    <p className="soap-section-hint">
                      Pre-visit check-in is summarized automatically. Confirm or edit — don't
                      re-key what the client already provided.
                    </p>
                    <textarea
                      className="soap-textarea soap-textarea--subjective"
                      rows={14}
                      placeholder="Presenting history, owner concerns…"
                      value={subjective}
                      disabled={locked}
                      onChange={(e) => setSubjective(e.target.value)}
                      onBlur={() => void saveSubjective(subjective)}
                    />
                  </section>
                )}

                {activeTab === 'objective' && (
                  <section className="soap-section">
                    <h2>
                      <Activity size={16} /> Objective
                    </h2>
                    <div className="soap-subhead">Vitals (TPR, weight, BCS /9, FAS /5)</div>
                    <div className="soap-vitals">
                      {(
                        [
                          ['tempF', 'Temp °F'],
                          ['hr', 'HR (bpm)'],
                          ['rr', 'RR (rpm)'],
                          ['weight', 'Weight (lb)'],
                          ['bcs', 'BCS /9'],
                          ['painScore', 'FAS /5'],
                        ] as [keyof Vitals, string][]
                      ).map(([key, label]) => (
                        <label key={key} className="soap-vital">
                          <span>{label}</span>
                          <input
                            className="soap-input"
                            inputMode="decimal"
                            value={vitals[key]}
                            disabled={locked}
                            onChange={(e) => setVitals((v) => ({ ...v, [key]: e.target.value }))}
                            onBlur={() => save({ objectiveVitals: { ...vitals } })}
                          />
                        </label>
                      ))}
                    </div>
                    <p className="soap-section-hint">
                      BCS: 1 skeletal → 9 obese. FAS (fear/anxiety): 1 relaxed → 5 extremely
                      reactive. Exam aids (treats, Calm &amp; Cozy, muzzle, etc.) go in Objective
                      notes.
                    </p>

                    {mode === 'comprehensive' && (
                      <>
                        <div className="soap-subhead">
                          Physical exam — normal by default, tap a system to flag abnormal
                        </div>
                        <PhysicalExamSection
                          value={exam}
                          disabled={locked}
                          onChange={(next) => {
                            setExam(next);
                            void save({ objectiveExam: next });
                          }}
                        />
                      </>
                    )}

                    <div className="soap-subhead">Notes (also shown in Document view)</div>
                    <textarea
                      className="soap-textarea"
                      rows={4}
                      placeholder="Additional objective observations…"
                      value={objectiveNotes}
                      disabled={locked}
                      onChange={(e) => setObjectiveNotes(e.target.value)}
                      onBlur={() => save({ objectiveNotes })}
                    />
                  </section>
                )}

                {activeTab === 'assessment' && (
                  <section className="soap-section">
                    <h2>
                      <ListChecks size={16} /> Assessment
                    </h2>
                    <div className="soap-subhead">Master Problem List</div>
                    {encounter && (
                      <MasterProblemListSection
                        patientId={patientId}
                        encounterId={encounter.id}
                        problems={problems}
                        linkedProblemIds={linkedProblemIds}
                        disabled={locked}
                        onChange={setProblems}
                        onToggleLink={toggleProblemLink}
                      />
                    )}
                    <div className="soap-subhead">Clinical reasoning / problem list</div>
                    <textarea
                      className="soap-textarea"
                      rows={5}
                      placeholder={`Problem List:\n- Apparently healthy\n- Neck dermatitis - r/o contact dermatitis, food allergy`}
                      value={reasoning}
                      disabled={locked}
                      onChange={(e) => setReasoning(e.target.value)}
                      onBlur={() => save({ assessmentReasoning: reasoning })}
                    />
                  </section>
                )}

                {activeTab === 'plan' && (
                  <section className="soap-section">
                    <h2>
                      <ClipboardList size={16} /> Plan
                    </h2>
                    <p className="soap-section-hint">
                      Every order is both a record entry and an invoice line. Meds also generate a
                      label and discharge instruction.
                    </p>
                    {encounter && (
                      <PlanOrdersSection
                        key={`plan-orders-manual-${encounter.id}`}
                        encounterId={encounter.id}
                        orders={orders}
                        disabled={locked}
                        patientId={patientId}
                        clientId={clientIdParam ? Number(clientIdParam) : undefined}
                        practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                        onChange={setOrders}
                        onInvoiceShouldRefresh={() => void refreshInvoice()}
                      />
                    )}

                    <div className="soap-subhead">Notes (also shown in Document view)</div>
                    <textarea
                      className="soap-textarea"
                      rows={4}
                      placeholder="Diagnostics, treatment plan, client communication…"
                      value={planNotes}
                      disabled={locked}
                      onChange={(e) => setPlanNotes(e.target.value)}
                      onBlur={() => save({ planNotes })}
                    />

                    <div className="soap-subhead">Email to client</div>
                    <p className="soap-section-hint">
                      Draft follow-up email (filled by AI Scribe when you process a visit). Edit
                      freely — it saves with this encounter.
                    </p>
                    <label className="soap-email-label">
                      Subject
                      <input
                        className="soap-input"
                        type="text"
                        placeholder="Follow-up from today's visit…"
                        value={emailDraft.subject}
                        disabled={locked}
                        onChange={(e) => {
                          const next = { ...emailDraftRef.current, subject: e.target.value };
                          emailDraftRef.current = next;
                          setEmailDraft(next);
                        }}
                        onBlur={() => void saveSubjective(subjective)}
                      />
                    </label>
                    <textarea
                      className="soap-textarea soap-textarea--email"
                      rows={12}
                      placeholder={`Hello,\n\nI wanted to provide a summary of our conversation today…`}
                      value={emailDraft.body}
                      disabled={locked}
                      onChange={(e) => {
                        const next = { ...emailDraftRef.current, body: e.target.value };
                        emailDraftRef.current = next;
                        setEmailDraft(next);
                      }}
                      onBlur={() => void saveSubjective(subjective)}
                    />
                  </section>
                )}

                {activeTab === 'followup' && (
                  <section className="soap-section soap-gate">
                    <h2>
                      <CheckCircle2 size={16} /> Forward booking (required to complete)
                    </h2>
                    {encounter && (
                      <ForwardBookingGate
                        appointmentId={appointmentId}
                        patientId={patientId}
                        clientId={encounter.clientId}
                        disabled={locked}
                        value={dispositionValue}
                        onSave={async (disposition, entryId) => {
                          await save({
                            forwardBookingDisposition: disposition as unknown as Record<
                              string,
                              unknown
                            >,
                            forwardBookingEntryId: entryId ?? undefined,
                          });
                        }}
                      />
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </main>

        <aside className="soap-aside">
          <HouseholdInvoiceSummary
            roster={roster}
            currentInvoice={invoice}
            refreshSignal={householdRefreshTick}
            onSwitchPet={switchToPet}
          />
          <VisitCheckoutPanel
            appointmentId={appointmentId}
            invoice={invoice}
            visitCompleted={visitCompleted}
            onInvoiceChange={setInvoice}
            onVisitCompleted={() => setVisitCompleted(true)}
            onOpenEuthanasiaPrepay={() => setShowEuthanasia(true)}
          />
        </aside>
      </div>

      {showEuthanasia && encounter && (
        <EuthanasiaPrepayModal
          appointmentId={appointmentId}
          clientId={encounter.clientId}
          onClose={() => setShowEuthanasia(false)}
          onSaved={() => void refreshInvoice()}
        />
      )}
    </div>
  );
}
