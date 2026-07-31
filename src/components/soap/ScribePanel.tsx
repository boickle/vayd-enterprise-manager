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
  Users,
} from 'lucide-react';
import {
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
  type SoapEncounter,
} from '../../api/visitWorkflow';
import { PE_SYSTEMS, peExamFromValue, type PeExamState, type PeSystemFinding } from './peTemplate';
import ScribeConsentModal from './ScribeConsentModal';
import type { SuggestedPlanItem } from './ScribeSuggestedPlanItems';
import { formatSoapSectionSpacing } from '../../utils/soapSectionSpacing';
import { VISIT_DISCUSSION_HEADER } from '../../utils/roomLoaderSubjectiveText';
import { stashDeferredPlanItems } from '../../utils/deferredScribePlanItems';
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
  painScore: 'FAS /5',
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
 * pre-visit text. Process is always a full re-derive: keep the check-in block, replace
 * (or add) the Visit discussion section. With no check-in block, replace Subjective with
 * the new AI history so Re-load SOAP doesn't stack duplicate visit notes.
 */
function mergeSubjectiveHistory(existing: string, aiHistory: string): string {
  const delta = formatSoapSectionSpacing(aiHistory);
  if (!delta) return formatSoapSectionSpacing(existing);
  const cur = existing.trim();
  if (!cur) return delta;
  if (cur.includes(delta) || formatSoapSectionSpacing(cur).includes(delta)) {
    return formatSoapSectionSpacing(cur);
  }
  const hasPreVisit =
    /^Pre-Visit Check-in Information\b/i.test(cur) ||
    /^Pre-Exam Check-in Form:\s*Not filled out by client\b/i.test(cur) ||
    /^Room Loader information\b/i.test(cur);
  if (hasPreVisit) {
    if (
      new RegExp(`^${VISIT_DISCUSSION_HEADER}\\s*$`, 'im').test(cur) ||
      cur.includes(`\n${VISIT_DISCUSSION_HEADER}`)
    ) {
      const replaced = cur.replace(
        /\n\nVisit discussion:\n\n[\s\S]*$/i,
        `\n\n${VISIT_DISCUSSION_HEADER}\n\n${delta}`
      );
      if (replaced !== cur) return formatSoapSectionSpacing(replaced);
      return formatSoapSectionSpacing(`${cur}\n\n${VISIT_DISCUSSION_HEADER}\n\n${delta}`);
    }
    return formatSoapSectionSpacing(`${cur}\n\n${VISIT_DISCUSSION_HEADER}\n\n${delta}`);
  }
  return delta;
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
  /** Ensures each Process result is written once (not re-applied when problems/orders update). */
  const multiAppliedFingerprintRef = useRef<string | null>(null);
  /** Multi-pet plan items for the open pet — fed to the catalog matcher, not created as $0 orders. */
  const [multiPlanItemsForCurrent, setMultiPlanItemsForCurrent] = useState<SuggestedPlanItem[]>(
    []
  );

  const socketRef = useRef<ScribeSocketHandle | null>(null);
  const audioRef = useRef<ScribeAudioCapture | null>(null);
  const timerRef = useRef<number | null>(null);
  const prevSuggestionRef = useRef<ScribeSuggestion | null>(null);
  const logKeyRef = useRef(0);
  const lastAppliedEmailRef = useRef<string | null>(null);

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
          setSelectedPatientIds(new Set(entries.map((e) => e.patientId)));
        }
      })
      .catch(() => {
        /* Multi-pet detection is best-effort — falls back to single-patient paste. */
      });
    return () => {
      canceled = true;
    };
  }, [soapEncounterId]);

  // Restore the most recent saved transcript when returning to this chart. Sessions are
  // audit-only (not part of the printed medical record); the UI just needs the text again.
  useEffect(() => {
    let canceled = false;
    listScribeSessions(soapEncounterId)
      .then((sessions) => {
        if (canceled) return;
        const saved = sessions.find((s) => s.transcript?.trim())?.transcript?.trim() ?? '';
        if (!saved) return;
        setFinalTranscript((prev) => prev || saved);
      })
      .catch(() => {
        /* Restore is best-effort — paste/record still work without it. */
      });
    return () => {
      canceled = true;
    };
  }, [soapEncounterId]);

  useEffect(() => {
    if (!suggestion) return;
    const subject = suggestion.clientEmailSubject?.trim() || '';
    const body = suggestion.clientEmailBody?.trim() || '';
    if (!subject && !body) return;
    const key = `${subject}\n---\n${body}`;
    // Only push email into the chart once per distinct AI draft — otherwise this effect
    // re-runs whenever the parent re-creates onNarrativeUpdate and undoes doctor edits/clears.
    if (lastAppliedEmailRef.current === key) return;
    lastAppliedEmailRef.current = key;
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
    lastAppliedEmailRef.current = null;

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
        setPasteText('');
        setTranscriptOpen(true);
      } else {
        const result = await structureTranscript(soapEncounterId, text);
        setFinalTranscript(text);
        setInterimText('');
        prevSuggestionRef.current = null;
        lastAppliedEmailRef.current = null;
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

  // Multi-pet: write into every selected pet's SOAP once per Process result.
  // Only `multiSuggestion` may re-trigger this — including applyMultiPatientEntry / roster in
  // deps caused an append loop (problems/orders updates → new callback → re-apply → 100× notes).
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
          `${p.patientId}:${(p.objectiveNotes ?? '').length}:${(p.planNotes ?? '').length}:${(p.assessmentReasoning ?? '').length}:${(p.subjectiveHistory ?? '').length}`
      )
      .join('|');
    if (multiAppliedFingerprintRef.current === fingerprint) {
      setMultiSuggestion(null);
      return;
    }

    let canceled = false;
    (async () => {
      const rosterById = new Map(rosterRef.current.map((r) => [r.patientId, r] as const));
      for (const p of suggestion.patients) {
        if (canceled) return;
        const entry = rosterById.get(p.patientId);
        if (!entry) continue;
        await applyMultiRef.current(entry, p);
      }
      if (canceled) return;
      multiAppliedFingerprintRef.current = fingerprint;
      const subject = suggestion.clientEmailSubject?.trim() || '';
      const body = suggestion.clientEmailBody?.trim() || '';
      if (subject || body) {
        const emailKey = `${subject}\n---\n${body}`;
        if (lastAppliedEmailRef.current !== emailKey) {
          lastAppliedEmailRef.current = emailKey;
          onNarrativeUpdate?.({
            emailSubject: suggestion.clientEmailSubject,
            emailBody: suggestion.clientEmailBody,
          });
        }
      }
      logApplied(
        `Multi-pet SOAP written for ${suggestion.patients.length} pet${
          suggestion.patients.length === 1 ? '' : 's'
        }`
      );
      setMultiSuggestion(null);
    })().catch((err) => {
      if (!canceled) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not auto-apply multi-pet SOAP.'
        );
      }
    });

    return () => {
      canceled = true;
    };
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
            onClick={() => {
              setPasteOpen((open) => {
                const next = !open;
                if (next && !pasteText.trim() && finalTranscript.trim()) {
                  setPasteText(finalTranscript);
                }
                return next;
              });
            }}
            disabled={busy || pasteBusy}
          >
            <ClipboardPaste size={13} />{' '}
            {finalTranscript.trim() ? 'Edit / re-load transcript' : 'Paste transcript'}
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
              ? 'Edit or replace the transcript, then Re-load SOAP to rewrite S/O/A/P from it. Pre-visit check-in stays; checkout orders are left alone. Not part of the printed medical record.'
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
              {pasteBusy
                ? 'Processing…'
                : finalTranscript.trim()
                  ? 'Re-load SOAP'
                  : 'Process'}
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

      {transcriptOpen && (finalTranscript || interimText) && (
        <div className="soap-scribe-transcript">
          <p className="soap-scribe-transcript-meta">
            Saved with this visit for reference — not included on the printed medical record.
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
