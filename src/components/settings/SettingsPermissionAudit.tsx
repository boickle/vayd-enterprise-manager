// src/components/settings/SettingsPermissionAudit.tsx
// Who used a controlled permission, on what, and why — voids, refunds, price
// changes, post-close corrections, reopenings, and changes to permissions
// themselves.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import {
  describeAccessChange,
  fetchPermissionAudit,
  fetchPermissionCatalog,
  type PermissionAuditEntry,
  type PermissionCatalogEntry,
} from '../../api/permissions';
import { PermissionDenied } from '../../permissions/PermissionGate';
import { useCan } from '../../permissions/PermissionContext';
import { formatYmd } from '../../utils/formatYmd';
import './SettingsPermissionScreens.css';

const ENTITY_LABELS: Record<string, string> = {
  visit_invoice: 'Invoice',
  visit_invoice_line: 'Invoice line',
  visit_invoice_tender: 'Payment',
  encounter_order: 'Visit order',
  inventory_item: 'Inventory item',
  mail_order: 'Mail order',
  client: 'Client',
  patient: 'Patient',
  employee: 'Staff member',
  employee_role: 'Role',
};

const PAGE_LIMIT = 1000;

function isoDay(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

function formatValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message ?? 'Request failed';
  return Array.isArray(msg) ? msg.join(', ') : String(msg);
}

/** An offboarding (last day, who takes over) as plain words. */
function describeOffboard(
  detail: Record<string, unknown>,
  staffName: (id: unknown) => string
): string[] {
  const lines: string[] = [];
  if (detail.lastDay) lines.push(`Last day: ${formatYmd(String(detail.lastDay))}`);
  if (detail.taskToEmployeeId != null)
    lines.push(`Tasks go to: ${staffName(detail.taskToEmployeeId)}`);
  if (detail.primaryDoctorToId != null) {
    lines.push(`Their pets and households go to: ${staffName(detail.primaryDoctorToId)}`);
  }
  if (Array.isArray(detail.worksWith) && detail.worksWith.length) {
    const byDoctor = new Map<string, number>();
    for (const w of detail.worksWith as Array<{ doctorId?: unknown }>) {
      const to = w?.doctorId != null ? staffName(w.doctorId) : 'no doctor';
      byDoctor.set(to, (byDoctor.get(to) ?? 0) + 1);
    }
    for (const [to, n] of byDoctor) {
      lines.push(
        `Now work with ${to}: ${n === 1 ? '1 person' : `${n} people`} who worked with them`
      );
    }
  }
  if (detail.householdClientId != null)
    lines.push(`Their household: Client #${formatValue(detail.householdClientId)}`);
  return lines;
}

const GRANT_SCOPE_WORDS: Record<string, string> = {
  own: 'their own only',
  team: 'their team',
};

/** One extra permission given or taken away (B5, Nov 11): what, how far, and until when. */
function describeGrant(detail: Record<string, unknown>, labelOf: (key: string) => string): string[] {
  const what = typeof detail.permissionKey === 'string' ? labelOf(detail.permissionKey) : 'a permission';
  if (detail.action === 'revoke') return [`Extra permission removed: ${what}`];
  const scope = GRANT_SCOPE_WORDS[String(detail.scope ?? '')];
  const lines = [`Extra permission given: ${what}${scope ? ` (${scope})` : ''}`];
  lines.push(detail.expiresAt ? `Ends: ${formatYmd(String(detail.expiresAt))}` : 'No end date');
  return lines;
}

type LicenseState = { isLicensed?: unknown; licenseType?: unknown };

function isLicenseChange(
  detail: Record<string, unknown>
): detail is { before: LicenseState; after: LicenseState } {
  const has = (v: unknown) => !!v && typeof v === 'object' && 'isLicensed' in (v as object);
  return has(detail.before) && has(detail.after);
}

type LicenseRowDetail = { kind?: string; state?: string; number?: string };

/** Settings → Staff state license saves (Nov 12, 2026): one line per license added, changed or removed. */
export function describeLicenseList(detail: Record<string, unknown>): string[] {
  const rows = (v: unknown): LicenseRowDetail[] => (Array.isArray(v) ? (v as LicenseRowDetail[]) : []);
  const name = (r: LicenseRowDetail) => `License (${r.state ?? '?'})`;
  const key = (r: LicenseRowDetail) => `${r.kind}:${r.state}`;
  const before = new Map(rows(detail.before).map((r) => [key(r), r]));
  const after = new Map(rows(detail.after).map((r) => [key(r), r]));
  const lines: string[] = [];
  for (const [k, r] of after) {
    const was = before.get(k);
    if (!was) lines.push(`${name(r)} added: ${r.number ?? ''}`);
    else if (was.number !== r.number) lines.push(`${name(r)}: ${was.number ?? ''} → ${r.number ?? ''}`);
  }
  for (const [k, r] of before) if (!after.has(k)) lines.push(`${name(r)} removed (was ${r.number ?? ''})`);
  return lines.length ? lines : ['Licenses saved, no change'];
}

