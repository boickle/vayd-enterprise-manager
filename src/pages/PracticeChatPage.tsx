import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DateTime } from 'luxon';
import { MessageSquare, RefreshCw, Search, Send, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import {
  chatAboutChart,
  deleteMyAssistantChat,
  fetchMyAssistantChat,
  fetchPracticeDeskContext,
  saveMyAssistantChat,
  searchMyAssistantChats,
  type AssistantChatSearchHit,
  type CaseHistoryChatTurn,
} from '../api/soapScribe';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../api/visitWorkflow';
import { fetchPracticeInfo, fetchPracticeInfoById } from '../api/clientPortal';
import { appConfirm } from '../utils/appDialog';
import {
  appendCaseHistoryChat,
  clearCaseHistoryChat,
  listCaseHistoryChat,
  replaceCaseHistoryChat,
} from '../utils/briefRecordStore';
import { DEFAULT_PRACTICE_TIMEZONE, practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { pickPracticeMainPhone } from '../utils/practicePhone';
import '../components/pims/PimsPatientDetailView.css';
import './PracticeChatPage.css';

const STARTERS_SHARED = [
  'Walk me through Scout — where should I start?',
  'How do I open a patient chart and start a SOAP?',
  'Who is off today?',
  'What lab panels do we carry for thyroid / T4?',
  'Rough estimate for a wellness exam and heartworm test?',
  'What’s the difference between Jot and a Visit SOAP?',
];

const STARTERS_ADMIN = ['How do I use Settings and Admin in Scout?'];

function localChatKey(practiceId: number): string {
  return `practice:${practiceId}`;
}

function hitLabel(hit: AssistantChatSearchHit): string {
  if (hit.scope === 'patient' && hit.patientId) return `Patient #${hit.patientId}`;
  if (hit.scope === 'client' && hit.clientId) return `Household #${hit.clientId}`;
  if (hit.scope === 'practice') return 'Practice chat';
  return hit.scope;
}

function hitHref(hit: AssistantChatSearchHit): string | null {
  if (hit.scope === 'patient' && hit.patientId) {
    return `/schedule/patients?patientId=${encodeURIComponent(hit.patientId)}`;
  }
  if (hit.scope === 'client' && hit.clientId) {
    return `/schedule/clients?clientId=${encodeURIComponent(hit.clientId)}`;
  }
  if (hit.scope === 'practice') return '/schedule/chat';
  return null;
}

/**
 * Top-nav practice-wide Chat — staffing, catalog/labs, estimates, Scout help.
 * Private to the signed-in user; practiceId-scoped context only.
 */
export default function PracticeChatPage() {
  const auth = useAuth();
  const practiceId = VISIT_WORKFLOW_PRACTICE_ID;
  const practiceTz = practiceTimeZoneOrDefault(DEFAULT_PRACTICE_TIMEZONE);
  const roles = useMemo(() => {
    const raw = (auth as { role?: string | string[] }).role;
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((r) =>
      String(r).toLowerCase().trim(),
    );
  }, [auth]);
  const viewerIsAdmin = roles.includes('admin') || roles.includes('superadmin');
  const starters = useMemo(
    () => (viewerIsAdmin ? [...STARTERS_SHARED, ...STARTERS_ADMIN] : STARTERS_SHARED),
    [viewerIsAdmin],
  );
  const today = useMemo(
    () => DateTime.now().setZone(practiceTz).toFormat('yyyy-LL-dd'),
    [practiceTz],
  );
  const chatOwner = auth.userId || auth.employeeId || 'local';
  const storageKey = localChatKey(practiceId);

  const [sourceText, setSourceText] = useState('');
  const [asOfDate, setAsOfDate] = useState(today);
  const [contextBusy, setContextBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<CaseHistoryChatTurn[]>(() =>
    listCaseHistoryChat(storageKey, chatOwner),
  );
  const [searchQ, setSearchQ] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchHits, setSearchHits] = useState<AssistantChatSearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [practiceName, setPracticeName] = useState<string | null>(null);
  const [practicePhone, setPracticePhone] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);

  const refreshChat = () => setChat(listCaseHistoryChat(storageKey, chatOwner));

  const persistChat = () => {
    const messages = listCaseHistoryChat(storageKey, chatOwner);
    void saveMyAssistantChat({
      scope: 'practice',
      practiceId,
      messages,
    }).catch(() => undefined);
  };

  const loadContext = async () => {
    setContextBusy(true);
    setError(null);
    try {
      const ctx = await fetchPracticeDeskContext({ date: today });
      setSourceText(ctx.sourceText);
      if (ctx.asOfDate) setAsOfDate(ctx.asOfDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load practice desk context.');
    } finally {
      setContextBusy(false);
    }
  };

  useEffect(() => {
    setChat(listCaseHistoryChat(storageKey, chatOwner));
    void fetchMyAssistantChat({ scope: 'practice', practiceId })
      .then((remote) => {
        if (remote.length) {
          replaceCaseHistoryChat(storageKey, remote, chatOwner);
          setChat(remote);
          return;
        }
        const local = listCaseHistoryChat(storageKey, chatOwner);
        if (local.length) {
          void saveMyAssistantChat({
            scope: 'practice',
            practiceId,
            messages: local,
          }).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    void loadContext();
    void (async () => {
      try {
        const info =
          (await fetchPracticeInfoById(practiceId).catch(() => null)) ??
          (await fetchPracticeInfo().catch(() => null));
        if (info && typeof info === 'object') {
          const rec = info as Record<string, unknown>;
          const name = typeof rec.name === 'string' ? rec.name.trim() : '';
          if (name) setPracticeName(name);
          setPracticePhone(pickPracticeMainPhone(rec));
        }
      } catch {
        /* identity optional */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceId, chatOwner, storageKey, today]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [chat, chatBusy]);

  const ask = async (raw: string) => {
    const q = raw.trim();
    if (!q || chatBusy) return;

    if (/\b(did i ask|another (pet|patient)|my chats?|what did i (ask|say|do))\b/i.test(q)) {
      const needle =
        q.replace(/^(did i ask|what did i (ask|say|do) (about|for|regarding)?)\s*/i, '').trim() ||
        q;
      setSearchQ(needle);
      void runSearch(needle);
    }

    let src = sourceText;
    if (!src.trim()) {
      try {
        const ctx = await fetchPracticeDeskContext({ date: today });
        src = ctx.sourceText;
        setSourceText(src);
        if (ctx.asOfDate) setAsOfDate(ctx.asOfDate);
      } catch {
        setError('Practice context is not ready yet.');
        return;
      }
    }
    if (!src.trim()) {
      setError('Practice context is empty.');
      return;
    }

    setError(null);
    setChatBusy(true);
    setQuestion('');
    appendCaseHistoryChat(storageKey, { role: 'user', content: q }, chatOwner);
    persistChat();
    refreshChat();
    try {
      const prior = listCaseHistoryChat(storageKey, chatOwner)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(0, -1)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));
      const answer = await chatAboutChart({
        sourceText: src,
        question: q,
        history: prior,
        chatScope: 'practice',
        asOfDate: asOfDate || today,
        practiceName,
        practicePhone,
      });
      if (!answer.trim()) throw new Error('No answer came back.');
      appendCaseHistoryChat(storageKey, { role: 'assistant', content: answer }, chatOwner);
      persistChat();
      refreshChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer from practice context.');
    } finally {
      setChatBusy(false);
    }
  };

  const runSearch = async (raw: string) => {
    const q = raw.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchError(null);
      return;
    }
    setSearchBusy(true);
    setSearchError(null);
    try {
      const hits = await searchMyAssistantChats(q, 20);
      setSearchHits(hits);
      if (!hits.length) setSearchError('No matches in your chats.');
    } catch (err) {
      setSearchHits([]);
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearchBusy(false);
    }
  };

  const removeMyChats = () => {
    void (async () => {
      const ok = await appConfirm({
        title: 'Remove chat?',
        message:
          'Remove your practice Chat thread? Other staff never saw it. This cannot be undone.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      clearCaseHistoryChat(storageKey, chatOwner);
      refreshChat();
      void deleteMyAssistantChat({ scope: 'practice', practiceId }).catch(() => undefined);
    })();
  };

  return (
    <div className="practice-chat">
      <header className="practice-chat__head">
        <div>
          <h1>
            <MessageSquare size={20} aria-hidden />
            Chat
          </h1>
          <p>
            Staff desk + Scout coach (employees and admins — not the client portal). Who&apos;s
            working, what we carry, estimates, and day-to-day how Scout works. Settings/Admin
            how-to is only for admins. Private to your login.
          </p>
        </div>
        <button
          type="button"
          className="brief-btn"
          disabled={contextBusy}
          onClick={() => void loadContext()}
        >
          <RefreshCw size={14} aria-hidden />
          {contextBusy ? 'Refreshing…' : 'Refresh context'}
        </button>
      </header>

      <div className="pims-emr-case-prep practice-chat__body">
        <section className="pims-emr-prep__card pims-emr-case-prep__summary" aria-labelledby="practice-chat-ctx">
          <h3 id="practice-chat-ctx">
            <Sparkles size={15} aria-hidden />
            Today&apos;s desk context
          </h3>
          <p className="pims-emr-case-prep__chat-hint">
            As of {asOfDate}
            {contextBusy ? ' · loading…' : sourceText ? ' · ready' : ' · not loaded'}
            . Staffing and catalog are for this practice only.
          </p>
          {error && !chat.length ? (
            <p className="pims-detail__banner-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>

        <section className="pims-emr-prep__card pims-emr-case-prep__chat" aria-labelledby="practice-chat-ask">
          <div className="pims-emr-case-prep__chat-head">
            <h3 id="practice-chat-ask">
              <MessageSquare size={15} aria-hidden />
              Ask the practice desk
            </h3>
            <p className="pims-emr-case-prep__chat-hint">
              Ask how to do something in Scout and it will walk you through. Patient charts and
              household balances stay on those pages.
            </p>
          </div>

          <form
            className="pims-emr-case-prep__compose"
            style={{ marginBottom: '0.75rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(searchQ);
            }}
          >
            <label className="pims-emr-case-prep__chat-hint" htmlFor="practice-chat-search">
              Search my chats (patients + households + this desk — never other staff)
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
              <input
                id="practice-chat-search"
                className="input"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="e.g. Fluffy hyperthyroid"
                disabled={searchBusy}
              />
              <button
                type="submit"
                className="brief-btn"
                disabled={searchBusy || searchQ.trim().length < 2}
              >
                <Search size={14} aria-hidden />
                {searchBusy ? '…' : 'Search'}
              </button>
            </div>
            {searchError ? (
              <p className="pims-emr-case-prep__chat-hint" role="status">
                {searchError}
              </p>
            ) : null}
            {searchHits.length > 0 ? (
              <ul className="pims-emr-case-prep__starters" style={{ listStyle: 'none', padding: 0 }}>
                {searchHits.map((hit, i) => {
                  const href = hitHref(hit);
                  return (
                    <li key={`${hit.scope}-${hit.patientId}-${hit.clientId}-${i}`}>
                      {href ? (
                        <Link to={href} className="pims-emr-case-prep__starter">
                          <strong>{hitLabel(hit)}</strong>
                          <span> — {hit.snippet}</span>
                        </Link>
                      ) : (
                        <span className="pims-emr-case-prep__starter">
                          <strong>{hitLabel(hit)}</strong>
                          <span> — {hit.snippet}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </form>

          {error && chat.length ? (
            <p className="pims-detail__banner-error" role="alert">
              {error}
            </p>
          ) : null}

          {chat.length === 0 ? (
            <div className="pims-emr-case-prep__starters">
              {starters.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="pims-emr-case-prep__starter"
                  disabled={chatBusy || contextBusy}
                  onClick={() => void ask(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <div className="pims-emr-case-prep__log" ref={logRef}>
            {chat.map((m) => (
              <div
                key={m.id}
                className={`pims-emr-case-prep__bubble pims-emr-case-prep__bubble--${m.role}`}
              >
                <span className="pims-emr-case-prep__who">
                  {m.role === 'user' ? 'You' : 'Practice'}
                </span>
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.content}</p>
              </div>
            ))}
            {chatBusy ? (
              <p className="pims-emr-case-prep__thinking" role="status">
                Looking across the practice…
              </p>
            ) : null}
          </div>

          <form
            className="pims-emr-case-prep__compose"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <textarea
              className="input pims-emr-case-prep__input"
              rows={2}
              value={question}
              disabled={chatBusy}
              placeholder="Walk me through SOAP, who’s off, what labs we carry…"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
            />
            <div className="pims-emr-case-prep__compose-actions">
              <button
                type="submit"
                className="brief-btn primary"
                disabled={chatBusy || !question.trim()}
              >
                <Send size={14} aria-hidden />
                {chatBusy ? 'Asking…' : 'Ask'}
              </button>
              {chat.length > 0 ? (
                <button type="button" className="brief-text-btn" onClick={removeMyChats}>
                  Clear chat
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
