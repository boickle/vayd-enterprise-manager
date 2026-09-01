import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowRight,
  ClipboardList,
  FilePlus2,
  Lock,
  Stethoscope,
  Activity,
  ListChecks,
  PawPrint,
  SlidersHorizontal,
} from 'lucide-react';
import './SoapEncounterPage.css';
import {
  createEncounter,
  getHouseholdRoster,
  getInvoiceByAppointment,
  listOrders,
  listPatientPrescriptions,
  listProblems,
  updateEncounter,
  type EncounterOrder,
  type HouseholdRosterEntry,
  type PatientPrescription,
  type PatientProblem,
  type SoapEncounter,
  type SoapEncounterMode,
  type VisitInvoice,
  VISIT_WORKFLOW_PRACTICE_ID,
} from '../api/visitWorkflow';
import { polishSpokenNotes, summarizeIntakeHistory } from '../api/soapScribe';
import { fetchAppointmentById } from '../api/appointments';
import { fetchEmployee } from '../api/appointmentSettings';
import { fetchPatientProfileForRow } from '../api/patients';
import { useAuth } from '../auth/useAuth';
import { pushRecentRecord } from '../utils/recentRecordsStore';
import {
  defaultPeExamState,
  peExamFromValue,
  type PeExamState,
} from '../components/soap/peTemplate';
import PhysicalExamSection from '../components/soap/PhysicalExamSection';
import MasterProblemListSection from '../components/soap/MasterProblemListSection';
import PlanOrdersSection from '../components/soap/PlanOrdersSection';
import VisitDoseAndRxSection from '../components/soap/VisitDoseAndRxSection';
import SoapAddendaSection from '../components/soap/SoapAddendaSection';
import ProposedOrdersPanel from '../components/soap/ProposedOrdersPanel';
import VisitCheckoutPanel from '../components/soap/VisitCheckoutPanel';
import HouseholdInvoiceSummary from '../components/soap/HouseholdInvoiceSummary';
import EuthanasiaPrepayModal from '../components/soap/EuthanasiaPrepayModal';
import ScribePanel from '../components/soap/ScribePanel';
import SoapPatientChronicSummary from '../components/soap/SoapPatientChronicSummary';
import type { ForwardBookingDisposition } from '../api/forwardBookingDisposition';
import CheckoutFollowUpPrompt from '../components/soap/CheckoutFollowUpPrompt';
import ScribeDocumentView from '../components/soap/ScribeDocumentView';
import ScribePromptOverridesModal from '../components/soap/ScribePromptOverridesModal';
import ScribeSuggestedPlanItems, {
  type SoapNarrativeSection,
  type SuggestedPlanItem,
} from '../components/soap/ScribeSuggestedPlanItems';
import type { PeSystemFinding } from '../components/soap/peTemplate';
import {
  appointmentReasonFromSentToClient,
  buildSubjectiveTextFromRoomLoaderResponse,
  findSubmittedRoomLoaderForAppointment,
  hasPreVisitAnswersBlock,
  looksLikeRawRoomLoaderSubjective,
  looksLikeSpokenChatter,
  mergeClinicianPrevisitNotes,
  PRE_EXAM_CHECKIN_NOT_FILLED,
  prependCheckinBlock,
  splitSubjectiveHistoryParts,
  stripCheckinPlaceholder,
  withRoomLoaderSubjectivePrefix,
} from '../utils/roomLoaderSubjectiveText';
import { markBriefsInjected, pendingPrevisitBriefs } from '../utils/briefStore';
import { takeDeferredPlanItems } from '../utils/deferredScribePlanItems';
import {
  appendTreatmentPlanMedicationBullet,
  removeTreatmentPlanMedicationBullet,
} from '../utils/planNotesSections';
import { patientSexDisplayFromRecord } from '../utils/schedulerVisitDisplay';

export type WeightUnit = 'lb' | 'kg';

export type Vitals = {
  tempF: string;
  weight: string;
  /** Unit for `weight`. Ignored when `weightNotTaken`. Defaults to lb. */
  weightUnit: WeightUnit;
  /** Explicit: weight was not taken this visit (required alternative to a value). */
  weightNotTaken: boolean;
  hr: string;
  rr: string;
  bcs: string;
  painScore: string;
};

/** True when the visit either recorded a weight + unit or chose "No weight taken". */
export function isWeightAddressed(v: Vitals): boolean {
  if (v.weightNotTaken) return true;
  return Boolean(v.weight.trim());
}

/** Display string for header / chart review, or null if nothing recorded. */
export function formatVitalWeight(v: Vitals): string | null {
  if (v.weightNotTaken) return 'No weight taken';
  const w = v.weight.trim();
  if (!w) return null;
  return `${w} ${v.weightUnit}`;
}

