import type { ClientStatusRow } from '../api/clientStatuses';

type StatusLike = {
  name?: unknown;
  discount?: unknown;
  labDiscount?: unknown;
  procedureDiscount?: unknown;
  inventoryDiscount?: unknown;
  inventoryDiscountMode?: unknown;
  isStaff?: unknown;
};

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Compact rate line: "15%", "Inv cost+10% · Proc 10% · Lab 10%". */
export function formatStatusDiscount(row: StatusLike): string {
  const fallback = asNumber(row.discount) ?? 0;
  const inventoryMode = row.inventoryDiscountMode === 'cost_plus' ? 'cost_plus' : 'percent';
  const hasTyped =
    inventoryMode === 'cost_plus' ||
    row.inventoryDiscount != null ||
    row.procedureDiscount != null ||
    row.labDiscount != null;
  if (!hasTyped) return `${fallback}%`;
  const show = (v: unknown) => {
    const n = asNumber(v);
    return n != null ? `${n}%` : `${fallback}%`;
  };
  const inv =
    inventoryMode === 'cost_plus'
      ? `Inv cost+${asNumber(row.inventoryDiscount) ?? 10}%`
      : `Inv ${show(row.inventoryDiscount)}`;
  return `${inv} · Proc ${show(row.procedureDiscount)} · Lab ${show(row.labDiscount)}`;
}

export type ClientDiscountBadge = {
  /** Short chip text for the EMR header. */
  label: string;
  /** Full breakdown on hover. */
  title: string;
};

function statusFromRecord(client: Record<string, unknown>): StatusLike | null {
  const nested = client.clientStatus;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as StatusLike;
  }
  return null;
}

function statusHasDiscount(status: StatusLike): boolean {
  if (status.isStaff === true) return true;
  if ((asNumber(status.discount) ?? 0) > 0) return true;
  if (status.inventoryDiscountMode === 'cost_plus') return true;
  return (
    (asNumber(status.inventoryDiscount) ?? 0) > 0 ||
    (asNumber(status.procedureDiscount) ?? 0) > 0 ||
    (asNumber(status.labDiscount) ?? 0) > 0
  );
}

/**
 * What to pin on the client name in EMR. Personal percent, account-status
 * rates, and staff pricing all count — anything that would change what they pay.
 */
export function clientDiscountBadge(
  client: Record<string, unknown> | null | undefined,
  statusLookup?: ClientStatusRow[] | null,
): ClientDiscountBadge | null {
  if (!client) return null;

  const personal = asNumber(client.discount);
  let status = statusFromRecord(client);
  if (!status && statusLookup?.length) {
    const id = asNumber(client.clientStatusId);
    const match = id != null ? statusLookup.find((s) => s.id === id) : undefined;
    if (match) status = match;
  }

  const parts: string[] = [];
  let label: string | null = null;

  if (status && statusHasDiscount(status)) {
    const name = pickStr(status.name) || (status.isStaff === true ? 'Staff' : 'Account status');
    const rates = formatStatusDiscount(status);
    const staffOnly = status.isStaff === true && rates === '0%';
    label = staffOnly ? `${name} pricing` : `${name} · ${rates}`;
    parts.push(staffOnly ? `${name} (staff pricing)` : `${name}: ${rates}`);
  }

  if (personal != null && personal > 0) {
    const personalLine = `${personal}% personal`;
    parts.push(personalLine);
    if (!label) label = `${personal}% discount`;
    else if (!label.includes(`${personal}%`)) label = `${label} · ${personal}% personal`;
  }

  if (!label) return null;
  return { label, title: parts.join(' · ') };
}
