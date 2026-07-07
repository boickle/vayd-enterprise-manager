import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic,
  Square,
  Sparkles,
  Check,
  X as XIcon,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Users,
  ExternalLink,
} from 'lucide-react';
import {
  createScribeSocket,
  structureTranscript,
  type MultiPatientSuggestionEntry,
  type MultiPatientScribeSuggestion,
  type ScribeSocketHandle,
  type ScribeSocketStatus,
  type ScribeSuggestion,
} from '../../api/soapScribe';
import { startScribeAudioCapture, type ScribeAudioCapture } from '../../utils/scribeAudioCapture';
import {
  createOrder,
  createProblem,
  getEncounter,
  getHouseholdRoster,
  listOrders,
  listProblems,
  updateEncounter,
  type EncounterOrder,
  type HouseholdRosterEntry,
  type PatientProblem,
  type SoapEncounter,
} from '../../api/visitWorkflow';
import { PE_SYSTEMS, peExamFromValue, type PeExamState, type PeSystemFinding } from './peTemplate';
import ScribeConsentModal from './ScribeConsentModal';
import type { SuggestedPlanItem } from './ScribeSuggestedPlanItems';
import { vitalsFromValue, type Vitals } from '../../pages/SoapEncounterPage';

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
  /** Fired whenever a suggestion carrying the freeform "Document view" email arrives. */
  onNarrativeUpdate?: (narrative: {
    emailSubject: string | null;
    emailBody: string | null;
  }) => void;
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

