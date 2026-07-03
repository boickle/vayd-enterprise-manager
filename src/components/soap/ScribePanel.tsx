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
} from 'lucide-react';
import {
  createScribeSocket,
  structureTranscript,
  type ScribeSocketHandle,
  type ScribeSocketStatus,
  type ScribeSuggestion,
} from '../../api/soapScribe';
import { startScribeAudioCapture, type ScribeAudioCapture } from '../../utils/scribeAudioCapture';
import {
  createOrder,
  createProblem,
  type EncounterOrder,
  type PatientProblem,
} from '../../api/visitWorkflow';
import { PE_SYSTEMS, type PeExamState, type PeSystemFinding } from './peTemplate';
import ScribeConsentModal from './ScribeConsentModal';
import type { Vitals } from '../../pages/SoapEncounterPage';

type Props = {
  soapEncounterId: string;
  patientId: number;
  disabled: boolean;
  examEnabled: boolean;
  currentSubjective: string;
  currentVitals: Vitals;
  currentExam: PeExamState;
  currentReasoning: string;
  problems: PatientProblem[];
  orders: EncounterOrder[];
  onApplySubjective: (text: string) => void;
  onApplyVitals: (patch: Partial<Vitals>) => void;
  onApplyExam: (patch: Record<string, PeSystemFinding>) => void;
  onApplyReasoning: (text: string) => void;
  onProblemCreated: (problem: PatientProblem) => void;
  onOrderCreated: (order: EncounterOrder) => void;
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

export default function ScribePanel({
  soapEncounterId,
  patientId,
  disabled,
  examEnabled,
  currentSubjective,
  currentVitals,
  currentExam,
  currentReasoning,
  problems,
  orders,
  onApplySubjective,
  onApplyVitals,
  onApplyExam,
  onApplyReasoning,
  onProblemCreated,
  onOrderCreated,
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

  const socketRef = useRef<ScribeSocketHandle | null>(null);
  const audioRef = useRef<ScribeAudioCapture | null>(null);
  const timerRef = useRef<number | null>(null);

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

  const startRecording = useCallback(async () => {
    setErrorMessage(null);
    setInterimText('');
    setFinalTranscript('');
    setSuggestion(null);
    setDismissed(new Set());

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
      onSuggestion: (evt) => setSuggestion(evt.suggestion),
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

  const stopRecording = useCallback(async () => {
    teardown();
    const socket = socketRef.current;
    if (socket) {
      await socket.stop();
      socket.dispose();
      socketRef.current = null;
    }
  }, [teardown]);

  const onRecordClick = () => {
    if (recording) {
      void stopRecording();
    } else {
      setShowConsent(true);
    }
  };

  const processPastedTranscript = useCallback(async () => {
    const text = pasteText.trim();
    if (!text) return;
    setPasteBusy(true);
    setErrorMessage(null);
    try {
      const result = await structureTranscript(soapEncounterId, text);
      setFinalTranscript(text);
      setInterimText('');
      setSuggestion(result);
      setDismissed(new Set());
      setPasteOpen(false);
      setPasteText('');
      setTranscriptOpen(true);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not process the pasted transcript.'
      );
    } finally {
      setPasteBusy(false);
    }
  }, [pasteText, soapEncounterId]);

  // --- Diff suggestion vs. current SOAP state ---

  const subjectiveDiff = useMemo(() => {
    const text = suggestion?.subjectiveHistory?.trim();
    if (!text || norm(text) === norm(currentSubjective)) return null;
    const key = `subjective:${text}`;
    return dismissed.has(key) ? null : { key, text };
  }, [suggestion, currentSubjective, dismissed]);

  const vitalsDiff = useMemo(() => {
    if (!suggestion) return null;
    const patch: Partial<Vitals> = {};
    (Object.keys(VITAL_LABELS) as (keyof Vitals)[]).forEach((k) => {
      const v = suggestion.vitals[k];
      if (v != null && v.trim() !== '' && v.trim() !== currentVitals[k]?.trim()) {
        patch[k] = v.trim();
      }
    });
    if (Object.keys(patch).length === 0) return null;
    const key = `vitals:${JSON.stringify(patch)}`;
    return dismissed.has(key) ? null : { key, patch };
  }, [suggestion, currentVitals, dismissed]);

  const examDiff = useMemo(() => {
    if (!suggestion || !examEnabled) return null;
    const patch: Record<string, PeSystemFinding> = {};
    for (const sys of PE_SYSTEMS) {
      const s = suggestion.exam[sys.key];
      if (s?.status === 'abnormal') {
        const existing = currentExam[sys.key];
        if (existing?.status !== 'abnormal' || existing?.note !== (s.note ?? undefined)) {
          patch[sys.key] = { status: 'abnormal', note: s.note ?? undefined };
        }
      }
    }
    if (Object.keys(patch).length === 0) return null;
    const key = `exam:${JSON.stringify(patch)}`;
    return dismissed.has(key) ? null : { key, patch };
  }, [suggestion, currentExam, examEnabled, dismissed]);

  const reasoningDiff = useMemo(() => {
    const text = suggestion?.assessmentReasoning?.trim();
    if (!text || norm(text) === norm(currentReasoning)) return null;
    const key = `assessment:${text}`;
    return dismissed.has(key) ? null : { key, text };
  }, [suggestion, currentReasoning, dismissed]);

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
      .map((p) => ({ key: `planItem:${norm(p.name)}|${p.kind}`, ...p }))
      .filter((p) => !dismissed.has(p.key));
  }, [suggestion, orders, dismissed]);

  const dismiss = (key: string) => setDismissed((prev) => new Set(prev).add(key));

  const suggestionCount =
    (subjectiveDiff ? 1 : 0) +
    (vitalsDiff ? 1 : 0) +
    (examDiff ? 1 : 0) +
    (reasoningDiff ? 1 : 0) +
    problemDiffs.length +
    planDiffs.length;

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

      {pasteOpen && (
        <div className="soap-scribe-paste">
          <textarea
            className="soap-scribe-paste-textarea"
            placeholder="Paste a visit transcript here (e.g. from a recorder or another dictation tool)…"
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

      {transcriptOpen && (finalTranscript || interimText) && (
        <div className="soap-scribe-transcript">
          {finalTranscript} <span className="soap-scribe-interim">{interimText}</span>
        </div>
      )}

      {suggestionCount > 0 && (
        <div className="soap-scribe-suggestions">
          {subjectiveDiff && (
            <div className="soap-scribe-card">
              <div className="soap-scribe-card-head">Subjective / history</div>
              <p>{subjectiveDiff.text}</p>
              <div className="soap-scribe-card-actions">
                <button
                  type="button"
                  className="soap-btn small primary"
                  disabled={applyingKey === subjectiveDiff.key}
                  onClick={() =>
                    runApply(subjectiveDiff.key, () => onApplySubjective(subjectiveDiff.text))
                  }
                >
                  <Check size={12} /> Apply
                </button>
                <button
                  type="button"
                  className="soap-btn small ghost"
                  onClick={() => dismiss(subjectiveDiff.key)}
                >
                  <XIcon size={12} /> Dismiss
                </button>
              </div>
            </div>
          )}

          {vitalsDiff && (
            <div className="soap-scribe-card">
              <div className="soap-scribe-card-head">Vitals</div>
              <ul className="soap-scribe-list">
                {Object.entries(vitalsDiff.patch).map(([k, v]) => (
                  <li key={k}>
                    {VITAL_LABELS[k as keyof Vitals]}: <strong>{v}</strong>
                  </li>
                ))}
              </ul>
              <div className="soap-scribe-card-actions">
                <button
                  type="button"
                  className="soap-btn small primary"
                  disabled={applyingKey === vitalsDiff.key}
                  onClick={() => runApply(vitalsDiff.key, () => onApplyVitals(vitalsDiff.patch))}
                >
                  <Check size={12} /> Apply
                </button>
                <button
                  type="button"
                  className="soap-btn small ghost"
                  onClick={() => dismiss(vitalsDiff.key)}
                >
                  <XIcon size={12} /> Dismiss
                </button>
              </div>
            </div>
          )}

          {examDiff && (
            <div className="soap-scribe-card">
              <div className="soap-scribe-card-head">Physical exam findings</div>
              <ul className="soap-scribe-list">
                {Object.entries(examDiff.patch).map(([k, f]) => (
                  <li key={k}>
                    <strong>{PE_LABEL_BY_KEY[k] ?? k}</strong> — abnormal
                    {f.note ? `: ${f.note}` : ''}
                  </li>
                ))}
              </ul>
              <div className="soap-scribe-card-actions">
                <button
                  type="button"
                  className="soap-btn small primary"
                  disabled={applyingKey === examDiff.key}
                  onClick={() => runApply(examDiff.key, () => onApplyExam(examDiff.patch))}
                >
                  <Check size={12} /> Apply
                </button>
                <button
                  type="button"
                  className="soap-btn small ghost"
                  onClick={() => dismiss(examDiff.key)}
                >
                  <XIcon size={12} /> Dismiss
                </button>
              </div>
            </div>
          )}

          {reasoningDiff && (
            <div className="soap-scribe-card">
              <div className="soap-scribe-card-head">Assessment / clinical reasoning</div>
              <p>{reasoningDiff.text}</p>
              <div className="soap-scribe-card-actions">
                <button
                  type="button"
                  className="soap-btn small primary"
                  disabled={applyingKey === reasoningDiff.key}
                  onClick={() =>
                    runApply(reasoningDiff.key, () => onApplyReasoning(reasoningDiff.text))
                  }
                >
                  <Check size={12} /> Apply
                </button>
                <button
                  type="button"
                  className="soap-btn small ghost"
                  onClick={() => dismiss(reasoningDiff.key)}
                >
                  <XIcon size={12} /> Dismiss
                </button>
              </div>
            </div>
          )}

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

          {planDiffs.map((p) => (
            <div className="soap-scribe-card" key={p.key}>
              <div className="soap-scribe-card-head">Plan</div>
              <p>
                {p.name} <span className="soap-scribe-tag">{p.kind.replace(/_/g, ' ')}</span>
                {p.note ? ` — ${p.note}` : ''}
              </p>
              <p className="soap-scribe-card-hint">
                Adds as a proposed order — review and accept it (or match to a catalog item) on the
                Plan tab.
              </p>
              <div className="soap-scribe-card-actions">
                <button
                  type="button"
                  className="soap-btn small primary"
                  disabled={applyingKey === p.key}
                  onClick={() =>
                    runApply(p.key, async () => {
                      const created = await createOrder(soapEncounterId, {
                        name: p.name,
                        kind: p.kind,
                        note: p.note ?? undefined,
                        state: 'proposed',
                      });
                      onOrderCreated(created);
                    })
                  }
                >
                  <Check size={12} /> Add to Plan
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
