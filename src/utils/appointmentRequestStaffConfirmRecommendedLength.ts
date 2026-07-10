import type { AppointmentType } from '../api/appointmentSettings';
import { fetchRoutingServiceMinutes, type RoutingServiceMinutesResponse } from '../api/publicAppointments';
import type { Provider } from '../api/employee';
import type { Appointment } from '../api/roomLoader';
import {
  requestDataAppointmentTypeForRouting,
  requestDataAppointmentTypeLabel,
  requestDataClientType,
  requestDataPreferredDoctor,
  requestDataServiceMinutes,
} from './appointmentRequestDisplay';
import {
  requestDataPetRowSummaries,
  type AppointmentRequestPetRowSummary,
} from './appointmentRequestDetailDisplay';
import { opsPointsForAppointment } from './forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import {
  buildRoutingVisitPetsFromFormData,
  estimateRoutingServiceMinutesForVisit,
  newPatientDurationBufferMinutes,
  ROUTING_ADDITIONAL_NEW_PATIENT_DURATION_BUFFER_MINUTES,
  ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES,
  routingVisitNewPatientCount,
  routingVisitPetCount,
  type RoutingVisitPetInput,
} from './routingServiceMinutes';
import { appointmentTypeForRoutingStatsKey } from './routingCalculateTimeType';
import { appointmentRequestPetNameForVisit } from './appointmentRequestStaffConfirmApplyTypes';
import { providerLabel } from './schedulerVisitDisplay';

export type StaffConfirmBookingBreakdownPet = {
  key: string;
  name: string;
  appointmentType: string;
  isNewPatient: boolean;
  baseMinutes: number | null;
};

/** One explainable duration (original request or current calendar types). */
export type StaffConfirmDurationBreakdown = {
  bookedMinutes: number;
  baseMinutes: number;
  newPatientBufferMinutes: number;
  newPatientCount: number;
  isNewClient: boolean;
  pets: StaffConfirmBookingBreakdownPet[];
  typesLabel?: string;
  calendarStillHold?: boolean;
  /** Recommended block uses owner-requested types while calendar rows are still hold. */
  usesRequestedTypes?: boolean;
};

/** How the booked slot relates to the online request and current calendar types. */
export type StaffConfirmBookingBreakdown = {
  /** Length of the calendar slot (start–end). */
  bookedSlotMinutes: number;
  /** What the owner booked online. */
  original: StaffConfirmDurationBreakdown;
  /** When visit types on the calendar differ from the request (e.g. after Edit). */
  recommended?: StaffConfirmDurationBreakdown;
};