const VITAL_LABELS: Record<keyof Vitals, string> = {
  tempF: 'Temp °F',
  weight: 'Weight (lb)',
  hr: 'HR (bpm)',
  rr: 'RR (rpm)',
  bcs: 'BCS /9',
  painScore: 'Pain /5',
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

/**
 * Subjective/assessment text is re-derived in full from the whole transcript on each one-shot
 * "Process" call (not an incremental patch — see ScribeStructuringService), and a doctor can
 * process more than once per encounter (e.g. record a second segment later in the visit). To
 * auto-apply without clobbering anything the doctor typed directly into the field, we diff the
 * *previous* AI text against the *new* AI text to find only what's new, then append just that
 * delta.
 */
function computeAppendDelta(
  prevAiText: string | null | undefined,
  newAiText: string | null | undefined
): string | null {
  const prev = (prevAiText ?? '').trim();
  const next = (newAiText ?? '').trim();
  if (!next || next === prev) return null;
  if (prev && next.startsWith(prev)) {
    const delta = next.slice(prev.length).trim();
    return delta || null;
  }
  // AI revised earlier text rather than just extending it — can't cleanly diff, so append
  // the whole new version rather than risk silently dropping something it noticed.
  return next;
}

function appendText(existing: string, delta: string): string {
  const trimmed = existing.trim();
  return trimmed ? `${trimmed}\n\n${delta}` : delta;
}

/** Only fills vitals the doctor hasn't already entered — never overwrites (mirrors the live
 * auto-apply rule above, reused for multi-pet review-and-apply). */
function fillEmptyVitals(
  current: Vitals,
  suggested: MultiPatientSuggestionEntry['vitals']
): Partial<Vitals> {
  const patch: Partial<Vitals> = {};
  (Object.keys(VITAL_LABELS) as (keyof Vitals)[]).forEach((k) => {
    const suggestedVal = suggested[k]?.trim();
    const existing = current[k]?.trim();
    if (suggestedVal && !existing) patch[k] = suggestedVal;
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
 * Builds the `updateEncounter` patch for a multi-pet review entry applied to a patient other than
 * the one currently open in this page (docs/ai-scribe.md "Multi-pet visits") — the current
 * patient instead goes through the existing `onApply*` props so the open page's own state (and
 * its live-recording auto-apply logic) stays the single source of truth. Fetches the *other*
 * patient's own fresh encounter state so fill-empty/append never clobbers anything already there.
 */
function buildOtherEncounterPatch(
  enc: SoapEncounter,
  suggestion: MultiPatientSuggestionEntry
): Parameters<typeof updateEncounter>[1] {
  const currentVitals = vitalsFromValue(enc.objectiveVitals);
  const currentExam = peExamFromValue(enc.objectiveExam);
  const currentSubjective =
    typeof enc.subjective?.history === 'string' ? (enc.subjective.history as string) : '';
  const currentObjectiveNotes = enc.objectiveNotes ?? '';
  const currentReasoning = enc.assessmentReasoning ?? '';
  const currentPlanNotes = enc.planNotes ?? '';

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
      history: appendText(currentSubjective, suggestion.subjectiveHistory),
    };
  }
  if (suggestion.objectiveNotes?.trim()) {
    patch.objectiveNotes = appendText(currentObjectiveNotes, suggestion.objectiveNotes);
  }
  if (suggestion.assessmentReasoning?.trim()) {
    patch.assessmentReasoning = appendText(currentReasoning, suggestion.assessmentReasoning);
  }
  if (suggestion.planNotes?.trim()) {
    patch.planNotes = appendText(currentPlanNotes, suggestion.planNotes);
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
  onNarrativeUpdate,
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
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
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
  const [multiApplyingId, setMultiApplyingId] = useState<number | null>(null);
  const [multiAppliedIds, setMultiAppliedIds] = useState<Set<number>>(new Set());

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
  const currentObjectiveNotesRef = useRef(currentObjectiveNotes);
  const currentReasoningRef = useRef(currentReasoning);
  const currentPlanNotesRef = useRef(currentPlanNotes);
  useEffect(() => {
    currentSubjectiveRef.current = currentSubjective;
  }, [currentSubjective]);
  useEffect(() => {
    currentVitalsRef.current = currentVitals;
  }, [currentVitals]);
  useEffect(() => {
    currentExamRef.current = currentExam;
  }, [currentExam]);
  useEffect(() => {
    currentObjectiveNotesRef.current = currentObjectiveNotes;
  }, [currentObjectiveNotes]);
  useEffect(() => {
    currentReasoningRef.current = currentReasoning;
  }, [currentReasoning]);
  useEffect(() => {
    currentPlanNotesRef.current = currentPlanNotes;
  }, [currentPlanNotes]);

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
        if (!canceled) setRoster(entries);
      })
      .catch(() => {
        /* Multi-pet detection is best-effort — falls back to single-patient paste. */
      });
    return () => {
      canceled = true;
    };
  }, [soapEncounterId]);

  useEffect(() => {
    if (!suggestion) return;
    if (suggestion.clientEmailSubject == null && suggestion.clientEmailBody == null) return;
    onNarrativeUpdate?.({
      emailSubject: suggestion.clientEmailSubject,
      emailBody: suggestion.clientEmailBody,
    });
  }, [suggestion, onNarrativeUpdate]);

  // Auto-apply text/vitals/exam suggestions straight into the encounter — no per-item review.
  // Problems and Plan items still go through review cards below since accepting those creates
  // real records (a problem-list entry / a proposed order), not just a field edit.
  useEffect(() => {
    if (!suggestion) return;
    const prev = prevSuggestionRef.current;

    const vitalsPatch: Partial<Vitals> = {};
    (Object.keys(VITAL_LABELS) as (keyof Vitals)[]).forEach((k) => {
      const suggested = suggestion.vitals[k]?.trim();
      const existing = currentVitalsRef.current[k]?.trim();
      if (suggested && !existing) vitalsPatch[k] = suggested;
    });
    if (Object.keys(vitalsPatch).length > 0) {
      onApplyVitals(vitalsPatch);
      logApplied(
        `Vitals filled in: ${Object.entries(vitalsPatch)
          .map(([k, v]) => `${VITAL_LABELS[k as keyof Vitals]} ${v}`)
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

    const subjectiveDelta = computeAppendDelta(
      prev?.subjectiveHistory,
      suggestion.subjectiveHistory
    );
    if (subjectiveDelta) {
      onApplySubjective(appendText(currentSubjectiveRef.current, subjectiveDelta));
      logApplied('Subjective updated');
    }

    const reasoningDelta = computeAppendDelta(
      prev?.assessmentReasoning,
      suggestion.assessmentReasoning
    );
    if (reasoningDelta) {
      onApplyReasoning(appendText(currentReasoningRef.current, reasoningDelta));
      logApplied('Assessment updated');
    }

    // Objective/Plan narrative text comes from generateNarrative(), run alongside structure()
    // on every one-shot "Process" call (see ScribeController.structure).
    const objectiveDelta = computeAppendDelta(
      prev?.narrativeObjective,
      suggestion.narrativeObjective
    );
    if (objectiveDelta) {
      onApplyObjectiveNotes(appendText(currentObjectiveNotesRef.current, objectiveDelta));
      logApplied('Objective notes updated');
    }

    const planDelta = computeAppendDelta(prev?.narrativePlan, suggestion.narrativePlan);
    if (planDelta) {
      onApplyPlanNotes(appendText(currentPlanNotesRef.current, planDelta));
      logApplied('Plan notes updated');
    }

    prevSuggestionRef.current = suggestion;
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
    setFinalTranscript('');
    setSuggestion(null);
    setDismissed(new Set());
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
    setFinalTranscript('');
    const text = transcript.trim();
    if (text) {
      setPasteText((prev) => {
        const prevTrimmed = prev.trim();
        return prevTrimmed ? `${prevTrimmed}\n\n${text}` : text;
      });
      setPasteOpen(true);
      setTranscriptOpen(false);
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
        setMultiAppliedIds(new Set());
        setMultiSuggestion(result as MultiPatientScribeSuggestion);
        setPasteOpen(false);
        setPasteText('');
        setTranscriptOpen(true);
      } else {
        const result = await structureTranscript(soapEncounterId, text);
        setFinalTranscript(text);
        setInterimText('');
        prevSuggestionRef.current = null;
        setSuggestion(result as ScribeSuggestion);
        setDismissed(new Set());
        setPasteOpen(false);
        setPasteText('');
        setTranscriptOpen(true);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not process the pasted transcript.'
      );
    } finally {
      setPasteBusy(false);
    }
  }, [multiPetSelected, pasteText, roster, selectedPatientIds, soapEncounterId]);

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
      setMultiApplyingId(entry.patientId);
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
            onApplySubjective(appendText(currentSubjectiveRef.current, sugg.subjectiveHistory));
          }
          if (sugg.objectiveNotes?.trim()) {
            onApplyObjectiveNotes(
              appendText(currentObjectiveNotesRef.current, sugg.objectiveNotes)
            );
          }
          if (sugg.assessmentReasoning?.trim()) {
            onApplyReasoning(appendText(currentReasoningRef.current, sugg.assessmentReasoning));
          }
          if (sugg.planNotes?.trim()) {
            onApplyPlanNotes(appendText(currentPlanNotesRef.current, sugg.planNotes));
          }

          const existingLabels = new Set(problems.map((p) => norm(p.label)));
          const newProblems = sugg.problems.filter(
            (p) => p.label?.trim() && !existingLabels.has(norm(p.label))
          );
          const existingNames = new Set(orders.map((o) => norm(o.name)));
          const newPlanItems = sugg.planItems.filter(
            (p) => p.name?.trim() && !existingNames.has(norm(p.name))
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
          for (const p of newPlanItems) {
            const created = await createOrder(entry.soapEncounterId, {
              name: p.name,
              kind: p.kind,
              note: p.note ?? undefined,
              state: 'proposed',
            });
            onOrderCreated(created);
          }
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
          const existingNames = new Set(existingOrders.map((o) => norm(o.name)));
          const newPlanItems = sugg.planItems.filter(
            (p) => p.name?.trim() && !existingNames.has(norm(p.name))
          );
          await Promise.all([
            ...newProblems.map((p) =>
              createProblem({
                patientId: entry.patientId,
                label: p.label,
                kind: p.kind,
                createdInEncounterId: entry.soapEncounterId,
              })
            ),
            ...newPlanItems.map((p) =>
              createOrder(entry.soapEncounterId, {
                name: p.name,
                kind: p.kind,
                note: p.note ?? undefined,
                state: 'proposed',
              })
            ),
          ]);
        }
        setMultiAppliedIds((prev) => new Set(prev).add(entry.patientId));
        onHouseholdOrdersChanged?.();
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : `Could not apply to ${entry.patientName}'s chart.`
        );
      } finally {
        setMultiApplyingId(null);
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
    if (!suggestion) return [];
    const existingNames = new Set(orders.map((o) => norm(o.name)));
    return suggestion.planItems
      .filter((p) => p.name?.trim() && !existingNames.has(norm(p.name)))
      .map((p) => ({ key: `planItem:${norm(p.name)}|${p.kind}`, ...p }));
  }, [suggestion, orders]);

  // Plan items get their own dedicated section (with per-item catalog search) below the Plan text
  // box in the Document view, rather than a plain review card here — see ScribeSuggestedPlanItems.
  useEffect(() => {
    onPlanItemsChange?.(planDiffs);
  }, [planDiffs, onPlanItemsChange]);

  const dismiss = (key: string) => setDismissed((prev) => new Set(prev).add(key));

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

  if (disabled) return null;

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
          {recording ? `Stop · ${formatElapsed(elapsed)}` : busy ? 'Working…' : 'Start AI scribe'}
        </button>
        {recording && <span className="soap-scribe-live-dot" aria-hidden />}
        {!recording && (
          <button
            type="button"
            className={`soap-scribe-paste-toggle${pasteOpen ? ' active' : ''}`}
            onClick={() => setPasteOpen((v) => !v)}
            disabled={busy || pasteBusy}
          >
            <ClipboardPaste size={13} /> Paste transcript
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
            Review the transcript below (fix anything the mic misheard), confirm which pet(s) it
            covers, then hit Process — nothing is applied until you do.
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
                  The transcript will be split per pet — you&apos;ll review each pet&apos;s findings
                  before anything is saved to their chart.
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
            rows={5}
          />
          <div className="soap-scribe-paste-actions">
            <button
              type="button"
              className="soap-btn small primary"
              disabled={pasteBusy || !pasteText.trim()}
              onClick={() => void processPastedTranscript()}
            >
              {pasteBusy ? 'Processing…' : 'Process'}
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
          </div>
        </div>
      )}

      {multiSuggestion && (
        <MultiPatientReview
          suggestion={multiSuggestion}
          roster={roster}
          appliedIds={multiAppliedIds}
          applyingId={multiApplyingId}
          onApply={applyMultiPatientEntry}
          onClose={() => setMultiSuggestion(null)}
        />
      )}

      {transcriptOpen && (finalTranscript || interimText) && (
        <div className="soap-scribe-transcript">
          {finalTranscript} <span className="soap-scribe-interim">{interimText}</span>
        </div>
      )}

      {logOpen && autoAppliedLog.length > 0 && (
        <div className="soap-scribe-autolog">
          <p className="soap-scribe-autolog-hint">
            Written straight into Subjective/Vitals/Exam/Assessment as the AI heard them — new text
            is appended, existing vitals/exam entries are never overwritten.
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
        <div className="soap-scribe-suggestions">
          {problemDiffs.map((p) => (
            <div className="soap-scribe-card" key={p.key}>
              <div className="soap-scribe-card-head">Problem list</div>
              <p>
                {p.label} <span className="soap-scribe-tag">{p.kind.replace(/_/g, ' ')}</span>
              </p>
              <div className="soap-scribe-card-actions">
                <button
                  type="button"
                  className="soap-btn small primary"
                  disabled={applyingKey === p.key}
                  onClick={() =>
                    runApply(p.key, async () => {
                      const created = await createProblem({
                        patientId,
                        label: p.label,
                        kind: p.kind,
                        createdInEncounterId: soapEncounterId,
                      });
                      onProblemCreated(created);
                    })
                  }
                >
                  <Check size={12} /> Add
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

type MultiPatientReviewProps = {
  suggestion: MultiPatientScribeSuggestion;
  roster: HouseholdRosterEntry[];
  appliedIds: Set<number>;
  applyingId: number | null;
  onApply: (
    entry: HouseholdRosterEntry,
    suggestion: MultiPatientSuggestionEntry
  ) => void | Promise<void>;
  onClose: () => void;
};

/**
 * Doctor review step for a multi-pet paste-transcript pass (docs/ai-scribe.md "Multi-pet
 * visits") — unlike the rest of ScribePanel, nothing here is auto-applied: misattributing a
 * finding to the wrong pet's chart is worse than a doctor having to click once per pet.
 */
function MultiPatientReview({
  suggestion,
  roster,
  appliedIds,
  applyingId,
  onApply,
  onClose,
}: MultiPatientReviewProps) {
  const rosterById = useMemo(() => new Map(roster.map((r) => [r.patientId, r] as const)), [roster]);

  return (
    <div className="soap-scribe-multi">
      <div className="soap-scribe-multi-head">
        <span>
          <Users size={13} /> Multi-pet review — {suggestion.patients.length} pet
          {suggestion.patients.length === 1 ? '' : 's'}
        </span>
        <button type="button" className="soap-btn small ghost" onClick={onClose}>
          <XIcon size={12} /> Close
        </button>
      </div>

      {suggestion.patients.map((p) => {
        const entry = rosterById.get(p.patientId);
        if (!entry) return null;
        const applied = appliedIds.has(p.patientId);
        const applying = applyingId === p.patientId;
        const vitalsText = (Object.keys(VITAL_LABELS) as (keyof Vitals)[])
          .filter((k) => p.vitals[k]?.trim())
          .map((k) => `${VITAL_LABELS[k]}: ${p.vitals[k]}`)
          .join(' · ');

        return (
          <div className="soap-scribe-multi-card" key={p.patientId}>
            <div className="soap-scribe-multi-card-head">
              <strong>{entry.patientName}</strong>
              {entry.isCurrent && <span className="soap-scribe-tag">this chart</span>}
            </div>

            {p.subjectiveHistory && (
              <div className="soap-scribe-multi-block">
                <span className="soap-scribe-multi-label">S</span> {p.subjectiveHistory}
              </div>
            )}
            {(vitalsText || p.objectiveNotes) && (
              <div className="soap-scribe-multi-block">
                <span className="soap-scribe-multi-label">O</span>
                {vitalsText && <div>{vitalsText}</div>}
                {p.objectiveNotes && (
                  <pre className="soap-scribe-multi-pre">{p.objectiveNotes}</pre>
                )}
              </div>
            )}
            {p.assessmentReasoning && (
              <div className="soap-scribe-multi-block">
                <span className="soap-scribe-multi-label">A</span> {p.assessmentReasoning}
              </div>
            )}
            {p.planNotes && (
              <div className="soap-scribe-multi-block">
                <span className="soap-scribe-multi-label">P</span>
                <pre className="soap-scribe-multi-pre">{p.planNotes}</pre>
              </div>
            )}
            {p.problems.length > 0 && (
              <div className="soap-scribe-multi-block">
                <span className="soap-scribe-multi-label">Problems</span>{' '}
                {p.problems.map((pr) => pr.label).join(', ')}
              </div>
            )}
            {!p.subjectiveHistory &&
              !vitalsText &&
              !p.objectiveNotes &&
              !p.assessmentReasoning &&
              !p.planNotes &&
              p.problems.length === 0 &&
              p.planItems.length === 0 && (
                <p className="soap-scribe-multi-empty">
                  Nothing confidently attributed to {entry.patientName} in this transcript.
                </p>
              )}

            <div className="soap-scribe-multi-actions">
              <button
                type="button"
                className="soap-btn small primary"
                disabled={applied || applying}
                onClick={() => void onApply(entry, p)}
              >
                {applied ? (
                  <>
                    <Check size={12} /> Applied
                  </>
                ) : applying ? (
                  'Applying…'
                ) : (
                  `Apply to ${entry.patientName}'s chart`
                )}
              </button>
              {applied && !entry.isCurrent && (
                <a
                  className="soap-scribe-multi-link"
                  href={`/schedule/soap/${entry.appointmentId}/${entry.patientId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={12} /> View {entry.patientName}&apos;s chart
                </a>
              )}
            </div>
          </div>
        );
      })}

      {(suggestion.clientEmailSubject || suggestion.clientEmailBody) && (
        <div className="soap-scribe-multi-card">
          <div className="soap-scribe-multi-card-head">
            <strong>Client email</strong>
            <span className="soap-scribe-tag">shared across pets</span>
          </div>
          {suggestion.clientEmailSubject && (
            <div className="soap-scribe-multi-block">Subject: {suggestion.clientEmailSubject}</div>
          )}
          {suggestion.clientEmailBody && (
            <pre className="soap-scribe-multi-pre">{suggestion.clientEmailBody}</pre>
          )}
        </div>
      )}
    </div>
  );
}
