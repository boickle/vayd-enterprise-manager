import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  getScribePromptOverrides,
  updateScribePromptOverrides,
} from '../../api/scribePromptOverrides';

export type ScribePromptProviderOption = {
  id: number;
  name: string;
};

type Props = {
  /** Provider whose instructions are being edited. */
  providerId: number;
  providerName: string;
  /**
   * When set (admins), allow switching which provider's instructions to edit.
   * Providers editing themselves usually omit this.
   */
  providerOptions?: ScribePromptProviderOption[];
  onClose: () => void;
};

function errMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  if (typeof msg === 'string' && msg.trim()) return msg;
  return err instanceof Error ? err.message : fallback;
}

/**
 * Edit AI scribe custom instructions for a provider.
 * Saved on the employee record and injected into SOAP + Jot polish prompts.
 */
export default function ScribePromptOverridesModal({
  providerId: initialProviderId,
  providerName: initialProviderName,
  providerOptions,
  onClose,
}: Props) {
  const options = useMemo(() => {
    if (!providerOptions?.length) return null;
    return providerOptions;
  }, [providerOptions]);

  const [providerId, setProviderId] = useState(initialProviderId);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerName =
    options?.find((p) => p.id === providerId)?.name ?? initialProviderName;

  useEffect(() => {
    setProviderId(initialProviderId);
  }, [initialProviderId]);

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
          setError(errMessage(e, 'Could not load instructions.'));
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
      setError(errMessage(e, 'Could not save instructions.'));
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
          Provider-wide instructions for <strong>{providerName}</strong>. They add to the shared AI
          defaults for SOAP structuring and Jot note cleanup — for example vaccine sites, or
          default Heart wording when nothing abnormal was said. Only this provider (or an admin)
          can edit them.
        </p>
        {options && options.length > 1 ? (
          <label className="soap-modal-sub" style={{ display: 'block', marginBottom: 8 }}>
            Provider
            <select
              className="soap-input"
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              value={providerId}
              disabled={saving || loading}
              onChange={(e) => setProviderId(Number(e.target.value))}
            >
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