export type StaffConfirmRecommendedLength = {
  minutes: number;
  typesLabel: string;
  doctorLabel?: string;
  newPatientBufferMinutes?: number;
  newPatientCount?: number;
  /** Owner-requested visit types (when calendar rows are still hold). */
  bookedTypesLabel?: string | null;
  /** True when the calendar slot duration reflects the online request, not hold types. */
  bookedFromOwnerRequest?: boolean;
  bookingBreakdown?: StaffConfirmBookingBreakdown;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function appointmentTypeIdFromAppt(
  appt: Appointment,
  appointmentTypes?: readonly AppointmentType[],
): number | null {
  const fromObj = appt.appointmentType?.id;
  if (fromObj != null && Number.isFinite(Number(fromObj)) && Number(fromObj) > 0) {
    return Number(fromObj);
  }
  const raw = (appt as { appointmentTypeId?: number }).appointmentTypeId;
  if (raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0) return Number(raw);

  const label = appointmentTypeLabelFromAppt(appt);
  if (label && appointmentTypes && appointmentTypes.length > 0) {
    const matched = appointmentTypeForRoutingStatsKey(label, appointmentTypes);
    if (matched?.id != null && Number(matched.id) > 0) return Number(matched.id);
  }
  return null;
}

function appointmentTypeLabelFromAppt(appt: Appointment): string | null {
  return (
    appt.appointmentType?.prettyName?.trim() ||
    appt.appointmentType?.name?.trim() ||
    null
  );
}

function isNewPatientRequestFromRequestData(requestData: Record<string, unknown>): boolean {
  const clientType = requestDataClientType(requestData);
  if (clientType === 'new') return true;
  if (clientType === 'existing') return false;
  const used = requestData.haveUsedServicesBefore;
  if (used === 'No') return true;
  if (used === 'Yes') return false;
  return false;
}

function primaryAppointmentTypeIdFromRequestData(
  requestData: Record<string, unknown>,
): number | undefined {
  const petIds = [
    ...(Array.isArray(requestData.selectedPetIds)
      ? (requestData.selectedPetIds as unknown[])
      : []),
    ...(Array.isArray(requestData.newClientPets)
      ? (requestData.newClientPets as { id?: string }[]).map((p) => p.id)
      : []),
    ...(Array.isArray(requestData.existingClientNewPets)
      ? (requestData.existingClientNewPets as { id?: string }[]).map((p) => p.id)
      : []),
  ];
  const psd = requestData.petSpecificData;
  if (psd && typeof psd === 'object') {
    for (const petId of petIds) {
      const raw = (psd as Record<string, unknown>)[String(petId)];
      if (!raw || typeof raw !== 'object') continue;
      const typeId = (raw as { appointmentTypeId?: unknown }).appointmentTypeId;
      if (typeId != null && Number.isFinite(Number(typeId)) && Number(typeId) > 0) {
        return Number(typeId);
      }
    }
  }
  return undefined;
}

function resolveTypeIdForPetRow(
  pet: AppointmentRequestPetRowSummary,
  appointmentTypes: readonly AppointmentType[],
  primaryTypeId?: number,
): number | null {
  if (pet.appointmentTypeId != null && pet.appointmentTypeId > 0) {
    return pet.appointmentTypeId;
  }
  const label = pet.appointmentType?.trim();
  if (label) {
    const matched = appointmentTypeForRoutingStatsKey(label, appointmentTypes);
    if (matched?.id != null && Number(matched.id) > 0) return Number(matched.id);
  }
  return primaryTypeId != null && primaryTypeId > 0 ? primaryTypeId : null;
}

/** Calendar rows for routing when staff has not yet changed types via Edit. */
function buildVisitPetsFromCalendarAppts(
  appts: readonly Appointment[],
  isNewPatient: boolean,
  appointmentTypes: readonly AppointmentType[],
): RoutingVisitPetInput[] {
  const out: RoutingVisitPetInput[] = [];
  for (const appt of appts) {
    const typeId = appointmentTypeIdFromAppt(appt, appointmentTypes);
    if (typeId == null) continue;
    out.push({ appointmentTypeId: typeId, isNewPatient });
  }
  return out;
}

function buildVisitPetsFromRequestData(
  requestData: Record<string, unknown>,
  appointmentTypes: readonly AppointmentType[],
  isNewPatient: boolean,
): RoutingVisitPetInput[] {
  const primaryTypeId = primaryAppointmentTypeIdFromRequestData(requestData);

  const fromForm = buildRoutingVisitPetsFromFormData(
    {
      selectedPetIds: Array.isArray(requestData.selectedPetIds)
        ? (requestData.selectedPetIds as string[])
        : undefined,
      newClientPets: Array.isArray(requestData.newClientPets)
        ? (requestData.newClientPets as { id?: string }[])
        : undefined,
      existingClientNewPets: Array.isArray(requestData.existingClientNewPets)
        ? (requestData.existingClientNewPets as { id?: string }[])
        : undefined,
      petSpecificData:
        requestData.petSpecificData && typeof requestData.petSpecificData === 'object'
          ? (requestData.petSpecificData as Record<
              string,
              { appointmentTypeId?: number } | undefined
            >)
          : undefined,
    },
    {
      isNewPatientRequest: isNewPatient,
      primaryAppointmentTypeId: primaryTypeId,
    },
  );
  if (fromForm.length > 0) return fromForm;

  const visitPets: RoutingVisitPetInput[] = [];
  for (const pet of requestDataPetRowSummaries(requestData)) {
    const typeId = resolveTypeIdForPetRow(pet, appointmentTypes, primaryTypeId);
    if (typeId == null) continue;
    visitPets.push({
      appointmentTypeId: typeId,
      isNewPatient: isNewPatient || !pet.patientId,
    });
  }
  if (visitPets.length > 0) return visitPets;

  const fromRouting = requestDataAppointmentTypeForRouting(requestData);
  const resolvedId =
    fromRouting.typeId ??
    (fromRouting.label
      ? appointmentTypeForRoutingStatsKey(fromRouting.label, appointmentTypes)?.id
      : null) ??
    primaryTypeId;
  if (resolvedId != null && Number(resolvedId) > 0) {
    return [{ appointmentTypeId: Number(resolvedId), isNewPatient }];
  }

  return [];
}

function resolveProviderFromDoctorName(
  selectedDoctor: string,
  providerList: readonly Pick<Provider, 'id' | 'name' | 'pimsId'>[],
): Pick<Provider, 'id' | 'name' | 'pimsId'> | null {
  const doctorName = selectedDoctor.replace(/^Dr\.?\s*/i, '').trim();
  let doctor =
    providerList.find(
      (p) =>
        p.name === doctorName ||
        `Dr. ${p.name}` === selectedDoctor ||
        p.name === selectedDoctor,
    ) ?? null;
  if (!doctor) {
    doctor =
      providerList.find(
        (p) =>
          p.name.toLowerCase().includes(doctorName.toLowerCase()) ||
          doctorName.toLowerCase().includes(p.name.toLowerCase()),
      ) ?? null;
  }
  return doctor;
}

function resolveStaffConfirmRoutingDoctorId(
  requestData: Record<string, unknown>,
  appt: Appointment | null | undefined,
  providers: readonly Provider[],
): string | number | null {
  const assigneeId = appt?.primaryProvider?.id;
  if (assigneeId != null && Number.isFinite(Number(assigneeId)) && Number(assigneeId) > 0) {
    return assigneeId;
  }

  const slot = requestData.selfScheduledSlot;
  if (slot && typeof slot === 'object') {
    const doctorId = (slot as { doctorId?: unknown }).doctorId;
    if (doctorId != null && String(doctorId).trim()) return doctorId as string | number;
  }

  const preferred = requestDataPreferredDoctor(requestData);
  if (preferred && providers.length > 0) {
    const match = resolveProviderFromDoctorName(preferred, providers);
    if (match?.id != null) return match.id;
    if (match?.pimsId != null) return match.pimsId;
  }

  return null;
}

/** Short label for confirm copy — e.g. "Dr. Messina". */
export function formatStaffConfirmDoctorLabel(rawName: string | null | undefined): string | null {
  const name = (rawName ?? '').trim();
  if (!name) return null;
  const stripped = name.replace(/^Dr\.?\s*/i, '').trim();
  const withoutCred = stripped
    .replace(/,?\s*(D\.?\s*V\.?\s*M\.?|VMD)\s*$/i, '')
    .trim();
  const lastName = withoutCred.split(/\s+/).filter(Boolean).pop() ?? withoutCred;
  return lastName ? `Dr. ${lastName}` : name;
}

function resolveStaffConfirmDoctorDisplayName(
  requestData: Record<string, unknown>,
  appt: Appointment | null | undefined,
  providers: readonly Provider[],
  householdAppts?: readonly Appointment[],
): string | null {
  const apptsToCheck =
    householdAppts && householdAppts.length > 0
      ? householdAppts
      : appt
        ? [appt]
        : [];
  for (const row of apptsToCheck) {
    const fromAppt = providerLabel(row?.primaryProvider);
    if (fromAppt && fromAppt !== '—') return fromAppt;

    const assigneeId = row?.primaryProvider?.id;
    if (assigneeId != null) {
      const match = providers.find(
        (p) =>
          String(p.id) === String(assigneeId) ||
          (p.pimsId != null && String(p.pimsId) === String(assigneeId)),
      );
      if (match?.name) return match.name;
    }
  }

  const slot = requestData.selfScheduledSlot;
  if (slot && typeof slot === 'object') {
    const doctorId = (slot as { doctorId?: unknown }).doctorId;
    if (doctorId != null && providers.length > 0) {
      const match = providers.find(
        (p) =>
          String(p.id) === String(doctorId) ||
          (p.pimsId != null && String(p.pimsId) === String(doctorId)),
      );
      if (match?.name) return match.name;
    }
    const fromSlot = pickStr((slot as { doctorName?: unknown }).doctorName);
    if (fromSlot) return fromSlot;
  }

  const preferred = requestDataPreferredDoctor(requestData);
  if (preferred) return preferred;

  return null;
}

function appointmentTypeLabelForId(
  typeId: number,
  appointmentTypes: readonly AppointmentType[],
  requestData: Record<string, unknown>,
): string {
  const fromCatalog =
    appointmentTypes.find((t) => Number(t.id) === Number(typeId))?.prettyName?.trim() ||
    appointmentTypes.find((t) => Number(t.id) === Number(typeId))?.name?.trim();
  if (fromCatalog) return fromCatalog;

  for (const pet of requestDataPetRowSummaries(requestData)) {
    if (pet.appointmentTypeId === typeId && pet.appointmentType?.trim()) {
      return pet.appointmentType.trim();
    }
  }

  return 'appointment';
}

function formatTypesLabelFromCalendarAppts(appts: readonly Appointment[]): string | null {
  if (appts.length === 0) return null;
  const counts = new Map<string, number>();
  for (const appt of appts) {
    const label = appointmentTypeLabelFromAppt(appt) || 'appointment';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${count} ${label}`);
  const summary = parts.join(' and ');
  return appts.length > 1 ? `${summary} (multi-pet)` : summary;
}

function formatTypesLabelFromPetRows(
  petRows: AppointmentRequestPetRowSummary[],
  multiPetSuffix: boolean,
): string | null {
  if (petRows.length === 0) return null;
  const counts = new Map<string, number>();
  for (const pet of petRows) {
    const label = pet.appointmentType?.trim() || 'appointment';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${count} ${label}`);
  const summary = parts.join(' and ');
  return multiPetSuffix ? `${summary} (multi-pet)` : summary;
}

/** Prefer owner-requested visit types from the online form (not calendar hold rows). */
function formatTypesLabelFromRequestData(
  requestData: Record<string, unknown>,
): string | null {
  const petRows = requestDataPetRowSummaries(requestData).filter((p) =>
    Boolean(p.appointmentType?.trim()),
  );
  if (petRows.length > 0) {
    return formatTypesLabelFromPetRows(petRows, petRows.length > 1);
  }
  const topLevel = requestDataAppointmentTypeLabel(requestData);
  if (topLevel) return `1 ${topLevel}`;
  return null;
}

function calendarApptsStillOnHold(
  appts: readonly Appointment[],
  catalog: AppointmentTypeCatalog,
): boolean {
  if (appts.length === 0) return false;
  const byPoints = appts.every((appt) => opsPointsForAppointment(appt, catalog) <= 0);
  if (byPoints) return true;
  return appts.every((appt) => {
    const label = appointmentTypeLabelFromAppt(appt)?.toLowerCase() ?? '';
    return label === 'hold' || label.includes('hold for');
  });
}

function formatStaffConfirmVisitTypesLabel(
  visitPets: readonly RoutingVisitPetInput[],
  appointmentTypes: readonly AppointmentType[],
  requestData: Record<string, unknown>,
  calendarAppts: readonly Appointment[],
): string | null {
  const fromCalendar = formatTypesLabelFromCalendarAppts(calendarAppts);
  if (fromCalendar) return fromCalendar;

  if (visitPets.length > 0) {
    const counts = new Map<number, number>();
    for (const pet of visitPets) {
      counts.set(pet.appointmentTypeId, (counts.get(pet.appointmentTypeId) ?? 0) + 1);
    }

    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([typeId, count]) => {
        const label = appointmentTypeLabelForId(typeId, appointmentTypes, requestData);
        return `${count} ${label}`;
      });

    const summary = parts.join(' and ');
    return visitPets.length > 1 ? `${summary} (multi-pet)` : summary;
  }

  const petRows = requestDataPetRowSummaries(requestData).filter((p) =>
    Boolean(p.appointmentType?.trim()),
  );
  if (petRows.length > 0) {
    return formatTypesLabelFromPetRows(petRows, petRows.length > 1);
  }

  const topLevel = requestDataAppointmentTypeLabel(requestData);
  if (topLevel) return `1 ${topLevel}`;

  const singleAppt = calendarAppts[0];
  const fromAppt = singleAppt ? appointmentTypeLabelFromAppt(singleAppt) : null;
  if (fromAppt) return `1 ${fromAppt}`;

  return null;
}

