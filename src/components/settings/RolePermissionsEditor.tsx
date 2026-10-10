// src/components/settings/RolePermissionsEditor.tsx
// Tunes one role's permissions for this practice. Only deviations from the
// shipped default are saved, so untouched permissions keep following Scout's
// defaults as the catalog evolves.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchPermissionCatalog,
  fetchRolePermissions,
  saveRolePermissionOverrides,
  ROLE_LABELS,
  type PermissionCatalogEntry,
  type PermissionScope,
  type RolePermissionDetail,
} from '../../api/permissions';
import { useCan, usePermissions } from '../../permissions/PermissionContext';
import './SettingsPermissionScreens.css';

const SCOPE_LABELS: Record<PermissionScope, string> = {
  none: 'No',
  own: 'Their own only',
  team: 'Their team',
  all: 'Yes',
};

/** Practice Admin keeps these so the practice can never lock itself out. */
const ADMIN_LOCKED_KEYS = new Set([
  'role.definition.manage',
  'staff.role.assign',
  'staff.permission.grant',
]);

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message ?? 'Request failed';
  return Array.isArray(msg) ? msg.join(', ') : String(msg);
}

/**
 * Most permissions are simply on or off. Only offer "own" / "team" where some
 * role ships with it, because only those handlers know what "own" means.
 */
function scopesFor(entry: PermissionCatalogEntry): PermissionScope[] {
  const shipped = Object.values(entry.roles);
  const scopes: PermissionScope[] = ['none'];
  if (shipped.includes('own')) scopes.push('own');
  if (shipped.includes('team')) scopes.push('team');
  scopes.push('all');
  return scopes;
}

