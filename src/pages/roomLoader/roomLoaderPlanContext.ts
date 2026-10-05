// src/pages/roomLoader/roomLoaderPlanContext.ts
// Adapts the public form payload into the shape the offer engine reasons over, so the
// engine stays free of Room Loader payload trivia and remains testable on its own.
import { DateTime } from 'luxon';
import type { TreatmentWithItems } from '../../api/treatments';
import {
  patientAgeMonths,
  type EngineContext,
  type EngineEstimateLine,
  type EngineHistoryEntry,
  type EngineReminderEntry,
} from '../../utils/roomLoaderOfferEngine';
import type { RoomLoaderItemType } from '../../utils/roomLoaderConfigTypes';
import { speciesSlug } from '../../utils/roomLoaderSpecies';

type AnyRecord = Record<string, any>;

/** Normalises the many spellings the PIMS sends for a species. */
export function normalizeSpecies(raw: unknown): string {
  return speciesSlug(raw);
}

/** Pulls `{ itemType, itemId, code }` out of a treatment line or estimate row. */
function itemRefOf(row: AnyRecord | null | undefined): {
  itemType: RoomLoaderItemType | null;
  itemId: number | null;
  code: string | null;
} {
  if (!row) return { itemType: null, itemId: null, code: null };
  if (row.lab) return { itemType: 'lab', itemId: Number(row.lab.id) || null, code: row.lab.code ?? null };
  if (row.procedure) {
    return { itemType: 'procedure', itemId: Number(row.procedure.id) || null, code: row.procedure.code ?? null };
  }
  if (row.inventoryItem) {
    return {
      itemType: 'inventory',
      itemId: Number(row.inventoryItem.id) || null,
      code: row.inventoryItem.code ?? null,
    };
  }
  // Staff-added lines carry the type inline rather than under a per-table key.
  const type = String(row.type ?? row.itemType ?? '').toLowerCase();
  const itemType: RoomLoaderItemType | null =
    type === 'lab' || type === 'procedure' || type === 'inventory' ? type : null;
  return { itemType, itemId: Number(row.id) || null, code: row.code ?? null };
}

/** Past services, with declines kept and flagged so re-offer timing can use them. */
export function historyFromTreatments(history: TreatmentWithItems[]): EngineHistoryEntry[] {
  const out: EngineHistoryEntry[] = [];
  for (const treatment of history ?? []) {
    if ((treatment as AnyRecord).isEstimate === true) continue;
    for (const item of treatment.treatmentItems ?? []) {
      if (item.isDeleted === true || item.isActive === false) continue;
      const ref = itemRefOf(item as AnyRecord);
      if (ref.itemId == null && !ref.code) continue;
      out.push({
        itemType: ref.itemType,
        itemId: ref.itemId,
        code: ref.code,
        date: item.serviceDate ?? null,
        declined: item.isDeclined === true,
      });
    }
  }
  return out;
}

/**
 * Outstanding reminders, used to skip asks the pet does not need yet.
 *
 * Two sources, because they cover different spans. `patient.reminders` is the estimate
 * snapshot staff sent, which the server caps at three months out — right for "what is due
 * at this visit", useless for "is this already booked for next year". `data.reminders` is
 * the list the server recomputes live for the client form and runs two years ahead, which
 * is the only one that can answer a `suppressIfReminderDueBeyondMonths` gate. Without it a
 * screening due in ten months looks like no reminder at all and gets offered again.
 */
