import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardPaste,
  Mic,
  Square,
  Sparkles,
  Check,
  X as XIcon,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
  Users,
} from 'lucide-react';
import {
  clearScribeTranscript,
  createScribeSocket,
  listScribeSessions,
  structureTranscript,
  type MultiPatientSuggestionEntry,
  type MultiPatientScribeSuggestion,
  type ScribeSocketHandle,
  type ScribeSocketStatus,
  type ScribeSuggestion,
} from '../../api/soapScribe';
import { startScribeAudioCapture, type ScribeAudioCapture } from '../../utils/scribeAudioCapture';
import {
  createProblem,
  getEncounter,
  getHouseholdRoster,
  listOrders,
  listProblems,
  updateEncounter,
  type EncounterOrder,
  type HouseholdRosterEntry,
  type PatientProblem,
  type PatientProblemAcuity,
  type PatientProblemKind,
  type SoapEncounter,
} from '../../api/visitWorkflow';
import { PE_SYSTEMS, peExamFromValue, type PeExamState, type PeSystemFinding } from './peTemplate';
import ScribeConsentModal from './ScribeConsentModal';
import type { SuggestedPlanItem } from './ScribeSuggestedPlanItems';
import { formatSoapSectionSpacing } from '../../utils/soapSectionSpacing';
import {
  joinSubjectiveHistoryParts,
  splitSubjectiveHistoryParts,
  VISIT_DISCUSSION_HEADER,
} from '../../utils/roomLoaderSubjectiveText';
import { stashDeferredPlanItems } from '../../utils/deferredScribePlanItems';
import { vitalsFromValue, type Vitals } from '../../pages/SoapEncounterPage';
import { appConfirm } from '../../utils/appDialog';

type NumericVitalKey = 'tempF' | 'weight' | 'hr' | 'rr' | 'bcs' | 'painScore';

const VITAL_LABELS: Record<NumericVitalKey, string> = {
  tempF: 'Temp °F',
  weight: 'Weight',
  hr: 'HR (bpm)',
  rr: 'RR (rpm)',
  bcs: 'BCS /9',
  painScore: 'FAS /5',
};

type Props = {
  soapEncounterId: string;
  patientId: number;
  disabled: boolean;
  examEnabled: boolean;
  currentSubjective: string;
  currentVitals: Vitals;
  currentExam: PeExamState;
  currentObjectiveNotes: string;
  currentReasoning: string;
  currentPlanNotes: string;
  problems: PatientProblem[];
  orders: EncounterOrder[];
  onApplySubjective: (text: string) => void;
  onApplyVitals: (patch: Partial<Vitals>) => void;
  onApplyExam: (patch: Record<string, PeSystemFinding>) => void;
  onApplyObjectiveNotes: (text: string) => void;
  onApplyReasoning: (text: string) => void;
  onApplyPlanNotes: (text: string) => void;
  onProblemCreated: (problem: PatientProblem) => void;
  onOrderCreated: (order: EncounterOrder) => void;
  /** Products/services the AI heard mentioned in the plan, not yet added as real orders — feeds
   * `ScribeSuggestedPlanItems` (rendered below the Plan text box in the Document view) so the
   * doctor can match each one to a catalog item instead of it just sitting in a review card. */
  onPlanItemsChange?: (items: SuggestedPlanItem[]) => void;
  /** Fired after a multi-pet suggestion is applied to *any* pet's chart (including one that
   * isn't the currently open patient) — lets the page refresh the household checkout summary,
   * since that write happens directly against the other pet's encounter/orders with no other
   * signal back to this page. */
  onHouseholdOrdersChanged?: () => void;
};

const PE_LABEL_BY_KEY = Object.fromEntries(PE_SYSTEMS.map((s) => [s.key, s.label]));

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** True when Process / Re-load would rewrite doctor-visible narrative already on the chart. */
function chartHasRewritableContent(
  subjective: string,
  objectiveNotes: string,
  reasoning: string,
  planNotes: string
): boolean {
  if (objectiveNotes.trim() || reasoning.trim() || planNotes.trim()) return true;
  // Pre-visit check-in alone does not count — Process keeps that block. A prior "Visit discussion"
  // section means we're about to replace doctor-facing narrative.
  return subjective.includes(VISIT_DISCUSSION_HEADER);
}

/** A saved suggestion can be either shape — multi-pet runs store a per-patient breakdown. */
function isMultiPatientSuggestion(
  value: ScribeSuggestion | MultiPatientScribeSuggestion
): value is MultiPatientScribeSuggestion {
  return Array.isArray((value as MultiPatientScribeSuggestion).patients);
}

// Dismissed review cards are a per-chart UI preference, so they ride in sessionStorage rather
// than the encounter — otherwise restoring the last suggestion resurrects cards the doctor
// already waved off.
const DISMISSED_KEY_PREFIX = 'soap-scribe-dismissed:';

