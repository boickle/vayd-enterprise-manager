// Authenticated client lookups for staff (scheduler, routing, etc.)
import axios from 'axios';
import { http } from './http';

export type ClientSearchRow = {
  id: string | number;
  firstName?: string;
  lastName?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  zipcode?: string;
  [key: string]: unknown;
};

/** GET /clients/search?q= (& optional includeInactive when backend supports it) */
export async function searchClientsStaff(
  q: string,
  params?: { includeInactive?: boolean }
): Promise<ClientSearchRow[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const { data } = await http.get<ClientSearchRow[]>('/clients/search', {
    params: {
      q: trimmed,
      ...(params?.includeInactive ? { includeInactive: true } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

/** GET /clients/:id — full client; may include nested patients/pets */
export async function fetchClientByIdStaff(clientId: string | number): Promise<unknown> {
  const { data } = await http.get(`/clients/${encodeURIComponent(String(clientId))}`);
  return data;
}

/** POST /clients/:keepId/merge { sourceClientId } — absorb a duplicate household. */
export async function mergeClientsStaff(opts: {
  keepClientId: string | number;
  absorbClientId: string | number;
}): Promise<{ ok: boolean; message: string }> {
  try {
    await http.post(`/clients/${encodeURIComponent(String(opts.keepClientId))}/merge`, {
      sourceClientId: Number(opts.absorbClientId),
    });
    return { ok: true, message: 'Clients merged. Pets and records are on this household now.' };
  } catch (err) {
    if (axios.isAxiosError(err) && (err.response?.status === 404 || err.response?.status === 501)) {
      return {
        ok: false,
        message:
          'Merge is not available on the server yet. Nothing was changed — restart the API if you just added this route.',
      };
    }
    const raw = axios.isAxiosError(err) ? err.response?.data?.message : null;
    const message =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.filter((m) => typeof m === 'string').join(' ')
          : err instanceof Error
            ? err.message
            : 'Could not merge clients.';
    return { ok: false, message };
  }
}

/** GET /clients/:id/invoices — eVet billing envelope (invoices + balance). */
export async function fetchClientBillingStaff(
  clientId: string | number,
  practiceId: number,
): Promise<Record<string, unknown>> {
  const { data } = await http.get(`/clients/${encodeURIComponent(String(clientId))}/invoices`, {
    params: { practiceId },
  });
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}