export function remindersFromPatient(
  patient: AnyRecord | null | undefined,
  data?: AnyRecord | null | undefined,
  patientId?: number | null
): EngineReminderEntry[] {
  const out: EngineReminderEntry[] = [];
  const seenIds = new Set<number>();

  for (const reminder of patient?.reminders ?? []) {
    const ref = itemRefOf(reminder?.item);
    const due = reminder?.dueDate ?? reminder?.due ?? null;
    if (!due) continue;
    const id = Number(reminder?.reminderId ?? reminder?.id);
    if (Number.isFinite(id)) seenIds.add(id);
    out.push({ itemType: ref.itemType, itemId: ref.itemId, code: ref.code, dueDate: String(due) });
  }

  for (const row of data?.reminders ?? []) {
    const inner = row?.reminder;
    const due = inner?.dueDate ?? null;
    if (!due) continue;
    // The live list spans the whole household, so keep only this pet's rows.
    const rowPatientId = Number(inner?.patient?.id);
    if (patientId != null && Number.isFinite(rowPatientId) && rowPatientId !== patientId) continue;
    const id = Number(inner?.id);
    if (Number.isFinite(id) && seenIds.has(id)) continue;
    // Reminder text is matched to a catalog item server-side; unmatched rows gate nothing.
    const matchedId = Number(row?.matchedItem?.id);
    if (!Number.isFinite(matchedId) || matchedId <= 0) continue;
    const type = String(row?.itemType ?? '').toLowerCase();
    const itemType: RoomLoaderItemType | null =
      type === 'lab' || type === 'procedure' || type === 'inventory' ? type : null;
    if (Number.isFinite(id)) seenIds.add(id);
    out.push({
      itemType,
      itemId: matchedId,
      code: row?.matchedItem?.code ?? null,
      dueDate: String(due),
    });
  }

  return out;
}

/** Everything staff put on the estimate: matched reminders plus hand-added lines. */
export function estimateLinesFromPatient(
  patient: AnyRecord | null | undefined
): EngineEstimateLine[] {
  const out: EngineEstimateLine[] = [];
  for (const reminder of patient?.reminders ?? []) {
    const ref = itemRefOf(reminder?.item);
    if (ref.itemId == null && !ref.code) continue;
    out.push(ref);
  }
  for (const added of patient?.addedItems ?? []) {
    const ref = itemRefOf(added);
    if (ref.itemId == null && !ref.code) continue;
    out.push(ref);
  }
  return out;
}

/** The appointment row carrying species and date of birth for this pet. */
export function appointmentPatientFor(
  data: AnyRecord | null | undefined,
  patientId: number | null | undefined
): AnyRecord | null {
  if (patientId == null) return null;
  for (const appt of data?.appointments ?? []) {
    if (Number(appt?.patient?.id) === Number(patientId)) return appt.patient;
  }
  return null;
}

export type BuildPlanContextArgs = {
  /** The whole `GET /public/room-loader/form` payload. */
  data: AnyRecord | null | undefined;
  /** One entry of `data.patients`. */
  patient: AnyRecord | null | undefined;
  /** `pet0`, `pet1`, … */
  petKey: string;
  formData: AnyRecord;
  /** Treatment history for this pet, keyed by patient id by the caller. */
  history: TreatmentWithItems[];
  asOf?: DateTime;
};

/**
 * Builds the engine's view of one pet. Answers the client has not given yet stay null so
 * gated questions simply do not render rather than resolving to a wrong default.
 */
export function buildPlanContext({
  data,
  patient,
  petKey,
  formData,
  history,
  asOf,
}: BuildPlanContextArgs): EngineContext {
  const patientId = Number(patient?.patientId ?? patient?.id) || null;
  const apptPatient = appointmentPatientFor(data, patientId);
  const species = normalizeSpecies(apptPatient?.species ?? patient?.species);
  const dob = apptPatient?.dob ?? patient?.dob ?? patient?.birthdate ?? null;

  const rawOutdoor = String(formData?.[`${petKey}_outdoorAccess`] ?? '');
  const outdoorAccess = rawOutdoor === 'yes' ? true : rawOutdoor === 'no' ? false : null;

  const medicalConcern =
    String(formData?.[`${petKey}_labWork`] ?? '') === 'yes' ||
    patient?.questions?.labWork === true;

  return {
    species,
    ageMonths: patientAgeMonths(dob, asOf ?? DateTime.now()),
    history: historyFromTreatments(history),
    reminders: remindersFromPatient(patient, data, patientId),
    estimateLines: estimateLinesFromPatient(patient),
    outdoorAccess,
    medicalConcern,
    asOf,
  };
}
