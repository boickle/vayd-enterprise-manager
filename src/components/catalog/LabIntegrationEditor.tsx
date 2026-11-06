import { useEffect, useState } from 'react';
import { patchCatalogItem } from '../../api/catalogItems';
import type { Lab } from '../../api/quantityPriceBreaks';

export const LAB_INTEGRATION_COMPANY_LABELS: Record<string, string> = {
  idexx: 'IDEXX',
  antech: 'Antech',
  abaxis: 'Abaxis (Zoetis)',
  heska: 'Heska',
  scil: 'scil',
  diasys: 'DiaSys',
  national_biovet: 'National BioVet',
  zn_labs: 'ZN Labs',
  fuse: 'Fuse',
};

const ORDER_TYPE_LABELS: Record<string, string> = {
  IDEXX: 'in-house',
  IDEXXREF: 'reference lab',
  IDEXXVetConnectPlus: 'VetConnect PLUS',
  IDEXXInterlink: 'Interlink',
  AbaxisRef: 'reference lab',
};

type Props = {
  practiceId: number;
  lab: Lab;
  onSaved: () => void | Promise<void>;
};

export default function LabIntegrationEditor({ practiceId, lab, onSaved }: Props) {
  const [integrated, setIntegrated] = useState(false);
  const [company, setCompany] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setIntegrated(lab.isIntegratedLabItem === true);
    setCompany(lab.integrationCompany ?? '');
    setOrderCode(lab.integrationOrderCode ?? '');
    setError(null);
    setSaved(false);
  }, [lab.id, lab.isIntegratedLabItem, lab.integrationCompany, lab.integrationOrderCode]);

  const orderType: string | null = lab.integrationOrderType ?? null;
  const otherCodes: { company: string | null; orderType: string | null; code: string }[] = (
    Array.isArray(lab.integrationOrderCodes) ? lab.integrationOrderCodes : []
  ).filter((c: { code: string }) => c.code !== lab.integrationOrderCode);

  async function save() {
    if (integrated && !company) {
      setError('Choose the lab company.');
      return;
    }
    if (integrated && !orderCode.trim()) {
      setError('Enter the code sent to the lab company.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchCatalogItem('lab', practiceId, lab.id, {
        isIntegratedLabItem: integrated,
        integrationCompany: integrated ? company : null,
        integrationOrderCode: integrated ? orderCode.trim() : null,
      });
      setSaved(true);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-card" style={{ marginTop: 20 }}>
      <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Lab integration</h4>
      <p className="settings-muted" style={{ marginBottom: 12, fontSize: 13 }}>
        For tests ordered electronically: which company receives the order and the code we send
        them. eVet&apos;s FIL8659999, for example, goes to IDEXX as 8659999.
      </p>
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      <label className="settings-checkbox-item">
        <input
          type="checkbox"
          checked={integrated}
          onChange={(e) => {
            setIntegrated(e.target.checked);
            setSaved(false);
          }}
        />
        <span>Integrated lab item</span>
      </label>
      {integrated && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            marginTop: 12,
            maxWidth: 520,
          }}
        >
          <label className="settings-label">
            Company
            <select
              className="settings-input"
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setSaved(false);
              }}
            >
              <option value="">Choose…</option>
              {Object.entries(LAB_INTEGRATION_COMPANY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {orderType && company === lab.integrationCompany && (
              <small className="settings-muted" style={{ display: 'block', fontWeight: 400, marginTop: 4 }}>
                eVet: {ORDER_TYPE_LABELS[orderType] ?? orderType}
              </small>
            )}
          </label>
          <label className="settings-label">
            Code sent to the company
            <input
              className="settings-input"
              value={orderCode}
              placeholder="e.g. 8659999"
              onChange={(e) => {
                setOrderCode(e.target.value);
                setSaved(false);
              }}
            />
          </label>
        </div>
      )}
      {integrated && otherCodes.length > 0 && (
        <p className="settings-muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
          Other codes from eVet:{' '}
          {otherCodes
            .map(
              (c) =>
                `${c.code} (${
                  (c.company && LAB_INTEGRATION_COMPANY_LABELS[c.company]) || c.orderType || 'unknown'
                })`
            )
            .join(', ')}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save lab integration'}
        </button>
        {saved && <span className="settings-muted">Saved</span>}
      </div>
    </div>
  );
}