function readDismissedKeys(soapEncounterId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(`${DISMISSED_KEY_PREFIX}${soapEncounterId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    );
  } catch {
    return new Set();
  }
}

function writeDismissedKeys(soapEncounterId: string, keys: Set<string>): void {
  try {
    sessionStorage.setItem(`${DISMISSED_KEY_PREFIX}${soapEncounterId}`, JSON.stringify([...keys]));
  } catch {
    /* private mode / quota — dismissals just won't survive a reload */
  }
}

const OVERWRITE_CONFIRM =
  'You are about to overwrite your current SOAP work.\n\n' +
  'Re-load rewrites Subjective (visit discussion), Objective notes, Assessment, and Plan from this transcript. ' +
  'Pre-visit check-in and checkout orders stay. Vitals and exam findings you already entered are kept.\n\n' +
  'Proceed?';

const DELETE_TRANSCRIPT_CONFIRM =
  'Delete the saved transcript for this visit?\n\n' +
  'The SOAP notes you already have are kept, but the transcript text is gone and cannot be used to re-load the SOAP.\n\n' +
  'Proceed?';

/** Turn structured plan-item suggestions into matcher rows (never create $0 orders). */
function toSuggestedPlanItems(
  planItems: MultiPatientSuggestionEntry['planItems'],
  existingOrders: EncounterOrder[]
): SuggestedPlanItem[] {
  const existingNames = new Set(existingOrders.map((o) => norm(o.name)));
  return planItems
    .filter((p) => p.name?.trim() && !existingNames.has(norm(p.name)))
    .map((p) => ({
      key: `planItem:${norm(p.name)}|${p.kind}`,
      name: p.name.trim(),
      kind: p.kind,
      note: p.note ?? null,
    }));
}

/**
 * Merge AI visit-conversation history into Subjective without clobbering Room Loader /
 * pre-visit text or clinician prep notes from Jot. Process keeps those blocks and
 * replaces (or adds) the Visit discussion section. With neither block, replace Subjective
 * with the new AI history so Re-load SOAP doesn't stack duplicate visit notes.
 */
function mergeSubjectiveHistory(existing: string, aiHistory: string): string {
  const delta = formatSoapSectionSpacing(aiHistory);
  if (!delta) return formatSoapSectionSpacing(existing);
  const cur = existing.trim();
  if (!cur) return delta;
  if (cur.includes(delta) || formatSoapSectionSpacing(cur).includes(delta)) {
    return formatSoapSectionSpacing(cur);
  }
  const parts = splitSubjectiveHistoryParts(cur);
  if (!parts.checkin && !parts.clinicianPrevisit && !parts.caseSummary) return delta;
  parts.visitDiscussion = delta;
  return formatSoapSectionSpacing(joinSubjectiveHistoryParts(parts));
}

/** Only fills vitals the doctor hasn't already entered — never overwrites (mirrors the live
 * auto-apply rule above, reused for multi-pet review-and-apply). */
function fillEmptyVitals(
  current: Vitals,
  suggested: MultiPatientSuggestionEntry['vitals']
): Partial<Vitals> {
  const patch: Partial<Vitals> = {};

  // Explicit "not weighed" from the transcript — only when the chart has no weight yet.
  if (
    suggested.weightNotTaken === true &&
    !current.weight.trim() &&
    !current.weightNotTaken
  ) {
    patch.weightNotTaken = true;
    patch.weight = '';
    return patch;
  }

  (Object.keys(VITAL_LABELS) as NumericVitalKey[]).forEach((k) => {
    if (k === 'weight' && current.weightNotTaken) return;
    const suggestedVal = suggested[k]?.trim();
    const existing = current[k]?.trim();
    if (suggestedVal && !existing) {
      patch[k] = suggestedVal;
      if (k === 'weight') {
        patch.weightNotTaken = false;
        const unit = suggested.weightUnit;
        patch.weightUnit = unit === 'kg' || unit === 'lb' ? unit : current.weightUnit || 'lb';
      }
    }
  });
  return patch;
}

/** Only flags systems the doctor hasn't already touched — never overwrites. */
function abnormalOnlyExamPatch(
  current: PeExamState,
  suggested: MultiPatientSuggestionEntry['exam']
): Record<string, PeSystemFinding> {
  const patch: Record<string, PeSystemFinding> = {};
  for (const sys of PE_SYSTEMS) {
    const s = suggested[sys.key];
    const existing = current[sys.key];
    if (s?.status === 'abnormal' && !existing?.status) {
      patch[sys.key] = { status: 'abnormal', note: s.note ?? undefined };
    }
  }
  return patch;
}

/**
 * Builds the `updateEncounter` patch for a multi-pet entry applied to a patient other than
 * the one currently open. Process is a one-shot full document — set O/A/P narrative from the
 * AI result (replace), don't append, or re-runs / Strict Mode stack duplicate blocks forever.
 * Vitals/exam stay fill-empty only so doctor-entered values aren't clobbered.
 */
function buildOtherEncounterPatch(
  enc: SoapEncounter,
  suggestion: MultiPatientSuggestionEntry
): Parameters<typeof updateEncounter>[1] {
  const currentVitals = vitalsFromValue(enc.objectiveVitals);
  const currentExam = peExamFromValue(enc.objectiveExam);
  const currentSubjective =
    typeof enc.subjective?.history === 'string' ? (enc.subjective.history as string) : '';

  const patch: Parameters<typeof updateEncounter>[1] = {};

  const vitalsPatch = fillEmptyVitals(currentVitals, suggestion.vitals);
  if (Object.keys(vitalsPatch).length > 0) {
    patch.objectiveVitals = { ...currentVitals, ...vitalsPatch };
  }

  if (enc.mode === 'comprehensive') {
    const examPatch = abnormalOnlyExamPatch(currentExam, suggestion.exam);
    if (Object.keys(examPatch).length > 0) {
      patch.objectiveExam = { ...currentExam, ...examPatch };
    }
  }

  if (suggestion.subjectiveHistory?.trim()) {
    patch.subjective = {
      ...(enc.subjective ?? {}),
      history: mergeSubjectiveHistory(currentSubjective, suggestion.subjectiveHistory),
    };
  }
  if (suggestion.objectiveNotes?.trim()) {
    patch.objectiveNotes = formatSoapSectionSpacing(suggestion.objectiveNotes);
  }
  if (suggestion.assessmentReasoning?.trim()) {
    patch.assessmentReasoning = formatSoapSectionSpacing(suggestion.assessmentReasoning);
  }
  if (suggestion.planNotes?.trim()) {
    patch.planNotes = formatSoapSectionSpacing(suggestion.planNotes);
  }
  return patch;
}

export default function ScribePanel({
  soapEncounterId,
  patientId,
  disabled,
  examEnabled,
  currentSubjective,
  currentVitals,
  currentExam,
  currentObjectiveNotes,
  currentReasoning,
  currentPlanNotes,
  problems,
  orders,
  onApplySubjective,
  onApplyVitals,
  onApplyExam,
  onApplyObjectiveNotes,
  onApplyReasoning,
  onApplyPlanNotes,
  onProblemCreated,
  onOrderCreated,
  onPlanItemsChange,
  onHouseholdOrdersChanged,
}: Props) {
  const [status, setStatus] = useState<ScribeSocketStatus>('idle');
  const [showConsent, setShowConsent] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState('');
  const [suggestion, setSuggestion] = useState<ScribeSuggestion | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissedKeys(soapEncounterId));
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  /** Doctor's edits to suggested problem wording, keyed by suggestion key — this text is what
   * lands on the medical record, so it is theirs to fix before accepting. */
  const [problemLabelEdits, setProblemLabelEdits] = useState<Record<string, string>>({});
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [autoAppliedLog, setAutoAppliedLog] = useState<{ key: number; text: string }[]>([]);
  const [logOpen, setLogOpen] = useState(false);

  // Multi-pet household visits (docs/ai-scribe.md "Multi-pet visits") — only relevant for the
  // paste-transcript flow. `roster` stays empty (no UI shown) unless other patients from the same
  // household are found.
  const [roster, setRoster] = useState<HouseholdRosterEntry[]>([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState<Set<number>>(new Set([patientId]));
  const [multiSuggestion, setMultiSuggestion] = useState<MultiPatientScribeSuggestion | null>(null);
  /** Ensures each Process result is written once (not re-applied when problems/orders update). */
  const multiAppliedFingerprintRef = useRef<string | null>(null);
  /** Multi-pet plan items for the open pet — fed to the catalog matcher, not created as $0 orders. */
  const [multiPlanItemsForCurrent, setMultiPlanItemsForCurrent] = useState<SuggestedPlanItem[]>([]);

  const socketRef = useRef<ScribeSocketHandle | null>(null);
  const audioRef = useRef<ScribeAudioCapture | null>(null);
  const timerRef = useRef<number | null>(null);
  const prevSuggestionRef = useRef<ScribeSuggestion | null>(null);
  const logKeyRef = useRef(0);

  // Mirrors of the latest prop values, read (not depended on) inside the auto-apply effect below
  // so it isn't re-triggered by the very updates it makes.
  const currentSubjectiveRef = useRef(currentSubjective);
  const currentVitalsRef = useRef(currentVitals);
  const currentExamRef = useRef(currentExam);
  useEffect(() => {
    currentSubjectiveRef.current = currentSubjective;
  }, [currentSubjective]);
  useEffect(() => {
    currentVitalsRef.current = currentVitals;
  }, [currentVitals]);
  useEffect(() => {
    currentExamRef.current = currentExam;
  }, [currentExam]);

  const logApplied = useCallback((text: string) => {
    logKeyRef.current += 1;
    setAutoAppliedLog((prev) => [{ key: logKeyRef.current, text }, ...prev].slice(0, 12));
  }, []);

  const recording = status === 'recording';
  const busy = status === 'connecting' || status === 'stopping';

  const teardown = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    audioRef.current?.stop();
    audioRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);
  useEffect(() => {
    return () => {
      socketRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    getHouseholdRoster(soapEncounterId)
      .then((entries) => {
        if (canceled) return;
        setRoster(entries);
        // Default: every household pet on this visit is included in Process — otherwise only
        // the open chart gets SOAP text and siblings look "empty" after a multi-pet visit.
        if (entries.length > 0) {
          setSelectedPatientIds(new Set(entries.map((e) => Number(e.patientId))));
        } else {
          setSelectedPatientIds(new Set([Number(patientId)]));
        }
      })
      .catch(() => {
        /* Multi-pet detection is best-effort — falls back to single-patient paste. */
        setSelectedPatientIds(new Set([Number(patientId)]));
      });
    return () => {
      canceled = true;
    };
  }, [soapEncounterId, patientId]);

  // Restore the last scribe run when returning to this chart: the transcript, plus the review
  // cards (problems / plan items) that are otherwise lost with in-memory state. Sessions are
  // audit-only — nothing here is part of the printed medical record.
  useEffect(() => {
    let canceled = false;
    listScribeSessions(soapEncounterId)
      .then((sessions) => {
        if (canceled) return;
        const recent = [...sessions].sort((a, b) =>
          (b.updated || b.created || '').localeCompare(a.updated || a.created || '')
        );

        const saved = recent.find((s) => s.transcript?.trim())?.transcript?.trim() ?? '';
        if (saved) {
          setFinalTranscript((prev) => prev || saved);
          setPasteText((prev) => prev || saved);
          // Stay collapsed — View / Re-load transcript opens the editor when they need it.
        }

        const last = (recent.find((s) => s.lastSuggestion)?.lastSuggestion ?? null) as
          | ScribeSuggestion
          | MultiPatientScribeSuggestion
          | null;
        if (!last) return;

        if (isMultiPatientSuggestion(last)) {
          // Multi-pet runs write each chart directly, so only the plan-item matcher needs
          // rehydrating. `multiSuggestion` stays null — setting it would re-apply the whole run.
          const entry = last.patients.find((p) => p.patientId === patientId);
          if (entry) setMultiPlanItemsForCurrent(toSuggestedPlanItems(entry.planItems, []));
          return;
        }

        // Mark this suggestion as already applied *before* storing it, so the auto-apply
        // effect treats a restore as read-only and never rewrites the doctor's edits.
        prevSuggestionRef.current = last;
        setSuggestion(last);
      })
      .catch((err) => {
        console.warn('Could not restore the last scribe run for this chart', err);
      });
    return () => {
      canceled = true;
    };
  }, [soapEncounterId, patientId]);

  // Auto-apply text/vitals/exam suggestions straight into the encounter — no per-item review.
  // Problems and Plan items still go through review cards below since accepting those creates
  // real records (a problem-list entry / a proposed order), not just a field edit.
  useEffect(() => {
    if (!suggestion) return;
    // Apply each Process result exactly once. The handlers below save to the encounter, which
    // re-creates them in the parent, so without this the effect re-fires on its own writes.
    if (prevSuggestionRef.current === suggestion) return;
    prevSuggestionRef.current = suggestion;

    const vitalsPatch: Partial<Vitals> = {};
    const current = currentVitalsRef.current;
    if (
      suggestion.vitals.weightNotTaken === true &&
      !current.weight.trim() &&
      !current.weightNotTaken
    ) {
      vitalsPatch.weightNotTaken = true;
      vitalsPatch.weight = '';
    } else {
      (Object.keys(VITAL_LABELS) as NumericVitalKey[]).forEach((k) => {
        if (k === 'weight' && current.weightNotTaken) return;
        const suggested = suggestion.vitals[k]?.trim();
        const existing = current[k]?.trim();
        if (suggested && !existing) {
          vitalsPatch[k] = suggested;
          if (k === 'weight') {
            vitalsPatch.weightNotTaken = false;
            const unit = suggestion.vitals.weightUnit;
            vitalsPatch.weightUnit =
              unit === 'kg' || unit === 'lb' ? unit : current.weightUnit || 'lb';
          }
        }
      });
    }
    if (Object.keys(vitalsPatch).length > 0) {
      onApplyVitals(vitalsPatch);
      logApplied(
        vitalsPatch.weightNotTaken
          ? 'Vitals filled in: No weight taken'
          : `Vitals filled in: ${Object.entries(vitalsPatch)
              .filter(([k]) => k in VITAL_LABELS)
              .map(([k, v]) => {
                if (k === 'weight' && vitalsPatch.weightUnit) {
                  return `${VITAL_LABELS.weight} ${v} ${vitalsPatch.weightUnit}`;
                }
                return `${VITAL_LABELS[k as NumericVitalKey]} ${v}`;
              })
              .join(', ')}`
      );
    }

    if (examEnabled) {
      const examPatch: Record<string, PeSystemFinding> = {};
      for (const sys of PE_SYSTEMS) {
        const suggested = suggestion.exam[sys.key];
        const existing = currentExamRef.current[sys.key];
        if (suggested?.status === 'abnormal' && !existing?.status) {
          examPatch[sys.key] = { status: 'abnormal', note: suggested.note ?? undefined };
        }
      }
      if (Object.keys(examPatch).length > 0) {
        onApplyExam(examPatch);
        logApplied(
          `Exam marked abnormal: ${Object.keys(examPatch)
            .map((k) => PE_LABEL_BY_KEY[k] ?? k)
            .join(', ')}`
        );
      }
    }

    const subjectiveDelta = suggestion.subjectiveHistory?.trim()
      ? suggestion.subjectiveHistory
      : null;
    if (subjectiveDelta) {
      onApplySubjective(mergeSubjectiveHistory(currentSubjectiveRef.current, subjectiveDelta));
      logApplied('Subjective updated');
    }

    if (suggestion.assessmentReasoning?.trim()) {
      onApplyReasoning(formatSoapSectionSpacing(suggestion.assessmentReasoning));
      logApplied('Assessment updated');
    }

    // One-shot Process: replace O/A/P (do not append) so Re-load SOAP doesn't stack duplicates.
    if (suggestion.narrativeObjective?.trim()) {
      onApplyObjectiveNotes(formatSoapSectionSpacing(suggestion.narrativeObjective));
      logApplied('Objective notes updated');
    }

    if (suggestion.narrativePlan?.trim()) {
      onApplyPlanNotes(formatSoapSectionSpacing(suggestion.narrativePlan));
      logApplied('Plan notes updated');
    }
  }, [
    suggestion,
    examEnabled,
    onApplyVitals,
    onApplyExam,
    onApplyObjectiveNotes,
    onApplySubjective,
    onApplyReasoning,
    onApplyPlanNotes,
    logApplied,
  ]);

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    setInterimText('');
    // Keep pasteText / prior transcript so a second take appends on stop ("continue from where
    // you left off"). Only clear the live capture buffer for this segment.
    setFinalTranscript('');
    setSuggestion(null);
    setDismissed(new Set());
    writeDismissedKeys(soapEncounterId, new Set());
    setProblemLabelEdits({});
    setAutoAppliedLog([]);
    prevSuggestionRef.current = null;

    const socket = createScribeSocket({
      onStatusChange: setStatus,
      onTranscript: (evt) => {
        if (evt.isFinal) {
          setFinalTranscript((prev) => `${prev} ${evt.text}`.trim());
          setInterimText('');
        } else {
          setInterimText(evt.text);
        }
      },
      onError: (message) => setErrorMessage(message),
    });
    socketRef.current = socket;

    try {
      await socket.start(soapEncounterId);
      const audio = await startScribeAudioCapture({
        onChunk: (b64) => socket.sendAudio(b64),
        onError: (err) => setErrorMessage(err instanceof Error ? err.message : 'Microphone error'),
      });
      audioRef.current = audio;
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not start the scribe.');
      teardown();
      socket.dispose();
      socketRef.current = null;
      setStatus('error');
    }
  }, [soapEncounterId, teardown]);

  /**
   * Recording only ever captures a transcript — it never structures/applies anything on its
   * own. Stopping hands the transcript off to the exact same review-and-process step as "Paste
   * transcript" (roster checkboxes + an editable textarea + a "Process" button), so recording is
   * just one more way to get text in, not a separate auto-apply path. Appends to (rather than
   * overwrites) any text already staged there — a doctor can record a second segment before
   * processing the first, and nothing gets silently dropped.
   */
  const stopRecording = useCallback(async () => {
    teardown();
    const socket = socketRef.current;
    let transcript = finalTranscript;
    if (socket) {
      const serverTranscript = await socket.stop();
      if (serverTranscript.trim()) transcript = serverTranscript;
      socket.dispose();
      socketRef.current = null;
    }
    setInterimText('');
    const text = transcript.trim();
    if (text) {
      setFinalTranscript(text);
      setPasteText((prev) => {
        const prevTrimmed = prev.trim();
        // Prefer the just-recorded segment alone when paste was empty; otherwise append.
        return prevTrimmed ? `${prevTrimmed}\n\n${text}` : text;
      });
      setPasteOpen(true);
      setTranscriptOpen(false);
    } else {
      setFinalTranscript('');
    }
  }, [teardown, finalTranscript]);

  const onRecordClick = () => {
    if (recording) {
      void stopRecording();
    } else {
      setShowConsent(true);
    }
  };

  // Multi-pet mode kicks in whenever the doctor has checked anyone besides just the current
  // patient (the current patient's own checkbox can't be unchecked — see the roster UI below) —
  // this keeps the plain single-pet path byte-for-byte unchanged when there's nothing to select.
  const multiPetSelected = selectedPatientIds.size > 1;

  const processPastedTranscript = useCallback(async () => {
    const text = pasteText.trim();
    if (!text) return;

    const willOverwrite = chartHasRewritableContent(
      currentSubjective,
      currentObjectiveNotes,
      currentReasoning,
      currentPlanNotes
    );
    if (
      willOverwrite &&
      !(await appConfirm({
        title: 'Overwrite SOAP work?',
        message: OVERWRITE_CONFIRM,
        confirmLabel: 'Overwrite',
        danger: true,
      }))
    ) {
      return;
    }

    setPasteBusy(true);
    setErrorMessage(null);
    try {
      if (multiPetSelected) {
        const selectedRoster = roster.filter((r) => selectedPatientIds.has(r.patientId));
        const result = await structureTranscript(
          soapEncounterId,
          text,
          selectedRoster.map((r) => ({
            patientId: r.patientId,
            name: r.patientName,
            species: r.species,
            soapEncounterId: r.soapEncounterId,
          }))
        );
        setFinalTranscript(text);
        setInterimText('');
        multiAppliedFingerprintRef.current = null;
        setMultiPlanItemsForCurrent([]);
        setMultiSuggestion(result as MultiPatientScribeSuggestion);
        setPasteOpen(false);
        setPasteText(text);
        setTranscriptOpen(false);
      } else {
        const result = await structureTranscript(soapEncounterId, text);
        setFinalTranscript(text);
        setInterimText('');
        prevSuggestionRef.current = null;
        setSuggestion(result as ScribeSuggestion);
        setDismissed(new Set());
        writeDismissedKeys(soapEncounterId, new Set());
        setProblemLabelEdits({});
        setPasteOpen(false);
        setPasteText(text);
        setTranscriptOpen(false);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not process the pasted transcript.'
      );
    } finally {
      setPasteBusy(false);
    }
  }, [
    multiPetSelected,
    pasteText,
    roster,
    selectedPatientIds,
    soapEncounterId,
    currentSubjective,
    currentObjectiveNotes,
    currentReasoning,
    currentPlanNotes,
  ]);

  /**
   * Deletes the saved transcript for this visit. Needs its own path because "Re-load SOAP"
   * only ever saves non-empty text — clearing the box alone left the stored copy behind,
   * which then came back on the next visit to this chart.
   */
  const deleteTranscript = useCallback(async () => {
    if (
      !(await appConfirm({
        title: 'Delete transcript?',
        message: DELETE_TRANSCRIPT_CONFIRM,
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return;
    }
    setPasteBusy(true);
    setErrorMessage(null);
    try {
      await clearScribeTranscript(soapEncounterId);
      setFinalTranscript('');
      setInterimText('');
      setPasteText('');
      setTranscriptOpen(false);
      setPasteOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not delete the transcript.');
    } finally {
      setPasteBusy(false);
    }
  }, [soapEncounterId]);

  const togglePatientSelected = (id: number) => {
    if (id === patientId) return; // current patient always included
    setSelectedPatientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyMultiPatientEntry = useCallback(
    async (entry: HouseholdRosterEntry, sugg: MultiPatientSuggestionEntry) => {
      setErrorMessage(null);
      try {
        if (entry.isCurrent) {
          const vitalsPatch = fillEmptyVitals(currentVitalsRef.current, sugg.vitals);
          if (Object.keys(vitalsPatch).length > 0) onApplyVitals(vitalsPatch);
          if (examEnabled) {
            const examPatch = abnormalOnlyExamPatch(currentExamRef.current, sugg.exam);
            if (Object.keys(examPatch).length > 0) onApplyExam(examPatch);
          }
          if (sugg.subjectiveHistory?.trim()) {
            onApplySubjective(
              mergeSubjectiveHistory(currentSubjectiveRef.current, sugg.subjectiveHistory)
            );
          }
          // One-shot Process: replace O/A/P (do not append) — avoids duplicate blocks on re-run.
          if (sugg.objectiveNotes?.trim()) {
            onApplyObjectiveNotes(formatSoapSectionSpacing(sugg.objectiveNotes));
          }
          if (sugg.assessmentReasoning?.trim()) {
            onApplyReasoning(formatSoapSectionSpacing(sugg.assessmentReasoning));
          }
          if (sugg.planNotes?.trim()) {
            onApplyPlanNotes(formatSoapSectionSpacing(sugg.planNotes));
          }

          const existingLabels = new Set(problems.map((p) => norm(p.label)));
          const newProblems = sugg.problems.filter(
            (p) => p.label?.trim() && !existingLabels.has(norm(p.label))
          );
          for (const p of newProblems) {
            const created = await createProblem({
              patientId: entry.patientId,
              label: p.label,
              kind: p.kind,
              createdInEncounterId: entry.soapEncounterId,
            });
            onProblemCreated(created);
          }
          // Plan items are only *suggestions* — they go to the catalog matcher below the Plan
          // box so they become priced orders, never straight to an unpriced $0 order line.
          setMultiPlanItemsForCurrent(toSuggestedPlanItems(sugg.planItems, orders));
        } else {
          const [enc, existingProblems, existingOrders] = await Promise.all([
            getEncounter(entry.soapEncounterId),
            listProblems(entry.patientId).catch(() => [] as PatientProblem[]),
            listOrders(entry.soapEncounterId).catch(() => [] as EncounterOrder[]),
          ]);
          const patch = buildOtherEncounterPatch(enc, sugg);
          if (Object.keys(patch).length > 0) {
            await updateEncounter(entry.soapEncounterId, patch);
          }

          const existingLabels = new Set(existingProblems.map((p) => norm(p.label)));
          const newProblems = sugg.problems.filter(
            (p) => p.label?.trim() && !existingLabels.has(norm(p.label))
          );
          await Promise.all(
            newProblems.map((p) =>
              createProblem({
                patientId: entry.patientId,
                label: p.label,
                kind: p.kind,
                createdInEncounterId: entry.soapEncounterId,
              })
            )
          );
          // This pet's chart isn't open, so its plan items wait for the matcher on that tab.
          stashDeferredPlanItems(
            entry.soapEncounterId,
            toSuggestedPlanItems(sugg.planItems, existingOrders)
          );
        }
        onHouseholdOrdersChanged?.();
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : `Could not apply to ${entry.patientName}'s chart.`
        );
      }
    },
    [
      examEnabled,
      onApplyExam,
      onApplyObjectiveNotes,
      onApplyPlanNotes,
      onApplyReasoning,
      onApplySubjective,
      onApplyVitals,
      onHouseholdOrdersChanged,
      onOrderCreated,
      onProblemCreated,
      orders,
      problems,
    ]
  );

  /** Bumps when a new multi-pet Process result arrives — ignore stale in-flight applies. */
  const multiApplyGenRef = useRef(0);

  // Multi-pet: write into every selected pet's SOAP once per Process result.
  // Do NOT abort the in-flight apply on effect cleanup (React Strict Mode) — that left sibling
  // pets with empty O/A/P when the loop was canceled mid-household.
  const applyMultiRef = useRef(applyMultiPatientEntry);
  applyMultiRef.current = applyMultiPatientEntry;
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  useEffect(() => {
    if (!multiSuggestion) return;
    const suggestion = multiSuggestion;
    const fingerprint = suggestion.patients
      .map(
        (p) =>
          `${Number(p.patientId)}:${(p.objectiveNotes ?? '').length}:${(p.planNotes ?? '').length}:${(p.assessmentReasoning ?? '').length}:${(p.subjectiveHistory ?? '').length}`
      )
      .join('|');
    if (multiAppliedFingerprintRef.current === fingerprint) {
      setMultiSuggestion(null);
      return;
    }

    const gen = ++multiApplyGenRef.current;
    (async () => {
      const rosterById = new Map(
        rosterRef.current.map((r) => [Number(r.patientId), r] as const)
      );
      let applied = 0;
      let missing = 0;
      for (const p of suggestion.patients) {
        if (gen !== multiApplyGenRef.current) return;
        const entry = rosterById.get(Number(p.patientId));
        if (!entry) {
          missing += 1;
          console.warn(
            `[scribe] multi-pet apply: no roster entry for patientId=${p.patientId}`
          );
          continue;
        }
        await applyMultiRef.current(entry, { ...p, patientId: Number(p.patientId) });
        applied += 1;
      }
      if (gen !== multiApplyGenRef.current) return;
      multiAppliedFingerprintRef.current = fingerprint;
      logApplied(
        `Multi-pet SOAP written for ${applied} pet${applied === 1 ? '' : 's'}${
          missing ? ` (${missing} unmatched id${missing === 1 ? '' : 's'})` : ''
        }`
      );
      setMultiSuggestion(null);
    })().catch((err) => {
      if (gen === multiApplyGenRef.current) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not auto-apply multi-pet SOAP.'
        );
      }
    });
    // intentionally only multiSuggestion — see comment above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiSuggestion]);

  // --- Diff suggestion vs. current SOAP state ---
  // Subjective/vitals/exam/assessment are auto-applied above (no review needed). Problems and
  // Plan items still need a review click since accepting them creates real records.

  const problemDiffs = useMemo(() => {
    if (!suggestion) return [];
    const existingLabels = new Set(problems.map((p) => norm(p.label)));
    return suggestion.problems
      .filter((p) => p.label?.trim() && !existingLabels.has(norm(p.label)))
      .map((p) => ({ key: `problem:${norm(p.label)}|${p.kind}`, ...p }))
      .filter((p) => !dismissed.has(p.key));
  }, [suggestion, problems, dismissed]);

  const planDiffs = useMemo(() => {
    const existingNames = new Set(orders.map((o) => norm(o.name)));
    const fromSingle = suggestion
      ? suggestion.planItems
          .filter((p) => p.name?.trim() && !existingNames.has(norm(p.name)))
          .map((p) => ({
            key: `planItem:${norm(p.name)}|${p.kind}`,
            name: p.name,
            kind: p.kind,
            note: p.note ?? null,
          }))
      : [];
    const fromMulti = multiPlanItemsForCurrent.filter(
      (p) => p.name?.trim() && !existingNames.has(norm(p.name))
    );
    const seen = new Set(fromSingle.map((p) => norm(p.name)));
    const merged = [...fromSingle];
    for (const p of fromMulti) {
      if (seen.has(norm(p.name))) continue;
      seen.add(norm(p.name));
      merged.push(p);
    }
    return merged;
  }, [suggestion, orders, multiPlanItemsForCurrent]);

  // Plan items get their own dedicated section (with per-item catalog search) below the Plan text
  // box in the Document view, rather than a plain review card here — see ScribeSuggestedPlanItems.
  useEffect(() => {
    onPlanItemsChange?.(planDiffs);
  }, [planDiffs, onPlanItemsChange]);

  const dismiss = (key: string) =>
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      writeDismissedKeys(soapEncounterId, next);
      return next;
    });

  const suggestionCount = problemDiffs.length;

  const runApply = async (key: string, fn: () => void | Promise<void>) => {
    setApplyingKey(key);
    try {
      await fn();
      dismiss(key);
    } finally {
      setApplyingKey(null);
    }
  };

  /** Accept a suggested problem onto the Master Problem List with the doctor's wording and acuity. */
  const addProblem = (
    p: { key: string; label: string; kind: PatientProblemKind },
    acuity: PatientProblemAcuity
  ) => {
    const label = (problemLabelEdits[p.key] ?? p.label).trim();
    if (!label) return;
    return runApply(p.key, async () => {
      const created = await createProblem({
        patientId,
        label,
        kind: p.kind,
        acuity,
        createdInEncounterId: soapEncounterId,
      });
      onProblemCreated(created);
    });
  };

  if (disabled) return null;

  const hasPriorTranscript = Boolean(pasteText.trim() || finalTranscript.trim());

  return (
    <div className="soap-scribe-panel">
      <div className="soap-scribe-bar">
        <button
          type="button"
          className={`soap-scribe-record-btn${recording ? ' recording' : ''}`}
          onClick={onRecordClick}
          disabled={busy || pasteBusy}
        >
          {recording ? <Square size={14} /> : <Mic size={14} />}
          {recording
            ? `Stop · ${formatElapsed(elapsed)}`
            : busy
              ? 'Working…'
              : hasPriorTranscript
                ? 'Continue AI scribe'
                : 'Start AI scribe'}
        </button>
        {recording && <span className="soap-scribe-live-dot" aria-hidden />}
        {!recording && (
          <button
            type="button"
            className={`soap-scribe-paste-toggle${pasteOpen ? ' active' : ''}`}
            onClick={() => {
              setPasteOpen((open) => {
                const next = !open;
                if (next) {
                  if (!pasteText.trim() && finalTranscript.trim()) {
                    setPasteText(finalTranscript);
                  }
                  setTranscriptOpen(false);
                }
                return next;
              });
            }}
            disabled={busy || pasteBusy}
          >
            <ClipboardPaste size={13} />{' '}
            {finalTranscript.trim() ? 'View / Re-load transcript' : 'Paste transcript'}
          </button>
        )}
        {suggestionCount > 0 && (
          <span className="soap-scribe-badge">
            <Sparkles size={12} /> {suggestionCount} suggestion{suggestionCount === 1 ? '' : 's'}
          </span>
        )}
        {autoAppliedLog.length > 0 && (
          <button
            type="button"
            className="soap-scribe-transcript-toggle"
            onClick={() => setLogOpen((v) => !v)}
          >
            <Check size={12} /> Auto-applied ({autoAppliedLog.length}){' '}
            {logOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
        {(finalTranscript || interimText) && (
          <button
            type="button"
            className="soap-scribe-transcript-toggle"
            onClick={() => setTranscriptOpen((v) => !v)}
          >
            Transcript {transcriptOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      {errorMessage && (
        <div className="soap-scribe-error">
          <AlertTriangle size={13} /> {errorMessage}
        </div>
      )}

      {pasteOpen && !recording && (
        <div className="soap-scribe-paste">
          <p className="soap-scribe-paste-hint">
            {finalTranscript.trim()
              ? 'Edit or replace the transcript, then Re-load SOAP to rewrite S/O/A/P from it. This overwrites the current narrative (you’ll be asked to confirm). Pre-visit check-in stays; checkout orders are left alone. Not part of the printed medical record.'
              : 'Review the transcript below (fix anything the mic misheard), confirm which pet(s) it covers, then Process — nothing is applied until you do. The transcript is saved with the visit but is not part of the printed medical record.'}
          </p>
          {roster.length > 1 && (
            <div className="soap-scribe-roster">
              <div className="soap-scribe-roster-head">
                <Users size={13} /> Which pets are covered in this transcript?
              </div>
              <div className="soap-scribe-roster-list">
                {roster.map((r) => (
                  <label key={r.patientId} className="soap-scribe-roster-item">
                    <input
                      type="checkbox"
                      checked={selectedPatientIds.has(r.patientId)}
                      disabled={r.isCurrent || pasteBusy}
                      onChange={() => togglePatientSelected(r.patientId)}
                    />
                    {r.patientName}
                    {r.isCurrent ? ' (this chart)' : ''}
                  </label>
                ))}
              </div>
              {multiPetSelected && (
                <p className="soap-scribe-roster-hint">
                  All listed pets are included by default. Uncheck any that aren&apos;t in this
                  transcript — Process writes into each checked chart&apos;s SOAP fields.
                </p>
              )}
            </div>
          )}
          <textarea
            className="soap-scribe-paste-textarea"
            placeholder="Paste a visit transcript here, or use Start AI scribe to record and transcribe it…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={pasteBusy}
            rows={8}
          />
          <div className="soap-scribe-paste-actions">
            <button
              type="button"
              className="soap-btn small primary"
              disabled={pasteBusy || !pasteText.trim()}
              onClick={() => void processPastedTranscript()}
            >
              {pasteBusy ? 'Processing…' : finalTranscript.trim() ? 'Re-load SOAP' : 'Process'}
            </button>
            <button
              type="button"
              className="soap-btn small ghost"
              disabled={pasteBusy}
              onClick={() => {
                setPasteOpen(false);
                setPasteText('');
              }}
            >
              Cancel
            </button>
            {finalTranscript.trim() && (
              <button
                type="button"
                className="soap-btn small danger soap-scribe-delete-transcript"
                disabled={pasteBusy}
                onClick={() => void deleteTranscript()}
              >
                <Trash2 size={13} /> Delete transcript
              </button>
            )}
          </div>
        </div>
      )}

      {transcriptOpen && (finalTranscript || interimText) && (
        <div className="soap-scribe-transcript">
          <p className="soap-scribe-transcript-meta">
            Saved with this visit for reference — not included on the printed medical record. Use
            View / Re-load transcript to rewrite the SOAP from this text.
          </p>
          {finalTranscript} <span className="soap-scribe-interim">{interimText}</span>
        </div>
      )}

      {logOpen && autoAppliedLog.length > 0 && (
        <div className="soap-scribe-autolog">
          <p className="soap-scribe-autolog-hint">
            Written straight into Subjective/Vitals/Exam/Assessment/Objective/Plan from the
            transcript. Re-load SOAP replaces those narrative fields (pre-visit check-in is kept);
            existing vitals/exam entries are never overwritten.
          </p>
          <ul>
            {autoAppliedLog.map((entry) => (
              <li key={entry.key}>
                <Check size={12} /> {entry.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestionCount > 0 && (
        <div className="soap-scribe-problems">
          <div className="soap-scribe-suggestions">
            {problemDiffs.map((p) => (
              <div className="soap-scribe-card" key={p.key}>
                <div className="soap-scribe-card-head">Problem list</div>
                <label className="soap-scribe-problem-label">
                  <span className="soap-scribe-problem-label-text">
                    Problem <span className="soap-scribe-tag">{p.kind.replace(/_/g, ' ')}</span>
                  </span>
                  <input
                    type="text"
                    value={problemLabelEdits[p.key] ?? p.label}
                    disabled={applyingKey === p.key}
                    onChange={(e) =>
                      setProblemLabelEdits((prev) => ({ ...prev, [p.key]: e.target.value }))
                    }
                  />
                </label>
                <div className="soap-scribe-card-actions">
                  <button
                    type="button"
                    className="soap-btn small primary"
                    disabled={
                      applyingKey === p.key || !(problemLabelEdits[p.key] ?? p.label).trim()
                    }
                    onClick={() => void addProblem(p, 'acute')}
                  >
                    <Check size={12} /> Acute
                  </button>
                  <button
                    type="button"
                    className="soap-btn small primary"
                    disabled={
                      applyingKey === p.key || !(problemLabelEdits[p.key] ?? p.label).trim()
                    }
                    onClick={() => void addProblem(p, 'chronic')}
                  >
                    <Check size={12} /> Chronic
                  </button>
                  <button
                    type="button"
                    className="soap-btn small ghost"
                    onClick={() => dismiss(p.key)}
                  >
                    <XIcon size={12} /> Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showConsent && (
        <ScribeConsentModal
          onClose={() => setShowConsent(false)}
          onConfirm={() => {
            setShowConsent(false);
            void startRecording();
          }}
        />
      )}
    </div>
  );
}