function requestDataStoredServiceMinutes(requestData: Record<string, unknown>): number | null {
  const topLevel = requestDataServiceMinutes(requestData);
  if (topLevel != null) return topLevel;
  const slot = requestData.selfScheduledSlot;
  if (slot && typeof slot === 'object') {
    const raw = (slot as { serviceMinutes?: unknown }).serviceMinutes;
    if (raw != null && Number.isFinite(Number(raw))) {
      return Math.max(15, Math.round(Number(raw)));
    }
  }
  return null;
}

function resolveStaffConfirmNewPatientCount(
  visitPets: readonly RoutingVisitPetInput[],
  requestData: Record<string, unknown>,
  isNewPatient: boolean,
): number {
  const fromRequest = routingVisitNewPatientCount({
    isNewPatientRequest: isNewPatient,
    selectedPetIds: Array.isArray(requestData.selectedPetIds)
      ? (requestData.selectedPetIds as string[])
      : undefined,
    newClientPets: Array.isArray(requestData.newClientPets)
      ? (requestData.newClientPets as unknown[])
      : undefined,
    existingClientNewPets: Array.isArray(requestData.existingClientNewPets)
      ? (requestData.existingClientNewPets as unknown[])
      : undefined,
  });
  const numPets = Math.max(
    visitPets.length,
    routingVisitPetCount({
      selectedPetIds: Array.isArray(requestData.selectedPetIds)
        ? (requestData.selectedPetIds as string[])
        : undefined,
      newClientPets: Array.isArray(requestData.newClientPets)
        ? (requestData.newClientPets as unknown[])
        : undefined,
      existingClientNewPets: Array.isArray(requestData.existingClientNewPets)
        ? (requestData.existingClientNewPets as unknown[])
        : undefined,
    }),
  );
  if (isNewPatient) return Math.max(fromRequest, numPets);
  if (fromRequest > 0) return fromRequest;
  return visitPets.filter((pet) => pet.isNewPatient).length;
}

