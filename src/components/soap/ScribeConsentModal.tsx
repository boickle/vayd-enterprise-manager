import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, X } from 'lucide-react';
import type { BriefKind } from '../../utils/briefTypes';

/** What is being recorded: a SOAP visit, a medical note's write-up, or a Jot. */
export type ScribeConsentVariant = 'visit' | 'note' | 'jot';

type Props = {
  onConfirm: () => void;
  onClose: () => void;
  variant?: ScribeConsentVariant;
  /** For a Jot: a call, a huddle or prep notes each ask a different question. */
  jotKind?: BriefKind | null;
};

function consentLine(variant: ScribeConsentVariant, jotKind?: BriefKind | null): string {
  if (variant !== 'jot') {
    return 'I\u2019ve informed the client this visit is being recorded for AI note-taking.';
  }
  if (jotKind === 'callback') return 'I\u2019ve told the client this call is being recorded.';
  if (jotKind === 'huddle') return 'I\u2019ve told everyone in this meeting they\u2019re being recorded.';
  return 'Anyone who can hear me knows I\u2019m recording.';
}

/**
 * Recording-consent gate shown each time the AI scribe is started: on a SOAP visit, on a medical
 * note (B2) and on a Jot (B5). Two-party consent laws vary by state, so we require an explicit
 * confirmation that people have been told before any audio is captured or streamed.
 */
export default function ScribeConsentModal({
  onConfirm,
  onClose,
  variant = 'visit',
  jotKind = null,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  return createPortal(
    <div className="scheduler-modal-backdrop" onClick={onClose}>
      <div
        className="scheduler-modal soap-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="soap-modal-head">
          <h3>
            <Mic size={18} /> {variant === 'jot' ? 'Record this Jot' : 'Start AI scribe recording'}
          </h3>
          <button type="button" className="soap-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="soap-modal-sub">
          <p>
            {variant === 'jot'
              ? 'The audio is streamed to the scribe\u2019s transcription service, the same as a visit recording. Some states require notifying anyone being recorded.'
              : 'The visit audio is streamed for live transcription. Some states require notifying anyone being recorded.'}
          </p>
          {variant === 'note' ? (
            <ul>
              <li>
                <strong>Write up visit</strong> turns the recording into History, Plan, checkout
                prep and a client email. A licensed person reads it before signing.
              </li>
              <li>
                The transcript is kept with this note and in a learning table used to improve the
                scribe.
              </li>
            </ul>
          ) : variant === 'jot' ? (
            <ul>
              <li>
                The words are saved with this Jot. They go on the medical record only if you add
                them.
              </li>
              <li>The audio itself is never stored.</li>
            </ul>
          ) : (
            <ul>
              <li>
                <strong>Process</strong> fills Objective, Assessment and Plan on the chart for you.
                Review them before you sign.
              </li>
              <li>
                On a household visit, <strong>Process</strong> fills every ticked pet. You are asked
                first about pets that already have notes.
              </li>
              <li>
                The transcript is kept on the chart and in a learning table used to improve the
                scribe.
              </li>
            </ul>
          )}
        </div>
        <label className="soap-scribe-consent-check">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>{consentLine(variant, jotKind)}</span>
        </label>
        <div className="soap-modal-actions">
          <button type="button" className="soap-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="soap-btn primary"
            disabled={!acknowledged}
            onClick={onConfirm}
          >
            Start recording
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
