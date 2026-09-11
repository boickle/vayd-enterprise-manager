import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { DateTime } from 'luxon';
import { ChevronDown, ChevronUp, MessageSquare, Search, Send, Sparkles } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import {
  chatAboutChart,
  deleteMyAssistantChat,
  fetchMyAssistantChat,
  saveMyAssistantChat,
  searchMyAssistantChats,
  summarizeChartText,
  type AssistantChatSearchHit,
  type CaseHistoryChatTurn,
} from '../../api/soapScribe';
import {
  listClientVisitInvoices,
  listPatientPrescriptions,
  listProblems,
  type PatientPrescription,
  type PatientProblem,
  type VisitInvoice,
} from '../../api/visitWorkflow';
import { appConfirm } from '../../utils/appDialog';
import {
  appendCaseHistoryChat,
  clearCaseHistoryChat,
  listCaseHistoryChat,
  replaceCaseHistoryChat,
} from '../../utils/briefRecordStore';
import { buildHouseholdSourceText } from '../../utils/buildHouseholdSource';

const STARTERS = [
  'Summarize each pet and the account balance.',
  'Any open invoices or balance due?',
  'Which pets have active chronic problems or meds?',
  'Did I ask about hyperthyroid on another pet in my chats?',
];

type PetInput = {
  id: string;
  name: string;
  summaryLine: string;
  alerts: string | null;
  active: boolean;
};

type Props = {
  clientId: string;
  clientName: string;
  balance: number | null;
  pets: PetInput[];
  practiceTz: string;
};

