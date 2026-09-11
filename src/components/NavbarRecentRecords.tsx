import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ChevronDown } from 'lucide-react';
import { useRecentRecords } from '../hooks/useRecentRecords';
import { blockRoutingCalendarPreviewNavigation } from '../utils/routingCalendarPreviewGuard';
import {
  clientHref,
  patientHref,
  type RecentKind,
  type RecentRecord,
} from '../utils/recentRecordsStore';
import './NavbarRecentRecords.css';

function currentFromLocation(
  pathname: string,
  searchParams: URLSearchParams,
  recents: RecentRecord[],
): RecentRecord | null {
  const clientId = searchParams.get('clientId')?.trim();
  const patientId = searchParams.get('patientId')?.trim();
  const soapPatient = pathname.match(/^\/schedule\/soap\/[^/]+\/([^/]+)/)?.[1];

  if (pathname.startsWith('/schedule/clients') && clientId) {
    return (
      recents.find((r) => r.kind === 'client' && r.id === clientId) ?? {
        kind: 'client',
        id: clientId,
        name: `Client #${clientId}`,
        href: clientHref(clientId),
        at: 0,
      }
    );
  }
  if (pathname.startsWith('/schedule/patients') && patientId) {
    return (
      recents.find((r) => r.kind === 'patient' && r.id === patientId) ?? {
        kind: 'patient',
        id: patientId,
        name: `Patient #${patientId}`,
        href: patientHref(patientId),
        at: 0,
      }
    );
  }
  if (soapPatient) {
    return (
      recents.find((r) => r.kind === 'patient' && r.id === soapPatient) ?? {
        kind: 'patient',
        id: soapPatient,
        name: `Patient #${soapPatient}`,
        href: patientHref(soapPatient),
        at: 0,
      }
    );
  }
  return recents[0] ?? null;
}

function kindLabel(kind: RecentKind): string {
  return kind === 'client' ? 'Client' : 'Patient';
}

function buttonPrefix(current: RecentRecord | null, onRecord: boolean): string {
  if (!current) return 'Recent';
  if (onRecord) return current.kind === 'client' ? 'Active Client' : 'Active Patient';
  return 'Recent';
}

export default function NavbarRecentRecords() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { recents } = useRecentRecords();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const onRecord = useMemo(() => {
    if (pathname.startsWith('/schedule/clients') && searchParams.get('clientId')?.trim()) return true;
    if (pathname.startsWith('/schedule/patients') && searchParams.get('patientId')?.trim()) return true;
    if (/^\/schedule\/soap\//.test(pathname)) return true;
    return false;
  }, [pathname, searchParams]);

  const current = useMemo(
    () => currentFromLocation(pathname, searchParams, recents),
    [pathname, searchParams, recents],
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function go(row: RecentRecord) {
    if (blockRoutingCalendarPreviewNavigation()) return;
    setOpen(false);
    navigate(row.href);
  }

  const prefix = buttonPrefix(current, onRecord);
  const label = current?.name ?? 'No recent records';

  return (
    <div className="navbar-recent" ref={wrapRef}>
      <button
        type="button"
        className="navbar-recent__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!recents.length}
        onClick={() => setOpen((v) => !v)}
        title={current ? `${prefix} — ${current.name}` : 'Recently opened patients and clients'}
      >
        <span className="navbar-recent__text">
          <span className="navbar-recent__prefix">{prefix}</span>
          {current ? (
            <>
              <span className="navbar-recent__sep"> — </span>
              <span className="navbar-recent__name">{label}</span>
            </>
          ) : (
            <span className="navbar-recent__empty"> — none yet</span>
          )}
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && recents.length > 0 ? (
        <div className="navbar-recent__menu" role="listbox">
          <div className="navbar-recent__hint">Patients and clients you just opened</div>
          <ul>
            {recents.map((row) => {
              const active = current?.kind === row.kind && current.id === row.id && onRecord;
              return (
                <li key={`${row.kind}:${row.id}`}>
                  <button
                    type="button"
                    className={`navbar-recent__hit${active ? ' is-on' : ''}`}
                    onClick={() => go(row)}
                  >
                    <span className="navbar-recent__hit-kind">{kindLabel(row.kind)}</span>
                    <span className="navbar-recent__hit-name">{row.name}</span>
                    {row.subtitle ? (
                      <span className="navbar-recent__hit-sub">{row.subtitle}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
