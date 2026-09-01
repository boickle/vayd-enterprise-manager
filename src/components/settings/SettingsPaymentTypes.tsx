import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X } from 'lucide-react';
import {
  createPaymentType,
  listPaymentTypes,
  patchPaymentType,
  PAYMENT_OPTION_TYPE_LABELS,
  PAYMENT_OPTION_TYPES,
  type PaymentOptionType,
  type PracticePaymentType,
} from '../../api/paymentTypes';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Could not save payment types.';
}

type Draft = {
  name: string;
  optionType: PaymentOptionType;
  isDefault: boolean;
  isDiscountCategory: boolean;
  discountPercent: number;
  excludeFromIncome: boolean;
  isActive: boolean;
};

function emptyDraft(): Draft {
  return {
    name: '',
    optionType: 'other',
    isDefault: false,
    isDiscountCategory: false,
    discountPercent: 0,
    excludeFromIncome: false,
    isActive: true,
  };
}

function toDraft(row: PracticePaymentType): Draft {
  return {
    name: row.name,
    optionType: row.optionType,
    isDefault: row.isDefault,
    isDiscountCategory: row.isDiscountCategory,
    discountPercent: Number(row.discountPercent) || 0,
    excludeFromIncome: row.excludeFromIncome,
    isActive: row.isActive !== false,
  };
}

function sortTypes(rows: PracticePaymentType[]): PracticePaymentType[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.isActive !== false) - Number(a.isActive !== false) ||
      Number(b.isDefault) - Number(a.isDefault) ||
      a.name.localeCompare(b.name),
  );
}

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsPaymentTypes({ onMessage }: Props) {
  const [rows, setRows] = useState<PracticePaymentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: 'new' } | { mode: 'edit'; row: PracticePaymentType } | null>(
    null,
  );
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(sortTypes(await listPaymentTypes()));
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

  function openEdit(row: PracticePaymentType) {
    setDraft(toDraft(row));
    setEditor({ mode: 'edit', row });
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      onMessage?.('Name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...draft, name, isDefault: draft.isActive ? draft.isDefault : false };
      if (editor?.mode === 'edit') {
        const next = await patchPaymentType(editor.row.id, payload);
        setRows((cur) =>
          sortTypes(
            cur.map((r) => (r.id === next.id ? next : next.isDefault ? { ...r, isDefault: false } : r)),
          ),
        );
        onMessage?.('Payment option saved.', 'success');
      } else {
        await createPaymentType(payload);
        await load();
        onMessage?.('Payment option added.', 'success');
      }
      setEditor(null);
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(row: PracticePaymentType, isActive: boolean) {
    setSaving(true);
    try {
      const next = await patchPaymentType(row.id, {
        isActive,
        ...(isActive ? {} : { isDefault: false }),
      });
      setRows((cur) =>
        sortTypes(cur.map((r) => (r.id === next.id ? next : r))),
      );
      onMessage?.(isActive ? 'Payment option reactivated.' : 'Payment option inactivated.', 'success');
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
          <h3 className="settings-card-title">Payment types</h3>
          <p className="settings-muted">
            Same options as eVet. Inactivate a type to hide it from take-payment without
            deleting history. When staff pick an active type, Scout copies these settings
            onto that payment: discount percent (0% means they type the dollars), and
            whether it is left off income on the sales report.
          </p>
        </div>
        <button type="button" className="btn" onClick={openNew}>
          Add a payment option
        </button>
      </div>
      {loading ? (
        <p className="settings-muted">Loading payment types…</p>
      ) : error ? (
        <p className="settings-muted">{error}</p>
      ) : (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Default</th>
              <th>Discount</th>
              <th>%</th>
              <th>Exclude from income</th>
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
                <td>{PAYMENT_OPTION_TYPE_LABELS[row.optionType]}</td>
                <td>{row.isDefault ? 'Yes' : '—'}</td>
                <td>{row.isDiscountCategory ? 'Yes' : '—'}</td>
                <td>{row.isDiscountCategory ? `${Number(row.discountPercent) || 0}%` : '—'}</td>
                <td>{row.excludeFromIncome ? 'Yes' : '—'}</td>
                <td>{inactive ? 'Inactive' : 'Active'}</td>
                <td>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => openEdit(row)}
                    title="Edit payment option"
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  {' · '}
                  <button
                    type="button"
                    className="btn-link"
                    disabled={saving}
                    onClick={() => void setActive(row, inactive)}
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
              aria-labelledby="pay-opt-title"
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
                  <h3 id="pay-opt-title" style={{ margin: 0, fontSize: 18 }}>
                    {editor.mode === 'edit' ? 'Edit payment option' : 'Add a payment option'}
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
                  Type *
                  <select
                    className="settings-select"
                    style={{ maxWidth: 'none', marginTop: 6 }}
                    value={draft.optionType}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, optionType: e.target.value as PaymentOptionType }))
                    }
                  >
                    {PAYMENT_OPTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {PAYMENT_OPTION_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        isActive: e.target.checked,
                        isDefault: e.target.checked ? d.isDefault : false,
                      }))
                    }
                  />
                  Active
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={draft.isDefault}
                    disabled={!draft.isActive}
                    onChange={(e) => setDraft((d) => ({ ...d, isDefault: e.target.checked }))}
                  />
                  Is Default
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={draft.isDiscountCategory}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        isDiscountCategory: e.target.checked,
                        discountPercent: e.target.checked ? d.discountPercent : 0,
                      }))
                    }
                  />
                  Apply Discount when used
                </label>
                {draft.isDiscountCategory ? (
                  <label className="settings-label" style={{ marginTop: 10, marginLeft: 26 }}>
                    Percentage
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <input
                        className="settings-input"
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        style={{ maxWidth: 88 }}
                        value={draft.discountPercent}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            discountPercent: Number(e.target.value) || 0,
                          }))
                        }
                      />
                      %
                    </span>
                  </label>
                ) : null}
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={draft.excludeFromIncome}
                    onChange={(e) => setDraft((d) => ({ ...d, excludeFromIncome: e.target.checked }))}
                  />
                  Exclude from Income Calculations on Sales Report
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
                  <button type="button" className="btn secondary" disabled={saving} onClick={() => setEditor(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn" disabled={saving || !draft.name.trim()} onClick={() => void save()}>
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