function buildBreakdownPetsFromRequest(
  requestData: Record<string, unknown>,
  isNewClient: boolean,
): StaffConfirmBookingBreakdownPet[] {
  return requestDataPetRowSummaries(requestData).map((pet) => ({
    key: pet.key,
    name: pet.name,
    appointmentType: pet.appointmentType?.trim() || 'appointment',
    isNewPatient: isNewClient || !pet.patientId,
    baseMinutes: null,
  }));
}

function buildBreakdownPetsFromCalendarAppts(
  calendarAppts: readonly Appointment[],
  requestData: Record<string, unknown>,
  isNewClient: boolean,
): StaffConfirmBookingBreakdownPet[] {
  const sorted = [...calendarAppts].sort(
    (a, b) =>
      Number(a.id) - Number(b.id) ||
      String(a.appointmentStart).localeCompare(String(b.appointmentStart)),
  );
  return sorted.map((appt, index) => ({
    key: String(appt.id),
    name: appointmentRequestPetNameForVisit(appt, requestData) ?? `Pet ${index + 1}`,
    appointmentType: appointmentTypeLabelFromAppt(appt) ?? 'appointment',
    isNewPatient: isNewClient,
    baseMinutes: null,
  }));
}

function visitPetsTypeSignature(pets: readonly RoutingVisitPetInput[]): string {
  return pets
    .map((p) => p.appointmentTypeId)
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b)
    .join(',');
}

function calendarVisitTypesDifferFromRequest(
  calendarVisitPets: readonly RoutingVisitPetInput[],
  requestVisitPets: readonly RoutingVisitPetInput[],
): boolean {
  if (calendarVisitPets.length === 0) return false;
  if (requestVisitPets.length === 0) return true;
  return visitPetsTypeSignature(calendarVisitPets) !== visitPetsTypeSignature(requestVisitPets);
}

function estimateRoutingForVisitPets(
  visitPets: RoutingVisitPetInput[],
  requestData: Record<string, unknown>,
  appointmentTypes: readonly AppointmentType[],
  isNewPatient: boolean,
): {
  minutes: number;
  baseMinutes: number;
  newPatientBufferMinutes: number;
  newPatientCount: number;
} | null {
  if (visitPets.length === 0) return null;

  const newPatientCount = resolveStaffConfirmNewPatientCount(visitPets, requestData, isNewPatient);
  const bufferMinutes = newPatientDurationBufferMinutes(newPatientCount);
  const numPets = Math.max(
    visitPets.length,
    routingVisitPetCount({
      selectedPetIds: Array.isArray(requestData.selectedPetIds)
        ? (requestData.selectedPetIds as string[])
        : undefined,
      newClientPets: Array.isArray(requestData.newClientPets)
        ? (requestData.newClientPets as unknown[])
        : undefined,
      existingClientNewPets: Array.isArray(requestData.existingClientNewPets)
        ? (requestData.existingClientNewPets as unknown[])
        : undefined,
    }),
  );

  const routingEstimate = estimateRoutingServiceMinutesForVisit(
    visitPets,
    [],
    (id) => appointmentTypes.find((type) => Number(type.id) === Number(id)),
    (key) => appointmentTypeForRoutingStatsKey(key, appointmentTypes),
    { newPatientCount, numPets },
  );

  return {
    minutes: routingEstimate.serviceMinutes,
    baseMinutes: routingEstimate.baseMinutes,
    newPatientBufferMinutes: bufferMinutes,
    newPatientCount,
  };
}

