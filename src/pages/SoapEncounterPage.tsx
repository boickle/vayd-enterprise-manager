import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  Receipt,
  SlidersHorizontal,
  Mic,
  Users,
} from 'lucide-react';
import './SoapEncounterPage.css';
import {
  createEncounter,
  getEncounter,
  getHouseholdRoster,
  getInvoiceByAppointment,
  listOrders,
  soapFieldConflictFrom,
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
import { listScribeSessions, polishSpokenNotes, summarizeIntakeHistory } from '../api/soapScribe';
import { fetchAppointmentById } from '../api/appointments';
import { fetchEmployee } from '../api/appointmentSettings';
import { fetchPatientProfileForRow } from '../api/patients';
import { useAuth } from '../auth/useAuth';
import { pushRecentRecord } from '../utils/recentRecordsStore';
import {
  emptySoapChronicDraft,
  readSoapChronicDraft,
  writeSoapChronicDraft,
  type SoapChronicDraft,
} from '../utils/soapChronicDraft';
import {
  peerPresenceCaption,
  peerShortName,
  soapFieldLabel,
  subscribeVisit,
  type VisitPeer,
  type VisitRealtimeHandle,
} from '../utils/visitRealtime';
import {
  defaultPeExamState,
  peExamFromValue,
  type PeExamState,
} from '../components/soap/peTemplate';
import PhysicalExamSection from '../components/soap/PhysicalExamSection';
import MasterProblemListSection from '../components/soap/MasterProblemListSection';
import PlanOrdersSection from '../components/soap/PlanOrdersSection';
import SoapAddendaSection from '../components/soap/SoapAddendaSection';
import VisitCheckoutPanel from '../components/soap/VisitCheckoutPanel';
import EuthanasiaPrepayModal from '../components/soap/EuthanasiaPrepayModal';
import EuthanasiaConsentPanel from '../components/soap/EuthanasiaConsentPanel';
import ScribePanel from '../components/soap/ScribePanel';
import SoapPatientChronicSummary from '../components/soap/SoapPatientChronicSummary';
import ScribeDocumentView, { type DocTabId } from '../components/soap/ScribeDocumentView';
import SoapVitalsFields from '../components/soap/SoapVitalsFields';
import {
  formatVitalWeight,
  isWeightAddressed,
  vitalsFromValue,
  type Vitals,
} from '../utils/soapVitals';
import SoapRichTextField from '../components/soap/SoapRichTextField';
import ScribePromptOverridesModal from '../components/soap/ScribePromptOverridesModal';
import ScribeSuggestedPlanItems, {
  type SoapNarrativeSection,
  type SuggestedPlanItem,
} from '../components/soap/ScribeSuggestedPlanItems';
import { appConfirm } from '../utils/appDialog';
import {
  clearSoapChartDraft,
  mergeParkedSoapDraft,
  readSoapChartDraft,
  soapChartDraftIsNewer,
  soapTextIsBlank,
  writeSoapChartDraft,
  type LastSavedSoapChart,
  type SoapChartDraft,
} from '../utils/soapChartDraft';
import {
  fillEmptySoapNarratives,
  latestScribeSuggestion,
  narrativesFromScribeSuggestion,
} from '../utils/soapNarrativesFromScribe';
import type { PeSystemFinding } from '../components/soap/peTemplate';
import {
  appointmentReasonFromSentToClient,
  buildSubjectiveTextFromRoomLoaderResponse,
  findSubmittedRoomLoaderForAppointment,
  hasPreVisitAnswersBlock,
  looksLikeRawRoomLoaderSubjective,
  looksLikeSpokenChatter,
  cleanSubjectiveAfterVisit,
  joinSubjectiveHistoryParts,
  mergeClinicianPrevisitNotes,
  PRE_EXAM_CHECKIN_NOT_FILLED,
  prependCheckinBlock,
  splitSubjectiveHistoryParts,
  stripCheckinPlaceholder,
  subjectiveHasVisitSoap,
  withRoomLoaderSubjectivePrefix,
} from '../utils/roomLoaderSubjectiveText';
import { markBriefsInjected, pendingPrevisitBriefs } from '../utils/briefStore';
import { takeDeferredPlanItems } from '../utils/deferredScribePlanItems';
import {
  appendTreatmentPlanMedicationBullet,
  removeTreatmentPlanMedicationBullet,
} from '../utils/planNotesSections';
import { patientSexDisplayFromRecord } from '../utils/schedulerVisitDisplay';


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
type SoapTabId = DocTabId;

const SOAP_TABS: {
  id: Exclude<SoapTabId, 'checkout-prep'>;
  label: string;
  short: string;
  icon: typeof ClipboardList;
}[] = [
  { id: 'subjective', label: 'Subjective', short: 'S', icon: ClipboardList },
  { id: 'objective', label: 'Objective', short: 'O', icon: Activity },
  { id: 'assessment', label: 'Assessment', short: 'A', icon: ListChecks },
  { id: 'plan', label: 'Plan', short: 'P', icon: ClipboardList },
];


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

function snapshotSoapDraft(parts: {
  subjective: string;
  email: { subject: string; body: string };
  objectiveNotes: string;
  reasoning: string;
  planNotes: string;
  vitals: Vitals;
  exam: PeExamState;
  linkedProblemIds: string[];
}): SoapChartDraft {
  return {
    subjective: parts.subjective,
    emailSubject: parts.email.subject,
    emailBody: parts.email.body,
    objectiveNotes: parts.objectiveNotes,
    reasoning: parts.reasoning,
    planNotes: parts.planNotes,
    vitals: parts.vitals,
    exam: parts.exam,
    linkedProblemIds: [...parts.linkedProblemIds],
    at: new Date().toISOString(),
  };
}

function soapDraftDirty(live: SoapChartDraft, saved: SoapChartDraft): boolean {
  return (
    live.subjective !== saved.subjective ||
    live.emailSubject !== saved.emailSubject ||
    live.emailBody !== saved.emailBody ||
    live.objectiveNotes !== saved.objectiveNotes ||
    live.reasoning !== saved.reasoning ||
    live.planNotes !== saved.planNotes ||
    JSON.stringify(live.vitals) !== JSON.stringify(saved.vitals) ||
    JSON.stringify(live.exam) !== JSON.stringify(saved.exam) ||
    live.linkedProblemIds.join('\0') !== saved.linkedProblemIds.join('\0')
  );
}

function patchFromDraftDiff(
  live: SoapChartDraft,
  saved: SoapChartDraft
): Parameters<typeof updateEncounter>[1] {
  const patch: Parameters<typeof updateEncounter>[1] = {};
  if (
    live.subjective !== saved.subjective ||
    live.emailSubject !== saved.emailSubject ||
    live.emailBody !== saved.emailBody
  ) {
    if (!soapTextIsBlank(live.subjective) || soapTextIsBlank(saved.subjective)) {
      patch.subjective = buildSubjectivePayload(live.subjective, {
        subject: live.emailSubject,
        body: live.emailBody,
      });
    }
  }
  if (live.objectiveNotes !== saved.objectiveNotes) {
    if (!soapTextIsBlank(live.objectiveNotes) || soapTextIsBlank(saved.objectiveNotes)) {
      patch.objectiveNotes = live.objectiveNotes;
    }
  }
  if (live.reasoning !== saved.reasoning) {
    if (!soapTextIsBlank(live.reasoning) || soapTextIsBlank(saved.reasoning)) {
      patch.assessmentReasoning = live.reasoning;
    }
  }
  if (live.planNotes !== saved.planNotes) {
    if (!soapTextIsBlank(live.planNotes) || soapTextIsBlank(saved.planNotes)) {
      patch.planNotes = live.planNotes;
    }
  }
  if (JSON.stringify(live.vitals) !== JSON.stringify(saved.vitals)) {
    patch.objectiveVitals = { ...live.vitals };
  }
  if (JSON.stringify(live.exam) !== JSON.stringify(saved.exam)) {
    patch.objectiveExam = live.exam;
  }
  if (live.linkedProblemIds.join('\0') !== saved.linkedProblemIds.join('\0')) {
    patch.assessmentProblemIds = live.linkedProblemIds;
  }
  return patch;
}

const SOAP_SPLIT_KEY_PREFIX = 'scout.soap.chartInvoiceSplitPct';
const SOAP_SPLIT_DEFAULT = 52;
const SOAP_SPLIT_MIN = 32;
const SOAP_SPLIT_MAX = 72;

function soapSplitStorageKey(userId: string | null | undefined): string {
  return `${SOAP_SPLIT_KEY_PREFIX}.${userId?.trim() || 'anon'}`;
}

function readSoapSplitPct(userId: string | null | undefined): number {
  try {
    const raw = localStorage.getItem(soapSplitStorageKey(userId));
    const n = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(SOAP_SPLIT_MAX, Math.max(SOAP_SPLIT_MIN, n));
    }
  } catch {
    /* ignore */
  }
  return SOAP_SPLIT_DEFAULT;
}

