// src/api/membershipPurchasesAnalytics.ts
import { http } from './http';

export const MEMBERSHIP_PURCHASES_TIMEZONE = 'America/New_York';

export type MembershipPurchaseDay = {
  date: string;
  count: number;
};

/** Sun–Sat (or API-defined) week bucket from GET /analytics/membership-purchases. */
export type MembershipPurchaseWeek = {
  weekStart: string;
  weekEnd: string;
  count: number;
};

export type MembershipPurchasesAnalytics = {
  totalMemberships: number;
  membershipsByType: Record<string, number>;
  /** Distinct client households with at least one membership in scope; null if unknown */
  householdsWithMember: number | null;
  /** Counts by acquisition channel (e.g. room-loader, client-portal) */
  heardAboutUs: Record<string, number>;
  purchasesByDay: MembershipPurchaseDay[];
  /** Weekly aggregates from API when provided; otherwise empty (UI may roll up from daily). */
  weekly: MembershipPurchaseWeek[];
};

function emptyAnalytics(): MembershipPurchasesAnalytics {
  return {
    totalMemberships: 0,
    membershipsByType: {},
    householdsWithMember: null,
    heardAboutUs: {},
    purchasesByDay: [],
    weekly: [],
  };
}

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function recordNumValues(x: unknown): Record<string, number> {
  if (!x || typeof x !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    out[k] = num(v);
  }
  return out;
}

function parseDayRow(r: unknown): MembershipPurchaseDay | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const date = String(o.date ?? o.day ?? o.purchaseDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, count: num(o.count ?? o.memberships ?? o.total ?? o.purchases) };
}

function dailyFromArray(arr: unknown): MembershipPurchaseDay[] {
  if (!Array.isArray(arr)) return [];
  const out: MembershipPurchaseDay[] = [];
  for (const r of arr) {
    const d = parseDayRow(r);
    if (d) out.push(d);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Backend shape: `{ label, count }[]` on `byMembershipType` / `byRequestOrigin`. */
function labelCountArrayToRecord(arr: unknown): Record<string, number> {
  if (!Array.isArray(arr)) return {};
  const out: Record<string, number> = {};
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const label = String(o.label ?? o.name ?? o.key ?? '').trim();
    if (!label) continue;
    out[label] = num(o.count);
  }
  return out;
}

function weeklyFromArray(arr: unknown): MembershipPurchaseWeek[] {
  if (!Array.isArray(arr)) return [];
  const out: MembershipPurchaseWeek[] = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const weekStart = String(o.weekStart ?? '').slice(0, 10);
    const weekEndRaw = String(o.weekEnd ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) continue;
    const weekEnd = /^\d{4}-\d{2}-\d{2}$/.test(weekEndRaw) ? weekEndRaw : weekStart;
    out.push({ weekStart, weekEnd, count: num(o.count) });
  }
  out.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return out;
}

function getStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

function aggregateFromPurchases(rows: unknown[]): MembershipPurchasesAnalytics {
  const byType: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const byDay = new Map<string, number>();
  const householdKeys = new Set<string>();
  let sawHouseholdHint = false;

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;

    const typeName =
      getStr(p, ['planName', 'planType', 'membershipType', 'type', 'tier']) ?? 'Unknown';
    byType[typeName] = (byType[typeName] ?? 0) + 1;

    const origin =
      getStr(p, ['requestOrigin', 'request_origin', 'channel', 'source', 'heardAboutUs']) ??
      'unknown';
    const originKey = origin.toLowerCase().replace(/\s+/g, '-');
    byChannel[originKey] = (byChannel[originKey] ?? 0) + 1;

    const dayRaw = getStr(p, ['purchaseDate', 'purchasedAt', 'createdAt', 'date']);
    let day = dayRaw ? dayRaw.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = '';
    if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);

    const hhId = getStr(p, ['householdId', 'household_id', 'clientHouseholdId']);
    if (hhId) {
      sawHouseholdHint = true;
      householdKeys.add(hhId);
    } else if (p.clientId != null && String(p.clientId).trim() !== '') {
      sawHouseholdHint = true;
      householdKeys.add(`c:${p.clientId}`);
    }
  }

  const purchasesByDay = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return {
    totalMemberships: rows.length,
    membershipsByType: byType,
    householdsWithMember: sawHouseholdHint ? householdKeys.size : null,
    heardAboutUs: byChannel,
    purchasesByDay,
    weekly: [],
  };
}

/**
 * Normalize GET /analytics/membership-purchases JSON into a stable UI shape.
 * Accepts several plausible backend field names and raw purchase arrays.
 */
