import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { GmailThreadMessage } from '../../api/gmail';
import {
  buildComposeDraft,
  buildComposeSendBodiesFromEditorHtml,
  defaultFromAlias,
  discardAllThreadDrafts,
  draftListSnippet,
  extractEmail,
  formatFromAlias,
  joinComposeBodyHtml,
  loadComposeFromThreadDraft,
  loadSendAsAliases,
  replaceSignatureHtmlInCompose,
  saveComposeDraft,
  signatureHtmlForFromAlias,
  submitCompose,
  userTextFromComposeHtml,
  type ComposeContext,
  type ComposeMode,
  type GmailComposeDraftSavedInfo,
} from './gmailCompose';
import { fetchGmailSendAsAlias, type GmailSendAsAlias } from '../../api/gmail';
import GmailTemplateMenu from './GmailTemplateMenu';
import {
  createGmailTemplate,
  deleteGmailTemplate,
  loadGmailTemplates,
  overwriteGmailTemplate,
  type GmailTemplate,
} from './gmailTemplates';

const DRAFT_AUTOSAVE_MS = 1500;
const COMPOSE_USER_SELECTOR = '[data-compose-user]';

type Props = {
  mailbox: string;
  context: ComposeContext;
  variant?: 'inline' | 'float';
  threadMessages?: GmailThreadMessage[];
  onClose: () => void;
  onSent: () => void;
  onDraftSaved?: (info: GmailComposeDraftSavedInfo) => void;
  onDraftDeleted?: (info: { threadId: string }) => void;
};

const COMPOSE_TITLES: Record<ComposeMode, string> = {
  new: 'New message',
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
};