function buildStaffConfirmBookingBreakdown(args: {
  requestData: Record<string, unknown>;
  calendarAppts: readonly Appointment[];
  appointmentTypes: readonly AppointmentType[];
  appointmentTypeCatalog: AppointmentTypeCatalog;
  isNewClient?: boolean;
  requestVisitPets: readonly RoutingVisitPetInput[];
  calendarVisitPets: readonly RoutingVisitPetInput[];
}): StaffConfirmBookingBreakdown | null {
  const requestData = args.requestData ?? {};
  const petRows = requestDataPetRowSummaries(requestData);
  if (petRows.length === 0 && args.calendarAppts.length === 0) return null;

  const isNewClient =
    args.isNewClient === true || isNewPatientRequestFromRequestData(requestData);
  const stillOnHold = calendarApptsStillOnHold(args.calendarAppts, args.appointmentTypeCatalog);
  const bookedSlotMinutes =
    bookedMinutesFromCalendarAppts(args.calendarAppts) ??
    requestDataStoredServiceMinutes(requestData) ??
    0;

  const originalStored = requestDataStoredServiceMinutes(requestData);
  const originalEstimate = estimateRoutingForVisitPets(
    args.requestVisitPets.length > 0 ? [...args.requestVisitPets] : [],
    requestData,
    args.appointmentTypes,
    isNewClient,
  );
  const originalBuffer = newPatientDurationBufferMinutes(
    Math.max(
      resolveStaffConfirmNewPatientCount(args.requestVisitPets, requestData, isNewClient),
      isNewClient ? petRows.length : 0,
    ),
  );
  // Prefer routing estimate (requested types + buffers) over form-stored minutes.
  // selfScheduledSlot.serviceMinutes is a snapshot from slot pick and may use catalog
  // defaults rather than this doctor's stats — do not derive "Visit time" from it.
  const originalMinutes =
    originalEstimate?.minutes ??
    bookedSlotMinutes ??
    originalStored ??
    0;
  const originalBase =
    originalEstimate?.baseMinutes ??
    Math.max(
      0,
      originalMinutes - (originalEstimate?.newPatientBufferMinutes ?? originalBuffer),
    );

  const original: StaffConfirmDurationBreakdown = {
    bookedMinutes: originalMinutes,
    baseMinutes: originalBase,
    newPatientBufferMinutes: originalEstimate?.newPatientBufferMinutes ?? originalBuffer,
    newPatientCount:
      originalEstimate?.newPatientCount ??
      Math.max(
        resolveStaffConfirmNewPatientCount(args.requestVisitPets, requestData, isNewClient),
        isNewClient ? petRows.length : 0,
      ),
    isNewClient,
    pets:
      petRows.length > 0
        ? buildBreakdownPetsFromRequest(requestData, isNewClient)
        : buildBreakdownPetsFromCalendarAppts(args.calendarAppts, requestData, isNewClient),
    typesLabel:
      formatTypesLabelFromRequestData(requestData) ??
      formatTypesLabelFromCalendarAppts(args.calendarAppts) ??
      undefined,
    calendarStillHold: stillOnHold,
  };

  const typesChanged = calendarVisitTypesDifferFromRequest(
    args.calendarVisitPets,
    args.requestVisitPets,
  );
  const showRecommended =
    args.calendarVisitPets.length > 0 && (!stillOnHold || typesChanged);

  let recommended: StaffConfirmDurationBreakdown | undefined;
  if (showRecommended) {
    const useRequestTypesForRecommended = stillOnHold && args.requestVisitPets.length > 0;
    const recommendedVisitPets = useRequestTypesForRecommended
      ? [...args.requestVisitPets]
      : [...args.calendarVisitPets];
    const recEstimate = estimateRoutingForVisitPets(
      recommendedVisitPets,
      requestData,
      args.appointmentTypes,
      isNewClient,
    );
    if (recEstimate) {
      recommended = {
        bookedMinutes: recEstimate.minutes,
        baseMinutes: recEstimate.baseMinutes,
        newPatientBufferMinutes: recEstimate.newPatientBufferMinutes,
        newPatientCount: recEstimate.newPatientCount,
        isNewClient,
        pets: useRequestTypesForRecommended
          ? buildBreakdownPetsFromRequest(requestData, isNewClient)
          : buildBreakdownPetsFromCalendarAppts(args.calendarAppts, requestData, isNewClient),
        typesLabel: useRequestTypesForRecommended
          ? formatTypesLabelFromRequestData(requestData) ?? undefined
          : formatTypesLabelFromCalendarAppts(args.calendarAppts) ?? undefined,
        calendarStillHold: stillOnHold,
        usesRequestedTypes: useRequestTypesForRecommended,
      };
    }
  }

  return {
    bookedSlotMinutes,
    original,
    recommended,
  };
}