function licenseWords(state: LicenseState): string {
  if (state.isLicensed !== true) return 'Not licensed';
  if (state.licenseType === 'veterinarian') return 'Licensed veterinarian';
  if (state.licenseType === 'technician') return 'Licensed technician';
  return 'Licensed';
}

/** Turns the stored detail blob into short "x: a → b" lines. */
export function describeDetail(
  detail: PermissionAuditEntry['detail'],
  labelOf: (key: string) => string,
  staffName: (id: unknown) => string = (id) => `#${formatValue(id)}`
): string[] {
  if (!detail) return [];
  if (detail.action === 'roles') {
    return [
      describeAccessChange({ permissionKey: 'staff.role.assign', detail } as PermissionAuditEntry),
    ];
  }
  if (detail.action === 'licenses') return describeLicenseList(detail);
  if ('offboardingId' in detail) return describeOffboard(detail, staffName);
  if (detail.action === 'grant' || detail.action === 'revoke') return describeGrant(detail, labelOf);
  if (isLicenseChange(detail)) {
    return [`License: ${licenseWords(detail.before)} → ${licenseWords(detail.after)}`];
  }
  const lines: string[] = [];
  const changes = detail.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  if (changes && typeof changes === 'object') {
    for (const [key, change] of Object.entries(changes)) {
      lines.push(`${labelOf(key)}: ${formatValue(change?.from)} → ${formatValue(change?.to)}`);
    }
  }
  const before = detail.before as Record<string, unknown> | undefined;
  const after = detail.after as Record<string, unknown> | undefined;
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (formatValue(before[key]) === formatValue(after[key])) continue;
      lines.push(`${key}: ${formatValue(before[key])} → ${formatValue(after[key])}`);
    }
  }
  for (const [key, value] of Object.entries(detail)) {
    if (key === 'changes' || key === 'before' || key === 'after') continue;
    const shown =
      key === 'permissionKey' && typeof value === 'string' ? labelOf(value) : formatValue(value);
    lines.push(`${key}: ${shown}`);
  }
  return lines;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

type Props = { practiceId: number };

/** Logged actions that aren't role permissions, so they are not in the catalog. */
const NON_CATALOG_ACTIONS = [{ key: 'auth.impersonate', label: 'Viewed Scout as someone else' }];

