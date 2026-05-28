import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchEmployeeRoles,
  fetchRoleManualBookingAppointmentTypes,
  updateRoleManualBookingAppointmentTypes,
  type AppointmentType,
  type EmployeeRole,
} from '../../api/appointmentSettings';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

type Props = {
  appointmentTypes: AppointmentType[];
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsRoleManualBooking({ appointmentTypes, onMessage }: Props) {
  const [roles, setRoles] = useState<EmployeeRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | ''>('');
  const [selectedTypeIds, setSelectedTypeIds] = useState<number[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeTypes = useMemo(
    () => appointmentTypes.filter((t) => t.isActive !== false && !t.isDeleted),
    [appointmentTypes]
  );

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(null);
    try {
      const list = await fetchEmployeeRoles();
      setRoles(Array.isArray(list) ? list : []);
    } catch (e) {
      setRolesError(extractErr(e));
      setRoles([]);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    if (!selectedRoleId) {
      setSelectedTypeIds([]);
      return;
    }
    let cancelled = false;
    setPermissionsLoading(true);
    void fetchRoleManualBookingAppointmentTypes(selectedRoleId)
      .then((rows) => {
        if (cancelled) return;
        setSelectedTypeIds(
          rows
            .map((r) => Number(r.appointmentTypeId))
            .filter((id) => Number.isFinite(id) && id > 0)
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setSelectedTypeIds([]);
          onMessage?.(extractErr(e), 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setPermissionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoleId, onMessage]);

  const toggleType = (typeId: number) => {
    setSelectedTypeIds((cur) =>
      cur.includes(typeId) ? cur.filter((id) => id !== typeId) : [...cur, typeId].sort((a, b) => a - b)
    );
  };

  const handleSave = async () => {
    if (!selectedRoleId) {
      onMessage?.('Select a role first.', 'error');
      return;
    }
    setSaving(true);
    try {
      await updateRoleManualBookingAppointmentTypes(selectedRoleId, selectedTypeIds);
      onMessage?.('Manual booking types saved.', 'success');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  return (
    <div>
      {rolesLoading ? (
        <p className="settings-muted">Loading roles…</p>
      ) : rolesError ? (
        <p className="settings-error-message">{rolesError}</p>
      ) : (
        <div className="settings-form-group">
          <label className="settings-label" htmlFor="role-manual-booking-role">
            Employee role
          </label>
          <select
            id="role-manual-booking-role"
            className="settings-select"
            value={selectedRoleId}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedRoleId(v ? Number(v) : '');
            }}
          >
            <option value="">— Select a role —</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
                {role.roleValue != null && role.roleValue !== '' ? ` (${role.roleValue})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedRoleId ? (
        <div className="settings-card">
          <h3 className="settings-card-title">
            {selectedRole?.name ?? `Role ${selectedRoleId}`}
          </h3>
          <p className="settings-card-subtitle">
            Appointment types staff with this role may book manually from the calendar (not via
            routing).
          </p>
          {permissionsLoading ? (
            <p className="settings-muted">Loading permissions…</p>
          ) : (
            <div className="settings-checkbox-list">
              {activeTypes.map((type) => (
                <label key={type.id} className="settings-checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedTypeIds.includes(type.id)}
                    onChange={() => toggleType(type.id)}
                  />
                  <span>{type.prettyName || type.name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="settings-action-bar">
            <button type="button" className="btn" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
