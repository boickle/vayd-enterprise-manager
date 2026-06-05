import type { PatientSearchRow } from '../api/patients';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export type PatientSearchClientRef = {
  id: string | number;
  name: string;
  pimsId: string;
};

/** Owners / clients attached to a `/patients/search` row (same rules as PIMS Patients list). */
export function clientsForPatientSearchRow(row: PatientSearchRow): PatientSearchClientRef[] {
  const r = row as Record<string, unknown>;
  const owners = r.owners ?? r.clients ?? r.clientOwners;
  if (Array.isArray(owners)) {
    const out: PatientSearchClientRef[] = [];
    for (const o of owners) {
      if (!o || typeof o !== 'object') continue;
      const c = o as Record<string, unknown>;
      const id = c.id ?? c.clientId;
      if (id == null || (typeof id !== 'string' && typeof id !== 'number')) continue;
      const name =
        [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() ||
        pickStr(c.name) ||
        `Client #${id}`;
      const pimsId = pickStr(c.pimsId) ?? String(id);
      out.push({ id, name, pimsId });
    }
    if (out.length) return out;
  }
  const c = r.client;
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    const id = o.id ?? r.clientId;
    if (id != null && (typeof id === 'string' || typeof id === 'number')) {
      const name =
        [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim() ||
        pickStr(o.name) ||
        `Client #${id}`;
      const pimsId = pickStr(o.pimsId) ?? String(id);
      return [{ id, name, pimsId }];
    }
  }
  const cid = r.clientId;
  if (cid != null && (typeof cid === 'string' || typeof cid === 'number')) {
    const ownerJoined = [pickStr(r.clientFirstName), pickStr(r.clientLastName)].filter(Boolean).join(' ').trim();
    const name =
      (pickStr(r.clientName) ?? pickStr(r.ownerName) ?? ownerJoined) || `Client #${cid}`;
    const pimsId = pickStr(r.clientPimsId) ?? String(cid);
    return [{ id: cid, name, pimsId }];
  }
  return [];
}

export function primaryClientLabelForPatientRow(row: PatientSearchRow): string | null {
  const clients = clientsForPatientSearchRow(row);
  if (clients.length === 0) return null;
  if (clients.length === 1) return clients[0]!.name;
  return clients.map((c) => c.name).join(', ');
}

export function patientPimsIdFromSearchRow(row: PatientSearchRow, fallbackId: string | number): string {
  const r = row as Record<string, unknown>;
  return pickStr(r.pimsId) ?? pickStr(r.patientPimsId) ?? String(fallbackId);
}
