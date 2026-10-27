import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import {
  getIdexxOrderPreview,
  idexxErrorMessage,
  idexxGenders,
  idexxSpecies,
  sendIdexxFromInvoice,
  type IdexxInvoiceLine,
  type IdexxOrder,
  type IdexxPatientOverrides,
  type IdexxSyncResult,
} from '../../api/idexx';
import IdexxOrderFrame from './IdexxOrderFrame';
import { fetchVeterinarians } from '../../api/employee';
import '../../pages/Settings.css';
import './Idexx.css';

type Props = {
  invoiceId: string;
  patientId: number;
  patientName: string;
  lines: IdexxInvoiceLine[];
  defaultVeterinarianId?: number | null;
  onClose: () => void;
  /** Called once IDEXX's order page is closed. */
  onSent: (order: IdexxOrder) => void;
  onSync?: (orderId: number) => Promise<IdexxSyncResult>;
};

function todayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MISSING_LABELS: Record<string, string> = {
  birthdate: 'birthdate',
  speciesCode: 'species',
  client: 'owner on file',
};

/**
 * Sends a pet's IDEXX tests on this bill as one requisition. IDEXX's order page then
 * opens framed in Scout for the specimen questions, Order, and the requisition print;
 * IDEXX has no way to submit from outside, so that step always happens there.
 */