function estimateServiceMinutesWithBuffers(
  visitPets: RoutingVisitPetInput[],
  requestData: Record<string, unknown>,
  appointmentTypes: readonly AppointmentType[],
  isNewPatient: boolean,
): {
  minutes: number;
  baseMinutes: number;
  newPatientBufferMinutes: number;
  newPatientCount: number;
} | null {
  const newPatientCount = resolveStaffConfirmNewPatientCount(visitPets, requestData, isNewPatient);
  const bufferMinutes = newPatientDurationBufferMinutes(newPatientCount);
  const stored = requestDataStoredServiceMinutes(requestData);

  const numPets = Math.max(
    visitPets.length,
    routingVisitPetCount({
      selectedPetIds: Array.isArray(requestData.selectedPetIds)
        ? (requestData.selectedPetIds as string[])
        : undefined,
      newClientPets: Array.isArray(requestData.newClientPets)
        ? (requestData.newClientPets as unknown[])
        : undefined,
      existingClientNewPets: Array.isArray(requestData.existingClientNewPets)
        ? (requestData.existingClientNewPets as unknown[])
        : undefined,
    }),
  );

  const routingEstimate =
    visitPets.length > 0
      ? estimateRoutingServiceMinutesForVisit(
          visitPets,
          [],
          (id) => appointmentTypes.find((type) => Number(type.id) === Number(id)),
          (key) => appointmentTypeForRoutingStatsKey(key, appointmentTypes),
          { newPatientCount, numPets },
        )
      : null;

  if (stored != null) {
    const baseMinutes = Math.max(0, stored - bufferMinutes);
    return {
      minutes: stored,
      baseMinutes,
      newPatientBufferMinutes: bufferMinutes,
      newPatientCount,
    };
  }

  if (!routingEstimate) return null;

  return {
    minutes: routingEstimate.serviceMinutes,
    baseMinutes: routingEstimate.baseMinutes,
    newPatientBufferMinutes: bufferMinutes,
    newPatientCount,
  };
}

/** Calendar duration for household visits — count each distinct start/end window once (multi-pet rows share one slot). */
function bookedMinutesFromCalendarAppts(appts: readonly Appointment[]): number | null {
  if (appts.length === 0) return null;

  const slotMinutes = new Map<string, number>();
  for (const appt of appts) {
    const startIso = appt.appointmentStart;
    const endIso = appt.appointmentEnd;
    if (!startIso || !endIso) continue;
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const mins = Math.round((endMs - startMs) / 60_000);
    if (mins <= 0) continue;
    slotMinutes.set(`${startMs}|${endMs}`, mins);
  }

  if (slotMinutes.size === 0) return null;
  let total = 0;
  for (const mins of slotMinutes.values()) {
    total += mins;
  }
  return total > 0 ? total : null;
}

export function buildStaffConfirmRecommendedLengthDisplay(args: {
  requestData: Record<string, unknown>;
  appt: Appointment | null | undefined;
  householdAppts?: readonly Appointment[];
  isNewClient?: boolean;
  appointmentTypes: readonly AppointmentType[];
  appointmentTypeCatalog: AppointmentTypeCatalog;
  providers: readonly Provider[];
}): StaffConfirmRecommendedLength | null {
  const requestData = args.requestData ?? {};
  const calendarAppts =
    args.householdAppts && args.householdAppts.length > 0
      ? args.householdAppts
      : args.appt
        ? [args.appt]
        : [];

  const isNewPatient =
    args.isNewClient === true || isNewPatientRequestFromRequestData(requestData);

  const requestVisitPets = buildVisitPetsFromRequestData(
    requestData,
    args.appointmentTypes,
    isNewPatient,
  );
  const calendarVisitPets = buildVisitPetsFromCalendarAppts(
    calendarAppts,
    isNewPatient,
    args.appointmentTypes,
  );
  const visitPets =
    requestVisitPets.length > 0 ? requestVisitPets : calendarVisitPets;

  const requestTypesLabel = formatTypesLabelFromRequestData(requestData);
  const petRows = requestDataPetRowSummaries(requestData);
  const calendarTypesLabel = formatTypesLabelFromCalendarAppts(calendarAppts);
  const typesLabel =
    (calendarVisitPets.length > 0 && calendarTypesLabel && !calendarApptsStillOnHold(calendarAppts, args.appointmentTypeCatalog)
      ? calendarTypesLabel
      : null) ??
    requestTypesLabel ??
    formatStaffConfirmVisitTypesLabel(
      visitPets,
      args.appointmentTypes,
      requestData,
      calendarAppts,
    ) ??
    calendarTypesLabel ??
    (petRows.length > 0
      ? formatTypesLabelFromPetRows(petRows, petRows.length > 1)
      : null);

  if (!typesLabel && petRows.length === 0) return null;

  const doctorLabel =
    formatStaffConfirmDoctorLabel(
      resolveStaffConfirmDoctorDisplayName(
        requestData,
        args.appt,
        args.providers,
        calendarAppts,
      ),
    ) ?? undefined;

  const stillOnHold = calendarApptsStillOnHold(calendarAppts, args.appointmentTypeCatalog);
  const bookedFromOwnerRequest =
    stillOnHold &&
    Boolean(requestTypesLabel) &&
    (requestVisitPets.length > 0 || requestDataPetRowSummaries(requestData).length > 0);

  const bookingBreakdown = buildStaffConfirmBookingBreakdown({
    requestData,
    calendarAppts,
    appointmentTypes: args.appointmentTypes,
    appointmentTypeCatalog: args.appointmentTypeCatalog,
    isNewClient: args.isNewClient,
    requestVisitPets,
    calendarVisitPets,
  });

  const displayMinutes =
    bookingBreakdown?.bookedSlotMinutes ??
    bookingBreakdown?.original.bookedMinutes ??
    bookedMinutesFromCalendarAppts(calendarAppts) ??
    requestDataStoredServiceMinutes(requestData) ??
    null;
  if (displayMinutes == null) return null;

  const newPatientCount =
    bookingBreakdown?.recommended?.newPatientCount ??
    bookingBreakdown?.original.newPatientCount ??
    0;
  const newPatientBufferMinutes =
    bookingBreakdown?.recommended?.newPatientBufferMinutes ??
    bookingBreakdown?.original.newPatientBufferMinutes ??
    0;

  return {
    minutes: displayMinutes,
    typesLabel: typesLabel ?? 'appointment',
    doctorLabel,
    newPatientBufferMinutes,
    newPatientCount: newPatientCount > 0 ? newPatientCount : undefined,
    bookedTypesLabel: bookedFromOwnerRequest ? requestTypesLabel : null,
    bookedFromOwnerRequest,
    bookingBreakdown: bookingBreakdown ?? undefined,
  };
}

