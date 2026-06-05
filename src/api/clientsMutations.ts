import { http } from './http';

/** Matches backend ClientDto; extra keys are allowed. */
export type ClientDto = Record<string, unknown> & {
  id?: number | string;
  pimsId?: string | number | null;
  firstName?: string | null;
  lastName?: string | null;
  practice?: { id: number; name?: string } | null;
  isActive?: boolean;
  isDeleted?: boolean;
};

export type UpsertClientsResponse = { ok: boolean; upserted: number };

export type DeleteClientsResponse = { ok: boolean; deleted: number };

export async function upsertClients(body: ClientDto | ClientDto[]): Promise<UpsertClientsResponse> {
  const { data } = await http.post<UpsertClientsResponse>('/clients/upsert', body);
  return data;
}

/** POST /clients — save one or many; returns saved DTO(s) from API. */
export async function saveClients(body: ClientDto | ClientDto[]): Promise<unknown> {
  const { data } = await http.post<unknown>('/clients', body);
  return data;
}

/** PATCH /clients/:id — partial update (staff). */
export async function patchClientStaff(clientId: string | number, body: Record<string, unknown>): Promise<unknown> {
  const { data } = await http.patch(`/clients/${encodeURIComponent(String(clientId))}`, body);
  return data;
}

export async function deleteClients(ids: (string | number)[]): Promise<DeleteClientsResponse> {
  if (ids.length === 0) return { ok: true, deleted: 0 };
  const { data } = await http.delete<DeleteClientsResponse>('/clients', {
    params: { ids: ids.map(String).join(',') },
  });
  return data;
}
