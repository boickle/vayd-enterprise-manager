// Authenticated client lookups for staff (scheduler, routing, etc.)
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

/** GET /clients/search?q= */
export async function searchClientsStaff(q: string): Promise<ClientSearchRow[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const { data } = await http.get<ClientSearchRow[]>('/clients/search', { params: { q: trimmed } });
  return Array.isArray(data) ? data : [];
}

/** GET /clients/:id — full client; may include nested patients/pets */
export async function fetchClientByIdStaff(clientId: string | number): Promise<unknown> {
  const { data } = await http.get(`/clients/${encodeURIComponent(String(clientId))}`);
  return data;
}
