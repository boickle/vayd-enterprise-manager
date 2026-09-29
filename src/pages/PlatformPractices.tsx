// src/pages/PlatformPractices.tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  deletePlatformPracticeConfig,
  deletePlatformPracticeSecret,
  fetchPlatformPractice,
  fetchPlatformPractices,
  setPlatformPracticeConfig,
  setPlatformPracticeDomains,
  setPlatformPracticeSecret,
  updatePlatformPractice,
  type PlatformPracticeDetail,
  type PlatformPracticeSummary,
  type PracticeFeature,
} from '../api/platformPractices';
import './Settings.css';
import './PlatformPractices.css';

const FEATURE_LABELS: Record<PracticeFeature, string> = {
  messaging: 'Messaging (OpenPhone, email)',
  payments: 'Payments (Stripe)',
  evetSync: 'eVet sync',
};

const SETTING_NAME = /^[A-Z][A-Z0-9_]*$/;
const SECRET_REF = /^(env|ssm):.+/;

function extractErr(err: unknown): string {
  const e = err as {
    response?: { status?: number; data?: { message?: string | string[] } };
    message?: string;
  };
  if (e?.response?.status === 403) return 'Only platform admins can see practices.';
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`platform-status platform-status--${status}`}>{status}</span>;
}

export default function PlatformPractices() {
  const [practices, setPractices] = useState<PlatformPracticeSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformPracticeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      setPractices(await fetchPlatformPractices());
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedKey) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    fetchPlatformPractice(selectedKey)
      .then((data) => !cancelled && setDetail(data))
      .catch((err) => !cancelled && setError(extractErr(err)));
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  /** Runs a change, shows the practice as the API now sees it, and refreshes the list. */
  const save = useCallback(
    async (change: () => Promise<PlatformPracticeDetail>, done: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        setDetail(await change());
        setNotice(done);
        void loadList();
        return true;
      } catch (err) {
        setError(extractErr(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [loadList]
  );

  if (loading) return <div className="settings-loading">Loading practices…</div>;

  return (
    <div className="platform-practices">
      {error ? <div className="settings-message settings-error-message">{error}</div> : null}
      {notice ? <div className="settings-message settings-success-message">{notice}</div> : null}

      <div className="settings-table-container">
        <table className="settings-table">
          <thead>
            <tr>
              <th>Practice</th>
              <th>Status</th>
              <th>Hosts</th>
              <th>Switches</th>
              <th>Last backup</th>
              <th>Usage this month</th>
            </tr>
          </thead>
          <tbody>
            {practices.map((p) => (
              <tr
                key={p.key}
                className={`platform-row${p.key === selectedKey ? ' platform-row--selected' : ''}`}
                onClick={() => setSelectedKey(p.key === selectedKey ? null : p.key)}
              >
                <td>
                  <strong>{p.name}</strong>
                  <div className="settings-muted">
                    {p.key}
                    {p.isDefault ? ' · default' : ''}
                  </div>
                </td>
                <td>
                  <StatusBadge status={p.status} />
                  {p.schemaError ? <div className="platform-warn">Schema update failed</div> : null}
                </td>
                <td>{p.hosts.map((h) => h.hostname).join(', ') || '—'}</td>
                <td>
                  {(Object.keys(FEATURE_LABELS) as PracticeFeature[])
                    .filter((f) => p.features[f])
                    .map((f) => FEATURE_LABELS[f].split(' ')[0])
                    .join(', ') || 'none'}
                </td>
                <td>
                  {p.lastBackup ? (
                    <>
                      <StatusBadge status={p.lastBackup.status} />{' '}
                      <span className="settings-muted">{formatWhen(p.lastBackup.startedAt)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {Object.entries(p.usageThisMonth ?? {})
                    .map(([provider, calls]) => `${provider}: ${calls.toLocaleString()}`)
                    .join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedKey && !detail ? (
        <div className="settings-loading">Loading {selectedKey}…</div>
      ) : null}
      {detail ? <PracticeDetail key={detail.key} detail={detail} busy={busy} save={save} /> : null}
    </div>
  );
}

type SaveFn = (change: () => Promise<PlatformPracticeDetail>, done: string) => Promise<boolean>;

function PracticeDetail({
  detail,
  busy,
  save,
}: {
  detail: PlatformPracticeDetail;
  busy: boolean;
  save: SaveFn;
}) {
  const key = detail.key;
  const editable = detail.status === 'active' || detail.status === 'suspended';
  const [name, setName] = useState(detail.name);
  const [hostsText, setHostsText] = useState(detail.hosts.map((h) => h.hostname).join('\n'));
  const [primary, setPrimary] = useState(detail.primaryHost ?? '');
  const hostList = hostsText
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const missing = new Set(Object.values(detail.readiness).flat());
  const secretNames = new Set(detail.secrets.map((s) => s.name));
  const configNames = new Set(detail.config.map((c) => c.name));

  return (
    <div className="platform-detail">
      <h2 className="settings-section-title">
        {detail.name} <StatusBadge status={detail.status} />
      </h2>
      <p className="settings-muted">
        Database {detail.database} · schema at {detail.schema.lastMigration ?? 'unknown'} (
        {formatWhen(detail.schema.migratedAt)})
      </p>
      {detail.schema.error ? (
        <div className="settings-message settings-error-message">
          The last schema update failed, so the practice is in maintenance until the next successful
          run: {detail.schema.error}
        </div>
      ) : null}

      <section className="settings-card">
        <h3 className="settings-card-title">General</h3>
        <div className="platform-inline-form">
          <input
            className="settings-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Practice name"
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !name.trim() || name.trim() === detail.name}
            onClick={() => save(() => updatePlatformPractice(key, { name }), 'Name saved.')}
          >
            Save name
          </button>
          {!detail.isDefault && editable ? (
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={busy}
              onClick={() => {
                const status = detail.status === 'active' ? 'suspended' : 'active';
                if (
                  status === 'suspended' &&
                  !window.confirm(`Suspend ${detail.name}? Nobody will be able to use it.`)
                ) {
                  return;
                }
                void save(
                  () => updatePlatformPractice(key, { status }),
                  status === 'active' ? 'Practice reactivated.' : 'Practice suspended.'
                );
              }}
            >
              {detail.status === 'active' ? 'Suspend practice' : 'Reactivate practice'}
            </button>
          ) : null}
        </div>

        <div className="platform-switches">
          {(Object.keys(FEATURE_LABELS) as PracticeFeature[]).map((feature) => (
            <label key={feature} className="settings-checkbox-item">
              <input
                type="checkbox"
                checked={detail.features[feature]}
                disabled={busy}
                onChange={(e) =>
                  save(
                    () =>
                      updatePlatformPractice(key, { features: { [feature]: e.target.checked } }),
                    `${FEATURE_LABELS[feature]} ${e.target.checked ? 'on' : 'off'}.`
                  )
                }
              />
              <span>
                {FEATURE_LABELS[feature]}
                {detail.readiness[feature].length ? (
                  <span className="platform-warn">
                    {' '}
                    — needs {detail.readiness[feature].join(', ')}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          {detail.isDefault ? (
            <p className="settings-muted">
              The default practice reads missing settings from the server&apos;s environment.
            </p>
          ) : null}
        </div>
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Hosts</h3>
        <p className="settings-card-subtitle">
          One host name per line. Links and emails use the primary.
        </p>
        <textarea
          className="settings-input platform-hosts"
          rows={Math.max(2, hostList.length + 1)}
          value={hostsText}
          onChange={(e) => setHostsText(e.target.value)}
          aria-label="Host names"
        />
        <div className="platform-inline-form">
          <select
            className="settings-select"
            value={hostList.includes(primary) ? primary : (hostList[0] ?? '')}
            onChange={(e) => setPrimary(e.target.value)}
            aria-label="Primary host"
          >
            {hostList.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !hostList.length}
            onClick={() =>
              save(
                () =>
                  setPlatformPracticeDomains(
                    key,
                    hostList,
                    hostList.includes(primary) ? primary : hostList[0]
                  ),
                'Hosts saved.'
              )
            }
          >
            Save hosts
          </button>
        </div>
      </section>

      <SettingsTable
        title="Secrets"
        subtitle="Stored as references only: env:VARIABLE_NAME reads the server's environment, ssm:/path reads AWS Parameter Store. Never paste the secret itself."
        rows={detail.secrets.map((s) => ({ name: s.name, value: s.valueRef }))}
        valueLabel="Reference"
        valuePlaceholder="ssm:/scout/practice/NAME"
        suggestions={[...missing].filter((n) => !secretNames.has(n))}
        validateValue={(v) =>
          SECRET_REF.test(v) ? null : 'Use env:VARIABLE_NAME or ssm:/parameter/name.'
        }
        busy={busy}
        onSave={(n, v) => save(() => setPlatformPracticeSecret(key, n, v), `${n} saved.`)}
        onDelete={(n) => save(() => deletePlatformPracticeSecret(key, n), `${n} removed.`)}
      />

      <SettingsTable
        title="Settings"
        subtitle="Non-secret settings stored in the practice's own database, such as BRAND_NAME or SES_FROM."
        rows={detail.config}
        valueLabel="Value"
        valuePlaceholder="Value"
        suggestions={[...missing].filter((n) => !configNames.has(n) && !secretNames.has(n))}
        validateValue={(v) => (v.trim() ? null : 'Enter a value.')}
        busy={busy}
        onSave={(n, v) => save(() => setPlatformPracticeConfig(key, n, v), `${n} saved.`)}
        onDelete={(n) => save(() => deletePlatformPracticeConfig(key, n), `${n} removed.`)}
      />

      <section className="settings-card">
        <h3 className="settings-card-title">Recent backups</h3>
        {detail.backups.length ? (
          <table className="settings-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {detail.backups.map((b) => (
                <tr key={b.id}>
                  <td>{formatWhen(b.startedAt)}</td>
                  <td>{b.kind}</td>
                  <td>
                    <StatusBadge status={b.status} />
                    {b.error ? <div className="platform-warn">{b.error}</div> : null}
                  </td>
                  <td>{formatBytes(b.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="settings-muted">No backups recorded yet.</p>
        )}
      </section>

      <section className="settings-card">
        <h3 className="settings-card-title">Usage, last 30 days</h3>
        {detail.usage.length ? (
          <table className="settings-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Service</th>
                <th>Operation</th>
                <th>Calls</th>
                <th>In / out</th>
              </tr>
            </thead>
            <tbody>
              {detail.usage.map((u) => (
                <tr key={`${u.day}-${u.provider}-${u.operation}`}>
                  <td>{u.day}</td>
                  <td>{u.provider}</td>
                  <td>{u.operation}</td>
                  <td>{u.calls.toLocaleString()}</td>
                  <td>
                    {u.unitsIn || u.unitsOut
                      ? `${u.unitsIn.toLocaleString()} / ${u.unitsOut.toLocaleString()} ${u.unit}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="settings-muted">No usage recorded in the last 30 days.</p>
        )}
      </section>
    </div>
  );
}

function SettingsTable({
  title,
  subtitle,
  rows,
  valueLabel,
  valuePlaceholder,
  suggestions,
  validateValue,
  busy,
  onSave,
  onDelete,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ name: string; value: string }>;
  valueLabel: string;
  valuePlaceholder: string;
  suggestions: string[];
  validateValue: (value: string) => string | null;
  busy: boolean;
  onSave: (name: string, value: string) => Promise<boolean>;
  onDelete: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const listId = `platform-${title.toLowerCase()}-names`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim().toUpperCase();
    const v = value.trim();
    const problem = !SETTING_NAME.test(n)
      ? 'Names use capital letters, digits, and underscores.'
      : validateValue(v);
    setFormError(problem);
    if (problem) return;
    if (await onSave(n, v)) {
      setName('');
      setValue('');
    }
  };

  return (
    <section className="settings-card">
      <h3 className="settings-card-title">{title}</h3>
      <p className="settings-card-subtitle">{subtitle}</p>
      {rows.length ? (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>{valueLabel}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>
                  <code>{row.name}</code>
                </td>
                <td className="platform-value">{row.value}</td>
                <td className="platform-row-actions">
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setName(row.name);
                      setValue(row.value);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove ${row.name}?`)) void onDelete(row.name);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="settings-muted">None set.</p>
      )}
      <form className="platform-inline-form" onSubmit={submit}>
        <input
          className="settings-input"
          placeholder="NAME"
          list={listId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`${title} name`}
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <input
          className="settings-input platform-value-input"
          placeholder={valuePlaceholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={`${title} ${valueLabel.toLowerCase()}`}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-sm" disabled={busy}>
          Save
        </button>
      </form>
      {formError ? <div className="platform-warn">{formError}</div> : null}
    </section>
  );
}
