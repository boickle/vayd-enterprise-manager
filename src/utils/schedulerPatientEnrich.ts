import type { Appointment, Patient } from '../api/roomLoader';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { fetchPatientProfileForRow, patientLookupIdsFromRow } from '../api/patients';
import { patientsForAppointment } from './schedulerAddPet';
import { patientSexAbbrevDisplay, pickStr, sexSourceStringsFromRecord } from './schedulerVisitDisplay';

function resolvePimsId(p: Patient): string {
  return patientLookupIdsFromRow(p).pimsId;
}

function patientsMatch(a: Patient, b: Patient): boolean {
  const { internalId: ai, pimsId: ap } = patientLookupIdsFromRow(a);
  const { internalId: bi, pimsId: bp } = patientLookupIdsFromRow(b);
  if (ai && bi && ai === bi) return true;
  if (ap && bp && ap === bp) return true;
  const an = pickStr(a.name)?.toLowerCase();
  const bn = pickStr(b.name)?.toLowerCase();
  return !!(an && bn && an === bn);
}

function profileToPatient(profile: unknown, base: Patient): Patient {
  if (!profile || typeof profile !== 'object') return base;
  const po = profile as Record<string, unknown>;
  const sexSources = sexSourceStringsFromRecord(po);
  const sex = sexSources[0] ?? undefined;
  const lookup = patientLookupIdsFromRow(po);
  return {
    ...base,
    ...(profile as Patient),
    ...(lookup.pimsId ? { pimsId: lookup.pimsId } : {}),
    ...(sex ? { sex } : {}),
  };
}

function mergePatientIntoAppointment(appt: Appointment, patient: Patient): Appointment {
  const multi = (appt as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) {
    const patients = multi.map((p) => (patientsMatch(p, patient) ? { ...p, ...patient } : p));
    const primary = patients.find((p) => patientsMatch(p, patient)) ?? appt.patient ?? patient;
    return { ...appt, patients, patient: primary } as Appointment;
  }
  const sing = appt.patient;
  if (sing && !patientsMatch(sing, patient)) {
    return { ...appt, patients: [sing, patient], patient: sing } as Appointment;
  }
  return { ...appt, patient };
}

function patientFromClientPayloadRow(row: unknown): Patient | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const lookup = patientLookupIdsFromRow(o);
  const idRaw = lookup.internalId || lookup.pimsId;
  const id = idRaw ? Number(idRaw) : 0;
  const joined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
  const name = pickStr(o.name) ?? (joined || null);
  if (!name) return null;
  const sexSources = sexSourceStringsFromRecord(o);
  return {
    id: Number.isFinite(id) && id > 0 ? id : 0,
    name,
    pimsId: lookup.pimsId || undefined,
    sex: sexSources[0] ?? pickStr(o.sex) ?? undefined,
    dob: pickStr(o.dob) ?? pickStr(o.dateOfBirth) ?? undefined,
    breed: pickStr(o.breed) ?? pickStr(o.breedName) ?? undefined,
    species: pickStr(o.species) ?? pickStr(o.speciesName) ?? undefined,
    isActive: o.isActive !== false,
    isDeleted: o.isDeleted === true,
    pimsType: pickStr(o.pimsType) ?? undefined,
  } as Patient;
}

function patientsFromClientPayload(payload: unknown): Patient[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as Record<string, unknown>).patients;
  if (!Array.isArray(raw)) return [];
  return raw.map(patientFromClientPayloadRow).filter((p): p is Patient => p != null);
}

async function enrichFromClientChart(appt: Appointment): Promise<Appointment> {
  const clientId =
    appt.client?.id ?? (appt as { clientId?: number | string | null }).clientId ?? null;
  if (clientId == null || String(clientId).trim() === '') return appt;

  let payload: unknown;
  try {
    payload = await fetchClientByIdStaff(clientId);
  } catch {
    return appt;
  }

  const chartPets = patientsFromClientPayload(payload);
  if (chartPets.length === 0) return appt;

  let next = appt;
  for (const need of patientsForAppointment(next)) {
    if (patientSexAbbrevDisplay(need)) continue;
    const hit = chartPets.find((cp) => patientsMatch(need, cp));
    if (!hit || !patientSexAbbrevDisplay(hit)) continue;
    next = mergePatientIntoAppointment(next, hit);
  }
  return next;
}

/** Fetch patient chart rows and merge sex onto the appointment (multi-pet households included). */
export async function enrichAppointmentPatientProfiles(appt: Appointment): Promise<Appointment> {
  const initial = patientsForAppointment(appt).filter((p) => !patientSexAbbrevDisplay(p));
  const mergedPatients: Patient[] = [];

  await Promise.all(
    initial.map(async (p) => {
      const profile = await fetchPatientProfileForRow(p);
      if (!profile) return;
      const merged = profileToPatient(profile, p);
      if (!patientSexAbbrevDisplay(merged)) return;
      mergedPatients.push(merged);
    })
  );

  let next = appt;
  for (const merged of mergedPatients) {
    next = mergePatientIntoAppointment(next, merged);
  }

  if (patientsForAppointment(next).some((p) => !patientSexAbbrevDisplay(p))) {
    next = await enrichFromClientChart(next);
  }

  return next;
}
