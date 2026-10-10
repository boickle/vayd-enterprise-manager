// src/components/settings/SettingsEmployeeAccess.tsx
// The Access tab of the employee hub: licence, what this person can do today,
// and the individual grants layered on top of their roles.
//
// Grants are additive only. There is no "deny" row, because once you can take
// single permissions away from one person the role stops describing anyone and
// you are back to auditing checkbox grids one employee at a time. To narrow
// someone's access, change their role.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addEmployeePermissionGrant,
  fetchEmployeePermissions,
  fetchPermissionCatalog,
  removeEmployeePermissionGrant,
  saveEmployeeLicense,
  ROLE_LABELS,
  type EmployeePermissionDetail,
  type PermissionCatalogEntry,
} from '../../api/permissions';
import { usePermissions } from '../../permissions/PermissionContext';
import { PermissionGate } from '../../permissions/PermissionGate';
import { ReasonPrompt } from '../../permissions/ReasonPrompt';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import './SettingsEmployeeAccess.css';

type Props = {
  employeeId: number;
  employeeName?: string;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

type LicenseType = 'veterinarian' | 'technician' | null;

const LICENSE_LABEL: Record<string, string> = {
  veterinarian: 'Veterinarian',
  technician: 'Licensed technician',
};

export default function SettingsEmployeeAccess({ employeeId, employeeName, onMessage }: Props) {
  const practiceId = currentPracticeId();
  const { reload: reloadOwnPermissions, effective: myPermissions } = usePermissions();

  const [detail, setDetail] = useState<EmployeePermissionDetail | null>(null);
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [sectionLabels, setSectionLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingLicense, setSavingLicense] = useState(false);
  const [grantKey, setGrantKey] = useState('');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [reasonOpen, setReasonOpen] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!practiceId || !employeeId) return;
    setLoading(true);
    Promise.all([
      fetchEmployeePermissions(practiceId, employeeId),
      fetchPermissionCatalog(practiceId),
    ])
      .then(([next, cat]) => {
        setDetail(next);
        // Unbuilt actions have no screen, so granting them would do nothing.
        setCatalog(cat.entries.filter((entry) => !entry.unbuilt));
        setSectionLabels(cat.sections);
        setLoadError(null);
      })
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : 'Could not load access')
      )
      .finally(() => setLoading(false));
  }, [practiceId, employeeId]);

  useEffect(load, [load]);

  const byKey = useMemo(() => new Map(catalog.map((entry) => [entry.key, entry])), [catalog]);
  const grantedKeys = useMemo(
    () => new Set((detail?.grants ?? []).map((g) => g.permissionKey)),
    [detail]
  );

  /** Only what they don't already hold, and only what may be granted at all. */
  const grantable = useMemo(() => {
    const held = detail?.effective.permissions ?? {};
    return catalog
      .filter((entry) => entry.grantable && !held[entry.key])
      .sort((a, b) =>
        a.section === b.section
          ? a.label.localeCompare(b.label)
          : a.section.localeCompare(b.section)
      );
  }, [catalog, detail]);

  const sections = useMemo(() => {
    const held = detail?.effective.permissions ?? {};
    const groups = new Map<string, PermissionCatalogEntry[]>();
    for (const entry of catalog) {
      if (!held[entry.key]) continue;
      const list = groups.get(entry.section) ?? [];
      list.push(entry);
      groups.set(entry.section, list);
    }
    return [...groups.entries()].map(([section, entries]) => ({
      section: sectionLabels[section] ?? section,
      entries: entries.sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }, [catalog, detail, sectionLabels]);

  const isSelf = myPermissions?.employeeId === employeeId;

  async function setLicense(isLicensed: boolean, licenseType: LicenseType) {
    if (!practiceId) return;
    setSavingLicense(true);
    try {
      await saveEmployeeLicense(practiceId, employeeId, { isLicensed, licenseType });
      onMessage?.('Licence updated', 'success');
      if (isSelf) reloadOwnPermissions();
      load();
    } catch (err) {
      onMessage?.(err instanceof Error ? err.message : 'Could not update licence', 'error');
    } finally {
      setSavingLicense(false);
    }
  }

  async function confirmGrant(reason: string) {
    if (!practiceId || !grantKey) return;
    setGrantBusy(true);
    setGrantError(null);
    try {
      await addEmployeePermissionGrant(practiceId, employeeId, {
        permissionKey: grantKey,
        reason,
        expiresAt: grantExpiry ? new Date(grantExpiry).toISOString() : null,
      });
      setReasonOpen(false);
      setGrantKey('');
      setGrantExpiry('');
      onMessage?.('Permission granted', 'success');
      if (isSelf) reloadOwnPermissions();
      load();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : 'Could not grant');
    } finally {
      setGrantBusy(false);
    }
  }

  async function revoke(permissionKey: string) {
    if (!practiceId) return;
    try {
      await removeEmployeePermissionGrant(practiceId, employeeId, permissionKey);
      onMessage?.('Grant removed', 'success');
      if (isSelf) reloadOwnPermissions();
      load();
    } catch (err) {
      onMessage?.(err instanceof Error ? err.message : 'Could not remove grant', 'error');
    }
  }

  if (loading && !detail) {
    return <div className="settings-card settings-muted">Loading access…</div>;
  }
  if (loadError) {
    return <div className="settings-error-message">{loadError}</div>;
  }
  if (!detail) return null;

  const { effective, grants } = detail;
  const licenseType = (effective.licenseType ?? null) as LicenseType;

  return (
    <div className="emp-access">
      <div className="settings-card">
        <h3 className="settings-card-title">Licence</h3>
        <p className="settings-card-subtitle">
          Signing and locking a medical record requires a licence, so a licensed technician can sign
          and a veterinary assistant cannot. Prescriptions and refill authorizations additionally
          require a veterinary licence — no role or grant substitutes for either.
        </p>
        <PermissionGate
          permission="staff.license.manage"
          mode="disable"
          hint="Only a practice admin or medical director can set someone's licence"
        >
          <div className="emp-access-license">
            {(['veterinarian', 'technician'] as const).map((type) => (
              <label key={type}>
                <input
                  type="radio"
                  name="employee-license"
                  disabled={savingLicense}
                  checked={effective.isLicensed && licenseType === type}
                  onChange={() => void setLicense(true, type)}
                />
                <span>{LICENSE_LABEL[type]}</span>
              </label>
            ))}
            <label>
              <input
                type="radio"
                name="employee-license"
                disabled={savingLicense}
                checked={!effective.isLicensed}
                onChange={() => void setLicense(false, null)}
              />
              <span>Not licensed</span>
            </label>
          </div>
        </PermissionGate>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Individual permissions</h3>
        <p className="settings-card-subtitle">
          Add something this person needs beyond their role — covering a manager on leave, say.
          Every grant takes a reason and can be given an end date so temporary access actually ends.
          To <em>remove</em> access, change their role: grants only add.
        </p>

        {grants.length > 0 ? (
          <ul className="emp-access-grants">
            {grants.map((grant) => {
              const entry = byKey.get(grant.permissionKey);
              return (
                <li key={grant.id}>
                  <div>
                    <div className="emp-access-grant-label">
                      {entry?.label ?? grant.permissionKey}
                    </div>
                    <div className="emp-access-grant-meta">
                      {grant.reason}
                      {grant.grantedByName ? ` · ${grant.grantedByName}` : ''}
                      {grant.expiresAt
                        ? ` · ends ${new Date(grant.expiresAt).toLocaleDateString()}`
                        : ' · no end date'}
                    </div>
                  </div>
                  <PermissionGate permission="staff.permission.grant">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => void revoke(grant.permissionKey)}
                    >
                      Remove
                    </button>
                  </PermissionGate>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="settings-muted" style={{ margin: '0 0 12px' }}>
            Nothing granted beyond {employeeName ? `${employeeName}’s` : 'their'} roles.
          </p>
        )}

        <PermissionGate permission="staff.permission.grant">
          <div className="emp-access-add">
            <label>
              <span className="label">Permission</span>
              <select
                className="input"
                value={grantKey}
                onChange={(e) => setGrantKey(e.target.value)}
              >
                <option value="">Select…</option>
                {grantable.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {sectionLabels[entry.section] ?? entry.section} — {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Ends (optional)</span>
              <input
                className="input"
                type="date"
                value={grantExpiry}
                onChange={(e) => setGrantExpiry(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!grantKey || grantedKeys.has(grantKey)}
              onClick={() => {
                setGrantError(null);
                setReasonOpen(true);
              }}
            >
              Grant
            </button>
          </div>
        </PermissionGate>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">What they can do today</h3>
        <p className="settings-card-subtitle">
          Roles:{' '}
          {effective.roles.length
            ? effective.roles.map((slug) => ROLE_LABELS[slug] ?? slug).join(', ')
            : 'none assigned'}
          . Assign roles on the Profile tab. Hover a permission to see where it comes from.
        </p>
        {sections.length === 0 ? (
          <p className="settings-muted" style={{ margin: 0 }}>
            No permissions yet — this person has no role assigned.
          </p>
        ) : (
          sections.map(({ section, entries }) => (
            <div key={section} className="emp-access-section">
              <div className="emp-access-section-name">{section}</div>
              <ul>
                {entries.map((entry) => {
                  const scope = effective.permissions[entry.key];
                  return (
                    <li key={entry.key} title={effective.sources[entry.key]}>
                      <span>{entry.label}</span>
                      <span className="emp-access-tags">
                        {scope !== 'all' && <span className="emp-access-tag">{scope}</span>}
                        {grantedKeys.has(entry.key) && (
                          <span className="emp-access-tag is-grant">granted</span>
                        )}
                        {entry.reason && <span className="emp-access-tag is-reason">reason</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <ReasonPrompt
        open={reasonOpen}
        title={`Grant “${byKey.get(grantKey)?.label ?? grantKey}”`}
        note="Why this person needs it. Shown in the access log and on this tab."
        presets={[
          'Covering while manager is away',
          'Trained and signed off',
          'Temporary project access',
        ]}
        confirmLabel="Grant"
        busy={grantBusy}
        error={grantError}
        onConfirm={(reason) => void confirmGrant(reason)}
        onCancel={() => setReasonOpen(false)}
      />
    </div>
  );
}
