import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Copy, Mail, Pencil } from 'lucide-react';
import { idexxErrorMessage, saveIdexxClientSummary, type IdexxResultDetail } from '../../api/idexx';
import IdexxReasonPrompt from './IdexxReasonPrompt';
import { summaryPlaceholder } from './idexxClientSummaryDraft';
import { summaryEditorHtml, summaryPlainText } from './clientSummaryHtml';
import MessageTemplateHtmlEditor from '../messageTemplates/MessageTemplateHtmlEditor';
import { sanitizeCommunicationHtml } from '../../utils/sanitizeCommunicationHtml';
import { useIdexxReviewAccess } from './useIdexxReviewAccess';
import './Idexx.css';

type Props = {
  result: IdexxResultDetail;
  readOnly?: boolean;
  onSaved: (result: IdexxResultDetail) => void;
  /** Bump to open the panel, for example right after a new draft. */
  expandSignal?: number;
  /** Opens the email compose modal with this summary. */
  onEmail?: () => void;
  emailBusy?: boolean;
  /** The result is not complete: the wording cannot be approved yet (LAB-03). */
  partial?: boolean;
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
export default function IdexxClientSummary({
  result,
  readOnly,
  onSaved,
  expandSignal = 0,
  onEmail,
  emailBusy,
  partial = false,
}: Props) {
  const saved = result.clientSummary ?? '';
  const [text, setText] = useState(saved);
  /** "[doctor to add]" or another bracketed gap the draft left for the doctor. */
  const placeholder = summaryPlaceholder(summaryPlainText(text));
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(expandSignal > 0);
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const { canReview, mustGiveReason } = useIdexxReviewAccess();

  useEffect(() => {
    setText(result.clientSummary ?? '');
    setEditing(false);
    setOpen(false);
  }, [result.id]);

  useEffect(() => {
    if (!editing) setText(result.clientSummary ?? '');
  }, [result.clientSummary, editing]);

  useEffect(() => {
    if (expandSignal > 0) setOpen(true);
  }, [expandSignal]);

  const approved = Boolean(result.clientSummaryApprovedAt) && !editing;
  // Compared as text, so opening the editor (plain → HTML) doesn't count as a change.
  const dirty = summaryPlainText(text).trim() !== summaryPlainText(saved).trim();

  async function save(approve: boolean, reason?: string) {
    if (approve && mustGiveReason && !reason) {
      setError(null);
      setReasonOpen(true);
      return;
    }
    setBusy(approve ? 'approve' : 'save');
    setError(null);
    try {
      onSaved(await saveIdexxClientSummary(result.id, text, approve, reason));
      setReasonOpen(false);
      if (approve) setEditing(false);
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not save.'));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(summaryPlainText(text));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy. Select the text and copy it instead.');
    }
  }

  if (!saved && !editing) return null;

  const preview = summaryPlainText(saved).replace(/\s+/g, ' ').trim();

  return (
    <div className="idexx-client-summary">
      <button
        type="button"
        className="idexx-client-summary__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className="idexx-client-summary__label">Client summary</span>
        {approved ? (
          <span className="idexx-result__reviewed">
            <CheckCircle2 size={13} aria-hidden /> Approved {when(result.clientSummaryApprovedAt)}
            {result.clientSummaryApprovedByName ? ` by ${result.clientSummaryApprovedByName}` : ''}
            {result.clientSummaryApprovedReason ? ` — ${result.clientSummaryApprovedReason}` : ''}
          </span>
        ) : (
          <span className="idexx-order__meta">Draft, not approved</span>
        )}
      </button>

      {!open && preview ? <p className="idexx-client-summary__preview">{preview}</p> : null}

      {result.clientSummaryStale && open ? (
        <p className="idexx-order__note idexx-order__note--warn">
          IDEXX sent an updated result after this was written. Check it against the new values, or
          draft it again.
        </p>
      ) : null}

      {open ? (
        editing && !readOnly ? (
          // The same formatting editor as the email window (owner, Nov 9, 2026): full width,
          // with bold, italics, lists and links; the draft's paragraphs and bullets carry over.
          <div className="idexx-client-summary__editor" data-testid="idexx-summary-editor">
            <MessageTemplateHtmlEditor
              value={text}
              disabled={busy != null}
              placeholder="Write the summary the family will read…"
              onChange={setText}
            />
          </div>
        ) : (
          <div
            className="idexx-client-summary__text idexx-client-summary__text--read"
            // Sanitized: the summary is the doctor's own formatting, never raw input from elsewhere.
            dangerouslySetInnerHTML={{ __html: sanitizeCommunicationHtml(summaryEditorHtml(saved)) }}
          />
        )
      ) : null}

      {open && editing && !readOnly && placeholder ? (
        <p className="idexx-order__note idexx-order__note--warn" data-testid="idexx-summary-placeholder">
          Replace {placeholder} with your own words before approving.
        </p>
      ) : null}

      {open && error ? <p className="idexx-order__error">{error}</p> : null}

      {open ? (
        <div className="idexx-result__actions">
          {readOnly ? null : (
            <>
              {saved && !editing ? (
                <button
                  type="button"
                  className="btn secondary btn-sm"
                  disabled={busy != null}
                  onClick={() => {
                    setText(summaryEditorHtml(saved));
                    setEditing(true);
                  }}
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
                  {canReview ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy != null || !summaryPlainText(text).trim() || partial || placeholder != null}
                      title={
                        partial
                          ? "The results aren't complete yet. Approve the wording once all results are back."
                          : placeholder
                            ? `Replace ${placeholder} before approving.`
                            : undefined
                      }
                      onClick={() => void save(true)}
                    >
                      <CheckCircle2 size={13} aria-hidden />{' '}
                      {busy === 'approve' ? 'Approving…' : 'Approve wording'}
                    </button>
                  ) : null}
                </>
              ) : null}
            </>
          )}
          {onEmail && !editing ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={!text.trim() || emailBusy}
              title="Email this approved summary, with the IDEXX PDF attached"
              data-testid="idexx-summary-email"
              onClick={onEmail}
            >
              <Mail size={13} aria-hidden /> {emailBusy ? 'Preparing…' : 'Email lab summary & report'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={!text.trim()}
            onClick={() => void copy()}
          >
            <Copy size={13} aria-hidden /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
      <IdexxReasonPrompt
        open={reasonOpen}
        title="Approve this client summary"
        confirmLabel="Approve wording"
        busy={busy === 'approve'}
        error={error}
        onConfirm={(reason) => void save(true, reason)}
        onCancel={() => setReasonOpen(false)}
      />
    </div>
  );
}
