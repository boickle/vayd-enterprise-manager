import { useEffect, useRef, useState } from 'react';
import { Field } from '../components/Field';
import { http } from '../api/http';
import { sendExitSurveyInvite } from '../api/survey';
import './Settings.css';

const EXIT_SURVEY_SLUG = 'exit-interview';

type SearchClient = {
  id: string;
  firstName: string;
  lastName: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
};

function clientLabel(c: SearchClient) {
  const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Client';
  const loc = [c.city, c.state].filter(Boolean).join(', ');
  const extra = loc || c.address1 || c.zip;
  return extra ? `${name} — ${extra}` : name;
}

export default function ExitSurveyPage() {
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<SearchClient[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<SearchClient | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ sentTo: string; surveyUrl: string } | null>(null);

  const clientBoxRef = useRef<HTMLDivElement | null>(null);
  const latestClientQueryRef = useRef('');
  const [clientActiveIdx, setClientActiveIdx] = useState(-1);

  useEffect(() => {
    const q = (clientQuery ?? '').trim();
    latestClientQueryRef.current = q;
    if (!q) {
      setClientResults([]);
      setShowClientDropdown(false);
      return;
    }
    const t = window.setTimeout(async () => {
      setClientSearching(true);
      try {
        const { data } = await http.get('/clients/search', { params: { q } });
        if (latestClientQueryRef.current === q) {
          setClientResults(Array.isArray(data) ? data : []);
          setShowClientDropdown(true);
        }
      } catch (e) {
        console.error('Client search failed', e);
      } finally {
        setClientSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [clientQuery]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (clientBoxRef.current && !clientBoxRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pickClient(c: SearchClient) {
    setSelectedClient(c);
    setClientQuery(clientLabel(c));
    setClientResults([]);
    setShowClientDropdown(false);
    setClientActiveIdx(-1);
    setError(null);
    setSuccess(null);
  }

  const clientNumericId = selectedClient ? Number(selectedClient.id) : NaN;
  const canSend = selectedClient && Number.isFinite(clientNumericId);

  async function doSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await sendExitSurveyInvite({
        surveySlug: EXIT_SURVEY_SLUG,
        clientId: clientNumericId,
      });
      setSuccess({ sentTo: res.sentTo, surveyUrl: res.surveyUrl });
      setConfirmOpen(false);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Failed to send exit survey';
      setError(String(msg));
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8 }}>
        Exit survey invite
      </h2>
      <p className="settings-muted" style={{ marginBottom: 20, maxWidth: 640 }}>
        Search for a client, then send the exit interview link to their email on file.
      </p>

      {success && (
        <div
          className="settings-muted"
          style={{
            marginBottom: 16,
            padding: 12,
            background: '#ecfdf5',
            borderRadius: 8,
            color: '#065f46',
          }}
        >
          <strong>Sent.</strong> Delivered to {success.sentTo}.
          {success.surveyUrl && (
            <>
              {' '}
              <a href={success.surveyUrl} target="_blank" rel="noreferrer">
                Open survey link
              </a>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="settings-muted" style={{ color: '#b91c1c', marginBottom: 12 }}>
          {error}
        </p>
      )}

      <div ref={clientBoxRef} style={{ position: 'relative', maxWidth: 480, marginBottom: 20 }}>
        <Field label="Client">
          <input
            className="input"
            type="search"
            autoComplete="off"
            placeholder="Search by name or address…"
            value={clientQuery}
            onChange={(e) => {
              setClientQuery(e.target.value);
              setSelectedClient(null);
              setSuccess(null);
              setError(null);
              setClientActiveIdx(-1);
            }}
            onFocus={() => clientResults.length > 0 && setShowClientDropdown(true)}
            onKeyDown={(e) => {
              if (!showClientDropdown || clientResults.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setClientActiveIdx((i) => (i < clientResults.length - 1 ? i + 1 : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setClientActiveIdx((i) => (i <= 0 ? clientResults.length - 1 : i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const pick =
                  clientActiveIdx >= 0 ? clientResults[clientActiveIdx] : clientResults[0];
                if (pick) pickClient(pick);
              } else if (e.key === 'Escape') {
                setShowClientDropdown(false);
              }
            }}
          />
        </Field>
        {clientSearching && (
          <div className="muted" style={{ marginTop: 6 }}>
            Searching…
          </div>
        )}
        {showClientDropdown && clientResults.length > 0 && (
          <ul
            className="dropdown"
            role="listbox"
            style={{
              position: 'absolute',
              top: '100%',
              marginTop: 6,
              left: 0,
              right: 0,
              zIndex: 20,
              maxHeight: 280,
              overflow: 'auto',
            }}
          >
            {clientResults.map((c, idx) => (
              <li
                key={c.id}
                role="option"
                aria-selected={idx === clientActiveIdx}
                className={idx === clientActiveIdx ? 'dropdown-item is-active' : 'dropdown-item'}
                style={{ cursor: 'pointer', padding: '8px 12px' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickClient(c)}
              >
                {clientLabel(c)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedClient && (
        <div style={{ marginTop: 24 }}>
          <button
            type="button"
            className="btn primary"
            disabled={!canSend || sending}
            onClick={() => setConfirmOpen(true)}
          >
            Send exit survey
          </button>
        </div>
      )}

      {confirmOpen && selectedClient && (
        <div
          className="settings-modal-overlay"
          onClick={() => !sending && setConfirmOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-survey-confirm-title"
        >
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3 id="exit-survey-confirm-title">Send exit survey?</h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={() => !sending && setConfirmOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body">
              <p className="settings-muted" style={{ marginBottom: 16 }}>
                Send the exit interview survey link to the email on file for{' '}
                <strong>{clientLabel(selectedClient)}</strong>?
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={sending}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button type="button" className="btn primary" disabled={sending} onClick={() => void doSend()}>
                  {sending ? 'Sending…' : 'Yes, send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
