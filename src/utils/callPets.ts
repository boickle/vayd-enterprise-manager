import type { CallPillPatient } from '../components/pims/ClientCallPill';

/** Pets on a client record (GET client), as the call filing window's "Save to" choices. */
export function petsFromClient(raw: unknown): CallPillPatient[] {
  if (!raw || typeof raw !== 'object') return [];
  const patients = (raw as { patients?: unknown }).patients;
  if (!Array.isArray(patients)) return [];
  return patients
    .filter((p): p is Record<string, unknown> => p != null && typeof p === 'object' && p.id != null)
    .map((p) => ({
      id: Number(p.id),
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Pet #${p.id}`,
    }))
    .filter((p) => Number.isFinite(p.id));
}
