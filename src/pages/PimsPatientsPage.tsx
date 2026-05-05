import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { searchPatientsStaff, type PatientSearchRow } from '../api/patients';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import {
  initialPatientsSearchFromUrlAndSession,
  writePimsPatientsSession,
} from '../utils/pimsSession';
import PimsPatientDetailView from '../components/pims/PimsPatientDetailView';
import './PimsClientsPage.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientDisplayName(row: PatientSearchRow): string {
  const r = row as Record<string, unknown>;
  const joined = [pickStr(row.firstName), pickStr(row.lastName)].filter(Boolean).join(' ').trim();
  return (pickStr(row.name) ?? pickStr(r.patientName) ?? joined) || 'Patient';
}

function clientsForPatientRow(row: PatientSearchRow): { id: string | number; name: string }[] {
  const r = row as Record<string, unknown>;
  const owners = r.owners ?? r.clients ?? r.clientOwners;
  if (Array.isArray(owners)) {
    const out: { id: string | number; name: string }[] = [];
    for (const o of owners) {
      if (!o || typeof o !== 'object') continue;
      const c = o as Record<string, unknown>;
      const id = c.id ?? c.clientId;
      if (id == null || (typeof id !== 'string' && typeof id !== 'number')) continue;
      const name =
        [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() ||
        pickStr(c.name) ||
        `Client #${id}`;
      out.push({ id, name });
    }
    if (out.length) return out;
  }
  const c = r.client;
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    const id = o.id ?? r.clientId;
    if (id != null && (typeof id === 'string' || typeof id === 'number')) {
      const name =
        [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim() ||
        pickStr(o.name) ||
        `Client #${id}`;
      return [{ id, name }];
    }
  }
  const cid = r.clientId;
  if (cid != null && (typeof cid === 'string' || typeof cid === 'number')) {
    const ownerJoined = [pickStr(r.clientFirstName), pickStr(r.clientLastName)].filter(Boolean).join(' ').trim();
    const name =
      (pickStr(r.clientName) ?? pickStr(r.ownerName) ?? ownerJoined) || `Client #${cid}`;
    return [{ id: cid, name }];
  }
  return [];
}

function sexDisplay(row: PatientSearchRow): string {
  const r = row as Record<string, unknown>;
  const combined = pickStr(r.sexDescription) ?? pickStr(r.sexAndNeuter);
  if (combined) return combined;
  const sex = pickStr(r.sex) ?? pickStr(r.gender) ?? '';
  const nn =
    pickStr(r.neuterStatus) ??
    pickStr(r.spayNeuterStatus) ??
    pickStr(r.alteredStatus) ??
    pickStr(r.altered);
  if (sex && nn) return `${sex} ${nn}`;
  if (sex) return sex;
  if (nn) return nn;
  return '—';
}

function patientListStatus(row: PatientSearchRow): { active: boolean; text: string } {
  const r = row as Record<string, unknown>;
  const st = (pickStr(r.status) ?? pickStr(r.patientStatus) ?? '').toLowerCase();
  if (st.includes('euthan') || st.includes('deceas') || st.includes('died')) {
    return { active: false, text: 'Inactive' };
  }
  if (r.isActive === false || r.active === false || st.includes('inactive')) {
    return { active: false, text: 'Inactive' };
  }
  return { active: true, text: 'Active' };
}

export default function PimsPatientsPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);

  const [searchParams, setSearchParams] = useSearchParams();
  const qParam = searchParams.get('q') ?? '';
  const patientIdParam = searchParams.get('patientId') ?? '';

  const [searchBy, setSearchBy] = useState('all');
  const [query, setQuery] = useState(() => initialPatientsSearchFromUrlAndSession().q);
  const [includeInactive, setIncludeInactive] = useState(() => initialPatientsSearchFromUrlAndSession().includeInactive);
  const [rows, setRows] = useState<PatientSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (qParam !== '' || searchParams.get('patientId')) {
      setQuery(qParam);
    }
  }, [qParam, searchParams]);

  useEffect(() => {
    writePimsPatientsSession({
      q: query,
      includeInactive,
      patientId: patientIdParam,
    });
  }, [query, includeInactive, patientIdParam]);

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
        const list = await searchPatientsStaff(trimmed, {
          practiceId,
          activeOnly: !includeInactive,
        });
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
    [includeInactive, practiceId]
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      void runSearch(query);
    }, 280);
    return () => window.clearTimeout(t);
  }, [query, runSearch]);

  const syncQueryToUrl = () => {
    const next = new URLSearchParams(searchParams);
    const t = query.trim();
    if (t) next.set('q', t);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const backFromDetail = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('patientId');
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  if (patientIdParam.trim()) {
    return (
      <div className="pims-clients pims-clients--detail">
        <PimsPatientDetailView patientId={patientIdParam.trim()} onBack={backFromDetail} />
      </div>
    );
  }

  return (
    <div className="pims-clients">
      <div className="pims-clients__head">
        <h1 className="pims-clients__title">Patients</h1>
        <button type="button" className="pims-clients__add">
          + Add Patient
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
          </select>
        </label>
        <div className="pims-clients__search-wrap">
          <span className="pims-clients__search-icon" aria-hidden>
            🔍
          </span>
          <input
            type="search"
            className="pims-clients__search-input"
            placeholder="Search patients…"
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
        {loading ? 'Searching…' : `${rows.length} Result${rows.length === 1 ? '' : 's'}`}
      </p>

      {error && <div className="pims-clients__error">{error}</div>}

      <div className="pims-clients__table-wrap">
        <table className="pims-clients__table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Patient&apos;s Name</th>
              <th>Client(s)</th>
              <th>Sex</th>
              <th>Species</th>
              <th>Breed</th>
              <th>Rabies Tag</th>
              <th>Microchip</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const st = patientListStatus(row);
              const r = row as Record<string, unknown>;
              const species = pickStr(r.species) ?? pickStr(r.speciesName) ?? '—';
              const breed = pickStr(r.breed) ?? pickStr(r.breedDescription) ?? '—';
              const rabies = pickStr(r.rabiesTag) ?? pickStr(r.rabies_tag) ?? '—';
              const micro = pickStr(r.microchip) ?? pickStr(r.microchipNumber) ?? '—';
              const clients = clientsForPatientRow(row);
              return (
                <tr key={String(row.id)}>
                  <td>{String(row.id)}</td>
                  <td>
                    <Link
                      className="pims-clients__petname"
                      to={`/pims/patients?patientId=${encodeURIComponent(String(row.id))}`}
                    >
                      {patientDisplayName(row)}
                    </Link>
                  </td>
                  <td className="pims-clients__stack">
                    {clients.length ? (
                      clients.map((c) => (
                        <div key={String(c.id)}>
                          <Link className="pims-clients__link" to={`/pims/clients?clientId=${encodeURIComponent(String(c.id))}`}>
                            {c.name}
                          </Link>
                        </div>
                      ))
                    ) : (
                      <span className="pims-clients__muted">—</span>
                    )}
                  </td>
                  <td>{sexDisplay(row)}</td>
                  <td>{species}</td>
                  <td>{breed}</td>
                  <td>{rabies}</td>
                  <td>{micro || '—'}</td>
                  <td>
                    <span className="pims-clients__status">
                      <span
                        className={
                          st.active ? 'pims-clients__dot' : 'pims-clients__dot pims-clients__dot--inactive'
                        }
                      />
                      {st.text}
                    </span>
                  </td>
                  <td>
                    <Link
                      className="pims-clients__action-link"
                      to={`/pims/patients?patientId=${encodeURIComponent(String(row.id))}`}
                      aria-label="Open patient"
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
          <p className="pims-clients__hint">Enter a search to load patients from your practice directory.</p>
        )}
      </div>
    </div>
  );
}
