import { useCallback, useEffect, useState } from 'react';
import { Mic, Square, Phone, Mail, Trash2, Pencil, Upload, ExternalLink, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import type { BriefSession } from '../../utils/briefTypes';
import { BRIEF_KIND_LABEL } from '../../utils/briefTypes';
import { useBriefRecorder } from '../../hooks/useBriefRecorder';
import { patchBrief, removeBrief } from '../../api/briefs';
import { createEncounter, updateEncounter } from '../../api/visitWorkflow';
import { polishSpokenNotes } from '../../api/soapScribe';
import { createScoutChartNote, finalizeScoutChartNote } from '../../api/scoutChart';
import { mergeClinicianPrevisitNotes } from '../../utils/roomLoaderSubjectiveText';
import { markBriefsInjected } from '../../utils/briefStore';
import { buildPhoneDialHref } from '../../utils/quoContact';
import BriefEmailModal from './BriefEmailModal';
import { appConfirm, appPrompt } from '../../utils/appDialog';

type Props = {
  session: BriefSession;
  quoFromLine?: string | null;
  onChange: (next: BriefSession) => void;
  onDeleted: () => void;
};

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function BriefSessionView({ session, quoFromLine, onChange, onDeleted }: Props) {
  const recorder = useBriefRecorder(session.soapEncounterId);
  const [title, setTitle] = useState(session.title);
  const [emailOpen, setEmailOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    setTitle(session.title);
    recorder.setTranscript(session.transcript);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-hydrate when switching sessions
  }, [session.id]);

  const persist = useCallback(
    async (patch: Partial<BriefSession>) => {
      const next = await patchBrief(session.id, patch);
      if (next) onChange(next);
    },
    [onChange, session.id]
  );

  const saveTranscript = useCallback(
    async (text: string, extra?: Partial<BriefSession>) => {
      await persist({
        transcript: text,
        status: text.trim() ? 'recorded' : session.status,
        ...extra,
      });
    },
    [persist, session.status]
  );

  const injectIfNeeded = useCallback(
    async (text: string) => {
      if (
        session.kind !== 'previsit' ||
        !text.trim() ||
        !session.appointmentId ||
        !session.patientId
      ) {
        return;
      }
      try {
        const enc = await createEncounter({
          appointmentId: session.appointmentId,
          patientId: Number(session.patientId),
          clientId: session.clientId != null ? Number(session.clientId) : undefined,
        });
        const existing = typeof enc.subjective?.history === 'string' ? enc.subjective.history : '';
        const nextHistory = mergeClinicianPrevisitNotes(existing, text);
        await updateEncounter(enc.id, {
          subjective: { ...(enc.subjective ?? {}), history: nextHistory },
        });
        markBriefsInjected([session.id]);
        await persist({ soapEncounterId: enc.id, status: 'injected' });
        setHint(
          'Prep notes were added to this visit’s SOAP history, separate from the in-room discussion.'
        );
      } catch (err) {
        setHint(
          err instanceof Error
            ? err.message
            : 'Saved here. Notes will inject the next time you open the SOAP.'
        );
      }
    },
    [persist, session]
  );

  const offerAddCallToRecord = useCallback(
    async (text: string) => {
      if (session.kind !== 'callback' || !text.trim() || session.patientId == null) return;
      const ok = await appConfirm({
        title: 'Add call to medical record?',
        message:
          'The transcript is already saved with this call. Add it to the pet’s medical record (Timeline) now? You can also add it later from this note.',
        confirmLabel: 'Add to record',
      });
      if (!ok) {
        setHint('Transcript saved with this call — not on the medical record.');
        return;
      }
      try {
        const pid = Number(session.patientId);
        const cid =
          session.clientId != null && Number.isFinite(Number(session.clientId))
            ? Number(session.clientId)
            : null;
        const body = `Call transcript · ${session.title}\n\n${text.trim()}`;
        const draft = await createScoutChartNote({
          patientId: pid,
          clientId: cid,
          body,
        });
        await finalizeScoutChartNote(draft.id);
        setHint('Call transcript added to the medical record.');
      } catch (err) {
        setHint(
          err instanceof Error
            ? err.message
            : 'Could not add the transcript to the medical record.',
        );
      }
    },
    [session],
  );

  const polishAndSave = async (raw: string) => {
    const source = raw.trim();
    if (!source) {
      await saveTranscript(source);
      return source;
    }
    setCleaning(true);
    setHint('Dropping chit-chat…');
    try {
      const cleaned = await polishSpokenNotes({
        transcript: source,
        kind: session.kind,
        patientName: session.patientName,
        clientName: session.clientName,
      });
      const next = cleaned.trim() || source;
      recorder.setTranscript(next);
      await saveTranscript(next, { rawTranscript: source });
      setShowRaw(false);
      setHint(
        next !== source
          ? 'Side conversation was dropped. You can still show the original recording.'
          : null
      );
      await injectIfNeeded(next);
      return next;
    } catch (err) {
      recorder.setTranscript(source);
      await saveTranscript(source, { rawTranscript: source });
      setHint(
        err instanceof Error
          ? `Saved the raw recording. Couldn’t clean it up: ${err.message}`
          : 'Saved the raw recording. Couldn’t clean it up.'
      );
      await injectIfNeeded(source);
      return source;
    } finally {
      setCleaning(false);
    }
  };

  const stopAndSave = async () => {
    const text = await recorder.stop();
    const combined = text.trim() || recorder.transcript;
    const next = await polishAndSave(combined);
    if (next?.trim()) await offerAddCallToRecord(next);
  };

  const callClient = () => {
    if (!session.clientPhone) {
      setHint('No phone number on this client.');
      return;
    }
    window.location.href = buildPhoneDialHref(session.clientPhone, { fromLine: quoFromLine });
    void recorder.start();
  };

  const soapHref =
    session.appointmentId && session.patientId
      ? `/schedule/soap/${session.appointmentId}/${session.patientId}${
          session.clientId ? `?clientId=${session.clientId}` : ''
        }`
      : null;

  return (
    <div className="brief-session">
      <div className="brief-session__top">
        <div>
          <p className="brief-kicker">{BRIEF_KIND_LABEL[session.kind]}</p>
          <input
            className="brief-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title.trim() !== session.title) {
                void persist({ title: title.trim() });
              }
            }}
          />
          <p className="brief-muted">
            {session.patientName ?? 'No patient'}
            {session.clientName ? ` · ${session.clientName}` : ''}
          </p>
        </div>
        <div className="brief-session__actions">
          {session.kind === 'callback' && session.clientPhone ? (
            <button type="button" className="brief-btn call" onClick={callClient}>
              <Phone size={15} aria-hidden /> Call
            </button>
          ) : null}
          {recorder.recording ? (
            <button
              type="button"
              className="brief-btn record is-on"
              onClick={() => void stopAndSave()}
            >
              <Square size={15} aria-hidden /> Stop {formatElapsed(recorder.elapsed)}
            </button>
          ) : (
            <button
              type="button"
              className="brief-btn record"
              disabled={cleaning}
              onClick={() => void recorder.start()}
            >
              <Mic size={15} aria-hidden /> Record
            </button>
          )}
        </div>
      </div>

      {recorder.error ? <p className="brief-error">{recorder.error}</p> : null}
      {hint ? <p className="brief-muted">{hint}</p> : null}

      <label className="brief-field">
        <span className="brief-field-label">Notes</span>
        <textarea
          className="brief-textarea brief-textarea--tall"
          value={
            showRaw && session.rawTranscript
              ? session.rawTranscript
              : recorder.recording
                ? `${recorder.transcript}${recorder.interim ? ` ${recorder.interim}` : ''}`
                : recorder.transcript
          }
          onChange={(e) => {
            if (showRaw) return;
            recorder.setTranscript(e.target.value);
          }}
          onBlur={() => {
            if (showRaw || recorder.recording || cleaning) return;
            void saveTranscript(recorder.transcript);
          }}
          readOnly={recorder.recording || cleaning || showRaw}
          placeholder="Record, or type notes here. After you stop, car talk and chit-chat are dropped."
        />
      </label>

      <div className="brief-session__tools">
        <button
          type="button"
          className="brief-btn"
          disabled={cleaning || recorder.recording || !recorder.transcript.trim()}
          onClick={() => void polishAndSave(recorder.transcript)}
        >
          <Sparkles size={14} aria-hidden /> {cleaning ? 'Cleaning…' : 'Clean up notes'}
        </button>
        {session.rawTranscript && session.rawTranscript.trim() !== recorder.transcript.trim() ? (
          <button type="button" className="brief-btn" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Show cleaned notes' : 'Show original recording'}
          </button>
        ) : null}
        <label className="brief-btn">
          <Upload size={14} aria-hidden /> Upload audio
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (!file) return;
              void persist({ audioFileName: file.name });
              setHint(
                `Attached ${file.name}. Paste or record a transcript to capture the words — uploaded files are stored with this Jot.`
              );
              e.currentTarget.value = '';
            }}
          />
        </label>
        {session.audioFileName ? (
          <span className="brief-muted">Audio: {session.audioFileName}</span>
        ) : null}
        <button type="button" className="brief-btn" onClick={() => setEmailOpen(true)}>
          <Mail size={14} aria-hidden /> Email transcript
        </button>
        {session.kind === 'callback' && session.patientId != null ? (
          <button
            type="button"
            className="brief-btn"
            disabled={cleaning || recorder.recording || !recorder.transcript.trim()}
            onClick={() => void offerAddCallToRecord(recorder.transcript)}
          >
            Add to medical record
          </button>
        ) : null}
        {soapHref ? (
          <Link className="brief-btn" to={soapHref}>
            <ExternalLink size={14} aria-hidden /> Open SOAP
          </Link>
        ) : null}
        <button
          type="button"
          className="brief-btn"
          onClick={() => {
            void (async () => {
              const next = await appPrompt({
                title: 'Rename Jot',
                message: 'New name for this Jot.',
                defaultValue: session.title,
                confirmLabel: 'Save',
              });
              if (next && next.trim()) {
                setTitle(next.trim());
                void persist({ title: next.trim() });
              }
            })();
          }}
        >
          <Pencil size={14} aria-hidden /> Modify
        </button>
        <button
          type="button"
          className="brief-btn danger"
          disabled={busy}
          onClick={() => {
            void (async () => {
              const ok = await appConfirm({
                title: 'Delete Jot?',
                message: 'Delete this Jot? The transcript cannot be recovered.',
                confirmLabel: 'Delete',
                danger: true,
              });
              if (!ok) return;
              setBusy(true);
              void removeBrief(session.id).then(onDeleted);
            })();
          }}
        >
          <Trash2 size={14} aria-hidden /> Delete
        </button>
      </div>

      <BriefEmailModal
        open={emailOpen}
        title={session.title}
        transcript={recorder.transcript}
        onClose={() => setEmailOpen(false)}
      />
    </div>
  );
}
