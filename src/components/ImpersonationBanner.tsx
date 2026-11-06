import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { stopImpersonation } from '../api/impersonation';
import { leaveImpersonation, readImpersonation } from '../auth/impersonationSession';
import './ImpersonationBanner.css';

function remaining(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Shown on every page while a superadmin is viewing Scout as someone else. */
export default function ImpersonationBanner() {
  const [session, setSession] = useState(readImpersonation);
  const [now, setNow] = useState(Date.now());
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const onStorage = () => setSession(readImpersonation());
    window.addEventListener('storage', onStorage);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearInterval(id);
    };
  }, []);

  const left = session ? remaining(session.expiresAt) : 0;

  useEffect(() => {
    if (session && left <= 0) leaveImpersonation();
  }, [session, left, now]);

  if (!session) return null;

  async function stop() {
    setStopping(true);
    await stopImpersonation().catch(() => undefined);
    leaveImpersonation();
  }

  const who = session.target.role === 'client' ? 'client' : 'staff';
  return (
    <div className="impersonation-banner" role="status">
      <Eye size={16} aria-hidden />
      <span>
        Viewing as <strong>{session.target.name}</strong> ({who}, {session.target.email}).
        View only: nothing can be saved, paid or sent. Ends in {clock(left)}.
      </span>
      <button type="button" onClick={() => void stop()} disabled={stopping}>
        {stopping ? 'Stopping…' : 'Stop viewing as'}
      </button>
    </div>
  );
}
