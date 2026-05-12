import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronRight, FileText } from 'lucide-react';
import { searchClientsStaff, type ClientSearchRow } from '../api/clientsStaff';
import PimsClientDetailView from '../components/pims/PimsClientDetailView';
import {
  initialClientsSearchFromUrlAndSession,
  writePimsClientsSession,
} from '../utils/pimsSession';
import './PimsClientsPage.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function readList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string' || typeof item === 'number') {
        const s = String(item).trim();
        if (s) out.push(s);
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const line =
          pickStr(o.phone) ??
          pickStr(o.number) ??
          pickStr(o.email) ??
          pickStr(o.label) ??
          pickStr(o.name);
        if (line) out.push(line);
      }
    }
    return out;
  }
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return [];
}

function patientLinks(row: ClientSearchRow): { id: string | number; name: string }[] {
  const raw = (row as Record<string, unknown>).patients ?? (row as Record<string, unknown>).patientList;
  if (!Array.isArray(raw)) return [];
  const out: { id: string | number; name: string }[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const id = o.id ?? o.patientId;
    if (id == null || (typeof id !== 'string' && typeof id !== 'number')) continue;
    const name =
      pickStr(o.name) ??
      [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim() ??
      'Patient';
    out.push({ id, name });
  }
  return out;
}

function formatAddress(row: ClientSearchRow): string {
  const r = row as Record<string, unknown>;
  const label = pickStr(r.addressLabel) ?? pickStr(r.addressType) ?? 'Home';
  const line1 = pickStr(row.address1) ?? pickStr(r.addressLine1);
  const city = pickStr(row.city);
  const state = pickStr(row.state);
  const zip = pickStr(row.zip) ?? pickStr(row.zipcode);
  const country = pickStr(r.country) ?? 'US';
  const cityLine = [city, state].filter(Boolean).join(', ');
  const parts = [label, line1, [cityLine, zip].filter(Boolean).join(' '), country].filter(Boolean);
  return parts.join('\n');
}

function statusLabel(row: ClientSearchRow): { active: boolean; text: string } {
  const r = row as Record<string, unknown>;
  const st = (pickStr(r.status) ?? pickStr(r.clientStatus) ?? 'Active')!.toLowerCase();
  const inactive = st.includes('inactive') || r.isActive === false || r.active === false;
  return { active: !inactive, text: inactive ? 'Inactive' : 'Active' };
}

function classificationLine(row: ClientSearchRow): string {
  const r = row as Record<string, unknown>;
  const tags = r.tags ?? r.classifications ?? r.classification;
  if (Array.isArray(tags)) {
    return tags
      .map((t) => (typeof t === 'string' ? t : pickStr((t as Record<string, unknown>)?.name)))
      .filter(Boolean)
      .join(', ');
  }
  return pickStr(tags) ?? pickStr(r.cardOnFile) ?? '';
}

export default function PimsClientsPage() {
  const location = useLocation();
  const clientsBasePath = location.pathname.startsWith('/schedule/clients')
    ? '/schedule/clients'
    : '/pims/clients';

  const [searchParams, setSearchParams] = useSearchParams();
  const qParam = searchParams.get('q') ?? '';
  const clientIdParam = searchParams.get('clientId') ?? '';

  const [searchBy, setSearchBy] = useState('all');
  const [query, setQuery] = useState(() => initialClientsSearchFromUrlAndSession().q);
  const [includeInactive, setIncludeInactive] = useState(() => initialClientsSearchFromUrlAndSession().includeInactive);
  const [rows, setRows] = useState<ClientSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (qParam !== '' || searchParams.get('clientId')) {
      setQuery(qParam);
    }
  }, [qParam, searchParams]);

  useEffect(() => {
    writePimsClientsSession({
      q: query,
      includeInactive,
      clientId: clientIdParam,
    });
  }, [query, includeInactive, clientIdParam]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setRows([]);
        setError(null);
        return;
      }
      const id = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const list = await searchClientsStaff(trimmed, { includeInactive });
        if (seq.current !== id) return;
        setRows(list);
      } catch (e: unknown) {
        if (seq.current !== id) return;
        setRows([]);
        setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (seq.current === id) setLoading(false);
      }
    },
    [includeInactive]
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      void runSearch(query);
    }, 280);
    return () => window.clearTimeout(t);
  }, [query, runSearch]);

  const filteredRows = useMemo(() => {
    if (includeInactive) return rows;
    return rows.filter((r) => statusLabel(r).active);
  }, [rows, includeInactive]);

  const phonesFor = (row: ClientSearchRow) => {
    const r = row as Record<string, unknown>;
    return readList(r.phones ?? r.phoneNumbers ?? r.phone ?? r.mobilePhone);
  };

  const emailsFor = (row: ClientSearchRow) => {
    const r = row as Record<string, unknown>;
    return readList(r.emails ?? r.emailAddresses ?? r.email);
  };

  const lastNameDisplay = (row: ClientSearchRow) => {
    const ln = pickStr(row.lastName) ?? '';
    const note = pickStr((row as Record<string, unknown>).lastNameNote);
    return note ? `${ln} (${note})` : ln || '—';
  };

  const syncQueryToUrl = () => {
    const next = new URLSearchParams(searchParams);
    const t = query.trim();
    if (t) next.set('q', t);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const backFromDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('clientId');
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  if (clientIdParam.trim()) {
    return (
      <div className="pims-clients pims-clients--detail">
        <PimsClientDetailView clientId={clientIdParam.trim()} onBack={backFromDetail} />
      </div>
    );
  }

  return (
    <div className="pims-clients">
      <div className="pims-clients__head">
        <h1 className="pims-clients__title">Clients</h1>
        <button type="button" className="pims-clients__add">
          + Add Client
        </button>
      </div>

      <div className="pims-clients__toolbar">
        <label className="pims-clients__searchby">
          <span className="pims-clients__searchby-label">Search by</span>
          <select
            className="pims-clients__select"
            value={searchBy}
            onChange={(e) => setSearchBy(e.target.value)}
            aria-label="Search by"
          >
            <option value="all">All Results</option>
            <option value="name" disabled>
              Name (API: all)
            </option>
            <option value="phone" disabled>
              Phone (needs API)
            </option>
          </select>
        </label>
        <div className="pims-clients__search-wrap">
          <span className="pims-clients__search-icon" aria-hidden>
            🔍
          </span>
          <input
            type="search"
            className="pims-clients__search-input"
            placeholder="Search clients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => syncQueryToUrl()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') syncQueryToUrl();
            }}
          />
        </div>
        <label className="pims-clients__inactive">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include inactive
        </label>
      </div>

      <p className="pims-clients__count">
        {loading ? 'Searching…' : `${filteredRows.length} Result${filteredRows.length === 1 ? '' : 's'}`}
      </p>

      {error && <div className="pims-clients__error">{error}</div>}

      <div className="pims-clients__table-wrap">
        <table className="pims-clients__table">
          <thead>
            <tr>
              <th className="pims-clients__th-narrow" aria-label="Expand" />
              <th>Last Name</th>
              <th>First Name</th>
              <th>ID</th>
              <th>Phone Number</th>
              <th>Email</th>
              <th>Address</th>
              <th>Patient</th>
              <th>Classification</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const st = statusLabel(row);
              const pets = patientLinks(row);
              const phones = phonesFor(row);
              const emails = emailsFor(row);
              return (
                <tr key={String(row.id)}>
                  <td>
                    <button type="button" className="pims-clients__expand" aria-label="Row details (coming soon)">
                      <ChevronRight size={16} />
                    </button>
                  </td>
                  <td>
                    <span className="pims-clients__lastname">{lastNameDisplay(row)}</span>
                  </td>
                  <td>
                    <Link
                      className="pims-clients__link"
                      to={`${clientsBasePath}?clientId=${encodeURIComponent(String(row.id))}`}
                    >
                      {pickStr(row.firstName) || '—'}
                    </Link>
                  </td>
                  <td>{String(row.id)}</td>
                  <td className="pims-clients__stack">
                    {phones.length ? phones.map((p) => <div key={p}>{p}</div>) : '—'}
                  </td>
                  <td className="pims-clients__stack">
                    {emails.length ? emails.map((em) => <div key={em}>{em}</div>) : '—'}
                  </td>
                  <td className="pims-clients__addr">{formatAddress(row)}</td>
                  <td className="pims-clients__pets">
                    {pets.length ? (
                      pets.map((pet, i) => (
                        <span key={String(pet.id)}>
                          {i > 0 ? ', ' : ''}
                          <Link className="pims-clients__link" to={`/pims/patients?patientId=${encodeURIComponent(String(pet.id))}`}>
                            {pet.name}
                          </Link>
                        </span>
                      ))
                    ) : (
                      <span className="pims-clients__muted">—</span>
                    )}
                  </td>
                  <td>{classificationLine(row) || '—'}</td>
                  <td>
                    <span className="pims-clients__status">
                      <span className={`pims-clients__dot${st.active ? '' : ' pims-clients__dot--off'}`} />
                      {st.text}
                    </span>
                  </td>
                  <td>
                    <Link
                      className="pims-clients__action-link"
                      to={`${clientsBasePath}?clientId=${encodeURIComponent(String(row.id))}`}
                      aria-label="Open client"
                      title="Open"
                    >
                      <FileText size={18} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !query.trim() && (
          <p className="pims-clients__hint">Enter a search to load clients from your practice directory.</p>
        )}
      </div>
    </div>
  );
}