export default function SettingsPermissionAudit({ practiceId }: Props) {
  const canView = useCan('audit.log.view');

  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [permissionKey, setPermissionKey] = useState('');
  const [employeeId, setEmployeeId] = useState('');

  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<PermissionAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    fetchPermissionCatalog(practiceId)
      .then((c) => setCatalog(c.entries))
      .catch(() => setCatalog([]));
    fetchAllEmployees()
      .then((list) => setEmployees(Array.isArray(list) ? list : []))
      .catch(() => setEmployees([]));
  }, [canView, practiceId]);

  const load = useCallback(() => {
    if (!canView) return;
    setLoading(true);
    // `to` is inclusive of the whole chosen day.
    const toExclusive = new Date(`${to}T00:00:00`);
    toExclusive.setDate(toExclusive.getDate() + 1);
    fetchPermissionAudit(practiceId, {
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: toExclusive.toISOString(),
      permissionKeys: permissionKey ? [permissionKey] : undefined,
      employeeId: employeeId ? Number(employeeId) : undefined,
      limit: PAGE_LIMIT,
    })
      .then((list) => {
        setRows(list);
        setError(null);
      })
      .catch((err: unknown) => {
        setRows([]);
        setError(extractErr(err));
      })
      .finally(() => setLoading(false));
  }, [canView, practiceId, from, to, permissionKey, employeeId]);

  useEffect(load, [load]);

  const labelByKey = useMemo(
    () =>
      new Map(
        [...catalog, ...NON_CATALOG_ACTIONS].map((entry) => [entry.key, entry.label])
      ),
    [catalog]
  );
  const labelOf = useCallback((key: string) => labelByKey.get(key) ?? key, [labelByKey]);

  /** Only actions that can land in the log: reason-coded ones plus the permission editors. */
  const auditedActions = useMemo(
    () =>
      catalog
        .filter(
          (entry) =>
            entry.reason ||
            entry.key.startsWith('staff.') ||
            entry.key === 'role.definition.manage' ||
            entry.key === 'invoice.price.change' ||
            entry.key === 'invoice.reopen' ||
            entry.key === 'payment.refund'
        )
        .concat(NON_CATALOG_ACTIONS as typeof catalog)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [catalog]
  );

  const staffOptions = useMemo(
    () =>
      employees
        .filter((e) => e.isDeleted !== true)
        .map((e) => ({
          id: e.id,
          name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || `Employee ${e.id}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  );
  const staffNameById = useMemo(
    () => new Map(staffOptions.map((s) => [s.id, s.name])),
    [staffOptions]
  );

  function whoOf(row: PermissionAuditEntry): string {
    return (
      row.employeeName ||
      (row.employeeId ? staffNameById.get(row.employeeId) : undefined) ||
      row.grantedBy ||
      (row.employeeId ? `Employee ${row.employeeId}` : 'System')
    );
  }

  const staffName = useCallback(
    (id: unknown) => staffNameById.get(Number(id)) ?? `#${formatValue(id)}`,
    [staffNameById]
  );

  function recordOf(row: PermissionAuditEntry): string {
    if (!row.entityType) return '—';
    const label = ENTITY_LABELS[row.entityType] ?? row.entityType;
    if (row.entityType === 'employee' && row.entityId) {
      return `${label}: ${staffNameById.get(row.entityId) ?? `#${row.entityId}`}`;
    }
    return row.entityId ? `${label} #${row.entityId}` : label;
  }

  function downloadCsv() {
    const header = [
      'When',
      'Who',
      'Action',
      'Record',
      'Client ID',
      'Patient ID',
      'Amount',
      'Reason',
      'Details',
    ];
    const lines = rows.map((row) =>
      [
        new Date(row.created).toISOString(),
        whoOf(row),
        labelOf(row.permissionKey),
        recordOf(row),
        row.clientId != null ? String(row.clientId) : '',
        row.patientId != null ? String(row.patientId) : '',
        row.amount ?? '',
        row.reason ?? '',
        describeDetail(row.detail, labelOf, staffName).join('; '),
      ]
        .map(csvCell)
        .join(',')
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `permission-audit-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!canView) {
    return <PermissionDenied what="The permission audit log" />;
  }

  return (
    <div className="settings-card" style={{ marginTop: 0 }}>
      <div className="perm-audit-filters">
        <label>
          <span className="settings-label">From</span>
          <input
            className="settings-input"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span className="settings-label">To</span>
          <input
            className="settings-input"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          <span className="settings-label">Action</span>
          <select
            className="settings-input"
            value={permissionKey}
            onChange={(e) => setPermissionKey(e.target.value)}
          >
            <option value="">All actions</option>
            {auditedActions.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="settings-label">Done by</span>
          <select
            className="settings-input"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Anyone</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn secondary"
          disabled={!rows.length}
          onClick={downloadCsv}
        >
          Download CSV
        </button>
      </div>

      {error ? (
        <p className="settings-error">{error}</p>
      ) : loading ? (
        <p className="settings-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="settings-muted" style={{ margin: 0 }}>
          Nothing recorded for these filters.
        </p>
      ) : (
        <>
          <p className="settings-muted" style={{ fontSize: 12 }}>
            {rows.length === PAGE_LIMIT
              ? `Showing the latest ${PAGE_LIMIT} entries — narrow the dates to see older ones.`
              : `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}, newest first.`}
          </p>
          <div className="perm-audit-table-wrap">
            <table className="perm-audit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Record</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>What changed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const details = describeDetail(row.detail, labelOf, staffName);
                  return (
                    <tr key={row.id}>
                      <td className="perm-audit-nowrap">{formatWhen(row.created)}</td>
                      <td>{whoOf(row)}</td>
                      <td>{labelOf(row.permissionKey)}</td>
                      <td>
                        {recordOf(row)}
                        {(row.clientId || row.patientId) && (
                          <div className="perm-audit-sub">
                            {row.clientId ? `Client #${row.clientId}` : ''}
                            {row.clientId && row.patientId ? ' · ' : ''}
                            {row.patientId ? `Patient #${row.patientId}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="perm-audit-nowrap">
                        {row.amount != null && row.amount !== ''
                          ? `$${Number(row.amount).toFixed(2)}`
                          : '—'}
                      </td>
                      <td>{row.reason || '—'}</td>
                      <td>
                        {details.length ? (
                          <ul className="perm-audit-details">
                            {details.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
