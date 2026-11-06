import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown, PawPrint, User } from 'lucide-react';
import {
  fetchGmailClientMatches,
  type GmailRecordClientMatch,
  type GmailThreadMessage,
} from '../../api/gmail';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import { clientHref, patientHref } from '../../utils/recentRecordsStore';

type Props = {
  threadMessages: GmailThreadMessage[];
  threadLoading: boolean;
  /** Used when the full thread couldn't load. */
  fallbackEmails: string[];
};

const ADDRESS_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function threadEmails(messages: GmailThreadMessage[], fallback: string[]): string[] {
  const raw = messages.length
    ? messages.flatMap((m) => [m.headers?.from, m.headers?.to, m.headers?.cc, m.headers?.replyTo])
    : fallback;
  return [...new Set(raw.flatMap((h) => String(h ?? '').match(ADDRESS_RE) ?? []).map((e) => e.toLowerCase()))];
}

type MenuKind = 'client' | 'patient' | null;

export default function GmailGoToRecord({ threadMessages, threadLoading, fallbackEmails }: Props) {
  const navigate = useNavigate();
  const emails = useMemo(
    () => threadEmails(threadMessages, fallbackEmails),
    [threadMessages, fallbackEmails],
  );
  const emailKey = threadLoading ? null : emails.join(',');
  const [matches, setMatches] = useState<GmailRecordClientMatch[] | null>(null);
  const [menu, setMenu] = useState<MenuKind>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (emailKey === null) return;
    let cancelled = false;
    setMatches(null);
    setMenu(null);
    fetchGmailClientMatches(currentPracticeId(), emails)
      .then((rows) => {
        if (!cancelled) setMatches(rows);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailKey]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const clients = matches ?? [];
  const patients = clients.flatMap((c) => c.patients.map((p) => ({ ...p, client: c })));
  const loading = matches === null;
  const noClient = !loading && clients.length === 0;
  const noTitle = noClient ? 'No client in Scout has an email from this thread' : undefined;

  const goClient = () => {
    if (clients.length === 1) navigate(clientHref(clients[0].clientId));
    else setMenu((m) => (m === 'client' ? null : 'client'));
  };

  const goPatient = () => {
    if (patients.length === 1) navigate(patientHref(patients[0].id));
    else setMenu((m) => (m === 'patient' ? null : 'patient'));
  };

  return (
    <div className="gmail-goto" ref={rootRef}>
      <button
        type="button"
        className="gmail-goto__btn"
        disabled={loading || noClient}
        title={noTitle ?? (clients.length === 1 ? `Open ${clients[0].name}` : undefined)}
        onClick={goClient}
        aria-haspopup={clients.length > 1 ? 'menu' : undefined}
        aria-expanded={menu === 'client'}
      >
        <User size={15} strokeWidth={1.9} aria-hidden />
        <span className="gmail-goto__label">Go to client</span>
        {clients.length > 1 ? <ChevronDown size={14} aria-hidden /> : null}
      </button>
      <button
        type="button"
        className="gmail-goto__btn"
        disabled={loading || patients.length === 0}
        title={
          noTitle ??
          (patients.length === 0 ? 'This household has no patients' : undefined)
        }
        onClick={goPatient}
        aria-haspopup={patients.length > 1 ? 'menu' : undefined}
        aria-expanded={menu === 'patient'}
      >
        <PawPrint size={15} strokeWidth={1.9} aria-hidden />
        <span className="gmail-goto__label">Go to patient</span>
        {patients.length > 1 ? <ChevronDown size={14} aria-hidden /> : null}
      </button>

      {menu === 'client' ? (
        <div className="gmail-goto__menu" role="menu">
          {clients.map((c) => (
            <button
              key={c.clientId}
              type="button"
              role="menuitem"
              className="gmail-goto__item"
              onClick={() => navigate(clientHref(c.clientId))}
            >
              <strong>{c.name}</strong>
              <span>
                {c.matchedEmail ?? c.email ?? ''} · {c.patients.length} pet{c.patients.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {menu === 'patient' ? (
        <div className="gmail-goto__menu gmail-goto__menu--patients" role="menu">
          {clients.map((c) =>
            c.patients.length ? (
              <div key={c.clientId} className="gmail-goto__group">
                {clients.length > 1 ? <div className="gmail-goto__group-title">{c.name}</div> : null}
                {c.patients.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className={`gmail-goto__item${p.isActive ? '' : ' is-inactive'}`}
                    onClick={() => navigate(patientHref(p.id))}
                  >
                    <strong>{p.name}</strong>
                    <span>
                      {[p.species, p.isActive ? null : p.status ?? 'Inactive'].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}
