import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Plus, X } from 'lucide-react';
import {
  createPatientStatus,
  listPatientStatuses,
  patchPatientStatus,
  type PatientStatusRow,
} from '../../api/patientStatuses';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Could not save patient statuses.';
}

type Draft = {
  name: string;
  marksInactive: boolean;
  isActive: boolean;
};

function toDraft(row: PatientStatusRow): Draft {
  return {
    name: row.name,
    marksInactive: row.marksInactive === true,
    isActive: row.isActive !== false,
  };
}

function sortRows(rows: PatientStatusRow[]): PatientStatusRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.isActive !== false) - Number(a.isActive !== false) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name),
  );
}

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsPatientStatuses({ onMessage }: Props) {
  const [rows, setRows] = useState<PatientStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<PatientStatusRow | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>({
    name: '',
    marksInactive: false,
    isActive: true,
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(sortRows(await listPatientStatuses({ includeInactive: true })));
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(row: PatientStatusRow) {
    setDraft(toDraft(row));
    setEditor(row);
  }

  function openNew() {
    setDraft({ name: '', marksInactive: false, isActive: true });
    setEditor('new');
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      onMessage?.('Name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editor === 'new') {
        const created = await createPatientStatus({
          name,
          marksInactive: draft.marksInactive,
          isActive: draft.isActive,
        });
        setRows((cur) => sortRows([...cur, created]));
        onMessage?.('Patient status created.', 'success');
      } else if (editor) {
        const next = await patchPatientStatus(editor.id, {
          name,
          marksInactive: draft.marksInactive,
          isActive: draft.isActive,
        });
        setRows((cur) => sortRows(cur.map((r) => (r.id === next.id ? next : r))));
        onMessage?.('Patient status saved.', 'success');
      }
      setEditor(null);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(row: PatientStatusRow, isActive: boolean) {
    setSaving(true);
    try {
      const next = await patchPatientStatus(row.id, { isActive });
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
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <h3 className="settings-card-title">Patient statuses</h3>
          <p className="settings-muted">
            Scout-owned list (Euthanized, Deceased, Adopted, …). Catalog items can move a pet to
            one of these when charged; mark inactive statuses to hide them from new picks.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={openNew}>
          <Plus size={14} aria-hidden /> Add status
        </button>
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
              <th>Marks inactive</th>
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
                  <td>{row.marksInactive ? 'Yes' : 'No'}</td>
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
                  <h3 className="settings-card-title">
                    {editor === 'new' ? 'New patient status' : 'Edit patient status'}
                  </h3>
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
                    placeholder="e.g. Euthanized"
                  />
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={draft.marksInactive}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, marksInactive: e.target.checked }))
                    }
                  />
                  Marks patient inactive when applied
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                  />
                  Active (available in catalog / PIMS picks)
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
