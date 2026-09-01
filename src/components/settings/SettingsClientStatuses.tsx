import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import {
  listClientStatuses,
  patchClientStatus,
  type ClientStatusRow,
} from '../../api/clientStatuses';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Could not save client statuses.';
}

type Draft = {
  name: string;
  discount: number;
  isActive: boolean;
};

function toDraft(row: ClientStatusRow): Draft {
  return {
    name: row.name,
    discount: Number(row.discount) || 0,
    isActive: row.isActive !== false,
  };
}

function sortRows(rows: ClientStatusRow[]): ClientStatusRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.isActive !== false) - Number(a.isActive !== false) ||
      a.name.localeCompare(b.name),
  );
}

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsClientStatuses({ onMessage }: Props) {
  const [rows, setRows] = useState<ClientStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<ClientStatusRow | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', discount: 0, isActive: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(sortRows(await listClientStatuses({ includeInactive: true })));
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(row: ClientStatusRow) {
    setDraft(toDraft(row));
    setEditor(row);
  }

  async function save() {
    if (!editor) return;
    const name = draft.name.trim();
    if (!name) {
      onMessage?.('Name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const next = await patchClientStatus(editor.id, {
        name,
        discount: Number(draft.discount) || 0,
        isActive: draft.isActive,
      });
      setRows((cur) => sortRows(cur.map((r) => (r.id === next.id ? next : r))));
      onMessage?.('Client discount status saved.', 'success');
      setEditor(null);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(row: ClientStatusRow, isActive: boolean) {
    setSaving(true);
    try {
      const next = await patchClientStatus(row.id, { isActive });
      setRows((cur) => sortRows(cur.map((r) => (r.id === next.id ? next : r))));
      onMessage?.(isActive ? 'Status reactivated.' : 'Status inactivated.', 'success');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-card">
      <div>
        <h3 className="settings-card-title">Client discounts (Account Status)</h3>
        <p className="settings-muted">
          Same statuses as eVet Account Status (Employee, Family/Friends, Senior, Veteran,
          etc.). Assign one on the client record to apply the standing discount. Inactivate
          to hide from new picks without deleting history.
        </p>
      </div>
      {loading ? (
        <p className="settings-muted">Loading…</p>
      ) : error ? (
        <p className="settings-muted">{error}</p>
      ) : (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Discount %</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const inactive = row.isActive === false;
              return (
                <tr key={row.id} style={inactive ? { opacity: 0.65 } : undefined}>
                  <td>{row.name}</td>
                  <td>{row.code || '—'}</td>
                  <td>{Number(row.discount) || 0}%</td>
                  <td>{inactive ? 'Inactive' : 'Active'}</td>
                  <td>
                    <button type="button" className="btn-link" onClick={() => openEdit(row)}>
                      <Pencil size={14} aria-hidden /> Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => void setActive(row, inactive)}
                      disabled={saving}
                    >
                      {inactive ? 'Reactivate' : 'Inactivate'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {editor && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              onClick={() => !saving && setEditor(null)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 80,
                padding: 16,
              }}
            >
              <div
                className="settings-card"
                style={{ width: 'min(420px, 100%)', maxHeight: '90vh', overflow: 'auto' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="settings-card-title">Edit status</h3>
                  <button type="button" className="btn-link" onClick={() => setEditor(null)}>
                    <X size={18} />
                  </button>
                </div>
                <label style={{ display: 'block', marginBottom: 12 }}>
                  Name
                  <input
                    className="input"
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 12 }}>
                  Discount %
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.1}
                    value={draft.discount}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, discount: Number(e.target.value) || 0 }))
                    }
                  />
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                  />
                  Active
                </label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn secondary" onClick={() => setEditor(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
