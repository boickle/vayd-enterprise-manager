import axios from 'axios';
import { http } from './http';
import { fetchClientByIdStaff, searchClientsStaff, type ClientSearchRow } from './clientsStaff';
import { searchPimsStaff } from './pimsSearch';
import {
  addressSearchQueriesFromVisit,
  clientSearchRowHomeAddress,
  compareVisitAddressToClientHome,
  type VisitAddressMatchQuality,
} from '../utils/visitAddressMatch';

export type ClientAddressMatchRow = ClientSearchRow & {
  formattedAddress?: string | null;
  matchQuality?: VisitAddressMatchQuality | string | null;
};

export type ClientsByAddressResponse = {
  queryAddress?: string | null;
  matches?: ClientAddressMatchRow[] | null;
};

function normalizeMatchQuality(raw: unknown): VisitAddressMatchQuality | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'exact' || s === 'strong' || s === 'weak') return s;
  return null;
}

function normalizeMatches(data: unknown): ClientAddressMatchRow[] {
  if (!data || typeof data !== 'object') return [];
  const o = data as ClientsByAddressResponse | ClientAddressMatchRow[];
  if (Array.isArray(o)) return o;
  const rows = o.matches;
  return Array.isArray(rows) ? rows : [];
}

/**
 * GET /clients/by-address — practice-scoped ranked matches for linking unlinked visits.
 * Returns [] when the route is not deployed yet (404).
 */
export async function searchClientsByAddress(
  practiceId: number,
  address: string,
  options?: { includeInactive?: boolean }
): Promise<{ matches: ClientAddressMatchRow[]; endpointAvailable: boolean }> {
  const trimmed = address.trim();
  if (!trimmed || !Number.isFinite(practiceId)) {
    return { matches: [], endpointAvailable: true };
  }
  try {
    const { data } = await http.get<ClientsByAddressResponse | ClientAddressMatchRow[]>(
      '/clients/by-address',
      {
        params: {
          practiceId: String(practiceId),
          address: trimmed,
          ...(options?.includeInactive ? { includeInactive: true } : {}),
        },
      }
    );
    const matches = normalizeMatches(data).map((row) => ({
      ...row,
      matchQuality: normalizeMatchQuality(row.matchQuality) ?? row.matchQuality ?? null,
      formattedAddress:
        (typeof row.formattedAddress === 'string' && row.formattedAddress.trim()) ||
        undefined,
    }));
    return { matches, endpointAvailable: true };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      return { matches: [], endpointAvailable: false };
    }
    throw e;
  }
}

async function enrichClientAddressRows(
  rows: ClientAddressMatchRow[]
): Promise<ClientAddressMatchRow[]> {
  const needEnrich = rows.filter((row) => !clientSearchRowHomeAddress(row)?.trim());
  if (!needEnrich.length) return rows;

  const byId = new Map<string, ClientAddressMatchRow>();
  for (const row of rows) byId.set(String(row.id), row);

  await Promise.all(
    needEnrich.slice(0, 24).map(async (row) => {
      try {
        const payload = await fetchClientByIdStaff(row.id);
        if (payload && typeof payload === 'object') {
          byId.set(String(row.id), { ...row, ...(payload as ClientSearchRow) });
        }
      } catch {
        /* optional enrich */
      }
    })
  );

  return [...byId.values()];
}

function rankClientAddressMatches(
  visitAddress: string,
  rows: ClientAddressMatchRow[]
): Array<{ row: ClientAddressMatchRow; quality: VisitAddressMatchQuality }> {
  return rows
    .map((row) => {
      const home = row.formattedAddress?.trim() || clientSearchRowHomeAddress(row);
      let quality = compareVisitAddressToClientHome(visitAddress, home);
      const fromApi = normalizeMatchQuality(row.matchQuality);
      if (quality === 'none' && (fromApi === 'exact' || fromApi === 'strong')) {
        quality = fromApi;
      }
      return { row, quality };
    })
    .filter(({ quality }) => quality !== 'none')
    .sort((a, b) => {
      const order = { exact: 0, strong: 1, weak: 2, none: 3 };
      return order[a.quality] - order[b.quality];
    });
}

async function collectFallbackSearchRows(
  practiceId: number,
  queries: string[]
): Promise<{ rows: ClientAddressMatchRow[]; usedFallbackSearch: boolean }> {
  const byId = new Map<string, ClientAddressMatchRow>();
  let usedFallbackSearch = false;

  for (const query of queries) {
    try {
      const { clients: pimsClients } = await searchPimsStaff(query, {
        practiceId,
        includeInactive: true,
      });
      if (pimsClients.length > 0) usedFallbackSearch = true;
      for (const row of pimsClients) {
        const id = String(row.id);
        if (!byId.has(id)) byId.set(id, row);
      }
    } catch {
      /* optional fallback */
    }

    try {
      const rows = await searchClientsStaff(query, { includeInactive: true });
      if (rows.length > 0) usedFallbackSearch = true;
      for (const row of rows) {
        const id = String(row.id);
        if (!byId.has(id)) byId.set(id, row);
      }
    } catch {
      /* optional fallback */
    }
  }

  return { rows: [...byId.values()], usedFallbackSearch };
}

/**
 * Primary `/clients/by-address` lookup plus practice-scoped search fallback queries.
 * Re-ranks everything with client-side address comparison (Dr/Drive, etc.).
 */
export async function findClientsMatchingVisitAddress(
  practiceId: number,
  visitAddress: string
): Promise<{
  ranked: Array<{ row: ClientAddressMatchRow; quality: VisitAddressMatchQuality }>;
  endpointAvailable: boolean;
  usedFallbackSearch: boolean;
}> {
  const trimmed = visitAddress.trim();
  if (!trimmed || !Number.isFinite(practiceId)) {
    return { ranked: [], endpointAvailable: true, usedFallbackSearch: false };
  }

  const lookupOpts = { includeInactive: true };
  const { matches: apiMatches, endpointAvailable } = await searchClientsByAddress(
    practiceId,
    trimmed,
    lookupOpts
  );
  const byId = new Map<string, ClientAddressMatchRow>();
  for (const row of apiMatches) byId.set(String(row.id), row);

  const queries = addressSearchQueriesFromVisit(trimmed);
  if (endpointAvailable) {
    for (const query of queries) {
      if (query === trimmed) continue;
      try {
        const { matches } = await searchClientsByAddress(practiceId, query, lookupOpts);
        for (const row of matches) {
          const id = String(row.id);
          if (!byId.has(id)) byId.set(id, row);
        }
      } catch {
        /* optional fan-out */
      }
    }
  }

  const { rows: fallbackRows, usedFallbackSearch } = await collectFallbackSearchRows(
    practiceId,
    queries
  );
  for (const row of fallbackRows) {
    const id = String(row.id);
    if (!byId.has(id)) byId.set(id, row);
  }

  const enriched = await enrichClientAddressRows([...byId.values()]);

  return {
    ranked: rankClientAddressMatches(trimmed, enriched),
    endpointAvailable,
    usedFallbackSearch,
  };
}
