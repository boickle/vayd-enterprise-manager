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
 * Saved on the employee record: SOAP/Jot notes and the client recap email are separate.
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
  const [soapText, setSoapText] = useState('');
  const [emailText, setEmailText] = useState('');
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
        if (!canceled) {
          setSoapText(res.scribePromptOverrides ?? '');
          setEmailText(res.clientEmailPromptOverrides ?? '');
        }
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
      await updateScribePromptOverrides(
        providerId,
        soapText.trim() === '' ? null : soapText.trim(),
        emailText.trim() === '' ? null : emailText.trim()
      );
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
          Provider-wide instructions for <strong>{providerName}</strong>. SOAP notes stay in the
          chart; the client email is the letter the owner receives after wrap-up. Each box adds
          to the shared defaults for that piece only. Only this provider (or an admin) can edit
          them.
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
          <>
            <label className="soap-scribe-prompt-label" htmlFor="scribe-prompt-soap">
              SOAP and Jot notes
            </label>
            <textarea
              id="scribe-prompt-soap"
              className="soap-input soap-scribe-prompt-textarea"
              rows={8}
              value={soapText}
              onChange={(e) => setSoapText(e.target.value)}
              placeholder={
                'Examples:\n' +
                '• Give leptospirosis in the LH (left hind)\n' +
                '• Default Heart section to: No murmurs or arrhythmias\n' +
                '• Bordetella is oral unless otherwise stated'
              }
              disabled={saving}
            />
            <label className="soap-scribe-prompt-label" htmlFor="scribe-prompt-email">
              Client recap email
            </label>
            <textarea
              id="scribe-prompt-email"
              className="soap-input soap-scribe-prompt-textarea soap-scribe-prompt-textarea--email"
              rows={8}
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder={
                'Examples:\n' +
                '• Open with a short hello and close as Dr. Heather\n' +
                '• Keep wellness visits to a few short paragraphs\n' +
                '• Always mention how to reach the field team after hours'
              }
              disabled={saving}
            />
          </>
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
