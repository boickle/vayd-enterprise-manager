import { useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../../api/http';
import {
  listPatientMemberships,
  previewMembershipCancel,
  type MembershipCancelPreview,
} from '../../api/memberships';
import { listPatientStatuses } from '../../api/patientStatuses';
import { addCounterInvoiceLine, type VisitInvoice } from '../../api/visitWorkflow';
import { membershipCancelLineDescription } from '../../utils/membershipCancelEstimateLine';
import './MembershipCancelInvoiceOffer.css';

type Props = {
  invoice: VisitInvoice;
  /** Pets known to be leaving with this visit (euthanasia appointment or consent). */
  patientIds?: number[];
  disabled?: boolean;
  onInvoiceChange: (invoice: VisitInvoice) => void;
};

type Offer = { patientId: number; preview: MembershipCancelPreview };

function money(n: number): string {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Pets this invoice makes inactive when it is paid (a catalog line such as euthanasia). */
function inactivatingPatientIds(
  invoice: VisitInvoice,
  inactiveStatuses: Set<string> | null
): number[] {
  const lines = invoice.lines ?? [];
  const returned = new Set(lines.map((line) => line.returnOfLineId).filter(Boolean));
  const ids = new Set<number>();
  for (const line of lines) {
    if (line.isDeleted || line.returnOfLineId || returned.has(line.id)) continue;
    const status = line.catalogChangePatientStatusTo?.trim().toLowerCase();
    if (!status) continue;
    if (inactiveStatuses && !inactiveStatuses.has(status)) continue;
    const patientId = Number(line.patientId ?? invoice.patientId);
    if (Number.isFinite(patientId) && patientId > 0) ids.add(patientId);
  }
  return [...ids].sort((a, b) => a - b);
}

function cancelLinesOnInvoice(invoice: VisitInvoice): Set<string> {
  const lines = invoice.lines ?? [];
  const returned = new Set(lines.map((line) => line.returnOfLineId).filter(Boolean));
  const keys = new Set<string>();
  for (const line of lines) {
    if (line.isDeleted || line.returnOfLineId || returned.has(line.id)) continue;
    const patientId = Number(line.patientId ?? invoice.patientId);
    keys.add(`${patientId}:${(line.description ?? '').trim()}`);
  }
  return keys;
}

/**
 * When this invoice ends a pet's membership, offer to put the membership's unused credit
 * or amount owed on the same bill. Paying the invoice then cancels the membership with no
 * separate refund or charge.
 */
export default function MembershipCancelInvoiceOffer({
  invoice,
  patientIds: leavingPatientIds,
  disabled,
  onInvoiceChange,
}: Props) {
  const [inactiveStatuses, setInactiveStatuses] = useState<Set<string> | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPatientStatuses()
      .then((rows) => {
        if (cancelled) return;
        setInactiveStatuses(
          new Set(
            rows.filter((row) => row.marksInactive).map((row) => row.name.trim().toLowerCase())
          )
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const leavingKey = (leavingPatientIds ?? []).join(',');
  const patientKey = useMemo(() => {
    const ids = new Set(inactivatingPatientIds(invoice, inactiveStatuses));
    for (const id of leavingKey ? leavingKey.split(',').map(Number) : []) {
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b).join(',');
  }, [invoice, inactiveStatuses, leavingKey]);

  useEffect(() => {
    if (!patientKey) {
      setOffers([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Offer[] = [];
      for (const patientId of patientKey.split(',').map(Number)) {
        const memberships = await listPatientMemberships({ patientId }).catch(() => []);
        for (const membership of memberships.filter((row) => row.status !== 'inactive')) {
          try {
            next.push({ patientId, preview: await previewMembershipCancel(membership.id) });
          } catch {
            /* already canceled or not settleable */
          }
        }
      }
      if (!cancelled) setOffers(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientKey]);

  const onInvoice = useMemo(() => cancelLinesOnInvoice(invoice), [invoice]);

  const rows = offers.filter(
    ({ preview }) => preview.chargeAmount > 0.009 || preview.refundAmount > 0.009
  );
  if (rows.length === 0) return null;

  const add = async ({ patientId, preview }: Offer) => {
    const charge = preview.chargeAmount > 0.009;
    setAdding(preview.membershipId);
    setError(null);
    try {
      onInvoiceChange(
        await addCounterInvoiceLine(invoice.id, {
          description: membershipCancelLineDescription(preview.planName),
          qty: charge ? 1 : -1,
          unitPrice: charge ? preview.chargeAmount : preview.refundAmount,
          patientId,
          isCovered: false,
          miscCharge: true,
          excludeFromProduction: true,
        })
      );
    } catch (err) {
      setError(apiErrorMessage(err) || 'Could not add the membership to this invoice.');
    } finally {
      setAdding(null);
    }
  };

  return (
    <section className="membership-cancel-offer" aria-label="Membership on this invoice">
      {rows.map((offer) => {
        const { preview, patientId } = offer;
        const charge = preview.chargeAmount > 0.009;
        const amount = charge ? preview.chargeAmount : preview.refundAmount;
        const added = onInvoice.has(
          `${patientId}:${membershipCancelLineDescription(preview.planName)}`
        );
        return (
          <div key={preview.membershipId} className="membership-cancel-offer__row">
            <p className="membership-cancel-offer__title">
              {preview.petName}&apos;s membership ({preview.planName}) ends when this invoice is
              paid.
            </p>
            {added ? (
              <p>
                {charge
                  ? `The ${money(amount)} owed on the membership is on this invoice and is collected with this payment.`
                  : `The ${money(amount)} membership credit is on this invoice and comes off this payment.`}
              </p>
            ) : (
              <>
                <p>
                  {charge
                    ? `${preview.petName} used ${money(preview.usedThisTerm)} in covered services and paid ${money(preview.paidThisTerm)}, so ${money(amount)} is owed. Add it to collect it with this payment, or leave it off to charge it separately.`
                    : `${money(amount)} of the membership is unused (paid ${money(preview.paidThisTerm)}, used ${money(preview.usedThisTerm)}). Add it as a credit to take it off this payment, or leave it off to refund it separately.`}
                </p>
                {preview.paymentUnknown ? (
                  <p className="membership-cancel-offer__warn">
                    No payment record found. The {money(preview.paidThisTerm)} paid is estimated
                    from the listed price. Check Square before adding it.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="soap-btn ghost"
                  disabled={disabled || adding != null}
                  onClick={() => void add(offer)}
                >
                  {adding === preview.membershipId
                    ? 'Adding…'
                    : charge
                      ? `Add ${money(amount)} to this invoice`
                      : `Add ${money(amount)} credit to this invoice`}
                </button>
              </>
            )}
          </div>
        );
      })}
      {error ? <div className="soap-error">{error}</div> : null}
    </section>
  );
}
