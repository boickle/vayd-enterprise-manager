import { findClientsMatchingVisitAddress } from '../api/clientsByAddress';
import { searchClientsStaff, type ClientSearchRow } from '../api/clientsStaff';
import {
  clientDisplayNameFromRequestData,
  requestDataClientId,
  requestDataEmail,
  requestDataPhysicalAddressForSearch,
} from './appointmentRequestDisplay';
import {
  clientSearchRowHomeAddress,
  compareVisitAddressToClientHome,
  type VisitAddressMatchQuality,
} from './visitAddressMatch';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function readList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  const s = pickStr(v);
  return s ? [s] : [];
}

function emailsFor(row: ClientSearchRow): string[] {
  const r = row as Record<string, unknown>;
  return readList(r.emails ?? r.emailAddresses ?? r.email);
}

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

function clientNameParts(requestData: Record<string, unknown>): {
  first: string | null;
  last: string | null;
  query: string;
} {
  const first = pickStr((requestData.fullName as { first?: string })?.first);
  const last = pickStr((requestData.fullName as { last?: string })?.last);
  const query = [first, last].filter(Boolean).join(' ').trim() || clientDisplayNameFromRequestData(requestData);
  return { first, last, query };
}

function rowMatchesClientName(
  row: ClientSearchRow,
  first: string | null,
  last: string | null,
): boolean {
  if (!first || !last) return false;
  return (
    pickStr(row.firstName)?.toLowerCase() === first.toLowerCase() &&
    pickStr(row.lastName)?.toLowerCase() === last.toLowerCase()
  );
}

function pickUniqueClientId(rows: ClientSearchRow[]): string | null {
  if (rows.length !== 1 || rows[0]?.id == null) return null;
  return String(rows[0].id);
}

function rankRowsByAddress(
  rows: ClientSearchRow[],
  visitAddress: string,
): Array<{ row: ClientSearchRow; quality: VisitAddressMatchQuality }> {
  const order = { exact: 0, strong: 1, weak: 2, none: 3 };
  return rows
    .map((row) => ({
      row,
      quality: compareVisitAddressToClientHome(visitAddress, clientSearchRowHomeAddress(row)),
    }))
    .filter(({ quality }) => quality !== 'none')
    .sort((a, b) => order[a.quality] - order[b.quality]);
}

function pickClientIdFromAddressMatches(
  ranked: Array<{ row: ClientSearchRow; quality: VisitAddressMatchQuality }>,
  first: string | null,
  last: string | null,
): string | null {
  const strong = ranked.filter(({ quality }) => quality === 'exact' || quality === 'strong');
  const candidates = strong.length > 0 ? strong : ranked;

  if (first && last) {
    const nameMatches = candidates.filter(({ row }) => rowMatchesClientName(row, first, last));
    if (nameMatches.length === 1 && nameMatches[0].row.id != null) {
      return String(nameMatches[0].row.id);
    }
    const exactNameMatches = nameMatches.filter(({ quality }) => quality === 'exact');
    if (exactNameMatches.length === 1 && exactNameMatches[0].row.id != null) {
      return String(exactNameMatches[0].row.id);
    }
  }

  if (candidates.length === 1 && candidates[0].row.id != null) {
    return String(candidates[0].row.id);
  }

  return null;
}

/** Staff-side client id resolution — sync fields, email, address+name, then name search. */
export async function resolveRequestDataClientIdStaff(
  requestData: Record<string, unknown>,
  practiceId: number = DEFAULT_PRACTICE_ID,
): Promise<string | null> {
  const sync = requestDataClientId(requestData);
  if (sync) return sync;

  const loggedInId = pickStr(requestData.userId) ?? pickStr(requestData.loggedInClientId);
  if (loggedInId) return loggedInId;

  const { first, last, query: nameQuery } = clientNameParts(requestData);
  const visitAddress = requestDataPhysicalAddressForSearch(requestData);

  const email = requestDataEmail(requestData);
  if (email) {
    try {
      const rows = await searchClientsStaff(email, { includeInactive: true });
      const target = normalizeEmail(email);
      const exact = rows.find((r) => emailsFor(r).some((e) => normalizeEmail(e) === target));
      if (exact?.id != null) return String(exact.id);
      if (visitAddress && rows.length > 1) {
        const ranked = rankRowsByAddress(rows, visitAddress);
        const fromAddress = pickClientIdFromAddressMatches(ranked, first, last);
        if (fromAddress) return fromAddress;
      }
      const single = pickUniqueClientId(rows);
      if (single) return single;
    } catch {
      /* fall through */
    }
  }

  if (visitAddress) {
    try {
      const { ranked } = await findClientsMatchingVisitAddress(practiceId, visitAddress);
      const fromAddress = pickClientIdFromAddressMatches(ranked, first, last);
      if (fromAddress) return fromAddress;
    } catch {
      /* fall through */
    }
  }

  if (nameQuery && nameQuery !== 'Unknown') {
    try {
      const rows = await searchClientsStaff(nameQuery, { includeInactive: true });
      let matches = rows;
      if (first && last) {
        const exactName = rows.filter((r) => rowMatchesClientName(r, first, last));
        if (exactName.length > 0) matches = exactName;
      }

      if (visitAddress && matches.length > 1) {
        const ranked = rankRowsByAddress(matches, visitAddress);
        const fromAddress = pickClientIdFromAddressMatches(ranked, first, last);
        if (fromAddress) return fromAddress;
      }

      const single = pickUniqueClientId(matches);
      if (single) return single;

      if (first && last) {
        const match = matches.find((r) => rowMatchesClientName(r, first, last));
        if (match?.id != null) return String(match.id);
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}
