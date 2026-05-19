/**
 * PIMS client + patient search (staff).
 *
 * Today this composes existing endpoints. A dedicated backend route would reduce
 * round-trips and allow unified ranking, inactive flags on clients, and phone search:
 *
 * Suggested: GET /pims/search?q=&practiceId=&includeInactive=&mode=all|clients|patients
 *   → { clients: [...], patients: [...], meta: { tookMs } }
 *
 * Patient matches (including by owner/client name) should come from `/patients/search`
 * on the backend; this bundle does not call `/clients/search` to fan out patient fetches.
 *
 * For the client profile / invoice view (account balance UI), you will likely need:
 *   GET /clients/:id/billing or GET /clients/:id/invoices — not used by this bundle yet.
 */
import { searchClientsStaff, type ClientSearchRow } from './clientsStaff';
import { searchPatientsStaff } from './patients';

export type PimsPatientSearchHit = {
  id: number | string;
  name: string;
  clientId: number | string | null;
  clientLabel: string | null;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function normalizePatientSearchRow(row: unknown): PimsPatientSearchHit | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const idRaw = o.id ?? o.patientId;
  if (idRaw == null || (typeof idRaw !== 'string' && typeof idRaw !== 'number')) return null;
  const id = idRaw;
  const joined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
  const name = pickStr(o.name) ?? (joined || 'Patient');
  const client = o.client as Record<string, unknown> | undefined;
  const clientId =
    (o.clientId as number | string | undefined) ??
    (client?.id as number | string | undefined) ??
    null;
  let clientLabel: string | null = null;
  if (client) {
    clientLabel =
      [pickStr(client.firstName), pickStr(client.lastName)].filter(Boolean).join(' ').trim() || null;
  }
  return { id, name, clientId, clientLabel };
}

export type PimsUnifiedSearchResult = {
  clients: ClientSearchRow[];
  patients: PimsPatientSearchHit[];
};

export async function searchPimsClientsAndPatients(
  q: string,
  options?: { practiceId?: number; activeOnly?: boolean }
): Promise<PimsUnifiedSearchResult> {
  const trimmed = q.trim();
  if (!trimmed) {
    return { clients: [], patients: [] };
  }
  const practiceId = options?.practiceId;
  const activeOnly = options?.activeOnly !== false;

  const [clients, patientRows] = await Promise.all([
    searchClientsStaff(trimmed),
    searchPatientsStaff(trimmed, {
      ...(practiceId != null ? { practiceId } : {}),
      activeOnly,
    }),
  ]);

  const patients = patientRows
    .map((row) => normalizePatientSearchRow(row))
    .filter(Boolean) as PimsPatientSearchHit[];

  return { clients, patients };
}
