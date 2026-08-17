import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  getScribePromptOverrides,
  updateScribePromptOverrides,
} from '../../api/scribePromptOverrides';

type Props = {
  providerId: number;
  providerName: string;
  onClose: () => void;
};

/**
 * Edit AI scribe custom instructions for the appointment's primary provider.
 * Saved on the employee record and injected into the scribe system prompt for
 * every visit assigned to that provider.
 */
export default function ScribePromptOverridesModal({
  providerId,
  providerName,
  onClose,
}: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    getScribePromptOverrides(providerId)
      .then((res) => {
        if (!canceled) setText(res.scribePromptOverrides ?? '');
      })
      .catch((e) => {
        if (!canceled) {
          setError(e instanceof Error ? e.message : 'Could not load instructions.');
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [providerId]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const trimmed = text.trim();
      await updateScribePromptOverrides(providerId, trimmed === '' ? null : trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save instructions.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="scheduler-modal-backdrop" onClick={onClose}>
      <div
        className="scheduler-modal soap-modal soap-scribe-prompt-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scribe-prompt-overrides-title"
      >
        <div className="soap-modal-head">
          <h3 id="scribe-prompt-overrides-title">
            <SlidersHorizontal size={18} /> AI scribe instructions
          </h3>
          <button type="button" className="soap-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="soap-modal-sub">
          Provider-wide instructions for <strong>{providerName}</strong>. Anyone can edit them,
          and they apply to every patient whose appointment is assigned to this provider. They
          override or add to the shared AI scribe defaults — for example vaccine sites, or default
          Heart wording when nothing abnormal was said.
        </p>
        {loading ? (
          <p className="soap-modal-sub">Loading…</p>
        ) : (
          <textarea
            className="soap-input soap-scribe-prompt-textarea"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              'Examples:\n' +
              '• Give leptospirosis in the LH (left hind)\n' +
              '• Default Heart section to: No murmurs or arrhythmias\n' +
              '• Bordetella is oral unless otherwise stated'
            }
            disabled={saving}
          />
        )}
        {error && <p className="soap-scribe-prompt-error">{error}</p>}
        <div className="soap-modal-actions">
          <button type="button" className="soap-btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="soap-btn primary"
            disabled={loading || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
