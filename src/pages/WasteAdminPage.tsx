import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  getWasteAdmin,
  patchWasteConfig,
  upsertDisposalMethod,
  upsertWasteReason,
  type DisposalMethod,
  type WasteConfig,
  type WasteReason,
} from '../api/inventoryOps';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

export default function WasteAdminPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [config, setConfig] = useState<WasteConfig | null>(null);
  const [reasons, setReasons] = useState<WasteReason[]>([]);
  const [methods, setMethods] = useState<DisposalMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [newReasonLabel, setNewReasonLabel] = useState('');
  const [newMethodLabel, setNewMethodLabel] = useState('');

  async function reload() {
    const admin = await getWasteAdmin(practiceId);
    setConfig(admin.config);
    setReasons(admin.reasons);
    setMethods(admin.methods);
  }

  useEffect(() => {
    void reload().catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to load')
    );
  }, [practiceId]);

  async function saveConfig() {
    if (!config) return;
    setBusy(true);
    try {
      const saved = await patchWasteConfig(practiceId, {
        alertSingleWasteUsd: Number(config.alertSingleWasteUsd),
        alertMonthlyWasteUsd: Number(config.alertMonthlyWasteUsd),
        alertFrequentLosses: config.alertFrequentLosses,
        managerNotification: config.managerNotification,
        requireDisposalForPrescription: config.requireDisposalForPrescription,
        requireDisposalForVaccine: config.requireDisposalForVaccine,
        requireDisposalForRefrigerated: config.requireDisposalForRefrigerated,
        requireNotesForReasons: config.requireNotesForReasons,
      });
      setConfig(saved as WasteConfig);
      setToast('Saved');
      window.setTimeout(() => setToast(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function addReason() {
    if (!newReasonLabel.trim()) return;
    const code = newReasonLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    await upsertWasteReason(practiceId, {
      code,
      label: newReasonLabel.trim(),
      requiresDisposalMethod: 'optional',
    });
    setNewReasonLabel('');
    await reload();
  }

  async function addMethod() {
    if (!newMethodLabel.trim()) return;
    const code = newMethodLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    await upsertDisposalMethod(practiceId, {
      code,
      label: newMethodLabel.trim(),
    });
    setNewMethodLabel('');
    await reload();
  }

  if (!config) {
    return <div className="settings-card" style={{ padding: 16 }}>Loading…</div>;
  }

  return (
    <div className="settings-card" style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Waste + Disposal (Admin)</h2>
      {toast && <div className="settings-message">{toast}</div>}
      {error && (
        <div className="settings-message settings-error-message">{error}</div>
      )}

      <h3>Waste / adjustment reasons</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {reasons.map((r) => (
          <li key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid #eee' }}>
            <strong>{r.label}</strong>
            <span className="settings-muted"> — disposal: {r.requiresDisposalMethod}</span>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          className="settings-input"
          placeholder="New reason label"
          value={newReasonLabel}
          onChange={(e) => setNewReasonLabel(e.target.value)}
        />
        <button type="button" className="btn" onClick={() => void addReason()}>
          + Add reason
        </button>
      </div>

      <h3>Disposal methods</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {methods.map((m) => (
          <li key={m.id} style={{ padding: '6px 0', borderBottom: '1px solid #eee' }}>
            {m.label}
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          className="settings-input"
          placeholder="New method label"
          value={newMethodLabel}
          onChange={(e) => setNewMethodLabel(e.target.value)}
        />
        <button type="button" className="btn" onClick={() => void addMethod()}>
          + Add disposal method
        </button>
      </div>

      <h3>Require disposal method for</h3>
      <label className="settings-checkbox-item">
        <input
          type="checkbox"
          checked={config.requireDisposalForPrescription}
          onChange={(e) =>
            setConfig({ ...config, requireDisposalForPrescription: e.target.checked })
          }
        />
        <span>Prescription medications</span>
      </label>
      <label className="settings-checkbox-item">
        <input
          type="checkbox"
          checked={config.requireDisposalForVaccine}
          onChange={(e) =>
            setConfig({ ...config, requireDisposalForVaccine: e.target.checked })
          }
        />
        <span>Vaccines</span>
      </label>
      <label className="settings-checkbox-item">
        <input
          type="checkbox"
          checked={config.requireDisposalForRefrigerated}
          onChange={(e) =>
            setConfig({ ...config, requireDisposalForRefrigerated: e.target.checked })
          }
        />
        <span>Refrigerated items</span>
      </label>

      <h3>High variance / waste alerts</h3>
      <label className="settings-label">
        Alert if single waste &gt; $
        <input
          className="settings-input"
          type="number"
          value={String(config.alertSingleWasteUsd)}
          onChange={(e) =>
            setConfig({ ...config, alertSingleWasteUsd: e.target.value as any })
          }
        />
      </label>
      <label className="settings-label">
        Monthly waste &gt; $
        <input
          className="settings-input"
          type="number"
          value={String(config.alertMonthlyWasteUsd)}
          onChange={(e) =>
            setConfig({ ...config, alertMonthlyWasteUsd: e.target.value as any })
          }
        />
      </label>
      <label className="settings-checkbox-item">
        <input
          type="checkbox"
          checked={config.managerNotification}
          onChange={(e) =>
            setConfig({ ...config, managerNotification: e.target.checked })
          }
        />
        <span>Manager notification</span>
      </label>
      <label className="settings-label">
        Require notes for reasons (comma-separated codes)
        <input
          className="settings-input"
          value={config.requireNotesForReasons ?? ''}
          onChange={(e) =>
            setConfig({ ...config, requireNotesForReasons: e.target.value })
          }
        />
      </label>

      <button
        type="button"
        className="btn primary"
        disabled={busy}
        onClick={() => void saveConfig()}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
