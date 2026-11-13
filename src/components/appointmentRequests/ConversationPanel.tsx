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
  /** Open the Email client window (From / send as, templates) with what was typed. */
  openWindow?: (draft: string) => void;
  /** Send only through the window (holds): the main button opens it. */
  windowOnly?: boolean;
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
  /**
   * Texts and calls. With `splitLoad`, called once for texts and once for calls so each shows as
   * soon as it arrives (texts come from Quo and can take a while). `fresh` skips the API's short
   * texts cache (after sending, or when a new reply came in).
   */
  load: (opts: { part?: 'texts' | 'calls'; fresh: boolean }) => Promise<ConversationLoad>;
  splitLoad?: boolean;
  /** Load fresh from the start (a new reply came in). */
  fresh?: boolean;
  /** "Summarize" a Quo call: fetches Quo's transcript when missing, then summarizes. */
  summarizeCall?: (callId: number) => Promise<{
    transcript: string | null;
    summary: string | null;
    transcriptStatus: string | null;
  }>;
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
  /** Techs and doctors read the conversation but can't send, call or summarize (Nov 13, 2026). */
  readOnly?: boolean;
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

/** Quo has said no transcript will come for the call. */
const NO_TRANSCRIPT = new Set(['absent', 'failed', 'not-found']);

type CallSummaryState =
  | { state: 'busy' }
  | { state: 'error' }
  | { state: 'done'; transcript: string | null; summary: string | null; transcriptStatus: string | null };

