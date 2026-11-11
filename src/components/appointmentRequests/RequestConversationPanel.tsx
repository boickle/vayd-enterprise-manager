/**
 * Right side of an open request on the Appointments list: every email, text and call with the
 * client in one thread, and one box to write back by email, by text, or to log a call.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import {
  fetchAppointmentRequestConversation,
  logAppointmentRequestCall,
  sendAppointmentRequestSubmissionSms,
  type AppointmentRequestConversationResponse,
  type AppointmentRequestSubmission,
  type AppointmentRequestSubmissionItem,
} from '../../api/appointmentRequestSubmissions';
import { useAppointmentRequestEmail } from '../../hooks/useAppointmentRequestEmail';
import {
  buildRequestConversation,
  CALL_OUTCOME_LABELS,
  conversationSummary,
  type ConversationCall,
  type ConversationItem,
} from '../../utils/appointmentRequestConversation';
import { requestDataCanText, requestDataPhone } from '../../utils/appointmentRequestDisplay';
import { resolveAppointmentRequestSmsMessage } from '../../utils/appointmentRequestSmsMessage';
import { isProduction } from '../../utils/env';

type Mode = 'email' | 'text' | 'call';

type ChannelFilter = 'all' | 'email' | 'text' | 'call';
const CHANNEL_FILTERS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'email', label: 'Email' },
  { key: 'text', label: 'Text' },
  { key: 'call', label: 'Calls' },
];

type Props = {
  item: AppointmentRequestSubmissionItem;
  practiceId: number;
  practiceTz: string;
  /** After an email or text goes out: mark contacted, update the row. */
  onContacted: (item: AppointmentRequestSubmissionItem) => void;
  /** After a call is logged (the API already marked it contacted). */
  onSubmissionUpdated: (updated: AppointmentRequestSubmission) => void;
  onGmailLinked?: (patch: {
    gmailThreadId: string;
    gmailMailbox: string;
    gmailLinkedAt: string | null;
  }) => void;
  /** Buttons for the request's next step (Route, Confirm, Not booked…). */
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
      </div>
      <div className="req-convo-meta">
        <span className={`req-convo-channel req-convo-channel--${entry.channel}`}>
          {channelLabel}
        </span>
        {entry.direction === 'in' ? 'Client' : entry.author || 'Us'} · {whenLabel(entry.at, tz)}
      </div>
    </div>
  );
}

export function RequestConversationPanel({
  item,
  practiceId,
  practiceTz,
  onContacted,
  onSubmissionUpdated,
  onGmailLinked,
  actions,
}: Props) {
  const rd = item.requestData ?? {};
  const phone = requestDataPhone(rd);
  const textConsent = requestDataCanText(rd);
  const canText = Boolean(phone) && textConsent !== 'No';

  const email = useAppointmentRequestEmail(item, { onGmailLinked });
  const [convo, setConvo] = useState<AppointmentRequestConversationResponse | null>(null);
  const [convoError, setConvoError] = useState<string | null>(null);
  const [convoKey, setConvoKey] = useState(0);
  const [showEarlier, setShowEarlier] = useState(false);
  /** Show only emails, only texts, only calls, or everything (default). */
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  const [mode, setMode] = useState<Mode>(() =>
    email.clientEmail ? 'email' : canText ? 'text' : 'call'
  );
  const [draft, setDraft] = useState('');
  const [callOutcome, setCallOutcome] = useState<ConversationCall['outcome']>('reached');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConvoError(null);
    fetchAppointmentRequestConversation(item.id)
      .then((res) => {
        if (!cancelled) setConvo(res);
      })
      .catch((e) => {
        if (!cancelled) setConvoError(errorText(e, 'Could not load texts and calls.'));
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, convoKey]);

  const allItems = useMemo(
    () =>
      buildRequestConversation({
        submittedAt: item.submittedAt,
        clientEmail: email.clientEmail,
        emails: email.messages,
        texts: convo?.texts ?? [],
        calls: convo?.calls ?? [],
      }),
    [item.submittedAt, email.clientEmail, email.messages, convo]
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
  const loading = email.loading || (convo == null && convoError == null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, loading]);

  const suggest = useCallback(async () => {
    setSuggesting(true);
    try {
      const text = await resolveAppointmentRequestSmsMessage(item, practiceTz, {
        practiceId,
        greeting: mode === 'email' ? 'email' : 'sms',
      });
      setDraft(text);
    } catch {
      /* leave the box as it is */
    } finally {
      setSuggesting(false);
    }
  }, [item, practiceTz, practiceId, mode]);

  const send = async () => {
    const text = draft.trim();
    if (mode !== 'call' && !text) return;
    setSending(true);
    setSendError(null);
    try {
      if (mode === 'email') {
        await email.send(text);
        onContacted(item);
      } else if (mode === 'text') {
        await sendAppointmentRequestSubmissionSms(item.id, { message: text });
        onContacted(item);
        setConvoKey((k) => k + 1);
      } else {
        const updated = await logAppointmentRequestCall(item.id, {
          outcome: callOutcome,
          note: text || null,
        });
        onSubmissionUpdated(updated);
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
    (mode === 'email' && (!email.canSend || !draft.trim())) ||
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
              ? 'Hide earlier texts'
              : `Show ${earlierCount} earlier text${earlierCount === 1 ? '' : 's'}`}
          </button>
        ) : null}
        {shown.map((entry) => (
          <Bubble key={entry.key} entry={entry} tz={practiceTz} />
        ))}
        {loading ? <div className="req-convo-loading">Loading conversation…</div> : null}
        {email.error ? <div className="req-convo-warning">Email: {email.error}</div> : null}
        {convo?.textsError || convoError ? (
          <div className="req-convo-warning">Texts: {convo?.textsError ?? convoError}</div>
        ) : null}
      </div>

      <div className="req-convo-compose">
        <div className="req-convo-tabs" role="tablist" aria-label="Reply by">
          {(['email', 'text', 'call'] as Mode[]).map((m) => (
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
              {m === 'email' ? '✉ Email' : m === 'text' ? '💬 Text' : '📞 Call note'}
            </button>
          ))}
        </div>

        {mode === 'email' ? (
          <div className="req-convo-to">
            {email.clientEmail ? (
              <>
                To <strong>{email.clientEmail}</strong>
                {email.subject ? (
                  <span className="req-convo-subject"> · {email.subject}</span>
                ) : null}
              </>
            ) : (
              'This request has no email address.'
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
              'This request has no phone number.'
            )}
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
            {phone ? <span className="req-convo-phone">☎ {phone}</span> : null}
          </div>
        )}

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
          {mode !== 'call' ? (
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
        {sendError ? <div className="req-convo-error">{sendError}</div> : null}
      </div>

      {actions ? <div className="req-convo-actions">{actions}</div> : null}
    </section>
  );
}
