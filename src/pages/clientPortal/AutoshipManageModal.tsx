import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { listMyAutoship, patchMyAutoship, type StoreAutoship } from '../../api/onlineStore';
import type { PatientPrescription } from '../../api/visitWorkflow';
import { AUTOSHIP_FREQS, autoshipCadencePhrase, formatAutoshipFrequency } from '../store/storeCartState';
import { Icon, PortalModal } from './PortalPrimitives';
import { fmtDayLong, type PetWithWellness } from './portalShared';

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtIsoDay(iso: string | null | undefined): string {
  if (!iso) return '';
  // Dates are plain YYYY-MM-DD; pin to noon so the weekday doesn't drift.
  return fmtDayLong(`${iso.slice(0, 10)}T12:00:00`);
}

function errorText(e: unknown, fallback: string): string {
  const msg =
    (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ??
    (e as { message?: string })?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

/**
 * Lets an owner run their own auto-ship for one medication: cadence, next
 * shipment date, quantity, pause / resume, cancel, and a one-off order.
 * Every change hits the store subscription so Stripe billing and the mail
 * queue follow along.
 */
export default function AutoshipManageModal({
  pet,
  rx,
  practiceId,
  onClose,
  onOrderNow,
  onChanged,
  onToast,
}: {
  pet: PetWithWellness;
  rx: PatientPrescription;
  practiceId: number;
  onClose: () => void;
  onOrderNow: () => void;
  /** Called after any successful change (so the parent can refresh meds). */
  onChanged?: (sub: StoreAutoship | null) => void;
  onToast?: (text: string) => void;
}) {
  const [subs, setSubs] = useState<StoreAutoship[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nextDate, setNextDate] = useState('');
  const [pauseUntil, setPauseUntil] = useState('');
  const [showPause, setShowPause] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const petDbId = pet.dbId && Number.isFinite(Number(pet.dbId)) ? Number(pet.dbId) : null;

  const sub = useMemo(() => {
    if (!subs || rx.inventoryItemId == null) return null;
    const forItem = subs.filter((s) => s.active && Number(s.inventoryItemId) === Number(rx.inventoryItemId));
    const found =
      forItem.find((s) => petDbId != null && Number(s.patientId) === petDbId) ??
      (forItem.length === 1 ? forItem[0] : null);
    if (!found) return null;
    // Postgres decimals arrive as strings ("2.00"); normalize once here.
    return {
      ...found,
      quantity: Math.max(1, Math.round(Number(found.quantity) || 1)),
      unitPrice: Number(found.unitPrice) || 0,
    };
  }, [subs, rx.inventoryItemId, petDbId]);

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    listMyAutoship(practiceId)
      .then((rows) => {
        if (alive) setSubs(rows);
      })
      .catch((e) => {
        if (alive) {
          setSubs([]);
          setLoadError(errorText(e, "We couldn't load your auto-ship right now."));
        }
      });
    return () => {
      alive = false;
    };
  }, [practiceId]);

  useEffect(() => {
    if (sub) setNextDate(sub.renewalDate?.slice(0, 10) || '');
  }, [sub]);

  async function apply(label: string, body: Parameters<typeof patchMyAutoship>[2], toast: string) {
    if (!sub) return;
    setBusy(label);
    setError(null);
    try {
      const updated = await patchMyAutoship(practiceId, sub.id, body);
      setSubs((prev) =>
        prev
          ? body.cancel
            ? prev.filter((s) => s.id !== sub.id)
            : prev.map((s) => (s.id === sub.id ? { ...s, ...updated } : s))
          : prev
      );
      onChanged?.(body.cancel ? null : { ...sub, ...updated });
      onToast?.(toast);
      if (body.cancel) onClose();
    } catch (e) {
      setError(errorText(e, "That didn't save — please try again."));
    } finally {
      setBusy(null);
    }
  }

  const minNext = isoPlusDays(2);
  const minPause = isoPlusDays(1);
  const freqOptions = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [...AUTOSHIP_FREQS];
    if (sub?.frequency && !list.some((f) => f.value === sub.frequency)) {
      list.push({ value: sub.frequency, label: formatAutoshipFrequency(sub.frequency) || sub.frequency });
    }
    return list;
  }, [sub?.frequency]);

  const title = (
    <>
      Auto-ship
      <span className="pp-modal-title-sub">{rx.name}</span>
    </>
  );

  if (subs === null) {
    return (
      <PortalModal title={title} onClose={onClose}>
        <div className="pp-skeleton" style={{ height: 160 }} />
      </PortalModal>
    );
  }

  if (!sub) {
    return (
      <PortalModal
        title={title}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="pp-btn pp-btn--ghost" onClick={onClose}>
              Close
            </button>
            <button type="button" className="pp-btn pp-btn--primary" onClick={onOrderNow}>
              <Icon name="cart" /> Order now
            </button>
          </>
        }
      >
        {loadError ? <div className="pp-error">{loadError}</div> : null}
        <p style={{ margin: 0 }}>
          We don&apos;t see an active auto-ship for {pet.name}&apos;s {rx.name} under your login. You can order it now, or
          set up auto-ship at checkout and it will show up here.
        </p>
        <p className="pp-muted pp-small" style={{ margin: 0 }}>
          Think this is a mistake? <Link to="/store/autoship">See all your auto-ship items</Link> or give us a call.
        </p>
      </PortalModal>
    );
  }

  const nextLabel = sub.paused
    ? sub.pausedUntil
      ? `Paused · resumes ${fmtIsoDay(sub.pausedUntil)}`
      : 'Paused'
    : `Next shipment ${fmtIsoDay(sub.renewalDate)}`;

  return (
    <PortalModal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pp-btn pp-btn--ghost" onClick={onClose}>
            Done
          </button>
          <button type="button" className="pp-btn pp-btn--primary" onClick={onOrderNow}>
            <Icon name="cart" /> Order an extra now
          </button>
        </>
      }
    >
      {error ? <div className="pp-error">{error}</div> : null}

      <div className={`pp-autoship-summary${sub.paused ? ' pp-autoship-summary--paused' : ''}`}>
        <div className="pp-autoship-summary-icon" aria-hidden>
          {sub.paused ? '⏸️' : '🚚'}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="pp-autoship-summary-k">{nextLabel}</div>
          <div className="pp-muted pp-small">
            {sub.quantity} × {sub.itemName || rx.name} · {autoshipCadencePhrase(sub.frequency) || formatAutoshipFrequency(sub.frequency)}
            {sub.unitPrice ? ` · $${Number(sub.unitPrice).toFixed(2)} each` : ''}
          </div>
        </div>
      </div>

      <div className="pp-autoship-grid">
        <label className="pp-field">
          How often
          <select
            className="pp-input"
            value={sub.frequency}
            disabled={busy != null}
            onChange={(e) => void apply('frequency', { frequency: e.target.value }, `Now shipping ${autoshipCadencePhrase(e.target.value)}.`)}
          >
            {freqOptions.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <label className="pp-field">
          Quantity per shipment
          <div className="pp-qty">
            <button
              type="button"
              aria-label="Fewer"
              disabled={busy != null || sub.quantity <= 1}
              onClick={() => void apply('qty', { quantity: sub.quantity - 1 }, 'Quantity updated.')}
            >
              −
            </button>
            <span>{sub.quantity}</span>
            <button
              type="button"
              aria-label="More"
              disabled={busy != null}
              onClick={() => void apply('qty', { quantity: sub.quantity + 1 }, 'Quantity updated.')}
            >
              +
            </button>
          </div>
        </label>

        <div className="pp-field pp-autoship-grid-full">
          Next shipment
          <div className="pp-autoship-date">
            <input
              type="date"
              className="pp-input"
              value={nextDate}
              min={minNext}
              disabled={busy != null || sub.paused}
              onChange={(e) => setNextDate(e.target.value)}
            />
            <button
              type="button"
              className="pp-btn pp-btn--soft pp-btn--sm"
              disabled={busy != null || sub.paused || !nextDate || nextDate === sub.renewalDate?.slice(0, 10) || nextDate < minNext}
              onClick={() => void apply('date', { renewalDate: nextDate }, `Next shipment moved to ${fmtIsoDay(nextDate)}.`)}
            >
              {busy === 'date' ? 'Saving…' : 'Move date'}
            </button>
          </div>
          <span className="pp-muted pp-small" style={{ fontWeight: 400 }}>
            {sub.paused
              ? 'Resume auto-ship to change the next date.'
              : 'We bill and pack on this day, so it needs to be at least two days out.'}
          </span>
        </div>
      </div>

      <div className="pp-autoship-actions">
        {sub.paused ? (
          <button
            type="button"
            className="pp-btn pp-btn--green pp-btn--sm"
            disabled={busy != null}
            onClick={() => void apply('resume', { paused: false }, 'Auto-ship resumed.')}
          >
            <Icon name="refresh" size={14} /> Resume auto-ship
          </button>
        ) : showPause ? (
          <div className="pp-autoship-pause">
            <label className="pp-field" style={{ flex: 1 }}>
              Pause until
              <input
                type="date"
                className="pp-input"
                value={pauseUntil}
                min={minPause}
                onChange={(e) => setPauseUntil(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="pp-btn pp-btn--primary pp-btn--sm"
              disabled={busy != null || !pauseUntil || pauseUntil < minPause}
              onClick={() =>
                void apply('pause', { paused: true, pausedUntil: pauseUntil }, `Paused until ${fmtIsoDay(pauseUntil)}.`).then(() =>
                  setShowPause(false)
                )
              }
            >
              {busy === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
            <button type="button" className="pp-btn pp-btn--ghost pp-btn--sm" onClick={() => setShowPause(false)}>
              Never mind
            </button>
          </div>
        ) : (
          <button type="button" className="pp-btn pp-btn--ghost pp-btn--sm" disabled={busy != null} onClick={() => setShowPause(true)}>
            Pause for a while
          </button>
        )}

        {confirmCancel ? (
          <div className="pp-autoship-cancel">
            <span>Cancel auto-ship for {rx.name}? You can always set it up again at checkout.</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pp-btn pp-btn--coral pp-btn--sm"
                disabled={busy != null}
                onClick={() => void apply('cancel', { cancel: true }, `Auto-ship for ${rx.name} cancelled.`)}
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel it'}
              </button>
              <button type="button" className="pp-btn pp-btn--ghost pp-btn--sm" onClick={() => setConfirmCancel(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="pp-link-btn pp-link-btn--danger" disabled={busy != null} onClick={() => setConfirmCancel(true)}>
            Cancel auto-ship
          </button>
        )}
      </div>
    </PortalModal>
  );
}
