import { useEffect, useMemo, useRef, useState } from 'react';
import { Field } from '../components/Field';
import { http } from '../api/http';
import {
  fetchClientMembershipSavings,
  type ClientPortalPetSavings,
  type LastMembershipEmail,
} from '../api/membershipSavings';
import {
  MULTI_PET_CREDIT_USD,
  PetSavingsCard,
  cardStyle,
  formatUsd,
} from '../components/MembershipSavingsCard';
import './Settings.css';

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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function lastEmailSentence(email: LastMembershipEmail): string {
  const which =
    email.kind === 'post_appointment_membership'
      ? 'after-visit membership email'
      : 'pre-visit membership email';
  const opened = email.openedAt ? ` Opened ${formatDateTime(email.openedAt)}.` : ' Not opened yet.';
  return `Last ${which} sent ${formatDateTime(email.sentAt)}.${opened}`;
}

export default function MembershipComparisonPage() {
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<SearchClient[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<SearchClient | null>(null);
  const [clientActiveIdx, setClientActiveIdx] = useState(-1);
  const [pets, setPets] = useState<ClientPortalPetSavings[] | null>(null);
  const [lastEmail, setLastEmail] = useState<LastMembershipEmail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientBoxRef = useRef<HTMLDivElement | null>(null);
  const latestClientQueryRef = useRef('');

  useEffect(() => {
    const q = (clientQuery ?? '').trim();
    latestClientQueryRef.current = q;
    if (!q || selectedClient) {
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
  }, [clientQuery, selectedClient]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (clientBoxRef.current && !clientBoxRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!selectedClient) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setPets(null);
    setLastEmail(null);
    fetchClientMembershipSavings(selectedClient.id)
      .then((res) => {
        if (!alive) return;
        setPets(res.pets);
        setLastEmail(res.lastEmail);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Failed to load membership comparison';
        setError(String(msg));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectedClient]);

  function pickClient(c: SearchClient) {
    setSelectedClient(c);
    setClientQuery(clientLabel(c));
    setClientResults([]);
    setShowClientDropdown(false);
    setClientActiveIdx(-1);
  }

  const ordered = useMemo(() => {
    if (!pets) return [];
    return [...pets.filter((p) => p.estimate), ...pets.filter((p) => !p.estimate)];
  }, [pets]);

  const totalCovered = (pets ?? []).reduce((sum, p) => sum + (p.estimate?.coveredAmount ?? 0), 0);

  return (
    <div>
      <h2 className="settings-title" style={{ fontSize: '1.25rem', marginTop: 8 }}>
        Membership comparison
      </h2>
      <p className="settings-muted" style={{ marginBottom: 20, maxWidth: 680 }}>
        Search for a client to see the same membership breakdown they see in their membership emails
        and the Client Portal. Each pet is compared using its upcoming visit&apos;s room loader
        selections when submitted, otherwise its most recent wellness visit with vaccines.
      </p>

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
              setPets(null);
              setLastEmail(null);
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
                onKeyDown={(e) => e.key === 'Enter' && pickClient(c)}
              >
                {clientLabel(c)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="settings-muted" style={{ color: '#b91c1c', marginBottom: 12 }}>
          {error}
        </p>
      )}
      {loading && <div className="settings-muted">Loading membership comparison…</div>}

      {selectedClient && pets != null && (
        <div style={{ maxWidth: 880 }}>
          <p className="settings-muted" style={{ marginBottom: 16 }}>
            {lastEmail
              ? lastEmailSentence(lastEmail)
              : 'No membership email has been sent to this client yet.'}
          </p>

          {pets.length === 0 ? (
            <div style={cardStyle}>
              All of this client&apos;s active pets are already members, or there are no active pets
              on file.
            </div>
          ) : (
            <>
              {totalCovered > 0 && ordered.filter((p) => p.estimate).length > 1 && (
                <div
                  style={{
                    ...cardStyle,
                    background: '#F3FAF6',
                    borderColor: '#c9e3d6',
                    marginBottom: 16,
                    fontSize: 17,
                    fontWeight: 600,
                    color: '#14532d',
                  }}
                >
                  Together, membership would cover {formatUsd(totalCovered)} of these visits.
                </div>
              )}
              {pets.length > 1 && (
                <p
                  style={{
                    margin: '0 0 16px',
                    padding: '10px 12px',
                    fontSize: 15,
                    color: '#166534',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: 8,
                    lineHeight: 1.5,
                  }}
                >
                  Each additional pet enrolled gets a ${MULTI_PET_CREDIT_USD} multi-pet credit
                  toward a future visit. It never expires.
                </p>
              )}
              <div style={{ display: 'grid', gap: 18 }}>
                {ordered.map((pet) => (
                  <PetSavingsCard key={pet.patientId} pet={pet} highlighted={false} />
                ))}
              </div>
              <p className="settings-muted" style={{ marginTop: 18 }}>
                Estimates use current prices and may differ from the final bill.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