export function normalizeMembershipPurchasesResponse(data: unknown): MembershipPurchasesAnalytics {
  if (Array.isArray(data)) {
    return aggregateFromPurchases(data);
  }
  if (!data || typeof data !== 'object') {
    return emptyAnalytics();
  }

  const root = data as Record<string, unknown>;
  const inner =
    root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : null;
  const src = inner ?? root;

  const purchasesRaw = root.purchases ?? root.items ?? src.purchases ?? src.items;
  const hasSummary =
    src.totalMemberships != null ||
    src.total != null ||
    root.totalMemberships != null ||
    root.total != null;

  if (Array.isArray(purchasesRaw) && purchasesRaw.length > 0 && !hasSummary) {
    return aggregateFromPurchases(purchasesRaw);
  }

  const totalMemberships = num(
    src.totalMemberships ?? src.total ?? root.totalMemberships ?? root.total
  );

  let membershipsByType: Record<string, number> = {};
  if (Array.isArray(src.byMembershipType) || Array.isArray(root.byMembershipType)) {
    membershipsByType = labelCountArrayToRecord(src.byMembershipType ?? root.byMembershipType);
  }
  if (Object.keys(membershipsByType).length === 0) {
    membershipsByType = recordNumValues(
      src.membershipsByType ??
        src.byType ??
        src.countsByType ??
        src.membershipCountsByType ??
        root.membershipsByType
    );
  }

  let heardAboutUs: Record<string, number> = {};
  if (Array.isArray(src.byRequestOrigin) || Array.isArray(root.byRequestOrigin)) {
    heardAboutUs = labelCountArrayToRecord(src.byRequestOrigin ?? root.byRequestOrigin);
  }
  if (Object.keys(heardAboutUs).length === 0) {
    heardAboutUs = recordNumValues(
      src.heardAboutUs ??
        src.byChannel ??
        src.channels ??
        src.sourceCounts ??
        root.heardAboutUs
    );
  }

  const householdsRaw =
    root.distinctClientHouseholds ??
    src.distinctClientHouseholds ??
    src.householdsWithMember ??
    src.clientHouseholdsWithMember ??
    src.distinctHouseholds ??
    src.householdCount ??
    root.householdsWithMember;

  const householdsWithMember: number | null =
    householdsRaw === null || householdsRaw === undefined ? null : num(householdsRaw);

  let purchasesByDay = dailyFromArray(
    src.purchasesByDay ?? src.byDay ?? src.daily ?? src.dailyCounts ?? src.series ?? root.purchasesByDay
  );

  let weekly = weeklyFromArray(src.weekly ?? root.weekly);

  if (!purchasesByDay.length && Array.isArray(purchasesRaw)) {
    const agg = aggregateFromPurchases(purchasesRaw);
    purchasesByDay = agg.purchasesByDay;
  }

  let total = totalMemberships;
  if (!total && purchasesByDay.length) {
    total = purchasesByDay.reduce((s, d) => s + d.count, 0);
  }
  if (!total && Array.isArray(purchasesRaw)) {
    total = purchasesRaw.length;
  }

  let hh = householdsWithMember;
  if (hh === null && Array.isArray(purchasesRaw) && purchasesRaw.length) {
    hh = aggregateFromPurchases(purchasesRaw).householdsWithMember;
  }

  return {
    totalMemberships: total,
    membershipsByType,
    householdsWithMember: hh,
    heardAboutUs,
    purchasesByDay,
    weekly,
  };
}

export type FetchMembershipPurchasesParams = {
  /** When true, omit start/end (all-time). */
  allTime?: boolean;
  startDate?: string;
  endDate?: string;
  timeZone?: string;
  practiceId?: string | number;
};

/**
 * GET /analytics/membership-purchases
 * All-time: no date query params. Date range: startDate, endDate, timeZone (defaults Eastern).
 */
export async function fetchMembershipPurchasesAnalytics(
  params: FetchMembershipPurchasesParams
): Promise<MembershipPurchasesAnalytics> {
  const query: Record<string, string | number> = {};
  if (!params.allTime && params.startDate && params.endDate) {
    query.startDate = params.startDate;
    query.endDate = params.endDate;
    query.timeZone = params.timeZone ?? MEMBERSHIP_PURCHASES_TIMEZONE;
  }
  if (params.practiceId != null && params.practiceId !== '') {
    query.practiceId = params.practiceId;
  }

  const { data } = await http.get<unknown>('/analytics/membership-purchases', {
    params: Object.keys(query).length ? query : undefined,
  });
  return normalizeMembershipPurchasesResponse(data);
}
