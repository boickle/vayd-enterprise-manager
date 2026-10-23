// src/components/pims/PostCloseCorrections.tsx
// Corrections allowed on an invoice after it closes: re-crediting a line to a
// different provider, and fixing how a payment was recorded. Both are
// permission-gated and need a reason, which lands on the invoice's staff audit
// and in the permission audit log.
import { useEffect, useState } from 'react';
import type { VisitTenderMethod } from '../../api/visitWorkflow';
import '../../permissions/PermissionGate.css';

type ProviderOption = { id: number; label: string };

export function LineProviderChangeDialog({
  open,
  lineDescription,
  currentProviderId,
  providers,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  lineDescription: string;
  currentProviderId: number | null;
  providers: ProviderOption[];
  busy: boolean;
  error: string | null;
  onConfirm: (providerEmployeeId: number, reason: string) => void;
  onCancel: () => void;
}) {
  const [providerId, setProviderId] = useState<number | ''>('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setProviderId('');
    setReason('');
  }, [open]);

  if (!open) return null;
  const choices = providers.filter((p) => p.id !== currentProviderId);
  const ready = providerId !== '' && reason.trim().length >= 4;

  return (
    <div
      className="perm-reason-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="perm-reason-modal" role="dialog" aria-modal="true">
        <div className="perm-reason-title">Change provider on “{lineDescription}”</div>
        <div className="perm-reason-note">
          Moves this charge’s production to the new provider. The original provider and your
          reason are kept in the invoice history.
        </div>
        <select
          className="input"
          style={{ marginTop: 12, width: '100%' }}
          value={providerId}
          onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Select provider…</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <textarea
          value={reason}
          placeholder="Reason (e.g. Dr. A saw the patient; booked under Dr. B)"
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <div className="perm-reason-error">{error}</div>}
        <div className="perm-reason-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !ready}
            onClick={() => providerId !== '' && onConfirm(providerId, reason.trim())}
          >
            {busy ? 'Saving…' : 'Change provider'}
          </button>
        </div>
      </div>
    </div>
  );
}

export type PaymentTypeChoice = { name: string; method: VisitTenderMethod };

export function PostedPaymentEditDialog({
  open,
  amountLabel,
  current,
  stripeProcessed,
  choices,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  amountLabel: string;
  current: { method: VisitTenderMethod; paymentTypeName: string | null; checkNumber: string | null };
  /** Card payments run through Stripe stay card payments; only the type label may change. */
  stripeProcessed: boolean;
  choices: PaymentTypeChoice[];
  busy: boolean;
  error: string | null;
  onConfirm: (next: {
    method: VisitTenderMethod;
    paymentTypeName: string | null;
    checkNumber: string | null;
    reason: string;
  }) => void;
  onCancel: () => void;
}) {
  const [typeName, setTypeName] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setTypeName(current.paymentTypeName ?? '');
    setCheckNumber(current.checkNumber ?? '');
    setReason('');
  }, [open, current.paymentTypeName, current.checkNumber]);

  if (!open) return null;

  const allowed = stripeProcessed ? choices.filter((c) => c.method === 'card') : choices;
  const picked = allowed.find((c) => c.name === typeName) ?? null;
  const method = picked?.method ?? current.method;
  const needsCheck = method === 'check';
  const changed =
    (picked?.name ?? null) !== (current.paymentTypeName ?? null) ||
    method !== current.method ||
    (needsCheck && checkNumber.trim() !== (current.checkNumber ?? ''));
  const ready =
    picked != null &&
    changed &&
    reason.trim().length >= 4 &&
    (!needsCheck || checkNumber.trim().length > 0);

  return (
    <div
      className="perm-reason-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="perm-reason-modal" role="dialog" aria-modal="true">
        <div className="perm-reason-title">Change how this {amountLabel} payment was recorded</div>
        <div className="perm-reason-note">
          {stripeProcessed
            ? 'This payment ran through the card processor, so it stays a card payment — only the card type can change.'
            : 'The amount does not change. To correct an amount, void the payment and take it again.'}
        </div>
        <select
          className="input"
          style={{ marginTop: 12, width: '100%' }}
          value={typeName}
          onChange={(e) => setTypeName(e.target.value)}
        >
          <option value="">Select payment type…</option>
          {allowed.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        {needsCheck ? (
          <input
            className="input"
            style={{ marginTop: 10, width: '100%' }}
            value={checkNumber}
            placeholder="Check number"
            onChange={(e) => setCheckNumber(e.target.value)}
          />
        ) : null}
        <textarea
          value={reason}
          placeholder="Reason (e.g. Entered as cash; client paid by check)"
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <div className="perm-reason-error">{error}</div>}
        <div className="perm-reason-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !ready}
            onClick={() =>
              picked &&
              onConfirm({
                method,
                paymentTypeName: picked.name,
                checkNumber: needsCheck ? checkNumber.trim() : null,
                reason: reason.trim(),
              })
            }
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
