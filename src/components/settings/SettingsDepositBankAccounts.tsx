import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import {
  createDepositBankAccount,
  listDepositBankAccounts,
  patchDepositBankAccount,
  type DepositBankAccount,
} from '../../api/depositBankAccounts';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Could not save bank accounts.';
}

type Draft = {
  name: string;
  accountNumber: string;
  isActive: boolean;
  sortOrder: number;
};

function emptyDraft(): Draft {
  return { name: '', accountNumber: '', isActive: true, sortOrder: 0 };
}

function toDraft(row: DepositBankAccount): Draft {
  return {
    name: row.name,
    accountNumber: row.accountNumber,
    isActive: row.isActive !== false,
    sortOrder: Number(row.sortOrder) || 0,
  };
}

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsDepositBankAccounts({ onMessage }: Props) {
  const [rows, setRows] = useState<DepositBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    { mode: 'new' } | { mode: 'edit'; row: DepositBankAccount } | null
  >(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listDepositBankAccounts());
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setDraft(emptyDraft());
    setEditor({ mode: 'new' });
  }

  function openEdit(row: DepositBankAccount) {
    setDraft(toDraft(row));
    setEditor({ mode: 'edit', row });
  }

  async function save() {
    const name = draft.name.trim();
    const accountNumber = draft.accountNumber.trim();
    if (!name || !accountNumber) {
      onMessage?.('Name and account number are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editor?.mode === 'edit') {
        const next = await patchDepositBankAccount(editor.row.id, {
          name,
          accountNumber,
          isActive: draft.isActive,
          sortOrder: draft.sortOrder,
        });
        setRows((cur) => cur.map((r) => (r.id === next.id ? next : r)));
        onMessage?.('Bank account saved.', 'success');
      } else {
        await createDepositBankAccount({
          name,
          accountNumber,
          isActive: draft.isActive,
          sortOrder: draft.sortOrder,
        });
        await load();
        onMessage?.('Bank account added.', 'success');
      }
      setEditor(null);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-card" style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <h3 className="settings-card-title">Deposit bank accounts</h3>
          <p className="settings-muted">
            Banks available when grabbing cash/check tenders into a deposit on Analytics → Bank
            deposits.
          </p>
        </div>
        <button type="button" className="btn" onClick={openNew}>
          Add bank account
        </button>
      </div>
      {loading ? (
        <p className="settings-muted">Loading bank accounts…</p>
      ) : error ? (
        <p className="settings-muted">{error}</p>
      ) : rows.length === 0 ? (
        <p className="settings-muted">No bank accounts yet.</p>
      ) : (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Account #</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={row.isActive === false ? { opacity: 0.65 } : undefined}>
                <td>{row.name}</td>
                <td>{row.accountNumber}</td>
                <td>{row.isActive === false ? 'Inactive' : 'Active'}</td>
                <td>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => openEdit(row)}
                    title="Edit bank account"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editor && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="bank-acct-title"
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
                className="card"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 'min(440px, 92vw)',
                  padding: 24,
                  borderRadius: 12,
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 id="bank-acct-title" style={{ margin: 0, fontSize: 18 }}>
                    {editor.mode === 'edit' ? 'Edit bank account' : 'Add bank account'}
                  </h3>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setEditor(null)}
                    disabled={saving}
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <label className="settings-label">
                  Name *
                  <input
                    className="settings-input"
                    style={{ maxWidth: 'none', marginTop: 6 }}
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </label>
                <label className="settings-label" style={{ marginTop: 14 }}>
                  Account number *
                  <input
                    className="settings-input"
                    style={{ maxWidth: 'none', marginTop: 6 }}
                    value={draft.accountNumber}
                    onChange={(e) => setDraft((d) => ({ ...d, accountNumber: e.target.value }))}
                  />
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
                  />
                  Active
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={saving}
                    onClick={() => setEditor(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving || !draft.name.trim() || !draft.accountNumber.trim()}
                    onClick={() => void save()}
                  >
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