type Props = {
  practiceId: number;
  role: { id: number; name: string; slug?: string | null };
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function RolePermissionsEditor({ practiceId, role, onMessage }: Props) {
  const canManage = useCan('role.definition.manage');
  const { reload: reloadOwnPermissions } = usePermissions();
  const isCatalogRole = Boolean(role.slug && role.slug in ROLE_LABELS);

  const [entries, setEntries] = useState<PermissionCatalogEntry[]>([]);
  const [sectionLabels, setSectionLabels] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<RolePermissionDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, PermissionScope>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);

  const load = useCallback(() => {
    if (!canManage || !isCatalogRole) return;
    setLoading(true);
    setDraft({});
    Promise.all([fetchPermissionCatalog(practiceId), fetchRolePermissions(practiceId, role.id)])
      .then(([catalog, next]) => {
        setEntries(catalog.entries.filter((e) => e.grantable && !e.unbuilt));
        setSectionLabels(catalog.sections);
        setDetail(next);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(extractErr(err)))
      .finally(() => setLoading(false));
  }, [canManage, isCatalogRole, practiceId, role.id]);

  useEffect(load, [load]);

  const scopeOf = useCallback(
    (key: string): PermissionScope =>
      draft[key] ?? detail?.overrides[key] ?? detail?.defaults[key] ?? 'none',
    [draft, detail]
  );

  const pendingChanges = useMemo(() => {
    if (!detail) return {};
    const out: Record<string, PermissionScope> = {};
    for (const [key, scope] of Object.entries(draft)) {
      const saved = detail.overrides[key] ?? detail.defaults[key] ?? 'none';
      if (scope !== saved) out[key] = scope;
    }
    return out;
  }, [draft, detail]);
  const pendingCount = Object.keys(pendingChanges).length;

  const sections = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const groups = new Map<string, PermissionCatalogEntry[]>();
    for (const entry of entries) {
      const isChanged = scopeOf(entry.key) !== (detail?.defaults[entry.key] ?? 'none');
      if (changedOnly && !isChanged) continue;
      if (needle && !entry.label.toLowerCase().includes(needle)) continue;
      const list = groups.get(entry.section) ?? [];
      list.push(entry);
      groups.set(entry.section, list);
    }
    return [...groups.entries()].map(([section, list]) => ({
      section,
      label: sectionLabels[section] ?? section,
      entries: list,
    }));
  }, [entries, search, changedOnly, scopeOf, detail, sectionLabels]);

  const overrideCount = useMemo(() => {
    if (!detail) return 0;
    return entries.filter((e) => scopeOf(e.key) !== (detail.defaults[e.key] ?? 'none')).length;
  }, [entries, scopeOf, detail]);

  async function save() {
    if (!pendingCount) return;
    setSaving(true);
    try {
      const overrides = await saveRolePermissionOverrides(practiceId, role.id, pendingChanges);
      setDetail((cur) => (cur ? { ...cur, overrides } : cur));
      setDraft({});
      reloadOwnPermissions();
      onMessage?.(
        `Saved ${pendingCount} permission change${pendingCount === 1 ? '' : 's'} for ${role.name}.`,
        'success'
      );
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return null;

  return (
    <div className="settings-card">
      <h3 className="settings-card-title">What can a {role.name} do?</h3>
      {!isCatalogRole ? (
        <p className="settings-muted" style={{ margin: 0 }}>
          This is a custom role, so it doesn’t carry permissions — use it for scheduling and task
          routing. Permissions come from the built-in Scout roles.
        </p>
      ) : loading ? (
        <p className="settings-muted">Loading permissions…</p>
      ) : loadError ? (
        <p className="settings-error">{loadError}</p>
      ) : (
        <>
          <p className="settings-card-subtitle">
            Changes apply to everyone with this role at this practice. Anything you don’t change
            follows Scout’s defaults.{' '}
            {overrideCount > 0 &&
              `${overrideCount} permission${overrideCount === 1 ? '' : 's'} differ from the default.`}
          </p>

          <div className="perm-editor-toolbar">
            <input
              className="settings-input"
              placeholder="Search permissions"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(e) => setChangedOnly(e.target.checked)}
              />
              Only show changes from default
            </label>
          </div>

          {sections.length === 0 && <p className="settings-muted">No permissions match.</p>}
          {sections.map(({ section, label, entries: list }) => (
            <div key={section} className="perm-editor-section">
              <div className="perm-editor-section-name">{label}</div>
              {list.map((entry) => {
                const scope = scopeOf(entry.key);
                const shipped = detail?.defaults[entry.key] ?? 'none';
                const isChanged = scope !== shipped;
                const isPending = entry.key in pendingChanges;
                const locked = role.slug === 'practice_admin' && ADMIN_LOCKED_KEYS.has(entry.key);
                return (
                  <div
                    key={entry.key}
                    className={`perm-editor-row${isChanged ? ' is-changed' : ''}${isPending ? ' is-pending' : ''}`}
                  >
                    <div className="perm-editor-label">
                      <span>{entry.label}</span>
                      {entry.reason && <span className="emp-access-tag is-reason">reason</span>}
                      {entry.requiresLicense && (
                        <span
                          className="emp-access-tag"
                          title="The person also needs this licence, whatever their role says."
                        >
                          {entry.requiresLicense === 'veterinarian' ? 'DVM licence' : 'licence'}
                        </span>
                      )}
                      {entry.note && <div className="perm-editor-note">{entry.note}</div>}
                    </div>
                    <div className="perm-editor-control">
                      <select
                        className="settings-input"
                        value={scope}
                        disabled={locked || saving}
                        title={locked ? 'Practice Admin always keeps this.' : undefined}
                        onChange={(e) =>
                          setDraft((cur) => ({
                            ...cur,
                            [entry.key]: e.target.value as PermissionScope,
                          }))
                        }
                      >
                        {scopesFor(entry).map((s) => (
                          <option key={s} value={s}>
                            {SCOPE_LABELS[s]}
                            {s === shipped ? ' (default)' : ''}
                          </option>
                        ))}
                      </select>
                      {isChanged && !locked && (
                        <button
                          type="button"
                          className="perm-editor-reset"
                          disabled={saving}
                          onClick={() => setDraft((cur) => ({ ...cur, [entry.key]: shipped }))}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="perm-editor-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!pendingCount || saving}
              onClick={() => void save()}
            >
              {saving
                ? 'Saving…'
                : pendingCount
                  ? `Save ${pendingCount} change${pendingCount === 1 ? '' : 's'}`
                  : 'No unsaved changes'}
            </button>
            {pendingCount > 0 && (
              <button
                type="button"
                className="btn secondary"
                disabled={saving}
                onClick={() => setDraft({})}
              >
                Discard
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
