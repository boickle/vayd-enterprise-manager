import type { AppointmentType } from '../api/appointmentSettings';
import { requestDataPetRowSummaries } from './appointmentRequestDetailDisplay';
import type { RoutingAppointmentRequestIntentV1 } from './routingAppointmentRequestIntent';
import type { RoutingPatientChipRow } from './routingPatientSelection';
import type { RoutingVisitPetInput } from './routingServiceMinutes';
import { appointmentTypeForRoutingStatsKey } from './routingCalculateTimeType';
import {
  buildAppointmentRequestPetStaffInstructions,
  type AppointmentRequestPetEuthNotes,
} from './appointmentRequestPetStaffNotes';

export function appointmentRequestUsesPerPetRouting(
  intent: RoutingAppointmentRequestIntentV1 | null | undefined,
): boolean {
  return (intent?.pets?.length ?? 0) > 0;
}

export function appointmentRequestSyntheticPatientId(
  submissionId: number,
  index: number,
): string {
  return `ar:${submissionId}:${index}`;
}

export function resolveAppointmentRequestPetTypeId(
  pet: { appointmentType?: string | null; appointmentTypeId?: number | null },
  types: readonly AppointmentType[],
): number | null {
  const rawId = pet.appointmentTypeId;
  if (rawId != null && Number.isFinite(Number(rawId)) && Number(rawId) > 0) {
    return Number(rawId);
  }
  const label = pet.appointmentType?.trim();
  if (!label) return null;
  const matched = appointmentTypeForRoutingStatsKey(label, types);
  return matched?.id != null && Number(matched.id) > 0 ? Number(matched.id) : null;
}

/** Patient chips for routing — real chart ids when known, else stable synthetic ids. */
export function appointmentRequestRoutingPatientChips(
  intent: RoutingAppointmentRequestIntentV1,
): RoutingPatientChipRow[] {
  return (intent.pets ?? []).map((pet, index) => ({
    id:
      pet.patientId?.trim() ||
      appointmentRequestSyntheticPatientId(intent.appointmentRequestSubmissionId, index),
    name: pet.name.trim() || `Pet ${index + 1}`,
  }));
}

export function buildRoutingVisitPetsFromAppointmentRequestIntent(
  intent: RoutingAppointmentRequestIntentV1,
  opts: {
    selectedPatientIds?: readonly string[];
    appointmentTypes: readonly AppointmentType[];
  },
): RoutingVisitPetInput[] {
  const pets = intent.pets ?? [];
  if (pets.length === 0) return [];

  const selected = new Set((opts.selectedPatientIds ?? []).map(String));
  const filterBySelection = selected.size > 0;
  const chips = appointmentRequestRoutingPatientChips(intent);

  const visitPets: RoutingVisitPetInput[] = [];
  for (let i = 0; i < pets.length; i++) {
    const pet = pets[i]!;
    const chipId = String(chips[i]!.id);
    if (filterBySelection) {
      const altIds = [pet.patientId, chipId].filter(Boolean).map(String);
      if (!altIds.some((id) => selected.has(id))) continue;
    }
    const typeId = resolveAppointmentRequestPetTypeId(pet, opts.appointmentTypes);
    if (typeId == null) continue;
    visitPets.push({
      appointmentTypeId: typeId,
      isNewPatient: !pet.patientPimsId?.trim(),
    });
  }
  return visitPets;
}

export type AppointmentRequestBookPetSource = {
  name: string;
  appointmentType: string | null;
  appointmentTypeId?: number | null;
  patientId?: string | null;
  patientPimsId?: string | null;
  clientDetails?: string | null;
  euthNotes?: AppointmentRequestPetEuthNotes;
};

export function buildAppointmentRequestBookInstructionsForPet(
  pet: AppointmentRequestBookPetSource,
  globalNotes?: string | null,
  requestData?: Record<string, unknown>,
): string {
  return buildAppointmentRequestPetStaffInstructions({
    appointmentType: pet.appointmentType,
    clientDetails: pet.clientDetails,
    globalNotes,
    ...(requestData ? { requestData, allowTopLevelFallback: true } : {}),
  });
}

export type AppointmentRequestBookVisitPatch = {
  patientId: string;
  patientName: string;
  appointmentTypeId: number;
  description: string;
  instructions: string;
};

function buildPatchesFromPetSources(
  submissionId: number,
  pets: AppointmentRequestBookPetSource[],
  selectedPatientIds: readonly string[],
  appointmentTypes: readonly AppointmentType[],
  globalDescription?: string | null,
  requestData?: Record<string, unknown>,
): AppointmentRequestBookVisitPatch[] {
  const chips = pets.map((pet, index) => ({
    id: pet.patientId?.trim() || appointmentRequestSyntheticPatientId(submissionId, index),
    name: pet.name.trim() || `Pet ${index + 1}`,
  }));
  const selected = new Set(selectedPatientIds.map(String));
  const filterBySelection = selected.size > 0;
  const patches: AppointmentRequestBookVisitPatch[] = [];

  for (let i = 0; i < pets.length; i++) {
    const pet = pets[i]!;
    const chip = chips[i]!;
    const chipId = String(chip.id);
    if (filterBySelection) {
      const altIds = [pet.patientId, chipId].filter(Boolean).map(String);
      if (!altIds.some((id) => selected.has(id))) continue;
    }
    const typeId = resolveAppointmentRequestPetTypeId(pet, appointmentTypes);
    if (typeId == null) continue;
    const instructions = buildAppointmentRequestBookInstructionsForPet(
      pet,
      globalDescription,
      requestData,
    );
    patches.push({
      patientId: pet.patientId?.trim() || chipId,
      patientName: chip.name,
      appointmentTypeId: typeId,
      description: globalDescription?.trim() || pet.clientDetails?.trim() || '',
      instructions,
    });
  }
  return patches;
}

export function buildAppointmentRequestBookVisitPatchesFromRequestData(
  submissionId: number,
  requestData: Record<string, unknown>,
  selectedPatientIds: readonly string[],
  appointmentTypes: readonly AppointmentType[],
  globalDescription?: string | null,
): AppointmentRequestBookVisitPatch[] {
  const pets: AppointmentRequestBookPetSource[] = requestDataPetRowSummaries(requestData).map(
    (row) => ({
      name: row.name,
      appointmentType: row.appointmentType,
      appointmentTypeId: row.appointmentTypeId,
      patientId: row.patientId,
      patientPimsId: row.patientPimsId,
      clientDetails: row.clientDetails,
      euthNotes: row.euthNotes,
    }),
  );
  return buildPatchesFromPetSources(
    submissionId,
    pets,
    selectedPatientIds,
    appointmentTypes,
    globalDescription,
    requestData,
  );
}

export function buildAppointmentRequestBookVisitPatches(
  intent: RoutingAppointmentRequestIntentV1,
  selectedPatientIds: readonly string[],
  appointmentTypes: readonly AppointmentType[],
  globalDescription?: string | null,
  requestData?: Record<string, unknown>,
): AppointmentRequestBookVisitPatch[] {
  const pets: AppointmentRequestBookPetSource[] = (intent.pets ?? []).map((pet) => ({
    name: pet.name,
    appointmentType: pet.appointmentType,
    appointmentTypeId: pet.appointmentTypeId,
    patientId: pet.patientId,
    patientPimsId: pet.patientPimsId,
    clientDetails: pet.clientDetails,
  }));
  return buildPatchesFromPetSources(
    intent.appointmentRequestSubmissionId,
    pets,
    selectedPatientIds,
    appointmentTypes,
    globalDescription ?? intent.description,
    requestData,
  );
}