import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  createSupplier,
  listSuppliers,
  updateSupplier,
  type InventorySupplier,
} from '../api/inventoryOps';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

const EMPTY = {
  name: '',
  supplierType: 'distributor',
  isActive: true,
  roundOrdersToPackSize: false,
  defaultOrderFrequency: 'weekly',
  allowBackorders: true,
  website: '',
  repName: '',
  rep2Name: '',
  accountNumber: '',
  notes: '',
};

export default function SuppliersAdminPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [rows, setRows] = useState<InventorySupplier[]>([]);
  const [editing, setEditing] = useState<InventorySupplier | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setRows(await listSuppliers(practiceId));
  }

  useEffect(() => {
    void reload().catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to load')
    );
  }, [practiceId]);

  function startNew() {
    setEditing(null);
    setForm(EMPTY);
  }

  function startEdit(s: InventorySupplier) {
    setEditing(s);
    setForm({
      name: s.name,
      supplierType: s.supplierType,
      isActive: s.isActive,
      roundOrdersToPackSize: s.roundOrdersToPackSize,
      defaultOrderFrequency: s.defaultOrderFrequency,
      allowBackorders: s.allowBackorders,
      website: s.website ?? '',
      repName: s.repName ?? '',
      rep2Name: s.rep2Name ?? '',
      accountNumber: s.accountNumber ?? '',
      notes: s.notes ?? '',
    });
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        supplierType: form.supplierType,
        isActive: form.isActive,
        roundOrdersToPackSize: form.roundOrdersToPackSize,
        defaultOrderFrequency: form.defaultOrderFrequency,
        allowBackorders: form.allowBackorders,
        website: form.website.trim() || null,
        repName: form.repName.trim() || null,
        rep2Name: form.rep2Name.trim() || null,
        accountNumber: form.accountNumber.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editing) await updateSupplier(practiceId, editing.id, body);
      else await createSupplier(practiceId, body);
      await reload();
      startNew();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-card" style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Suppliers</h2>
      {error && (
        <div className="settings-message settings-error-message">{error}</div>
      )}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {rows.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 0',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <div>
              <strong>{s.name}</strong>
              <div className="settings-muted" style={{ fontSize: 13 }}>
                {s.supplierType} · {s.isActive ? 'Active' : 'Inactive'}
              </div>
            </div>
            <button type="button" className="btn secondary" onClick={() => startEdit(s)}>
              Edit
            </button>
          </li>
        ))}
      </ul>

      <button type="button" className="btn" style={{ margin: '12px 0' }} onClick={startNew}>
        + Add supplier
      </button>

      <h3>{editing ? 'Edit supplier' : 'Add / edit supplier'}</h3>
      <label className="settings-label">
        Name
        <input
          className="settings-input"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </label>
      <label className="settings-label">
        Type
        <select
          className="settings-input"
          value={form.supplierType}
          onChange={(e) => setForm((f) => ({ ...f, supplierType: e.target.value }))}
        >
          <option value="distributor">Distributor</option>
          <option value="manufacturer">Manufacturer</option>
          <option value="direct">Direct</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="settings-checkbox-item">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
        />
        <span>Active</span>
      </label>
      <label className="settings-checkbox-item">
        <input
          type="checkbox"
          checked={form.roundOrdersToPackSize}
          onChange={(e) =>
            setForm((f) => ({ ...f, roundOrdersToPackSize: e.target.checked }))
          }
        />
        <span>Round orders to pack size</span>
      </label>
      <label className="settings-label">
        Default order frequency
        <select
          className="settings-input"
          value={form.defaultOrderFrequency}
          onChange={(e) =>
            setForm((f) => ({ ...f, defaultOrderFrequency: e.target.value }))
          }
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <label className="settings-checkbox-item">
        <input
          type="checkbox"
          checked={form.allowBackorders}
          onChange={(e) => setForm((f) => ({ ...f, allowBackorders: e.target.checked }))}
        />
        <span>Allow backorders</span>
      </label>
      <label className="settings-label">
        Website
        <input
          className="settings-input"
          value={form.website}
          onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
        />
      </label>
      <label className="settings-label">
        Rep
        <input
          className="settings-input"
          value={form.repName}
          onChange={(e) => setForm((f) => ({ ...f, repName: e.target.value }))}
        />
      </label>
      <label className="settings-label">
        Rep 2
        <input
          className="settings-input"
          value={form.rep2Name}
          onChange={(e) => setForm((f) => ({ ...f, rep2Name: e.target.value }))}
        />
      </label>
      <label className="settings-label">
        Account #
        <input
          className="settings-input"
          value={form.accountNumber}
          onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
        />
      </label>
      <label className="settings-label">
        Notes
        <textarea
          className="settings-input"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          style={{ maxWidth: 'none', width: '100%' }}
        />
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? 'Saving…' : 'Save supplier'}
      </button>
    </div>
  );
}