export default function IdexxSendModal({
  invoiceId,
  patientId,
  patientName,
  lines,
  defaultVeterinarianId,
  onClose,
  onSent,
  onSync,
}: Props) {
  const [sent, setSent] = useState<IdexxOrder | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(lines.map((l) => l.lineId)));
  const [vets, setVets] = useState<Array<{ id: number; name: string }>>([]);
  const [vetId, setVetId] = useState<number | ''>(defaultVeterinarianId ?? '');
  const [collected, setCollected] = useState(todayYmd());
  const [notes, setNotes] = useState('');
  const [missing, setMissing] = useState<string[] | null>(null);
  const [genderUnknown, setGenderUnknown] = useState(false);
  const [genders, setGenders] = useState<Array<{ code: string; name: string }>>([]);
  const [species, setSpecies] = useState<Array<{ code: string; name: string }>>([]);
  const [overrides, setOverrides] = useState<IdexxPatientOverrides>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchVeterinarians()
      .then((res) =>
        setVets(
          (res.providers ?? [])
            .map((p: { id: unknown; name: string }) => ({ id: Number(p.id), name: p.name }))
            .filter((p: { id: number }) => Number.isFinite(p.id))
        )
      )
      .catch(() => setVets([]));
    void getIdexxOrderPreview(patientId)
      .then((p) => {
        setMissing(p.missing ?? []);
        setGenderUnknown(
          !p.missing?.length && (!p.patient?.genderCode || p.patient.genderCode === 'UNKNOWN')
        );
      })
      .catch(() => setMissing([]));
    void idexxGenders()
      .then(setGenders)
      .catch(() => setGenders([]));
    void idexxSpecies()
      .then(setSpecies)
      .catch(() => setSpecies([]));
  }, [patientId]);

  const needs = (field: string) => missing?.includes(field) ?? false;

  async function send() {
    if (!selected.size) {
      setError('Pick at least one test.');
      return;
    }
    if (needs('birthdate') && !overrides.birthdate) {
      setError('IDEXX needs a birthdate. An estimate is fine.');
      return;
    }
    if (needs('speciesCode') && !overrides.speciesCode) {
      setError('Pick the species.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = await sendIdexxFromInvoice(invoiceId, {
        patientId,
        lineIds: [...selected],
        veterinarianEmployeeId: vetId === '' ? undefined : vetId,
        notes: notes.trim() || undefined,
        specimenCollectionDate: collected || undefined,
        patientOverrides: Object.keys(overrides).length ? overrides : undefined,
      });
      if (order.uiUrl) setSent(order);
      else onSent(order);
    } catch (e) {
      setError(idexxErrorMessage(e, 'IDEXX did not take the order.'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <IdexxOrderFrame
        order={sent}
        patientName={patientName}
        fresh
        onSync={onSync}
        onClose={() => onSent(sent)}
      />
    );
  }

  return (
    <div
      className="settings-modal-overlay"
      onClick={busy ? undefined : onClose}
      role="presentation"
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="idexx-send-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, width: '100%' }}
      >
        <div className="settings-modal-header">
          <h3 id="idexx-send-title">Send to IDEXX · {patientName}</h3>
          <button
            type="button"
            className="settings-modal-close"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="settings-modal-body">
          <div className="idexx-send__tests">
            {lines.map((l) => (
              <label key={l.lineId} className="idexx-send__test">
                <input
                  type="checkbox"
                  checked={selected.has(l.lineId)}
                  disabled={busy}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(l.lineId);
                      else next.delete(l.lineId);
                      return next;
                    })
                  }
                />
                <span>{l.labName}</span>
                {l.testCode ? <span className="idexx-send__code">#{l.testCode}</span> : null}
              </label>
            ))}
          </div>

          {missing?.length ? (
            <div className="idexx-send__missing">
              <strong>
                IDEXX needs the {missing.map((m) => MISSING_LABELS[m] ?? m).join(' and ')}.
              </strong>
              <div className="idexx-send__grid">
                {needs('birthdate') ? (
                  <label className="settings-label">
                    Birthdate (estimate is fine)
                    <input
                      type="date"
                      className="settings-input"
                      value={overrides.birthdate ?? ''}
                      onChange={(e) =>
                        setOverrides((o) => ({ ...o, birthdate: e.target.value || undefined }))
                      }
                    />
                  </label>
                ) : null}
                {needs('speciesCode') ? (
                  <label className="settings-label">
                    Species
                    <select
                      className="settings-input"
                      value={overrides.speciesCode ?? ''}
                      onChange={(e) =>
                        setOverrides((o) => ({ ...o, speciesCode: e.target.value || undefined }))
                      }
                    >
                      <option value="">Pick…</option>
                      {species.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {needs('client') ? (
                <span className="idexx-order__note">
                  Add an owner to {patientName}&rsquo;s record before sending.
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="idexx-send__grid">
            <label className="settings-label">
              Veterinarian
              <select
                className="settings-input"
                value={vetId}
                onChange={(e) => setVetId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Me</option>
                {vets.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-label">
              Collected
              <input
                type="date"
                className="settings-input"
                value={collected}
                onChange={(e) => setCollected(e.target.value)}
              />
            </label>
          </div>
          {genderUnknown ? (
            <label className="settings-label">
              Sex (not on the chart, IDEXX will get &ldquo;unknown&rdquo;)
              <select
                className="settings-input"
                value={overrides.genderCode ?? ''}
                onChange={(e) =>
                  setOverrides((o) => ({ ...o, genderCode: e.target.value || undefined }))
                }
              >
                <option value="">Unknown</option>
                {genders
                  .filter((g) => g.code !== 'UNKNOWN')
                  .map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <label className="settings-label">
            Clinical history / notes for the lab
            <textarea
              className="settings-input"
              rows={3}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Fasted 12h, on phenobarbital, recheck of elevated ALT"
            />
          </label>

          {error ? (
            <p className="idexx-order__error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="idexx-send__how">
            IDEXX&rsquo;s order page opens right here. Answer the specimen questions, click{' '}
            <strong>Order</strong>, and print the requisition for the sample. Tests you add there go
            on this bill.
          </p>
          <div className="settings-modal-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || missing == null || needs('client')}
              onClick={() => void send()}
            >
              <Send size={14} aria-hidden />{' '}
              {busy
                ? 'Sending…'
                : `Send ${selected.size} test${selected.size === 1 ? '' : 's'} to IDEXX`}
            </button>
            <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