function excerptText(raw: string, max = 360): string {
  const plain = raw.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${(lastStop > 80 ? cut.slice(0, lastStop) : cut).trim()}…`;
}

function formatAsOfLabel(asOfDate: string, practiceTz: string): string {
  const d = DateTime.fromISO(asOfDate, { zone: practiceTz });
  if (!d.isValid) return asOfDate;
  return d.toFormat('L/d/yyyy');
}

function localChatKey(clientId: string): string {
  return `client:${clientId}`;
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
  return null;
}

/**
 * Client-page household summary + chat (pets in this household + balance/invoices).
 * Chat is private to the signed-in user; search covers that user's chats only.
 */
export default function PimsClientHouseholdChatCard({
  clientId,
  clientName,
  balance,
  pets,
  practiceTz,
}: Props) {
  const auth = useAuth();
  const today = useMemo(
    () => DateTime.now().setZone(practiceTz).toFormat('yyyy-LL-dd'),
    [practiceTz],
  );
  const chatOwner = auth.userId || auth.employeeId || 'local';
  const storageKey = localChatKey(clientId);

  const [summary, setSummary] = useState('');
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<CaseHistoryChatTurn[]>(() =>
    listCaseHistoryChat(storageKey, chatOwner),
  );
  const [searchQ, setSearchQ] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchHits, setSearchHits] = useState<AssistantChatSearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const runGen = useRef(0);

  const refreshChat = () => setChat(listCaseHistoryChat(storageKey, chatOwner));

  const persistChat = () => {
    const messages = listCaseHistoryChat(storageKey, chatOwner);
    void saveMyAssistantChat({
      scope: 'client',
      clientId,
      messages,
    }).catch(() => undefined);
  };

  useEffect(() => {
    setSummary('');
    setSourceText(null);
    setError(null);
    setExpanded(false);
    setSearchHits([]);
    setSearchQ('');
    setChat(listCaseHistoryChat(storageKey, chatOwner));
    void fetchMyAssistantChat({ scope: 'client', clientId })
      .then((remote) => {
        if (remote.length) {
          replaceCaseHistoryChat(storageKey, remote, chatOwner);
          setChat(remote);
          return;
        }
        const local = listCaseHistoryChat(storageKey, chatOwner);
        if (local.length) {
          void saveMyAssistantChat({
            scope: 'client',
            clientId,
            messages: local,
          }).catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, [clientId, chatOwner, storageKey]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [chat, chatBusy]);

  const buildSource = async (): Promise<string> => {
    const invoices: VisitInvoice[] = await listClientVisitInvoices(Number(clientId)).catch(
      () => [] as VisitInvoice[],
    );
    const petRows = await Promise.all(
      pets.slice(0, 12).map(async (pet) => {
        const pid = Number(pet.id);
        let problems: PatientProblem[] = [];
        let prescriptions: PatientPrescription[] = [];
        if (Number.isFinite(pid) && pid > 0) {
          const [probs, rxs] = await Promise.all([
            listProblems(pid).catch(() => [] as PatientProblem[]),
            listPatientPrescriptions(pid).catch(() => [] as PatientPrescription[]),
          ]);
          problems = probs;
          prescriptions = rxs;
        }
        return {
          id: pet.id,
          name: pet.name,
          summaryLine: pet.summaryLine,
          alerts: pet.alerts,
          active: pet.active,
          problems,
          prescriptions,
        };
      }),
    );
    return buildHouseholdSourceText({
      clientName,
      clientId,
      balance,
      pets: petRows,
      invoices,
    });
  };

  const ensureSummary = async (force = false) => {
    if (busy) return;
    if (!force && summary.trim()) return;
    const gen = ++runGen.current;
    setBusy(true);
    setError(null);
    try {
      const src = await buildSource();
      if (gen !== runGen.current) return;
      setSourceText(src);
      if (!src.trim()) {
        setError('No household text to summarize yet.');
        return;
      }
      const next = await summarizeChartText({
        mode: 'household',
        sourceText: src,
        clientName,
        asOfDate: today,
      });
      if (gen !== runGen.current) return;
      if (!next.trim()) {
        setError('No summary came back.');
        return;
      }
      setSummary(next);
    } catch (err) {
      if (gen === runGen.current) {
        setError(err instanceof Error ? err.message : 'Could not summarize the household.');
      }
    } finally {
      if (gen === runGen.current) setBusy(false);
    }
  };

  const ask = async (raw: string) => {
    const q = raw.trim();
    if (!q || chatBusy) return;

    // Local search shortcut — don't call the LLM for "did I ask…" style recall.
    if (/\b(did i ask|another (pet|patient)|my chats?|what did i (ask|say|do))\b/i.test(q)) {
      setSearchQ(q.replace(/^(did i ask|what did i (ask|say|do) (about|for|regarding)?)\s*/i, '').trim() || q);
      void runSearch(
        q.replace(/^(did i ask|what did i (ask|say|do) (about|for|regarding)?)\s*/i, '').trim() || q,
      );
    }

    let src = sourceText;
    if (!src?.trim()) {
      try {
        src = await buildSource();
        setSourceText(src);
      } catch {
        setError('Household source is not ready yet.');
        return;
      }
    }
    if (!src?.trim()) {
      setError('Household source is empty.');
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
        clientName,
        clientId,
        chatScope: 'client',
        asOfDate: today,
      });
      if (!answer.trim()) throw new Error('No answer came back.');
      appendCaseHistoryChat(storageKey, { role: 'assistant', content: answer }, chatOwner);
      persistChat();
      refreshChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer from the household.');
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
          'Remove your household chat for this client? Other staff never saw it. This cannot be undone.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      clearCaseHistoryChat(storageKey, chatOwner);
      refreshChat();
      void deleteMyAssistantChat({ scope: 'client', clientId }).catch(() => undefined);
    })();
  };

  return (
    <div className="pims-emr-case-prep">
      <section className="pims-emr-prep__card pims-emr-case-prep__summary" aria-labelledby="pims-hh-summary">
        <h3 id="pims-hh-summary">
          <Sparkles size={15} aria-hidden />
          Household summary
        </h3>
        <p className="pims-emr-case-prep__chat-hint">
          Pets on this client only, plus balance and invoices.
        </p>

        {busy ? (
          <p className="pims-emr-prep__loading" role="status" aria-live="polite">
            …Loading
          </p>
        ) : null}

        {error && !summary ? (
          <p className="pims-detail__banner-error" role="alert">
            {error}
          </p>
        ) : null}

        {!busy && summary ? (
          <>
            {expanded ? (
              <pre className="pims-emr-prep__full" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {summary}
              </pre>
            ) : (
              <p className="pims-emr-prep__excerpt">{excerptText(summary)}</p>
            )}
            <p className="pims-emr-prep__meta">As of {formatAsOfLabel(today, practiceTz)}</p>
            <div className="pims-emr-story__actions">
              <button type="button" onClick={() => setExpanded((v) => !v)}>
                {expanded ? (
                  <>
                    <ChevronUp size={14} aria-hidden />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} aria-hidden />
                    See full household summary
                  </>
                )}
              </button>
              <button type="button" onClick={() => void ensureSummary(true)} disabled={busy}>
                Refresh
              </button>
            </div>
          </>
        ) : null}

        {!busy && !summary && !error ? (
          <div className="pims-emr-story__actions">
            <button type="button" className="brief-btn primary" onClick={() => void ensureSummary(true)}>
              <Sparkles size={14} aria-hidden />
              Summarize household
            </button>
          </div>
        ) : null}
      </section>

      <section className="pims-emr-prep__card pims-emr-case-prep__chat" aria-labelledby="pims-hh-chat">
        <div className="pims-emr-case-prep__chat-head">
          <h3 id="pims-hh-chat">
            <MessageSquare size={15} aria-hidden />
            Ask about this household
          </h3>
          <p className="pims-emr-case-prep__chat-hint">
            Private to your login. Pets, invoices, and ledger for this client only.
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
          <label className="pims-emr-case-prep__chat-hint" htmlFor="pims-hh-chat-search">
            Search my chats (patients + households — never other staff)
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
            <input
              id="pims-hh-chat-search"
              className="input"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="e.g. Fluffy hyperthyroid"
              disabled={searchBusy}
            />
            <button type="submit" className="brief-btn" disabled={searchBusy || searchQ.trim().length < 2}>
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

        {error && summary ? (
          <p className="pims-detail__banner-error" role="alert">
            {error}
          </p>
        ) : null}

        {chat.length === 0 ? (
          <div className="pims-emr-case-prep__starters">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                className="pims-emr-case-prep__starter"
                disabled={chatBusy}
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
                {m.role === 'user' ? 'You' : 'Household'}
              </span>
              <p style={{ whiteSpace: 'pre-wrap' }}>{m.content}</p>
            </div>
          ))}
          {chatBusy ? (
            <p className="pims-emr-case-prep__thinking" role="status">
              Looking in the household…
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
            placeholder="Ask about pets, invoices, balance, or ledger…"
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
  );
}
