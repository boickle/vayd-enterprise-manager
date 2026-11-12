/**
 * One conversation with a client: emails (when the source has an email thread), texts, Quo calls
 * and call notes in time order, and one box to write back. Used by an open appointment request
 * and by an open hold on the Hold tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import type { GmailThreadMessage } from '../../api/gmail';
import {
  buildRequestConversation,
  CALL_OUTCOME_LABELS,
  conversationSummary,
  type ConversationCall,
  type ConversationItem,
  type ConversationQuoCall,
  type ConversationText,
} from '../../utils/appointmentRequestConversation';
import { isProduction } from '../../utils/env';
import { buildPhoneDialHref } from '../../utils/quoContact';
import { useOutboundCallFromLine } from '../../hooks/useOutboundCallFromLine';
import { markClientCallStarted } from '../../hooks/useClientCallActivity';

type Mode = 'email' | 'text' | 'call';

type ChannelFilter = 'all' | 'email' | 'text' | 'call';
const CHANNEL_FILTERS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'email', label: 'Email' },
  { key: 'text', label: 'Text' },
  { key: 'call', label: 'Calls' },
];

export type ConversationLoad = {
  texts: ConversationText[];
  textsError: string | null;
  calls: ConversationCall[];
  quoCalls?: ConversationQuoCall[];
};

/** Email side of a conversation (requests have their own Gmail thread). */
export type ConversationEmail = {
  messages: GmailThreadMessage[];
  loading: boolean;
  error: string | null;
  canSend: boolean;
  clientEmail: string | null;
  subject: string | null;
  send: (text: string) => Promise<unknown>;
};

export type ConversationSource = {
  /** Changes when the thing being shown changes (reloads the conversation). */
  key: string;
  /** When it started: request received / hold placed. Earlier texts and calls fold away. */
  startedAt: string;
  startTitle: string;
  phone: string | null;
  canText: boolean;
  /** For the call dock when dialing through Quo. */
  dial: { clientId: number | null; clientName: string | null; patientId: number | null };
  email: ConversationEmail | null;
  load: () => Promise<ConversationLoad>;
  sendText: (message: string) => Promise<void>;
  logCall: (outcome: ConversationCall['outcome'], note: string | null) => Promise<void>;
  /** Called after an email goes out. */
  afterEmail?: () => void;
  suggest?: (mode: 'email' | 'sms') => Promise<string>;
};

type Props = {
  source: ConversationSource;
  practiceTz: string;
  actions?: ReactNode;
};

function errorText(e: unknown, fallback: string): string {
  const ax = e as { response?: { data?: { message?: string } }; message?: string };
  return ax?.response?.data?.message ?? ax?.message ?? fallback;
}

function whenLabel(iso: string, tz: string): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
  if (!dt.isValid) return '';
  const today = DateTime.now().setZone(tz);
  if (dt.hasSame(today, 'day')) return dt.toFormat('h:mm a');
  if (dt.hasSame(today, 'year')) return dt.toFormat('EEE MMM d · h:mm a');
  return dt.toFormat('MMM d, yyyy · h:mm a');
}

const LONG_BODY = 420;

