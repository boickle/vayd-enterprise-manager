import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchGmailMailboxPermissions,
  updateGmailMailboxPermissions,
  type GmailAdminMailboxPermissionEntry,
  type GmailAdminMailboxPermissionsOverview,
  type GmailAdminMailboxPermissionsUser,
} from '../../api/gmail';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

type RowDraft = Record<string, { canRead: boolean; canSend: boolean }>;

function draftFromUser(user: GmailAdminMailboxPermissionsUser): RowDraft {
  const draft: RowDraft = {};
  for (const m of user.mailboxes) {
    draft[m.mailboxEmail] = { canRead: m.canRead, canSend: m.canSend };
  }
  return draft;
}

function entriesFromDraft(
  draft: RowDraft,
  mailboxEmails: string[],
): GmailAdminMailboxPermissionEntry[] {
  return mailboxEmails.map((email) => ({
    mailboxEmail: email,
    canRead: draft[email]?.canRead === true,
    canSend: draft[email]?.canSend === true,
  }));
}

function draftsEqual(a: RowDraft, b: RowDraft, mailboxEmails: string[]): boolean {
  for (const email of mailboxEmails) {
    if ((a[email]?.canRead === true) !== (b[email]?.canRead === true)) return false;
    if ((a[email]?.canSend === true) !== (b[email]?.canSend === true)) return false;
  }
  return true;
}

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsGmailMailboxPermissions({ onMessage }: Props) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const [overview, setOverview] = useState<GmailAdminMailboxPermissionsOverview | null>(null);
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  const mailboxEmails = useMemo(
    () => (overview?.mailboxes ?? []).map((m) => m.email),
    [overview],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchGmailMailboxPermissions();
      setOverview(data);
      const next: Record<number, RowDraft> = {};
      for (const u of data.users) {
        next[u.userId] = draftFromUser(u);
      }
      setDrafts(next);
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
      setOverview(null);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredUsers = useMemo(() => {
    const users = overview?.users ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        String(u.role).toLowerCase().includes(q),
    );
  }, [overview, filter]);

  const setFlag = (
    userId: number,
    mailboxEmail: string,
    key: 'canRead' | 'canSend',
    value: boolean,
  ) => {
    setDrafts((prev) => {
      const row = { ...(prev[userId] ?? {}) };
      const cell = { ...(row[mailboxEmail] ?? { canRead: false, canSend: false }) };
      cell[key] = value;
      if (key === 'canRead' && !value) {
        cell.canSend = false;
      }
      if (key === 'canSend' && value) {
        cell.canRead = true;
      }
      row[mailboxEmail] = cell;
      return { ...prev, [userId]: row };
    });
  };

  const isDirty = (user: GmailAdminMailboxPermissionsUser): boolean => {
    const baseline = draftFromUser(user);
    const draft = drafts[user.userId] ?? baseline;
    return !draftsEqual(draft, baseline, mailboxEmails);
  };

  const handleSave = async (user: GmailAdminMailboxPermissionsUser) => {
    const draft = drafts[user.userId] ?? draftFromUser(user);
    setSavingUserId(user.userId);
    try {
      const result = await updateGmailMailboxPermissions(
        user.userId,
        entriesFromDraft(draft, mailboxEmails),
      );
      setOverview((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) =>
            u.userId === user.userId ? { ...u, mailboxes: result.mailboxes } : u,
          ),
        };
      });
      setDrafts((prev) => ({
        ...prev,
        [user.userId]: Object.fromEntries(
          result.mailboxes.map((m) => [
            m.mailboxEmail,
            { canRead: m.canRead, canSend: m.canSend },
          ]),
        ),
      }));
      onMessageRef.current?.(
        `Saved shared mailbox access for ${user.displayName}.`,
        'success',
      );
    } catch (e) {
      onMessageRef.current?.(extractErr(e), 'error');
    } finally {
      setSavingUserId(null);
    }
  };

  if (loading) {
    return <p className="settings-muted">Loading mailbox permissions…</p>;
  }

  if (!overview) {
    return (
      <p className="settings-muted">
        Could not load mailbox permissions. Refresh the page or try again.
      </p>
    );
  }

  return (
    <div>
      <div className="settings-form-group">
        <label className="settings-label" htmlFor="gmail-mailbox-perm-filter">
          Filter staff
        </label>
        <input
          id="gmail-mailbox-perm-filter"
          className="settings-input"
          type="search"
          placeholder="Name, login email, or role…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="settings-table-container">
        <table className="settings-table settings-gmail-mailbox-perm-table">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                Employee
              </th>
              <th scope="col" rowSpan={2}>
                Login
              </th>
              {overview.mailboxes.map((mb) => (
                <th key={mb.email} scope="col" colSpan={2}>
                  {mb.displayLabel}
                  <div className="settings-muted" style={{ fontWeight: 400, fontSize: 12 }}>
                    {mb.email}
                  </div>
                </th>
              ))}
              <th scope="col" rowSpan={2} />
            </tr>
            <tr>
              {overview.mailboxes.map((mb) => (
                <Fragment key={`${mb.email}-sub`}>
                  <th scope="col" className="settings-gmail-mailbox-perm-subhead">
                    Show
                  </th>
                  <th scope="col" className="settings-gmail-mailbox-perm-subhead">
                    Send
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={3 + overview.mailboxes.length * 2}>
                  No staff match this filter.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => {
                const draft = drafts[user.userId] ?? draftFromUser(user);
                const dirty = isDirty(user);
                const saving = savingUserId === user.userId;
                return (
                  <tr key={user.userId}>
                    <td>
                      <div>{user.displayName}</div>
                      <div className="settings-muted" style={{ fontSize: 12 }}>
                        {user.role}
                        {user.employeeId != null ? ` · emp #${user.employeeId}` : ''}
                      </div>
                    </td>
                    <td>{user.email ?? '—'}</td>
                    {overview.mailboxes.map((mb) => {
                      const cell = draft[mb.email] ?? { canRead: false, canSend: false };
                      return (
                        <Fragment key={`${user.userId}-${mb.email}`}>
                          <td className="settings-gmail-mailbox-perm-check">
                            <label>
                              <input
                                type="checkbox"
                                checked={cell.canRead}
                                disabled={saving}
                                onChange={(e) =>
                                  setFlag(user.userId, mb.email, 'canRead', e.target.checked)
                                }
                              />
                              <span className="visually-hidden">Show {mb.displayLabel}</span>
                            </label>
                          </td>
                          <td className="settings-gmail-mailbox-perm-check">
                            <label>
                              <input
                                type="checkbox"
                                checked={cell.canSend}
                                disabled={saving || !cell.canRead}
                                onChange={(e) =>
                                  setFlag(user.userId, mb.email, 'canSend', e.target.checked)
                                }
                              />
                              <span className="visually-hidden">Send {mb.displayLabel}</span>
                            </label>
                          </td>
                        </Fragment>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={!dirty || saving}
                        onClick={() => void handleSave(user)}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