function focusComposeEditorStart(root: HTMLElement | null) {
  if (!root) return;
  root.focus();
  const userEl = root.querySelector(COMPOSE_USER_SELECTOR);
  const target = userEl ?? root;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export default function GmailComposePanel({
  mailbox,
  context,
  variant = 'inline',
  threadMessages,
  onClose,
  onSent,
  onDraftSaved,
  onDraftDeleted,
}: Props) {
  const [aliases, setAliases] = useState<GmailSendAsAlias[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [quotedSuffix, setQuotedSuffix] = useState('');
  const [threadId, setThreadId] = useState<string | undefined>();
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();
  const [references, setReferences] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [draftSaving, setDraftSaving] = useState(false);
  const [templates, setTemplates] = useState<GmailTemplate[]>([]);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const draftIdRef = useRef<string | undefined>();
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedKeyRef = useRef('');
  const discardRequestedRef = useRef(false);
  const saveGenerationRef = useRef(0);
  const hydratedDraftRef = useRef(false);
  const skipEditorSyncRef = useRef(false);
  const composeFieldsRef = useRef({
    from: '',
    to: '',
    cc: '',
    subject: '',
    bodyHtml: '',
    quotedSuffix: '',
    threadId: undefined as string | undefined,
    inReplyTo: undefined as string | undefined,
    references: undefined as string | undefined,
  });

  draftIdRef.current = draftId;

  const applyEditorHtml = useCallback((html: string) => {
    skipEditorSyncRef.current = true;
    setBodyHtml(html);
    if (editorRef.current) {
      editorRef.current.innerHTML = html;
    }
  }, []);

  const syncEditorFromDom = useCallback(() => {
    if (!editorRef.current) return;
    setBodyHtml(editorRef.current.innerHTML);
  }, []);

  useEffect(() => {
    composeFieldsRef.current = {
      from,
      to,
      cc,
      subject,
      bodyHtml,
      quotedSuffix,
      threadId,
      inReplyTo,
      references,
    };
  }, [from, to, cc, subject, bodyHtml, quotedSuffix, threadId, inReplyTo, references]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDraftId(undefined);
    setBodyHtml('');
    setQuotedSuffix('');
    hydratedDraftRef.current = false;
    lastSavedKeyRef.current = '';
    discardRequestedRef.current = false;

    loadSendAsAliases(mailbox)
      .then((list) => {
        if (cancelled) return;
        setAliases(list);
        const fromVal = defaultFromAlias(list, mailbox);
        setFrom(fromVal);
        const sigHtml = signatureHtmlForFromAlias(list, fromVal);

        const draft = buildComposeDraft({ ...context, mailboxEmail: mailbox });
        setTo(draft.to);
        setCc(draft.cc);
        setSubject(draft.subject);
        setQuotedSuffix(draft.quotedSuffix);
        setThreadId(draft.threadId);
        setInReplyTo(draft.inReplyTo);
        setReferences(draft.references);
        setShowCc(Boolean(draft.cc.trim()));

        const existing = loadComposeFromThreadDraft(threadMessages);
        if (existing) {
          hydratedDraftRef.current = true;
          setDraftId(existing.draftId);
          applyEditorHtml(existing.bodyHtml);
        } else {
          applyEditorHtml(
            joinComposeBodyHtml('', sigHtml, draft.quotedSuffix, context.replyTo ?? null),
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load send-as aliases');
      });

    return () => {
      cancelled = true;
    };
  }, [mailbox, context.mode, context.threadId, context.replyTo?.id, applyEditorHtml]);

  useEffect(() => {
    if (hydratedDraftRef.current || !threadMessages?.length) return;
    const existing = loadComposeFromThreadDraft(threadMessages);
    if (!existing) return;
    hydratedDraftRef.current = true;
    setDraftId(existing.draftId);
    applyEditorHtml(existing.bodyHtml);
  }, [threadMessages, applyEditorHtml]);

  useEffect(() => {
    if (skipEditorSyncRef.current) {
      skipEditorSyncRef.current = false;
      return;
    }
    if (editorRef.current && editorRef.current.innerHTML !== bodyHtml) {
      editorRef.current.innerHTML = bodyHtml;
    }
  }, [bodyHtml]);

  useEffect(() => {
    requestAnimationFrame(() => focusComposeEditorStart(editorRef.current));
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [context.mode, context.threadId, context.replyTo?.id]);

  const flushDraftSave = useCallback(async () => {
    if (discardRequestedRef.current) return;

    const fields = composeFieldsRef.current;
    const sigHtml = signatureHtmlForFromAlias(aliases, fields.from);
    const userText = userTextFromComposeHtml(fields.bodyHtml, sigHtml, fields.quotedSuffix);
    const hasNewMessageFields =
      context.mode === 'new' &&
      (fields.to.trim().length > 0 || fields.subject.trim().length > 0);
    if (!userText.trim() && !hasNewMessageFields) {
      const existingDraftId = draftIdRef.current;
      if (existingDraftId || fields.threadId) {
        try {
          await discardAllThreadDrafts(mailbox, fields.threadId, threadMessages);
          if (discardRequestedRef.current) return;
          setDraftId(undefined);
          draftIdRef.current = undefined;
          onDraftDeleted?.({ threadId: fields.threadId ?? '' });
        } catch {
          /* non-blocking */
        }
      }
      return;
    }

    const saveKey = JSON.stringify({
      draftId: draftIdRef.current ?? '',
      from: fields.from,
      to: fields.to,
      cc: fields.cc,
      subject: fields.subject,
      bodyHtml: fields.bodyHtml,
      threadId: fields.threadId ?? '',
    });
    if (saveKey === lastSavedKeyRef.current) return;

    const generation = saveGenerationRef.current;
    setDraftSaving(true);
    try {
      const result = await saveComposeDraft({
        mailbox,
        draftId: draftIdRef.current,
        from: fields.from,
        to: fields.to,
        cc: fields.cc,
        subject: fields.subject,
        userText: '',
        signatureHtml: '',
        quotedSuffix: '',
        quotedMessage: null,
        editorHtml: fields.bodyHtml,
        threadId: fields.threadId,
        inReplyTo: fields.inReplyTo,
        references: fields.references,
        threadInInbox: context.threadInInbox,
        threadMessages,
      });
      if (discardRequestedRef.current || generation !== saveGenerationRef.current) return;
      setDraftId(result.id);
      draftIdRef.current = result.id;
      lastSavedKeyRef.current = saveKey;
      onDraftSaved?.({
        draftId: result.id,
        threadId: result.threadId,
        snippet: draftListSnippet(userText) || userText,
        labelIds: result.labelIds,
      });
    } catch (e) {
      if (!discardRequestedRef.current) {
        setError(e instanceof Error ? e.message : 'Could not save draft');
      }
    } finally {
      if (generation === saveGenerationRef.current) {
        setDraftSaving(false);
      }
    }
  }, [
    aliases,
    mailbox,
    context.mode,
    context.threadInInbox,
    threadMessages,
    onDraftDeleted,
    onDraftSaved,
  ]);

  useEffect(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void flushDraftSave();
    }, DRAFT_AUTOSAVE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [from, to, cc, subject, bodyHtml, flushDraftSave]);

  useEffect(() => {
    return () => {
      if (!discardRequestedRef.current) {
        void flushDraftSave();
      }
    };
  }, [flushDraftSave]);

  const handleFromChange = (nextFrom: string) => {
    setFrom(nextFrom);
    const html = signatureHtmlForFromAlias(aliases, nextFrom);
    setBodyHtml((prev) => {
      const next = replaceSignatureHtmlInCompose(prev, html);
      skipEditorSyncRef.current = true;
      if (editorRef.current) editorRef.current.innerHTML = next;
      return next;
    });

    if (!html) {
      const sendAsEmail = extractEmail(nextFrom);
      void fetchGmailSendAsAlias(mailbox, sendAsEmail)
        .then((detail) => {
          if (!detail.signature?.trim()) return;
          setAliases((prev) =>
            prev.map((a) =>
              a.sendAsEmail.toLowerCase() === sendAsEmail.toLowerCase() ? { ...a, ...detail } : a,
            ),
          );
          const resolvedHtml = detail.signature!.trim();
          setBodyHtml((prev) => {
            const next = replaceSignatureHtmlInCompose(prev, resolvedHtml);
            skipEditorSyncRef.current = true;
            if (editorRef.current) editorRef.current.innerHTML = next;
            return next;
          });
        })
        .catch(() => {
          /* signature optional */
        });
    }
  };

  useEffect(() => {
    setTemplates(loadGmailTemplates());
  }, []);

  const subjectEditable = context.mode === 'new' || context.mode === 'forward';
  const sigHtml = signatureHtmlForFromAlias(aliases, from);
  const userTextOnly = userTextFromComposeHtml(bodyHtml, sigHtml, quotedSuffix);
  const canSaveTemplate = userTextOnly.trim().length > 0 || subject.trim().length > 0;

  const insertTemplate = useCallback(
    (template: GmailTemplate) => {
      if (subjectEditable && template.subject.trim() && !subject.trim()) {
        setSubject(template.subject);
      }
      if (!template.body) return;
      const root = editorRef.current;
      if (!root) return;
      root.focus();
      const userEl = root.querySelector(COMPOSE_USER_SELECTOR);
      if (userEl instanceof HTMLElement) {
        userEl.focus();
      }
      document.execCommand('insertText', false, template.body);
      syncEditorFromDom();
    },
    [subjectEditable, subject, syncEditorFromDom],
  );

  const handleSaveNewTemplate = useCallback(() => {
    const name = window.prompt('Save as new template — name:');
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setTemplates(createGmailTemplate({ name: trimmed, subject, body: userTextOnly }));
  }, [subject, userTextOnly]);

  const handleOverwriteTemplate = useCallback(
    (template: GmailTemplate) => {
      if (!window.confirm(`Overwrite template “${template.name}” with the current message?`)) return;
      setTemplates(overwriteGmailTemplate(template.id, { subject, body: userTextOnly }));
    },
    [subject, userTextOnly],
  );

  const handleDeleteTemplate = useCallback((template: GmailTemplate) => {
    if (!window.confirm(`Delete template “${template.name}”?`)) return;
    setTemplates(deleteGmailTemplate(template.id));
  }, []);

  const handleDiscard = async () => {
    setBusy(true);
    discardRequestedRef.current = true;
    saveGenerationRef.current += 1;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    draftIdRef.current = undefined;
    setDraftId(undefined);
    lastSavedKeyRef.current = '';
    try {
      await discardAllThreadDrafts(mailbox, threadId, threadMessages);
      onDraftDeleted?.({ threadId: threadId ?? '' });
      onClose();
    } catch (e) {
      discardRequestedRef.current = false;
      setError(e instanceof Error ? e.message : 'Could not discard draft');
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    setBusy(true);
    setError(null);
    discardRequestedRef.current = true;
    saveGenerationRef.current += 1;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    try {
      const html = editorRef.current?.innerHTML ?? bodyHtml;
      const { bodyText, bodyHtml: sendHtml } = buildComposeSendBodiesFromEditorHtml(html);
      await submitCompose({
        mailbox,
        from,
        to,
        cc,
        subject,
        bodyText,
        bodyHtml: sendHtml,
        threadId,
        inReplyTo,
        references,
      });
      draftIdRef.current = undefined;
      setDraftId(undefined);
      lastSavedKeyRef.current = '';
      try {
        await discardAllThreadDrafts(mailbox, threadId, threadMessages);
        onDraftDeleted?.({ threadId: threadId ?? '' });
      } catch {
        /* sent — best-effort draft cleanup */
      }
      onSent();
      onClose();
    } catch (e) {
      discardRequestedRef.current = false;
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  const rootClass =
    variant === 'float' ? 'gmail-compose-panel gmail-compose-panel--float' : 'gmail-compose-panel';

  return (
    <div
      ref={panelRef}
      className={rootClass}
      role="region"
      aria-label={COMPOSE_TITLES[context.mode]}
    >
      <header className="gmail-compose-panel__header">
        <div className="gmail-compose-panel__header-title">
          <strong>{COMPOSE_TITLES[context.mode]}</strong>
          {aliases.length > 0 ? (
            <select
              className="gmail-compose-panel__from-select"
              aria-label="From"
              value={from}
              disabled={busy}
              onChange={(e) => handleFromChange(e.target.value)}
            >
              {aliases.map((a) => {
                const val = formatFromAlias(a);
                return (
                  <option key={a.sendAsEmail} value={val}>
                    {val}
                  </option>
                );
              })}
            </select>
          ) : (
            <span className="gmail-compose-panel__from-static">{from || mailbox}</span>
          )}
          {draftSaving ? (
            <span className="gmail-compose-panel__draft-status" aria-live="polite">
              Saving…
            </span>
          ) : null}
        </div>
        <div className="gmail-compose-panel__header-actions">
          <button
            type="button"
            className="gmail-inbox__list-toolbar-btn"
            aria-label="Discard draft"
            title="Discard"
            disabled={busy}
            onClick={() => void handleDiscard()}
          >
            <Trash2 size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className="gmail-inbox__list-toolbar-btn"
            aria-label="Close"
            title="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </header>

      {error ? <div className="gmail-compose-panel__error">{error}</div> : null}

      <div className="gmail-compose-panel__row">
        <span className="gmail-compose-panel__row-label">To</span>
        <input
          className="gmail-compose-panel__input"
          value={to}
          disabled={busy}
          onChange={(e) => setTo(e.target.value)}
        />
        {!showCc ? (
          <button
            type="button"
            className="gmail-compose-panel__cc-toggle"
            disabled={busy}
            onClick={() => setShowCc(true)}
          >
            Cc
          </button>
        ) : null}
      </div>

      {showCc ? (
        <div className="gmail-compose-panel__row">
          <span className="gmail-compose-panel__row-label">Cc</span>
          <input
            className="gmail-compose-panel__input"
            value={cc}
            disabled={busy}
            onChange={(e) => setCc(e.target.value)}
          />
        </div>
      ) : null}

      {context.mode === 'new' || context.mode === 'forward' ? (
        <div className="gmail-compose-panel__row">
          <span className="gmail-compose-panel__row-label">Subject</span>
          <input
            className="gmail-compose-panel__input"
            value={subject}
            disabled={busy}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
      ) : null}

      <div className="gmail-compose-panel__compose-body">
        <div
          ref={editorRef}
          className="gmail-compose-panel__body gmail-compose-panel__body--rich"
          contentEditable={busy ? 'false' : 'true'}
          role="textbox"
          aria-multiline="true"
          aria-label="Message body"
          suppressContentEditableWarning
          onInput={syncEditorFromDom}
        />
      </div>

      <footer className="gmail-compose-panel__footer">
        <button
          type="button"
          className="gmail-btn gmail-btn--primary"
          disabled={busy || !to.trim() || !subject.trim()}
          onClick={() => void handleSend()}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
        <button type="button" className="gmail-btn" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <div className="gmail-compose-panel__footer-spacer" />
        <GmailTemplateMenu
          templates={templates}
          canSave={canSaveTemplate}
          disabled={busy}
          onInsert={insertTemplate}
          onSaveNew={handleSaveNewTemplate}
          onOverwrite={handleOverwriteTemplate}
          onDelete={handleDeleteTemplate}
        />
      </footer>
    </div>
  );
}
