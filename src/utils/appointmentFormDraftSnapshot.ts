// src/utils/appointmentFormDraftSnapshot.ts
import type {
  AppointmentFormDraftClientType,
  AppointmentFormDraftData,
} from '../api/appointmentFormDrafts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AppointmentFormDraftSnapshotInput = {
  email?: string;
  userEmail?: string;
  fullName?: {
    first?: string;
    last?: string;
    middle?: string;
    prefix?: string;
    suffix?: string;
  };
  haveUsedServicesBefore?: string;
  phoneNumbers?: string;
  bestPhoneNumber?: string;
  canWeText?: string;
  physicalAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  newPhysicalAddress?: AppointmentFormDraftSnapshotInput['physicalAddress'];
  isThisTheAddressWhereWeWillCome?: string;
  selectedPetIds?: string[];
  newClientPets?: Array<{ id: string; name?: string; species?: string }>;
  existingClientNewPets?: Array<{ id: string; name?: string; species?: string }>;
  petSpecificData?: Record<string, unknown>;
  howSoon?: string;
  serviceArea?: string;
  serviceAreaVisit?: string;
  lookingForEuthanasia?: string;
  lookingForEuthanasiaExisting?: string;
  preferredDoctor?: string;
  preferredDoctorExisting?: string;
  visitDetails?: string;
  needsUrgentScheduling?: string;
  preferredDateTime?: string;
  preferredDateTimeVisit?: string;
  selectedDateTimeSlots?: Record<string, number>;
  selectedDateTimeSlotsVisit?: Record<string, number>;
  membershipInterest?: string;
  howDidYouHearAboutUs?: string;
  howDidYouHearAboutUsOther?: string;
  anythingElse?: string;
  isLoggedIn?: boolean;
};

function trimStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function cleanObject(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const nested = cleanObject(v as Record<string, unknown>);
      if (nested && Object.keys(nested).length > 0) out[k] = nested;
      continue;
    }
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Per API doc §6 */
export function getAppointmentFormClientType(
  haveUsedServicesBefore: string | undefined,
  isLoggedIn: boolean
): AppointmentFormDraftClientType {
  if (isLoggedIn) return 'existing';
  if (haveUsedServicesBefore === 'Yes') return 'existing';
  return 'new';
}

export function isAppointmentFormContactCaptured(input: AppointmentFormDraftSnapshotInput): boolean {
  const email = trimStr(input.email) || trimStr(input.userEmail);
  if (email && EMAIL_RE.test(email)) return true;
  const phone = trimStr(input.bestPhoneNumber) || trimStr(input.phoneNumbers);
  return !!phone && phone.replace(/\D/g, '').length >= 7;
}

/** Per API doc §7 — debounced PUT and abandon guards */
export function shouldPersistAppointmentFormDraft(
  currentStep: string,
  input: AppointmentFormDraftSnapshotInput
): boolean {
  if (currentStep === 'success') return false;
  return (
    isAppointmentFormContactCaptured(input) ||
    !['intro', 'success'].includes(currentStep)
  );
}

/**
 * Partial snapshot aligned with POST /public/appointments/form field names.
 * Always include fullName.first / fullName.last when present (required for new-client abandon email).
 */
export function buildAppointmentFormDraftSnapshot(
  input: AppointmentFormDraftSnapshotInput
): AppointmentFormDraftData {
  const email = trimStr(input.email) || trimStr(input.userEmail);
  const phoneNumber = trimStr(input.bestPhoneNumber) || trimStr(input.phoneNumbers);

  const physicalAddress =
    input.isThisTheAddressWhereWeWillCome === 'No' && input.newPhysicalAddress
      ? cleanObject(input.newPhysicalAddress as Record<string, unknown>)
      : cleanObject((input.physicalAddress ?? {}) as Record<string, unknown>);

  const draft: AppointmentFormDraftData = {};

  if (email) draft.email = email;

  const first = trimStr(input.fullName?.first);
  const last = trimStr(input.fullName?.last);
  if (first || last) {
    draft.fullName = {
      ...(first ? { first } : {}),
      ...(last ? { last } : {}),
      ...(trimStr(input.fullName?.middle) ? { middle: input.fullName!.middle!.trim() } : {}),
      ...(trimStr(input.fullName?.prefix) ? { prefix: input.fullName!.prefix!.trim() } : {}),
      ...(trimStr(input.fullName?.suffix) ? { suffix: input.fullName!.suffix!.trim() } : {}),
    };
  }

  if (trimStr(input.haveUsedServicesBefore)) {
    draft.haveUsedServicesBefore = input.haveUsedServicesBefore;
  }
  if (phoneNumber) draft.phoneNumber = phoneNumber;
  if (trimStr(input.phoneNumbers) && !draft.phoneNumber) {
    draft.phoneNumbers = input.phoneNumbers;
  }
  if (trimStr(input.canWeText)) draft.canWeText = input.canWeText;
  if (physicalAddress) draft.physicalAddress = physicalAddress;
  if (input.selectedPetIds?.length) draft.selectedPetIds = input.selectedPetIds;
  if (input.newClientPets?.length) draft.newClientPets = input.newClientPets;
  if (input.existingClientNewPets?.length) {
    draft.existingClientNewPets = input.existingClientNewPets;
  }
  if (input.petSpecificData && Object.keys(input.petSpecificData).length > 0) {
    draft.petSpecificData = input.petSpecificData;
  }
  if (trimStr(input.howSoon)) draft.howSoon = input.howSoon;
  const serviceArea = trimStr(input.serviceArea) || trimStr(input.serviceAreaVisit);
  if (serviceArea) draft.serviceArea = serviceArea;
  if (trimStr(input.lookingForEuthanasia)) draft.lookingForEuthanasia = input.lookingForEuthanasia;
  if (trimStr(input.lookingForEuthanasiaExisting)) {
    draft.lookingForEuthanasiaExisting = input.lookingForEuthanasiaExisting;
  }
  const preferredDoctor = trimStr(input.preferredDoctorExisting) || trimStr(input.preferredDoctor);
  if (preferredDoctor) draft.preferredDoctor = preferredDoctor;
  if (trimStr(input.visitDetails)) draft.visitDetails = input.visitDetails;
  if (trimStr(input.needsUrgentScheduling)) draft.needsUrgentScheduling = input.needsUrgentScheduling;
  const preferredDateTime =
    trimStr(input.preferredDateTimeVisit) || trimStr(input.preferredDateTime);
  if (preferredDateTime) draft.preferredDateTime = preferredDateTime;
  if (
    input.selectedDateTimeSlotsVisit &&
    Object.keys(input.selectedDateTimeSlotsVisit).length > 0
  ) {
    draft.selectedDateTimeSlotsVisit = input.selectedDateTimeSlotsVisit;
  } else if (input.selectedDateTimeSlots && Object.keys(input.selectedDateTimeSlots).length > 0) {
    draft.selectedDateTimeSlots = input.selectedDateTimeSlots;
  }
  if (trimStr(input.membershipInterest)) draft.membershipInterest = input.membershipInterest;
  if (trimStr(input.howDidYouHearAboutUs)) draft.howDidYouHearAboutUs = input.howDidYouHearAboutUs;
  if (trimStr(input.howDidYouHearAboutUsOther)) {
    draft.howDidYouHearAboutUsOther = input.howDidYouHearAboutUsOther;
  }
  if (trimStr(input.anythingElse)) draft.anythingElse = input.anythingElse;
  if (input.isLoggedIn != null) draft.isLoggedIn = input.isLoggedIn;

  return draft;
}
