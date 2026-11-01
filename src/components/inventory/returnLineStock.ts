/**
 * CAT-11: what staff decide for a returned inventory line besides the quantity: which lot(s) the
 * returned stock goes to or comes from, and, when it is not going back on the shelf, the waste details.
 * Pure helpers, used by ReturnLineStockFields and the Return step of the client invoice screen.
 */

export const CONTROLLED_RETURN_MESSAGE =
  "Controlled drugs returned by a client can't go back into stock; record them as waste.";
/** The practice's waste reason for a returned item that cannot be resold. */
export const DEFAULT_RETURN_WASTE_REASON = 'returned_unsellable';
export const OTHER_CORRECTION_REASON = 'other_correction';
export const OTHER_DISPOSAL_METHOD = 'other';
export const REVERSE_DISTRIBUTION_METHOD = 'reverse_distribution';

/** One lot a line was sold from, with what is still standing for it (sold less returned or wasted). */
export type ReturnLotOption = {
  inventoryLotBalanceId: number;
  lotNumber: string | null;
  expirationDate: string | null;
  standing: number;
};

/** From GET /visit-invoices/:id/return-options, per line, lots in the order they were drawn. */
export type ReturnOptionsLine = { isControlled: boolean; lots: ReturnLotOption[] };

/** Staff's entries for one line. Anything missing falls back to the pre-fill / default. */
export type ReturnStockDetail = {
  /** Lot quantities staff typed, valid only for the returned quantity in `lotQtyFor`. */
  lotQty?: Record<number, string>;
  lotQtyFor?: number;
  reasonCode?: string;
  disposalCode?: string;
  notes?: string;
  witnessId?: number | null;
  reasonExplanation?: string;
  disposalExplanation?: string;
};

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Only lines sold from two or more lots show a lot choice; one lot is implied. */
export function isMultiLot(lots: ReturnLotOption[] | undefined | null): boolean {
  return (lots?.length ?? 0) >= 2;
}

/**
 * The lot the returned quantity goes to by default: the LAST lot used on the line, but no more than
 * is still standing for it; any left over moves to the lot before it, and so on.
 */
export function prefillReturnLots(lots: ReturnLotOption[], qty: number): Record<number, number> {
  const out: Record<number, number> = {};
  let left = round4(qty);
  for (let i = lots.length - 1; i >= 0 && left > 1e-9; i -= 1) {
    const take = Math.min(left, Math.max(0, lots[i].standing));
    if (take > 1e-9) {
      out[lots[i].inventoryLotBalanceId] = round4(take);
      left = round4(left - take);
    }
  }
  return out;
}

/** What is chosen now: the staff's own split if it was made for this quantity, else the pre-fill. */
export function chosenReturnLots(
  detail: ReturnStockDetail | undefined,
  lots: ReturnLotOption[],
  qty: number
): Record<number, number> {
  if (detail?.lotQty && detail.lotQtyFor === qty) {
    const out: Record<number, number> = {};
    for (const [id, text] of Object.entries(detail.lotQty)) {
      const n = Number(text);
      if (Number.isFinite(n) && n > 0) out[Number(id)] = n;
    }
    return out;
  }
  return prefillReturnLots(lots, qty);
}

/** A sentence if the chosen lots cannot be returned, otherwise null. */
export function returnLotsProblem(
  chosen: Record<number, number>,
  lots: ReturnLotOption[],
  qty: number
): string | null {
  for (const lot of lots) {
    const q = chosen[lot.inventoryLotBalanceId] ?? 0;
    if (q > lot.standing + 1e-6) {
      return `Lot ${lot.lotNumber ?? lot.inventoryLotBalanceId} has only ${round4(lot.standing)} left to take back; you chose ${q}.`;
    }
  }
  const total = round4(Object.values(chosen).reduce((t, q) => t + q, 0));
  if (Math.abs(total - qty) > 1e-6) {
    return `The lots add up to ${total} but you are returning ${qty}. Make them match.`;
  }
  return null;
}

export type WasteReasonLike = { code: string; label: string; isActive?: boolean };

/** The reason to use: the staff's pick if it is still offered, else "Returned, not resellable", else the first. */
export function effectiveReturnReason(reasons: WasteReasonLike[], picked?: string): string {
  if (picked && reasons.some((r) => r.code === picked)) return picked;
  if (reasons.some((r) => r.code === DEFAULT_RETURN_WASTE_REASON)) return DEFAULT_RETURN_WASTE_REASON;
  return reasons[0]?.code ?? '';
}

