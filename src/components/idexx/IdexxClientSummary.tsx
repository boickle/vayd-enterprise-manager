import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, Pencil, Sparkles } from 'lucide-react';
import { idexxErrorMessage, saveIdexxClientSummary, type IdexxResultDetail } from '../../api/idexx';
import { draftIdexxClientSummary } from './idexxClientSummaryDraft';
import './Idexx.css';

type Props = {
  result: IdexxResultDetail;
  readOnly?: boolean;
  onSaved: (result: IdexxResultDetail) => void;
};

function when(raw: string | null): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/**
 * The owner-facing explanation of a result. AI drafts it from the pet's chart and earlier
 * IDEXX values; the doctor edits and approves the exact wording that is kept.
 */
export default function IdexxClientSummary({ result, readOnly, onSaved }: Props) {
  const saved = result.clientSummary ?? '';
  const [text, setText] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'save' | 'approve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setText(result.clientSummary ?? '');
    setEditing(false);
  }, [result.id, result.clientSummary]);

  const petName = result.patientName?.trim() || 'this pet';
  const approved = Boolean(result.clientSummaryApprovedAt) && !editing;
  const dirty = text.trim() !== saved.trim();

  async function draft() {
    if (saved && !window.confirm('Replace the current summary with a new AI draft?')) return;
    setBusy('draft');
    setError(null);
    try {
      const next = await draftIdexxClientSummary(result, petName);
      setText(next);
      onSaved(await saveIdexxClientSummary(result.id, next, false));
      setEditing(true);
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not draft the summary.'));
    } finally {
      setBusy(null);
    }
  }

  async function save(approve: boolean) {
    setBusy(approve ? 'approve' : 'save');
    setError(null);
    try {
      onSaved(await saveIdexxClientSummary(result.id, text, approve));
      if (approve) setEditing(false);
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not save.'));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy. Select the text and copy it instead.');
    }
  }

  if (readOnly && !saved) return null;

  return (
    <div className="idexx-client-summary">
      <div className="idexx-client-summary__head">
        <span className="idexx-result__section-title">Client summary</span>
        {approved ? (
          <span className="idexx-result__reviewed">
            <CheckCircle2 size={13} aria-hidden /> Approved {when(result.clientSummaryApprovedAt)}
          </span>
        ) : saved ? (
          <span className="idexx-order__meta">Draft, not approved</span>
        ) : null}
      </div>

      {result.clientSummaryStale ? (
        <p className="idexx-order__note idexx-order__note--warn">
          IDEXX sent an updated result after this was written. Check it against the new values, or
          draft it again.
        </p>
      ) : null}
      {result.patientId == null ? (
        <p className="idexx-order__note">Match this result to a pet to write a summary.</p>
      ) : null}

      {saved || editing ? (
        editing && !readOnly ? (
          <textarea
            className="settings-input idexx-client-summary__text"
            rows={10}
            maxLength={8000}
            value={text}
            disabled={busy != null}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <div className="idexx-client-summary__text idexx-client-summary__text--read">{saved}</div>
        )
      ) : null}

      {error ? <p className="idexx-order__error">{error}</p> : null}

      <div className="idexx-result__actions">
        {readOnly ? null : (
          <>
            {result.patientId != null ? (
              <button
                type="button"
                className={`btn btn-sm${saved ? ' secondary' : ''}`}
                disabled={busy != null}
                title="Drafted from this result, earlier IDEXX values and the pet's chart"
                onClick={() => void draft()}
              >
                {busy === 'draft' ? (
                  <Loader2 size={13} className="pims-task-detail__spinner" aria-hidden />
                ) : (
                  <Sparkles size={13} aria-hidden />
                )}{' '}
                {busy === 'draft' ? 'Drafting…' : saved ? 'Draft again' : 'Draft client summary'}
              </button>
            ) : null}
            {saved && !editing ? (
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy != null}
                onClick={() => setEditing(true)}
              >
                <Pencil size={13} aria-hidden /> Edit
              </button>
            ) : null}
            {editing ? (
              <>
                {dirty ? (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    disabled={busy != null}
                    onClick={() => void save(false)}
                  >
                    {busy === 'save' ? 'Saving…' : 'Save draft'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy != null || !text.trim()}
                  onClick={() => void save(true)}
                >
                  <CheckCircle2 size={13} aria-hidden />{' '}
                  {busy === 'approve' ? 'Approving…' : 'Approve wording'}
                </button>
              </>
            ) : null}
          </>
        )}
        {saved ? (
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={!text.trim()}
            onClick={() => void copy()}
          >
            <Copy size={13} aria-hidden /> {copied ? 'Copied' : 'Copy'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