function Bubble({ entry, tz }: { entry: ConversationItem; tz: string }) {
  const [expanded, setExpanded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  if (entry.channel === 'event') {
    return (
      <div className="req-convo-event">
        <span>{entry.title}</span> · {whenLabel(entry.at, tz)}
      </div>
    );
  }
  const long = entry.body.length > LONG_BODY;
  const body = long && !expanded ? `${entry.body.slice(0, LONG_BODY).trimEnd()}…` : entry.body;
  const channelLabel =
    entry.channel === 'email' ? 'Email' : entry.channel === 'text' ? 'Text' : 'Call';
  return (
    <div className={`req-convo-row req-convo-row--${entry.direction}`}>
      <div className={`req-convo-bubble req-convo-bubble--${entry.channel}`}>
        {entry.channel === 'call' ? (
          <div className="req-convo-call-title">📞 {entry.title}</div>
        ) : null}
        {body ? <div className="req-convo-body">{body}</div> : null}
        {long ? (
          <button type="button" className="req-convo-more" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
        {entry.transcript ? (
          <>
            <button
              type="button"
              className="req-convo-more"
              aria-expanded={showTranscript}
              onClick={() => setShowTranscript((v) => !v)}
            >
              {showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>
            {showTranscript ? <div className="req-convo-transcript">{entry.transcript}</div> : null}
          </>
        ) : null}
      </div>
      <div className="req-convo-meta">
        <span className={`req-convo-channel req-convo-channel--${entry.channel}`}>
          {channelLabel}
        </span>
        {entry.channel === 'call' && entry.author
          ? entry.author
          : entry.direction === 'in'
            ? 'Client'
            : entry.author || 'Us'}{' '}
        · {whenLabel(entry.at, tz)}
      </div>
    </div>
  );
}

export function ConversationPanel({ source, practiceTz, actions }: Props) {
  const { phone, canText, email } = source;
  const [convo, setConvo] = useState<ConversationLoad | null>(null);
  const [convoError, setConvoError] = useState<string | null>(null);
  const [convoKey, setConvoKey] = useState(0);
  const [showEarlier, setShowEarlier] = useState(false);
  /** Show only emails, only texts, only calls, or everything (default). */
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const modes: Mode[] = email ? ['email', 'text', 'call'] : ['text', 'call'];

  const [mode, setMode] = useState<Mode>(() =>
    email?.clientEmail ? 'email' : canText ? 'text' : 'call'
  );
  const [draft, setDraft] = useState('');
  const [callOutcome, setCallOutcome] = useState<ConversationCall['outcome']>('reached');
  /** Call tab: dial through Quo (default) or log a call made from another phone. */
  const [logCallOpen, setLogCallOpen] = useState(false);
  const fromLine = useOutboundCallFromLine();
  const dialHref = phone ? buildPhoneDialHref(phone, { fromLine }) : '';
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      refreshTimers.current.forEach((t) => clearTimeout(t));
    },
    []
  );
  /** The call dock follows the call; the conversation looks again once Quo has had time to finish it. */
  const onDial = () => {
    const { clientId, clientName, patientId } = source.dial;
    if (clientId != null && Number.isFinite(clientId) && clientId > 0) {
      markClientCallStarted(clientId, clientName, patientId);
    }
    refreshTimers.current.forEach((t) => clearTimeout(t));
    refreshTimers.current = [90_000, 180_000, 300_000].map((ms) =>
      setTimeout(() => setConvoKey((k) => k + 1), ms)
    );
  };
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const loadRef = useRef(source.load);
  loadRef.current = source.load;
  useEffect(() => {
    let cancelled = false;
    setConvoError(null);
    loadRef
      .current()
      .then((res) => {
        if (!cancelled) setConvo(res);
      })
      .catch((e) => {
        if (!cancelled) setConvoError(errorText(e, 'Could not load texts and calls.'));
      });
    return () => {
      cancelled = true;
    };
  }, [source.key, convoKey]);

  const allItems = useMemo(
    () =>
      buildRequestConversation({
        submittedAt: source.startedAt,
        startTitle: source.startTitle,
        clientEmail: email?.clientEmail ?? null,
        emails: email?.messages ?? [],
        texts: convo?.texts ?? [],
        calls: convo?.calls ?? [],
        quoCalls: convo?.quoCalls ?? [],
      }),
    [source.startedAt, source.startTitle, email?.clientEmail, email?.messages, convo]
  );
  const filtered = allItems.filter(
    (i) => channelFilter === 'all' || i.channel === 'event' || i.channel === channelFilter
  );
  const earlierCount = filtered.filter((i) => i.beforeRequest).length;
  const shown = showEarlier ? filtered : filtered.filter((i) => !i.beforeRequest);
  const channelCounts = {
    email: allItems.filter((i) => i.channel === 'email').length,
    text: allItems.filter((i) => i.channel === 'text').length,
    call: allItems.filter((i) => i.channel === 'call').length,
  };
  const summary = conversationSummary(allItems);
  const loading = Boolean(email?.loading) || (convo == null && convoError == null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, loading]);

  const suggestFn = source.suggest;
  const suggest = useCallback(async () => {
    if (!suggestFn) return;
    setSuggesting(true);
    try {
      setDraft(await suggestFn(mode === 'email' ? 'email' : 'sms'));
    } catch {
      /* leave the box as it is */
    } finally {
      setSuggesting(false);
    }
  }, [suggestFn, mode]);

  const send = async () => {
    const text = draft.trim();
    if (mode !== 'call' && !text) return;
    setSending(true);
    setSendError(null);
    try {
      if (mode === 'email' && email) {
        await email.send(text);
        source.afterEmail?.();
      } else if (mode === 'text') {
        await source.sendText(text);
        setConvoKey((k) => k + 1);
      } else {
        await source.logCall(callOutcome, text || null);
        setConvoKey((k) => k + 1);
      }
      setDraft('');
    } catch (e) {
      setSendError(errorText(e, mode === 'call' ? 'Could not save the call.' : 'Could not send.'));
    } finally {
      setSending(false);
    }
  };

  const sendDisabled =
    sending ||
    (mode === 'email' && (!email?.canSend || !draft.trim())) ||
    (mode === 'text' && (!canText || !draft.trim()));

  return (
    <section className="req-convo" aria-label="Conversation">
      <header className="req-convo-head">
        <h3>Conversation</h3>
        <div className="req-convo-filter" role="radiogroup" aria-label="Show">
          {CHANNEL_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={channelFilter === f.key}
              className={`req-convo-filter-btn${channelFilter === f.key ? ' req-convo-filter-btn--on' : ''}`}
              onClick={() => setChannelFilter(f.key)}
            >
              {f.label}
              {f.key !== 'all' ? (
                <span className="req-convo-filter-count">{channelCounts[f.key]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <span className={`req-convo-status req-convo-status--${summary.tone}`}>
          {summary.label}
          {summary.at ? ` · ${whenLabel(summary.at, practiceTz)}` : ''}
        </span>
      </header>

      <div className="req-convo-thread" ref={threadRef}>
        {earlierCount > 0 ? (
          <button
            type="button"
            className="req-convo-earlier"
            onClick={() => setShowEarlier((v) => !v)}
          >
            {showEarlier
              ? 'Hide earlier messages'
              : `Show ${earlierCount} earlier message${earlierCount === 1 ? '' : 's'}`}
          </button>
        ) : null}
        {shown.map((entry) => (
          <Bubble key={entry.key} entry={entry} tz={practiceTz} />
        ))}
        {loading ? <div className="req-convo-loading">Loading conversation…</div> : null}
        {email?.error ? <div className="req-convo-warning">Email: {email.error}</div> : null}
        {convo?.textsError || convoError ? (
          <div className="req-convo-warning">Texts: {convo?.textsError ?? convoError}</div>
        ) : null}
      </div>

      <div className="req-convo-compose">
        <div className="req-convo-tabs" role="tablist" aria-label="Reply by">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`req-convo-tab${mode === m ? ' req-convo-tab--active' : ''}`}
              onClick={() => {
                setMode(m);
                setSendError(null);
              }}
            >
              {m === 'email' ? '✉ Email' : m === 'text' ? '💬 Text' : '📞 Call'}
            </button>
          ))}
        </div>

        {mode === 'email' ? (
          <div className="req-convo-to">
            {email?.clientEmail ? (
              <>
                To <strong>{email.clientEmail}</strong>
                {email.subject ? (
                  <span className="req-convo-subject"> · {email.subject}</span>
                ) : null}
              </>
            ) : (
              'No email address on file.'
            )}
          </div>
        ) : mode === 'text' ? (
          <div className="req-convo-to">
            {phone ? (
              <>
                To <strong>{phone}</strong>
                {!canText ? ' · client said no to texts' : ''}
                {!isProduction() ? ' · test site: texts go to the test phone' : ''}
              </>
            ) : (
              'No phone number on file.'
            )}
          </div>
        ) : !logCallOpen ? (
          <div className="req-convo-callbox">
            {phone ? (
              <a className="req-convo-send req-convo-dial" href={dialHref} onClick={onDial}>
                📞 Call {phone} in Quo
              </a>
            ) : (
              <div className="req-convo-to">No phone number on file.</div>
            )}
            <p className="req-convo-callhelp">
              Quo places and transcribes the call. It shows up here a minute or two after you hang
              up, with a short summary, whether or not you file it to a pet&apos;s chart.
            </p>
            <button
              type="button"
              className="req-convo-suggest"
              onClick={() => setLogCallOpen(true)}
            >
              Called from another phone? Log it
            </button>
          </div>
        ) : (
          <div className="req-convo-outcomes" role="radiogroup" aria-label="Call outcome">
            {(Object.keys(CALL_OUTCOME_LABELS) as ConversationCall['outcome'][]).map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={callOutcome === o}
                className={`req-convo-outcome${callOutcome === o ? ' req-convo-outcome--active' : ''}`}
                onClick={() => setCallOutcome(o)}
              >
                {CALL_OUTCOME_LABELS[o]}
              </button>
            ))}
            <button
              type="button"
              className="req-convo-suggest req-convo-phone"
              onClick={() => setLogCallOpen(false)}
            >
              ← Call in Quo instead
            </button>
          </div>
        )}

        {mode === 'call' && !logCallOpen ? null : (
          <>
            <textarea
              className="req-convo-input"
              rows={mode === 'email' ? 5 : 3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                mode === 'call'
                  ? 'What was said (optional)'
                  : mode === 'email'
                    ? 'Write an email…'
                    : 'Write a text…'
              }
              aria-label={
                mode === 'call' ? 'Call note' : `${mode === 'email' ? 'Email' : 'Text'} message`
              }
            />
            <div className="req-convo-compose-foot">
              {mode !== 'call' && source.suggest ? (
                <button
                  type="button"
                  className="req-convo-suggest"
                  onClick={() => void suggest()}
                  disabled={suggesting}
                >
                  {suggesting ? 'Writing…' : 'Suggested message'}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="req-convo-send"
                disabled={sendDisabled}
                onClick={() => void send()}
              >
                {sending
                  ? 'Sending…'
                  : mode === 'call'
                    ? 'Save call'
                    : mode === 'email'
                      ? 'Send email'
                      : 'Send text'}
              </button>
            </div>
          </>
        )}
        {sendError ? <div className="req-convo-error">{sendError}</div> : null}
      </div>

      {actions ? <div className="req-convo-actions">{actions}</div> : null}
    </section>
  );
}
