import { useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import {
  addInvoiceRefillLine,
  applyInvoiceLineRefill,
  clearRefillProductionOverride,
  listInvoiceLineRefillOptions,
  listInvoiceRefillOptions,
  releaseInvoiceLineRefill,
  setRefillProductionOverride,
  type InvoiceLineRefillOption,
  type VisitInvoice,
  type VisitInvoiceLine,
} from '../../api/visitWorkflow';
import './InvoiceRefillPanel.css';

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function errMessage(e: unknown, fallback: string): string {
  return (
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    (e instanceof Error ? e.message : '') ||
    fallback
  );
}

function rxTitle(option: InvoiceLineRefillOption): string {
  return option.rxNumber != null ? `Rx #${option.rxNumber}` : 'Prescription';
}

function RefillPicker({
  title,
  hint,
  emptyText,
  showPet,
  load,
  apply,
  applyNewScript,
  onApplied,
  onError,
  onClose,
}: {
  title: string;
  hint: string;
  emptyText: string;
  showPet?: boolean;
  load: () => Promise<InvoiceLineRefillOption[]>;
  apply: (option: InvoiceLineRefillOption) => Promise<VisitInvoice>;
  /** Offered on rows without usable refills: add the item + sig as an unapproved script. */
  applyNewScript?: (option: InvoiceLineRefillOption) => Promise<VisitInvoice>;
  onApplied: (invoice: VisitInvoice) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<InvoiceLineRefillOption[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((rows) => {
        if (!cancelled) setOptions(rows);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errMessage(e, 'Could not load prescriptions.'));
      });
    return () => {
      cancelled = true;
    };
    // Loads once per open; the picker unmounts on close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (
    option: InvoiceLineRefillOption,
    action: (option: InvoiceLineRefillOption) => Promise<VisitInvoice>
  ) => {
    setBusyId(option.prescriptionId);
    try {
      const next = await action(option);
      onClose();
      onApplied(next);
    } catch (e) {
      onError(errMessage(e, 'Could not add that prescription.'));
    } finally {
      setBusyId(null);
    }
  };

  const shown = options;

  return createPortal(
    <div className="inv-refill-backdrop" role="dialog" aria-modal="true">
      <div className="inv-refill">
        <h3>{title}</h3>
        <p className="inv-refill__hint">{hint}</p>
        {loadError ? <p className="inv-refill__error">{loadError}</p> : null}
        {!options && !loadError ? <p className="inv-refill__hint">Loading…</p> : null}
        {shown && shown.length === 0 ? <p className="inv-refill__empty">{emptyText}</p> : null}
        {shown?.length ? (
          <ul className="inv-refill__list">
            {shown.map((option) => (
              <li
                key={option.prescriptionId}
                className={`inv-refill__row${option.eligible ? '' : ' is-off'}`}
              >
                <div className="inv-refill__row-head">
                  <strong>
                    {showPet && option.patientName ? `${option.patientName} · ` : ''}
                    {rxTitle(option)} · {option.name}
                  </strong>
                  <span className={`inv-refill__badge${option.eligible ? ' is-go' : ''}`}>
                    {option.eligible
                      ? `${option.refillsLeft} refill${option.refillsLeft === 1 ? '' : 's'} left`
                      : option.reason}
                  </span>
                </div>
                <div className="inv-refill__meta">
                  {[
                    shortDate(option.prescribedOn)
                      ? `Prescribed ${shortDate(option.prescribedOn)}`
                      : null,
                    option.prescriberName ? `by ${option.prescriberName}` : null,
                    shortDate(option.refillThrough)
                      ? `refills through ${shortDate(option.refillThrough)}`
                      : null,
                    showPet && option.quantity != null ? `qty ${option.quantity}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {option.instructions ? (
                  <p className="inv-refill__sig">{option.instructions}</p>
                ) : null}
                {option.eligible ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyId != null}
                    onClick={() => void run(option, apply)}
                  >
                    {busyId === option.prescriptionId ? 'Adding…' : 'Use this refill'}
                  </button>
                ) : applyNewScript ? (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busyId != null}
                    title="Adds the item and directions as a new script. A doctor or technician approves it, or send it to the mail queue."
                    onClick={() => void run(option, applyNewScript)}
                  >
                    {busyId === option.prescriptionId
                      ? 'Adding…'
                      : 'Add as new script (needs approval)'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="inv-refill__actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Invoice-level "Refills": pick any refillable prescription in the household and it
 * is added as its own line — locked sig, approved by the prescriber, no provider.
 */
export function InvoiceRefillsButton({
  ensureInvoiceId,
  disabled,
  onApplied,
  onError,
}: {
  /** Saves a draft invoice first so the household is known. */
  ensureInvoiceId: () => Promise<string | null>;
  disabled?: boolean;
  onApplied: (invoice: VisitInvoice) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const invoiceIdRef = useRef<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="client-fin__btn-ghost"
        disabled={disabled}
        title="Fill a refill from a prescription already on file"
        onClick={() => setOpen(true)}
      >
        Refills
      </button>
      {open ? (
        <RefillPicker
          title="Fill a refill"
          hint="Using a refill takes one off the prescription, copies and locks the directions, and gives no doctor production credit. With no refills left, add it as a new script — a doctor or technician approves it, or send it to the mail queue for the doctor."
          emptyText="No refills available for this household. The doctor needs to write a new script."
          showPet
          load={async () => {
            const id = await ensureInvoiceId();
            invoiceIdRef.current = id;
            return id ? listInvoiceRefillOptions(id) : [];
          }}
          apply={(option) => {
            const id = invoiceIdRef.current;
            if (!id) return Promise.reject(new Error('Invoice is not saved yet.'));
            return addInvoiceRefillLine(id, option.prescriptionId);
          }}
          applyNewScript={(option) => {
            const id = invoiceIdRef.current;
            if (!id) return Promise.reject(new Error('Invoice is not saved yet.'));
            return addInvoiceRefillLine(id, option.prescriptionId, { newScript: true });
          }}
          onApplied={onApplied}
          onError={onError}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * One pet's refills, for the SOAP checkout. Only real refills: on a visit the doctor writes
 * a new script in the plan, so there is no "add as new script" here.
 */
export function PetRefillsButton({
  patientId,
  petName,
  ensureInvoiceId,
  disabled,
  className,
  onApplied,
  onError,
}: {
  patientId: number;
  petName: string;
  /** Opens the visit invoice first when nothing has been charged yet. */
  ensureInvoiceId: () => Promise<string | null>;
  disabled?: boolean;
  className?: string;
  onApplied: (invoice: VisitInvoice) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const invoiceIdRef = useRef<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={className ?? 'client-fin__btn-ghost'}
        disabled={disabled}
        title={`Fill a refill from ${petName}'s prescriptions on file`}
        onClick={() => setOpen(true)}
      >
        Refills
      </button>
      {open ? (
        <RefillPicker
          title={`Refills for ${petName}`}
          hint="Using a refill takes one off the prescription, copies and locks the directions, and gives no doctor production credit unless someone gives it on the line with a reason. For a new prescription, add it in the SOAP plan."
          emptyText={`No prescriptions on file for ${petName}.`}
          load={async () => {
            const id = await ensureInvoiceId();
            invoiceIdRef.current = id;
            if (!id) return [];
            const rows = await listInvoiceRefillOptions(id);
            return rows.filter((row) => row.patientId === patientId);
          }}
          apply={(option) => {
            const id = invoiceIdRef.current;
            if (!id) return Promise.reject(new Error('Invoice is not saved yet.'));
            return addInvoiceRefillLine(id, option.prescriptionId);
          }}
          onApplied={onApplied}
          onError={onError}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export const REFILL_OVERRIDE_REASON_MIN = 10;

function overrideWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Production on a refill line. Refills credit no one; staff with permission can give the
 * production to a provider, and must say why. The reason stays on the line and in the
 * invoice's staff audit, and shows in Admin → Reports → Production overrides.
 */
export function RefillProductionCredit({
  invoiceId,
  line,
  providers,
  canOverride,
  disabled,
  className,
  onChanged,
  onError,
}: {
  invoiceId: string;
  line: VisitInvoiceLine;
  providers: { id: number; label: string }[];
  canOverride: boolean;
  disabled?: boolean;
  /** Class for the trigger button / label, to match the surrounding table. */
  className?: string;
  onChanged: (invoice: VisitInvoice) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [providerId, setProviderId] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const overridden = line.productionOverrideAt != null && line.providerEmployeeId != null;
  const providerLabel = (id: number | null | undefined) =>
    id == null ? '—' : (providers.find((p) => p.id === id)?.label ?? `Provider #${id}`);

  const openDialog = () => {
    setProviderId(overridden ? (line.providerEmployeeId as number) : '');
    setReason('');
    setFormError(null);
    setEditing(!overridden);
    setOpen(true);
  };

  const save = async () => {
    if (providerId === '') {
      setFormError('Pick the provider who gets the production.');
      return;
    }
    if (reason.trim().length < REFILL_OVERRIDE_REASON_MIN) {
      setFormError(`Write why (at least ${REFILL_OVERRIDE_REASON_MIN} characters).`);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const next = await setRefillProductionOverride(invoiceId, line.id, {
        providerEmployeeId: providerId,
        reason: reason.trim(),
      });
      setOpen(false);
      onChanged(next);
    } catch (e) {
      setFormError(errMessage(e, 'Could not give production on this refill.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const next = await clearRefillProductionOverride(invoiceId, line.id);
      setOpen(false);
      onChanged(next);
    } catch (e) {
      onError(errMessage(e, 'Could not remove the production override.'));
    } finally {
      setBusy(false);
    }
  };

  let trigger: JSX.Element;
  if (overridden) {
    trigger = (
      <button
        type="button"
        className={`${className ?? 'client-fin__btn-ghost'} inv-refill__credit is-given`}
        title={`Production given on a refill: ${line.productionOverrideReason ?? ''}`}
        onClick={openDialog}
      >
        {providerLabel(line.providerEmployeeId)} · override
      </button>
    );
  } else if (canOverride && !disabled) {
    trigger = (
      <button
        type="button"
        className={`${className ?? 'client-fin__btn-ghost'} inv-refill__credit`}
        title="Refills give no production. Give it to a provider, with a reason."
        onClick={openDialog}
      >
        Give production…
      </button>
    );
  } else {
    trigger = (
      <span className="inv-refill__credit-none" title="Refills give no production credit">
        No production
      </span>
    );
  }

  return (
    <>
      {trigger}
      {open
        ? createPortal(
            <div className="inv-refill-backdrop" role="dialog" aria-modal="true">
              <div className="inv-refill">
                <h3>Production on this refill</h3>
                <p className="inv-refill__hint">
                  {line.description}. Refills normally give no one production. Giving it is recorded
                  with your name and reason on the invoice&apos;s staff audit and in the Production
                  overrides report.
                </p>
                {overridden && !editing ? (
                  <div className="inv-refill__summary">
                    <strong>Credited to {providerLabel(line.providerEmployeeId)}</strong>
                    <span>{line.productionOverrideReason}</span>
                    <span className="inv-refill__locked">
                      {[
                        line.productionOverrideByName
                          ? `By ${line.productionOverrideByName}`
                          : null,
                        overrideWhen(line.productionOverrideAt),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                ) : (
                  <div className="inv-refill__form">
                    <label>
                      Provider
                      <select
                        value={providerId}
                        disabled={busy}
                        onChange={(e) =>
                          setProviderId(e.target.value ? Number(e.target.value) : '')
                        }
                      >
                        <option value="">Pick a provider…</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Why does this refill get production?
                      <textarea
                        rows={3}
                        value={reason}
                        disabled={busy}
                        placeholder="e.g. Dr. reviewed bloodwork and adjusted the dose during this refill"
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    {formError ? <p className="inv-refill__error">{formError}</p> : null}
                  </div>
                )}
                <div className="inv-refill__actions">
                  {overridden && !editing && canOverride && !disabled ? (
                    <>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => void remove()}
                      >
                        {busy ? 'Removing…' : 'Remove production'}
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busy}
                        onClick={() => setEditing(true)}
                      >
                        Change
                      </button>
                    </>
                  ) : null}
                  {editing ? (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void save()}
                    >
                      {busy ? 'Saving…' : 'Give production'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                  >
                    {editing ? 'Cancel' : 'Close'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/** "Check refills" for a line that isn't a refill yet. */
export function RefillCheckButton({
  invoiceId,
  lineId,
  itemName,
  disabled,
  onApplied,
  onError,
}: {
  invoiceId: string;
  lineId: string;
  itemName: string;
  disabled?: boolean;
  onApplied: (invoice: VisitInvoice) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="client-fin__btn-ghost inv-refill__check"
        disabled={disabled}
        title="See refills left on this pet's prescriptions for this item"
        onClick={() => setOpen(true)}
      >
        Check refills
      </button>
      {open ? (
        <RefillPicker
          title={`Refills for ${itemName}`}
          hint="Using a refill takes one off the prescription, copies its directions here, and counts as approved by the prescriber. The directions can’t be changed unless you undo the refill."
          emptyText="No prescriptions on file for this pet and item. The doctor needs to write a new script."
          load={() => listInvoiceLineRefillOptions(invoiceId, lineId)}
          apply={(option) => applyInvoiceLineRefill(invoiceId, lineId, option.prescriptionId)}
          onApplied={onApplied}
          onError={onError}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Summary + undo for a line that is filled as a refill. */
export function RefillSummary({
  invoiceId,
  lineId,
  canEdit,
  disabled,
  onReleased,
  onError,
}: {
  invoiceId: string;
  lineId: string;
  canEdit: boolean;
  disabled?: boolean;
  onReleased: (invoice: VisitInvoice) => void;
  onError: (message: string) => void;
}) {
  const [used, setUsed] = useState<InvoiceLineRefillOption | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listInvoiceLineRefillOptions(invoiceId, lineId)
      .then((rows) => {
        if (!cancelled) setUsed(rows.find((row) => row.usedOnThisLine) ?? null);
      })
      .catch(() => {
        /* the line still says it is a refill; details are a nicety */
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, lineId]);

  const release = async () => {
    setBusy(true);
    try {
      onReleased(await releaseInvoiceLineRefill(invoiceId, lineId));
    } catch (e) {
      onError(errMessage(e, 'Could not undo the refill.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inv-refill__summary">
      <strong>{used ? `Refill of ${rxTitle(used)}` : 'Refill of an existing prescription'}</strong>
      {used ? (
        <span>
          {[
            used.prescriberName ? `Prescribed by ${used.prescriberName}` : null,
            `${used.refillsLeft} refill${used.refillsLeft === 1 ? '' : 's'} left after this`,
            shortDate(used.refillThrough) ? `through ${shortDate(used.refillThrough)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      ) : null}
      <span className="inv-refill__locked">Directions are locked to the prescription.</span>
      {canEdit ? (
        <button
          type="button"
          className="client-fin__btn-ghost"
          disabled={disabled || busy}
          title="Put the refill back on the prescription and unlock the directions"
          onClick={() => void release()}
        >
          {busy ? 'Undoing…' : 'Undo refill'}
        </button>
      ) : null}
    </div>
  );
}