function Bubble({
  entry,
  tz,
  summary,
  onSummarize,
}: {
  entry: ConversationItem;
  tz: string;
  summary?: CallSummaryState;
  onSummarize?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  if (entry.channel === 'event') {
    return (
      <div className="req-convo-event">
        <span>{entry.title}</span> · {whenLabel(entry.at, tz)}
      </div>
    );
  }
  const done = summary?.state === 'done' ? summary : null;
  const fullBody = done?.summary ?? entry.body;
  const transcript = done?.transcript ?? entry.transcript ?? null;
  const transcriptStatus = done?.transcriptStatus ?? entry.transcriptStatus ?? null;
  const long = fullBody.length > LONG_BODY;
  const body = long && !expanded ? `${fullBody.slice(0, LONG_BODY).trimEnd()}…` : fullBody;
  // A Quo call with no summary yet: summarizing, Summarize, or why there is none.
  const callNote =
    entry.quoCallId == null || fullBody
      ? null
      : summary?.state === 'busy'
        ? 'busy'
        : NO_TRANSCRIPT.has(String(transcriptStatus)) || (done && !done.transcript)
          ? 'none'
          : summary?.state === 'error'
            ? 'error'
            : onSummarize
              ? 'offer'
              : null;
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
        {callNote === 'busy' ? (
          <div className="req-convo-callnote">Getting the transcript and summarizing…</div>
        ) : callNote === 'none' ? (
          <div className="req-convo-callnote">
            {transcriptStatus === 'in-progress'
              ? 'Quo is still transcribing this call. Try again in a minute.'
              : 'No transcript in Quo for this call, so there is nothing to summarize.'}
          </div>
        ) : callNote === 'error' || callNote === 'offer' ? (
          <button type="button" className="req-convo-more" onClick={onSummarize}>
            {callNote === 'error' ? 'Could not summarize. Try again' : 'Summarize'}
          </button>
        ) : null}
        {transcript ? (
          <>
            <button
              type="button"
              className="req-convo-more"
              aria-expanded={showTranscript}
              onClick={() => setShowTranscript((v) => !v)}
            >
              {showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>
            {showTranscript ? <div className="req-convo-transcript">{transcript}</div> : null}
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

export function ConversationPanel({ source, practiceTz, actions, readOnly = false }: Props) {
  const { phone, canText, email } = source;
  /** Texts and calls arrive separately when the source splits them. */
  const [textsPart, setTextsPart] = useState<ConversationLoad | null>(null);
  const [callsPart, setCallsPart] = useState<ConversationLoad | null>(null);
  const [textsLoadError, setTextsLoadError] = useState<string | null>(null);
  const [callsLoadError, setCallsLoadError] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<number, CallSummaryState>>({});
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
  const splitLoad = Boolean(source.splitLoad);
  const firstFresh = Boolean(source.fresh);
  useEffect(() => {
    let cancelled = false;
    const fresh = firstFresh || convoKey > 0;
    setTextsLoadError(null);
    setCallsLoadError(null);
    // Reloading the same conversation keeps what is shown until the new copy arrives.
    if (convoKey === 0) {
      setTextsPart(null);
      setCallsPart(null);
    }
    if (splitLoad) {
      loadRef
        .current({ part: 'calls', fresh })
        .then((res) => !cancelled && setCallsPart(res))
        .catch((e) => !cancelled && setCallsLoadError(errorText(e, 'Could not load calls.')));
      loadRef
        .current({ part: 'texts', fresh })
        .then((res) => !cancelled && setTextsPart(res))
        .catch((e) => !cancelled && setTextsLoadError(errorText(e, 'Could not load texts.')));
    } else {
      loadRef
        .current({ fresh })
        .then((res) => {
          if (cancelled) return;
          setTextsPart(res);
          setCallsPart(res);
        })
        .catch((e) => {
          if (cancelled) return;
          const msg = errorText(e, 'Could not load texts and calls.');
          setTextsLoadError(msg);
          setCallsLoadError(msg);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [source.key, convoKey, splitLoad, firstFresh]);
  useEffect(() => setSummaries({}), [source.key]);

  const convo = useMemo<ConversationLoad | null>(
    () =>
      textsPart || callsPart
        ? {
            texts: textsPart?.texts ?? [],
            textsError: textsPart?.textsError ?? null,
            calls: callsPart?.calls ?? [],
            quoCalls: callsPart?.quoCalls ?? [],
          }
        : null,
    [textsPart, callsPart]
  );
  const textsLoading = textsPart == null && textsLoadError == null;
  const callsLoading = callsPart == null && callsLoadError == null;
  const emailLoading = Boolean(email?.loading);

  /** Summarize a Quo call (fetches the transcript from Quo when Scout never got it). */
  const summarizeFn = source.summarizeCall;
  const summarize = useCallback(
    (callId: number) => {
      if (!summarizeFn) return;
      setSummaries((m) => ({ ...m, [callId]: { state: 'busy' } }));
      summarizeFn(callId)
        .then((r) => setSummaries((m) => ({ ...m, [callId]: { state: 'done', ...r } })))
        .catch(() => setSummaries((m) => ({ ...m, [callId]: { state: 'error' } })));
    },
    [summarizeFn]
  );
  // Calls since the request with no summary: summarize them on their own (a few at most).
  const autoAsked = useRef<Set<number>>(new Set());
  useEffect(() => {
    autoAsked.current = new Set();
  }, [source.key]);
  useEffect(() => {
    if (!summarizeFn) return;
    const todo = (callsPart?.quoCalls ?? [])
      .filter(
        (c) =>
          !c.beforeRequest &&
          !c.summary &&
          !NO_TRANSCRIPT.has(String(c.transcriptStatus)) &&
          (c.durationSeconds ?? 0) >= 20 &&
          !autoAsked.current.has(c.id)
      )
      .slice(-5);
    for (const c of todo) {
      autoAsked.current.add(c.id);
      summarize(c.id);
    }
  }, [callsPart, summarizeFn, summarize]);

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
  const loading = emailLoading || textsLoading || callsLoading;
  // Don't say "no reply yet" while texts or emails are still on their way.
  const summary = loading
    ? { tone: 'none' as const, label: 'Checking for messages…', at: null }
    : conversationSummary(allItems);
  const checking = [
    email ? { key: 'email', label: 'email', busy: emailLoading } : null,
    { key: 'text', label: 'texts', busy: textsLoading },
    { key: 'call', label: 'calls', busy: callsLoading },
  ].filter((c): c is { key: string; label: string; busy: boolean } => c != null);
  const partLoading: Record<'email' | 'text' | 'call', boolean> = {
    email: emailLoading,
    text: textsLoading,
    call: callsLoading,
  };

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
      if (mode === 'email' && email?.windowOnly && email.openWindow) {
        email.openWindow(text);
      } else if (mode === 'email' && email) {
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
    (mode === 'email' && (!email?.canSend || (!draft.trim() && !email?.windowOnly))) ||
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
                <span className="req-convo-filter-count">
                  {partLoading[f.key] ? '…' : channelCounts[f.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <span className={`req-convo-status req-convo-status--${summary.tone}`}>
          {summary.label}
          {summary.at ? ` · ${whenLabel(summary.at, practiceTz)}` : ''}
        </span>
      </header>

      {loading ? (
        <div className="req-convo-checking" role="status" aria-live="polite">
          {checking.map((c) => (
            <span
              key={c.key}
              className={`req-convo-checking-part${c.busy ? ' req-convo-checking-part--busy' : ''}`}
            >
              {c.busy ? `Checking ${c.label}…` : `${c.label[0].toUpperCase()}${c.label.slice(1)} ✓`}
            </span>
          ))}
        </div>
      ) : null}
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
          <Bubble
            key={entry.key}
            entry={entry}
            tz={practiceTz}
            summary={entry.quoCallId != null ? summaries[entry.quoCallId] : undefined}
            onSummarize={
              entry.quoCallId != null && summarizeFn && !readOnly
                ? () => summarize(entry.quoCallId as number)
                : undefined
            }
          />
        ))}
        {email?.error ? <div className="req-convo-warning">Email: {email.error}</div> : null}
        {convo?.textsError || textsLoadError ? (
          <div className="req-convo-warning">Texts: {convo?.textsError ?? textsLoadError}</div>
        ) : null}
        {callsLoadError && callsLoadError !== textsLoadError ? (
          <div className="req-convo-warning">Calls: {callsLoadError}</div>
        ) : null}
      </div>

      {readOnly ? (
        <p className="settings-muted req-convo-readonly">View only. Client liaisons and managers reply to the family.</p>
      ) : (
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
                  : mode === 'email' && email?.windowOnly
                    ? 'Start an email here, or leave blank, then open the email window to pick From and send…'
                    : mode === 'email'
                    ? 'Write an email…'
                    : 'Write a text…'
              }
              aria-label={
                mode === 'call' ? 'Call note' : `${mode === 'email' ? 'Email' : 'Text'} message`
              }
            />
            <div className="req-convo-compose-foot">
              <span className="req-convo-compose-tools">
                {mode !== 'call' && source.suggest ? (
                  <button
                    type="button"
                    className="req-convo-suggest"
                    onClick={() => void suggest()}
                    disabled={suggesting}
                  >
                    {suggesting ? 'Writing…' : 'Suggested message'}
                  </button>
                ) : null}
                {mode === 'email' && email?.openWindow && !email.windowOnly ? (
                  <button
                    type="button"
                    className="req-convo-suggest"
                    title="Choose who it is from (send as), use a template, attach files"
                    onClick={() => {
                      email.openWindow?.(draft.trim());
                      setDraft('');
                    }}
                  >
                    From, templates… ↗
                  </button>
                ) : null}
              </span>
              <button
                type="button"
                className="req-convo-send"
                disabled={sendDisabled}
                onClick={() => void send()}
              >
                {sending
                  ? 'Sending…'
                  : mode === 'email' && email?.windowOnly
                    ? 'Open email window'
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
      )}

      {actions ? <div className="req-convo-actions">{actions}</div> : null}
    </section>
  );
}