function patientField(patient: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!patient) return null;
  for (const key of keys) {
    const value = patient[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function patientBreed(patient: Record<string, unknown> | null): string | null {
  const entity =
    patient?.breedEntity && typeof patient.breedEntity === 'object'
      ? (patient.breedEntity as Record<string, unknown>)
      : null;
  return patientField(entity, 'name') ?? patientField(patient, 'breed', 'breedDescription');
}

function patientAge(
  patient: Record<string, unknown> | null,
  onDate?: string | null
): string | null {
  const raw = patientField(patient, 'dob', 'dateOfBirth');
  if (!raw) return null;
  const born = new Date(raw);
  const at = onDate ? new Date(onDate) : new Date();
  if (Number.isNaN(born.getTime()) || Number.isNaN(at.getTime()) || born > at) return null;
  let months = (at.getFullYear() - born.getFullYear()) * 12 + at.getMonth() - born.getMonth();
  if (at.getDate() < born.getDate()) months -= 1;
  if (months < 0) return null;
  if (months < 24) return `${months} mo`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths ? `${years} yr ${remainingMonths} mo` : `${years} yr`;
}

function examDayLabel(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString();
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Forward booking is deliberately absent: it belongs to the wrap-up, which settles
 * it for every pet on the visit rather than one chart at a time. */
type SoapTabId = 'subjective' | 'objective' | 'assessment' | 'plan';

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
];

export function vitalsFromValue(v: unknown): Vitals {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s = (k: string) => (o[k] == null ? '' : String(o[k]));
  const unitRaw = String(o.weightUnit ?? '').toLowerCase();
  return {
    tempF: s('tempF'),
    weight: s('weight'),
    weightUnit: unitRaw === 'kg' ? 'kg' : 'lb',
    weightNotTaken: o.weightNotTaken === true || o.weightNotTaken === 'true',
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
  const { employeeId, role } = useAuth() as {
    employeeId?: string | null;
    role?: string[];
  };
  const appointmentId = Number(params.appointmentId);
  const patientId = Number(params.patientId);
  const clientIdParam = searchParams.get('clientId');

  const [encounter, setEncounter] = useState<SoapEncounter | null>(null);
  const encounterRef = useRef(encounter);
  encounterRef.current = encounter;
  const [problems, setProblems] = useState<PatientProblem[]>([]);
  const [chronicMedications, setChronicMedications] = useState<PatientPrescription[]>([]);
  const [orders, setOrders] = useState<EncounterOrder[]>([]);
  const [invoice, setInvoice] = useState<VisitInvoice | null>(null);
  const [patientName, setPatientName] = useState<string>('');
  const [patientProfile, setPatientProfile] = useState<Record<string, unknown> | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [appointmentStart, setAppointmentStart] = useState<string | null>(null);
  const [primaryProviderId, setPrimaryProviderId] = useState<number | null>(null);
  const [primaryProviderName, setPrimaryProviderName] = useState<string | null>(null);
  const [primaryProviderLicense, setPrimaryProviderLicense] = useState<string | null>(null);
  const [showPromptOverrides, setShowPromptOverrides] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEuthanasia, setShowEuthanasia] = useState(false);
  const [planToast, setPlanToast] = useState<string | null>(null);
  const planToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (planToastTimerRef.current != null) window.clearTimeout(planToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!Number.isFinite(patientId) || patientId <= 0 || !patientName.trim()) return;
    const ownerId = clientIdParam?.trim();
    const ownerName = clientName.trim();
    if (ownerId && ownerName) {
      pushRecentRecord({ kind: 'client', id: ownerId, name: ownerName });
    }
    pushRecentRecord({
      kind: 'patient',
      id: patientId,
      name: patientName.trim(),
      subtitle: ownerName || undefined,
    });
  }, [patientId, patientName, clientName, clientIdParam]);

  const [subjective, setSubjective] = useState('');
  const [vitals, setVitals] = useState<Vitals>(vitalsFromValue(null));
  const [exam, setExam] = useState<PeExamState>(defaultPeExamState());
  const [objectiveNotes, setObjectiveNotes] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const planNotesRef = useRef(planNotes);
  planNotesRef.current = planNotes;
  const [linkedProblemIds, setLinkedProblemIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<SoapTabId>('subjective');
  const [entryMode, setEntryMode] = useState<'manual' | 'scribe'>('scribe');
  const [emailDraft, setEmailDraft] = useState<{
    subject: string;
    body: string;
  }>({ subject: '', body: '' });
  const emailDraftRef = useRef(emailDraft);
  emailDraftRef.current = emailDraft;
  const [scribePlanItems, setScribePlanItems] = useState<SuggestedPlanItem[]>([]);
  /** Parked by a multi-pet Process on another pet's tab — shown when this chart opens. */
  const [deferredScribePlanItems, setDeferredScribePlanItems] = useState<SuggestedPlanItem[]>([]);
  /** Opens the bottom addendum composer (also triggered from the header). */
  const [writingAddendum, setWritingAddendum] = useState(false);
  const [roster, setRoster] = useState<HouseholdRosterEntry[]>([]);
  const [householdRefreshTick, setHouseholdRefreshTick] = useState(0);
  /** Room Loader–originated order ids — Accept goes to Checkout only, not the left Plan list. */
  const [roomLoaderOrderIds, setRoomLoaderOrderIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const rememberRoomLoaderOrderIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRoomLoaderOrderIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (!changed) return prev;
      const encounterId = encounterRef.current?.id;
      if (encounterId) {
        try {
          sessionStorage.setItem(
            `soap-room-loader-order-ids:${encounterId}`,
            JSON.stringify([...next])
          );
        } catch {
          /* ignore quota / private mode */
        }
      }
      return next;
    });
  }, []);

  const locked = encounter?.status === 'completed';
  const mode: SoapEncounterMode = encounter?.mode ?? 'comprehensive';
  const scribeEnabled = String(import.meta.env.VITE_ENABLE_SCRIBE ?? '').toLowerCase() === 'true';
  const rolesLower = (Array.isArray(role) ? role : []).map((r) => String(r).toLowerCase());
  const isAdmin = rolesLower.some((r) => r === 'admin' || r === 'superadmin');
  const selfEmployeeId = employeeId != null && employeeId !== '' ? Number(employeeId) : NaN;
  const canEditProviderPrompt =
    scribeEnabled &&
    primaryProviderId != null &&
    (isAdmin ||
      (Number.isFinite(selfEmployeeId) && selfEmployeeId === primaryProviderId));

  // Keep pet tab order stable when switching charts (name, then id) — don't float "current" first.
  const petTabs = useMemo(
    () =>
      [...roster].sort((a, b) => {
        const byName = a.patientName.localeCompare(b.patientName, undefined, {
          sensitivity: 'base',
        });
        if (byName !== 0) return byName;
        return a.patientId - b.patientId;
      }),
    [roster]
  );

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
      setDeferredScribePlanItems([]);
      setWritingAddendum(false);
      setPrimaryProviderId(null);
      setPrimaryProviderName(null);
      setPrimaryProviderLicense(null);
      setClientName('');
      setPatientProfile(null);
      setAppointmentStart(null);
      setShowPromptOverrides(false);
      setShowEuthanasia(false);
      setRoomLoaderOrderIds(new Set());
      try {
        // Get-or-create: also backfills Room Loader proposed orders on an existing draft
        // that predates the import (client-accepted estimate, with codes and prices).
        let enc = await createEncounter({
          appointmentId,
          patientId,
          clientId: clientIdParam ? Number(clientIdParam) : undefined,
        });
        if (canceled) return;

        // Multi-pet scribe may have parked plan-item suggestions for this chart — hold them
        // separately so ScribePanel's onPlanItemsChange([]) doesn't wipe them on mount.
        setDeferredScribePlanItems(takeDeferredPlanItems(enc.id));

        let subjectiveHistory =
          typeof enc.subjective?.history === 'string' ? enc.subjective.history : '';

        // Subjective always opens with the pre-visit check-in block: the client's answers
        // when they filled the form out, otherwise a line saying they didn't, so the doctor
        // knows the difference between "no answers" and "not loaded". Self-healing — a chart
        // whose history was written without the block (scribe applied first) gets it back on
        // the next open, above what's already there.
        if (!hasPreVisitAnswersBlock(subjectiveHistory)) {
          let intake = '';
          try {
            if (looksLikeRawRoomLoaderSubjective(subjectiveHistory)) {
              intake = subjectiveHistory;
            } else {
              const roomLoader = await findSubmittedRoomLoaderForAppointment(appointmentId);
              const response = roomLoader?.responseFromClient;
              if (response) {
                intake = buildSubjectiveTextFromRoomLoaderResponse(response, patientId, {
                  appointmentReason: appointmentReasonFromSentToClient(
                    roomLoader.sentToClient,
                    patientId
                  ),
                });
              }
            }
          } catch (err) {
            // Falls through to the "not filled out" line rather than leaving Subjective bare.
            console.warn('Pre-exam check-in lookup failed', err);
          }

          let block = PRE_EXAM_CHECKIN_NOT_FILLED;
          if (intake.trim()) {
            let polished = intake.trim();
            if (scribeEnabled) {
              try {
                const summary = await summarizeIntakeHistory(enc.id, intake);
                if (summary.trim()) polished = summary.trim();
              } catch {
                /* keep raw Room Loader text if summarize fails */
              }
            }
            block = withRoomLoaderSubjectivePrefix(polished);
          }

          // The raw Q&A dump is the source of the block, not history to keep under it.
          const existing = intake === subjectiveHistory ? '' : subjectiveHistory;
          const next = prependCheckinBlock(block, stripCheckinPlaceholder(existing));
          if (next !== subjectiveHistory.trim()) {
            subjectiveHistory = next;
            const emailFields = emailDraftFromSubjective(enc.subjective);
            try {
              enc = await updateEncounter(enc.id, {
                subjective: buildSubjectivePayload(next, emailFields),
              });
            } catch (err) {
              console.warn('Failed to save the pre-exam check-in block', err);
            }
          }
        }

        const pendingPrep = pendingPrevisitBriefs({
          patientId,
          appointmentId,
        });
        if (pendingPrep.length) {
          let notes = pendingPrep
            .map((b) => b.transcript.trim())
            .filter(Boolean)
            .join('\n\n');
          if (scribeEnabled && notes) {
            try {
              const cleaned = await polishSpokenNotes({
                transcript: notes,
                kind: 'previsit',
              });
              if (cleaned.trim()) notes = cleaned.trim();
            } catch {
              /* keep raw prep notes if polish fails */
            }
          }
          const next = mergeClinicianPrevisitNotes(subjectiveHistory, notes);
          if (next !== subjectiveHistory.trim()) {
            subjectiveHistory = next;
            const emailFields = emailDraftFromSubjective(enc.subjective);
            try {
              enc = await updateEncounter(enc.id, {
                subjective: buildSubjectivePayload(next, emailFields),
              });
              markBriefsInjected(pendingPrep.map((b) => b.id));
            } catch (err) {
              console.warn('Failed to inject clinician prep notes from Epiphany', err);
            }
          }
        }

        const clinicianParts = splitSubjectiveHistoryParts(subjectiveHistory);
        if (
          scribeEnabled &&
          clinicianParts.clinicianPrevisit &&
          looksLikeSpokenChatter(clinicianParts.clinicianPrevisit)
        ) {
          try {
            const cleaned = await polishSpokenNotes({
              transcript: clinicianParts.clinicianPrevisit,
              kind: 'previsit',
            });
            if (cleaned.trim() && cleaned.trim() !== clinicianParts.clinicianPrevisit.trim()) {
              const next = mergeClinicianPrevisitNotes(subjectiveHistory, cleaned);
              subjectiveHistory = next;
              const emailFields = emailDraftFromSubjective(enc.subjective);
              enc = await updateEncounter(enc.id, {
                subjective: buildSubjectivePayload(next, emailFields),
              });
            }
          } catch (err) {
            console.warn('Failed to clean clinician prep notes', err);
          }
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

        const [probs, chronicMeds] = await Promise.all([
          listProblems(patientId).catch(() => [] as PatientProblem[]),
          listPatientPrescriptions(patientId, { activeChronicOnly: true }).catch(
            () => [] as PatientPrescription[]
          ),
          (async () => {
            try {
              const profile = await fetchPatientProfileForRow({ id: String(patientId) });
              if (!canceled) {
                const patient =
                  profile && typeof profile === 'object'
                    ? (profile as Record<string, unknown>)
                    : null;
                const name = patientField(patient, 'name') ?? `Patient #${patientId}`;
                setPatientName(name);
                setPatientProfile(patient);
              }
            } catch {
              if (!canceled) {
                setPatientName(`Patient #${patientId}`);
                setPatientProfile(null);
              }
            }
          })(),
          (async () => {
            try {
              const appt = await fetchAppointmentById(appointmentId, {
                practiceId: VISIT_WORKFLOW_PRACTICE_ID,
              });
              if (canceled) return;
              setAppointmentStart(
                typeof appt?.appointmentStart === 'string' ? appt.appointmentStart : null
              );
              const client = appt?.client;
              if (client) {
                setClientName(
                  [client.firstName, client.lastName]
                    .map((part) => (typeof part === 'string' ? part.trim() : ''))
                    .filter(Boolean)
                    .join(' ')
                );
              }
              const provider = appt?.primaryProvider;
              if (provider?.id != null) {
                setPrimaryProviderId(Number(provider.id));
                const full = [provider.firstName, provider.lastName]
                  .map((p) => (typeof p === 'string' ? p.trim() : ''))
                  .filter(Boolean)
                  .join(' ');
                if (!full) {
                  setPrimaryProviderName(`Provider #${provider.id}`);
                } else {
                  setPrimaryProviderName(/^dr\.?\b/i.test(full) ? full : `Dr. ${full}`);
                }
                try {
                  const employee = (await fetchEmployee(Number(provider.id))) as unknown as Record<
                    string,
                    unknown
                  >;
                  const license = employee.licenseNumber;
                  if (!canceled && typeof license === 'string' && license.trim()) {
                    setPrimaryProviderLicense(license.trim());
                  }
                } catch {
                  /* The label modal will ask for a missing license number. */
                }
              }
            } catch {
              /* provider label is optional for the Prompt link */
            }
          })(),
        ]);
        if (canceled) return;
        setProblems(probs);
        setChronicMedications(chronicMeds);

        const [ords] = await Promise.all([
          listOrders(enc.id).catch(() => [] as EncounterOrder[]),
          refreshInvoice(),
        ]);
        if (canceled) return;
        setOrders(ords);
        const fromPending = ords
          .filter((o) => o.state === 'proposed' || o.state === 'declined')
          .map((o) => o.id);
        let fromStore: string[] = [];
        try {
          const raw = sessionStorage.getItem(`soap-room-loader-order-ids:${enc.id}`);
          if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              fromStore = parsed.filter((x): x is string => typeof x === 'string');
            }
          }
        } catch {
          /* ignore */
        }
        rememberRoomLoaderOrderIds([...fromPending, ...fromStore]);
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

  // Reads the encounter through a ref so saving doesn't change this function's identity. The
  // scribe auto-apply effects take the handlers built on `save` as dependencies, so a new `save`
  // after every PATCH would re-fire them against their own writes.
  const save = useCallback(
    async (patch: Parameters<typeof updateEncounter>[1]) => {
      const id = encounterRef.current?.id;
      if (!id || locked) return;
      try {
        const updated = await updateEncounter(id, patch);
        setEncounter(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save');
      }
    },
    [locked]
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

  const appendBulletToSoapSection = useCallback(
    (section: SoapNarrativeSection, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const bullet = trimmed.startsWith('-') ? trimmed : `- ${trimmed}`;
      const append = (existing: string) => {
        const cur = existing.trim();
        return cur ? `${cur}\n${bullet}` : bullet;
      };
      if (section === 'subjective') {
        const next = append(subjective);
        setSubjective(next);
        void saveSubjective(next);
      } else if (section === 'objective') {
        const next = append(objectiveNotes);
        setObjectiveNotes(next);
        void save({ objectiveNotes: next });
      } else if (section === 'assessment') {
        const next = append(reasoning);
        setReasoning(next);
        void save({ assessmentReasoning: next });
      } else {
        const next = append(planNotes);
        setPlanNotes(next);
        void save({ planNotes: next });
      }
    },
    [subjective, objectiveNotes, reasoning, planNotes, save, saveSubjective]
  );

  const showPlanToast = useCallback((message: string) => {
    setPlanToast(message);
    if (planToastTimerRef.current != null) window.clearTimeout(planToastTimerRef.current);
    planToastTimerRef.current = window.setTimeout(() => {
      setPlanToast(null);
      planToastTimerRef.current = null;
    }, 2800);
  }, []);

  /**
   * Inventory catalog picks also land under Treatment Plan/Medications in the Plan narrative
   * so the charted plan stays in sync with checkout — whether the doctor used Plan search or
   * "Plan items for checkout". Vaccines get "Vx administered: … SQ"; meds get "Rx'ed …".
   */
  const appendInventoryToTreatmentPlan = useCallback(
    (item: { name: string; isVaccine?: boolean }) => {
      const next = appendTreatmentPlanMedicationBullet(planNotesRef.current, item.name, {
        kind: item.isVaccine ? 'vaccine' : 'medication',
      });
      if (next === planNotesRef.current) return;
      planNotesRef.current = next;
      setPlanNotes(next);
      void save({ planNotes: next });
      const short = item.name.trim().replace(/\s+/g, ' ');
      showPlanToast(item.isVaccine ? `Added vaccine to the plan` : `Added ${short} to the plan`);
    },
    [save, showPlanToast]
  );

  const removeInventoryFromTreatmentPlan = useCallback(
    (itemName: string) => {
      const next = removeTreatmentPlanMedicationBullet(planNotesRef.current, itemName);
      if (next === planNotesRef.current) return;
      planNotesRef.current = next;
      setPlanNotes(next);
      void save({ planNotes: next });
    },
    [save]
  );

  /** Follow-up choice recorded for this visit, from whichever surface asked. */
  const dispositionValue = useMemo<ForwardBookingDisposition | null>(() => {
    const d = encounter?.forwardBookingDisposition;
    if (d && typeof d === 'object' && typeof (d as { mode?: unknown }).mode === 'string') {
      return d as unknown as ForwardBookingDisposition;
    }
    return null;
  }, [encounter?.forwardBookingDisposition]);

  const clientQuery = clientIdParam ? `?clientId=${encodeURIComponent(clientIdParam)}` : '';
  const soapPath = `/schedule/soap/${appointmentId}/${patientId}${clientQuery}`;

  /**
   * Hand off to the wrap-up, which owns forward booking, the client recap, and
   * locking the record for every pet on the visit.
   */
  const goToWrapUp = () => {
    navigate(`/schedule/soap/${appointmentId}/${patientId}/wrap-up${clientQuery}`);
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

  const onScribeProblemUpdated = (problem: PatientProblem) => {
    setProblems((prev) => prev.map((p) => (p.id === problem.id ? problem : p)));
  };

  const onChronicMedicationUpdated = (rx: PatientPrescription) => {
    setChronicMedications((prev) =>
      rx.discontinuedAt
        ? prev.filter((m) => m.id !== rx.id)
        : prev.map((m) => (m.id === rx.id ? rx : m))
    );
  };

  const onChronicMedicationCreated = (rx: PatientPrescription) => {
    setChronicMedications((prev) => [rx, ...prev.filter((m) => m.id !== rx.id)]);
  };

  const refreshChronicMedications = useCallback(() => {
    void listPatientPrescriptions(patientId, { activeChronicOnly: true })
      .then(setChronicMedications)
      .catch(() => undefined);
  }, [patientId]);

  const onScribeOrderCreated = (order: EncounterOrder) => {
    setOrders((prev) => [...prev, order]);
  };

  const signalment = useMemo(() => {
    const sex = patientProfile ? patientSexDisplayFromRecord(patientProfile) : null;
    const age = patientAge(patientProfile, appointmentStart);
    const breed = patientBreed(patientProfile);
    const visitWeight = formatVitalWeight(vitals);
    const profileWeight = patientField(patientProfile, 'weight', 'weightLbs');
    const weight = visitWeight ?? (profileWeight ? `${profileWeight} lb` : null);
    return [age, sex, breed, weight].filter((part): part is string => Boolean(part));
  }, [appointmentStart, patientProfile, vitals]);

  if (loading) {
    return <div className="soap-page soap-loading">Loading encounter…</div>;
  }
  if (error && !encounter) {
    return <div className="soap-page soap-error-page">{error}</div>;
  }

  return (
    <div className="soap-page">
      {planToast && (
        <div className="soap-plan-toast" role="status" aria-live="polite">
          {planToast}
        </div>
      )}
      <header className="soap-header">
        <div className="soap-header-main">
          <Stethoscope size={20} />
          <div className="soap-header-patient">
            <h1>
              <Link
                className="soap-header-patient-link"
                to={`/schedule/patients?patientId=${encodeURIComponent(String(patientId))}`}
                title="Open patient medical record"
              >
                {patientName || `Patient #${patientId}`}
              </Link>
            </h1>
            {signalment.length > 0 && (
              <span className="soap-header-signalment">{signalment.join(' · ')}</span>
            )}
            {patientField(patientProfile, 'microchip') && (
              <span className="soap-header-signalment">
                Microchip {patientField(patientProfile, 'microchip')}
              </span>
            )}
            <span className="soap-header-sub">
              Exam: {examDayLabel(appointmentStart)} · Visit #{appointmentId} ·{' '}
              {mode === 'quick' ? 'Quick' : 'Comprehensive'} SOAP
            </span>
          </div>
        </div>
        <div className="soap-header-actions">
          {canEditProviderPrompt && primaryProviderId != null && (
            <button
              type="button"
              className="soap-provider-prompt-btn"
              onClick={() => setShowPromptOverrides(true)}
              title={`Edit provider-wide AI scribe instructions for ${
                primaryProviderName ?? `Provider #${primaryProviderId}`
              }`}
            >
              <SlidersHorizontal size={13} /> Scribe prompt
            </button>
          )}
          {!locked && scribeEnabled && (
            <div className="soap-mode-switch">
              <button
                type="button"
                className={effectiveEntryMode === 'scribe' ? 'active' : ''}
                onClick={() => setEntryMode('scribe')}
              >
                AI Scribe
              </button>
              <button
                type="button"
                className={effectiveEntryMode === 'manual' ? 'active' : ''}
                onClick={() => setEntryMode('manual')}
              >
                Manual
              </button>
            </div>
          )}
          {locked ? (
            <>
              <span className="soap-locked-badge" title="Signed and locked — no further edits">
                <Lock size={14} /> SOAP signed
              </span>
              <button
                type="button"
                className="soap-btn"
                title="Append a dated note without unlocking the signed SOAP"
                onClick={() => setWritingAddendum(true)}
              >
                <FilePlus2 size={15} /> Write addendum
              </button>
            </>
          ) : (
            /* Signing happens in the wrap-up, where forward booking and the client
               recap are settled for the whole household rather than this chart alone. */
            <button
              type="button"
              className="soap-btn primary"
              title="Review the charts, set follow-up, and send the client recap"
              onClick={goToWrapUp}
            >
              <ArrowRight size={15} /> Wrap up visit
            </button>
          )}
        </div>
      </header>

      {error && <div className="soap-error soap-error-banner">{error}</div>}

      {petTabs.length > 1 && (
        <div className="soap-pet-tabs" role="tablist" aria-label="Pets at this visit">
          {petTabs.map((r) => (
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

      <SoapPatientChronicSummary
        patientId={patientId}
        practiceId={VISIT_WORKFLOW_PRACTICE_ID}
        createdInEncounterId={encounter?.id}
        problems={problems}
        chronicMedications={chronicMedications}
        disabled={locked}
        onProblemCreated={onScribeProblemCreated}
        onProblemUpdated={onScribeProblemUpdated}
        onMedicationCreated={onChronicMedicationCreated}
        onMedicationUpdated={onChronicMedicationUpdated}
      />

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
          onPlanItemsChange={setScribePlanItems}
          onHouseholdOrdersChanged={() => setHouseholdRefreshTick((t) => t + 1)}
        />
      )}

      {showPromptOverrides && primaryProviderId != null && (
        <ScribePromptOverridesModal
          providerId={primaryProviderId}
          providerName={primaryProviderName?.trim() || `Provider #${primaryProviderId}`}
          onClose={() => setShowPromptOverrides(false)}
        />
      )}

      <div className="soap-body">
        <main className="soap-main">
          {effectiveEntryMode === 'scribe' ? (
            <ScribeDocumentView
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
                      suggestions={[...deferredScribePlanItems, ...scribePlanItems]}
                      planNotes={planNotes}
                      orders={orders}
                      disabled={locked}
                      patientId={patientId}
                      clientId={clientIdParam ? Number(clientIdParam) : undefined}
                      practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                      onOrderAdded={(order, meta) => {
                        onScribeOrderCreated(order);
                        if (
                          order.catalogItemType === 'inventory' &&
                          !meta?.skipPlanNarrative &&
                          !/sharps/i.test(order.name)
                        ) {
                          appendInventoryToTreatmentPlan({
                            name: order.name,
                            isVaccine: meta?.isVaccine,
                          });
                        }
                      }}
                      onInvoiceShouldRefresh={() => void refreshInvoice()}
                      onAppendToSoapSection={appendBulletToSoapSection}
                    />
                    <PlanOrdersSection
                      key={`plan-orders-${encounter.id}`}
                      encounterId={encounter.id}
                      orders={orders}
                      disabled={locked}
                      patientId={patientId}
                      clientId={clientIdParam ? Number(clientIdParam) : undefined}
                      practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                      excludeOrderIds={roomLoaderOrderIds}
                      onChange={setOrders}
                      onInvoiceShouldRefresh={() => void refreshInvoice()}
                      onInventoryItemAdded={appendInventoryToTreatmentPlan}
                      onInventoryItemRemoved={removeInventoryFromTreatmentPlan}
                    />
                    <VisitDoseAndRxSection
                      key={`dose-rx-${encounter.id}`}
                      encounterId={encounter.id}
                      orders={orders}
                      disabled={locked}
                      patientId={patientId}
                      clientId={clientIdParam ? Number(clientIdParam) : undefined}
                      practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                      providerId={primaryProviderId}
                      patientName={patientName}
                      patientSpecies={patientField(patientProfile, 'species')}
                      ownerName={clientName}
                      providerName={primaryProviderName}
                      providerLicense={primaryProviderLicense}
                      onOrderUpdated={(updated) =>
                        setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
                      }
                      onInvoiceShouldRefresh={() => void refreshInvoice()}
                      onChronicMedicationsMaybeChanged={refreshChronicMedications}
                    />
                  </>
                )
              }
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
                    className={`soap-tab${activeTab === id ? ' active' : ''}`}
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
                      Pre-visit check-in is summarized automatically. Confirm or edit — don&apos;t
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
                    <div
                      className={
                        isWeightAddressed(vitals)
                          ? 'soap-weight'
                          : 'soap-weight soap-weight--required'
                      }
                    >
                      <div className="soap-weight__row">
                        <label className="soap-vital soap-weight__value">
                          <span>
                            Weight <span className="soap-weight__req" aria-hidden>*</span>
                          </span>
                          <input
                            className="soap-input"
                            inputMode="decimal"
                            placeholder="e.g. 12.4"
                            value={vitals.weightNotTaken ? '' : vitals.weight}
                            disabled={locked || vitals.weightNotTaken}
                            onChange={(e) => {
                              const weight = e.target.value;
                              setVitals((v) => ({
                                ...v,
                                weight,
                                weightNotTaken: false,
                              }));
                            }}
                            onBlur={(e) => {
                              if (vitals.weightNotTaken) return;
                              const weight = e.currentTarget.value;
                              setVitals((v) => {
                                const next = { ...v, weight, weightNotTaken: false as const };
                                void save({ objectiveVitals: { ...next } });
                                return next;
                              });
                            }}
                          />
                        </label>
                        <fieldset className="soap-weight__units" disabled={locked || vitals.weightNotTaken}>
                          <legend className="soap-sr-only">Weight unit</legend>
                          {(
                            [
                              ['lb', 'Lb'],
                              ['kg', 'kg'],
                            ] as const
                          ).map(([unit, label]) => (
                            <label
                              key={unit}
                              className={
                                vitals.weightUnit === unit && !vitals.weightNotTaken
                                  ? 'soap-weight__unit is-selected'
                                  : 'soap-weight__unit'
                              }
                            >
                              <input
                                type="radio"
                                name="soap-weight-unit"
                                value={unit}
                                checked={vitals.weightUnit === unit && !vitals.weightNotTaken}
                                disabled={locked || vitals.weightNotTaken}
                                onChange={() => {
                                  const next = {
                                    ...vitals,
                                    weightUnit: unit,
                                    weightNotTaken: false,
                                  };
                                  setVitals(next);
                                  void save({ objectiveVitals: { ...next } });
                                }}
                              />
                              {label}
                            </label>
                          ))}
                        </fieldset>
                      </div>
                      <label className="soap-weight__none">
                        <input
                          type="checkbox"
                          checked={vitals.weightNotTaken}
                          disabled={locked}
                          onChange={(e) => {
                            const weightNotTaken = e.target.checked;
                            const next: Vitals = {
                              ...vitals,
                              weightNotTaken,
                              weight: weightNotTaken ? '' : vitals.weight,
                            };
                            setVitals(next);
                            void save({ objectiveVitals: { ...next } });
                          }}
                        />
                        No weight taken
                      </label>
                      {!isWeightAddressed(vitals) && !locked && (
                        <p className="soap-weight__hint">
                          Enter a weight and choose Lb or kg, or select &ldquo;No weight taken.&rdquo;
                          Required before signing.
                        </p>
                      )}
                    </div>
                    <div className="soap-vitals">
                      {(
                        [
                          ['tempF', 'Temp °F'],
                          ['hr', 'HR (bpm)'],
                          ['rr', 'RR (rpm)'],
                          ['bcs', 'BCS /9'],
                          ['painScore', 'FAS /5'],
                        ] as const
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
                        excludeOrderIds={roomLoaderOrderIds}
                        onChange={setOrders}
                        onInvoiceShouldRefresh={() => void refreshInvoice()}
                        onInventoryItemAdded={appendInventoryToTreatmentPlan}
                        onInventoryItemRemoved={removeInventoryFromTreatmentPlan}
                      />
                    )}
                    {encounter && (
                      <VisitDoseAndRxSection
                        key={`dose-rx-manual-${encounter.id}`}
                        encounterId={encounter.id}
                        orders={orders}
                        disabled={locked}
                        patientId={patientId}
                        clientId={clientIdParam ? Number(clientIdParam) : undefined}
                        practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                        providerId={primaryProviderId}
                        patientName={patientName}
                        patientSpecies={patientField(patientProfile, 'species')}
                        ownerName={clientName}
                        providerName={primaryProviderName}
                        providerLicense={primaryProviderLicense}
                        onOrderUpdated={(updated) =>
                          setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
                        }
                        onInvoiceShouldRefresh={() => void refreshInvoice()}
                        onChronicMedicationsMaybeChanged={refreshChronicMedications}
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
                  </section>
                )}
              </div>
            </>
          )}

          {locked && encounter && (
            <SoapAddendaSection
              key={`addenda-${encounter.id}`}
              encounterId={encounter.id}
              writing={writingAddendum}
              onWritingChange={setWritingAddendum}
              scrollIntoViewOnWrite
            />
          )}
        </main>

        <aside className="soap-aside">
          {encounter && (
            <ProposedOrdersPanel
              key={`proposed-orders-${encounter.id}`}
              encounterId={encounter.id}
              orders={orders}
              disabled={locked}
              patientId={patientId}
              clientId={clientIdParam ? Number(clientIdParam) : undefined}
              practiceId={VISIT_WORKFLOW_PRACTICE_ID}
              onChange={setOrders}
              onInvoiceShouldRefresh={() => void refreshInvoice()}
              onRoomLoaderOrderIds={rememberRoomLoaderOrderIds}
            />
          )}
          <HouseholdInvoiceSummary
            roster={roster}
            currentInvoice={invoice}
            refreshSignal={householdRefreshTick}
            onSwitchPet={switchToPet}
          />
          <VisitCheckoutPanel
            encounterId={encounter?.id}
            invoice={invoice}
            orders={orders}
            disabled={locked}
            onInvoiceChange={setInvoice}
            onOrdersChange={(next) => {
              setOrders(next);
              void refreshInvoice();
            }}
            onOpenEuthanasiaPrepay={() => setShowEuthanasia(true)}
            onOrderRemoved={(orderId) => {
              const removed = orders.find((o) => o.id === orderId);
              setOrders((prev) => prev.filter((o) => o.id !== orderId));
              void refreshInvoice();
              if (removed?.catalogItemType === 'inventory') {
                removeInventoryFromTreatmentPlan(removed.name);
              }
            }}
            followUpSlot={
              encounter && (
                <CheckoutFollowUpPrompt
                  appointmentId={appointmentId}
                  patientId={patientId}
                  patientName={patientName}
                  clientId={encounter.clientId}
                  soapEncounterId={encounter.id}
                  providerId={primaryProviderId}
                  disposition={dispositionValue}
                  forwardBookingEntryId={encounter.forwardBookingEntryId}
                  disabled={locked}
                  returnTo={soapPath}
                  onSaved={(disposition) =>
                    setEncounter((prev) =>
                      prev
                        ? {
                            ...prev,
                            forwardBookingDisposition: disposition as unknown as Record<
                              string,
                              unknown
                            >,
                          }
                        : prev
                    )
                  }
                />
              )
            }
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
