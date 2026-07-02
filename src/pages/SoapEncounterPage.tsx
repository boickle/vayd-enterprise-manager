import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList,
  Lock,
  Stethoscope,
  Activity,
  ListChecks,
  CheckCircle2,
} from 'lucide-react';
import './SoapEncounterPage.css';
import {
  completeEncounter,
  createEncounter,
  getInvoiceByAppointment,
  listEncounters,
  listOrders,
  listProblems,
  updateEncounter,
  type EncounterOrder,
  type PatientProblem,
  type SoapEncounter,
  type SoapEncounterMode,
  type VisitInvoice,
  VISIT_WORKFLOW_PRACTICE_ID,
} from '../api/visitWorkflow';
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
import EuthanasiaPrepayModal from '../components/soap/EuthanasiaPrepayModal';
import {
  appointmentReasonFromSentToClient,
  buildSubjectiveTextFromRoomLoaderResponse,
  findSubmittedRoomLoaderForAppointment,
} from '../utils/roomLoaderSubjectiveText';

type Vitals = {
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

function vitalsFromValue(v: unknown): Vitals {
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

export default function SoapEncounterPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
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
  const [reasoning, setReasoning] = useState('');
  const [linkedProblemIds, setLinkedProblemIds] = useState<string[]>([]);
  const [visitCompleted, setVisitCompleted] = useState(false);
  const [activeTab, setActiveTab] = useState<SoapTabId>('subjective');

  const locked = encounter?.status === 'completed';
  const mode: SoapEncounterMode = encounter?.mode ?? 'comprehensive';

  const refreshInvoice = useCallback(async () => {
    try {
      const inv = await getInvoiceByAppointment(appointmentId);
      setInvoice(inv);
    } catch {
      /* invoice may not exist yet */
    }
  }, [appointmentId]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      setLoading(true);
      setError(null);
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
        if (!subjectiveHistory.trim()) {
          try {
            const roomLoader = await findSubmittedRoomLoaderForAppointment(appointmentId);
            const response = roomLoader?.responseFromClient;
            if (response) {
              const prefilled = buildSubjectiveTextFromRoomLoaderResponse(
                response,
                patientId,
                {
                  appointmentReason: appointmentReasonFromSentToClient(
                    roomLoader.sentToClient,
                    patientId
                  ),
                }
              );
              if (prefilled.trim()) {
                subjectiveHistory = prefilled;
                enc = await updateEncounter(enc.id, {
                  subjective: { history: prefilled },
                });
              }
            }
          } catch {
            /* Room Loader preload is best-effort */
          }
        }

        setEncounter(enc);
        setSubjective(subjectiveHistory);
        setVitals(vitalsFromValue(enc.objectiveVitals));
        setExam(peExamFromValue(enc.objectiveExam));
        setReasoning(enc.assessmentReasoning ?? '');
        setLinkedProblemIds(enc.assessmentProblemIds ?? []);

        const [probs] = await Promise.all([
          listProblems(patientId).catch(() => [] as PatientProblem[]),
          (async () => {
            try {
              const profile = await fetchPatientProfileForRow({ id: String(patientId) });
              if (!canceled) {
                const name =
                  (profile as { name?: string } | null)?.name ?? `Patient #${patientId}`;
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
      setError(
        e instanceof Error ? e.message : 'Could not complete the encounter'
      );
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
          {!locked && (
            <div className="soap-mode-switch">
              <button
                type="button"
                className={mode === 'comprehensive' ? 'active' : ''}
                onClick={() => save({ mode: 'comprehensive' })}
              >
                Comprehensive
              </button>
              <button
                type="button"
                className={mode === 'quick' ? 'active' : ''}
                onClick={() => save({ mode: 'quick' })}
              >
                Quick
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

      <div className="soap-body">
        <main className="soap-main">
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
                  History from intake / Room Loader. Confirm or edit — don't re-key what
                  the client already provided.
                </p>
                <textarea
                  className="soap-textarea"
                  rows={4}
                  placeholder="Presenting history, owner concerns…"
                  value={subjective}
                  disabled={locked}
                  onChange={(e) => setSubjective(e.target.value)}
                  onBlur={() => save({ subjective: { history: subjective } })}
                />
              </section>
            )}

            {activeTab === 'objective' && (
              <section className="soap-section">
                <h2>
                  <Activity size={16} /> Objective
                </h2>
                <div className="soap-subhead">Vitals (TPR, weight, BCS)</div>
                <div className="soap-vitals">
                  {(
                    [
                      ['tempF', 'Temp °F'],
                      ['hr', 'HR (bpm)'],
                      ['rr', 'RR (rpm)'],
                      ['weight', 'Weight (lb)'],
                      ['bcs', 'BCS /9'],
                      ['painScore', 'Pain /5'],
                    ] as [keyof Vitals, string][]
                  ).map(([key, label]) => (
                    <label key={key} className="soap-vital">
                      <span>{label}</span>
                      <input
                        className="soap-input"
                        inputMode="decimal"
                        value={vitals[key]}
                        disabled={locked}
                        onChange={(e) =>
                          setVitals((v) => ({ ...v, [key]: e.target.value }))
                        }
                        onBlur={() => save({ objectiveVitals: { ...vitals } })}
                      />
                    </label>
                  ))}
                </div>

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
                <div className="soap-subhead">Clinical reasoning</div>
                <textarea
                  className="soap-textarea"
                  rows={3}
                  placeholder="Assessment and clinical reasoning…"
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
                  Every order is both a record entry and an invoice line. Meds also
                  generate a label and discharge instruction.
                </p>
                {encounter && (
                  <PlanOrdersSection
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
                        forwardBookingDisposition:
                          disposition as unknown as Record<string, unknown>,
                        forwardBookingEntryId: entryId ?? undefined,
                      });
                    }}
                  />
                )}
              </section>
            )}
          </div>
        </main>

        <aside className="soap-aside">
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
