import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { searchPimsClientsAndPatients, type PimsPatientSearchHit } from '../api/pimsSearch';
import type { ClientSearchRow } from '../api/clientsStaff';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './NavbarGlobalSearch.css';

export default function NavbarGlobalSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);

  const inSchedule = pathname.startsWith('/schedule');
  const clientsBase = inSchedule ? '/schedule/clients' : '/pims/clients';
  const patientsBase = inSchedule ? '/schedule/patients' : '/pims/patients';
  const onPatientsArea =
    pathname.startsWith('/pims/patients') || pathname.startsWith('/schedule/patients');

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<ClientSearchRow[]>([]);
  const [patients, setPatients] = useState<PimsPatientSearchHit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = q.trim();
    if (!t) {
      setClients([]);
      setPatients([]);
      setErr(null);
      setOpen(false);
      return;
    }
    const id = ++seq.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await searchPimsClientsAndPatients(t, { practiceId, activeOnly: true });
        if (seq.current !== id) return;
        setClients(r.clients);
        setPatients(r.patients);
        setOpen(true);
      } catch (e: unknown) {
        if (seq.current !== id) return;
        setClients([]);
        setPatients([]);
        setErr(e instanceof Error ? e.message : 'Search failed');
        setOpen(true);
      } finally {
        if (seq.current === id) setLoading(false);
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [q, practiceId]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const goClient = useCallback(
    (id: string | number) => {
      setOpen(false);
      setQ('');
      navigate(`${clientsBase}?clientId=${encodeURIComponent(String(id))}`);
    },
    [navigate, clientsBase]
  );

  const goPatient = useCallback(
    (id: string | number) => {
      setOpen(false);
      setQ('');
      navigate(`${patientsBase}?patientId=${encodeURIComponent(String(id))}`);
    },
    [navigate, patientsBase]
  );

  const goClientsSearch = useCallback(() => {
    const t = q.trim();
    if (!t) {
      navigate(clientsBase);
      return;
    }
    setOpen(false);
    navigate(`${clientsBase}?q=${encodeURIComponent(t)}`);
  }, [navigate, q, clientsBase]);

  const goPatientsSearch = useCallback(() => {
    const t = q.trim();
    if (!t) {
      navigate(patientsBase);
      return;
    }
    setOpen(false);
    navigate(`${patientsBase}?q=${encodeURIComponent(t)}`);
  }, [navigate, q, patientsBase]);

  const goAdvancedSearch = useCallback(() => {
    if (onPatientsArea) goPatientsSearch();
    else goClientsSearch();
  }, [goClientsSearch, goPatientsSearch, onPatientsArea]);

  return (
    <div className="navbar-global-search" ref={wrapRef}>
      <div className="navbar-global-search__field">
        <input
          type="search"
          placeholder="Search clients, patients, phone…"
          aria-label="Global search"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q.trim() && (clients.length > 0 || patients.length > 0 || err) && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              goAdvancedSearch();
            }
          }}
        />
        {loading && <span className="navbar-global-search__loading">Searching…</span>}
      </div>
      {open && (q.trim() || err) && (
        <div className="navbar-global-search__dropdown" role="listbox">
          {err && <div className="navbar-global-search__msg">{err}</div>}
          {!err && clients.length === 0 && patients.length === 0 && !loading && q.trim() && (
            <div className="navbar-global-search__msg">No matches.</div>
          )}
          {clients.length > 0 && (
            <div className="navbar-global-search__section">
              <div className="navbar-global-search__heading">Clients</div>
              <ul>
                {clients.slice(0, 8).map((c) => (
                  <li key={`c-${c.id}`}>
                    <button type="button" className="navbar-global-search__hit" onClick={() => goClient(c.id)}>
                      <span className="navbar-global-search__hit-name">
                        {[c.firstName, c.lastName].filter(Boolean).join(' ') || `Client #${c.id}`}
                      </span>
                      <span className="navbar-global-search__hit-meta">#{String(c.id)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {patients.length > 0 && (
            <div className="navbar-global-search__section">
              <div className="navbar-global-search__heading">Patients</div>
              <ul>
                {patients.slice(0, 8).map((p) => (
                  <li key={`p-${p.id}`}>
                    <button type="button" className="navbar-global-search__hit" onClick={() => goPatient(p.id)}>
                      <span className="navbar-global-search__hit-name">{p.name}</span>
                      {p.clientLabel && (
                        <span className="navbar-global-search__hit-meta">Owner: {p.clientLabel}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="navbar-global-search__footer">
            <button type="button" className="navbar-global-search__see-all" onClick={goClientsSearch}>
              See all in Clients…
            </button>
            <button type="button" className="navbar-global-search__see-all" onClick={goPatientsSearch}>
              See all in Patients…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
