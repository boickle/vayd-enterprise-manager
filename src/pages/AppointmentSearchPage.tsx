import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import {
  searchPimsClientsAndPatients,
  type PimsPatientSearchHit,
} from '../api/pimsSearch';
import type { ClientSearchRow } from '../api/clientsStaff';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import AppointmentSearchHistory from '../components/pims/AppointmentSearchHistory';
import './PimsClientsPage.css';
import './AppointmentSearchPage.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function clientDisplayName(row: ClientSearchRow): string {
  const parts = [pickStr(row.firstName), pickStr(row.lastName)].filter(Boolean);
  return parts.join(' ') || `Client #${row.id}`;
}

function clientStatusActive(row: ClientSearchRow): boolean {
  const r = row as Record<string, unknown>;
  const st = (pickStr(r.status) ?? pickStr(r.clientStatus) ?? 'Active')!.toLowerCase();
  return !(st.includes('inactive') || r.isActive === false || r.active === false);
}

export default function AppointmentSearchPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token) ?? 1, [token]);
  const [searchParams, setSearchParams] = useSearchParams();

  const qParam = searchParams.get('q') ?? '';
  const clientIdParam = searchParams.get('clientId') ?? '';
  const patientIdParam = searchParams.get('patientId') ?? '';
  const clientLabelParam = searchParams.get('clientLabel') ?? '';
  const patientLabelParam = searchParams.get('patientLabel') ?? '';

  const [query, setQuery] = useState(qParam);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [clients, setClients] = useState<ClientSearchRow[]>([]);
  const [patients, setPatients] = useState<PimsPatientSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    setQuery(qParam);
  }, [qParam]);

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setClients([]);
        setPatients([]);
        setError(null);
        return;
      }
      const id = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const result = await searchPimsClientsAndPatients(trimmed, {
          practiceId,
          activeOnly: !includeInactive,
        });
        if (seq.current !== id) return;
        setClients(result.clients);
        setPatients(result.patients);
      } catch (e: unknown) {
        if (seq.current !== id) return;
        setClients([]);
        setPatients([]);
        setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (seq.current === id) setLoading(false);
      }
    },
    [includeInactive, practiceId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  const filteredClients = useMemo(() => {
    if (includeInactive) return clients;
    return clients.filter(clientStatusActive);
  }, [clients, includeInactive]);

  const syncQueryToUrl = useCallback(
    (nextQuery: string) => {
      const next = new URLSearchParams(searchParams);
      const trimmed = nextQuery.trim();
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const selectClient = useCallback(
    (row: ClientSearchRow) => {
      const next = new URLSearchParams(searchParams);
      next.set('clientId', String(row.id));
      next.set('clientLabel', clientDisplayName(row));
      next.delete('patientId');
      next.delete('patientLabel');
      if (query.trim()) next.set('q', query.trim());
      setSearchParams(next, { replace: false });
    },
    [query, searchParams, setSearchParams],
  );

  const selectPatient = useCallback(
    (row: PimsPatientSearchHit) => {
      const next = new URLSearchParams(searchParams);
      next.set('patientId', String(row.id));
      next.set(
        'patientLabel',
        row.clientLabel ? `${row.name} (${row.clientLabel})` : row.name,
      );
      next.delete('clientId');
      next.delete('clientLabel');
      if (query.trim()) next.set('q', query.trim());
      setSearchParams(next, { replace: false });
    },
    [query, searchParams, setSearchParams],
  );

  const clearSelection = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('clientId');
    next.delete('clientLabel');
    next.delete('patientId');
    next.delete('patientLabel');
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  const handleQueryChange = useCallback(
    (next: string) => {
      setQuery(next);
      if (!clientIdParam.trim() && !patientIdParam.trim()) return;
      const params = new URLSearchParams(searchParams);
      params.delete('clientId');
      params.delete('clientLabel');
      params.delete('patientId');
      params.delete('patientLabel');
      const trimmed = next.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      setSearchParams(params, { replace: true });
    },
    [clientIdParam, patientIdParam, searchParams, setSearchParams],
  );

  const selectedLabel = patientIdParam.trim()
    ? patientLabelParam.trim() || `Patient #${patientIdParam}`
    : clientIdParam.trim()
      ? clientLabelParam.trim() || `Client #${clientIdParam}`
      : null;

  const showResults = Boolean(query.trim()) && !selectedLabel;

  return (
    <div className="appt-search-page pims-clients">
      <header className="appt-search-page__head">
        <h1 className="appt-search-page__title">Appointment Search</h1>
        <p className="appt-search-page__subtitle">
          Search by client or patient name — future appointments first, one row per pet.
        </p>
      </header>

      <div className="pims-clients__toolbar">
        <div className="pims-clients__search-wrap">
          <Search className="pims-clients__search-icon" size={18} aria-hidden />
          <input
            className="pims-clients__search-input"
            type="search"
            value={query}
            placeholder="Client or patient name…"
            aria-label="Search clients and patients"
            onChange={(e) => {
              handleQueryChange(e.target.value);
            }}
            onBlur={() => syncQueryToUrl(query)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') syncQueryToUrl(query);
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

      {selectedLabel ? (
        <div className="appt-search-page__selected">
          <p className="appt-search-page__selected-label">
            Showing appointments for <strong>{selectedLabel}</strong>
          </p>
          <button type="button" className="appt-search-page__clear" onClick={clearSelection}>
            Change selection
          </button>
        </div>
      ) : null}

      {selectedLabel && clientIdParam.trim() ? (
        <AppointmentSearchHistory
          variant="client"
          clientId={clientIdParam.trim()}
          practiceId={practiceId}
        />
      ) : null}

      {selectedLabel && patientIdParam.trim() ? (
        <AppointmentSearchHistory
          variant="patient"
          patientId={patientIdParam.trim()}
          practiceId={practiceId}
        />
      ) : null}

      {!selectedLabel && showResults ? (
        <>
          {loading ? <p className="pims-clients__hint">Searching…</p> : null}
          {error ? (
            <p className="pims-clients__error" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !error && filteredClients.length === 0 && patients.length === 0 ? (
            <p className="pims-clients__hint">No clients or patients matched that search.</p>
          ) : null}

          {filteredClients.length > 0 ? (
            <>
              <p className="appt-search-page__results-head">Clients ({filteredClients.length})</p>
              <div className="pims-clients__table-wrap">
                <table className="pims-clients__table">
                  <thead>
                    <tr>
                      <th>Last name</th>
                      <th>First name</th>
                      <th>Phone</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((row) => (
                      <tr key={String(row.id)}>
                        <td>
                          <button
                            type="button"
                            className="appt-search-page__pick-btn"
                            onClick={() => selectClient(row)}
                          >
                            {pickStr(row.lastName) ?? '—'}
                          </button>
                        </td>
                        <td>{pickStr(row.firstName) ?? '—'}</td>
                        <td>{pickStr((row as Record<string, unknown>).phone1 as string) ?? '—'}</td>
                        <td>{clientStatusActive(row) ? 'Active' : 'Inactive'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {patients.length > 0 ? (
            <>
              <p className="appt-search-page__results-head">Patients ({patients.length})</p>
              <div className="pims-clients__table-wrap">
                <table className="pims-clients__table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Client</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patients.map((row) => (
                      <tr key={String(row.id)}>
                        <td>
                          <button
                            type="button"
                            className="appt-search-page__pick-btn"
                            onClick={() => selectPatient(row)}
                          >
                            {row.name}
                          </button>
                        </td>
                        <td>{row.clientLabel ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {!selectedLabel && !query.trim() ? (
        <p className="pims-clients__hint">Type a name to search clients and patients.</p>
      ) : null}
    </div>
  );
}
