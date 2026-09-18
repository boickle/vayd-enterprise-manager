import { useEffect, useState } from 'react';
import { listCatalogShippingTypes, type CatalogShippingType } from '../../api/catalogItems';
import { listPracticeBranches, type PracticeBranch } from '../../api/branchInventory';
import {
  getPracticeSettings,
  isOnlineStoreImplemented,
  updatePracticeSettings,
} from '../../api/practiceSettings';
import {
  blankMailShippingType,
  MAIL_SHIPPING_TYPES_KEY,
  parseMailShippingTypes,
  serializeMailShippingTypes,
  type MailShippingType,
} from '../../utils/mailShippingTypes';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export default function SettingsMailShippingTypes({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<MailShippingType[]>([]);
  const [procedures, setProcedures] = useState<CatalogShippingType[]>([]);
  const [offices, setOffices] = useState<PracticeBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [onlineStoreEnabled, setOnlineStoreEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      getPracticeSettings(PRACTICE_ID),
      listCatalogShippingTypes(PRACTICE_ID).catch(() => [] as CatalogShippingType[]),
      listPracticeBranches(PRACTICE_ID).catch(() => [] as PracticeBranch[]),
    ])
      .then(([settings, procs, branches]) => {
        if (cancelled) return;
        setRows(parseMailShippingTypes(settings[MAIL_SHIPPING_TYPES_KEY]));
        setOnlineStoreEnabled(isOnlineStoreImplemented(settings));
        setProcedures(procs);
        setOffices(branches);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load shipping types.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (index: number, next: Partial<MailShippingType>) => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) {
          return next.autoshipOnly
            ? { ...row, autoshipOnly: false, autoship: false }
            : row;
        }
        const merged = { ...row, ...next };
        if (merged.autoshipOnly) {
          merged.autoshipAllowed = true;
          merged.autoship = true;
        } else if (next.autoshipAllowed === false) {
          merged.autoshipOnly = false;
          merged.autoship = false;
        } else {
          merged.autoship = false;
        }
        return merged;
      })
    );
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updatePracticeSettings(PRACTICE_ID, {
        [MAIL_SHIPPING_TYPES_KEY]: serializeMailShippingTypes(rows),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={embedded ? undefined : 'settings-card'} style={embedded ? undefined : { marginBottom: 24 }}>
      <h3 className="settings-card-title">Mail order shipping / pick-up types</h3>
      <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
        This is the one shipping list for the mail queue and, when enabled, the
        online store. Staff see every type when sending to the mail queue. Assign a
        catalog procedure so a fee can post on the invoice. For pick-up, choose the
        office or a specific address.
      </p>
      {loading ? (
        <p className="settings-muted">Loading…</p>
      ) : (
        <>
          {rows.map((row, index) => (
            <div
              key={row.id}
              style={{
                border: '1px solid #e7e0d4',
                borderRadius: 10,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <label>
                Name at checkout
                <input
                  className="input"
                  value={row.label}
                  onChange={(e) => patch(index, { label: e.target.value })}
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <label>
                  Kind
                  <select
                    className="input"
                    value={row.kind}
                    onChange={(e) =>
                      patch(index, {
                        kind: e.target.value === 'pickup' ? 'pickup' : 'shipping',
                        ...(e.target.value === 'shipping'
                          ? {
                              pickupBranchId: null,
                              pickupPlaceName: null,
                              pickupLine1: null,
                              pickupLine2: null,
                              pickupCity: null,
                              pickupState: null,
                              pickupPostal: null,
                            }
                          : {}),
                      })
                    }
                  >
                    <option value="pickup">Pick up</option>
                    <option value="shipping">Ship</option>
                  </select>
                </label>
                <label>
                  Charge
                  <select
                    className="input"
                    value={row.charge}
                    onChange={(e) =>
                      patch(index, {
                        charge: e.target.value as MailShippingType['charge'],
                      })
                    }
                  >
                    <option value="none">None / $0</option>
                    <option value="courtesy">Courtesy</option>
                    <option value="amount">Fixed amount</option>
                  </select>
                </label>
                <label>
                  Amount
                  <input
                    className="input"
                    inputMode="decimal"
                    disabled={row.charge !== 'amount'}
                    value={row.amount ?? ''}
                    onChange={(e) => patch(index, { amount: Number(e.target.value) || 0 })}
                  />
                </label>
              </div>
              <label>
                Catalog procedure (invoice / VSD line)
                <select
                  className="input"
                  value={row.catalogItemId ?? ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const proc = procedures.find((p) => p.id === id);
                    patch(index, {
                      catalogItemId: Number.isFinite(id) ? id : null,
                      catalogItemType: Number.isFinite(id) ? 'procedure' : null,
                      amount:
                        row.charge === 'amount' && proc?.price != null
                          ? Number(proc.price)
                          : row.amount,
                    });
                  }}
                >
                  <option value="">None</option>
                  {procedures.map((proc) => (
                    <option key={proc.id} value={proc.id}>
                      {proc.name}
                      {proc.price != null ? ` — $${Number(proc.price).toFixed(2)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {!row.catalogItemId ? (
                <p className="settings-muted" style={{ margin: '4px 0 8px', fontSize: 12 }}>
                  Assign a catalog procedure so this fee can post on the invoice.
                </p>
              ) : null}
              {row.kind === 'pickup' ? (
                <>
                  <label>
                    Pick-up office or address
                    <select
                      className="input"
                      value={
                        row.pickupBranchId
                          ? `branch:${row.pickupBranchId}`
                          : row.pickupPlaceName != null || row.pickupLine1
                            ? 'address'
                            : ''
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.startsWith('branch:')) {
                          const id = Number(value.slice(7));
                          const office = offices.find((b) => b.id === id);
                          patch(index, {
                            pickupBranchId: id,
                            pickupPlaceName: null,
                            pickupLine1: null,
                            pickupLine2: null,
                            pickupCity: null,
                            pickupState: null,
                            pickupPostal: null,
                            label: office ? `Pick up at ${office.name}` : row.label,
                          });
                          return;
                        }
                        if (value === 'address') {
                          patch(index, {
                            pickupBranchId: null,
                            pickupPlaceName: row.pickupPlaceName || '',
                          });
                          return;
                        }
                        patch(index, {
                          pickupBranchId: null,
                          pickupPlaceName: null,
                          pickupLine1: null,
                          pickupLine2: null,
                          pickupCity: null,
                          pickupState: null,
                          pickupPostal: null,
                        });
                      }}
                    >
                      <option value="">Choose…</option>
                      {offices.map((office) => (
                        <option key={office.id} value={`branch:${office.id}`}>
                          {office.name}
                        </option>
                      ))}
                      <option value="address">Specific address…</option>
                    </select>
                  </label>
                  {!row.pickupBranchId &&
                  (row.pickupPlaceName != null || row.pickupLine1) ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <label>
                        Location name
                        <input
                          className="input"
                          value={row.pickupPlaceName ?? ''}
                          onChange={(e) => patch(index, { pickupPlaceName: e.target.value })}
                        />
                      </label>
                      <label>
                        Address
                        <input
                          className="input"
                          value={row.pickupLine1 ?? ''}
                          onChange={(e) => patch(index, { pickupLine1: e.target.value })}
                        />
                      </label>
                      <label>
                        Apt / suite
                        <input
                          className="input"
                          value={row.pickupLine2 ?? ''}
                          onChange={(e) => patch(index, { pickupLine2: e.target.value })}
                        />
                      </label>
                      <label>
                        City
                        <input
                          className="input"
                          value={row.pickupCity ?? ''}
                          onChange={(e) => patch(index, { pickupCity: e.target.value })}
                        />
                      </label>
                      <label>
                        State
                        <input
                          className="input"
                          value={row.pickupState ?? ''}
                          onChange={(e) => patch(index, { pickupState: e.target.value })}
                        />
                      </label>
                      <label>
                        ZIP
                        <input
                          className="input"
                          value={row.pickupPostal ?? ''}
                          onChange={(e) => patch(index, { pickupPostal: e.target.value })}
                        />
                      </label>
                    </div>
                  ) : null}
                </>
              ) : null}
              <label>
                Client instructions (thanks-for-your-order email)
                <textarea
                  className="input"
                  rows={4}
                  value={row.clientInstructions ?? ''}
                  onChange={(e) => patch(index, { clientInstructions: e.target.value })}
                  placeholder={
                    row.kind === 'pickup'
                      ? 'How they pick up at this office — hours, door, ID, who to ask…'
                      : 'What to expect while we pack and ship…'
                  }
                />
              </label>
              <p className="settings-muted" style={{ margin: '4px 0 8px', fontSize: 12 }}>
                Sent automatically when the order is placed, and logged under Client
                communications. Brunswick and Biddeford can each have their own wording.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label>
                  Estimated business days to fill
                  <input
                    className="input"
                    inputMode="numeric"
                    value={row.estimatedDaysToFill ?? ''}
                    onChange={(e) =>
                      patch(index, {
                        estimatedDaysToFill: e.target.value === '' ? null : Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'end', paddingBottom: 8 }}>
                  {onlineStoreEnabled ? (
                    <>
                      <label className="settings-checkbox-item" style={{ margin: 0, padding: 4 }}>
                        <input
                          type="checkbox"
                          checked={row.showOnOnlineStore === true}
                          onChange={(e) => patch(index, { showOnOnlineStore: e.target.checked })}
                        />
                        Online Store Shipping Type
                      </label>
                      <label className="settings-checkbox-item" style={{ margin: 0, padding: 4 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.autoshipAllowed || row.autoshipOnly)}
                          onChange={(e) =>
                            patch(index, {
                              autoshipAllowed: e.target.checked,
                              autoshipOnly: e.target.checked ? row.autoshipOnly : false,
                              autoship: e.target.checked ? Boolean(row.autoshipOnly) : false,
                            })
                          }
                        />
                        Auto-ship Allowed
                      </label>
                      <label className="settings-checkbox-item" style={{ margin: 0, padding: 4 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.autoshipOnly)}
                          onChange={(e) =>
                            patch(index, {
                              autoshipOnly: e.target.checked,
                              autoshipAllowed: e.target.checked ? true : row.autoshipAllowed,
                              autoship: e.target.checked,
                            })
                          }
                        />
                        Auto-ship Carts ONLY
                      </label>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setRows((current) => [...current, blankMailShippingType()])}
            >
              Add shipping type
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save shipping types'}
            </button>
          </div>
          {procedures.length === 0 ? (
            <p className="settings-muted" style={{ marginTop: 10 }}>
              Optional: assign a catalog procedure on each type so a shipping fee can post
              on the invoice. Types themselves are managed here, not on the catalog item.
            </p>
          ) : null}
          {saved ? <p className="settings-muted">Saved.</p> : null}
          {error ? <p className="settings-error">{error}</p> : null}
        </>
      )}
    </div>
  );
}