function applyRoutingResultToDurationBreakdown(
  section: StaffConfirmDurationBreakdown,
  result: RoutingServiceMinutesResponse,
): StaffConfirmDurationBreakdown {
  return {
    ...section,
    bookedMinutes: Math.max(1, Math.round(result.serviceMinutes)),
    baseMinutes: Math.max(1, Math.round(result.baseMinutes)),
    newPatientBufferMinutes: Math.max(0, Math.round(result.newPatientBufferMinutes)),
  };
}

export async function resolveStaffConfirmRecommendedLength(args: {
  practiceId: number;
  requestData: Record<string, unknown>;
  appt: Appointment | null | undefined;
  householdAppts?: readonly Appointment[];
  isNewClient?: boolean;
  appointmentTypes: readonly AppointmentType[];
  appointmentTypeCatalog: AppointmentTypeCatalog;
  providers: readonly Provider[];
}): Promise<StaffConfirmRecommendedLength | null> {
  const base = buildStaffConfirmRecommendedLengthDisplay(args);
  if (!base) return null;

  const requestData = args.requestData ?? {};
  const calendarAppts =
    args.householdAppts && args.householdAppts.length > 0
      ? args.householdAppts
      : args.appt
        ? [args.appt]
        : [];
  const isNewPatient =
    args.isNewClient === true || isNewPatientRequestFromRequestData(requestData);
  const requestVisitPets = buildVisitPetsFromRequestData(
    requestData,
    args.appointmentTypes,
    isNewPatient,
  );
  const calendarVisitPets = buildVisitPetsFromCalendarAppts(
    calendarAppts,
    isNewPatient,
    args.appointmentTypes,
  );
  const visitPets =
    requestVisitPets.length > 0 ? requestVisitPets : calendarVisitPets;

  const doctorId = resolveStaffConfirmRoutingDoctorId(requestData, args.appt, args.providers);
  if (visitPets.length === 0 || doctorId == null) return base;

  const breakdown = base.bookingBreakdown;

  try {
    if (breakdown) {
      const recommendedUsesRequestTypes = breakdown.recommended?.usesRequestedTypes === true;
      const recommendedVisitPets =
        recommendedUsesRequestTypes && requestVisitPets.length > 0
          ? requestVisitPets
          : calendarVisitPets;

      const originalNeedsFetch = requestVisitPets.length > 0;
      const recommendedNeedsFetch =
        Boolean(breakdown.recommended) && recommendedVisitPets.length > 0;
      const sameVisitPetsForFetch =
        originalNeedsFetch &&
        recommendedNeedsFetch &&
        visitPetsTypeSignature(requestVisitPets) ===
          visitPetsTypeSignature(recommendedVisitPets);

      let originalResult: RoutingServiceMinutesResponse | null = null;
      let recommendedResult: RoutingServiceMinutesResponse | null = null;

      if (sameVisitPetsForFetch) {
        const shared = await fetchRoutingServiceMinutes({
          practiceId: args.practiceId,
          doctorId,
          visitPets: requestVisitPets,
        });
        originalResult = shared;
        recommendedResult = shared;
      } else {
        [originalResult, recommendedResult] = await Promise.all([
          originalNeedsFetch
            ? fetchRoutingServiceMinutes({
                practiceId: args.practiceId,
                doctorId,
                visitPets: requestVisitPets,
              })
            : Promise.resolve(null),
          recommendedNeedsFetch
            ? fetchRoutingServiceMinutes({
                practiceId: args.practiceId,
                doctorId,
                visitPets: recommendedVisitPets,
              })
            : Promise.resolve(null),
        ]);
      }

      const nextBreakdown: StaffConfirmBookingBreakdown = {
        ...breakdown,
        original: originalResult
          ? applyRoutingResultToDurationBreakdown(breakdown.original, originalResult)
          : breakdown.original,
        recommended:
          recommendedResult && breakdown.recommended
            ? applyRoutingResultToDurationBreakdown(breakdown.recommended, recommendedResult)
            : breakdown.recommended,
      };

      return {
        ...base,
        minutes:
          nextBreakdown.bookedSlotMinutes > 0
            ? nextBreakdown.bookedSlotMinutes
            : nextBreakdown.original.bookedMinutes,
        newPatientBufferMinutes:
          nextBreakdown.recommended?.newPatientBufferMinutes ??
          nextBreakdown.original.newPatientBufferMinutes,
        newPatientCount:
          (nextBreakdown.recommended?.newPatientCount ??
            nextBreakdown.original.newPatientCount) > 0
            ? nextBreakdown.recommended?.newPatientCount ?? nextBreakdown.original.newPatientCount
            : undefined,
        bookingBreakdown: nextBreakdown,
      };
    }

    const result = await fetchRoutingServiceMinutes({
      practiceId: args.practiceId,
      doctorId,
      visitPets,
    });
    return {
      ...base,
      minutes: Math.max(1, Math.round(result.serviceMinutes)),
      newPatientBufferMinutes: Math.max(0, Math.round(result.newPatientBufferMinutes)),
    };
  } catch {
    return base;
  }
}

