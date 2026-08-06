import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Field } from '../components/Field';
import { useAuth } from '../auth/useAuth';
import {
  adminSendPasswordReset,
  fetchAdminUsers,
  updateAdminUser,
  type AdminManagedUser,
  type ScoutUserRole,
} from '../api/users';
import { fetchAllEmployees, type Employee } from '../api/appointmentSettings';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { formatEmployeeDisplayName } from '../utils/employeeDisplayName';
import './Settings.css';

function extractErr(err: unknown): string {
  const e = err as {
    response?: { data?: { message?: string | string[] } };
    message?: string;
  };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

const ALL_ROLES: { value: ScoutUserRole; label: string }[] = [
  { value: 'client', label: 'Client' },
  { value: 'employee', label: 'Employee' },
  { value: 'provider', label: 'Provider' },
  { value: 'generic', label: 'Generic' },
  { value: 'admin', label: 'Admin' },
  { value: 'superadmin', label: 'Superadmin' },
];

function normalizeRoles(role: string | string[] | undefined): string[] {
  const list = Array.isArray(role) ? role : role ? [String(role)] : [];
  return list.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
}

function roleLabel(role: string): string {
  const found = ALL_ROLES.find((r) => r.value === role);
  if (found) return found.label;
  if (!role) return '—';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function canEditUser(actorIsSuperadmin: boolean, targetRole: string): boolean {
  if (String(targetRole).toLowerCase() === 'superadmin') {
    return actorIsSuperadmin;
  }
  return true;
}

function employeeOptionLabel(emp: Employee): string {
  const name = formatEmployeeDisplayName(emp);
  const email = emp.email?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || `Employee #${emp.id}`;
}

export default function AdminUsers() {
  const { role } = useAuth() as { role?: string | string[] };
  const roles = normalizeRoles(role);
  const isSuperadmin = roles.includes('superadmin');

  const [users, setUsers] = useState<AdminManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(
    null,
  );

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [doctors, setDoctors] = useState<Provider[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);

  const [editing, setEditing] = useState<AdminManagedUser | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editDoctorId, setEditDoctorId] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingId, setResettingId] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchAdminUsers({
        isActive:
          statusFilter === 'all' ? undefined : statusFilter === 'active',
        role: roleFilter === 'all' ? undefined : roleFilter,
      });
      setUsers(list);
    } catch (e) {
      setLoadError(extractErr(e));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, roleFilter]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLookupsLoading(true);
      try {
        const [emps, providers] = await Promise.all([
          fetchAllEmployees(),
          fetchPrimaryProviders(),
        ]);
        if (cancelled) return;
        setEmployees(
          (Array.isArray(emps) ? emps : [])
            .filter((e) => e.isDeleted !== true)
            .slice()
            .sort((a, b) =>
              employeeOptionLabel(a).localeCompare(employeeOptionLabel(b)),
            ),
        );
        setDoctors(
          providers.slice().sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        if (!cancelled) {
          setMessage({
            text: 'Unable to load employees/doctors for linking.',
            kind: 'error',
          });
        }
      } finally {
        if (!cancelled) setLookupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = [
        u.email,
        u.role,
        u.employeeName,
        u.doctorName,
        u.clientName,
        u.employeeId != null ? String(u.employeeId) : '',
        u.doctorId != null ? String(u.doctorId) : '',
        u.clientId != null ? String(u.clientId) : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, filter]);

  const roleOptions = useMemo(() => {
    if (isSuperadmin) return ALL_ROLES;
    return ALL_ROLES.filter(
      (r) => r.value !== 'admin' && r.value !== 'superadmin',
    );
  }, [isSuperadmin]);

  const openEdit = (user: AdminManagedUser) => {
    if (!canEditUser(isSuperadmin, String(user.role))) {
      setMessage({
        text: 'Only superadmins can edit superadmin users.',
        kind: 'error',
      });
      return;
    }
    setEditing(user);
    setEditRole(String(user.role || 'employee'));
    setEditEmployeeId(user.employeeId != null ? String(user.employeeId) : '');
    setEditDoctorId(user.doctorId != null ? String(user.doctorId) : '');
    setEditIsActive(user.isActive !== false);
    setMessage(null);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditing(null);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      const nextEmployeeId = editEmployeeId ? Number(editEmployeeId) : null;
      const nextDoctorId = editDoctorId ? Number(editDoctorId) : null;
      const payload: {
        role?: string;
        employeeId?: number | null;
        doctorId?: number | null;
        isActive?: boolean;
      } = {};

      if (editRole !== String(editing.role || '')) {
        payload.role = editRole;
      }
      if (nextEmployeeId !== (editing.employeeId ?? null)) {
        payload.employeeId = nextEmployeeId;
      }
      if (nextDoctorId !== (editing.doctorId ?? null)) {
        payload.doctorId = nextDoctorId;
      }
      if (editIsActive !== (editing.isActive !== false)) {
        payload.isActive = editIsActive;
      }

      if (Object.keys(payload).length === 0) {
        setEditing(null);
        return;
      }

      const updated = await updateAdminUser(editing.id, payload);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditing(null);
      setMessage({ text: `Updated ${updated.email ?? `user #${updated.id}`}.`, kind: 'success' });
    } catch (err) {
      setMessage({ text: extractErr(err), kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const onSendReset = async (user: AdminManagedUser) => {
    if (!canEditUser(isSuperadmin, String(user.role))) {
      setMessage({
        text: 'Only superadmins can reset passwords for superadmin users.',
        kind: 'error',
      });
      return;
    }
    if (!user.isActive) {
      setMessage({
        text: 'Reactivate the user before sending a password reset.',
        kind: 'error',
      });
      return;
    }
    const ok = window.confirm(
      `Send a password reset link to ${user.email ?? `user #${user.id}`}?`,
    );
    if (!ok) return;
    setResettingId(user.id);
    setMessage(null);
    try {
      await adminSendPasswordReset(user.id);
      setMessage({
        text: `Password reset link sent to ${user.email ?? `user #${user.id}`}.`,
        kind: 'success',
      });
    } catch (err) {
      setMessage({ text: extractErr(err), kind: 'error' });
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header" style={{ marginBottom: 16 }}>
        <div>
          <h2 className="settings-section-title" style={{ marginTop: 0 }}>
            Users
          </h2>
          <p className="settings-section-description">
            Manage login accounts (staff and clients): roles, employee/doctor links,
            active status, and password resets.
            {!isSuperadmin && (
              <>
                {' '}
                Only a superadmin can edit superadmins or assign the admin role.
              </>
            )}
          </p>
        </div>
      </div>

      {message && (
        <div
          className={message.kind === 'error' ? 'danger' : 'pill'}
          style={{ marginBottom: 12 }}
          role="status"
        >
          {message.text}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
          alignItems: 'center',
        }}
      >
        <input
          className="input"
          style={{ maxWidth: 320, flex: '1 1 220px' }}
          placeholder="Filter by email, name, or role…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          className="input"
          style={{ maxWidth: 160 }}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="all">All roles</option>
          {ALL_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          className="input"
          style={{ maxWidth: 160 }}
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')
          }
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void loadUsers()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {loadError && <div className="danger" style={{ marginBottom: 12 }}>{loadError}</div>}

      <div className="settings-table-container">
        <table className="settings-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Employee</th>
              <th>Doctor</th>
              <th>Status</th>
              <th style={{ width: 220 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="settings-muted">
                  Loading users…
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="settings-muted">
                  No users found.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => {
                const editable = canEditUser(isSuperadmin, String(user.role));
                return (
                  <tr key={user.id}>
                    <td>
                      <div>{user.email ?? `User #${user.id}`}</div>
                      {user.clientName ? (
                        <div className="settings-muted" style={{ fontSize: 12 }}>
                          Client: {user.clientName}
                          {user.clientId != null ? ` (#${user.clientId})` : ''}
                        </div>
                      ) : null}
                      {user.requiresPasswordReset && (
                        <div className="settings-muted" style={{ fontSize: 12 }}>
                          Password reset required
                        </div>
                      )}
                    </td>
                    <td>{roleLabel(String(user.role))}</td>
                    <td>
                      {user.employeeName ||
                        (user.employeeId != null ? `#${user.employeeId}` : '—')}
                    </td>
                    <td>
                      {user.doctorName ||
                        (user.doctorId != null ? `#${user.doctorId}` : '—')}
                    </td>
                    <td>
                      <span
                        className="pill"
                        style={{
                          background: user.isActive
                            ? 'rgba(16, 185, 129, 0.15)'
                            : 'rgba(239, 68, 68, 0.12)',
                        }}
                      >
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!editable}
                          title={
                            editable
                              ? 'Edit user'
                              : 'Only superadmins can edit superadmin users'
                          }
                          onClick={() => openEdit(user)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          disabled={!editable || !user.isActive || resettingId === user.id}
                          onClick={() => void onSendReset(user)}
                        >
                          {resettingId === user.id ? 'Sending…' : 'Reset password'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="settings-modal-overlay" onClick={closeEdit}>
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-user-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-modal-header">
              <h3 id="admin-user-edit-title">Edit user</h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={closeEdit}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form onSubmit={onSave}>
              <div className="settings-modal-body" style={{ display: 'grid', gap: 12 }}>
                <Field label="Email">
                  <input className="input" value={editing.email ?? ''} disabled />
                </Field>
                <Field label="Role">
                  <select
                    className="input"
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    required
                  >
                    {/* Keep current elevated role visible even if actor can't assign it */}
                    {!roleOptions.some((r) => r.value === editRole) && editRole && (
                      <option value={editRole}>{roleLabel(editRole)}</option>
                    )}
                    {roleOptions.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {!isSuperadmin && (
                    <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                      Only a superadmin can assign Admin or Superadmin.
                    </p>
                  )}
                </Field>
                <Field label="Employee">
                  <select
                    className="input"
                    value={editEmployeeId}
                    onChange={(e) => setEditEmployeeId(e.target.value)}
                    disabled={lookupsLoading}
                  >
                    <option value="">
                      {lookupsLoading ? 'Loading employees…' : 'No employee linked'}
                    </option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={String(emp.id)}>
                        {employeeOptionLabel(emp)}
                        {emp.isActive === false ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Doctor">
                  <select
                    className="input"
                    value={editDoctorId}
                    onChange={(e) => setEditDoctorId(e.target.value)}
                    disabled={lookupsLoading}
                  >
                    <option value="">
                      {lookupsLoading ? 'Loading doctors…' : 'No doctor linked'}
                    </option>
                    {doctors.map((doc) => (
                      <option key={String(doc.id)} value={String(doc.id)}>
                        {doc.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={editIsActive}
                      onChange={(e) => setEditIsActive(e.target.checked)}
                    />
                    Active
                  </label>
                </Field>
              </div>
              <div className="settings-modal-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={closeEdit}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={saving || lookupsLoading}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
