import { useState } from 'react';
import { Eye } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { startImpersonation } from '../api/impersonation';
import { beginImpersonation, readImpersonation } from '../auth/impersonationSession';
import { appAlert, appPrompt } from '../utils/appDialog';

type Props = {
  employeeId?: number;
  clientId?: number;
  userId?: number;
  name: string;
  className?: string;
};

function errorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { message?: unknown } } })?.response?.data;
  const msg = data?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  if (typeof msg === 'string') return msg;
  return 'Could not start viewing as this person.';
}

/** Superadmin only: open Scout as this client or staff member, view only, for 30 minutes. */
export default function ViewAsButton({ employeeId, clientId, userId, name, className }: Props) {
  const { role } = useAuth() as { role?: string[] | string };
  const [busy, setBusy] = useState(false);
  const roles = (Array.isArray(role) ? role : role ? [role] : []).map((r) =>
    String(r).toLowerCase()
  );
  if (!roles.includes('superadmin') || readImpersonation()) return null;

  async function start() {
    const reason = await appPrompt({
      title: `View Scout as ${name}?`,
      message:
        'You will see exactly what they see for 30 minutes. Nothing can be saved, paid or sent while you are viewing as them. Why are you doing this? This is saved in the audit log.',
      placeholder: 'e.g. client says the portal shows the wrong plan',
      confirmLabel: 'View as',
    });
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const started = await startImpersonation({
        employeeId,
        clientId,
        userId,
        reason: reason.trim(),
      });
      const home = beginImpersonation({
        accessToken: started.accessToken,
        expiresAt: started.expiresAt,
        target: started.target,
        returnTo: window.location.pathname + window.location.search,
      });
      window.location.assign(home);
    } catch (err) {
      setBusy(false);
      await appAlert({ title: 'Could not view as', message: errorMessage(err) });
    }
  }

  return (
    <button
      type="button"
      className={className ?? 'btn secondary'}
      onClick={() => void start()}
      disabled={busy}
      title="Superadmin only: see Scout as this person, view only"
    >
      <Eye size={14} aria-hidden />
      {busy ? 'Opening…' : 'View as'}
    </button>
  );
}
