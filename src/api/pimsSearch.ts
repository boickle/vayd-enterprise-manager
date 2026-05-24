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
import { searchPatientsStaff, type PatientSearchRow } from './patients';
import {
  clientsForPatientSearchRow,
  patientPimsIdFromSearchRow,
  primaryClientLabelForPatientRow,
} from '../utils/pimsPatientSearchRow';

export type PimsPatientSearchHit = {
  id: number | string;
  name: string;
  clientId: number | string | null;
  clientLabel: string | null;
  patientPimsId: string;
  clientPimsId: string | null;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientDisplayName(row: PatientSearchRow): string {
  const r = row as Record<string, unknown>;
  const joined = [pickStr(row.firstName), pickStr(row.lastName)].filter(Boolean).join(' ').trim();
  return (pickStr(row.name) ?? pickStr(r.patientName) ?? joined) || 'Patient';
}

function normalizePatientSearchRow(row: unknown): PimsPatientSearchHit | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as PatientSearchRow;
  const idRaw = (o as Record<string, unknown>).id ?? (o as Record<string, unknown>).patientId;
  if (idRaw == null || (typeof idRaw !== 'string' && typeof idRaw !== 'number')) return null;
  const id = idRaw;
  const name = patientDisplayName(o);
  const owners = clientsForPatientSearchRow(o);
  const primary = owners[0];
  return {
    id,
    name,
    clientId: primary?.id ?? null,
    clientLabel: primaryClientLabelForPatientRow(o),
    patientPimsId: patientPimsIdFromSearchRow(o, id),
    clientPimsId: primary?.pimsId ?? null,
  };
}

/** PIMS id for eVet client deep link from a `/clients/search` row. */
export function clientPimsIdFromSearchRow(c: ClientSearchRow): string {
  const r = c as Record<string, unknown>;
  return pickStr(r.pimsId) ?? String(c.id);
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
