/** eVet client/patient ids from a linked booked appointment (hold conversion, etc.). */

import type { AppointmentRequestPetRowSummary } from './appointmentRequestDetailDisplay';
import type { AppointmentRequestPetDetail } from './appointmentRequestDetailDisplay';
import { looksLikeEvetPimsId, resolveClientPimsIdForRequest } from './appointmentRequestDisplay';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export type LinkedAppointmentEvetIds = {
  clientPimsId: string | null;
  patientPimsId: string | null;
  /** Internal patient id for in-app chart modal. */
  patientInternalId: string | null;
  patientName: string | null;
};

export function linkedAppointmentEvetIdsFromRecord(
  appt: Record<string, unknown>,
): LinkedAppointmentEvetIds {
  const client = appt.client;
  const patient = appt.patient;

  const clientPimsRaw =
    (typeof client === 'object' && client
      ? pickStr((client as Record<string, unknown>).pimsId)
      : null) ?? pickStr(appt.clientPimsId);

  const patientPimsRaw =
    (typeof patient === 'object' && patient
      ? pickStr((patient as Record<string, unknown>).pimsId)
      : null) ??
    pickStr(appt.patientPimsId) ??
    pickStr(appt.patient_pims_id);

  const patientInternalRaw =
    typeof patient === 'object' && patient
      ? pickStr((patient as Record<string, unknown>).id)
      : pickStr(appt.patientId);

  const patientName =
    (typeof patient === 'object' && patient
      ? pickStr((patient as Record<string, unknown>).name)
      : null) ?? pickStr(appt.patientName);

  return {
    clientPimsId: looksLikeEvetPimsId(clientPimsRaw) ? clientPimsRaw : null,
    patientPimsId: looksLikeEvetPimsId(patientPimsRaw) ? patientPimsRaw : null,
    patientInternalId: patientInternalRaw,
    patientName,
  };
}

function petNamesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function linkedPatientTargetIndex(
  rows: Array<{ name: string }>,
  linked: LinkedAppointmentEvetIds,
): number {
  if (!linked.patientPimsId && !linked.patientInternalId) return -1;
  if (rows.length === 0) return -1;
  if (rows.length === 1) return 0;
  if (linked.patientName) {
    const idx = rows.findIndex((r) => petNamesMatch(r.name, linked.patientName!));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function enrichPetRowSummariesFromLinkedAppointment(
  rows: AppointmentRequestPetRowSummary[],
  linked: LinkedAppointmentEvetIds | null | undefined,
): AppointmentRequestPetRowSummary[] {
  if (!linked) return rows;
  const targetIndex = linkedPatientTargetIndex(rows, linked);
  if (targetIndex < 0) return rows;

  return rows.map((row, index) => {
    if (index !== targetIndex) return row;
    return {
      ...row,
      patientPimsId: row.patientPimsId ?? linked.patientPimsId,
      patientId: row.patientId ?? linked.patientInternalId,
    };
  });
}

export function enrichPetDetailsFromLinkedAppointment(
  pets: AppointmentRequestPetDetail[],
  linked: LinkedAppointmentEvetIds | null | undefined,
): AppointmentRequestPetDetail[] {
  if (!linked) return pets;
  const targetIndex = linkedPatientTargetIndex(pets, linked);
  if (targetIndex < 0) return pets;

  return pets.map((pet, index) => {
    if (index !== targetIndex) return pet;
    return {
      ...pet,
      patientPimsId: pet.patientPimsId ?? linked.patientPimsId,
      patientId: pet.patientId ?? linked.patientInternalId,
    };
  });
}

/** Client eVet link — request payload first, then linked appointment. */
export function resolveClientPimsIdForRequestCard(
  requestData: Record<string, unknown>,
  fetchedByInternalId: ReadonlyMap<string, string>,
  linked: LinkedAppointmentEvetIds | null | undefined,
): string | null {
  return (
    resolveClientPimsIdForRequest(requestData, fetchedByInternalId) ??
    linked?.clientPimsId ??
    null
  );
}

export function linkedEvetIdsFromBookedApptSummary(
  summary:
    | {
        clientPimsId?: string | null;
        patientPimsId?: string | null;
        patientInternalId?: string | null;
        patientName?: string | null;
      }
    | null
    | undefined,
): LinkedAppointmentEvetIds | null {
  if (!summary) return null;
  if (!summary.clientPimsId && !summary.patientPimsId && !summary.patientInternalId) {
    return null;
  }
  return {
    clientPimsId: summary.clientPimsId ?? null,
    patientPimsId: summary.patientPimsId ?? null,
    patientInternalId: summary.patientInternalId ?? null,
    patientName: summary.patientName ?? null,
  };
}
