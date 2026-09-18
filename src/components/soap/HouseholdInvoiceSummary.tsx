import { useEffect, useState } from 'react';
import { ArrowRight, Users } from 'lucide-react';
import {
  getInvoiceByAppointment,
  type HouseholdRosterEntry,
  type VisitInvoice,
} from '../../api/visitWorkflow';

type Props = {
  roster: HouseholdRosterEntry[];
  /** The already-loaded invoice for the currently open pet (avoids a redundant fetch — the page
   * already has this for `VisitCheckoutPanel`). */
  currentInvoice: VisitInvoice | null;
  /** Bumped by the page whenever an order changes for *any* pet in the household (current pet's
   * own actions, or an AI Scribe multi-pet apply to a sibling) so the other pets' totals refetch. */
  refreshSignal: number;
  onSwitchPet: (entry: HouseholdRosterEntry) => void;
};

function money(n: number | null | undefined): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/**
 * Read-only "whole visit" checkout summary shown above `VisitCheckoutPanel` when a visit has more
 * than one pet (docs/ai-scribe.md "Multi-pet visits"). Each pet still has its own `VisitInvoice`
 * on the backend (one invoice per appointment — there's no shared/merged invoice), so this never
 * touches payment: it only aggregates each pet's line items + total for visibility, and lets the
 * doctor jump to another pet's tab to actually check them out (`VisitCheckoutPanel`, unchanged,
 * always acts on whichever pet's tab is currently open).
 */
export default function HouseholdInvoiceSummary({
  roster,
  currentInvoice,
  refreshSignal,
  onSwitchPet,
}: Props) {
  const [otherInvoices, setOtherInvoices] = useState<Record<number, VisitInvoice | null>>({});

  const others = roster.filter((r) => !r.isCurrent);

  useEffect(() => {
    if (others.length === 0) return;
    let canceled = false;
    Promise.all(others.map((r) => getInvoiceByAppointment(r.appointmentId).catch(() => null))).then(
      (results) => {
        if (canceled) return;
        const next: Record<number, VisitInvoice | null> = {};
        others.forEach((r, i) => {
          next[r.appointmentId] = results[i];
        });
        setOtherInvoices(next);
      }
    );
    return () => {
      canceled = true;
    };
    // `others` is derived fresh from `roster` each render — keying off `roster` (+ signal) avoids
    // an infinite loop from the new array reference every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, refreshSignal]);

  if (roster.length <= 1) return null;

  const grandTotal = roster.reduce((sum, r) => {
    const inv = r.isCurrent ? currentInvoice : otherInvoices[r.appointmentId];
    return sum + (Number(inv?.total) || 0);
  }, 0);

  return (
    <div className="soap-household-checkout">
      <div className="soap-household-checkout-head">
        <Users size={14} /> Household checkout · {roster.length} pets
      </div>
      <div className="soap-household-pets">
        {roster.map((r) => {
          const inv = r.isCurrent ? currentInvoice : otherInvoices[r.appointmentId];
          const lines = inv?.lines ?? [];
          return (
            <div key={r.patientId} className={`soap-household-pet${r.isCurrent ? ' current' : ''}`}>
              <div className="soap-household-pet-head">
                <span className="soap-household-pet-name">
                  {r.patientName}
                  {r.isCurrent && <span className="soap-scribe-tag">this chart</span>}
                </span>
                <span className="soap-household-pet-total">{money(inv?.total)}</span>
              </div>
              {lines.length > 0 ? (
                <div className="soap-household-pet-lines">
                  {lines.map((l) => (
                    <div key={l.id} className="soap-household-pet-line">
                      <span>{l.description}</span>
                      <span>{l.isCovered ? 'covered' : money(l.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="soap-household-pet-empty">No items yet</div>
              )}
              {!r.isCurrent && (
                <button
                  type="button"
                  className="soap-household-pet-switch"
                  onClick={() => onSwitchPet(r)}
                >
                  Switch to check out <ArrowRight size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="soap-household-checkout-total">
        <span>Household total</span>
        <span>{money(grandTotal)}</span>
      </div>
    </div>
  );
}
