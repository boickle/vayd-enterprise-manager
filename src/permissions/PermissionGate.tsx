// src/permissions/PermissionGate.tsx
// The visibility convention for permission-gated UI.
//
// Three cases, and the rule for each:
//
// 1. The person's role will never have it — void an invoice, merge records,
//    edit practice settings. HIDE it. A technician who sees "Void invoice"
//    greyed out on every invoice forever learns nothing except that Scout is
//    full of doors they can't open; worse, it tells them what to ask a manager
//    to do for them. `mode="hide"` is the default.
//
// 2. The person has the permission but not for this record — a doctor with
//    `own` scope looking at a colleague's note. SHOW IT DISABLED with a hint
//    naming who can. Here the greyed control is information: the action is
//    normally theirs, and the hint explains the one thing standing in the way.
//
// 3. A whole page. Render `PermissionDenied`, not a blank screen or a silent
//    redirect — people file bugs about blank screens.
//
// Everything here is cosmetic. The server checks the same permission again on
// every write, so a hidden button is a courtesy, not the control.
import type { PermissionScope } from '../api/permissions';
import { usePermissions } from './PermissionContext';
import './PermissionGate.css';

type GateProps = {
  permission: string;
  /** Minimum scope required; `own` for most buttons. */
  atLeast?: PermissionScope;
  /** `hide` for role-impossible actions, `disable` for record-specific blocks. */
  mode?: 'hide' | 'disable';
  /** Shown on hover when disabled. Name who *can* do it, not just that they can't. */
  hint?: string;
  /** Rendered instead of the children when hidden. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

export function PermissionGate({
  permission,
  atLeast = 'own',
  mode = 'hide',
  hint,
  fallback = null,
  children,
}: GateProps) {
  const { can, effective } = usePermissions();

  // Before the first load we know nothing. Hiding would make controls flash in
  // a moment later, so hold the space empty and let them appear once.
  if (!effective) return <>{fallback}</>;

  if (can(permission, atLeast)) return <>{children}</>;
  if (mode === 'hide') return <>{fallback}</>;

  return (
    <span
      className="perm-blocked"
      title={hint ?? 'You do not have permission for this'}
      aria-disabled="true"
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </span>
  );
}

/**
 * Whole-page stand-in. Says what is behind the door and who opens it, so the
 * reader's next step is a message to a person rather than a bug report.
 */
export function PermissionDenied({
  what,
  who = 'a practice manager',
}: {
  what: string;
  who?: string;
}) {
  return (
    <div className="perm-denied">
      <div className="perm-denied-title">{what} isn’t part of your access</div>
      <div className="perm-denied-body">
        Ask {who} if you need it — they can grant it from Employee Settings.
      </div>
    </div>
  );
}
