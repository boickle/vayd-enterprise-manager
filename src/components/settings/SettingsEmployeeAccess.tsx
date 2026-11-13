// src/components/settings/SettingsEmployeeAccess.tsx
// The Access tab of the employee hub: license, what this person can do today,
// and the individual grants layered on top of their roles.
//
// Grants are additive only. There is no "deny" row, because once you can take
// single permissions away from one person the role stops describing anyone and
// you are back to auditing checkbox grids one employee at a time. To narrow
// someone's access, change their role.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ACCESS_CHANGE_KEYS,
  addEmployeePermissionGrant,
  describeAccessChange,
  fetchEmployeePermissions,
  fetchPermissionAudit,
  type PermissionAuditEntry,
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
import { endOfPracticeDayIso, formatPracticeDate } from '../../utils/practiceTimezone';
import './SettingsEmployeeAccess.css';

type Props = {
  employeeId: number;
  employeeName?: string;
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
  /** Told when the license changes, so the Profile tab can show the controlled drug location. */
  onLicenseChange?: (license: { isLicensed: boolean; licenseType: LicenseType }) => void;
};

type LicenseType = 'veterinarian' | 'technician' | null;

const LICENSE_LABEL: Record<string, string> = {
  veterinarian: 'Veterinarian',
  technician: 'Licensed technician',
};

export default function SettingsEmployeeAccess({
  employeeId,
  employeeName,
  onMessage,
  onLicenseChange,
}: Props) {
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
  const [recent, setRecent] = useState<PermissionAuditEntry[]>([]);

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

  // Recent role, license and grant changes for this person. Needs the audit log permission;
  // without it the list stays empty and the card is not shown.
  const loadRecent = useCallback(() => {
    if (!practiceId || !employeeId) return;
    fetchPermissionAudit(practiceId, {
      entityType: 'employee',
      entityId: employeeId,
      permissionKeys: ACCESS_CHANGE_KEYS,
      limit: 10,
    })
      .then(setRecent)
      .catch(() => setRecent([]));
  }, [practiceId, employeeId]);

  useEffect(loadRecent, [loadRecent]);

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
  // RP-04 (D1): nobody changes their own license or grants, except a platform superadmin.
  const lockedAsSelf = isSelf && myPermissions?.isPlatformAdmin !== true;
  const SELF_HINT = 'Ask a practice admin to change your own access.';

  async function setLicense(isLicensed: boolean, licenseType: LicenseType) {
    if (!practiceId || lockedAsSelf) return;
    setSavingLicense(true);
    try {
      await saveEmployeeLicense(practiceId, employeeId, { isLicensed, licenseType });
      onMessage?.('License updated', 'success');
      onLicenseChange?.({ isLicensed, licenseType });
      if (isSelf) reloadOwnPermissions();
      load();
      loadRecent();
    } catch (err) {
      onMessage?.(err instanceof Error ? err.message : 'Could not update license', 'error');
    } finally {
      setSavingLicense(false);
    }
  }

  async function confirmGrant(reason: string) {
    if (!practiceId || !grantKey || lockedAsSelf) return;
    setGrantBusy(true);
    setGrantError(null);
    try {
      await addEmployeePermissionGrant(practiceId, employeeId, {
        permissionKey: grantKey,
        reason,
        // The date input gives a calendar day; the grant runs to its last instant in Eastern time.
        expiresAt: endOfPracticeDayIso(grantExpiry),
      });
      setReasonOpen(false);
      setGrantKey('');
      setGrantExpiry('');
      onMessage?.('Permission granted', 'success');
      if (isSelf) reloadOwnPermissions();
      load();
      loadRecent();
    } catch (err) {
      setGrantError(err instanceof Error ? err.message : 'Could not grant');
    } finally {
      setGrantBusy(false);
    }
  }

  async function revoke(permissionKey: string) {
    if (!practiceId || lockedAsSelf) return;
    try {
      await removeEmployeePermissionGrant(practiceId, employeeId, permissionKey);
      onMessage?.('Grant removed', 'success');
      if (isSelf) reloadOwnPermissions();
      load();
      loadRecent();
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
        <h3 className="settings-card-title">License</h3>
        <p className="settings-card-subtitle">
          Signing a SOAP needs a veterinary license. A licensed technician may sign quick visits and
          may enter prescription directions for the vet. No role or grant substitutes for a
          license. Anyone on staff may sign a medical note.
        </p>
        <PermissionGate
          permission="staff.license.manage"
          mode="disable"
          hint="Only a practice admin or the medical director can set someone's license"
        >
          <div className="emp-access-license">
            {(['veterinarian', 'technician'] as const).map((type) => (
              <label key={type}>
                <input
                  type="radio"
                  name="employee-license"
                  disabled={savingLicense || lockedAsSelf}
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
                disabled={savingLicense || lockedAsSelf}
                checked={!effective.isLicensed}
                onChange={() => void setLicense(false, null)}
              />
              <span>Not licensed</span>
            </label>
          </div>
        </PermissionGate>
        {lockedAsSelf && <p className="settings-muted emp-access-self-hint">{SELF_HINT}</p>}
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
                        ? ` · ends ${formatPracticeDate(grant.expiresAt)}`
                        : ' · no end date'}
                    </div>
                  </div>
                  <PermissionGate permission="staff.permission.grant">
                    <button
                      type="button"
                      className="btn-link"
                      disabled={lockedAsSelf}
                      title={lockedAsSelf ? SELF_HINT : undefined}
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
                disabled={lockedAsSelf}
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
                disabled={lockedAsSelf}
                value={grantExpiry}
                onChange={(e) => setGrantExpiry(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!grantKey || grantedKeys.has(grantKey) || lockedAsSelf}
              title={lockedAsSelf ? SELF_HINT : undefined}
              onClick={() => {
                setGrantError(null);
                setReasonOpen(true);
              }}
            >
              Grant
            </button>
          </div>
          {lockedAsSelf && <p className="settings-muted emp-access-self-hint">{SELF_HINT}</p>}
        </PermissionGate>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">What they can do today</h3>
        <p className="settings-card-subtitle">
          Roles:{' '}
          {effective.roles.length
            ? effective.roles.map((slug) => ROLE_LABELS[slug] ?? slug).join(', ')
            : 'none assigned'}
          . Practice-wide roles are on the Profile tab, office roles on Staff → Roles. Hover a permission to see where it comes from.
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

      {recent.length > 0 && (
        <div className="settings-card" data-testid="recent-access-changes">
          <h3 className="settings-card-title">Recent changes</h3>
          <ul className="emp-access-recent">
            {recent.map((row) => (
              <li key={row.id}>
                <div>{describeAccessChange(row, (k) => byKey.get(k)?.label ?? k)}</div>
                <div className="emp-access-grant-meta">
                  {row.employeeName ?? 'Someone'} · {new Date(row.created).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
          <Link to="/schedule/settings?tab=permission-audit">
            See the full Permission Audit Log
          </Link>
        </div>
      )}

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
