import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import { updatePatientPrescription, type PatientPrescription } from '../../api/visitWorkflow';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import { useCan } from '../../permissions/PermissionContext';
import RxRefillControls from './RxRefillControls';
import './ChronicMedRefillsModal.css';

/** Refills shown beside a chronic med on the SOAP and the top of the EMR, e.g. "3 refills left". */
export function chronicRefillLabel(
  rx: Pick<PatientPrescription, 'refill' | 'refillExpiration' | 'prn'>,
  now = Date.now(),
): string {
  // Owner (Nov 11, 2026): an item that needs no prescription has no refills to count.
  if (rx.prn) return 'PRN';
  const left = Math.max(0, Number(rx.refill) || 0);
  if (left > 0 && rx.refillExpiration && new Date(rx.refillExpiration).getTime() < now) return 'Refills expired';
  if (left === 0) return 'No refills';
  return `${left} refill${left === 1 ? '' : 's'} left`;
}

function formatDay(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

/**
 * Owner (Nov 10, 2026): from a chronic med on the SOAP or the top of the EMR, see and change its refills
 * (more refills: a licensed vet only, as in the Prescriptions table) and link a free-text med to a catalog
 * item so the client can reorder it in the portal.
 */
export default function ChronicMedRefillsModal({
  rx,
  practiceId,
  patientId,
  onClose,
  onChanged,
}: {
  rx: PatientPrescription;
  practiceId: number;
  patientId: number;
  onClose: () => void;
  onChanged: (patch: Partial<PatientPrescription>) => void;
}) {
  const canLink = useCan('rx.sig.draft');
  const [linkedId, setLinkedId] = useState<number | null>(rx.inventoryItemId ?? null);
  const [refill, setRefill] = useState<number | null>(rx.refill ?? null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let canceled = false;
    setSearching(true);
    const handle = window.setTimeout(() => {
      searchItems({ q: text, practiceId, limit: 8, patientId })
        .then((rows) => {
          if (!canceled) setResults(rows.filter((r) => r.itemType === 'inventory'));
        })
        .catch(() => {
          if (!canceled) setResults([]);
        })
        .finally(() => {
          if (!canceled) setSearching(false);
        });
    }, 250);
    return () => {
      canceled = true;
      window.clearTimeout(handle);
    };
  }, [q, practiceId, patientId]);

  const link = async (item: SearchableItem) => {
    const id = Number(item.inventoryItem?.id);
    if (!Number.isFinite(id)) return;
    setBusy(true);
    setMessage(null);
    try {
      await updatePatientPrescription(rx.id, { inventoryItemId: id, patientId });
      setLinkedId(id);
      setQ('');
      setResults([]);
      onChanged({ inventoryItemId: id });
      setMessage(`Linked to ${item.name}. The client can reorder it in the portal.`);
    } catch (e) {
      setMessage(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const current = { refill, refillExpiration: rx.refillExpiration, prn: rx.prn };
  return (
    <div
      className="chronic-rx-modal__overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chronic-rx-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="chronic-rx-modal">
        <div className="chronic-rx-modal__head">
          <h3 id="chronic-rx-modal-title">{rx.name}</h3>
          <button type="button" className="chronic-rx-modal__close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="chronic-rx-modal__body">
          {rx.prn ? (
            <section>
              <h4>Refills</h4>
              <p className="chronic-rx-modal__status" data-testid="chronic-rx-refills">
                PRN: this item needs no prescription, so there are no refills. The family can reorder it any time.
              </p>
            </section>
          ) : (
          <section>
            <h4>Refills</h4>
            <p className="chronic-rx-modal__status" data-testid="chronic-rx-refills">
              {chronicRefillLabel(current)}
              {rx.refillExpiration ? ` · refills expire ${formatDay(rx.refillExpiration)}` : ''}
            </p>
            <RxRefillControls
              prescriptionId={rx.id}
              patientId={patientId}
              refill={refill}
              onChanged={(left) => {
                setRefill(left);
                onChanged({ refill: left });
              }}
            />
          </section>
          )}
          <section>
            <h4>Online reorder</h4>
            {linkedId != null ? (
              <p className="chronic-rx-modal__status" data-testid="chronic-rx-linked">
                Linked to the catalog. The client can reorder it from the Medications card in the portal.
              </p>
            ) : (
              <>
                <p className="chronic-rx-modal__status" data-testid="chronic-rx-unlinked">
                  Not linked to a catalog item, so the client can&apos;t reorder it online.
                </p>
                {canLink ? (
                  <div className="chronic-rx-modal__search">
                    <input
                      className="soap-input"
                      placeholder="Search inventory to link…"
                      value={q}
                      disabled={busy}
                      onChange={(e) => setQ(e.target.value)}
                    />
                    {searching ? <div className="chronic-rx-modal__muted">Searching inventory…</div> : null}
                    {!searching && q.trim().length >= 2 && results.length === 0 ? (
                      <div className="chronic-rx-modal__muted">No inventory matches.</div>
                    ) : null}
                    {results.map((item, idx) => (
                      <button
                        type="button"
                        key={`inv-${item.inventoryItem?.id ?? idx}`}
                        className="chronic-rx-modal__result"
                        disabled={busy}
                        onClick={() => void link(item)}
                      >
                        <span>{item.name}</span>
                        <span className="chronic-rx-modal__link">Link</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="chronic-rx-modal__muted">Ask a doctor or technician to link it.</p>
                )}
              </>
            )}
            {message ? <p className="chronic-rx-modal__note">{message}</p> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
