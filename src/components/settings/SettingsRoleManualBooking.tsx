import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchEmployeeRoles,
  fetchRoleManualBookingAppointmentTypes,
  updateRoleManualBookingAppointmentTypes,
  type AppointmentType,
  type EmployeeRole,
} from '../../api/appointmentSettings';
import { appointmentTypeIsArchived } from '../../utils/appointmentTypeSettings';
import {
  groupEmployeeRolesByName,
  type EmployeeRoleNameGroup,
} from '../../utils/employeeRoleDisplay';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

type Props = {
  /** Active types for new assignment checkboxes. */
  appointmentTypes: AppointmentType[];
  /** Full catalog — used to show legacy archived assignments. */
  allAppointmentTypes?: AppointmentType[];
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsRoleManualBooking({
  appointmentTypes,
  allAppointmentTypes,
  onMessage,
}: Props) {
  const [rolesCatalog, setRolesCatalog] = useState<EmployeeRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [selectedRoleNameKey, setSelectedRoleNameKey] = useState<string | null>(null);
  const [selectedTypeIds, setSelectedTypeIds] = useState<number[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const roleGroups = useMemo(() => groupEmployeeRolesByName(rolesCatalog), [rolesCatalog]);

  const selectedGroup = useMemo(
    () => roleGroups.find((group) => group.nameKey === selectedRoleNameKey) ?? null,
    [roleGroups, selectedRoleNameKey],
  );

  const activeTypes = useMemo(
    () => appointmentTypes.filter((t) => t.isActive !== false && !appointmentTypeIsArchived(t)),
    [appointmentTypes],
  );

  const activeTypeIds = useMemo(() => activeTypes.map((t) => t.id), [activeTypes]);

  const allActiveSelected =
    activeTypeIds.length > 0 && activeTypeIds.every((id) => selectedTypeIds.includes(id));
  const someActiveSelected = activeTypeIds.some((id) => selectedTypeIds.includes(id));

  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someActiveSelected && !allActiveSelected;
    }
  }, [someActiveSelected, allActiveSelected]);

  const archivedSelectedTypes = useMemo(() => {
    const catalog = allAppointmentTypes ?? appointmentTypes;
    const activeIds = new Set(activeTypes.map((t) => t.id));
    return catalog.filter(
      (t) => appointmentTypeIsArchived(t) && selectedTypeIds.includes(t.id) && !activeIds.has(t.id),
    );
  }, [allAppointmentTypes, appointmentTypes, activeTypes, selectedTypeIds]);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(null);
    try {
      const list = await fetchEmployeeRoles();
      setRolesCatalog(Array.isArray(list) ? list : []);
    } catch (e) {
      setRolesError(extractErr(e));
      setRolesCatalog([]);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    if (roleGroups.length === 0) {
      setSelectedRoleNameKey(null);
      return;
    }
    setSelectedRoleNameKey((current) => {
      if (current && roleGroups.some((group) => group.nameKey === current)) return current;
      return roleGroups[0]?.nameKey ?? null;
    });
  }, [roleGroups]);

  const loadPermissionsForGroup = useCallback(
    async (group: EmployeeRoleNameGroup) => {
      setPermissionsLoading(true);
      try {
        const results = await Promise.all(
          group.roleIds.map((roleId) => fetchRoleManualBookingAppointmentTypes(roleId)),
        );
        const union = new Set<number>();
        for (const rows of results) {
          for (const row of rows) {
            const id = Number(row.appointmentTypeId);
            if (Number.isFinite(id) && id > 0) union.add(id);
          }
        }
        setSelectedTypeIds(Array.from(union).sort((a, b) => a - b));
      } catch (e) {
        setSelectedTypeIds([]);
        onMessage?.(extractErr(e), 'error');
      } finally {
        setPermissionsLoading(false);
      }
    },
    [onMessage],
  );

  useEffect(() => {
    if (!selectedGroup) {
      setSelectedTypeIds([]);
      return;
    }
    void loadPermissionsForGroup(selectedGroup);
  }, [selectedGroup, loadPermissionsForGroup]);

  const toggleType = (typeId: number) => {
    setSelectedTypeIds((cur) =>
      cur.includes(typeId) ? cur.filter((id) => id !== typeId) : [...cur, typeId].sort((a, b) => a - b),
    );
  };

  const toggleSelectAllActive = () => {
    setSelectedTypeIds((cur) => {
      const activeIdSet = new Set(activeTypeIds);
      const preserved = cur.filter((id) => !activeIdSet.has(id));
      if (allActiveSelected) {
        return preserved.sort((a, b) => a - b);
      }
      return Array.from(new Set([...preserved, ...activeTypeIds])).sort((a, b) => a - b);
    });
  };

  const handleSave = async () => {
    if (!selectedGroup) {
      onMessage?.('Select a role first.', 'error');
      return;
    }
    setSaving(true);
    try {
      await Promise.all(
        selectedGroup.roleIds.map((roleId) =>
          updateRoleManualBookingAppointmentTypes(roleId, selectedTypeIds),
        ),
      );
      onMessage?.(`Manual booking types saved for ${selectedGroup.displayName}.`, 'success');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {rolesLoading ? (
        <p className="settings-muted">Loading roles…</p>
      ) : rolesError ? (
        <p className="settings-error-message">{rolesError}</p>
      ) : roleGroups.length === 0 ? (
        <p className="settings-muted">No employee roles found.</p>
      ) : (
        <div className="settings-form-group">
          <label className="settings-label" htmlFor="role-manual-booking-role">
            Employee role
          </label>
          <select
            id="role-manual-booking-role"
            className="settings-select"
            value={selectedRoleNameKey ?? ''}
            onChange={(e) => setSelectedRoleNameKey(e.target.value || null)}
          >
            {roleGroups.map((group) => (
              <option key={group.nameKey} value={group.nameKey}>
                {group.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedGroup ? (
        <div className="settings-card">
          <h3 className="settings-card-title">{selectedGroup.displayName}</h3>
          <p className="settings-card-subtitle">
            Appointment types staff with this role may book manually from the calendar (not via
            routing).
            {selectedGroup.roleIds.length > 1
              ? ' Settings apply to every permission variant of this role in your PIMS.'
              : null}
          </p>
          {permissionsLoading ? (
            <p className="settings-muted">Loading permissions…</p>
          ) : (
            <div className="settings-checkbox-list">
              {activeTypes.length > 0 ? (
                <label className="settings-checkbox-item settings-checkbox-item--select-all">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allActiveSelected}
                    onChange={toggleSelectAllActive}
                  />
                  <span>Select all</span>
                </label>
              ) : null}
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
              {archivedSelectedTypes.map((type) => (
                <label key={type.id} className="settings-checkbox-item settings-checkbox-item--disabled">
                  <input type="checkbox" checked disabled readOnly />
                  <span>
                    {type.prettyName || type.name}
                    <span className="settings-appt-type-archived-badge">Archived</span>
                    <span className="settings-muted"> — saved but no longer assignable</span>
                  </span>
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