/** Reverse distribution is only for an expired controlled drug, so a return never offers it. */
export function returnDisposalMethods<T extends { code: string }>(methods: T[]): T[] {
  return methods.filter((m) => m.code !== REVERSE_DISTRIBUTION_METHOD);
}

/** A sentence if the waste details are not enough to save, otherwise null. */
export function returnWasteProblem(args: {
  isControlled: boolean;
  reasons: Array<WasteReasonLike & { requiresDisposalMethod?: string }>;
  detail: ReturnStockDetail | undefined;
}): string | null {
  const { isControlled, reasons, detail } = args;
  const reasonCode = effectiveReturnReason(reasons, detail?.reasonCode);
  if (!reasonCode) return 'Choose why it is not going back on the shelf.';
  const reason = reasons.find((r) => r.code === reasonCode);
  const disposal = detail?.disposalCode ?? '';
  if ((isControlled || reason?.requiresDisposalMethod === 'yes') && !disposal) {
    return isControlled
      ? 'Choose a disposal method; it is required for controlled drugs.'
      : 'Choose a disposal method for this reason.';
  }
  if (reasonCode === OTHER_CORRECTION_REASON && !detail?.reasonExplanation?.trim()) {
    return 'Explain the other correction.';
  }
  if (disposal === OTHER_DISPOSAL_METHOD && !detail?.disposalExplanation?.trim()) {
    return 'Explain how it was disposed of.';
  }
  return null;
}

/** The `lots` and `waste` parts of a return request item for one line. */
export function returnStockRequestParts(args: {
  backOnShelf: boolean;
  isControlled: boolean;
  options: ReturnOptionsLine | undefined;
  detail: ReturnStockDetail | undefined;
  qty: number;
  reasons: WasteReasonLike[];
}) {
  const { backOnShelf, isControlled, options, detail, qty, reasons } = args;
  const out: {
    lots?: Array<{ inventoryLotBalanceId: number; quantity: number }>;
    waste?: {
      reasonCode: string;
      disposalMethodCode?: string | null;
      notes?: string | null;
      explanation?: string | null;
      witnessEmployeeId?: number | null;
    };
  } = {};
  if (options && isMultiLot(options.lots)) {
    const chosen = chosenReturnLots(detail, options.lots, qty);
    out.lots = Object.entries(chosen).map(([id, quantity]) => ({
      inventoryLotBalanceId: Number(id),
      quantity,
    }));
  }
  if (!backOnShelf) {
    const reasonCode = effectiveReturnReason(reasons, detail?.reasonCode);
    const explanation = [
      reasonCode === OTHER_CORRECTION_REASON ? detail?.reasonExplanation?.trim() : '',
      detail?.disposalCode === OTHER_DISPOSAL_METHOD ? detail?.disposalExplanation?.trim() : '',
    ]
      .filter(Boolean)
      .join(' · ');
    out.waste = {
      reasonCode,
      disposalMethodCode: detail?.disposalCode || null,
      notes: detail?.notes?.trim() || null,
      explanation: explanation || null,
      ...(isControlled && detail?.witnessId != null ? { witnessEmployeeId: detail.witnessId } : {}),
    };
  }
  return out;
}

/** Owner decision (Nov 1, 2026): an invoice with returns is corrected, never unlocked or reopened. */
export const INVOICE_HAS_RETURNS_MESSAGE = 'This invoice has returns. Make a correction instead.';
/** Owner decision (Nov 1, 2026): a return's credit is never voided. */
export const RETURN_CREDIT_VOID_MESSAGE = "A return can't be voided. Correct the stock on Waste / Adjust instead.";

type InvoiceLike = {
  hasReturns?: boolean;
  lines?: Array<{ returnOfLineId?: string | null; isDeleted?: boolean }> | null;
} | null | undefined;

/** The invoice is a return's credit (it carries return lines). */
export function isReturnCredit(invoice: InvoiceLike): boolean {
  return Boolean(invoice?.lines?.some((l) => !l.isDeleted && l.returnOfLineId));
}

/**
 * Why Unlock / Reopen and Void are off for this invoice, or null when they are allowed by the
 * return rules (other rules, like permissions and status, still apply).
 */
export function invoiceReturnLocks(invoice: InvoiceLike): { unlock: string | null; void: string | null } {
  return {
    unlock: invoice?.hasReturns ? INVOICE_HAS_RETURNS_MESSAGE : null,
    void: isReturnCredit(invoice) ? RETURN_CREDIT_VOID_MESSAGE : null,
  };
}
