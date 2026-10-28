/**
 * Convert production VSD into collectible treatment cash for Projected Revenue.
 *
 * Membership-covered production stays inside VSD but is never billed; membership
 * dues are a separate cash line. Open A/R is left out of the forecast: it is a
 * snapshot of unpaid invoices, not cash expected to arrive in this window, and
 * new A/R and collections tend to offset over time.
 */

export type CollectibleRevenueRates = {
  start: string;
  end: string;
  vsd: number;
  membershipDiscount: number;
  membershipCoveredVsd: number;
  memberVsd: number;
  memberBilled: number;
  openToCollect: number;
  lookbackDays: number;
};

export const EMPTY_COLLECTIBLE_RATES: CollectibleRevenueRates = {
  start: '',
  end: '',
  vsd: 0,
  membershipDiscount: 0,
  membershipCoveredVsd: 0,
  memberVsd: 0,
  memberBilled: 0,
  openToCollect: 0,
  lookbackDays: 0,
};

export function ratesFromApi(
  resp: {
    start: string;
    end: string;
    vsd: number;
    membershipDiscount: number;
    membershipCoveredVsd: number;
    memberVsd: number;
    memberBilled: number;
    openToCollect: number;
    lookbackDays: number;
  } | null
): CollectibleRevenueRates {
  if (!resp) return EMPTY_COLLECTIBLE_RATES;
  return {
    start: resp.start,
    end: resp.end,
    vsd: resp.vsd,
    membershipDiscount: resp.membershipDiscount,
    membershipCoveredVsd: resp.membershipCoveredVsd,
    memberVsd: resp.memberVsd,
    memberBilled: resp.memberBilled,
    openToCollect: Math.max(0, Number(resp.openToCollect) || 0),
    lookbackDays: Math.max(0, Number(resp.lookbackDays) || 0),
  };
}

/** Share of VSD that was billed (1 − membership coverage). Clamped to [0, 1]. */
export function collectibleShare(
  rates: Pick<CollectibleRevenueRates, 'vsd' | 'membershipDiscount'> | null | undefined
): number {
  const vsd = Number(rates?.vsd) || 0;
  const discount = Math.max(0, Number(rates?.membershipDiscount) || 0);
  if (vsd <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - discount / vsd));
}

export function scaleCollectible(amount: number, share: number): number {
  return (Number(amount) || 0) * share;
}

/** Bounds on the cash calibration so one odd month of collections cannot swing forecasts. */
const CASH_CALIBRATION_MIN = 0.85;
const CASH_CALIBRATION_MAX = 1.25;

/**
 * Treatment cash collected ÷ collectible treatment (provider VSD × share) over the same
 * trailing window. Doctor-attributed VSD misses production with no production doctor and
 * the share is an average, so practice cash has run 0–10% above it; this factor puts
 * projected practice treatment on the same cash basis as the actual days. 1 when either
 * side is missing.
 */
export function cashCalibrationFactor(treatmentCash: number, collectibleTreatment: number): number {
  const cash = Number(treatmentCash) || 0;
  const collectible = Number(collectibleTreatment) || 0;
  if (cash <= 0 || collectible <= 0) return 1;
  return Math.max(CASH_CALIBRATION_MIN, Math.min(CASH_CALIBRATION_MAX, cash / collectible));
}
