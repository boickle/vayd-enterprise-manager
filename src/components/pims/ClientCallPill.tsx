import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Phone, Wand2 } from 'lucide-react';
import { polishSpokenNotes } from '../../api/soapScribe';
import {
  createScoutChartNote,
  finalizeScoutChartNote,
  recordScoutChartCommunication,
} from '../../api/scoutChart';
import { resolveCall, type ClientCall } from '../../api/calls';
import './ClientCallPill.css';

export type CallPillPatient = { id: number; name: string };

type Props = {
  clientId: number | null;
  clientName?: string | null;
  /** Pets the transcript could be filed to. One pet files without asking. */
  patients: CallPillPatient[];
  /** Pre-selected pet — set on the patient chart, left null on the client page. */
  defaultPatientId?: number | null;
  /** Open the review modal with an empty transcript to paste into. */
  pasteOpen?: boolean;
  onPasteClose?: () => void;
  /** Scroll to the new chart row, or refresh client comms when no pet was chosen. */
  onNoteFiled?: (noteId: string | null, patientId: number | null) => void;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Quo labels turns by OpenPhone user id, which is noise on a chart. Keep the shape of the
 * dialogue but drop the ids — who said what is obvious from two alternating speakers.
 */
function tidyQuoTranscript(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * The state of the call the user just placed, on the chart they placed it from.
 *
 * Quo records and transcribes both legs of the call on its own, so nothing here listens to
 * a microphone — this only follows the call and hands the finished transcript to Jot's
 * cleanup before it goes on the record.
 */
export default function ClientCallPill({
  clientId,
  clientName,
  patients,
  defaultPatientId,
  pasteOpen,
  onPasteClose,
  onNoteFiled,
}: Props) {
  // The live/review dock lives on the app shell so it survives Home and booking.
  // This component only opens the paste-a-transcript path from the chart.
  if (clientId == null || !pasteOpen) return null;

  return (
    <CallTranscriptModal
      clientId={clientId}
      clientName={clientName}
      patients={patients}
      defaultPatientId={defaultPatientId}
      onClose={() => onPasteClose?.()}
      onFiled={(noteId, pid) => {
        onPasteClose?.();
        onNoteFiled?.(noteId, pid);
      }}
    />
  );
}

export function CallTranscriptModal({
  call,
  clientId,
  clientName,
  patients,
  defaultPatientId,
  onClose,
  onFiled,
}: {
  /** Omitted when the user is pasting a transcript rather than reviewing a Quo call. */
  call?: ClientCall;
  clientId: number;
  clientName?: string | null;
  patients: CallPillPatient[];
  defaultPatientId?: number | null;
  onClose: () => void;
  onFiled: (noteId: string | null, patientId: number | null) => void;
}) {
  const pasted = call == null;
  const quoRaw = useMemo(
    () => tidyQuoTranscript(call?.transcriptText ?? ''),
    [call],
  );
  // Pasted text is both the source for cleanup and the thing being edited, so it needs its
  // own state — "Show verbatim" has to be able to get back to what was pasted.
  const [raw, setRaw] = useState(quoRaw);
  const [text, setText] = useState(quoRaw);
  const [callDate, setCallDate] = useState(
    () => call?.startedAt?.slice(0, 10) || todayISO(),
  );
  const [patientIds, setPatientIds] = useState<number[]>(() =>
    defaultPatientId != null ? [defaultPatientId] : [],
  );
  const [saveToComms, setSaveToComms] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [polished, setPolished] = useState(pasted);
  const [filing, setFiling] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPets = patients.filter((p) => patientIds.includes(p.id));
  const patientName =
    selectedPets.length > 0 ? selectedPets.map((p) => p.name).join(' & ') : null;
  const hasDestination = patientIds.length > 0 || saveToComms;
  const busy = filing || skipping || polishing;

  const togglePet = (id: number) => {
    setPatientIds((cur) =>
      cur.includes(id) ? cur.filter((pid) => pid !== id) : [...cur, id],
    );
  };

  const runPolish = (source: string) => {
    if (!source.trim()) return;
    setPolishing(true);
    setError(null);
    void polishSpokenNotes({
      transcript: source,
      kind: 'callback',
      patientName,
      clientName,
      asOfDate: callDate,
    })
      .then((summary) => summary && setText(summary))
      .catch(() =>
        setError('Could not clean up that transcript. The raw text is still here.'),
      )
      .finally(() => setPolishing(false));
  };

  // Quo's raw transcript is verbatim and long; the cleanup is the whole reason Jot reads
  // better, so run it once on open rather than making the user ask for it. Pasted text
  // waits for an explicit click, since there is nothing to clean until something is pasted.
  useEffect(() => {
    if (polished || !quoRaw.trim()) return;
    let cancelled = false;
    setPolishing(true);
    void polishSpokenNotes({
      transcript: quoRaw,
      kind: 'callback',
      patientName,
      clientName,
      asOfDate: callDate,
    })
      .then((summary) => {
        if (cancelled || !summary) return;
        setText(summary);
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        setPolishing(false);
        setPolished(true);
      });
    return () => {
      cancelled = true;
    };
    // Re-polishing when the pet changes would throw away edits for a name in a header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoRaw, polished]);

  const fileToChart = async () => {
    if (!text.trim() || !hasDestination) return;
    setFiling(true);
    setError(null);
    try {
      const heading = `Phone call — ${clientName?.trim() || 'client'}`;
      const body = `${heading}\n\n${text.trim()}`;
      const noteDate = new Date(`${callDate}T12:00:00`).toISOString();
      let firstNoteId: string | null = null;
      let firstPatientId: number | null = null;

      if (patientIds.length > 0) {
        const notes = await Promise.all(
          patientIds.map(async (patientId) => {
            const note = await createScoutChartNote({
              patientId,
              clientId,
              body,
              // Midday, so a date-only choice cannot land on the previous day in another zone.
              noteDate,
            });
            await finalizeScoutChartNote(note.id);
            return { noteId: note.id, patientId };
          }),
        );
        const preferred =
          notes.find((n) => n.patientId === defaultPatientId) ?? notes[0];
        firstNoteId = preferred.noteId;
        firstPatientId = preferred.patientId;
      }

      if (saveToComms) {
        await recordScoutChartCommunication({
          clientId,
          patientIds,
          channel: 'phone',
          body,
          typeLabel: 'Phone call',
          destination: call?.counterpartyPhone ?? undefined,
          includeOnMedicalRecord: false,
        });
      }

      if (call?.callId) {
        await resolveCall(call.callId, {
          noteId: firstNoteId,
          filed: true,
        }).catch(() => undefined);
      }
      onFiled(firstNoteId, firstPatientId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file that call.');
    } finally {
      setFiling(false);
    }
  };

  const skipFiling = async () => {
    setSkipping(true);
    setError(null);
    try {
      if (call?.callId) {
        await resolveCall(call.callId).catch(() => undefined);
      }
      onFiled(null, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not dismiss that call.');
      setSkipping(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="pims-chart-pick pims-chart-pick--call" role="dialog" aria-modal="true" aria-labelledby="pims-call-file-title">
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card">
        <div className="pims-chart-pick__head">
          <h3 id="pims-call-file-title">
            <Phone size={16} aria-hidden />{' '}
            {pasted ? 'Paste a call transcript' : `Call with ${clientName?.trim() || 'client'}`}
          </h3>
          <button type="button" className="pims-chart-pick__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="pims-chart-pick__empty">
          {pasted
            ? 'Paste the transcript from Quo, set the date it happened, then clean it up. Choose one or more pets, client-only, or Don’t file.'
            : 'Transcribed by Quo from both sides of the call, then cleaned up. Choose one or more pets, client-only, or Don’t file.'}
        </p>

        <div className="pims-call-file__meta">
          <fieldset className="pims-call-file__dest">
            <legend>Save to</legend>
            {patients.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={patientIds.includes(p.id)}
                  onChange={() => togglePet(p.id)}
                />
                {p.name}
              </label>
            ))}
            <label>
              <input
                type="checkbox"
                checked={saveToComms}
                onChange={(e) => setSaveToComms(e.target.checked)}
              />
              Client-only
            </label>
          </fieldset>

          <label className="pims-call-file__pet">
            <span>Call date</span>
            <input
              type="date"
              value={callDate}
              max={todayISO()}
              onChange={(e) => setCallDate(e.target.value)}
            />
          </label>
        </div>

        <textarea
          className="soap-textarea"
          rows={12}
          value={text}
          placeholder={
            polishing
              ? 'Cleaning up the transcript…'
              : pasted
                ? 'Paste the Quo transcript here…'
                : 'Nothing was transcribed.'
          }
          onChange={(e) => {
            setText(e.target.value);
            // Whatever is typed becomes the verbatim source until it is cleaned up.
            if (pasted) setRaw(e.target.value);
          }}
        />

        {error ? <div className="soap-error">{error}</div> : null}

        <div className="pims-chart-pick__foot">
          <button
            type="button"
            className="brief-btn"
            disabled={polishing || !raw.trim()}
            title="Strip the small talk and structure this into a note"
            onClick={() => runPolish(raw)}
          >
            <Wand2 size={14} aria-hidden />{' '}
            {polishing ? 'Cleaning up…' : pasted ? 'Clean up' : 'Clean up again'}
          </button>
          <button
            type="button"
            className="brief-btn"
            title="Put the verbatim transcript back"
            disabled={polishing || !raw.trim() || text === raw}
            onClick={() => setText(raw)}
          >
            Show verbatim
          </button>
          <button
            type="button"
            className="brief-btn"
            disabled={busy}
            title="Close this without putting it on a chart or the communication log"
            onClick={() => void skipFiling()}
          >
            {skipping ? 'Skipping…' : "Don't file"}
          </button>
          <button
            type="button"
            className="brief-btn primary"
            disabled={!text.trim() || !hasDestination || busy}
            onClick={() => void fileToChart()}
          >
            <FileText size={14} aria-hidden />
            {filing
              ? 'Saving…'
              : patientIds.length > 1
                ? `File to ${patientIds.length} charts`
                : patientIds.length === 1
                  ? 'File to chart'
                  : saveToComms
                    ? 'Save client-only'
                    : 'Choose where to save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
