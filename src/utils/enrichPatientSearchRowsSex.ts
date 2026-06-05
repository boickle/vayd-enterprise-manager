import type { PatientSearchRow } from '../api/patients';
import { fetchPatientProfileForRow } from '../api/patients';
import {
  patientSexDisplayFromRecord,
  sexFieldsFromProfile,
} from './schedulerVisitDisplay';

const profileSexCache = new Map<string, Record<string, unknown>>();

function rowNeedsSexEnrich(row: PatientSearchRow): boolean {
  return !patientSexDisplayFromRecord(row as Record<string, unknown>);
}

function mergeSexFromProfile(row: PatientSearchRow, profile: Record<string, unknown>): PatientSearchRow {
  const merged = { ...(row as Record<string, unknown>) };
  for (const [key, value] of Object.entries(sexFieldsFromProfile(profile))) {
    if (merged[key] == null && value != null) merged[key] = value;
  }
  return merged as PatientSearchRow;
}

async function loadProfileSexFields(row: PatientSearchRow): Promise<Record<string, unknown> | null> {
  const cacheKey = String(row.id ?? '');
  if (cacheKey && profileSexCache.has(cacheKey)) {
    return profileSexCache.get(cacheKey) ?? null;
  }

  const profile = await fetchPatientProfileForRow(row);
  if (!profile || typeof profile !== 'object') return null;

  const fields = sexFieldsFromProfile(profile as Record<string, unknown>);
  if (cacheKey && Object.keys(fields).length > 0) {
    profileSexCache.set(cacheKey, fields);
  }
  return fields;
}

/** Fill missing sex on patient search rows using the same chart fetch the scheduler uses. */
export async function enrichPatientSearchRowsSex(
  rows: PatientSearchRow[],
  opts?: { maxFetches?: number; concurrency?: number },
): Promise<PatientSearchRow[]> {
  const maxFetches = opts?.maxFetches ?? 40;
  const concurrency = Math.max(1, opts?.concurrency ?? 6);

  const indices: number[] = [];
  for (let i = 0; i < rows.length && indices.length < maxFetches; i++) {
    if (rowNeedsSexEnrich(rows[i]!)) indices.push(i);
  }
  if (indices.length === 0) return rows;

  const next = [...rows];
  let cursor = 0;

  async function worker() {
    while (cursor < indices.length) {
      const index = indices[cursor++]!;
      const row = rows[index]!;
      try {
        const fields = await loadProfileSexFields(row);
        if (fields && Object.keys(fields).length > 0) {
          next[index] = mergeSexFromProfile(row, fields);
        }
      } catch {
        /* keep original row */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, indices.length) }, () => worker()));
  return next;
}
