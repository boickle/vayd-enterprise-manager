import { DateTime } from 'luxon';
import { fetchPatientByIdStaff, fetchPatientMedicalRecordStaff } from '../api/patients';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { fetchPatientAppointmentsStaff } from '../api/pimsAppointments';
import {
  listEncounters,
  listPatientPrescriptions,
  listProblems,
  type PatientPrescription,
  type PatientProblem,
  type SoapEncounter,
} from '../api/visitWorkflow';
import { buildCaseHistorySource, signalmentFromPatient } from './buildCaseHistorySource';
import { clientIdFromPatientRow, clientNameFromPatientRow } from './briefDisplay';
import {
  employeeDisplayName,
  inactiveAtIso,
  statusNameFromPatient,
  type HouseholdPetStatusInput,
} from './householdPetStatus';
import type { MedicalRecordBundle } from './patientChartFromMedicalRecord';

function unwrapPatientRecord(profile: unknown): Record<string, unknown> | null {
  if (!profile || typeof profile !== 'object') return null;
  const o = profile as Record<string, unknown>;
  const nested = o.patient;
  if (nested && typeof nested === 'object') {
    return {
      ...(nested as Record<string, unknown>),
      client: o.client ?? (nested as Record<string, unknown>).client,
    };
  }
  return o;
}

/**
 * A pet's whole Scout chart as one text source for the chart AI: signalment, problems,
 * chronic meds, visits, appointments, imported records and household.
 */
export async function loadPatientHistorySource(opts: {
  practiceId: number;
  patientId: number;
  patientName: string;
  clientName: string | null;
}): Promise<{ text: string; owner: string | null; today: string }> {
  const today = DateTime.now().toISODate() || '';
  const apptStart = DateTime.now().minus({ years: 20 }).toUTC().toISO();
  const apptEnd = DateTime.now().plus({ years: 2 }).toUTC().toISO();
  const [profile, problems, meds, encounters, medicalRecord, appointments] = await Promise.all([
    fetchPatientByIdStaff(opts.patientId).catch(() => null),
    listProblems(opts.patientId).catch(() => [] as PatientProblem[]),
    listPatientPrescriptions(opts.patientId, { activeChronicOnly: true }).catch(
      () => [] as PatientPrescription[]
    ),
    listEncounters({ patientId: opts.patientId }).catch(() => [] as SoapEncounter[]),
    fetchPatientMedicalRecordStaff(opts.patientId).catch(() => null),
    fetchPatientAppointmentsStaff(opts.patientId, {
      practiceId: opts.practiceId,
      start: apptStart ?? undefined,
      end: apptEnd ?? undefined,
      includeInactivePatient: true,
    }).catch(() => []),
  ]);
  const rec = unwrapPatientRecord(profile);
  const owner = rec ? clientNameFromPatientRow(rec) : opts.clientName;
  let householdPets: HouseholdPetStatusInput[] = [];
  const clientId = rec ? clientIdFromPatientRow(rec) : null;
  if (clientId != null) {
    const clientRow = await fetchClientByIdStaff(String(clientId)).catch(() => null);
    if (clientRow && typeof clientRow === 'object') {
      const rawPets = Array.isArray((clientRow as Record<string, unknown>).patients)
        ? ((clientRow as Record<string, unknown>).patients as unknown[])
        : [];
      householdPets = rawPets
        .map((raw): HouseholdPetStatusInput | null => {
          if (!raw || typeof raw !== 'object') return null;
          const p = raw as Record<string, unknown>;
          const id = p.id != null ? String(p.id) : '';
          if (!id) return null;
          return {
            id,
            name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Pet #${id}`,
            active: p.isActive !== false,
            statusName: statusNameFromPatient(p),
            inactiveAt: inactiveAtIso(p.inactiveAt),
            inactivatedByName: employeeDisplayName(p.inactivatedByEmployee),
          };
        })
        .filter((p): p is HouseholdPetStatusInput => p != null);
    }
  }
  const src = buildCaseHistorySource({
    patientId: String(opts.patientId),
    patientName: opts.patientName,
    clientName: owner,
    signalment: signalmentFromPatient(rec),
    problems,
    meds,
    encounters,
    appointments,
    patientRecord: rec,
    medicalRecord: medicalRecord as MedicalRecordBundle | null,
    asOfDate: today,
    householdPets,
  });
  return { text: src.text, owner, today };
}