export default function SoapEncounterPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { employeeId, role, userId, userEmail } = useAuth() as {
    employeeId?: string | null;
    role?: string[];
    userId?: string | null;
    userEmail?: string | null;
  };
  const appointmentId = Number(params.appointmentId);
  const patientId = Number(params.patientId);
  const clientIdParam = searchParams.get('clientId');
  const focusOrderId = searchParams.get('focusOrder');

  const workspaceRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ startX: number; startPct: number } | null>(null);
  const [chartPct, setChartPct] = useState(() => readSoapSplitPct(userId));
  const [splitDragging, setSplitDragging] = useState(false);

  useEffect(() => {
    setChartPct(readSoapSplitPct(userId));
  }, [userId]);

  const persistChartPct = useCallback(
    (pct: number) => {
      const clamped = Math.min(SOAP_SPLIT_MAX, Math.max(SOAP_SPLIT_MIN, pct));
      setChartPct(clamped);
      try {
        localStorage.setItem(soapSplitStorageKey(userId), String(Math.round(clamped * 10) / 10));
      } catch {
        /* ignore */
      }
    },
    [userId]
  );

  const onSplitPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      splitDragRef.current = { startX: e.clientX, startPct: chartPct };
      setSplitDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [chartPct]
  );

  const onSplitPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = splitDragRef.current;
      const el = workspaceRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const deltaPct = ((e.clientX - drag.startX) / rect.width) * 100;
      persistChartPct(drag.startPct + deltaPct);
    },
    [persistChartPct]
  );

  const onSplitPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitDragRef.current) return;
    splitDragRef.current = null;
    setSplitDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const [encounter, setEncounter] = useState<SoapEncounter | null>(null);
  const encounterRef = useRef(encounter);
  encounterRef.current = encounter;
  /** Last snapshot we know is on the server (or just hydrated). Auto-save diffs against this. */
  const lastSavedRef = useRef<LastSavedSoapChart | null>(null);
  const pendingHydrationRef = useRef<{
    encounterId: string;
    serverDraft: SoapChartDraft;
  } | null>(null);
  const [problems, setProblems] = useState<PatientProblem[]>([]);
  const [chronicMedications, setChronicMedications] = useState<PatientPrescription[]>([]);
  const [chronicDraft, setChronicDraft] = useState<SoapChronicDraft>(() => emptySoapChronicDraft());
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
  const subjectiveRef = useRef(subjective);
  subjectiveRef.current = subjective;
  const vitalsRef = useRef(vitals);
  vitalsRef.current = vitals;
  const examRef = useRef(exam);
  examRef.current = exam;
  const objectiveNotesRef = useRef(objectiveNotes);
  objectiveNotesRef.current = objectiveNotes;
  const reasoningRef = useRef(reasoning);
  reasoningRef.current = reasoning;
  const linkedProblemIdsRef = useRef(linkedProblemIds);
  linkedProblemIdsRef.current = linkedProblemIds;
  const [activeTab, setActiveTab] = useState<SoapTabId>('subjective');
  /** Unmatched checkout-prep rows (dismiss / match lowers this). */
  const [checkoutPrepPendingCount, setCheckoutPrepPendingCount] = useState(0);
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
  const [clinicalRefreshTick, setClinicalRefreshTick] = useState(0);
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
  }, [appointmentId]);

  // --- Live co-editing: the tech works the invoice while the doctor writes the chart ---

  const [peers, setPeers] = useState<VisitPeer[]>([]);
  const [coEditNotice, setCoEditNotice] = useState<string | null>(null);
  /** Bumped so the checkout panel reloads orders somebody else just changed. */
  const [ordersRevision, setOrdersRevision] = useState(0);
  const visitSocketRef = useRef<VisitRealtimeHandle | null>(null);
  const focusedFieldRef = useRef<string | null>(null);

  const showCoEditNotice = useCallback((message: string) => {
    setCoEditNotice(message);
    window.setTimeout(
      () => setCoEditNotice((current) => (current === message ? null : current)),
      6000
    );
  }, []);

  /**
   * Pull in what someone else just wrote. The field this user has focused is
   * deliberately skipped — a remote save must never pull text out from under a
   * live cursor. They get it on their next blur instead.
   */
  const applyRemoteEncounter = useCallback(
    async (
      fields: string[],
      byName: string | null | undefined,
      opts?: { notify?: boolean }
    ) => {
      const id = encounterRef.current?.id;
      if (!id || fields.length === 0) return;
      let fresh: SoapEncounter;
      try {
        fresh = await getEncounter(id);
      } catch {
        return;
      }
      setEncounter(fresh);

      const focused = focusedFieldRef.current;
      const takes = (field: string) => fields.includes(field) && field !== focused;

      if (takes('objectiveVitals')) setVitals(vitalsFromValue(fresh.objectiveVitals));
      if (takes('objectiveExam')) setExam(peExamFromValue(fresh.objectiveExam));
      const takeText = (
        field: 'objectiveNotes' | 'assessmentReasoning' | 'planNotes' | 'subjective',
        incoming: string,
        local: string
      ) =>
        takes(field) && (!soapTextIsBlank(incoming) || soapTextIsBlank(local));
      const incomingObjective = fresh.objectiveNotes ?? '';
      const incomingReasoning = fresh.assessmentReasoning ?? '';
      const incomingPlan = fresh.planNotes ?? '';
      const incomingSubjective =
        typeof fresh.subjective?.history === 'string' ? fresh.subjective.history : '';
      if (takeText('subjective', incomingSubjective, subjectiveRef.current)) {
        setSubjective(incomingSubjective);
        setEmailDraft(emailDraftFromSubjective(fresh.subjective));
      }
      if (takeText('objectiveNotes', incomingObjective, objectiveNotesRef.current)) {
        setObjectiveNotes(incomingObjective);
      }
      if (takeText('assessmentReasoning', incomingReasoning, reasoningRef.current)) {
        setReasoning(incomingReasoning);
      }
      if (takeText('planNotes', incomingPlan, planNotesRef.current)) {
        setPlanNotes(incomingPlan);
      }
      if (takes('assessmentProblemIds')) {
        setLinkedProblemIds(fresh.assessmentProblemIds ?? []);
      }

      // Auto-save diffs against lastSaved — mark remote-applied fields as already stored
      // so we don't immediately write our stale copy back over them.
      if (
        lastSavedRef.current &&
        lastSavedRef.current.encounterId === encounterRef.current?.id
      ) {
        const next = { ...lastSavedRef.current.draft };
        if (takeText('subjective', incomingSubjective, lastSavedRef.current.draft.subjective)) {
          next.subjective = incomingSubjective;
          const email = emailDraftFromSubjective(fresh.subjective);
          next.emailSubject = email.subject;
          next.emailBody = email.body;
        }
        if (takes('objectiveVitals')) next.vitals = vitalsFromValue(fresh.objectiveVitals);
        if (takes('objectiveExam')) next.exam = peExamFromValue(fresh.objectiveExam);
        if (takeText('objectiveNotes', incomingObjective, lastSavedRef.current.draft.objectiveNotes)) {
          next.objectiveNotes = incomingObjective;
        }
        if (takeText('assessmentReasoning', incomingReasoning, lastSavedRef.current.draft.reasoning)) {
          next.reasoning = incomingReasoning;
        }
        if (takeText('planNotes', incomingPlan, lastSavedRef.current.draft.planNotes)) {
          next.planNotes = incomingPlan;
        }
        if (takes('assessmentProblemIds')) {
          next.linkedProblemIds = fresh.assessmentProblemIds ?? [];
        }
        lastSavedRef.current = { ...lastSavedRef.current, draft: next };
      }

      if (opts?.notify === false) return;
      const held = focused && fields.includes(focused) ? soapFieldLabel(focused) : null;
      const who = byName?.trim() || 'Someone else';
      showCoEditNotice(
        held
          ? `${who} also edited ${held}. Your version is still on screen — click out to save it.`
          : `${who} updated this chart.`
      );
    },
    [showCoEditNotice]
  );

  useEffect(() => {
    if (!Number.isFinite(appointmentId)) return;
    const handle = subscribeVisit({
      practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      appointmentId,
      encounterId: encounterRef.current?.id ?? null,
      name: userEmail ?? null,
      onPresence: setPeers,
      onChanged: (payload) => {
        if (payload.scope === 'invoice') {
          void refreshInvoice();
          return;
        }
        if (payload.scope === 'orders') {
          setOrdersRevision((n) => n + 1);
          return;
        }
        // Our own saves echo back; applying them is a no-op, but skip the round trip.
        if (payload.encounterId !== encounterRef.current?.id) return;
        if (payload.byEmployeeId != null && String(payload.byEmployeeId) === employeeId) {
          return;
        }
        void applyRemoteEncounter(payload.fields ?? [], payload.byName);
      },
    });
    visitSocketRef.current = handle;
    return () => {
      visitSocketRef.current = null;
      handle.close();
    };
  }, [appointmentId, userEmail, employeeId, refreshInvoice, applyRemoteEncounter]);

  /**
   * Which SOAP field this user is in, read off `data-soap-field` rather than
   * threaded through every editor. Drives the other side's presence chip.
   */
  useEffect(() => {
    const readField = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      return target.closest<HTMLElement>('[data-soap-field]')?.dataset.soapField ?? null;
    };
    const onFocusIn = (e: FocusEvent) => {
      const field = readField(e.target);
      focusedFieldRef.current = field;
      visitSocketRef.current?.setFocus(field, encounterRef.current?.id ?? null);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (readField(e.target) == null) return;
      focusedFieldRef.current = null;
      visitSocketRef.current?.setFocus(null, encounterRef.current?.id ?? null);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  /** Everyone else on this visit, most recent first. */
  const otherPeers = useMemo(
    () => peers.filter((p) => employeeId == null || String(p.employeeId ?? '') !== employeeId),
    [peers, employeeId]
  );
  const otherRecorderName = useMemo(() => {
    const recorder = otherPeers.find((p) => p.recording);
    return recorder ? peerShortName(recorder) : null;
  }, [otherPeers]);

  // Other pets from the same household visit (docs/ai-scribe.md "Multi-pet visits") — drives the
  // pet-switcher tabs below the header and per-pet invoice grouping in checkout. Keyed off
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

  useEffect(() => {
    setChronicDraft(readSoapChronicDraft(encounter?.id));
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
      // Switching pets remounts this load — park the previous chart first so a mid-type
      // tab click does not drop the last few seconds, and so we never write pet A's
      // text onto pet B while the new row is hydrating.
      const previous = encounterRef.current;
      const previousSaved = lastSavedRef.current;
      lastSavedRef.current = null;
      pendingHydrationRef.current = null;
      if (
        previous &&
        previous.status !== 'completed' &&
        previousSaved?.encounterId === previous.id
      ) {
        const parked = snapshotSoapDraft({
          subjective: subjectiveRef.current,
          email: emailDraftRef.current,
          objectiveNotes: objectiveNotesRef.current,
          reasoning: reasoningRef.current,
          planNotes: planNotesRef.current,
          vitals: vitalsRef.current,
          exam: examRef.current,
          linkedProblemIds: linkedProblemIdsRef.current,
        });
        if (soapDraftDirty(parked, previousSaved.draft)) {
          const safeParked = mergeParkedSoapDraft(parked, previousSaved.draft);
          writeSoapChartDraft(previous.id, safeParked);
          const leftover = patchFromDraftDiff(safeParked, previousSaved.draft);
          if (Object.keys(leftover).length > 0) {
            void updateEncounter(previous.id, leftover).catch(() => undefined);
          }
        }
      }
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

        // Before SOAP is written, Subjective opens with the pre-visit check-in block.
        // After Process, that block is folded into the visit history — don't paste it
        // back on top.
        if (!hasPreVisitAnswersBlock(subjectiveHistory) && !subjectiveHasVisitSoap(subjectiveHistory)) {
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
              console.warn('Failed to inject clinician prep notes from Jot', err);
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

        const serverEmail = emailDraftFromSubjective(enc.subjective);
        const hydrated = snapshotSoapDraft({
          subjective: subjectiveHistory,
          email: serverEmail,
          objectiveNotes: enc.objectiveNotes ?? '',
          reasoning: enc.assessmentReasoning ?? '',
          planNotes: enc.planNotes ?? '',
          vitals: vitalsFromValue(enc.objectiveVitals),
          exam: peExamFromValue(enc.objectiveExam),
          linkedProblemIds: enc.assessmentProblemIds ?? [],
        });

        const parked =
          enc.status !== 'completed' ? readSoapChartDraft(enc.id) : null;
        const useParked = Boolean(parked && soapChartDraftIsNewer(parked, enc.updated));
        let display = useParked && parked ? mergeParkedSoapDraft(parked, hydrated) : hydrated;

        const needsScribeFill =
          enc.status !== 'completed' &&
          (soapTextIsBlank(display.objectiveNotes) ||
            soapTextIsBlank(display.reasoning) ||
            soapTextIsBlank(display.planNotes));
        if (needsScribeFill) {
          try {
            const sessions = await listScribeSessions(enc.id);
            const filled = fillEmptySoapNarratives(
              {
                objectiveNotes: display.objectiveNotes,
                reasoning: display.reasoning,
                planNotes: display.planNotes,
              },
              narrativesFromScribeSuggestion(latestScribeSuggestion(sessions), patientId)
            );
            if (filled.changed) {
              display = {
                ...display,
                objectiveNotes: filled.next.objectiveNotes,
                reasoning: filled.next.reasoning,
                planNotes: filled.next.planNotes,
              };
              try {
                enc = await updateEncounter(enc.id, {
                  ...(soapTextIsBlank(hydrated.objectiveNotes) &&
                  !soapTextIsBlank(filled.next.objectiveNotes)
                    ? { objectiveNotes: filled.next.objectiveNotes }
                    : {}),
                  ...(soapTextIsBlank(hydrated.reasoning) && !soapTextIsBlank(filled.next.reasoning)
                    ? { assessmentReasoning: filled.next.reasoning }
                    : {}),
                  ...(soapTextIsBlank(hydrated.planNotes) && !soapTextIsBlank(filled.next.planNotes)
                    ? { planNotes: filled.next.planNotes }
                    : {}),
                });
                showCoEditNotice(
                  'Restored Objective, Assessment, and Plan from the last Process run.'
                );
              } catch (err) {
                console.warn('Failed to restore SOAP narratives from the last Process run', err);
              }
            }
          } catch (err) {
            console.warn('Could not look up the last Process run for this chart', err);
          }
        }

        if (canceled) return;
        setEncounter(enc);
        pendingHydrationRef.current = {
          encounterId: enc.id,
          serverDraft: snapshotSoapDraft({
            subjective: typeof enc.subjective?.history === 'string' ? enc.subjective.history : hydrated.subjective,
            email: emailDraftFromSubjective(enc.subjective),
            objectiveNotes: enc.objectiveNotes ?? display.objectiveNotes,
            reasoning: enc.assessmentReasoning ?? display.reasoning,
            planNotes: enc.planNotes ?? display.planNotes,
            vitals: vitalsFromValue(enc.objectiveVitals),
            exam: peExamFromValue(enc.objectiveExam),
            linkedProblemIds: enc.assessmentProblemIds ?? hydrated.linkedProblemIds,
          }),
        };
        setSubjective(display.subjective);
        setEmailDraft({ subject: display.emailSubject, body: display.emailBody });
        setVitals(display.vitals);
        setExam(display.exam);
        setObjectiveNotes(display.objectiveNotes);
        setReasoning(display.reasoning);
        setPlanNotes(display.planNotes);
        setLinkedProblemIds(display.linkedProblemIds);
        if (useParked) {
          showCoEditNotice(
            'Restored unsaved chart text from this device. It will save again in a few seconds.'
          );
        } else {
          clearSoapChartDraft(enc.id);
        }

        const [probs, chronicMeds, profileResult] = await Promise.all([
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
                return { patient, name };
              }
            } catch {
              if (!canceled) {
                setPatientName(`Patient #${patientId}`);
                setPatientProfile(null);
              }
            }
            return { patient: null as Record<string, unknown> | null, name: `Patient #${patientId}` };
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

        // Case summary used to auto-seed from chart-chat and land as "unspecified species /
        // no chronic meds" above the visit. Drop those dumps; keep a summary only if a
        // doctor wrote it. Once a visit SOAP exists, fold check-in into that history.
        const cleanedParts = cleanSubjectiveAfterVisit(
          splitSubjectiveHistoryParts(subjectiveHistory)
        );
        const cleanedHistory = joinSubjectiveHistoryParts(cleanedParts);
        if (cleanedHistory !== subjectiveHistory.trim()) {
          subjectiveHistory = cleanedHistory;
          const emailFields = emailDraftFromSubjective(enc.subjective);
          try {
            enc = await updateEncounter(enc.id, {
              subjective: buildSubjectivePayload(cleanedHistory, emailFields),
            });
            if (!canceled) {
              setEncounter(enc);
              setSubjective(subjectiveHistory);
            }
          } catch (err) {
            console.warn('Failed to clean Subjective after visit', err);
          }
        }

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

  // lastSaved stays null until this paint, so the 8s autosave cannot flush empty
  // O/A/P over the server row while the chart is still hydrating.
  useLayoutEffect(() => {
    const pending = pendingHydrationRef.current;
    if (!pending || pending.encounterId !== encounter?.id) return;
    lastSavedRef.current = {
      encounterId: pending.encounterId,
      draft: pending.serverDraft,
    };
    pendingHydrationRef.current = null;
  }, [
    encounter?.id,
    subjective,
    objectiveNotes,
    reasoning,
    planNotes,
  ]);

  // Reads the encounter through a ref so saving doesn't change this function's identity. The
  // scribe auto-apply effects take the handlers built on `save` as dependencies, so a new `save`
  // after every PATCH would re-fire them against their own writes.
  const save = useCallback(
    async (
      patch: Parameters<typeof updateEncounter>[1],
      opts?: {
        allowBlankFields?: Array<
          'subjective' | 'objectiveNotes' | 'assessmentReasoning' | 'planNotes'
        >;
      }
    ) => {
      const id = encounterRef.current?.id;
      if (!id || locked) return false;
      const allowBlank = new Set(opts?.allowBlankFields ?? []);
      const nextPatch = { ...patch };
      const dropBlank = (
        field: 'objectiveNotes' | 'assessmentReasoning' | 'planNotes',
        incoming: string | null | undefined,
        stored: string | null | undefined
      ) => {
        if (incoming === undefined) return;
        if (allowBlank.has(field)) return;
        if (soapTextIsBlank(incoming) && !soapTextIsBlank(stored)) {
          delete nextPatch[field];
        }
      };
      const stored = lastSavedRef.current?.encounterId === id
        ? lastSavedRef.current.draft
        : null;
      dropBlank(
        'objectiveNotes',
        nextPatch.objectiveNotes,
        stored?.objectiveNotes ?? encounterRef.current?.objectiveNotes
      );
      dropBlank(
        'assessmentReasoning',
        nextPatch.assessmentReasoning,
        stored?.reasoning ?? encounterRef.current?.assessmentReasoning
      );
      dropBlank(
        'planNotes',
        nextPatch.planNotes,
        stored?.planNotes ?? encounterRef.current?.planNotes
      );
      if (nextPatch.subjective != null && !allowBlank.has('subjective')) {
        const incomingHist =
          typeof nextPatch.subjective.history === 'string' ? nextPatch.subjective.history : '';
        const storedHist = stored?.subjective ??
          (typeof encounterRef.current?.subjective?.history === 'string'
            ? encounterRef.current.subjective.history
            : '');
        if (soapTextIsBlank(incomingHist) && !soapTextIsBlank(storedHist)) {
          delete nextPatch.subjective;
        }
      }
      if (Object.keys(nextPatch).length === 0) return true;
      try {
        const updated = await updateEncounter(id, nextPatch, {
          expectedUpdatedAt: encounterRef.current?.updated ?? null,
          allowBlankFields: opts?.allowBlankFields,
        });
        setEncounter(updated);
        if (lastSavedRef.current?.encounterId === id) {
          const next = { ...lastSavedRef.current.draft, at: updated.updated };
          if (nextPatch.subjective !== undefined) {
            next.subjective = subjectiveRef.current;
            next.emailSubject = emailDraftRef.current.subject;
            next.emailBody = emailDraftRef.current.body;
          }
          if (nextPatch.objectiveVitals !== undefined) next.vitals = vitalsRef.current;
          if (nextPatch.objectiveExam !== undefined) next.exam = examRef.current;
          if (nextPatch.objectiveNotes !== undefined) next.objectiveNotes = objectiveNotesRef.current;
          if (nextPatch.assessmentReasoning !== undefined) next.reasoning = reasoningRef.current;
          if (nextPatch.planNotes !== undefined) next.planNotes = planNotesRef.current;
          if (nextPatch.assessmentProblemIds !== undefined) {
            next.linkedProblemIds = linkedProblemIdsRef.current;
          }
          lastSavedRef.current = { encounterId: id, draft: next };
        }
        return true;
      } catch (e) {
        // Somebody else wrote this same field first. Keep their version — it is the
        // one on the chart — and hand this text back so nothing is lost silently.
        const conflict = soapFieldConflictFrom(e);
        if (conflict) {
          const labels = Array.from(
            new Set(conflict.conflicts.map((f) => soapFieldLabel(f) ?? f))
          );
          void applyRemoteEncounter(conflict.conflicts, null, { notify: false });
          setError(
            `${labels.join(' and ')} was edited by someone else, so your change was not saved. Their version is now on screen — re-apply your edit if it still belongs.`
          );
          return false;
        }
        setError(e instanceof Error ? e.message : 'Failed to save');
        return false;
      }
    },
    [locked, applyRemoteEncounter]
  );

  const effectiveEntryMode = scribeEnabled ? entryMode : 'manual';

  const saveSubjective = useCallback(
    async (history: string, email: { subject: string; body: string } = emailDraftRef.current) => {
      await save(
        { subjective: buildSubjectivePayload(history, email) },
        { allowBlankFields: ['subjective'] }
      );
    },
    [save]
  );

  /**
   * The chart used to save only on blur. A laptop left in the truck (or a tab
   * the OS killed) would lose whatever was still in the focused field. Flush
   * dirty fields every few seconds, when the tab hides, and when this page
   * unmounts. A local copy covers the no-signal case.
   */
  useEffect(() => {
    if (locked) {
      const id = encounterRef.current?.id;
      if (id) clearSoapChartDraft(id);
      return;
    }

    const liveDraft = () =>
      snapshotSoapDraft({
        subjective: subjectiveRef.current,
        email: emailDraftRef.current,
        objectiveNotes: objectiveNotesRef.current,
        reasoning: reasoningRef.current,
        planNotes: planNotesRef.current,
        vitals: vitalsRef.current,
        exam: examRef.current,
        linkedProblemIds: linkedProblemIdsRef.current,
      });

    const flush = () => {
      const enc = encounterRef.current;
      const saved = lastSavedRef.current;
      if (!enc || enc.status === 'completed' || !saved) return;
      if (saved.encounterId !== enc.id) return;
      if (pendingHydrationRef.current) return;
      const now = liveDraft();
      const safeNow = mergeParkedSoapDraft(now, saved.draft);
      writeSoapChartDraft(enc.id, safeNow);
      if (!soapDraftDirty(safeNow, saved.draft)) {
        clearSoapChartDraft(enc.id);
        return;
      }
      const patch = patchFromDraftDiff(safeNow, saved.draft);
      if (Object.keys(patch).length === 0) return;
      void save(patch).then((ok) => {
        if (ok) clearSoapChartDraft(enc.id);
      });
    };

    const timer = window.setInterval(flush, 8_000);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [locked, save]);

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

  const applyScribeChart = useCallback(
    (patch: {
      subjective?: string;
      vitals?: Vitals;
      exam?: PeExamState;
      objectiveNotes?: string;
      reasoning?: string;
      planNotes?: string;
    }) => {
      const body: Parameters<typeof updateEncounter>[1] = {};
      if (patch.subjective != null) {
        setSubjective(patch.subjective);
        body.subjective = buildSubjectivePayload(patch.subjective, emailDraftRef.current);
      }
      if (patch.vitals) {
        setVitals(patch.vitals);
        body.objectiveVitals = { ...patch.vitals };
      }
      if (patch.exam) {
        setExam(patch.exam);
        body.objectiveExam = patch.exam;
      }
      if (patch.objectiveNotes != null) {
        setObjectiveNotes(patch.objectiveNotes);
        body.objectiveNotes = patch.objectiveNotes;
      }
      if (patch.reasoning != null) {
        setReasoning(patch.reasoning);
        body.assessmentReasoning = patch.reasoning;
      }
      if (patch.planNotes != null) {
        setPlanNotes(patch.planNotes);
        body.planNotes = patch.planNotes;
      }
      if (Object.keys(body).length > 0) void save(body);
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

  const clientQuery = clientIdParam ? `?clientId=${encodeURIComponent(clientIdParam)}` : '';

  /**
   * Hand off to the wrap-up, which owns forward booking, the client recap, and
   * locking the record for every pet on the visit.
   */
  const goToWrapUp = async () => {
    if (checkoutPrepPendingCount > 0) {
      const proceed = await appConfirm({
        title: 'Checkout prep still open',
        message: `You still have ${checkoutPrepPendingCount} plan item${
          checkoutPrepPendingCount === 1 ? '' : 's'
        } to match or dismiss. Continue to wrap-up anyway?`,
        confirmLabel: 'Continue anyway',
        cancelLabel: 'Go to Checkout prep',
      });
      if (!proceed) {
        setActiveTab('checkout-prep');
        return;
      }
    }
    navigate(`/schedule/soap/${appointmentId}/${patientId}/wrap-up${clientQuery}`);
  };

  const goToCheckout = async () => {
    if (checkoutPrepPendingCount > 0) {
      const proceed = await appConfirm({
        title: 'Checkout prep still open',
        message: `You still have ${checkoutPrepPendingCount} plan item${
          checkoutPrepPendingCount === 1 ? '' : 's'
        } to match or dismiss. Continue to checkout anyway?`,
        confirmLabel: 'Continue anyway',
        cancelLabel: 'Go to Checkout prep',
      });
      if (!proceed) {
        setActiveTab('checkout-prep');
        return;
      }
    }
    navigate(`/schedule/soap/${appointmentId}/${patientId}/checkout${clientQuery}`);
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

  const refreshChronicMedications = useCallback(() => {
    void listPatientPrescriptions(patientId, { activeChronicOnly: true })
      .then(setChronicMedications)
      .catch(() => undefined);
  }, [patientId]);

  const onScribeOrderCreated = (order: EncounterOrder) => {
    setOrders((prev) => [...prev, order]);
  };

  // Somebody else changed an order on this visit — reload ours rather than trust local state.
  useEffect(() => {
    if (ordersRevision === 0) return;
    const id = encounterRef.current?.id;
    if (!id) return;
    let canceled = false;
    void listOrders(id)
      .then((next) => {
        if (!canceled) setOrders(next);
      })
      .catch(() => undefined);
    void refreshInvoice();
    return () => {
      canceled = true;
    };
  }, [ordersRevision, refreshInvoice]);

  const signalment = useMemo(() => {
    const sex = patientProfile ? patientSexDisplayFromRecord(patientProfile) : null;
    const age = patientAge(patientProfile, appointmentStart);
    const breed = patientBreed(patientProfile);
    const visitWeight = formatVitalWeight(vitals);
    const profileWeight = patientField(patientProfile, 'weight', 'weightLbs');
    const weight = visitWeight ?? (profileWeight ? `${profileWeight} lb` : null);
    return [age, sex, breed, weight].filter((part): part is string => Boolean(part));
  }, [appointmentStart, patientProfile, vitals]);

  if (loading && !encounter) {
    return <div className="soap-page soap-loading">Loading encounter…</div>;
  }
  if (error && !encounter) {
    return <div className="soap-page soap-error-page">{error}</div>;
  }

  return (
    <div className={`soap-page soap-page--workspace${splitDragging ? ' is-resizing' : ''}`}>
      {planToast && (
        <div className="soap-plan-toast" role="status" aria-live="polite">
          {planToast}
        </div>
      )}
      {coEditNotice && (
        <div className="soap-coedit-toast" role="status" aria-live="polite">
          {coEditNotice}
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
            {otherPeers.length > 0 && (
              <div className="soap-presence">
                {otherPeers.map((peer) => {
                  const cap = peerPresenceCaption(peer);
                  return (
                    <span
                      key={peer.socketId}
                      className={`soap-presence-chip${
                        cap.kind === 'recording'
                          ? ' is-recording'
                          : cap.kind === 'editing'
                            ? ' is-editing'
                            : ''
                      }`}
                      title={cap.title}
                    >
                      {cap.kind === 'recording' ? <Mic size={12} /> : <Users size={12} />}
                      {cap.label}
                    </span>
                  );
                })}
              </div>
            )}
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
              onClick={() => void goToWrapUp()}
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

      {showPromptOverrides && primaryProviderId != null && (
        <ScribePromptOverridesModal
          providerId={primaryProviderId}
          providerName={primaryProviderName?.trim() || `Provider #${primaryProviderId}`}
          onClose={() => setShowPromptOverrides(false)}
        />
      )}

      <div
        ref={workspaceRef}
        className="soap-body soap-workspace"
        style={{ ['--soap-chart-pct' as string]: `${chartPct}%` }}
      >
        <main className="soap-main">
          <SoapPatientChronicSummary
            patientId={patientId}
            practiceId={VISIT_WORKFLOW_PRACTICE_ID}
            encounterId={encounter?.id}
            problems={problems}
            chronicMedications={chronicMedications}
            draft={chronicDraft}
            disabled={locked}
            onDraftChange={(next) => {
              setChronicDraft(next);
              writeSoapChronicDraft(encounter?.id, next);
            }}
            onProblemSaved={(updated) =>
              setProblems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
            }
            onProblemRemoved={(id) =>
              setProblems((prev) => prev.filter((p) => p.id !== id))
            }
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
              onApplyChart={applyScribeChart}
              onProblemCreated={onScribeProblemCreated}
              onOrderCreated={onScribeOrderCreated}
              onPlanItemsChange={setScribePlanItems}
              onHouseholdOrdersChanged={() => void refreshInvoice()}
              otherRecorderName={otherRecorderName}
              onRecordingChange={(recording) => {
                visitSocketRef.current?.setRecording(recording, encounter.id);
              }}
            />
          )}

          {effectiveEntryMode === 'scribe' ? (
            <ScribeDocumentView
              disabled={locked}
              subjective={subjective}
              onSubjectiveChange={setSubjective}
              onSubjectiveBlur={(text) => {
                setSubjective(text);
                void saveSubjective(text);
              }}
              objectiveNotes={objectiveNotes}
              onObjectiveNotesChange={setObjectiveNotes}
              onObjectiveNotesBlur={(text) => {
                setObjectiveNotes(text);
                void save({ objectiveNotes: text }, { allowBlankFields: ['objectiveNotes'] });
              }}
              assessment={reasoning}
              onAssessmentChange={setReasoning}
              onAssessmentBlur={(text) => {
                setReasoning(text);
                void save(
                  { assessmentReasoning: text },
                  { allowBlankFields: ['assessmentReasoning'] }
                );
              }}
              planNotes={planNotes}
              onPlanNotesChange={setPlanNotes}
              onPlanNotesBlur={(text) => {
                setPlanNotes(text);
                void save({ planNotes: text }, { allowBlankFields: ['planNotes'] });
              }}
              objectiveNeedsAttention={!isWeightAddressed(vitals)}
              activeTab={activeTab}
              onActiveTabChange={setActiveTab}
              checkoutPrepPendingCount={checkoutPrepPendingCount}
              vitalsSlot={
                <SoapVitalsFields
                  vitals={vitals}
                  disabled={locked}
                  radioGroupName="soap-doc-weight-unit"
                  onChange={setVitals}
                  onCommit={(next) => {
                    setVitals(next);
                    void save({ objectiveVitals: { ...next } });
                  }}
                />
              }
              checkoutPrepSlot={
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
                      onPendingCountChange={setCheckoutPrepPendingCount}
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
                      showSearch={false}
                      onChange={setOrders}
                      onInvoiceShouldRefresh={() => void refreshInvoice()}
                      onInventoryItemAdded={appendInventoryToTreatmentPlan}
                      onInventoryItemRemoved={removeInventoryFromTreatmentPlan}
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
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'checkout-prep'}
                  className={`soap-tab${activeTab === 'checkout-prep' ? ' active' : ''}${
                    checkoutPrepPendingCount > 0 ? ' needs-attention' : ''
                  }`}
                  title={
                    checkoutPrepPendingCount > 0
                      ? `${checkoutPrepPendingCount} item${
                          checkoutPrepPendingCount === 1 ? '' : 's'
                        } still to match`
                      : 'Match plan items to charges — not part of the signed chart'
                  }
                  onClick={() => setActiveTab('checkout-prep')}
                >
                  <Receipt size={15} aria-hidden />
                  <span className="soap-tab-label">Checkout prep</span>
                  <span className="soap-tab-short">$</span>
                  {checkoutPrepPendingCount > 0 ? (
                    <span className="soap-tab-badge">{checkoutPrepPendingCount}</span>
                  ) : null}
                </button>
              </div>

              <div className="soap-tab-panel">
                {activeTab === 'subjective' && (
                  <section className="soap-section">
                    <h2>
                      <ClipboardList size={16} /> Subjective
                    </h2>
                    <p className="soap-section-hint">
                      Check-in stands on its own until SOAP is written, then those answers are
                      folded into this history. Facts only on the form are tagged (Pre-Exam
                      Check-In).
                    </p>
                    <textarea
                      className="soap-textarea soap-textarea--subjective"
                      rows={14}
                      placeholder="Presenting history, owner concerns…"
                      value={subjective}
                      disabled={locked}
                      data-soap-field="subjective"
                      onChange={(e) => setSubjective(e.target.value)}
                      onBlur={(e) => {
                        const text = e.target.value;
                        setSubjective(text);
                        void saveSubjective(text);
                      }}
                    />
                  </section>
                )}

                {activeTab === 'objective' && (
                  <section className="soap-section">
                    <h2>
                      <Activity size={16} /> Objective
                    </h2>
                    <SoapVitalsFields
                      vitals={vitals}
                      disabled={locked}
                      onChange={setVitals}
                      onCommit={(next) => {
                        setVitals(next);
                        void save({ objectiveVitals: { ...next } });
                      }}
                    />

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

                    <div className="soap-subhead">Notes (also shown in Document view — Bold for abnormals)</div>
                    <SoapRichTextField
                      value={objectiveNotes}
                      disabled={locked}
                      placeholder="Additional objective observations…"
                      minHeightPx={120}
                      dataField="objectiveNotes"
                      onChange={setObjectiveNotes}
                      onBlur={(text) => {
                        setObjectiveNotes(text);
                        void save({ objectiveNotes: text }, { allowBlankFields: ['objectiveNotes'] });
                      }}
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
                      data-soap-field="assessmentReasoning"
                      onChange={(e) => setReasoning(e.target.value)}
                      onBlur={(e) => {
                        const text = e.target.value;
                        setReasoning(text);
                        void save(
                          { assessmentReasoning: text },
                          { allowBlankFields: ['assessmentReasoning'] }
                        );
                      }}
                    />
                  </section>
                )}

                {activeTab === 'plan' && (
                  <section className="soap-section">
                    <h2>
                      <ClipboardList size={16} /> Plan
                    </h2>
                    <p className="soap-section-hint">
                      Treatment narrative for the chart. Match bullets to catalog charges on the
                      Checkout prep tab — that step is not part of the signed record.
                    </p>
                    <div className="soap-subhead">Notes (also shown in Document view)</div>
                    <textarea
                      className="soap-textarea"
                      rows={8}
                      placeholder="Diagnostics, treatment plan, client communication…"
                      value={planNotes}
                      disabled={locked}
                      data-soap-field="planNotes"
                      onChange={(e) => setPlanNotes(e.target.value)}
                      onBlur={(e) => {
                        const text = e.target.value;
                        setPlanNotes(text);
                        void save({ planNotes: text }, { allowBlankFields: ['planNotes'] });
                      }}
                    />
                  </section>
                )}

                {/* Always mounted so the pending badge stays accurate before the tab is opened. */}
                <section
                  className="soap-section"
                  role="tabpanel"
                  aria-label="Checkout prep"
                  hidden={activeTab !== 'checkout-prep'}
                >
                  <h2>
                    <Receipt size={16} /> Checkout prep
                  </h2>
                  <p className="soap-section-hint">
                    Optional — match today&apos;s plan to catalog charges. This step is not saved as
                    part of the medical record when you wrap up.
                  </p>
                  {encounter && (
                    <>
                      <ScribeSuggestedPlanItems
                        key={`plan-items-manual-${encounter.id}`}
                        encounterId={encounter.id}
                        suggestions={[...deferredScribePlanItems, ...scribePlanItems]}
                        planNotes={planNotes}
                        orders={orders}
                        disabled={locked}
                        patientId={patientId}
                        clientId={clientIdParam ? Number(clientIdParam) : undefined}
                        practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                        onPendingCountChange={setCheckoutPrepPendingCount}
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
                        key={`plan-orders-manual-${encounter.id}`}
                        encounterId={encounter.id}
                        orders={orders}
                        disabled={locked}
                        patientId={patientId}
                        clientId={clientIdParam ? Number(clientIdParam) : undefined}
                        practiceId={VISIT_WORKFLOW_PRACTICE_ID}
                        excludeOrderIds={roomLoaderOrderIds}
                        showSearch={false}
                        onChange={setOrders}
                        onInvoiceShouldRefresh={() => void refreshInvoice()}
                        onInventoryItemAdded={appendInventoryToTreatmentPlan}
                        onInventoryItemRemoved={removeInventoryFromTreatmentPlan}
                      />
                    </>
                  )}
                </section>
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

        <div
          className="soap-split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chart and invoice"
          aria-valuenow={Math.round(chartPct)}
          aria-valuemin={SOAP_SPLIT_MIN}
          aria-valuemax={SOAP_SPLIT_MAX}
          tabIndex={0}
          onPointerDown={onSplitPointerDown}
          onPointerMove={onSplitPointerMove}
          onPointerUp={onSplitPointerUp}
          onPointerCancel={onSplitPointerUp}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              persistChartPct(chartPct - 2);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              persistChartPct(chartPct + 2);
            }
          }}
        />

        <aside className="soap-aside">
          <EuthanasiaConsentPanel
            appointmentId={appointmentId}
            patientId={patientId}
            clientId={
              encounter?.clientId ??
              (clientIdParam ? Number(clientIdParam) : undefined)
            }
            encounterId={encounter?.id}
            onAddedToPlan={() => {
              if (encounter?.id) {
                void listOrders(encounter.id).then(setOrders).catch(() => undefined);
              }
              void refreshInvoice();
            }}
          />
          <VisitCheckoutPanel
            encounterId={encounter?.id}
            invoice={invoice}
            orders={orders}
            disabled={locked}
            clinicalRefreshSignal={clinicalRefreshTick}
            remoteRefreshSignal={ordersRevision}
            clientId={
              encounter?.clientId ??
              (clientIdParam ? Number(clientIdParam) : null)
            }
            patientId={patientId}
            roster={roster}
            practiceId={VISIT_WORKFLOW_PRACTICE_ID}
            onClinicalRecorded={() => setClinicalRefreshTick((t) => t + 1)}
            onChronicMedicationsMaybeChanged={refreshChronicMedications}
            rxLabel={{
              patientId,
              patientName,
              species: patientField(patientProfile, 'species'),
              ownerName: clientName,
              veterinarianName: primaryProviderName,
              veterinarianLicense: primaryProviderLicense,
              veterinarianEmployeeId: primaryProviderId,
            }}
            onInvoiceChange={setInvoice}
            onOrdersChange={(next) => {
              setOrders(next);
              void refreshInvoice();
            }}
            onInvoiceShouldRefresh={() => void refreshInvoice()}
            onInventoryItemAdded={appendInventoryToTreatmentPlan}
            onInventoryItemRemoved={removeInventoryFromTreatmentPlan}
            onOpenEuthanasiaPrepay={() => setShowEuthanasia(true)}
            onRoomLoaderOrderIds={rememberRoomLoaderOrderIds}
            focusOrderId={focusOrderId}
            onOrderRemoved={(orderId) => {
              const removed = orders.find((o) => o.id === orderId);
              setOrders((prev) => prev.filter((o) => o.id !== orderId));
              void refreshInvoice();
              if (removed?.catalogItemType === 'inventory') {
                removeInventoryFromTreatmentPlan(removed.name);
              }
            }}
            // Payment and forward booking happen on the checkout screen, where the
            // household pays once for every pet on the visit.
            showPayment={false}
            onCheckout={() => void goToCheckout()}
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