export function formatStaffConfirmRecommendedLengthLine(
  info: StaffConfirmRecommendedLength,
): string {
  const doctorPart = info.doctorLabel ? ` for ${info.doctorLabel}` : '';
  return `Recommended appointment length: ${info.minutes} minutes for ${info.typesLabel}${doctorPart}`;
}

export function formatStaffConfirmNewPatientBufferLine(
  info: StaffConfirmRecommendedLength,
): string | null {
  const mins = info.newPatientBufferMinutes;
  const count = info.newPatientCount;
  if (mins == null || mins <= 0 || count == null || count <= 0) return null;
  const noun = count === 1 ? 'patient' : 'patients';
  return `Add ${mins} minutes for ${count} new ${noun}`;
}

export function formatStaffConfirmBookedFromRequestLine(
  info: StaffConfirmRecommendedLength,
): string | null {
  if (!info.bookedFromOwnerRequest) return null;
  const types = info.bookedTypesLabel?.trim();
  if (types) {
    return `The booked time above is based on what the client requested (${types}), not the hold type on the calendar.`;
  }
  return 'The booked time above is based on what the client requested, not the hold type on the calendar.';
}

export function formatStaffConfirmHoldSchedulingNote(
  breakdown: StaffConfirmBookingBreakdown,
): string | null {
  if (!breakdown.original.calendarStillHold) return null;
  return 'These are placeholders, update once new patient is added.';
}

export function formatStaffConfirmClientStatusLine(
  breakdown: StaffConfirmDurationBreakdown,
): string {
  if (breakdown.isNewClient) {
    const n = breakdown.pets.length;
    if (n <= 1) return 'New client · new patient';
    return `New client · ${n} new patients`;
  }
  const newCount = breakdown.pets.filter((p) => p.isNewPatient).length;
  if (newCount === 0) return 'Existing client';
  if (newCount === 1) return 'Existing client · 1 new patient';
  return `Existing client · ${newCount} new patients`;
}

export function formatStaffConfirmPetBreakdownLine(
  pet: StaffConfirmBookingBreakdownPet,
): string {
  const newTag = pet.isNewPatient ? ' · new patient' : '';
  return `${pet.name} — ${pet.appointmentType}${newTag}`;
}

export function formatStaffConfirmVisitTimeTotalLine(
  breakdown: StaffConfirmDurationBreakdown,
): string {
  return `Visit time for requested types: ${breakdown.baseMinutes} min`;
}

export function formatStaffConfirmNewPatientBufferDetailLine(
  breakdown: StaffConfirmDurationBreakdown,
): string | null {
  const { newPatientBufferMinutes: mins, newPatientCount: count } = breakdown;
  if (mins <= 0 || count <= 0) return null;
  const noun = count === 1 ? 'patient' : 'patients';
  if (count === 1) {
    return `Add ${mins} minutes for 1 new ${noun}`;
  }
  const additional = (count - 1) * ROUTING_ADDITIONAL_NEW_PATIENT_DURATION_BUFFER_MINUTES;
  return `Add ${mins} minutes for ${count} new ${noun} (${ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES} min first + ${additional} min additional)`;
}

export function formatStaffConfirmBookedMathLine(
  breakdown: StaffConfirmDurationBreakdown,
): string | null {
  const { baseMinutes, newPatientBufferMinutes, bookedMinutes } = breakdown;
  if (newPatientBufferMinutes <= 0) return null;
  return `${baseMinutes} min + ${newPatientBufferMinutes} min new-patient buffer = ${bookedMinutes} min total`;
}

export function formatStaffConfirmBookedTotalLine(
  breakdown: StaffConfirmDurationBreakdown,
): string {
  return `Total booked time: ${breakdown.bookedMinutes} minutes`;
}

export function formatStaffConfirmSlotDifferenceLine(
  breakdown: StaffConfirmBookingBreakdown,
): string | null {
  const { recommended, bookedSlotMinutes, original } = breakdown;
  if (!recommended) return null;
  const slotMinutes = bookedSlotMinutes > 0 ? bookedSlotMinutes : original.bookedMinutes;
  const diff = recommended.bookedMinutes - slotMinutes;
  const typesPhrase = recommended.usesRequestedTypes
    ? 'recommended for requested types'
    : 'recommended for current types';
  if (diff === 0) {
    return `Booked slot is ${slotMinutes} min — same as ${typesPhrase}.`;
  }
  const direction = diff > 0 ? 'longer' : 'shorter';
  return `Booked slot is ${slotMinutes} min — ${typesPhrase} is ${recommended.bookedMinutes} min (${Math.abs(diff)} min ${direction}).`;
}
