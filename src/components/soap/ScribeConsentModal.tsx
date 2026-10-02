import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, X } from 'lucide-react';

type Props = {
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Recording-consent gate shown each time the AI scribe is started. Two-party
 * consent laws vary by state, so we require an explicit doctor confirmation
 * that the client has been told before any audio is captured or streamed.
 */
export default function ScribeConsentModal({ onConfirm, onClose }: Props) {
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
            <Mic size={18} /> Start AI scribe recording
          </h3>
          <button type="button" className="soap-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="soap-modal-sub">
          The visit audio is streamed for live transcription and used only to suggest SOAP note
          content for your review — nothing is saved to the record without you applying it. Some
          states require notifying anyone being recorded.
        </p>
        <label className="soap-scribe-consent-check">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>
            I&rsquo;ve informed the client this visit is being recorded for AI note-taking.
          </span>
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
