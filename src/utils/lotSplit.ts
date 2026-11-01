/** One row of the several-lots editor: a lot and how many units come from it. */
export type LotSplitRow = {
  lotId: number | null;
  lotNumber: string;
  /** Typed text, so a half-typed number isn't thrown away. */
  quantity: string;
};

export type LotSplitCheck = {
  ok: boolean;
  total: number;
  /** Plain-English reason the lots can't be saved; null when they can. */
  message: string | null;
};

const EPS = 1e-6;

/** Shown when a quantity change no longer fits the line's lots and the server cleared them. */
export const LOTS_CLEARED_MESSAGE =
  'Lots were cleared because the quantity changed — pick lots again.';

function num(n: number): string {
  return String(Math.round(n * 1e4) / 1e4);
}

/** "12 + 8 of 20". */
export function lotSplitSummary(rows: LotSplitRow[], lineQty: number): string {
  const parts = rows.map((r) => {
    const q = Number(r.quantity);
    return Number.isFinite(q) && r.quantity.trim() !== '' ? num(q) : '?';
  });
  return `${parts.join(' + ')} of ${num(lineQty)}`;
}

/**
 * Do these lots work for a line of `lineQty`? Mirrors the server: every row has a lot and a
 * quantity above zero, no lot twice, and the total equals the line when the item needs every
 * unit assigned (controlled drug, lot # required), otherwise it may be less but not more.
 */
export function checkLotSplit(
  rows: LotSplitRow[],
  lineQty: number,
  opts: { mustCoverAll?: boolean } = {}
): LotSplitCheck {
  let total = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.lotId == null && !r.lotNumber.trim()) {
      return { ok: false, total, message: 'Choose a lot for every row.' };
    }
    // Controlled drugs, lot # items and vaccines draw from a real bottle: a lot from the list.
    if (opts.mustCoverAll && r.lotId == null) {
      return {
        ok: false,
        total,
        message: `Lot ${r.lotNumber.trim()} is not a bottle on the shelf. Choose each lot from the list.`,
      };
    }
    const q = Number(r.quantity);
    if (!Number.isFinite(q) || q <= 0 || r.quantity.trim() === '') {
      return { ok: false, total, message: 'Enter a quantity above zero for every lot.' };
    }
    const key = r.lotId != null ? `id:${r.lotId}` : `n:${r.lotNumber.trim().toLowerCase()}`;
    if (seen.has(key)) {
      return {
        ok: false,
        total,
        message: 'The same lot is on two rows. Put its quantity on one row.',
      };
    }
    seen.add(key);
    total += q;
  }
  total = Math.round(total * 1e4) / 1e4;
  if (opts.mustCoverAll && Math.abs(total - lineQty) > EPS) {
    return {
      ok: false,
      total,
      message: `The lots add up to ${num(total)} but the line is ${num(lineQty)}. Every unit needs a lot.`,
    };
  }
  if (!opts.mustCoverAll && total > lineQty + EPS) {
    return {
      ok: false,
      total,
      message: `The lots add up to ${num(total)}, more than the ${num(lineQty)} on the line.`,
    };
  }
  return { ok: true, total, message: null };
}
