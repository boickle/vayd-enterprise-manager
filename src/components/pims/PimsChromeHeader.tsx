import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../../auth/useAuth';
import { searchPimsClientsAndPatients, type PimsPatientSearchHit } from '../../api/pimsSearch';
import type { ClientSearchRow } from '../../api/clientsStaff';
import { resolvePracticeIdFromToken } from '../../utils/practiceIdFromToken';

export default function PimsChromeHeader() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onPatientsArea = pathname.startsWith('/pims/patients');
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);

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
      navigate(`/pims/clients?clientId=${encodeURIComponent(String(id))}`);
    },
    [navigate]
  );

  const goPatient = useCallback(
    (id: string | number) => {
      setOpen(false);
      setQ('');
      navigate(`/pims/patients?patientId=${encodeURIComponent(String(id))}`);
    },
    [navigate]
  );

  const goClientsSearch = useCallback(() => {
    const t = q.trim();
    if (!t) {
      navigate('/pims/clients');
      return;
    }
    setOpen(false);
    navigate(`/pims/clients?q=${encodeURIComponent(t)}`);
  }, [navigate, q]);

  const goPatientsSearch = useCallback(() => {
    const t = q.trim();
    if (!t) {
      navigate('/pims/patients');
      return;
    }
    setOpen(false);
    navigate(`/pims/patients?q=${encodeURIComponent(t)}`);
  }, [navigate, q]);

  const goAdvancedSearch = useCallback(() => {
    if (onPatientsArea) goPatientsSearch();
    else goClientsSearch();
  }, [goClientsSearch, goPatientsSearch, onPatientsArea]);

  return (
    <header className="pims-app-bar">
      <div className="pims-app-bar__brand">Vet At Your Door</div>
      <div className="pims-app-bar__search" ref={wrapRef}>
        <div className="pims-app-bar__search-inner">
          <Search size={18} className="pims-app-bar__search-icon" aria-hidden />
          <input
            type="search"
            className="pims-app-bar__input"
            placeholder="Search by patient, client, phone, etc."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => q.trim() && (clients.length > 0 || patients.length > 0 || err) && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                goAdvancedSearch();
              }
            }}
            aria-label="Search clients and patients"
          />
          {loading && <span className="pims-app-bar__loading">Searching…</span>}
        </div>
        <button type="button" className="pims-app-bar__advanced" onClick={goAdvancedSearch}>
          Advanced Search
        </button>
        {open && (q.trim() || err) && (
          <div className="pims-app-bar__dropdown" role="listbox">
            {err && <div className="pims-app-bar__dropdown-msg">{err}</div>}
            {!err && clients.length === 0 && patients.length === 0 && !loading && q.trim() && (
              <div className="pims-app-bar__dropdown-msg">No matches.</div>
            )}
            {clients.length > 0 && (
              <div className="pims-app-bar__dropdown-section">
                <div className="pims-app-bar__dropdown-heading">Clients</div>
                <ul>
                  {clients.slice(0, 8).map((c) => (
                    <li key={`c-${c.id}`}>
                      <button type="button" className="pims-app-bar__hit" onClick={() => goClient(c.id)}>
                        <span className="pims-app-bar__hit-name">
                          {[c.firstName, c.lastName].filter(Boolean).join(' ') || `Client #${c.id}`}
                        </span>
                        <span className="pims-app-bar__hit-meta">#{String(c.id)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {patients.length > 0 && (
              <div className="pims-app-bar__dropdown-section">
                <div className="pims-app-bar__dropdown-heading">Patients</div>
                <ul>
                  {patients.slice(0, 8).map((p) => (
                    <li key={`p-${p.id}`}>
                      <button type="button" className="pims-app-bar__hit" onClick={() => goPatient(p.id)}>
                        <span className="pims-app-bar__hit-name">{p.name}</span>
                        {p.clientLabel && (
                          <span className="pims-app-bar__hit-meta">Owner: {p.clientLabel}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="pims-app-bar__dropdown-footer pims-app-bar__dropdown-footer--split">
              <button type="button" className="pims-app-bar__see-all" onClick={goClientsSearch}>
                See all in Clients…
              </button>
              <button type="button" className="pims-app-bar__see-all" onClick={goPatientsSearch}>
                See all in Patients…
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="pims-app-bar__actions">
        <button type="button" className="pims-app-bar__task-btn" onClick={() => navigate('/pims/tasks?new=1')}>
          + Task
        </button>
      </div>
    </header>
  );
}
