// src/pages/AppointmentRequestForm.tsx
import React, { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { http } from '../api/http';
import { fetchClientPets, type Pet, fetchClientInfo, fetchWellnessPlansForPatient } from '../api/clientPortal';
import { fetchPrimaryProviders, fetchVeterinarians, deriveVeterinarianClientZoneFlags, type Provider } from '../api/employee';
import { validateAddress } from '../api/geo';
import { AddressAutocomplete, type AddressFields } from '../components/AddressAutocomplete';
import { ManualAddressFields } from '../components/ManualAddressFields';
import { BreedCombobox } from '../components/BreedCombobox';
import {
  NewClientAppointmentTypePicker,
  type AppointmentTypeCardOption,
} from '../components/NewClientAppointmentTypePicker';
import { NewClientHowSoonPicker, type HowSoonChoiceValue } from '../components/NewClientHowSoonPicker';
import { NewClientSpeciesPicker, type NewClientSpeciesChoice } from '../components/NewClientSpeciesPicker';
import { PetVisitQuestionsBlock } from '../components/PetVisitQuestionsBlock';
import { PetSexSelect, spayedNeuteredFromPetSex, type PetSexOption } from '../components/PetSexSelect';
import {
  PetHandlingNeedsPicker,
  hasHandlingNeedsAnswer,
  hasSpecialHandlingNeeds,
  petsAllowOnlineScheduling,
  type PetHandlingFields,
} from '../components/PetHandlingNeedsPicker';
import { getSelectedAppointmentType, EUTHANASIA_AFTERCARE_LABEL, EUTHANASIA_AFTERCARE_OPTIONS } from '../utils/petVisitQuestionUtils';
import {
  filterCompletedAppointmentRequestPets,
  isAbandonedAppointmentRequestPetStub,
} from '../utils/appointmentRequestPetCompleteness';
import { appointmentTypeIsCalmingPremed, findCalmingPremedAppointmentType, sortAppointmentTypesForPicker } from '../utils/appointmentTypeSettings';
import { resolveClientArrivalWindowForScheduledStart } from '../utils/appointmentArrivalWindow';
import { DEFAULT_PRACTICE_TIMEZONE } from '../utils/practiceTimezone';
import { formatAutobookDateTimePreferenceDisplay } from '../utils/appointmentRequestDisplay';
import { appointmentTypeForRoutingStatsKey } from '../utils/routingCalculateTimeType';
import { fetchPublicRoutingOfferableScoreThresholds } from '../api/routingOfferableScoreThresholds';
import {
  daysFromTodayForSlot,
  defaultRoutingOfferableScoreConfig,
  isRoutingScoreOfferableForConfig,
} from '../utils/routingOfferableScoreConfig';
import {
  buildRoutingVisitPetsFromFormData,
  estimateRoutingServiceMinutesForVisit,
  resolveVisitAppointmentTypeIdsFromFormData,
  routingVisitNewPatientCount,
  routingVisitPetCount,
} from '../utils/routingServiceMinutes';
import {
  anyDoctorCanBookOnlineForVisitTypes,
  anyDoctorCanBookOnlineForNewPatientRequestForVisitTypes,
  canBookOnlineForVisitTypes,
  canBookOnlineForNewPatientRequestForVisitTypes,
  isVeterinarianAcceptingNewPatientsInClientZone,
  isOnlineBookingUnavailableError,
  ONLINE_BOOKING_UNAVAILABLE_MESSAGE,
  ONLINE_BOOKING_OTHER_SPECIES_MESSAGE,
  petsSpeciesAllowOnlineScheduling,
  SLOT_NO_LONGER_AVAILABLE_MESSAGE,
  appointmentFormSubmitSuccessKindFromMessage,
  extractApiResponseMessage,
  isSlotNoLongerAvailableError,
  type AppointmentFormSubmitSuccessKind,
} from '../utils/onlineBooking';
import { scrollToFirstAppointmentFormError } from '../utils/appointmentFormScrollToError';
import { normalizeRoutingV2SlotSearchResponse, type RoutingV2SlotSearchResult } from '../api/routing';
import { DateTime } from 'luxon';
import {
  checkEmail,
  fetchPublicProviders,
  fetchPublicVeterinarians,
  fetchAvailability,
  fetchAppointmentTypes,
  fetchRoutingServiceMinutes,
  type PublicProvider,
  type AvailabilityResponse,
  type AppointmentType,
  type SelfScheduledSlot,
} from '../api/publicAppointments';
import { SelfScheduleCalendarModal } from '../components/SelfScheduleCalendarModal';
import { selectedPatientDbIdsFromForm } from '../utils/onlineBookingPatientIds';
import { trackEvent } from '../utils/analytics';
import { useAppointmentFormDraftPersistence } from '../hooks/useAppointmentFormDraftPersistence';
import type { AppointmentFormDraftSnapshotInput } from '../utils/appointmentFormDraftSnapshot';
import { ClientLoginForm } from '../components/ClientLoginForm';
import { getZoneSearchBufferMiles, isCreateClientEnabled, isProduction } from '../utils/env';
import {
  allowAppointmentRequestWhenOutOfArea,
  isUsingAlternateVisitAddress,
  ON_FILE_OUT_OF_AREA_REQUEST_ONLY_MESSAGE,
} from '../utils/appointmentRequestZonePolicy';
import { listMembershipTransactions } from '../api/membershipTransactions';
import MembershipSignup from './MembershipSignup';
import MembershipPayment from './MembershipPayment';
import {
  resolveAppointmentRequestPromoToken,
  resolveAppointmentRequestPromoByCode,
  checkAppointmentRequestPromoEligibility,
  checkAppointmentRequestPromoEligibilityByCode,
  formatPromotionDiscount,
  formatPromotionBannerSubtitle,
  APPOINTMENT_PROMO_QUERY_PARAM,
  APPOINTMENT_PROMO_CODE_QUERY_PARAM,
  type PublicAppointmentRequestPromotion,
} from '../api/appointmentRequestPromotions';
import { upsertServiceAreaInterest } from '../api/serviceAreaInterest';

/** Set to true to show doctor selection. Code preserved for potential re-enable. */
const SHOW_DOCTOR_SELECTION = false;

/** Set to true to show time slots ("Here are some possible dates and times..."). Code preserved for potential re-enable. */
const SHOW_TIME_SLOTS = false;

/** Set to true to show the manual promo code entry field on the submit step. Promotions via URL token (?promo=) still work. */
const SHOW_PROMO_CODE_FIELD = true;

const EMERGENT_HOW_SOON_VALUES = new Set([
  'Emergent – today',
  'Emergent - Today',
  'Emergency - today',
]);

const URGENT_HOW_SOON_VALUES = new Set([
  'Urgent – within 24–48 hours',
  'Urgent - within 24-48 hours',
]);

const FLEXIBLE_HOW_SOON_VALUES = new Set(['Flexible', 'Routine - flexible', 'Flexible – within the next month']);

const SOON_WEEK_HOW_SOON_VALUES = new Set([
  'Soon – sometime this week',
  'Soon - in the next week',
  'Soon - next few days',
]);

type HowSoonOption = HowSoonChoiceValue;

const getSelectedNewClientAppointmentType = getSelectedAppointmentType;

const EUTHANASIA_SHARE_PROMPT = (petLabel = 'your pet') =>
  `Share anything you'd like us to know about ${petLabel} or what led you here today`;

const EUTHANASIA_OTHER_OPTIONS_SUPPORT_TEXT =
  'No pressure at all. We simply want to make sure we support you and your pet in the best way possible.';

const EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS_LABEL =
  'Are you interested in pursuing other options other than euthanasia?';

const EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS = [
  'No. While this is very difficult, I\'ve made my decision and do not wish to explore additional options right now.',
  'Yes. I\'d like to discuss other options with the doctor.',
  "I'm not sure yet.",
] as const;

function resolveSpeciesFromChoice(
  speciesList: Array<{ id: number; name: string; prettyName?: string }>,
  choice: NewClientSpeciesChoice,
): { speciesId?: number; species: string } {
  const findSpecies = (needles: string[]) =>
    speciesList.find((s) => {
      const label = (s.prettyName || s.name || '').toLowerCase();
      return needles.some((needle) => label.includes(needle));
    });
  if (choice === 'Dog') {
    const match = findSpecies(['canine', 'dog']);
    return { speciesId: match?.id, species: match?.prettyName || match?.name || 'Dog' };
  }
  if (choice === 'Cat') {
    const match = findSpecies(['feline', 'cat']);
    return { speciesId: match?.id, species: match?.prettyName || match?.name || 'Cat' };
  }
  return { speciesId: undefined, species: 'Other' };
}

function isManualSchedulingHowSoon(howSoon?: string): boolean {
  if (!howSoon) return false;
  // Emergent and free-text "Other" stay with Client Liaison; urgent + not sure can self-book.
  return EMERGENT_HOW_SOON_VALUES.has(howSoon) || howSoon === 'Other';
}

function isOtherHowSoon(howSoon?: string): boolean {
  return howSoon === 'Other';
}

function veterinarianLookupParams(
  address: string,
  lat?: number,
  lon?: number,
  practiceId?: number
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (practiceId != null) params.practiceId = practiceId;
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    params.lat = lat;
    params.lon = lon;
  } else if (address) {
    params.address = address;
  }
  return params;
}

function isPhysicalAddressComplete(addr: AddressFields | undefined): boolean {
  return Boolean(
    addr?.line1?.trim() &&
      addr?.city?.trim() &&
      addr?.state?.trim() &&
      addr?.zip?.trim()
  );
}

function formatAddressForZoneCheck(addr: AddressFields | undefined): string {
  if (!isPhysicalAddressComplete(addr)) return '';
  return [addr?.line1, addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ');
}

/** Client API uses `zipcode`; some appointment payloads use `zip`. */
function clientRecordZip(client: { zip?: unknown; zipcode?: unknown } | null | undefined): string {
  const raw = client?.zipcode ?? client?.zip;
  return raw != null ? String(raw).trim() : '';
}

type ZoneCheckStatus = 'idle' | 'pending' | 'in_service' | 'out_of_service' | 'failed';

const ZONE_CHECK_PENDING_MESSAGE = 'Please wait while we confirm we serve your area.';
const ZONE_CHECK_FAILED_MESSAGE =
  "We couldn't confirm whether we serve your area. Please try again in a moment.";

function resolvePrimaryAppointmentTypeId(
  formData: Pick<FormData, 'selectedPetIds' | 'newClientPets' | 'existingClientNewPets' | 'petSpecificData'>,
  opts?: {
    /**
     * Type id to prefer when any pet in the visit uses it (calming / Pre-Meds).
     * Its arrival window then applies to availability for the whole household.
     */
    preferredTypeId?: number;
  },
): number | undefined {
  const petIds = [
    ...(formData.selectedPetIds ?? []),
    ...(formData.newClientPets?.map((p) => p.id) ?? []),
    ...(formData.existingClientNewPets?.map((p) => p.id) ?? []),
  ];
  const typeIds: number[] = [];
  for (const petId of petIds) {
    const typeId = formData.petSpecificData?.[petId]?.appointmentTypeId;
    if (typeId != null && Number.isFinite(typeId)) typeIds.push(typeId);
  }
  const preferred = opts?.preferredTypeId;
  if (preferred != null && typeIds.includes(preferred)) return preferred;
  return typeIds[0];
}

function resolveProviderFromDoctorName(
  selectedDoctor: string,
  providerList: Array<{ id?: string | number; name: string; pimsId?: string | number | null }>,
) {
  const doctorName = selectedDoctor.replace(/^Dr\.?\s*/i, '').trim();
  let doctor = providerList.find(
    (p) => p.name === doctorName || `Dr. ${p.name}` === selectedDoctor || p.name === selectedDoctor,
  );
  if (!doctor) {
    doctor = providerList.find(
      (p) =>
        p.name.toLowerCase().includes(doctorName.toLowerCase()) ||
        doctorName.toLowerCase().includes(p.name.toLowerCase()),
    );
  }
  return doctor;
}

function resolveRawVeterinarianById(rawVets: any[], doctorId: string | number | undefined): any | null {
  if (doctorId == null) return null;
  return (
    rawVets.find((v) => String(v.id ?? v.employeeId ?? v.pimsId) === String(doctorId)) ?? null
  );
}

type SchedulingProviderLike = {
  id: string | number;
  name: string;
  pimsId?: string | number | null;
};

function providerCoreNameForMatch(value: string): string {
  return value
    .replace(/^dr\.?\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\b(dvm|vmd|dabvp|ms|phd)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function resolveProviderDoctorIdInList(
  providerId: string | number | null | undefined,
  providerName: string | null | undefined,
  list: SchedulingProviderLike[],
  rawVeterinarianList: any[],
): string | number | undefined {
  if (list.length === 0 && rawVeterinarianList.length === 0) return undefined;

  const resolveRawId = (raw: any): string | number | undefined =>
    raw?.id ?? raw?.employeeId ?? raw?.pimsId ?? undefined;

  const providerPimsId = (p: SchedulingProviderLike) =>
    p.pimsId != null ? String(p.pimsId) : null;

  if (providerId != null) {
    const target = String(providerId);
    const direct = list.find(
      (p) => String(p.id) === target || providerPimsId(p) === target,
    );
    if (direct) return direct.id;

    const rawMatch = rawVeterinarianList.find((v) =>
      [v?.id, v?.pimsId, v?.employeeId, v?.pimsUserId].some(
        (x) => x != null && String(x) === target,
      ),
    );
    if (rawMatch) {
      const rid = resolveRawId(rawMatch);
      if (rid != null) {
        const viaRaw = list.find(
          (p) => String(p.id) === String(rid) || providerPimsId(p) === String(rid),
        );
        if (viaRaw) return viaRaw.id;
        return rid;
      }
    }
  }

  if (providerName) {
    const target = providerCoreNameForMatch(providerName);
    if (target) {
      const match = list.find((p) => {
        const name = providerCoreNameForMatch(p.name);
        return name === target || name.startsWith(target) || target.startsWith(name);
      });
      if (match) return match.id;
    }

    const rawByName = rawVeterinarianList.find((v) => {
      const built = providerCoreNameForMatch(
        [v.firstName, v.lastName].filter(Boolean).join(' ') || String(v.name ?? ''),
      );
      const normalized = providerCoreNameForMatch(providerName);
      return (
        built &&
        normalized &&
        (built === normalized || built.startsWith(normalized) || normalized.startsWith(built))
      );
    });
    if (rawByName) {
      const rid = resolveRawId(rawByName);
      if (rid != null) {
        const viaRaw = list.find(
          (p) => String(p.id) === String(rid) || providerPimsId(p) === String(rid),
        );
        if (viaRaw) return viaRaw.id;
        return rid;
      }
    }
  }

  return undefined;
}

function mapDoctorForSelfScheduleModal(
  p: { id: string | number; name: string; email?: string; imageUrl?: unknown; pimsId?: string | number },
  rawVeterinarianList: any[],
) {
  const raw = resolveRawVeterinarianById(rawVeterinarianList, p.id);
  const bio =
    typeof raw?.bio === 'string' && raw.bio.trim() ? raw.bio.trim() : null;
  return {
    id: p.id,
    name: p.name,
    email: p.email || undefined,
    imageUrl: ('imageUrl' in p && p.imageUrl) ? (p.imageUrl as string | null) : null,
    employeeId: typeof p.id === 'number' ? p.id : (
      p.pimsId != null ? Number(p.pimsId) : null
    ),
    bio,
  };
}

const HOW_DID_YOU_HEAR_ABOUT_US_OPTIONS = [
  'Referred by a friend or family',
  'Google Search',
  'Facebook',
  'Instagram',
  'Flyer or Printed Material',
  'Other',
] as const;

type HowDidYouHearAboutUsOption = (typeof HOW_DID_YOU_HEAR_ABOUT_US_OPTIONS)[number];

type FormData = {
  // Intro page
  email: string;
  fullName: {
    first: string;
    last: string;
    middle?: string;
    prefix?: string;
    suffix?: string;
  };
  haveUsedServicesBefore: 'Yes' | 'No' | '';
  selectedPetIds: string[]; // Array of selected pet IDs
  petSpecificData?: Record<string, {
    needsToday?: string; // Appointment type prettyName (e.g., "Standard Visit", "Wellness Exam", etc.)
    appointmentTypeId?: number; // Appointment type ID for backend lookup
    appointmentTypeName?: string; // Appointment type name for backend lookup
    needsTodayDetails?: string; // Details/reason for the selected need
    /** Existing chart pets: client reports calming meds for this visit. */
    needsCalmingMedications?: 'Yes' | 'No' | '';
    // Euthanasia-specific fields (for end-of-life option)
    euthanasiaReason?: string;
    beenToVetLastThreeMonths?: string;
    interestedInOtherOptions?: string;
    aftercarePreference?: string;
  }>; // Per-pet data keyed by pet ID
  howSoon?: HowSoonOption | ''; // How soon all pets need to be seen
  schedulingNotes?: string;
  
  // New Client Info
  phoneNumbers: string;
  physicalAddress: AddressFields;
  mailingAddressSame: 'Yes, it is different.' | 'No, it is the same.' | '';
  mailingAddress?: AddressFields;
  /** PO Box or other mailing address not found in autocomplete */
  mailingAddressManualEntry?: boolean;
  otherPersonsOnAccount?: string;
  condoApartmentInfo?: string;
  petInfo: string; // Name, Species, Age, Spayed/Neutered, Breed, Color, Weight (legacy, kept for backward compatibility)
  newClientPets?: Array<{
    id: string; // Unique ID for this pet
    name: string;
    species?: string;
    speciesId?: number; // ID of selected species for breed lookup
    speciesChoice?: NewClientSpeciesChoice | '';
    otherSpecies?: string; // Custom species name when "Other" is selected
    age?: string;
    spayedNeutered?: string;
    sex?: string;
    breed?: string;
    breedId?: number; // ID of selected breed
    color?: string;
    weight?: string;
    behaviorAtPreviousVisits?: string;
    needsCalmingMedications?: 'Yes' | 'No' | '';
    hasCalmingMedications?: 'Yes' | 'No' | '';
    needsMuzzleOrSpecialHandling?: 'Yes' | 'No' | '';
    needsExtraHandling?: 'Yes' | 'No' | '';
    handlingNeedsExplicitNone?: boolean;
  }>;
  existingClientNewPets?: Array<{
    id: string; // Unique ID for this pet
    name: string;
    species?: string;
    speciesId?: number; // ID of selected species for breed lookup
    speciesChoice?: NewClientSpeciesChoice | '';
    otherSpecies?: string; // Custom species name when "Other" is selected
    age?: string;
    spayedNeutered?: string;
    sex?: string;
    breed?: string;
    breedId?: number; // ID of selected breed
    color?: string;
    weight?: string;
    behaviorAtPreviousVisits?: string;
    needsCalmingMedications?: 'Yes' | 'No' | '';
    hasCalmingMedications?: 'Yes' | 'No' | '';
    needsMuzzleOrSpecialHandling?: 'Yes' | 'No' | '';
    needsExtraHandling?: 'Yes' | 'No' | '';
    handlingNeedsExplicitNone?: boolean;
  }>;
  previousVeterinaryPractices?: string;
  okayToContactPreviousVets?: 'Yes' | 'No' | '';
  petBehaviorAtPreviousVisits?: string; // Legacy field
  preferredDoctor?: string;
  lookingForEuthanasia?: 'Yes' | 'No' | '';
  needsCalmingMedications?: 'Yes' | 'No' | ''; // Legacy field
  hasCalmingMedications?: 'Yes' | 'No' | ''; // Legacy field
  needsMuzzleOrSpecialHandling?: 'Yes' | 'No' | ''; // Legacy field
  
  // Existing Client Info
  bestPhoneNumber?: string;
  whatPets?: string;
  previousVeterinaryHospitals?: string;
  preferredDoctorExisting?: string;
  lookingForEuthanasiaExisting?: 'Yes' | 'No' | '';
  isThisTheAddressWhereWeWillCome?: 'Yes' | 'No' | '';
  newPhysicalAddress?: AddressFields;
  differentMailingAddress?: 'Yes' | 'No' | '';
  newMailingAddress?: AddressFields;
  hadVetCareElsewhere?: 'Yes' | 'No' | '';
  mayWeAskForRecords?: 'Yes' | 'No' | '';
  haveWeSeenPetBefore?: 'Yes' | 'No' | '';
  newPetInfo?: string;
  previousVeterinaryPracticesExisting?: string;
  okayToContactPreviousVetsExisting?: 'Yes' | 'No' | '';
  petBehaviorAtPreviousVisitsExisting?: string;
  canWeText?: 'Yes' | 'No' | '';
  
  // Euthanasia
  euthanasiaReason?: string;
  beenToVetLastThreeMonths?: string;
  interestedInOtherOptions?: string;
  serviceArea?: 'Kennebunk / Greater Portland / Augusta Area' | 'Maine High Peaks Area' | '';
  urgency?: string;
  preferredDateTime?: string;
  selectedDateTimeSlots?: Record<string, number>; // Map of slot ISO to preference number (1, 2, 3) for euthanasia
  noneOfWorkForMe?: boolean; // For euthanasia
  aftercarePreference?: string;
  
  // Request Visit
  serviceAreaVisit?: 'Kennebunk / Greater Portland / Augusta Area' | 'Maine High Peaks Area' | '';
  visitDetails?: string;
  needsUrgentScheduling?: 'Yes' | 'No' | ''; // Needs to be seen in 24-48 hours
  selectedDateTimeSlotsVisit?: Record<string, number>; // Map of slot ISO to preference number (1, 2, 3) for visit
  noneOfWorkForMeVisit?: boolean; // For visit
  
  // Self-scheduling: confirmed slot chosen by the client
  selfScheduledSlot?: SelfScheduledSlot | null;
  /** Direct booking: keep this slot, but ask to be waitlisted if sooner opens. */
  joinWaitlistIfSooner?: boolean;

  // Other Info
  membershipInterest?: 'Pay as you go' | 'Membership' | "I'm not sure yet";
  howDidYouHearAboutUs?: HowDidYouHearAboutUsOption | '';
  howDidYouHearAboutUsOther?: string;
};

type Page = 
  | 'intro'
  | 'new-client'
  | 'new-client-pet-info'
  | 'existing-client'
  | 'existing-client-pets'
  | 'euthanasia-intro'
  | 'euthanasia-service-area'
  | 'euthanasia-portland'
  | 'euthanasia-high-peaks'
  | 'euthanasia-continued'
  | 'request-visit-continued'
  | 'success';

function getAppointmentFormStepName(page: Page): string {
  switch (page) {
    case 'intro':
      return 'Introduction';
    case 'new-client':
      return 'New Client Information';
    case 'new-client-pet-info':
      return 'Pet Information';
    case 'existing-client':
      return 'Existing Client Information';
    case 'existing-client-pets':
      return 'Select Pet(s)';
    case 'euthanasia-intro':
      return 'Euthanasia Details';
    case 'euthanasia-service-area':
      return 'Service Area Selection';
    case 'euthanasia-portland':
      return 'Euthanasia Scheduling (Portland)';
    case 'euthanasia-high-peaks':
      return 'Euthanasia Scheduling (High Peaks)';
    case 'euthanasia-continued':
      return 'Euthanasia Appointment Time';
    case 'request-visit-continued':
      return 'Appointment Time Selection';
    case 'success':
      return 'Success';
    default:
      return page;
  }
}

const ZONE_NOT_SERVICED_SERVICE_URL = 'www.vetatyourdoor.com/service-area';
const ZONE_NOT_SERVICED_CALL_TEXT = 'call or text us at ';
const ZONE_NOT_SERVICED_PHONE = '(207) 536-8387';
const ZONE_NOT_SERVICED_TEL = 'tel:+12075368387';
const ZONE_NOT_SERVICED_SMS = 'sms:+12075368387';
const ZONE_NOT_SERVICED_MESSAGE =
  "We're sorry—we don't currently serve your area. Please check back periodically at www.vetatyourdoor.com/service-area to see if our coverage has expanded. You can also call or text us at (207) 536-8387, and we'll take a look to see if your location may still be within reach.";

/** Renders zone-not-serviced copy with blue links for service area, call, text, and phone number. */
function renderZoneNotServicedMessage(message: string): ReactNode {
  const linkStyle = { color: '#3b82f6', textDecoration: 'underline' as const };

  if (!message.includes(ZONE_NOT_SERVICED_SERVICE_URL)) {
    return message;
  }

  const [beforeUrl, afterUrl] = message.split(ZONE_NOT_SERVICED_SERVICE_URL);
  if (afterUrl === undefined) {
    return message;
  }

  if (!afterUrl.includes(ZONE_NOT_SERVICED_PHONE)) {
    return (
      <>
        {beforeUrl}
        <a
          href={`https://${ZONE_NOT_SERVICED_SERVICE_URL}`}
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
        >
          {ZONE_NOT_SERVICED_SERVICE_URL}
        </a>
        {afterUrl}
      </>
    );
  }

  const [beforePhone, afterPhone] = afterUrl.split(ZONE_NOT_SERVICED_PHONE);
  const leadParts = beforePhone.split(ZONE_NOT_SERVICED_CALL_TEXT);
  const useCallTextLinks = leadParts.length === 2 && leadParts[1] === '';

  return (
    <>
      {beforeUrl}
      <a
        href={`https://${ZONE_NOT_SERVICED_SERVICE_URL}`}
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle}
      >
        {ZONE_NOT_SERVICED_SERVICE_URL}
      </a>
      {useCallTextLinks ? (
        <>
          {leadParts[0]}
          <a href={ZONE_NOT_SERVICED_TEL} style={linkStyle}>
            call
          </a>
          {' or '}
          <a href={ZONE_NOT_SERVICED_SMS} style={linkStyle}>
            text
          </a>
          {' us at '}
          <a href={ZONE_NOT_SERVICED_TEL} style={linkStyle}>
            {ZONE_NOT_SERVICED_PHONE}
          </a>
          {afterPhone}
        </>
      ) : (
        <>
          {beforePhone}
          <a href={ZONE_NOT_SERVICED_TEL} style={linkStyle}>
            {ZONE_NOT_SERVICED_PHONE}
          </a>
          {afterPhone}
        </>
      )}
    </>
  );
}

function createEmptyNewClientPetEntry(petId?: string) {
  const id = petId ?? `new-pet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  type NewClientPet = NonNullable<FormData['newClientPets']>[number];
  type PetSpecific = NonNullable<FormData['petSpecificData']>[string];
  const pet: NewClientPet = {
    id,
    name: '',
    species: '',
    speciesChoice: '',
    age: '',
    spayedNeutered: '',
    sex: '',
    breed: '',
    color: '',
    weight: '',
    behaviorAtPreviousVisits: '',
    needsCalmingMedications: '',
    hasCalmingMedications: '',
    needsMuzzleOrSpecialHandling: '',
    needsExtraHandling: '',
    handlingNeedsExplicitNone: false,
  };
  const petSpecific: PetSpecific = {
    needsToday: '',
    needsTodayDetails: '',
    euthanasiaReason: '',
    beenToVetLastThreeMonths: '',
    interestedInOtherOptions: '',
    aftercarePreference: '',
  };
  return { pet, petSpecific };
}

export default function AppointmentRequestForm() {
  const navigate = useNavigate();
  const { token, userEmail, userId } = useAuth() as any;
  const isLoggedIn = !!token;
  
  const [currentPage, setCurrentPage] = useState<Page>('intro');
  const [pets, setPets] = useState<Pet[]>([]);
  const [petAlerts, setPetAlerts] = useState<Map<string, string | null>>(new Map()); // Map of pet ID to alerts
  const [providers, setProviders] = useState<Provider[]>([]);
  const [publicProviders, setPublicProviders] = useState<PublicProvider[]>([]);
  // Store raw veterinarian data (with appointmentTypes) for filtering
  const [rawVeterinarians, setRawVeterinarians] = useState<any[]>([]);
  const [rawPublicVeterinarians, setRawPublicVeterinarians] = useState<any[]>([]);
  const [loadingClientData, setLoadingClientData] = useState(false);
  const [loadingVeterinarians, setLoadingVeterinarians] = useState(false); // Always false initially - never blocks render
  const [veterinariansFetchResolved, setVeterinariansFetchResolved] = useState(false);
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [loadingAppointmentTypes, setLoadingAppointmentTypes] = useState(false);
  const [primaryProviderName, setPrimaryProviderName] = useState<string | null>(null);
  const [primaryProviderId, setPrimaryProviderId] = useState<string | number | null>(null);
  const [originalAddress, setOriginalAddress] = useState<FormData['physicalAddress'] | null>(null);
  const [emailCheckResult, setEmailCheckResult] = useState<{ exists: boolean; hasAccount: boolean } | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [practiceId] = useState(1); // Default practice ID, could be made configurable
  
  const [formData, setFormData] = useState<FormData>(() => {
    const defaultNewClientPet = createEmptyNewClientPetEntry('new-pet-default');
    return {
    email: '',
    fullName: { first: '', last: '' },
    haveUsedServicesBefore: '',
    selectedPetIds: [],
    phoneNumbers: '',
    physicalAddress: {
      line1: '',
      city: '',
      state: '',
      zip: '',
      country: '',
    },
    mailingAddressSame: 'No, it is the same.',
    mailingAddressManualEntry: false,
    petInfo: '',
    newClientPets: isLoggedIn ? [] : [defaultNewClientPet.pet],
    petSpecificData: isLoggedIn ? undefined : { [defaultNewClientPet.pet.id]: defaultNewClientPet.petSpecific },
    existingClientNewPets: [],
    lookingForEuthanasia: '',
    lookingForEuthanasiaExisting: '',
    isThisTheAddressWhereWeWillCome: '',
    differentMailingAddress: '',
    hadVetCareElsewhere: '',
    mayWeAskForRecords: '',
    previousVeterinaryHospitals: '',
    haveWeSeenPetBefore: '',
    okayToContactPreviousVets: '',
    okayToContactPreviousVetsExisting: '',
    canWeText: '',
    serviceArea: '',
    serviceAreaVisit: '',
    interestedInOtherOptions: '',
    aftercarePreference: '',
    selectedDateTimeSlots: {},
    selectedDateTimeSlotsVisit: {},
    joinWaitlistIfSooner: false,
  };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [recommendedSlots, setRecommendedSlots] = useState<Array<{ date: string; time: string; display: string; iso: string }>>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [serviceMinutesUsed, setServiceMinutesUsed] = useState<number | null>(null); // Service minutes used for routing request
  const [showSelfScheduleModal, setShowSelfScheduleModal] = useState(false); // Self-schedule calendar modal
  const [scheduleModalRefreshKey, setScheduleModalRefreshKey] = useState(0);
  const [selfScheduleSlotError, setSelfScheduleSlotError] = useState<string | null>(null);
  const [highlightSchedulingNotes, setHighlightSchedulingNotes] = useState(false); // Briefly glow the preferences box
  const schedulingNotesRef = useRef<HTMLTextAreaElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const pendingValidationScrollRef = useRef<Record<string, string> | null>(null);
  const [submitSuccessKind, setSubmitSuccessKind] = useState<AppointmentFormSubmitSuccessKind>('request_received');
  const [showExistingClientModal, setShowExistingClientModal] = useState(false); // Modal for existing client notification
  const [emailCheckForModal, setEmailCheckForModal] = useState<{ exists: boolean; hasAccount: boolean } | null>(null); // Store email check result for modal
  const [existingClientModalView, setExistingClientModalView] = useState<'message' | 'login'>('message');
  const lastCheckedAddressRef = useRef<string>(''); // Track last checked address to avoid duplicate zone checks
  const lastFetchedVetsAddressRef = useRef<string>(''); // Vet lookup is separate from the zone gate
  const lastRecordedOosaAddressRef = useRef<string>(''); // Dedupe out-of-area interest POSTs
  const [zoneCheckStatus, setZoneCheckStatus] = useState<ZoneCheckStatus>('idle');
  const zoneCheckStatusRef = useRef<ZoneCheckStatus>('idle');
  zoneCheckStatusRef.current = zoneCheckStatus;
  const clientLocationRef = useRef<{ lat?: number; lon?: number; address?: string }>({}); // Store client location for veterinarian lookup
  const [speciesList, setSpeciesList] = useState<Array<{ id: number; name: string; prettyName?: string; showInUi?: boolean }>>([]); // List of available species
  const [loadingSpecies, setLoadingSpecies] = useState(false);
  const [clientLocationReady, setClientLocationReady] = useState(false); // Track when client location is available for veterinarian fetch
  const [serviceAreaNotifyEmail, setServiceAreaNotifyEmail] = useState('');
  const [serviceAreaNotifySubmitting, setServiceAreaNotifySubmitting] = useState(false);
  const [serviceAreaNotifyError, setServiceAreaNotifyError] = useState<string | null>(null);
  const [serviceAreaNotifySuccess, setServiceAreaNotifySuccess] = useState(false);
  const openExistingClientModal = (
    result: { exists: boolean; hasAccount: boolean },
    view: 'message' | 'login' = 'message',
  ) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setEmailCheckForModal(result);
    setExistingClientModalView(result.hasAccount ? 'login' : view);
    setShowExistingClientModal(true);
  };

  const closeExistingClientModal = () => {
    setShowExistingClientModal(false);
    setEmailCheckForModal(null);
    setExistingClientModalView('message');
  };

  const handleExistingClientLoginSuccess = () => {
    closeExistingClientModal();
    setEmailCheckResult(null);
  };

  const navigateToCreateClient = () => {
    const email = formData.email.trim();
    closeExistingClientModal();
    navigate('/create-client', { state: email ? { email } : undefined });
  };

  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [selectedMembershipPetId, setSelectedMembershipPetId] = useState<string | null>(null);
  type MembershipModalStep = 'choose-pet' | 'signup' | 'payment' | 'success';
  const [membershipModalStep, setMembershipModalStep] = useState<MembershipModalStep>('choose-pet');
  const [membershipPaymentState, setMembershipPaymentState] = useState<any>(null);
  const [lastSignedUpPetIds, setLastSignedUpPetIds] = useState<string[]>([]);
  const [selectedMembershipPet, setSelectedMembershipPet] = useState<EligiblePet | null>(null);
  // For logged-in users: patient ids with active/pending membership (from membership-transactions API)
  const [petIdsWithActiveOrPendingMembership, setPetIdsWithActiveOrPendingMembership] = useState<Set<string> | null>(null);
  // For logged-in users: pet ids (dbId or id) that have an active wellness plan (actual membership)
  const [petIdsWithActiveWellnessPlan, setPetIdsWithActiveWellnessPlan] = useState<Set<string> | null>(null);

  type NeedsTodayOption = { id: number; name: string; prettyName: string };
  const [appointmentTypeChangeModal, setAppointmentTypeChangeModal] = useState<{
    petId: string;
    option: NeedsTodayOption;
  } | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const APPOINTMENT_REQUEST_URL = import.meta.env.VITE_APPOINTMENT_REQUEST_URL || '/client-portal/request-appointment';
  const zoneSearchBufferMiles = getZoneSearchBufferMiles();

  // Appointment request promotion — resolved via URL token or manually entered code
  const [appointmentPromo, setAppointmentPromo] = useState<PublicAppointmentRequestPromotion | null>(null);
  const promoToken = searchParams.get(APPOINTMENT_PROMO_QUERY_PARAM) ?? null;
  const promoCodeFromQuery = searchParams.get(APPOINTMENT_PROMO_CODE_QUERY_PARAM)?.trim() || null;
  // Code entered manually by the client (no URL token present)
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoCodeApplying, setPromoCodeApplying] = useState(false);
  const [promoCodeError, setPromoCodeError] = useState<string | null>(null);
  const [appliedCodePromo, setAppliedCodePromo] = useState<PublicAppointmentRequestPromotion | null>(null);
  // True when the entered email already redeemed the URL-token promotion (one use per email)
  const [promoAlreadyUsed, setPromoAlreadyUsed] = useState(false);
  // The single active promo to display/submit (URL token wins over typed code)
  const activePromo = promoAlreadyUsed ? null : appointmentPromo ?? appliedCodePromo;
  const isExistingClientForPromo = isLoggedIn || formData.haveUsedServicesBefore === 'Yes';

  const currentPageRef = useRef<Page>(currentPage);
  const isLoggedInRef = useRef(isLoggedIn);
  const haveUsedServicesBeforeRef = useRef(formData.haveUsedServicesBefore);
  const formDataRef = useRef(formData);
  const userEmailRef = useRef(userEmail);
  const userIdRef = useRef(userId);
  const clientPimsIdRef = useRef<string | null>(null);
  currentPageRef.current = currentPage;
  isLoggedInRef.current = isLoggedIn;
  haveUsedServicesBeforeRef.current = formData.haveUsedServicesBefore;
  formDataRef.current = formData;
  userEmailRef.current = userEmail;
  userIdRef.current = userId;

  const getFormAnalyticsContext = useCallback(() => {
    const page = currentPageRef.current;
    const isExistingClient =
      isLoggedInRef.current || haveUsedServicesBeforeRef.current === 'Yes';
    return {
      form_session_id: formSessionIdRef.current,
      step: page,
      step_name: getAppointmentFormStepName(page),
      client_type: isExistingClient ? 'existing' : 'new',
      is_logged_in: isLoggedInRef.current,
    };
  }, []);

  const trackFormEvent = useCallback(
    (eventName: string, params?: Record<string, unknown>) => {
      trackEvent(eventName, { ...getFormAnalyticsContext(), ...params });
    },
    [getFormAnalyticsContext]
  );

  const gaAbandonTrackedRef = useRef(false);

  const getDraftSnapshotInput = useCallback((): AppointmentFormDraftSnapshotInput => {
    const fd = formDataRef.current;
    return {
      email: fd.email,
      userEmail: userEmailRef.current,
      fullName: fd.fullName,
      haveUsedServicesBefore: fd.haveUsedServicesBefore,
      phoneNumbers: fd.phoneNumbers,
      bestPhoneNumber: fd.bestPhoneNumber,
      canWeText: fd.canWeText,
      physicalAddress: fd.physicalAddress,
      newPhysicalAddress: fd.newPhysicalAddress,
      isThisTheAddressWhereWeWillCome: fd.isThisTheAddressWhereWeWillCome,
      selectedPetIds: fd.selectedPetIds,
      newClientPets: fd.newClientPets,
      existingClientNewPets: fd.existingClientNewPets,
      petSpecificData: fd.petSpecificData as Record<string, unknown> | undefined,
      howSoon: fd.howSoon,
      serviceArea: fd.serviceArea,
      serviceAreaVisit: fd.serviceAreaVisit,
      lookingForEuthanasia: fd.lookingForEuthanasia,
      lookingForEuthanasiaExisting: fd.lookingForEuthanasiaExisting,
      preferredDoctor: fd.preferredDoctor,
      preferredDoctorExisting: fd.preferredDoctorExisting,
      visitDetails: fd.visitDetails,
      needsUrgentScheduling: fd.needsUrgentScheduling,
      preferredDateTime: fd.preferredDateTime,
      preferredDateTimeVisit: fd.preferredDateTime,
      selectedDateTimeSlots: fd.selectedDateTimeSlots,
      selectedDateTimeSlotsVisit: fd.selectedDateTimeSlotsVisit,
      membershipInterest: fd.membershipInterest,
      howDidYouHearAboutUs: fd.howDidYouHearAboutUs,
      howDidYouHearAboutUsOther: fd.howDidYouHearAboutUsOther,
      anythingElse: fd.schedulingNotes,
      isLoggedIn: isLoggedInRef.current,
    };
  }, []);

  const trackGaAbandon = useCallback(
    (reason: string) => {
      if (gaAbandonTrackedRef.current) return;
      const page = currentPageRef.current;
      if (page === 'success') return;
      gaAbandonTrackedRef.current = true;
      trackFormEvent('appointment_form_abandoned', { abandon_reason: reason });
    },
    [trackFormEvent]
  );

  /** Stable identity: the draft hook keys its debounced save / abandon callbacks off this. */
  const getDraftStepName = useCallback((step: string) => getAppointmentFormStepName(step as Page), []);

  const { formSessionIdRef, markFormCompleted, sendAbandon, resetAbandonSent, shouldPersistDraft } =
    useAppointmentFormDraftPersistence({
      practiceId,
      currentPage,
      getSnapshotInput: getDraftSnapshotInput,
      getStepName: getDraftStepName,
      trackGaAbandon,
      activityKey: formData,
    });

  const clearOutOfServiceAreaUi = useCallback(() => {
    setServiceAreaNotifyError(null);
    setServiceAreaNotifySuccess(false);
    setServiceAreaNotifySubmitting(false);
    resetAbandonSent();
  }, [resetAbandonSent]);

  const recordOutOfServiceAreaInterest = useCallback(
    async (
      address: {
        line1?: string;
        city?: string;
        state?: string;
        zip?: string;
        lat?: number;
        lon?: number;
      },
      options?: { notifyRequested?: boolean; emailOverride?: string },
    ) => {
      const city = address.city?.trim();
      const state = address.state?.trim();
      if (!city || !state) return null;

      const addressKey = `${address.line1 ?? ''}|${city}|${state}|${address.zip ?? ''}`.toLowerCase();
      const notifyRequested = !!options?.notifyRequested;
      if (!notifyRequested && lastRecordedOosaAddressRef.current === addressKey) {
        return null;
      }

      const fd = formDataRef.current;
      const email =
        (options?.emailOverride ?? fd.email ?? userEmailRef.current ?? '')?.trim() || undefined;
      const phone = (fd.phoneNumbers || fd.bestPhoneNumber || '')?.trim() || undefined;
      const fullName = [fd.fullName?.first, fd.fullName?.last].filter(Boolean).join(' ').trim() || undefined;

      const result = await upsertServiceAreaInterest({
        practiceId,
        formSessionId: formSessionIdRef.current,
        city,
        state,
        zip: address.zip?.trim() || undefined,
        addressLine1: address.line1?.trim() || undefined,
        latitude: address.lat,
        longitude: address.lon,
        email,
        phone,
        fullName,
        notifyRequested,
        source: 'appointment_form',
      });

      lastRecordedOosaAddressRef.current = addressKey;
      return result;
    },
    [practiceId, formSessionIdRef],
  );

  const handleOutOfServiceArea = useCallback(
    async (address: {
      line1?: string;
      city?: string;
      state?: string;
      zip?: string;
      lat?: number;
      lon?: number;
    }) => {
      setErrors((prev) => ({ ...prev, zoneNotServiced: ZONE_NOT_SERVICED_MESSAGE }));
      setServiceAreaNotifySuccess(false);
      setServiceAreaNotifyError(null);
      const fd = formDataRef.current;
      const defaultEmail = (fd.email || userEmailRef.current || '').trim();
      if (defaultEmail) setServiceAreaNotifyEmail(defaultEmail);

      trackFormEvent('appointment_form_zone_not_serviced', {
        city: address.city?.trim() || undefined,
        state: address.state?.trim() || undefined,
      });

      try {
        await recordOutOfServiceAreaInterest(address);
      } catch (err) {
        console.warn('[AppointmentForm] Failed to record out-of-service-area interest:', err);
      }

      // Attribute this session as zone_not_serviced rather than a generic abandon.
      void sendAbandon('zone_not_serviced', { awaitPutThenPost: true });
    },
    [recordOutOfServiceAreaInterest, sendAbandon, trackFormEvent],
  );

  // Called from the address / zone-check effects, which must not re-run when these handlers change.
  const handleOutOfServiceAreaRef = useRef(handleOutOfServiceArea);
  const clearOutOfServiceAreaUiRef = useRef(clearOutOfServiceAreaUi);
  handleOutOfServiceAreaRef.current = handleOutOfServiceArea;
  clearOutOfServiceAreaUiRef.current = clearOutOfServiceAreaUi;

  const isExistingClientForZone =
    isLoggedIn || formData.haveUsedServicesBefore === 'Yes';
  const usingAlternateVisitAddress = isUsingAlternateVisitAddress(
    formData.isThisTheAddressWhereWeWillCome,
  );
  const allowOnFileOutOfAreaRequest = allowAppointmentRequestWhenOutOfArea({
    isExistingClient: isExistingClientForZone,
    usingAlternateVisitAddress,
  });

  const visitAddressForZoneCheck = useMemo(() => {
    if (isLoggedIn && formData.isThisTheAddressWhereWeWillCome === 'No') {
      return formatAddressForZoneCheck(formData.newPhysicalAddress);
    }
    const fromForm = formatAddressForZoneCheck(formData.physicalAddress);
    if (fromForm) return fromForm;
    if (isLoggedIn && formData.isThisTheAddressWhereWeWillCome !== 'No' && clientLocationReady) {
      return clientLocationRef.current.address?.trim() || '';
    }
    return '';
  }, [
    isLoggedIn,
    clientLocationReady,
    formData.isThisTheAddressWhereWeWillCome,
    formData.newPhysicalAddress?.line1,
    formData.newPhysicalAddress?.city,
    formData.newPhysicalAddress?.state,
    formData.newPhysicalAddress?.zip,
    formData.physicalAddress?.line1,
    formData.physicalAddress?.city,
    formData.physicalAddress?.state,
    formData.physicalAddress?.zip,
  ]);

  const zoneBlocksProgress = Boolean(
    visitAddressForZoneCheck &&
      (zoneCheckStatus === 'pending' ||
        zoneCheckStatus === 'idle' ||
        (zoneCheckStatus === 'out_of_service' && !allowOnFileOutOfAreaRequest)),
  );

  const visitAddressFieldsForZone = useCallback(() => {
    const fd = formDataRef.current;
    if (isLoggedIn && fd.isThisTheAddressWhereWeWillCome === 'No') {
      return fd.newPhysicalAddress ?? {};
    }
    return fd.physicalAddress ?? {};
  }, [isLoggedIn]);

  const confirmVisitZone = useCallback(
    async (address: string): Promise<Exclude<ZoneCheckStatus, 'idle' | 'pending'>> => {
      try {
        await http.get('/public/appointments/find-zone-by-address', {
          params: {
            address,
            buffer: zoneSearchBufferMiles,
          },
        });
        return 'in_service';
      } catch (zoneError: unknown) {
        const status = (zoneError as { response?: { status?: number } })?.response?.status;
        if (status === 404) return 'out_of_service';
        console.warn('[AppointmentForm] Zone check failed:', zoneError);
        return 'failed';
      }
    },
    [zoneSearchBufferMiles],
  );

  const applyZoneCheckResult = useCallback(
    (address: string, status: Exclude<ZoneCheckStatus, 'idle' | 'pending'>) => {
      lastCheckedAddressRef.current = address;
      setZoneCheckStatus(status);
      if (status === 'in_service') {
        setErrors((prev) => {
          const next = { ...prev };
          delete next.zoneNotServiced;
          return next;
        });
        clearOutOfServiceAreaUiRef.current();
        return;
      }
      if (status === 'out_of_service') {
        const fd = formDataRef.current;
        const allowRequest = allowAppointmentRequestWhenOutOfArea({
          isExistingClient: isLoggedIn || fd.haveUsedServicesBefore === 'Yes',
          usingAlternateVisitAddress: isUsingAlternateVisitAddress(
            fd.isThisTheAddressWhereWeWillCome,
          ),
        });
        if (allowRequest) {
          setErrors((prev) => {
            if (!prev.zoneNotServiced) return prev;
            const next = { ...prev };
            delete next.zoneNotServiced;
            return next;
          });
          clearOutOfServiceAreaUiRef.current();
          return;
        }
        void handleOutOfServiceAreaRef.current(visitAddressFieldsForZone());
        return;
      }
      setErrors((prev) => ({ ...prev, zoneNotServiced: ZONE_CHECK_FAILED_MESSAGE }));
    },
    [isLoggedIn, visitAddressFieldsForZone],
  );

  const ensureVisitZoneInService = useCallback(async (): Promise<boolean> => {
    const address = visitAddressForZoneCheck;
    if (!address) return true;
    if (
      zoneCheckStatusRef.current === 'in_service' &&
      lastCheckedAddressRef.current === address
    ) {
      return true;
    }

    setZoneCheckStatus('pending');
    const status = await confirmVisitZone(address);
    applyZoneCheckResult(address, status);
    if (status === 'in_service') return true;
    if (status === 'out_of_service') {
      const fd = formDataRef.current;
      return allowAppointmentRequestWhenOutOfArea({
        isExistingClient: isLoggedIn || fd.haveUsedServicesBefore === 'Yes',
        usingAlternateVisitAddress: isUsingAlternateVisitAddress(
          fd.isThisTheAddressWhereWeWillCome,
        ),
      });
    }
    return false;
  }, [isLoggedIn, visitAddressForZoneCheck, confirmVisitZone, applyZoneCheckResult]);

  useEffect(() => {
    if (!visitAddressForZoneCheck) {
      setZoneCheckStatus('idle');
      lastCheckedAddressRef.current = '';
      setErrors((prev) => {
        if (!prev.zoneNotServiced) return prev;
        const next = { ...prev };
        delete next.zoneNotServiced;
        return next;
      });
      clearOutOfServiceAreaUiRef.current();
      return;
    }

    if (lastCheckedAddressRef.current === visitAddressForZoneCheck) {
      return;
    }

    setZoneCheckStatus('pending');
    let alive = true;
    const timeoutId = setTimeout(() => {
      void (async () => {
        const status = await confirmVisitZone(visitAddressForZoneCheck);
        if (!alive) return;
        if (lastCheckedAddressRef.current === visitAddressForZoneCheck) return;
        applyZoneCheckResult(visitAddressForZoneCheck, status);
      })();
    }, 500);

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [visitAddressForZoneCheck, confirmVisitZone, applyZoneCheckResult]);

  const handleServiceAreaNotifySubmit = useCallback(async () => {
    const email = serviceAreaNotifyEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setServiceAreaNotifyError('Please enter a valid email so we can notify you.');
      return;
    }

    const addr =
      formDataRef.current.isThisTheAddressWhereWeWillCome === 'No'
        ? formDataRef.current.newPhysicalAddress
        : formDataRef.current.physicalAddress;
    if (!addr?.city?.trim() || !addr?.state?.trim()) {
      setServiceAreaNotifyError('We need the city and state from your address to notify you.');
      return;
    }

    setServiceAreaNotifySubmitting(true);
    setServiceAreaNotifyError(null);
    try {
      await recordOutOfServiceAreaInterest(
        {
          line1: addr.line1,
          city: addr.city,
          state: addr.state,
          zip: addr.zip,
          lat: (addr as { lat?: number }).lat,
          lon: (addr as { lon?: number }).lon,
        },
        { notifyRequested: true, emailOverride: email },
      );
      setServiceAreaNotifySuccess(true);
      trackFormEvent('appointment_form_service_area_notify', {
        city: addr.city.trim(),
        state: addr.state.trim(),
      });
      markFormCompleted();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Something went wrong. Please try again or call us.';
      setServiceAreaNotifyError(typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    } finally {
      setServiceAreaNotifySubmitting(false);
    }
  }, [
    serviceAreaNotifyEmail,
    recordOutOfServiceAreaInterest,
    trackFormEvent,
    markFormCompleted,
  ]);

  const renderServiceAreaNotifyPanel = (city?: string, state?: string) => {
    const areaLabel = [city, state].filter(Boolean).join(', ');
    return (
      <div
        style={{
          marginTop: '12px',
          padding: '12px',
          borderRadius: '8px',
          border: '1px solid #fecaca',
          background: '#fff7f7',
          color: '#374151',
        }}
      >
        {serviceAreaNotifySuccess ? (
          <div style={{ fontSize: '13px', color: '#065f46' }}>
            Thanks — we&apos;ll email you if we expand service to {areaLabel || 'your area'}.
          </div>
        ) : (
          <>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#111827' }}>
              Want a heads-up when we serve your area?
            </div>
            <div style={{ fontSize: '12px', marginBottom: '8px', color: '#4b5563' }}>
              Join our notify list and we&apos;ll reach out when coverage opens near {areaLabel || 'you'}.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <input
                type="email"
                value={serviceAreaNotifyEmail}
                onChange={(e) => setServiceAreaNotifyEmail(e.target.value)}
                placeholder="Email for updates"
                style={{
                  flex: '1 1 180px',
                  padding: '8px 10px',
                  border: `1px solid ${serviceAreaNotifyError ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              />
              <button
                type="button"
                onClick={() => void handleServiceAreaNotifySubmit()}
                disabled={serviceAreaNotifySubmitting}
                style={{
                  padding: '8px 14px',
                  borderRadius: '6px',
                  border: 'none',
                  background: serviceAreaNotifySubmitting ? '#9ca3af' : '#111827',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: serviceAreaNotifySubmitting ? 'default' : 'pointer',
                }}
              >
                {serviceAreaNotifySubmitting ? 'Saving…' : 'Notify me'}
              </button>
            </div>
            {serviceAreaNotifyError && (
              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>
                {serviceAreaNotifyError}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const renderVisitZoneStatus = (city?: string, state?: string) => {
    if (zoneCheckStatus === 'pending' && visitAddressForZoneCheck) {
      return (
        <div data-form-field="zoneNotServiced" style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
          Confirming we serve your area…
        </div>
      );
    }
    if (
      zoneCheckStatus === 'out_of_service' &&
      allowOnFileOutOfAreaRequest &&
      !errors.zoneNotServiced
    ) {
      return (
        <div data-form-field="zoneNotServiced" style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
          {ON_FILE_OUT_OF_AREA_REQUEST_ONLY_MESSAGE}
        </div>
      );
    }
    if (!errors.zoneNotServiced) return null;
    return (
      <div data-form-field="zoneNotServiced" style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
        {renderZoneNotServicedMessage(errors.zoneNotServiced)}
        {zoneCheckStatus === 'out_of_service' && renderServiceAreaNotifyPanel(city, state)}
      </div>
    );
  };

  useEffect(() => {
    trackFormEvent('appointment_form_started', {
      entry_step: currentPageRef.current,
      entry_step_name: getAppointmentFormStepName(currentPageRef.current),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Intro: browser back leaves the route (e.g. after in-form Previous from new-client).
  useEffect(() => {
    if (currentPage !== 'intro') return;

    if (shouldPersistDraft()) {
      const state = window.history.state;
      if (!state?.formPage || state.formPage !== 'intro') {
        window.history.pushState({ formPage: 'intro', preventBack: true }, '', window.location.href);
      }
    }

    const handleIntroPopState = () => {
      void sendAbandon('browser_back', { awaitPutThenPost: true });
    };

    window.addEventListener('popstate', handleIntroPopState);
    return () => window.removeEventListener('popstate', handleIntroPopState);
  }, [currentPage, shouldPersistDraft, sendAbandon]);

  useEffect(() => {
    if (!appointmentTypeChangeModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAppointmentTypeChangeModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appointmentTypeChangeModal]);

  // Handle responsive layout
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Get appointment type by name
  const getAppointmentTypeByName = (name: string): AppointmentType | undefined => {
    return appointmentTypes.find(type => type.name === name);
  };

  // Get appointment type by prettyName
  const getAppointmentTypeByPrettyName = (prettyName: string): AppointmentType | undefined => {
    return appointmentTypes.find(type => type.prettyName === prettyName);
  };

  // Get appointment type by either name or prettyName (for backward compatibility)
  const getAppointmentType = (value: string): AppointmentType | undefined => {
    return getAppointmentTypeByPrettyName(value) || getAppointmentTypeByName(value);
  };

  // Check if an appointment type is euthanasia by its name or prettyName
  const isEuthanasiaAppointmentType = (appointmentTypeValue: string): boolean => {
    const type = getAppointmentType(appointmentTypeValue);
    if (type) {
      return type.name === 'Euthanasia';
    }
    // Fallback for backward compatibility
    return appointmentTypeValue === 'Euthanasia' || appointmentTypeValue.toLowerCase().includes('euthanasia');
  };

  // Helper to check if appointment type name matches common patterns (for placeholders)
  const matchesAppointmentTypeName = (appointmentTypeValue: string, patterns: string[]): boolean => {
    const type = getAppointmentType(appointmentTypeValue);
    if (!type) return false;
    const nameLower = type.name.toLowerCase();
    const prettyNameLower = type.prettyName.toLowerCase();
    return patterns.some(pattern => 
      nameLower.includes(pattern.toLowerCase()) || 
      prettyNameLower.includes(pattern.toLowerCase())
    );
  };

  // Get appointment type options for the form
  // Returns array of objects with id, name and prettyName, sorted to show euthanasia last if present
  // Filters by newPatientAllowed for new patients
  // @param petId Optional pet ID to check if this specific pet is a new patient
  const getAppointmentTypeOptions = (petId?: string): Array<{ id: number; name: string; prettyName: string }> => {
    if (loadingAppointmentTypes || appointmentTypes.length === 0) {
      return []; // Return empty array while loading
    }
    
    // Determine if this is a new patient
    // New patient = not logged in AND haven't used services before
    const isNewPatient = !isLoggedIn && formData.haveUsedServicesBefore !== 'Yes';
    
    // Check if the specific pet (if provided) is a new pet for an existing client
    const isNewPetForExistingClient = petId && isLoggedIn && 
      formData.existingClientNewPets?.some(pet => pet.id === petId);
    
    // Filter appointment types based on newPatientAllowed for new patients
    // This is a safeguard in case the API didn't filter correctly
    let filteredTypes = appointmentTypes;
    if (isNewPatient) {
      // For new patients, only show appointment types where newPatientAllowed is true
      filteredTypes = appointmentTypes.filter(type => type.newPatientAllowed === true);
    } else if (isNewPetForExistingClient) {
      // For existing clients with new patients, only show appointment types where newPatientAllowed is true
      // (if the flag is false, new patients should NOT see that appointment type)
      filteredTypes = appointmentTypes.filter(type => type.newPatientAllowed === true);
    }

    // The Pre-Meds type never appears as a reason card — the calming-meds
    // checkbox applies it behind the scenes. Only form-visible types show here.
    filteredTypes = filteredTypes.filter((type) => type.showInApptRequestForm === true);
    
    const sortedTypes = sortAppointmentTypesForPicker(filteredTypes, {
      unrankedOrder: 'alphabetical',
    });

    return sortedTypes.map((type) => ({
      id: type.id,
      name: type.name,
      prettyName: type.prettyName || type.name,
    }));
  };

  // Get all selected appointment type names from the form
  // Returns a Set of unique appointment type names (converted from prettyNames) selected across all pets
  const getSelectedAppointmentTypes = (): Set<string> => {
    const selectedTypes = new Set<string>();
    
    // Helper to convert prettyName to name for veterinarian matching
    const convertPrettyNameToName = (prettyName: string): string => {
      const type = getAppointmentTypeByPrettyName(prettyName);
      return type?.name || prettyName; // Fallback to prettyName if not found
    };
    
    // Check selectedPetIds (existing pets)
    if (formData.selectedPetIds && formData.petSpecificData) {
      formData.selectedPetIds.forEach(petId => {
        const petData = formData.petSpecificData?.[petId];
        if (petData?.needsToday) {
          // needsToday now stores prettyName, convert to name for veterinarian matching
          const typeName = convertPrettyNameToName(petData.needsToday);
          selectedTypes.add(typeName);
        }
      });
    }
    
    // Check newClientPets
    if (formData.newClientPets && formData.petSpecificData) {
      formData.newClientPets.forEach(pet => {
        const petData = formData.petSpecificData?.[pet.id];
        if (petData?.needsToday) {
          const typeName = convertPrettyNameToName(petData.needsToday);
          selectedTypes.add(typeName);
        }
      });
    }
    
    // Check existingClientNewPets
    if (formData.existingClientNewPets && formData.petSpecificData) {
      formData.existingClientNewPets.forEach(pet => {
        const petData = formData.petSpecificData?.[pet.id];
        if (petData?.needsToday) {
          const typeName = convertPrettyNameToName(petData.needsToday);
          selectedTypes.add(typeName);
        }
      });
    }
    
    return selectedTypes;
  };

  // Filter veterinarians to only include those who accept ALL selected appointment types
  // Takes raw veterinarian data and filters based on appointment type names (not prettyNames)
  const filterVeterinariansByAppointmentTypes = (veterinarians: any[]): any[] => {
    const selectedTypes = getSelectedAppointmentTypes();
    
    // If no appointment types are selected yet, return all veterinarians
    if (selectedTypes.size === 0) {
      return veterinarians;
    }
    
    return veterinarians.filter((vet) => {
      // Get all appointment type names that this veterinarian accepts
      const vetAppointmentTypes = new Set<string>();
      if (vet.appointmentTypes && Array.isArray(vet.appointmentTypes)) {
        vet.appointmentTypes.forEach((aptType: any) => {
          // Use the name field, not prettyName (selectedTypes contains appointment type names)
          if (aptType.name) {
            vetAppointmentTypes.add(aptType.name);
          }
        });
      }
      
      // Check if veterinarian accepts ALL selected appointment types
      // Only include veterinarians who have all selected types in their appointmentTypes array
      for (const selectedType of selectedTypes) {
        if (!vetAppointmentTypes.has(selectedType)) {
          return false; // This veterinarian doesn't accept this appointment type
        }
      }
      
      return true; // Veterinarian accepts all selected appointment types
    });
  };

  type PetSpecificSlice = NonNullable<FormData['petSpecificData']>[string];

  /** True if the user entered any details under the currently selected appointment type. */
  const petHasEnteredDetailsForCurrentAppointmentType = (petData: PetSpecificSlice | undefined): boolean => {
    if (!petData) return false;
    const sel = petData.needsToday;
    if (!sel?.trim()) return false;
    if (isEuthanasiaAppointmentType(sel)) {
      const t = (v: string | undefined) => (v ?? '').trim();
      return (
        t(petData.euthanasiaReason) !== '' ||
        t(petData.interestedInOtherOptions as unknown as string) !== '' ||
        t(petData.aftercarePreference) !== ''
      );
    }
    return (petData.needsTodayDetails ?? '').trim() !== '';
  };

  const applyPetNeedsTodaySelection = (petId: string, option: NeedsTodayOption) => {
    setFormData(prev => {
      const petMap = { ...(prev.petSpecificData || {}) };
      const existing = petMap[petId] || {};
      petMap[petId] = {
        ...existing,
        needsToday: option.prettyName,
        appointmentTypeId: option.id,
        appointmentTypeName: option.name,
        needsTodayDetails: '',
        euthanasiaReason: '',
        beenToVetLastThreeMonths: '',
        interestedInOtherOptions: '',
        aftercarePreference: '',
      };
      return { ...prev, petSpecificData: petMap };
    });

    setErrors(prev => {
      const keys = [
        `needsToday.${petId}`,
        `needsTodayDetails.${petId}`,
        `euthanasiaReason.${petId}`,
        `beenToVetLastThreeMonths.${petId}`,
        `interestedInOtherOptions.${petId}`,
        `aftercarePreference.${petId}`,
      ];
      let touched = false;
      const next = { ...prev };
      for (const k of keys) {
        if (next[k] !== undefined) {
          delete next[k];
          touched = true;
        }
      }
      return touched ? next : prev;
    });
  };

  const attemptPetNeedsTodayChange = (
    petId: string,
    option: NeedsTodayOption,
    currentPetData: PetSpecificSlice | undefined,
  ) => {
    const cur = currentPetData;
    const alreadySelected =
      (cur?.needsToday === option.prettyName) || (cur?.needsToday === option.name);
    if (alreadySelected) return;

    const hadPriorSelection = !!(cur?.needsToday && cur.needsToday.trim());
    if (hadPriorSelection && petHasEnteredDetailsForCurrentAppointmentType(cur)) {
      setAppointmentTypeChangeModal({ petId, option });
      return;
    }

    applyPetNeedsTodaySelection(petId, option);
  };

  /**
   * Existing chart pets: calming-meds checkbox only records the flag. The pet
   * keeps its picked visit reason; the Pre-Meds type is applied behind the
   * scenes for the arrival window, validation, and the booked appointment.
   */
  const handleUsesCalmingMedicationsChange = (petId: string, checked: boolean) => {
    const calmingValue: 'Yes' | 'No' = checked ? 'Yes' : 'No';
    const premedId = findCalmingPremedAppointmentType(appointmentTypes)?.id;
    setFormData((prev) => {
      const petMap = { ...(prev.petSpecificData || {}) };
      const existing = petMap[petId] || {};
      // Clean up drafts from the old behavior where checking swapped the pet's
      // visible reason to the Pre-Meds type: unchecking clears that selection.
      const hadPremedSelected =
        !checked &&
        premedId != null &&
        existing.appointmentTypeId != null &&
        Number(existing.appointmentTypeId) === Number(premedId);
      petMap[petId] = {
        ...existing,
        needsCalmingMedications: calmingValue,
        ...(hadPremedSelected
          ? { needsToday: '', appointmentTypeId: undefined, appointmentTypeName: '' }
          : {}),
      };
      return { ...prev, petSpecificData: petMap };
    });
  };

  /** Include only fields that apply to the selected appointment type (payload / persistence). */
  const sanitizePetSpecificDataForPayload = (
    raw: FormData['petSpecificData'],
  ): FormData['petSpecificData'] | undefined => {
    if (!raw) return undefined;
    const out: NonNullable<FormData['petSpecificData']> = {};
    for (const [petId, petData] of Object.entries(raw)) {
      const sel = petData.needsToday;
      const base: PetSpecificSlice = {
        needsToday: petData.needsToday,
        appointmentTypeId: petData.appointmentTypeId,
        appointmentTypeName: petData.appointmentTypeName,
        ...(petData.needsCalmingMedications
          ? { needsCalmingMedications: petData.needsCalmingMedications }
          : {}),
      };
      if (!sel?.trim()) {
        out[petId] = base;
        continue;
      }
      if (isEuthanasiaAppointmentType(sel)) {
        out[petId] = {
          ...base,
          euthanasiaReason: petData.euthanasiaReason,
          beenToVetLastThreeMonths: petData.beenToVetLastThreeMonths,
          interestedInOtherOptions: petData.interestedInOtherOptions,
          aftercarePreference: petData.aftercarePreference,
        };
      } else {
        out[petId] = {
          ...base,
          needsTodayDetails: petData.needsTodayDetails,
        };
      }
    }
    return out;
  };

  const calmingPremedAppointmentType = useMemo(
    () => findCalmingPremedAppointmentType(appointmentTypes),
    [appointmentTypes],
  );

  const calmingPremedTypeOption = useMemo((): AppointmentTypeCardOption | null => {
    if (!calmingPremedAppointmentType) return null;
    return {
      id: calmingPremedAppointmentType.id,
      name: calmingPremedAppointmentType.name,
      prettyName: calmingPremedAppointmentType.prettyName || calmingPremedAppointmentType.name,
    };
  }, [calmingPremedAppointmentType]);

  // Prefer the Pre-Meds type when any pet uses it: availability search and the
  // slot arrival window then use its (wider) window for the whole household,
  // while each pet keeps its own appointment type on the booked calendar visits.
  const selectedChartPetUsesCalmingMedications = useMemo(
    () =>
      formData.selectedPetIds.some(
        (petId) =>
          formData.petSpecificData?.[petId]?.needsCalmingMedications === 'Yes',
      ),
    [formData.selectedPetIds, formData.petSpecificData],
  );
  const primaryAppointmentTypeId = useMemo(
    () => {
      // The checkbox is authoritative for the household window. Do not rely on
      // the per-pet type update having rendered before availability opens.
      if (
        selectedChartPetUsesCalmingMedications &&
        calmingPremedAppointmentType?.id != null
      ) {
        return Number(calmingPremedAppointmentType.id);
      }
      return resolvePrimaryAppointmentTypeId(formData, {
        preferredTypeId: calmingPremedAppointmentType?.id,
      });
    },
    [
      formData.selectedPetIds,
      formData.newClientPets,
      formData.existingClientNewPets,
      formData.petSpecificData,
      calmingPremedAppointmentType?.id,
      selectedChartPetUsesCalmingMedications,
    ],
  );

  // Online-booking eligibility uses the client's picked visit reasons only.
  // Pre-Meds is applied behind the scenes for the arrival window / booked type
  // and is usually not on doctors' allow-online lists (hidden from the form).
  const visitAppointmentTypeIds = useMemo(
    () => resolveVisitAppointmentTypeIdsFromFormData(formData),
    [
      formData.selectedPetIds,
      formData.newClientPets,
      formData.existingClientNewPets,
      formData.petSpecificData,
    ],
  );

  const primaryAppointmentType = useMemo(
    () =>
      appointmentTypes.find((type) => Number(type.id) === Number(primaryAppointmentTypeId)),
    [appointmentTypes, primaryAppointmentTypeId],
  );

  const rawVeterinarianList = isLoggedIn ? rawVeterinarians : rawPublicVeterinarians;

  const isNewPatientRequest = !isLoggedIn && formData.haveUsedServicesBefore !== 'Yes';

  const petsInVisitWithHandlingQuestion = useMemo(
    () => [...(formData.newClientPets ?? []), ...(formData.existingClientNewPets ?? [])],
    [formData.newClientPets, formData.existingClientNewPets],
  );

  const handlingNeedsAllowOnlineScheduling = useMemo(
    () => petsAllowOnlineScheduling(petsInVisitWithHandlingQuestion),
    [petsInVisitWithHandlingQuestion],
  );

  const speciesAllowOnlineScheduling = useMemo(
    () => petsSpeciesAllowOnlineScheduling(petsInVisitWithHandlingQuestion),
    [petsInVisitWithHandlingQuestion],
  );

  const onlineBookingOffered = useMemo(() => {
    if (zoneCheckStatus === 'out_of_service') return false;
    if (!handlingNeedsAllowOnlineScheduling) return false;
    if (!speciesAllowOnlineScheduling) return false;
    if (visitAppointmentTypeIds.length === 0) return false;
    if (isNewPatientRequest) {
      return anyDoctorCanBookOnlineForNewPatientRequestForVisitTypes(
        rawVeterinarianList,
        visitAppointmentTypeIds,
      );
    }
    return anyDoctorCanBookOnlineForVisitTypes(rawVeterinarianList, visitAppointmentTypeIds);
  }, [
    zoneCheckStatus,
    visitAppointmentTypeIds,
    rawVeterinarianList,
    isNewPatientRequest,
    handlingNeedsAllowOnlineScheduling,
    speciesAllowOnlineScheduling,
  ]);

  const bookableProvidersForScheduling = useMemo(() => {
    const list = isLoggedIn
      ? providers
      : (publicProviders.length > 0 ? publicProviders : providers);
    if (visitAppointmentTypeIds.length === 0) return list;
    return list.filter((p) => {
      const raw = resolveRawVeterinarianById(rawVeterinarianList, p.id);
      return isNewPatientRequest
        ? canBookOnlineForNewPatientRequestForVisitTypes(raw, visitAppointmentTypeIds)
        : canBookOnlineForVisitTypes(raw, visitAppointmentTypeIds);
    });
  }, [
    isLoggedIn,
    providers,
    publicProviders,
    visitAppointmentTypeIds,
    rawVeterinarianList,
    isNewPatientRequest,
  ]);

  const schedulingProvidersInZone = useMemo(() => {
    return isLoggedIn
      ? providers
      : (publicProviders.length > 0 ? publicProviders : providers);
  }, [isLoggedIn, providers, publicProviders]);

  /**
   * Chart primary for doctor cards — first selected pet's provider in zone
   * (bookable or request-only), used for badge and leftmost ordering.
   */
  const chartPrimaryProviderDoctorId = useMemo<string | number | undefined>(() => {
    const list = schedulingProvidersInZone;
    if (list.length === 0 && rawVeterinarianList.length === 0) return undefined;

    if (isLoggedIn && formData.selectedPetIds.length > 0) {
      const petById = new Map(pets.map((p) => [p.id, p]));
      for (const petId of formData.selectedPetIds) {
        const pet = petById.get(petId);
        if (!pet) continue;
        const resolved = resolveProviderDoctorIdInList(
          pet.primaryProviderId,
          pet.primaryProviderName,
          list,
          rawVeterinarianList,
        );
        if (resolved != null) return resolved;
      }
      return undefined;
    }

    return resolveProviderDoctorIdInList(
      primaryProviderId,
      primaryProviderName,
      list,
      rawVeterinarianList,
    );
  }, [
    schedulingProvidersInZone,
    rawVeterinarianList,
    isLoggedIn,
    pets,
    formData.selectedPetIds,
    primaryProviderId,
    primaryProviderName,
  ]);

  /**
   * Default doctor for self-scheduling: first selected pet whose chart primary
   * provider is present in the online-bookable doctor list.
   */
  const primaryProviderDoctorId = useMemo<string | number | undefined>(() => {
    const list = bookableProvidersForScheduling;
    if (list.length === 0 && rawVeterinarianList.length === 0) return undefined;

    if (isLoggedIn && formData.selectedPetIds.length > 0) {
      const petById = new Map(pets.map((p) => [p.id, p]));
      for (const petId of formData.selectedPetIds) {
        const pet = petById.get(petId);
        if (!pet) continue;
        const resolved = resolveProviderDoctorIdInList(
          pet.primaryProviderId,
          pet.primaryProviderName,
          list,
          rawVeterinarianList,
        );
        if (resolved != null) return resolved;
      }
      return undefined;
    }

    return resolveProviderDoctorIdInList(
      primaryProviderId,
      primaryProviderName,
      list,
      rawVeterinarianList,
    );
  }, [
    bookableProvidersForScheduling,
    rawVeterinarianList,
    isLoggedIn,
    pets,
    formData.selectedPetIds,
    primaryProviderId,
    primaryProviderName,
  ]);

  const routingVisitPets = useMemo(
    () =>
      buildRoutingVisitPetsFromFormData(formData, {
        isNewPatientRequest,
        primaryAppointmentTypeId,
      }),
    [
      formData.selectedPetIds,
      formData.newClientPets,
      formData.existingClientNewPets,
      formData.petSpecificData,
      isNewPatientRequest,
      primaryAppointmentTypeId,
    ],
  );

  const onlineBookingPatientIds = useMemo(
    () =>
      selectedPatientDbIdsFromForm({
        selectedPetIds: formData.selectedPetIds,
        pets,
      }),
    [formData.selectedPetIds, pets],
  );

  const [resolvedServiceMinutes, setResolvedServiceMinutes] = useState<number | null>(null);

  const routingServiceMinutesDoctorId =
    formData.selfScheduledSlot?.doctorId ??
    primaryProviderDoctorId ??
    chartPrimaryProviderDoctorId ??
    formData.preferredDoctorExisting ??
    formData.preferredDoctor;

  useEffect(() => {
    const newPatientCount = routingVisitNewPatientCount({
      isNewPatientRequest,
      selectedPetIds: formData.selectedPetIds,
      newClientPets: formData.newClientPets,
      existingClientNewPets: formData.existingClientNewPets,
    });
    const numPets = routingVisitPetCount(formData);
    const fallbackEstimate = () =>
      estimateRoutingServiceMinutesForVisit(
        routingVisitPets,
        [],
        (id) => appointmentTypes.find((type) => Number(type.id) === Number(id)),
        (key) => appointmentTypeForRoutingStatsKey(key, appointmentTypes),
        { newPatientCount, numPets },
      ).serviceMinutes;

    if (routingVisitPets.length === 0 || routingServiceMinutesDoctorId == null) {
      setResolvedServiceMinutes(routingVisitPets.length > 0 ? fallbackEstimate() : null);
      return;
    }

    let cancelled = false;
    void fetchRoutingServiceMinutes({
      practiceId,
      doctorId: routingServiceMinutesDoctorId,
      visitPets: routingVisitPets,
    })
      .then((result) => {
        if (!cancelled) setResolvedServiceMinutes(result.serviceMinutes);
      })
      .catch(() => {
        if (!cancelled) setResolvedServiceMinutes(fallbackEstimate());
      });

    return () => {
      cancelled = true;
    };
  }, [
    routingVisitPets,
    routingServiceMinutesDoctorId,
    practiceId,
    appointmentTypes,
    isNewPatientRequest,
    formData.selectedPetIds,
    formData.newClientPets,
    formData.existingClientNewPets,
  ]);

  /** True while vet list is still loading — avoids flashing the manual-scheduling banner. */
  const onlineBookingAvailabilityPending = useMemo(() => {
    if (!handlingNeedsAllowOnlineScheduling || visitAppointmentTypeIds.length === 0) return false;
    if (errors.zoneNotServiced) return false;
    if (loadingVeterinarians) return true;

    if (isLoggedIn) {
      if (formData.isThisTheAddressWhereWeWillCome === 'No') {
        if (!isPhysicalAddressComplete(formData.newPhysicalAddress)) return false;
      } else if (!clientLocationReady) {
        return true;
      }
    } else if (!isPhysicalAddressComplete(formData.physicalAddress)) {
      return false;
    }

    return !veterinariansFetchResolved;
  }, [
    handlingNeedsAllowOnlineScheduling,
    visitAppointmentTypeIds,
    errors.zoneNotServiced,
    loadingVeterinarians,
    isLoggedIn,
    formData.isThisTheAddressWhereWeWillCome,
    formData.newPhysicalAddress,
    formData.physicalAddress,
    clientLocationReady,
    veterinariansFetchResolved,
  ]);

  const slotDoctorAllowsOnlineBooking = useMemo(() => {
    if (!formData.selfScheduledSlot || visitAppointmentTypeIds.length === 0) return false;
    const raw = resolveRawVeterinarianById(rawVeterinarianList, formData.selfScheduledSlot.doctorId);
    if (isNewPatientRequest) {
      return canBookOnlineForNewPatientRequestForVisitTypes(raw, visitAppointmentTypeIds);
    }
    return canBookOnlineForVisitTypes(raw, visitAppointmentTypeIds);
  }, [
    formData.selfScheduledSlot,
    visitAppointmentTypeIds,
    rawVeterinarianList,
    isNewPatientRequest,
  ]);

  const isOnlineBookingSubmit = Boolean(
    formData.selfScheduledSlot &&
      slotDoctorAllowsOnlineBooking &&
      speciesAllowOnlineScheduling,
  );

  const selfScheduleExpectedServiceMinutes = resolvedServiceMinutes;

  useEffect(() => {
    if (resolvedServiceMinutes != null) {
      setServiceMinutesUsed(resolvedServiceMinutes);
    }
  }, [resolvedServiceMinutes]);

  // Keep the confirmed slot when server-resolved service minutes arrive — only
  // update the duration estimate. Clearing the slot caused submissions without
  // onlineBooking/selectedDateTimePreferences (no auto-book on the server).
  useEffect(() => {
    if (selfScheduleExpectedServiceMinutes == null) return;
    const slot = formData.selfScheduledSlot;
    if (!slot || slot.serviceMinutes === selfScheduleExpectedServiceMinutes) return;
    setFormData((prev) => {
      if (!prev.selfScheduledSlot) return prev;
      return {
        ...prev,
        selfScheduledSlot: {
          ...prev.selfScheduledSlot,
          serviceMinutes: selfScheduleExpectedServiceMinutes,
        },
      };
    });
  }, [selfScheduleExpectedServiceMinutes, formData.selfScheduledSlot]);

  useEffect(() => {
    if (!onlineBookingOffered) {
      setFormData((prev) => {
        if (!prev.selfScheduledSlot) return prev;
        return { ...prev, selfScheduledSlot: null };
      });
      setShowSelfScheduleModal(false);
    }
  }, [onlineBookingOffered]);

  // Convert raw veterinarian data to PublicProvider format
  const mapRawVeterinarianToPublicProvider = (vet: any): PublicProvider => {
    const id = vet.id ?? vet.pimsId ?? vet.employeeId;
    
    // Build name from title, firstName, lastName, and designation
    const nameParts: string[] = [];
    if (vet.title) nameParts.push(vet.title);
    if (vet.firstName) nameParts.push(vet.firstName);
    if (vet.lastName) nameParts.push(vet.lastName);
    if (vet.designation) nameParts.push(vet.designation);
    
    const name = nameParts.length > 0 
      ? nameParts.join(' ')
      : (`${vet.firstName || ''} ${vet.lastName || ''}`.trim() || `Veterinarian ${id ?? ''}`);
    
    return {
      id: id,
      name: name,
      email: vet?.email,
    };
  };

  // Convert raw veterinarian data to Provider format
  const mapRawVeterinarianToProvider = (vet: any): Provider => {
    const pimsId = vet.pimsId ? String(vet.pimsId) : null;
    const id = vet.id ?? vet.pimsId;
    
    // Build name from firstName, middleName, lastName
    const nameParts: string[] = [];
    if (vet.firstName) nameParts.push(vet.firstName);
    if (vet.middleName || vet.middleInitial) {
      const middle = vet.middleInitial || (vet.middleName ? vet.middleName.charAt(0).toUpperCase() : '');
      if (middle) nameParts.push(middle);
    }
    if (vet.lastName) nameParts.push(vet.lastName);
    
    const name = nameParts.length > 0 
      ? nameParts.join(' ').trim()
      : (vet.name || `Provider ${id ?? ''}`);
    
    return {
      id: id,
      pimsId: pimsId || String(id),
      email: vet?.email || '',
      name: name,
      dailyRevenueGoal: vet?.dailyRevenueGoal ?? null,
      bonusRevenueGoal: vet?.bonusRevenueGoal ?? null,
      dailyPointGoal: vet?.dailyPointGoal ?? null,
      weeklyPointGoal: vet?.weeklyPointGoal ?? null,
    };
  };

  // Find available appointment slots
  const findAvailableSlots = async () => {
    const selectedDoctor = formData.preferredDoctorExisting || formData.preferredDoctor;
    if (!selectedDoctor || selectedDoctor === 'I have no preference') {
      console.log('[AppointmentForm] No doctor selected');
      setRecommendedSlots([]);
      return;
    }

    // Extract doctor ID from provider name
    const providerList = isLoggedIn ? providers : (publicProviders.length > 0 ? publicProviders.map(p => ({
      id: p.id,
      name: p.name,
      email: p.email || '',
      pimsId: p.id,
    })) : providers);
    
    const doctor = resolveProviderFromDoctorName(selectedDoctor, providerList);
    
    if (!doctor) {
      console.log('[AppointmentForm] Doctor not found:', selectedDoctor, 'Available providers:', providers.map(p => p.name));
      setRecommendedSlots([]);
      return;
    }

    // Use database employee id when available
    const doctorId = doctor.id != null ? String(doctor.id) : (doctor.pimsId ? String(doctor.pimsId) : undefined);
    if (!doctorId) {
      setRecommendedSlots([]);
      return;
    }

    setLoadingSlots(true);
    try {
      // Get address from form data
      const address = formData.physicalAddress?.line1 || formData.newPhysicalAddress?.line1;
      const city = formData.physicalAddress?.city || formData.newPhysicalAddress?.city;
      const state = formData.physicalAddress?.state || formData.newPhysicalAddress?.state;
      const zip = formData.physicalAddress?.zip || formData.newPhysicalAddress?.zip;
      
      // Build full address string
      const addressParts = [address, city, state, zip].filter(Boolean);
      const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined;
      
      // Get coordinates - try to validate address if we have one (only for logged-in clients)
      let lat: number | undefined;
      let lon: number | undefined;
      let validatedAddress: string | undefined = fullAddress;
      
      // Only do geocoding for logged-in clients (skip for new clients)
      if (fullAddress && isLoggedIn) {
        try {
          const validation = await validateAddress(fullAddress, { minLevel: 'street' });
          if (validation.ok) {
            lat = validation.result.lat;
            lon = validation.result.lon;
            validatedAddress = validation.result.address;
            console.log('[AppointmentForm] Validated address:', validatedAddress, 'lat:', lat, 'lon:', lon);
          } else {
            console.warn('[AppointmentForm] Address validation failed:', validation.message);
          }
        } catch (err) {
          console.warn('[AppointmentForm] Address validation error:', err);
        }
      }
      
      // If we don't have coordinates, we can still try the routing API but it may not work as well
      if (!lat || !lon) {
        console.warn('[AppointmentForm] No coordinates available, routing may not work optimally');
      }

      // Calculate date range based on howSoon selection using day offsets from today
      // All ranges are inclusive and based on today = day 0
      const today = DateTime.now();
      let startDate: string | null = null;
      let numDays: number = 0;
      
      if (formData.howSoon) {
        const howSoon = formData.howSoon;
        if (isManualSchedulingHowSoon(howSoon)) {
          setRecommendedSlots([]);
          setLoadingSlots(false);
          return;
        }
        if (URGENT_HOW_SOON_VALUES.has(howSoon)) {
          startDate = today.toISODate();
          numDays = 4;
        } else if (howSoon === "I'm not sure") {
          startDate = today.plus({ days: 1 }).toISODate();
          numDays = 14;
        } else if (SOON_WEEK_HOW_SOON_VALUES.has(howSoon)) {
          startDate = today.plus({ days: 1 }).toISODate();
          numDays = 7;
        } else if (FLEXIBLE_HOW_SOON_VALUES.has(howSoon)) {
          startDate = today.plus({ days: 4 }).toISODate();
          numDays = 39;
        } else {
          startDate = today.plus({ days: 1 }).toISODate();
          numDays = 42;
        }
      } else {
        // Default fallback if no selection
        startDate = today.plus({ days: 1 }).toISODate();
        numDays = 42;
      }

      if (!startDate) {
        console.error('[AppointmentForm] Failed to calculate start date');
        setRecommendedSlots([]);
        return;
      }

      // Doctor-specific service minutes (server stats when possible)
      let serviceMinutes = resolvedServiceMinutes;
      if (serviceMinutes == null && routingVisitPets.length > 0 && doctorId) {
        try {
          const resolved = await fetchRoutingServiceMinutes({
            practiceId,
            doctorId,
            visitPets: routingVisitPets,
          });
          serviceMinutes = resolved.serviceMinutes;
        } catch {
          serviceMinutes = estimateRoutingServiceMinutesForVisit(
            routingVisitPets,
            [],
            (id) => appointmentTypes.find((type) => Number(type.id) === Number(id)),
            (key) => appointmentTypeForRoutingStatsKey(key, appointmentTypes),
            {
              newPatientCount: routingVisitNewPatientCount({
                isNewPatientRequest,
                selectedPetIds: formData.selectedPetIds,
                newClientPets: formData.newClientPets,
                existingClientNewPets: formData.existingClientNewPets,
              }),
              numPets: routingVisitPetCount(formData),
            },
          ).serviceMinutes;
        }
      }
      if (serviceMinutes == null) {
        serviceMinutes = estimateRoutingServiceMinutesForVisit(
          routingVisitPets.length > 0
            ? routingVisitPets
            : primaryAppointmentTypeId != null
              ? [{ appointmentTypeId: primaryAppointmentTypeId, isNewPatient: isNewPatientRequest }]
              : [],
          [],
          (id) => appointmentTypes.find((type) => Number(type.id) === Number(id)),
          (key) => appointmentTypeForRoutingStatsKey(key, appointmentTypes),
          {
            newPatientCount: routingVisitNewPatientCount({
              isNewPatientRequest,
              selectedPetIds: formData.selectedPetIds,
              newClientPets: formData.newClientPets,
              existingClientNewPets: formData.existingClientNewPets,
            }),
            numPets: routingVisitPetCount(formData),
          },
        ).serviceMinutes;
      }

      // Store the service minutes used for routing request
      setServiceMinutesUsed(serviceMinutes);

      console.log('[AppointmentForm] Calculating service minutes:', {
        numPets: routingVisitPetCount(formData),
        serviceMinutes,
        visitPets: routingVisitPets,
        selectedPetIds: formData.selectedPetIds,
        isLoggedIn,
      });

      // Use public availability API for new clients, routing v2 for logged-in clients
      let data: any;

      let scoreThresholdConfig = defaultRoutingOfferableScoreConfig();
      try {
        scoreThresholdConfig = await fetchPublicRoutingOfferableScoreThresholds(practiceId);
      } catch (err) {
        console.warn(
          '[AppointmentForm] Failed to load routing score thresholds; using defaults',
          err,
        );
      }

      const selectedIds = formData.selectedPetIds.map(String);
      const isMemberTier = selectedIds.some(
        (id) =>
          petIdsWithActiveWellnessPlan?.has(id) ||
          petIdsWithActiveOrPendingMembership?.has(id),
      );
      
      if (isLoggedIn) {
        // Build routing v2 request payload for logged-in clients
        const payload: any = {
          doctorId,
          startDate,
          numDays,
          newAppt: {
            serviceMinutes,
            ...(lat && lon ? { lat, lon } : {}),
            ...(validatedAddress ? { address: validatedAddress } : {}),
          },
        };

        console.log('[AppointmentForm] Calling /routing/v2 with payload:', payload);
        const response = await http.post('/routing/v2', payload);
        data = normalizeRoutingV2SlotSearchResponse(response.data as RoutingV2SlotSearchResult);
        console.log('[AppointmentForm] Routing v2 response:', data);
      } else {
        // Use public availability API for new clients
        // Always include doctorId when a doctor is selected
        const availabilityRequest: any = {
          practiceId,
          startDate,
          numDays,
          address: validatedAddress || fullAddress || '',
          allowOtherDoctors: false,
        };
        
        // Always include doctorId when a doctor is selected (we're already past the check that ensures doctor exists)
        if (doctorId) {
          availabilityRequest.doctorId = isNaN(Number(doctorId)) ? doctorId : Number(doctorId);
        }
        if (routingVisitPets.length > 0 && doctorId) {
          availabilityRequest.visitPets = routingVisitPets;
        } else {
          availabilityRequest.serviceMinutes = serviceMinutes;
        }
        if (primaryAppointmentTypeId != null) {
          availabilityRequest.appointmentTypeId = primaryAppointmentTypeId;
        }

        console.log('[AppointmentForm] Calling /public/appointments/availability with payload:', availabilityRequest);
        const availabilityResponse = await fetchAvailability(availabilityRequest);
        console.log('[AppointmentForm] Availability response:', availabilityResponse);
        
        // Convert availability response to routing-like format
        data = {
          slots: availabilityResponse.slots || [],
          winner: availabilityResponse.winner,
          alternates: availabilityResponse.alternates || [],
        };
      }

      // Helper function to round time to nearest 5 minutes
      const roundToNearest5Minutes = (dt: DateTime): DateTime => {
        const minutes = dt.minute;
        const roundedMinutes = Math.round(minutes / 5) * 5;
        return dt.set({ minute: roundedMinutes, second: 0, millisecond: 0 });
      };

      const slotPassesOfferableScore = (opt: {
        score?: unknown;
        suggestedStartIso?: string;
        iso?: string;
        date?: string;
      }): boolean => {
        const slotIso =
          opt?.suggestedStartIso || opt?.iso || opt?.date || null;
        return isRoutingScoreOfferableForConfig(opt?.score, {
          config: scoreThresholdConfig,
          appointmentTypeId: primaryAppointmentTypeId,
          daysFromToday: daysFromTodayForSlot(
            slotIso,
            DEFAULT_PRACTICE_TIMEZONE,
          ),
          isMember: isMemberTier,
        });
      };

      // Extract slots from response
      const slots: Array<{ date: string; time: string; display: string; iso: string }> = [];
      
      // Handle both routing v2 format and public availability format
      const winner = data?.winner;
      const alternates = data?.alternates || [];
      const slotsArray = data?.slots || [];
      
      // If we have a slots array (from public API), use that
      if (Array.isArray(slotsArray) && slotsArray.length > 0) {
        for (const slot of slotsArray.filter(slotPassesOfferableScore).slice(0, 3)) {
          if (slot.iso || slot.date) {
            const slotDt = slot.iso 
              ? roundToNearest5Minutes(DateTime.fromISO(slot.iso))
              : DateTime.fromISO(`${slot.date}T${slot.time || '12:00'}`);
            slots.push({
              date: slot.date || slotDt.toISODate() || '',
              time: slot.time || slotDt.toFormat('HH:mm'),
              display: slot.display || `${slotDt.toFormat('EEE, MMM d')} at ${slotDt.toFormat('h:mm a')}`,
              iso: slot.iso || slotDt.toISO() || '',
            });
          }
        }
      } else {
        // Handle routing v2 format (winner + alternates)
        // Combine winner and alternates, filter by configurable score thresholds, then take top 3
        const allOptions: any[] = [];
        
        // Add winner if available
        if (winner?.suggestedStartIso || winner?.iso) {
          allOptions.push(winner);
        }
        
        // Add all alternates
        if (Array.isArray(alternates)) {
          allOptions.push(...alternates);
        }
        
        const filteredOptions = allOptions
          .filter(slotPassesOfferableScore)
          .slice(0, 3);
        
        // Process filtered options into slots
        for (const opt of filteredOptions) {
          if (opt?.suggestedStartIso || opt?.iso) {
            const optIso = opt.suggestedStartIso || opt.iso;
            const optDt = roundToNearest5Minutes(DateTime.fromISO(optIso));
            slots.push({
              date: opt.date || optDt.toISODate() || '',
              time: opt.time || optDt.toFormat('HH:mm'),
              display: opt.display || `${optDt.toFormat('EEE, MMM d')} at ${optDt.toFormat('h:mm a')}`,
              iso: optIso,
            });
          }
        }
      }

      console.log('[AppointmentForm] Found slots:', slots.length);
      // Limit to top 3 slots
      setRecommendedSlots(slots.slice(0, 3));
    } catch (error) {
      console.error('[AppointmentForm] Failed to find available slots:', error);
      setRecommendedSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  // Load recommended slots when doctor is selected and we're on date/time page
  // Also reload when selected pets change (to recalculate service minutes)
  useEffect(() => {
    const isDateTimePage =
      currentPage === 'request-visit-continued' ||
      currentPage === 'euthanasia-continued' ||
      (currentPage === 'new-client-pet-info' && !isLoggedIn);
    const hasDoctor = formData.preferredDoctorExisting || formData.preferredDoctor;
    
    // Check if any pet is selected for euthanasia (existing or new client pets)
    const hasEuthanasiaPet = 
      (formData.selectedPetIds?.some(petId => {
        const petData = formData.petSpecificData?.[petId];
        return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
      }) || false) ||
      (formData.newClientPets?.some(pet => {
        const petData = formData.petSpecificData?.[pet.id];
        return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
      }) || false);
    
    console.log('[AppointmentForm] useEffect check:', {
      isDateTimePage,
      hasDoctor,
      currentPage,
      providersLength: providers.length,
      preferredDoctorExisting: formData.preferredDoctorExisting,
      preferredDoctor: formData.preferredDoctor,
      selectedPetIds: formData.selectedPetIds,
      needsUrgentScheduling: formData.needsUrgentScheduling,
      hasEuthanasiaPet,
    });
    
    // For request-visit-continued, do routing automatically if:
    // - howSoon allows self-scheduling (not Emergent / Other)
    // - For Emergent / Other, show liaison banner (no routing needed)
    // - Skip routing if euthanasia pet is selected (no slots shown)
    // For euthanasia-continued, skip routing (no slots shown, just text field)
    const isManualScheduling = isManualSchedulingHowSoon(formData.howSoon);
    const isNotUrgentTimeframe = formData.howSoon && !isManualScheduling;
    const isRoutingPage =
      currentPage === 'request-visit-continued' ||
      (currentPage === 'new-client-pet-info' && !isLoggedIn);
    const shouldDoRouting = 
      isDateTimePage && 
      hasDoctor && 
      providers.length > 0 &&
      !hasEuthanasiaPet && // Don't do routing if euthanasia pet is selected
      isRoutingPage && // request-visit-continued or intro for new clients
      isNotUrgentTimeframe; // Only if not urgent/emergent
    
    if (shouldDoRouting) {
      console.log('[AppointmentForm] Calling findAvailableSlots');
      findAvailableSlots();
    } else if (!isDateTimePage || !hasDoctor) {
      // Don't clear slots if we're submitting (we need them for submission)
      // Only clear if we're going to a completely different flow
      if (currentPage !== 'success') {
        setRecommendedSlots([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, formData.preferredDoctorExisting, formData.preferredDoctor, providers.length, formData.selectedPetIds.length, formData.howSoon, formData.petSpecificData, formData.newClientPets]);

  // Check email when entered (for new clients)
  useEffect(() => {
    if (isLoggedIn) return; // Skip if logged in
    if (!formData.email || formData.email.trim().length < 3) {
      setEmailCheckResult(null);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      setEmailCheckResult(null);
      return;
    }

    let alive = true;
    const timeoutId = setTimeout(async () => {
      setCheckingEmail(true);
      try {
        const result = await checkEmail(formData.email.trim(), practiceId);
        if (!alive) return;
        setEmailCheckResult(result);
        
        // If email exists and has account, show message (will be displayed in UI)
        if (result.exists && result.hasAccount) {
          console.log('[AppointmentForm] Email has account, user should login');
        }
      } catch (error) {
        console.error('[AppointmentForm] Failed to check email:', error);
        if (!alive) return;
        setEmailCheckResult(null);
      } finally {
        if (alive) setCheckingEmail(false);
      }
    }, 500); // Debounce 500ms

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [formData.email, isLoggedIn, practiceId]);

  // Track step views for funnel / drop-off analysis in GA4
  useEffect(() => {
    trackFormEvent('appointment_form_step_viewed');
  }, [currentPage, isLoggedIn, formData.haveUsedServicesBefore, trackFormEvent]);

  // Pets eligible for membership signup: for logged-in users, only selected pets that do NOT
  // have an active or pending membership (from subscription on pet OR from membership-transactions API);
  // new pets (existingClientNewPets) and new-client pets are always eligible.
  // If all selected pets already have membership, the "Sign up for membership now" button is hidden.
  type EligiblePet = { id: string; name: string; species?: string; isBackendPet: boolean };
  const membershipEligiblePets = useMemo((): EligiblePet[] => {
    const signedUpParam = searchParams.get('signedUp');
    const excludeIds = signedUpParam ? new Set(signedUpParam.split(',').map((s) => s.trim()).filter(Boolean)) : new Set<string>();
    lastSignedUpPetIds.forEach((id) => excludeIds.add(id));
    if (isLoggedIn && pets.length > 0) {
      const hasActiveOrPendingMembership = (p: Pet) => {
        if (p.subscription?.status === 'active' || p.subscription?.status === 'pending') return true;
        if (petIdsWithActiveOrPendingMembership) {
          if (p.dbId && petIdsWithActiveOrPendingMembership.has(String(p.dbId))) return true;
          if (petIdsWithActiveOrPendingMembership.has(String(p.id))) return true;
        }
        if (petIdsWithActiveWellnessPlan) {
          if (p.dbId && petIdsWithActiveWellnessPlan.has(String(p.dbId))) return true;
          if (petIdsWithActiveWellnessPlan.has(String(p.id))) return true;
        }
        return false;
      };
      // Only include selected pets that have no active/pending membership
      const fromSelected = pets
        .filter(
          (p) =>
            formData.selectedPetIds?.includes(p.id) &&
            !hasActiveOrPendingMembership(p)
        )
        .map((p) => ({ id: p.id, name: p.name, species: p.species, isBackendPet: true }));
      // New pets added by existing client have no membership yet
      const fromNew =
        (formData.existingClientNewPets || []).map((p) => ({
          id: p.id,
          name: p.name,
          species: p.species,
          isBackendPet: false,
        }));
      return [...fromSelected, ...fromNew].filter((p) => !excludeIds.has(p.id));
    }
    return (formData.newClientPets || [])
      .filter((p) => p.name?.trim())
      .map((p) => ({ id: p.id, name: p.name, species: p.species, isBackendPet: false }))
      .filter((p) => !excludeIds.has(p.id));
  }, [
    isLoggedIn,
    pets,
    formData.selectedPetIds,
    formData.newClientPets,
    formData.existingClientNewPets,
    searchParams,
    lastSignedUpPetIds,
    petIdsWithActiveOrPendingMembership,
    petIdsWithActiveWellnessPlan,
  ]);

  const isOnSubmitStep =
    currentPage === 'request-visit-continued' || currentPage === 'euthanasia-continued' ||
    (currentPage === 'new-client-pet-info' && !isLoggedIn) ||
    (currentPage === 'existing-client' && isLoggedIn);
  // Show "Sign up for membership now" only when there is at least one pet eligible for membership.
  // For logged-in users, wait until we've loaded both transactions and wellness plans so we don't show the button for pets that already have membership.
  const membershipDataLoaded =
    !isLoggedIn || (petIdsWithActiveOrPendingMembership !== null && petIdsWithActiveWellnessPlan !== null);
  const hasEligiblePetsForMembership =
    membershipEligiblePets.length > 0 && membershipDataLoaded;

  // Hide membership CTA when any selected appointment type is Quality of Life or Euthanasia
  const selectedAppointmentTypeNames = getSelectedAppointmentTypes();
  const shouldHideMembershipForAppointmentTypes = [...selectedAppointmentTypeNames].some(
    (name) => {
      const lower = name.toLowerCase();
      return lower === 'euthanasia' || lower === 'quality of life';
    }
  );
  // Hide membership CTA when any pet (new or existing-client-new) answered Yes to calming meds or muzzle/special handling
  const shouldHideMembershipForCalmingOrMuzzle =
    (formData.newClientPets?.some(hasSpecialHandlingNeeds)) ||
    (formData.existingClientNewPets?.some(hasSpecialHandlingNeeds)) ||
    false;
  // Membership pitch renders on the post-submit confirmation page (`success`), not on the form steps.
  const isExploreMembershipsVisible =
    currentPage === 'success' &&
    hasEligiblePetsForMembership &&
    !shouldHideMembershipForAppointmentTypes &&
    !shouldHideMembershipForCalmingOrMuzzle;

  // Fetch membership status for logged-in client so we can hide signup for pets that already have membership
  useEffect(() => {
    if (!isLoggedIn || !userId) {
      setPetIdsWithActiveOrPendingMembership(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const txns = await listMembershipTransactions({ clientId: userId });
        if (!alive) return;
        const ids = new Set<string>();
        for (const t of txns) {
          const status = (t.status ?? '').toString().toLowerCase();
          if (status === 'active' || status === 'pending') {
            const pid = t.patientId ?? t.metadata?.patientId;
            if (pid != null) ids.add(String(pid));
          }
        }
        setPetIdsWithActiveOrPendingMembership(ids);
      } catch {
        if (alive) setPetIdsWithActiveOrPendingMembership(new Set());
      }
    })();
    return () => {
      alive = false;
    };
  }, [isLoggedIn, userId]);

  // Fetch wellness plans for logged-in client's pets; treat active wellness plan as membership
  useEffect(() => {
    if (!isLoggedIn || !pets.length) {
      setPetIdsWithActiveWellnessPlan(null);
      return;
    }
    let alive = true;
    (async () => {
      const ids = new Set<string>();
      const withDbId = pets.filter((p) => p.dbId);
      for (const pet of withDbId) {
        if (!alive) return;
        try {
          const plans = await fetchWellnessPlansForPatient(pet.dbId!);
          if (!alive) return;
          const hasActive = (plans ?? []).some(
            (plan) =>
              plan?.isActive === true ||
              String(plan?.status ?? '').toLowerCase() === 'active'
          );
          if (hasActive) {
            ids.add(String(pet.dbId));
            ids.add(String(pet.id));
          }
        } catch {
          // skip this pet
        }
      }
      if (alive) setPetIdsWithActiveWellnessPlan(ids);
    })();
    return () => {
      alive = false;
    };
  }, [isLoggedIn, pets]);

  // Warn users when they try to use browser back button
  useEffect(() => {
    // Only show warning if not on intro page and not on success page
    // Works for both new client and existing client flows
    if (currentPage === 'intro' || currentPage === 'success') {
      return;
    }

    let isHandlingPopState = false;

    // Add a state to history so we can detect back button
    // Always push a new state when page changes to ensure we can detect back navigation
    // Initialize immediately and also set up after a brief delay to catch any navigation
    const currentState = window.history.state;
    if (!currentState?.formPage || currentState.formPage !== currentPage) {
      window.history.pushState({ formPage: currentPage, preventBack: true }, '', window.location.href);
    }
    
    // Also set up a delayed check to ensure state is set (handles rapid page changes)
    const timeoutId = setTimeout(() => {
      const state = window.history.state;
      if (!state?.formPage || state.formPage !== currentPage) {
        window.history.pushState({ formPage: currentPage, preventBack: true }, '', window.location.href);
      }
    }, 100);

    const handlePopState = (event: PopStateEvent) => {
      // Prevent infinite loops
      if (isHandlingPopState) {
        return;
      }

      // Check if this is a back navigation from our form
      // Show warning for any back navigation when not on intro or success pages
      const state = event.state;
      const isFormPage = (currentPage as Page) !== 'intro' && (currentPage as Page) !== 'success';
      const hasPreventBack = state?.preventBack === true;
      const isNavigatingAway = !state || state.formPage !== currentPage;
      
      if (isFormPage && (hasPreventBack || isNavigatingAway)) {
        isHandlingPopState = true;
        
        // Show warning dialog
        const message = "You will lose your data if you go back using the browser's back button. Please use the 'Previous' button in the bottom left to go back to the previous page.";
        const userWantsToLeave = window.confirm(message);
        
        if (!userWantsToLeave) {
          // User cancelled - push the current state back to prevent navigation
          // This effectively cancels the back button press
          window.history.pushState({ formPage: currentPage, preventBack: true }, '', window.location.href);
        } else {
          void (async () => {
            await sendAbandon('browser_back', { awaitPutThenPost: true });
            // User confirmed - navigate back one more step since the browser already navigated
            // to our pushed state (same URL), we need to go back further to the actual previous route
            window.history.back();
          })();
        }
        
        setTimeout(() => {
          isHandlingPopState = false;
        }, 100);
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [currentPage, sendAbandon]);

  // Load veterinarians for new clients (using public veterinarians endpoint)
  // Only fetch when address is valid (has line1, city, state, zip)
  useEffect(() => {
    if (isLoggedIn) return; // Skip if logged in (will use regular veterinarians)

    // Defer execution to ensure it doesn't block initial render
    let debounceTimeoutId: NodeJS.Timeout | null = null;
    const deferTimeoutId = setTimeout(() => {
      // Check if address is valid (all required fields filled)
      const hasValidAddress = 
        formData.physicalAddress?.line1?.trim() &&
        formData.physicalAddress?.city?.trim() &&
        formData.physicalAddress?.state?.trim() &&
        formData.physicalAddress?.zip?.trim();

      // Don't fetch if address is not valid
      if (!hasValidAddress) {
        setPublicProviders([]);
        setProviders([]);
        setRawPublicVeterinarians([]);
        setLoadingVeterinarians(false);
        setVeterinariansFetchResolved(false);
        lastFetchedVetsAddressRef.current = '';
        return;
      }

      // Zone gate owns in-area confirmation — do not look up vets until it returns 200.
      if (zoneCheckStatus !== 'in_service') {
        setPublicProviders([]);
        setProviders([]);
        setRawPublicVeterinarians([]);
        setLoadingVeterinarians(false);
        setVeterinariansFetchResolved(zoneCheckStatus === 'out_of_service' || zoneCheckStatus === 'failed');
        lastFetchedVetsAddressRef.current = '';
        return;
      }

      // Build address string from form data
      const addressParts = [
        formData.physicalAddress?.line1,
        formData.physicalAddress?.city,
        formData.physicalAddress?.state,
        formData.physicalAddress?.zip,
      ].filter(Boolean);
      const address = addressParts.join(', ');

      if (lastFetchedVetsAddressRef.current === address) {
        return;
      }

      debounceTimeoutId = setTimeout(() => {
        let alive = true;
        (async () => {
          const currentAddressParts = [
            formData.physicalAddress?.line1,
            formData.physicalAddress?.city,
            formData.physicalAddress?.state,
            formData.physicalAddress?.zip,
          ].filter(Boolean);
          const currentAddress = currentAddressParts.join(', ');
          
          if (lastFetchedVetsAddressRef.current === currentAddress) {
            return;
          }

          setLoadingVeterinarians(true);
          setVeterinariansFetchResolved(false);
          try {
            lastFetchedVetsAddressRef.current = currentAddress;

            if (!alive) return;

            // Fetch raw veterinarian data directly from API to get appointmentTypes
            const params = veterinarianLookupParams(
              currentAddress,
              formData.physicalAddress?.lat,
              formData.physicalAddress?.lon,
              practiceId
            );
            const { data } = await http.get('/public/appointments/veterinarians', { params });
            const rawVeterinarians: any[] = Array.isArray(data) ? data : (data?.items ?? data?.veterinarians ?? []);
            
            if (!alive) return;
            
            // New clients: only keep vets accepting new patients in the client's zone
            const filteredByNewPatients = rawVeterinarians.filter((v) => {
              if (!v.weeklySchedules || !Array.isArray(v.weeklySchedules)) {
                return true; // Backwards compatibility when API omits zone data
              }
              const flags = deriveVeterinarianClientZoneFlags(v);
              return flags.seeingClients && flags.acceptingNewPatients;
            });
            
            // Store raw data
            setRawPublicVeterinarians(filteredByNewPatients);
            
            // Filter by appointment types
            const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(filteredByNewPatients);
            
            // Convert to PublicProvider format
            const publicVeterinariansData = filteredByAppointmentTypes.map(mapRawVeterinarianToPublicProvider);
            
            setPublicProviders(publicVeterinariansData);
            
            // Also set providers for compatibility with existing code
            setProviders(publicVeterinariansData.map(v => ({
              id: v.id,
              name: v.name,
              email: v.email || '',
              pimsId: v.id,
            })));
          } catch (error) {
            console.error('[AppointmentForm] Failed to load public veterinarians:', error);
            if (alive) {
              setPublicProviders([]);
              setProviders([]);
              setRawPublicVeterinarians([]);
            }
          } finally {
            if (alive) {
              setLoadingVeterinarians(false);
              setVeterinariansFetchResolved(true);
            }
          }
        })();
      }, 500); // 500ms debounce
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      clearTimeout(deferTimeoutId);
      if (debounceTimeoutId) {
        clearTimeout(debounceTimeoutId);
      }
    };
  }, [isLoggedIn, practiceId, zoneCheckStatus, formData.physicalAddress?.line1, formData.physicalAddress?.city, formData.physicalAddress?.state, formData.physicalAddress?.zip, formData.physicalAddress?.lat, formData.physicalAddress?.lon]);

  // Load client data if logged in
  useEffect(() => {
    if (!isLoggedIn) return;

    // Defer execution to ensure it doesn't block initial render
    let alive = true;
    const timeoutId = setTimeout(() => {
      (async () => {
        setLoadingClientData(true);
        
        try {
          // Always fetch pets first
          const petsData = await fetchClientPets();

        if (!alive) return;

        setPets(petsData);

        // Fetch patient alerts for each pet
        const alertsMap = new Map<string, string | null>();
        await Promise.all(
          petsData.map(async (pet) => {
            try {
              // Get alerts from /patients/pims/:id endpoint
              const pimsId = pet.id;
              if (pimsId) {
                const { data } = await http.get(`/patients/pims/${encodeURIComponent(pimsId)}`);
                // Alerts is a text field (string or null) on the patient object
                const alerts = data?.alerts ?? data?.patient?.alerts ?? null;
                alertsMap.set(pet.id, alerts && typeof alerts === 'string' ? alerts : null);
              }
            } catch (err) {
              // If fetch fails, continue without alerts for this pet
              console.warn(`Failed to fetch alerts for pet ${pet.id}:`, err);
              alertsMap.set(pet.id, null);
            }
          })
        );
        setPetAlerts(alertsMap);

        // Extract client info from pets/appointments
        // Try to get primary provider from pets (prefer one with an id we can match on).
        const providerPet =
          petsData.find(p => p.primaryProviderId != null) ??
          petsData.find(p => p.primaryProviderName);
        setPrimaryProviderName(providerPet?.primaryProviderName || null);
        setPrimaryProviderId(providerPet?.primaryProviderId ?? null);

        // Pre-populate form with user email
        if (userEmail) {
          setFormData(prev => ({ ...prev, email: userEmail }));
        }

        // Set haveUsedServicesBefore to Yes since they're logged in
        setFormData(prev => ({ ...prev, haveUsedServicesBefore: 'Yes' }));

        // Try to get client info from appointments first, then fallback to direct client fetch
        let clientAddress: string | undefined = undefined;
        let clientLat: number | undefined = undefined;
        let clientLon: number | undefined = undefined;
        let client: any = null;
        
        try {
          const { data: apptsData } = await http.get('/appointments/client');
          const appts = Array.isArray(apptsData) ? apptsData : (apptsData?.appointments ?? apptsData ?? []);
          
          if (appts.length > 0) {
            const firstAppt = appts[0];
            client = firstAppt?.client || firstAppt?.Client;
          }
        } catch (err) {
          console.warn('Failed to fetch client info from appointments:', err);
        }
        
        // If no client data from appointments, fetch directly from /clients/:id
        if (!client && userId) {
          try {
            client = await fetchClientInfo(userId);
          } catch (err) {
            console.warn('Failed to fetch client info directly:', err);
          }
        }
        
        if (client) {
          const clientPimsId = client.pimsId != null ? String(client.pimsId).trim() : '';
          clientPimsIdRef.current = clientPimsId || null;

          // Extract lat/lon if available
          if (client.lat != null && client.lon != null) {
            const lat = typeof client.lat === 'string' ? parseFloat(client.lat) : client.lat;
            const lon = typeof client.lon === 'string' ? parseFloat(client.lon) : client.lon;
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              clientLat = lat;
              clientLon = lon;
            }
          }
          
          // Build address string from client data — used as a fallback when the
          // modal needs a text address and only lat/lon is stored on the client.
          const addressParts = [
            client.address1 || client.address_1,
            client.city,
            client.state,
            clientRecordZip(client) || undefined,
          ].filter(Boolean);
          if (addressParts.length >= 3) {
            clientAddress = addressParts.join(', ');
          }
          
          // Extract phone number from various possible fields
          const rawPhoneNumber = 
            client.phone1 ||
            client.phone || 
            client.secondPhone || 
            client.phoneNumber || 
            client.phone_number ||
            client.primaryPhone ||
            client.primary_phone ||
            client.mobilePhone ||
            client.mobile_phone ||
            undefined;
          
          // Normalize phone number: remove +1 prefix if present
          const phoneNumber = rawPhoneNumber 
            ? String(rawPhoneNumber).replace(/^\+1\s*/, '').trim()
            : undefined;
          
          // Pre-populate name if available
          setFormData(prev => {
            // If user hasn't moved (or selected "No"), restore physicalAddress from client data
            // If user has moved (selected "Yes"), don't overwrite the cleared address
            const shouldRestoreAddress = prev.isThisTheAddressWhereWeWillCome !== 'No';
            
            // Build new address from client data
            const newAddress = shouldRestoreAddress ? {
              line1: client.address1 || client.address_1 || prev.physicalAddress?.line1 || '',
              line2: client.address2 || client.address_2 || prev.physicalAddress?.line2 || undefined,
              city: client.city || prev.physicalAddress?.city || '',
              state: client.state || prev.physicalAddress?.state || '',
              zip: clientRecordZip(client) || prev.physicalAddress?.zip || '',
              country: prev.physicalAddress?.country || 'United States',
            } : prev.physicalAddress;
            
            // Only update if address actually changed to avoid infinite loops
            const addressChanged = shouldRestoreAddress && (
              newAddress.line1 !== prev.physicalAddress?.line1 ||
              newAddress.city !== prev.physicalAddress?.city ||
              newAddress.state !== prev.physicalAddress?.state ||
              newAddress.zip !== prev.physicalAddress?.zip
            );
            
            // Only update if something actually changed
            if (!addressChanged && 
                (client.firstName || client.first_name) === prev.fullName.first &&
                (client.lastName || client.last_name) === prev.fullName.last &&
                phoneNumber === prev.bestPhoneNumber) {
              return prev; // No changes needed
            }
            
            // Store original address if we don't have it yet and we're setting it from client data
            if (!originalAddress && shouldRestoreAddress && newAddress.line1) {
              setOriginalAddress(newAddress);
            }
            
            return {
              ...prev,
              fullName: {
                ...prev.fullName,
                first: client.firstName || client.first_name || prev.fullName.first,
                last: client.lastName || client.last_name || prev.fullName.last,
              },
              bestPhoneNumber: phoneNumber || prev.bestPhoneNumber,
              physicalAddress: newAddress,
              // Only clear newPhysicalAddress if explicitly set to "No"
              newPhysicalAddress: prev.isThisTheAddressWhereWeWillCome === 'Yes' ? undefined : prev.newPhysicalAddress,
            };
          });
        }

        // Store client location for later use in veterinarian lookup
        if (!alive) return;
        clientLocationRef.current = {
          lat: clientLat,
          lon: clientLon,
          address: clientAddress,
        };
        
        // Mark client location as ready (triggers separate veterinarian fetch)
        if (clientLat || clientLon || clientAddress) {
          setClientLocationReady(true);
        }

        // Skip intro page and go directly to existing client form
        setCurrentPage('existing-client');
      } catch (error: any) {
        console.error('Failed to load client data:', error);
        if (alive) {
          setLoadingVeterinarians(false);
          if (userEmail) {
            setFormData((prev) => ({
              ...prev,
              email: userEmail,
              haveUsedServicesBefore: 'Yes',
            }));
          } else {
            setFormData((prev) => ({ ...prev, haveUsedServicesBefore: 'Yes' }));
          }
          setCurrentPage('existing-client');
        }
      } finally {
        if (alive) setLoadingClientData(false);
      }
      })();
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoggedIn,
    userEmail,
  ]);

  // Handle new address changes for existing clients with debouncing
  useEffect(() => {
    if (!isLoggedIn) return; // Only for logged-in users
    if (formData.isThisTheAddressWhereWeWillCome !== 'No') return; // Only when entering new address

    // Defer execution to ensure it doesn't block initial render
    let debounceTimeoutId: NodeJS.Timeout | null = null;
    const deferTimeoutId = setTimeout(() => {
      // Check if new address is complete (all required fields filled)
      const hasValidNewAddress = 
        formData.newPhysicalAddress?.line1?.trim() &&
        formData.newPhysicalAddress?.city?.trim() &&
        formData.newPhysicalAddress?.state?.trim() &&
        formData.newPhysicalAddress?.zip?.trim();

      // Don't fetch if address is not complete
      if (!hasValidNewAddress || !formData.newPhysicalAddress) {
      setProviders([]);
      setRawVeterinarians([]);
      setLoadingVeterinarians(false);
      setVeterinariansFetchResolved(false);
      lastFetchedVetsAddressRef.current = '';
      return;
      }

      if (zoneCheckStatus !== 'in_service') {
        setProviders([]);
        setRawVeterinarians([]);
        setLoadingVeterinarians(false);
        setVeterinariansFetchResolved(zoneCheckStatus === 'out_of_service' || zoneCheckStatus === 'failed');
        lastFetchedVetsAddressRef.current = '';
        return;
      }

      // Build address string from form data
      // At this point, we know newPhysicalAddress is defined due to the check above
      const addressParts = [
        formData.newPhysicalAddress.line1,
        formData.newPhysicalAddress.city,
        formData.newPhysicalAddress.state,
        formData.newPhysicalAddress.zip,
      ].filter(Boolean);
      const address = addressParts.join(', ');

      if (lastFetchedVetsAddressRef.current === address) {
        return;
      }

      debounceTimeoutId = setTimeout(() => {
      let alive = true;
      (async () => {
        const currentAddressParts = [
          formData.newPhysicalAddress?.line1,
          formData.newPhysicalAddress?.city,
          formData.newPhysicalAddress?.state,
          formData.newPhysicalAddress?.zip,
        ].filter(Boolean);
        const currentAddress = currentAddressParts.join(', ');
        
        if (lastFetchedVetsAddressRef.current === currentAddress) {
          return;
        }

        setLoadingVeterinarians(true);
        setVeterinariansFetchResolved(false);
        try {
          lastFetchedVetsAddressRef.current = currentAddress;
          
          if (!alive) return;
          
          // Fetch raw veterinarian data directly from API to get appointmentTypes
          const params = veterinarianLookupParams(
            currentAddress,
            formData.newPhysicalAddress?.lat,
            formData.newPhysicalAddress?.lon
          );
          const { data } = await http.get('/employees/veterinarians', { params });
          const rawVeterinarians: any[] = Array.isArray(data) ? data : [];
          
          if (!alive) return;
          
          // Filter by isActive
          const filteredByActive = rawVeterinarians.filter((v) => v.isActive !== false);
          
          // Store raw data
          setRawVeterinarians(filteredByActive);
          
          // Filter by appointment types
          const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(filteredByActive);
          
          // Convert to Provider format
          const providersData = filteredByAppointmentTypes.map(mapRawVeterinarianToProvider);
          
          setProviders(providersData);
          setLoadingVeterinarians(false);
          setVeterinariansFetchResolved(true);
          } catch (err) {
            console.error('Failed to fetch veterinarians:', err);
            if (alive) {
              setProviders([]);
              setRawVeterinarians([]);
              setLoadingVeterinarians(false);
              setVeterinariansFetchResolved(true);
            }
          }
      })();

      return () => {
        alive = false;
      };
      }, 500); // 500ms debounce
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      clearTimeout(deferTimeoutId);
      if (debounceTimeoutId) {
        clearTimeout(debounceTimeoutId);
      }
    };
  }, [
    isLoggedIn,
    zoneCheckStatus,
    formData.isThisTheAddressWhereWeWillCome,
    formData.newPhysicalAddress?.line1,
    formData.newPhysicalAddress?.city,
    formData.newPhysicalAddress?.state,
    formData.newPhysicalAddress?.zip,
    formData.newPhysicalAddress?.lat,
    formData.newPhysicalAddress?.lon,
  ]);

  // Fetch veterinarians for logged-in users when client location becomes available
  // This runs completely independently and non-blocking after client data is loaded
  useEffect(() => {
    if (!isLoggedIn) return;
    if (!clientLocationReady) return;
    // Only fetch if using original address (not a new address)
    if (formData.isThisTheAddressWhereWeWillCome === 'No') return;
    if (zoneCheckStatus !== 'in_service') {
      setLoadingVeterinarians(false);
      setVeterinariansFetchResolved(zoneCheckStatus === 'out_of_service' || zoneCheckStatus === 'failed');
      return;
    }
    
    const { lat, lon, address } = clientLocationRef.current;
    // Don't fetch if no location available
    if (!lat && !lon && !address) return;

    setLoadingVeterinarians(true);
    setVeterinariansFetchResolved(false);

    let alive = true;
    const timeoutId = setTimeout(() => {
      // Fire and forget - completely async, non-blocking
      (async () => {
        try {
          if (!alive) return;
          
          // Fetch raw veterinarian data directly from API to get appointmentTypes
          const params: any = {};
          if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
            params.lat = lat;
            params.lon = lon;
          } else if (address) {
            params.address = address;
          }
          
          const { data } = await http.get('/employees/veterinarians', { params });
          const rawVeterinarians: any[] = Array.isArray(data) ? data : [];
          
          if (!alive) return;
          
          // Filter by isActive
          const filteredByActive = rawVeterinarians.filter((v) => v.isActive !== false);
          
          // Store raw data
          setRawVeterinarians(filteredByActive);
          
          // Filter by appointment types
          const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(filteredByActive);
          
          // Convert to Provider format
          const providersData = filteredByAppointmentTypes.map(mapRawVeterinarianToProvider);
          
          if (!alive) return;
          
          setProviders(providersData);
          setLoadingVeterinarians(false);
          setVeterinariansFetchResolved(true);
        } catch (err) {
          console.error('Failed to fetch veterinarians:', err);
          if (alive) {
            setProviders([]);
            setRawVeterinarians([]);
            setLoadingVeterinarians(false);
            setVeterinariansFetchResolved(true);
          }
        }
      })();
    }, 0);

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [
    isLoggedIn,
    clientLocationReady,
    zoneCheckStatus,
    formData.isThisTheAddressWhereWeWillCome,
  ]);

  // Fetch species list on mount
  useEffect(() => {
    // Defer execution to ensure it doesn't block initial render
    let alive = true;
    const timeoutId = setTimeout(() => {
      (async () => {
        setLoadingSpecies(true);
        try {
          const response = await http.get(`/public/species-breeds?practiceId=${practiceId}`);
          if (!alive) return;
          const species = Array.isArray(response.data?.species) ? response.data.species : [];
          // Filter to only show species with showInUi === true and include prettyName
          setSpeciesList(
            species
              .filter((s: any) => s.showInUi !== false) // Only show species where showInUi is true (or undefined, defaulting to true)
              .map((s: any) => ({ 
                id: s.id, 
                name: s.name,
                prettyName: s.prettyName || s.name, // Use prettyName if available, fallback to name
                showInUi: s.showInUi 
              }))
          );
        } catch (error) {
          console.error('[AppointmentForm] Failed to load species:', error);
          if (alive) {
            setSpeciesList([]);
          }
        } finally {
          if (alive) {
            setLoadingSpecies(false);
          }
        }
      })();
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [practiceId]);

  // Resolve appointment request promo token from ?promo= query param
  useEffect(() => {
    if (!promoToken) return;
    let alive = true;
    (async () => {
      try {
        const promo = await resolveAppointmentRequestPromoToken(promoToken);
        if (alive) setAppointmentPromo(promo);
      } catch {
        // 404 or invalid token — silently hide the banner
        if (alive) setAppointmentPromo(null);
      }
    })();
    return () => {
      alive = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoToken]);

  // Resolve customer-facing promo code from ?code= (e.g. welcome2026 from referral email)
  useEffect(() => {
    if (!promoCodeFromQuery || promoToken) return;
    let alive = true;
    (async () => {
      try {
        const promo = await resolveAppointmentRequestPromoByCode(promoCodeFromQuery);
        if (alive) {
          setAppliedCodePromo(promo);
          setPromoCodeInput(promoCodeFromQuery);
          setPromoCodeError(null);
        }
      } catch {
        if (alive) {
          setAppliedCodePromo(null);
          setPromoCodeError('Code not found or no longer valid.');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [promoCodeFromQuery, promoToken]);

  // Once the user's email is known, verify they haven't already redeemed the
  // active promotion (each email can use a given promotion only once).
  const promoEligibilityEmail = (formData.email || userEmail || '').trim();
  useEffect(() => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const hasTokenPromo = !!appointmentPromo && !!promoToken;
    const codePromoCode = appliedCodePromo?.code ?? null;

    if (!emailRegex.test(promoEligibilityEmail) || (!hasTokenPromo && !codePromoCode)) {
      setPromoAlreadyUsed(false);
      return;
    }

    let alive = true;
    const timeoutId = setTimeout(async () => {
      try {
        const result = hasTokenPromo
          ? await checkAppointmentRequestPromoEligibility(promoToken!, promoEligibilityEmail)
          : await checkAppointmentRequestPromoEligibilityByCode(codePromoCode!, promoEligibilityEmail);
        if (!alive) return;
        const alreadyUsed = result.eligible === false && result.reason === 'already_redeemed';
        if (alreadyUsed && !hasTokenPromo) {
          // Typed code: clear it so the entry box reappears with an error message
          setAppliedCodePromo(null);
          setPromoCodeError('This promotion has already been used with this email address.');
          setPromoAlreadyUsed(false);
        } else {
          setPromoAlreadyUsed(alreadyUsed);
        }
      } catch {
        // Eligibility is advisory — keep the promo visible; the backend still
        // enforces the one-use rule at submission time.
        if (alive) setPromoAlreadyUsed(false);
      }
    }, 500); // Debounce while the user types their email

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoEligibilityEmail, promoToken, appointmentPromo, appliedCodePromo?.code]);

  // Resolve + apply a manually entered promo code, rejecting codes this email already used
  const applyPromoCode = async () => {
    const code = promoCodeInput.trim();
    if (!code) return;
    setPromoCodeApplying(true);
    setPromoCodeError(null);
    try {
      const promo = await resolveAppointmentRequestPromoByCode(code);
      const email = (formData.email || userEmail || '').trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        try {
          const eligibility = await checkAppointmentRequestPromoEligibilityByCode(code, email);
          if (eligibility.eligible === false && eligibility.reason === 'already_redeemed') {
            setPromoCodeError('This promotion has already been used with this email address.');
            return;
          }
        } catch {
          // Advisory only — the backend enforces the rule at submission time
        }
      }
      setAppliedCodePromo(promo);
    } catch {
      setPromoCodeError('Code not found or no longer valid.');
    } finally {
      setPromoCodeApplying(false);
    }
  };

  // Fetch appointment types when logged in, or after new clients confirm a complete address
  useEffect(() => {
    if (!isLoggedIn && !isPhysicalAddressComplete(formData.physicalAddress)) {
      setAppointmentTypes([]);
      setLoadingAppointmentTypes(false);
      return;
    }

    let alive = true;
    const timeoutId = setTimeout(() => {
      (async () => {
        setLoadingAppointmentTypes(true);
        try {
          // New patient = not logged in AND haven't used services before
          const isNewPatient = !isLoggedIn && formData.haveUsedServicesBefore !== 'Yes';

          // Load all active types so the calming / Pre-Meds type is available even when
          // it is hidden from the normal reason picker (showInApptRequestForm=false).
          // Picker options still filter to form-visible types (+ selected Pre-Meds).
          const allTypes = await fetchAppointmentTypes(
            practiceId,
            false,
            undefined,
            isLoggedIn
          );
          if (!alive) return;
          const active = allTypes.filter(
            (type) => type.isDeleted !== true && type.isActive !== false,
          );
          const formVisible = active.filter((type) => type.showInApptRequestForm === true);
          const premed = findCalmingPremedAppointmentType(active);
          const merged: typeof active =
            premed && !formVisible.some((t) => Number(t.id) === Number(premed.id))
              ? [...formVisible, premed]
              : formVisible;
          // New-patient form still restricts picker options via getAppointmentTypeOptions;
          // keep the Pre-Meds type in state for window resolution when calming is checked.
          setAppointmentTypes(
            isNewPatient
              ? merged.filter(
                  (type) =>
                    type.newPatientAllowed === true || appointmentTypeIsCalmingPremed(type),
                )
              : merged,
          );
        } catch (error) {
          console.error('[AppointmentForm] Failed to load appointment types:', error);
          if (alive) {
            setAppointmentTypes([]);
          }
        } finally {
          if (alive) {
            setLoadingAppointmentTypes(false);
          }
        }
      })();
    }, 0);

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [
    practiceId,
    isLoggedIn,
    formData.haveUsedServicesBefore,
    formData.physicalAddress?.line1,
    formData.physicalAddress?.city,
    formData.physicalAddress?.state,
    formData.physicalAddress?.zip,
  ]);

  // Re-filter veterinarians when appointment types change
  useEffect(() => {
    // Only re-filter if we have raw data already loaded
    // Re-filter public veterinarians for new clients
    if (rawPublicVeterinarians.length > 0 && !isLoggedIn) {
      const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(rawPublicVeterinarians);
      
      const publicVeterinariansData = filteredByAppointmentTypes.map(mapRawVeterinarianToPublicProvider);
      
      setPublicProviders(publicVeterinariansData);
      setProviders(publicVeterinariansData.map(v => ({
        id: v.id,
        name: v.name,
        email: v.email || '',
        pimsId: v.id,
      })));
    }
    
    // Re-filter veterinarians for logged-in clients
    if (rawVeterinarians.length > 0 && isLoggedIn) {
      const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(rawVeterinarians);
      
      const providersData = filteredByAppointmentTypes.map(mapRawVeterinarianToProvider);
      setProviders(providersData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formData.petSpecificData,
    formData.selectedPetIds,
    formData.newClientPets,
    formData.existingClientNewPets,
    rawVeterinarians,
    rawPublicVeterinarians,
    isLoggedIn,
  ]);

  useEffect(() => {
    if (!pendingValidationScrollRef.current) return;
    const errorSnapshot = pendingValidationScrollRef.current;
    pendingValidationScrollRef.current = null;
    scrollToFirstAppointmentFormError(errorSnapshot);
  }, [errors]);

  const updateFormData = (field: keyof FormData, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };

      if (field === 'howSoon' && value !== 'Other') {
        updated.preferredDateTime = '';
      }

      if (field === 'mailingAddressSame' && value === 'No, it is the same.') {
        updated.mailingAddressManualEntry = false;
        updated.mailingAddress = undefined;
      }
      
      // When "No" is selected for isThisTheAddressWhereWeWillCome, clear physicalAddress and providers
      // (Reversed logic: "No" means they need a new address)
      if (field === 'isThisTheAddressWhereWeWillCome' && value === 'No') {
        lastCheckedAddressRef.current = '';
        lastFetchedVetsAddressRef.current = '';
        setZoneCheckStatus('idle');
        // Store the original address before clearing it (if not already stored)
        if (!originalAddress && prev.physicalAddress && (prev.physicalAddress.line1 || prev.physicalAddress.city)) {
          setOriginalAddress(prev.physicalAddress);
        }
        updated.physicalAddress = {
          line1: '',
          city: '',
          state: '',
          zip: '',
          country: '',
        };
        // Clear providers since we need new address to fetch them
        setProviders([]);
        setPublicProviders([]);
        // Clear preferred doctor selection
        updated.preferredDoctorExisting = '';
        updated.newPhysicalAddress = {
          line1: '',
          city: '',
          state: '',
          zip: '',
          country: 'US',
        };
      }
      
      // When "Yes" is selected for isThisTheAddressWhereWeWillCome, restore original address and clear newPhysicalAddress
      // (Reversed logic: "Yes" means they're using the existing address)
      if (field === 'isThisTheAddressWhereWeWillCome' && value === 'Yes') {
        // Restore the original address if we have it stored
        if (originalAddress) {
          updated.physicalAddress = originalAddress;
        }
        updated.newPhysicalAddress = undefined;
      }
      
      return updated;
    });
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const updateNestedFormData = (field: keyof FormData, nestedField: string, value: any) => {
    setFormData(prev => {
      const current = prev[field] as any;
      return {
        ...prev,
        [field]: {
          ...current,
          [nestedField]: value,
        },
      };
    });
  };

  const setAddressFields = (
    field: 'physicalAddress' | 'mailingAddress' | 'newPhysicalAddress',
    address: AddressFields
  ) => {
    if (field !== 'mailingAddress') {
      lastCheckedAddressRef.current = '';
      lastFetchedVetsAddressRef.current = '';
      setZoneCheckStatus(isPhysicalAddressComplete(address) ? 'pending' : 'idle');
    }
    setFormData((prev) => ({
      ...prev,
      [field]: address,
    }));
  };

  const validateOtherHowSoonDateTime = (newErrors: Record<string, string>) => {
    if (isOtherHowSoon(formData.howSoon) && !formData.preferredDateTime?.trim()) {
      newErrors.preferredDateTime = 'Please enter your preferred date and time';
    }
  };

  const validateNewClientPetInfo = (newErrors: Record<string, string>) => {
    if (!isLoggedIn) {
      const newClientPets = filterCompletedAppointmentRequestPets(formData.newClientPets);
      if (newClientPets.length === 0) {
        newErrors.newClientPets = 'Please add at least one pet';
      } else {
        newClientPets.forEach((pet) => {
          if (!pet.name?.trim()) {
            newErrors[`newClientPet.${pet.id}.name`] = 'Pet name is required';
          }
          if (!pet.speciesChoice) {
            newErrors[`newClientPet.${pet.id}.species`] = 'Species is required';
          }
          if (!pet.breed?.trim()) {
            newErrors[`newClientPet.${pet.id}.breed`] = 'Breed is required';
          }
          if (!pet.sex?.trim()) {
            newErrors[`newClientPet.${pet.id}.sex`] = 'Sex is required';
          }
          if (!pet.age?.trim()) {
            newErrors[`newClientPet.${pet.id}.age`] = 'Approximate age or birthday is required';
          }
          if (!hasHandlingNeedsAnswer(pet)) {
            newErrors[`newClientPet.${pet.id}.handlingNeeds`] = 'Please select at least one option';
          }
          const petData = formData.petSpecificData?.[pet.id];
          if (!petData?.needsToday) {
            newErrors[`needsToday.${pet.id}`] = 'Please select a reason for the visit';
          } else {
            const typeName = petData.appointmentTypeName || petData.needsToday || '';
            const isEuthanasiaVisit =
              typeName === 'Euthanasia' ||
              typeName.toLowerCase().includes('euthanasia') ||
              petData.needsToday.toLowerCase().includes('euthanasia') ||
              petData.needsToday.toLowerCase().includes('end-of-life');
            if (isEuthanasiaVisit) {
              if (!petData.euthanasiaReason?.trim()) {
                newErrors[`euthanasiaReason.${pet.id}`] = 'Please let us know what is going on with your pet';
              }
              if (!petData.interestedInOtherOptions?.trim()) {
                newErrors[`interestedInOtherOptions.${pet.id}`] = 'Please select an option';
              }
              if (!petData.aftercarePreference?.trim()) {
                newErrors[`aftercarePreference.${pet.id}`] = 'Please select your preferences for aftercare';
              }
            }
          }
        });
      }
    }
    if (!formData.howSoon) {
      newErrors.howSoon = 'Please select how soon you need to be seen';
    }
  };

  const validateExistingClientIntro = (newErrors: Record<string, string>) => {
    if (!formData.bestPhoneNumber?.trim()) newErrors.bestPhoneNumber = 'Phone number is required';
    const addressToCheckExisting = formData.physicalAddress && (formData.physicalAddress.line1 || formData.physicalAddress.city || formData.physicalAddress.state || formData.physicalAddress.zip)
      ? formData.physicalAddress
      : originalAddress;
    const hasAddressForVisit = addressToCheckExisting && (addressToCheckExisting.line1 || addressToCheckExisting.city || addressToCheckExisting.state || addressToCheckExisting.zip);
    if (hasAddressForVisit) {
      if (!formData.isThisTheAddressWhereWeWillCome) newErrors.isThisTheAddressWhereWeWillCome = 'Please select an option';
      if (formData.isThisTheAddressWhereWeWillCome === 'No') {
        if (!formData.newPhysicalAddress?.line1?.trim() || !formData.newPhysicalAddress?.city?.trim() || !formData.newPhysicalAddress?.state?.trim() || !formData.newPhysicalAddress?.zip?.trim()) {
          newErrors['newPhysicalAddress.line1'] = 'Please select your address from the suggestions';
        }
      }
    }
  };

  const validateExistingClientPets = (newErrors: Record<string, string>) => {
    if (formData.selectedPetIds.length === 0) {
      newErrors.selectedPetIds = 'Please select at least one pet';
    } else {
      formData.selectedPetIds.forEach((petId) => {
        const petData = formData.petSpecificData?.[petId];
        if (!petData?.needsToday) {
          newErrors[`needsToday.${petId}`] = 'Please select an option for what your pet needs today';
        }
        if (petData?.needsToday) {
          if (petData.needsToday && isEuthanasiaAppointmentType(petData.needsToday)) {
            if (!petData.euthanasiaReason?.trim()) {
              newErrors[`euthanasiaReason.${petId}`] = 'Please let us know what is going on with your pet';
            }
            if (!petData.interestedInOtherOptions) {
              newErrors[`interestedInOtherOptions.${petId}`] = 'Please select an option';
            }
            if (!petData.aftercarePreference) {
              newErrors[`aftercarePreference.${petId}`] = 'Please select your preferences for aftercare';
            }
          }
        }
      });
    }
    if (formData.existingClientNewPets && formData.existingClientNewPets.length > 0) {
      formData.existingClientNewPets.forEach((pet) => {
        // Blank "+ Add a new pet" stubs left unfinished should not block submit —
        // they are stripped from the payload.
        if (isAbandonedAppointmentRequestPetStub(pet)) return;
        if (!formData.selectedPetIds.includes(pet.id)) return;
        if (!pet.name?.trim()) {
          newErrors[`existingClientNewPet.${pet.id}.name`] = 'Pet name is required';
        }
        if (!pet.speciesChoice) {
          newErrors[`existingClientNewPet.${pet.id}.species`] = 'Species is required';
        }
        if (!pet.breed?.trim()) {
          newErrors[`existingClientNewPet.${pet.id}.breed`] = 'Breed is required';
        }
        if (!pet.sex?.trim()) {
          newErrors[`existingClientNewPet.${pet.id}.sex`] = 'Sex is required';
        }
        if (!pet.age?.trim()) {
          newErrors[`existingClientNewPet.${pet.id}.age`] = 'Approximate age or birthday is required';
        }
        if (!hasHandlingNeedsAnswer(pet)) {
          newErrors[`existingClientNewPet.${pet.id}.handlingNeeds`] = 'Please select at least one option';
        }
        const petData = formData.petSpecificData?.[pet.id];
        if (!petData?.needsToday) {
          newErrors[`needsToday.${pet.id}`] = 'Please select a reason for the visit';
        } else {
          const typeName = petData.appointmentTypeName || petData.needsToday || '';
          const isEuthanasiaVisit =
            typeName === 'Euthanasia' ||
            typeName.toLowerCase().includes('euthanasia') ||
            petData.needsToday.toLowerCase().includes('euthanasia') ||
            petData.needsToday.toLowerCase().includes('end-of-life');
          if (isEuthanasiaVisit) {
            if (!petData.euthanasiaReason?.trim()) {
              newErrors[`euthanasiaReason.${pet.id}`] = 'Please let us know what is going on with your pet';
            }
            if (!petData.interestedInOtherOptions?.trim()) {
              newErrors[`interestedInOtherOptions.${pet.id}`] = 'Please select an option';
            }
            if (!petData.aftercarePreference?.trim()) {
              newErrors[`aftercarePreference.${pet.id}`] = 'Please select your preferences for aftercare';
            }
          }
        }
      });
    }
    if (!formData.howSoon) {
      newErrors.howSoon = 'Please select how soon your pets need to be seen';
    }
    validateOtherHowSoonDateTime(newErrors);
  };

  const validateRequestVisitContinued = (newErrors: Record<string, string>) => {
    if (SHOW_DOCTOR_SELECTION && !formData.preferredDoctorExisting && !formData.preferredDoctor) {
      newErrors.preferredDoctorExisting = 'Please select a preferred doctor';
    }
    if (formData.selfScheduledSlot && !slotDoctorAllowsOnlineBooking) {
      newErrors.selfScheduledSlot = ONLINE_BOOKING_UNAVAILABLE_MESSAGE;
    }
    if (formData.selfScheduledSlot && !speciesAllowOnlineScheduling) {
      newErrors.selfScheduledSlot = ONLINE_BOOKING_OTHER_SPECIES_MESSAGE;
    }
    const isManualScheduling = isManualSchedulingHowSoon(formData.howSoon);
    const isNotUrgentTimeframe = formData.howSoon && !isManualScheduling;

    // Timing is required: either a picked date/time (calendar slot or suggested
    // times) or written preferences in the scheduling notes box.
    if (isNotUrgentTimeframe) {
      const hasPickedSlot = !!formData.selfScheduledSlot;
      const hasSelectedSuggestedTimes =
        Object.keys(formData.selectedDateTimeSlotsVisit || {}).length > 0;
      const hasWrittenPreference =
        !!formData.schedulingNotes?.trim() || !!formData.preferredDateTime?.trim();
      if (!hasPickedSlot && !hasSelectedSuggestedTimes && !hasWrittenPreference) {
        newErrors.schedulingNotes =
          'Please pick a date/time or tell us when you would like the appointment';
      }
    }

    if (isNotUrgentTimeframe && SHOW_TIME_SLOTS) {
      if (recommendedSlots.length > 0) {
        const selectedCount = Object.keys(formData.selectedDateTimeSlotsVisit || {}).length;
        if (selectedCount === 0 && !formData.noneOfWorkForMeVisit) {
          newErrors.selectedDateTimeSlotsVisit = 'Please select your preferred times or indicate that none of these work for you';
        }
      }
    }
    validateOtherHowSoonDateTime(newErrors);
  };

  const validateNewClientIntroContact = (newErrors: Record<string, string>) => {
    const email = formData.email.trim();
    const phone = formData.phoneNumbers.trim();

    if (!email) {
      newErrors.email = 'Email is required';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        newErrors.email = 'Please enter a valid email address';
      }
    }

    if (!phone) {
      newErrors.phoneNumbers = 'Phone number is required';
    }
  };

  const pruneAbandonedExistingClientNewPetStubs = useCallback(() => {
    setFormData((prev) => {
      const current = prev.existingClientNewPets || [];
      if (current.length === 0) return prev;
      const kept = filterCompletedAppointmentRequestPets(current);
      if (kept.length === current.length) return prev;
      const keptIds = new Set(kept.map((p) => p.id));
      const petSpecific = { ...(prev.petSpecificData || {}) };
      for (const p of current) {
        if (!keptIds.has(p.id)) delete petSpecific[p.id];
      }
      return {
        ...prev,
        existingClientNewPets: kept,
        selectedPetIds: prev.selectedPetIds.filter((id) => keptIds.has(id) || !current.some((p) => p.id === id)),
        petSpecificData: petSpecific,
      };
    });
  }, []);

  const validatePage = (page: Page): boolean => {
    const newErrors: Record<string, string> = {};

    switch (page) {
      case 'intro':
        // Skip validation if user is logged in (they won't see this page)
        if (!isLoggedIn) {
          validateNewClientIntroContact(newErrors);
          if (!formData.fullName.first.trim()) newErrors['fullName.first'] = 'First name is required';
          if (!formData.fullName.last.trim()) newErrors['fullName.last'] = 'Last name is required';
          if (!formData.physicalAddress.line1.trim() || !formData.physicalAddress.city.trim() || !formData.physicalAddress.state.trim() || !formData.physicalAddress.zip.trim()) {
            newErrors['physicalAddress.line1'] = 'Please select your address from the suggestions';
          }
          if (!formData.howDidYouHearAboutUs) {
            newErrors.howDidYouHearAboutUs = 'Please tell us how you heard about us';
          } else if (
            formData.howDidYouHearAboutUs === 'Other' &&
            !formData.howDidYouHearAboutUsOther?.trim()
          ) {
            newErrors.howDidYouHearAboutUsOther = 'Please tell us how you heard about us';
          }
        }
        break;
      case 'new-client':
        break;
      case 'new-client-pet-info':
        validateNewClientPetInfo(newErrors);
        validateRequestVisitContinued(newErrors);
        break;
      case 'existing-client':
        if (isLoggedIn) {
          validateExistingClientIntro(newErrors);
          validateExistingClientPets(newErrors);
          validateRequestVisitContinued(newErrors);
        }
        break;
      case 'existing-client-pets':
        if (isLoggedIn) {
          validateExistingClientPets(newErrors);
        } else if (!formData.whatPets?.trim()) {
          newErrors.whatPets = 'Pet information is required';
        }
        break;
      case 'euthanasia-intro':
        if (!formData.euthanasiaReason?.trim()) newErrors.euthanasiaReason = 'Please let us know what is going on with your pet';
        if (!formData.interestedInOtherOptions) newErrors.interestedInOtherOptions = 'Please select an option';
        if (!formData.aftercarePreference) newErrors.aftercarePreference = 'Please select an aftercare preference';
        break;
      case 'euthanasia-continued':
        // Require manual date/time entry (client liaisons will handle scheduling)
        if (!formData.preferredDateTime?.trim()) newErrors.preferredDateTime = 'Please enter your preferred date and time';
        break;
      case 'request-visit-continued':
        validateRequestVisitContinued(newErrors);
        break;
      // Add more validation as needed
    }

    if (visitAddressForZoneCheck && zoneCheckStatus !== 'in_service') {
      if (zoneCheckStatus === 'out_of_service') {
        if (!allowOnFileOutOfAreaRequest) {
          newErrors.zoneNotServiced = errors.zoneNotServiced || ZONE_NOT_SERVICED_MESSAGE;
        }
      } else if (zoneCheckStatus === 'failed') {
        newErrors.zoneNotServiced = ZONE_CHECK_FAILED_MESSAGE;
      } else {
        newErrors.zoneNotServiced = ZONE_CHECK_PENDING_MESSAGE;
      }
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      pendingValidationScrollRef.current = newErrors;
    }

    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    if (!(await ensureVisitZoneInService())) {
      setErrors((prev) => ({
        ...prev,
        zoneNotServiced:
          zoneCheckStatusRef.current === 'out_of_service'
            ? prev.zoneNotServiced || ZONE_NOT_SERVICED_MESSAGE
            : zoneCheckStatusRef.current === 'failed'
              ? ZONE_CHECK_FAILED_MESSAGE
              : ZONE_CHECK_PENDING_MESSAGE,
      }));
      return;
    }
    if (!validatePage(currentPage)) {
      return;
    }
    pruneAbandonedExistingClientNewPetStubs();

    const isExistingClient = isLoggedIn || formData.haveUsedServicesBefore === 'Yes';
    const clientType = isExistingClient ? 'existing' : 'new';

    // Determine next page based on current page and form data
    switch (currentPage) {
      case 'intro':
        // This should only happen if user is not logged in
        if (!isLoggedIn) {
          // Always go to new-client page (question removed)
          // For new clients, check if email already exists
          if (formData.email.trim()) {
            try {
              setCheckingEmail(true);
              const result = await checkEmail(formData.email.trim(), practiceId);
              if (result.exists) {
                openExistingClientModal(result);
                setCheckingEmail(false);
                return;
              }
            } catch (err) {
              console.error('Error checking email:', err);
              // Continue with form if check fails
            } finally {
              setCheckingEmail(false);
            }
          }
          trackFormEvent('appointment_form_step_completed', {
            step: 'intro',
            step_name: 'Introduction',
            next_step: 'new-client-pet-info',
            client_type: 'new',
            is_logged_in: false,
          });
          setCurrentPage('new-client-pet-info');
        }
        break;
      case 'new-client':
        break;
      case 'new-client-pet-info':
        trackFormEvent('appointment_form_step_completed', {
          step: 'new-client-pet-info',
          step_name: 'Pet Information',
          next_step: 'success',
          client_type: 'new',
          is_logged_in: false,
          pet_count: formData.newClientPets?.length || 0,
        });
        handleSubmit();
        break;
      case 'existing-client':
        trackFormEvent('appointment_form_step_completed', {
          step: 'existing-client',
          step_name: 'Request an Appointment',
          next_step: 'success',
          client_type: 'existing',
          is_logged_in: isLoggedIn,
        });
        handleSubmit();
        break;
      case 'existing-client-pets':
        if (formData.lookingForEuthanasiaExisting === 'Yes') {
          setCurrentPage('euthanasia-intro');
          trackFormEvent('appointment_form_step_completed', {
            step: 'existing-client-pets',
            step_name: 'Select Pet(s)',
            next_step: 'euthanasia-intro',
            client_type: 'existing',
            is_logged_in: isLoggedIn,
            appointment_type: 'euthanasia',
            pet_count: formData.selectedPetIds?.length || 0,
          });
        } else {
          setCurrentPage('request-visit-continued');
          trackFormEvent('appointment_form_step_completed', {
            step: 'existing-client-pets',
            step_name: 'Select Pet(s)',
            next_step: 'request-visit-continued',
            client_type: 'existing',
            is_logged_in: isLoggedIn,
            appointment_type: 'regular_visit',
            pet_count: formData.selectedPetIds?.length || 0,
          });
        }
        break;
      case 'euthanasia-intro':
        setCurrentPage('euthanasia-service-area');
        trackFormEvent('appointment_form_step_completed', {
          step: 'euthanasia-intro',
          step_name: 'Euthanasia Details',
          next_step: 'euthanasia-service-area',
          client_type: clientType,
          is_logged_in: isLoggedIn,
          appointment_type: 'euthanasia',
        });
        break;
      case 'euthanasia-service-area':
        if (formData.serviceArea === 'Kennebunk / Greater Portland / Augusta Area') {
          setCurrentPage('euthanasia-portland');
          trackFormEvent('appointment_form_step_completed', {
            step: 'euthanasia-service-area',
            step_name: 'Service Area Selection',
            next_step: 'euthanasia-portland',
            client_type: clientType,
            is_logged_in: isLoggedIn,
            appointment_type: 'euthanasia',
            service_area: 'Kennebunk / Greater Portland / Augusta Area',
          });
        } else if (formData.serviceArea === 'Maine High Peaks Area') {
          setCurrentPage('euthanasia-high-peaks');
          trackFormEvent('appointment_form_step_completed', {
            step: 'euthanasia-service-area',
            step_name: 'Service Area Selection',
            next_step: 'euthanasia-high-peaks',
            client_type: clientType,
            is_logged_in: isLoggedIn,
            appointment_type: 'euthanasia',
            service_area: 'Maine High Peaks Area',
          });
        }
        break;
      case 'euthanasia-portland':
      case 'euthanasia-high-peaks':
        setCurrentPage('euthanasia-continued');
        trackFormEvent('appointment_form_step_completed', {
          step: currentPage,
          step_name: currentPage === 'euthanasia-portland' ? 'Euthanasia Scheduling (Portland)' : 'Euthanasia Scheduling (High Peaks)',
          next_step: 'euthanasia-continued',
          client_type: clientType,
          is_logged_in: isLoggedIn,
          appointment_type: 'euthanasia',
        });
        break;
      case 'euthanasia-continued':
        trackFormEvent('appointment_form_step_completed', {
          step: 'euthanasia-continued',
          step_name: 'Euthanasia Appointment Time',
          next_step: 'success',
          client_type: clientType,
          is_logged_in: isLoggedIn,
          appointment_type: 'euthanasia',
        });
        handleSubmit();
        break;
      case 'request-visit-continued':
        trackFormEvent('appointment_form_step_completed', {
          step: 'request-visit-continued',
          step_name: 'Appointment Time Selection',
          next_step: 'success',
          client_type: clientType,
          is_logged_in: isLoggedIn,
          appointment_type: 'regular_visit',
        });
        handleSubmit();
        break;
    }
  };

  const openMembershipSignupForPet = (pet: EligiblePet) => {
    setSelectedMembershipPet(pet);
    setMembershipModalStep('signup');
  };

  const getModalPetForSignup = (): Pet | { id: string; name: string; species?: string; breed?: string; age?: string; dob?: string } | undefined => {
    if (!selectedMembershipPet) return undefined;
    if (selectedMembershipPet.isBackendPet) {
      const fullPet = pets.find((p) => p.id === selectedMembershipPet.id);
      return fullPet ?? { id: selectedMembershipPet.id, name: selectedMembershipPet.name, species: selectedMembershipPet.species };
    }
    const payload =
      formData.newClientPets?.find((p) => p.id === selectedMembershipPet.id) ||
      formData.existingClientNewPets?.find((p) => p.id === selectedMembershipPet.id);
    if (!payload) return { id: selectedMembershipPet.id, name: selectedMembershipPet.name, species: selectedMembershipPet.species };
    const ageOrDob = payload.age?.trim();
    const looksLikeDate = ageOrDob && /^\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}$/.test(ageOrDob);
    return {
      id: payload.id,
      name: payload.name,
      species: payload.species,
      breed: payload.breed,
      age: looksLikeDate ? undefined : ageOrDob || undefined,
      dob: looksLikeDate ? ageOrDob : undefined,
    };
  };

  const handleBack = () => {
    switch (currentPage) {
      case 'existing-client':
      case 'new-client':
        setCurrentPage('intro');
        break;
      case 'new-client-pet-info':
        setCurrentPage('intro');
        break;
      case 'existing-client-pets':
        setCurrentPage('existing-client');
        break;
      case 'euthanasia-intro':
        if (formData.haveUsedServicesBefore === 'Yes') {
          setCurrentPage('existing-client-pets');
        } else if (!isLoggedIn) {
          setCurrentPage('intro');
        } else {
          setCurrentPage('new-client-pet-info');
        }
        break;
      case 'euthanasia-service-area':
        setCurrentPage('euthanasia-intro');
        break;
      case 'euthanasia-portland':
      case 'euthanasia-high-peaks':
        setCurrentPage('euthanasia-service-area');
        break;
      case 'euthanasia-continued':
        if (formData.serviceArea === 'Kennebunk / Greater Portland / Augusta Area') {
          setCurrentPage('euthanasia-portland');
        } else {
          setCurrentPage('euthanasia-high-peaks');
        }
        break;
      case 'request-visit-continued':
        // For existing clients (logged in or haveUsedServicesBefore), go back to pet selection
        if (isLoggedIn || formData.haveUsedServicesBefore === 'Yes') {
          setCurrentPage('existing-client-pets');
        } else {
          // For new clients, go back to pet information page
          setCurrentPage('new-client-pet-info');
        }
        break;
    }
  };

  const handleBackToPortal = () => {
    // If on intro or success page, navigate immediately without warning
    if (currentPage === 'intro' || currentPage === 'success') {
      navigate('/client-portal');
      return;
    }

    // For other pages, show unsaved changes warning
    const message = "You will lose your data if you leave this form. Are you sure you want to go back to the client portal?";
    const userWantsToLeave = window.confirm(message);
    
    if (userWantsToLeave) {
      void (async () => {
        trackGaAbandon('exit_to_portal');
        await sendAbandon('exit_to_portal', { awaitPutThenPost: true });
        navigate('/client-portal');
      })();
    }
  };

  const handleSubmit = async () => {
    pruneAbandonedExistingClientNewPetStubs();
    if (!(await ensureVisitZoneInService())) {
      setErrors((prev) => ({
        ...prev,
        zoneNotServiced:
          zoneCheckStatusRef.current === 'out_of_service'
            ? prev.zoneNotServiced || ZONE_NOT_SERVICED_MESSAGE
            : zoneCheckStatusRef.current === 'failed'
              ? ZONE_CHECK_FAILED_MESSAGE
              : ZONE_CHECK_PENDING_MESSAGE,
      }));
      return;
    }
    if (!validatePage(currentPage)) {
      return;
    }

    const hasEuthanasiaPet =
      (formData.selectedPetIds?.some((petId) => {
        const petData = formData.petSpecificData?.[petId];
        return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
      }) ||
        false) ||
      (formData.newClientPets?.some((pet) => {
        const petData = formData.petSpecificData?.[pet.id];
        return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
      }) ||
        false);

    const isEuthanasia =
      formData.lookingForEuthanasia === 'Yes' ||
      formData.lookingForEuthanasiaExisting === 'Yes' ||
      hasEuthanasiaPet;
    const appointmentType = isEuthanasia ? 'euthanasia' : 'regular_visit';

    setSubmitting(true);
    try {
      const isExistingClient = isLoggedIn || formData.haveUsedServicesBefore === 'Yes';
      
      // Build selected date/time preferences from slots or free-text scheduling notes
      const buildDateTimePreferences = (slots: Record<string, number>) => {
        if (!slots || Object.keys(slots).length === 0) {
          console.log('[AppointmentForm] No slots selected');
          return null;
        }
        
        console.log('[AppointmentForm] Building preferences from slots:', slots);
        console.log('[AppointmentForm] Available recommendedSlots:', recommendedSlots);
        
        const preferences: Array<{ preference: number; dateTime: string; display: string }> = [];
        Object.entries(slots).forEach(([iso, preference]) => {
          const slot = recommendedSlots.find(s => s.iso === iso);
          if (slot) {
            preferences.push({
              preference,
              dateTime: iso,
              display: slot.display,
            });
          } else {
            // If slot not found in recommendedSlots, still include it with the ISO as display
            // This can happen if recommendedSlots were cleared or changed
            console.warn('[AppointmentForm] Slot not found in recommendedSlots:', iso);
            preferences.push({
              preference,
              dateTime: iso,
              display: iso, // Fallback to ISO if slot not found
            });
          }
        });
        // Sort by preference number
        preferences.sort((a, b) => a.preference - b.preference);
        console.log('[AppointmentForm] Built preferences:', preferences);
        return preferences.length > 0 ? preferences : null;
      };

      const resolveSelectedDateTimePreferences = (slots: Record<string, number>) => {
        const slotPrefs = buildDateTimePreferences(slots);
        if (slotPrefs) return slotPrefs;

        const notes = formData.schedulingNotes?.trim();
        if (!notes) return null;

        return [{ preference: 1, dateTime: notes, display: notes }];
      };

      // Prepare comprehensive submission payload
      const submissionData: any = {
        // Client Information
        clientType: isExistingClient ? 'existing' : 'new',
        isLoggedIn: isLoggedIn,
        ...(isLoggedIn && userId ? { clientId: String(userId), userId: String(userId) } : {}),
        ...(clientPimsIdRef.current ? { clientPimsId: clientPimsIdRef.current } : {}),
        email: formData.email || userEmail || '',
        fullName: {
          first: formData.fullName?.first || '',
          last: formData.fullName?.last || '',
          middle: formData.fullName?.middle || undefined,
          prefix: formData.fullName?.prefix || undefined,
          suffix: formData.fullName?.suffix || undefined,
        },
        
        // Contact Information
        phoneNumber: formData.bestPhoneNumber || formData.phoneNumbers || '',
        canWeText: formData.canWeText || undefined,
        
        // Address Information
        physicalAddress: (() => {
          // Existing client who moved - use new address
          if (isExistingClient && formData.isThisTheAddressWhereWeWillCome === 'No' && formData.newPhysicalAddress) {
            return {
              line1: formData.newPhysicalAddress.line1 || '',
              line2: formData.newPhysicalAddress.line2 || undefined,
              city: formData.newPhysicalAddress.city || '',
              state: formData.newPhysicalAddress.state || '',
              zip: formData.newPhysicalAddress.zip || '',
              country: formData.newPhysicalAddress.country || 'US',
            };
          }
          // Existing client who hasn't moved - use existing address from formData
          if (isExistingClient && formData.isThisTheAddressWhereWeWillCome !== 'No' && formData.physicalAddress) {
            return {
              line1: formData.physicalAddress.line1 || '',
              line2: formData.physicalAddress.line2 || undefined,
              city: formData.physicalAddress.city || '',
              state: formData.physicalAddress.state || '',
              zip: formData.physicalAddress.zip || '',
              country: formData.physicalAddress.country || 'US',
            };
          }
          // New client - use address from form
          if (!isExistingClient && formData.physicalAddress) {
            return {
              line1: formData.physicalAddress.line1 || '',
              line2: formData.physicalAddress.line2 || undefined,
              city: formData.physicalAddress.city || '',
              state: formData.physicalAddress.state || '',
              zip: formData.physicalAddress.zip || '',
              country: formData.physicalAddress.country || 'US',
            };
          }
          return undefined;
        })(),
        
        mailingAddress: isExistingClient && formData.differentMailingAddress === 'Yes' && formData.newMailingAddress
          ? {
              line1: formData.newMailingAddress.line1 || '',
              line2: formData.newMailingAddress.line2 || undefined,
              city: formData.newMailingAddress.city || '',
              state: formData.newMailingAddress.state || '',
              zip: formData.newMailingAddress.zip || '',
              country: formData.newMailingAddress.country || 'US',
            }
          : !isExistingClient && formData.mailingAddressSame === 'Yes, it is different.' && formData.mailingAddress
          ? {
              line1: formData.mailingAddress.line1 || '',
              line2: formData.mailingAddress.line2 || undefined,
              city: formData.mailingAddress.city || '',
              state: formData.mailingAddress.state || '',
              zip: formData.mailingAddress.zip || '',
              country: formData.mailingAddress.country || 'US',
            }
          : undefined,
        
        // Address changed flag - indicates if existing client changed their address
        addressChanged: isExistingClient && formData.isThisTheAddressWhereWeWillCome === 'No' ? true : undefined,
        
        // Pet/Patient Information
        pets: isLoggedIn && formData.selectedPetIds.length > 0
          ? [
              // Existing pets from database
              ...pets.filter(p => formData.selectedPetIds.includes(p.id)).map(p => {
                // Normalize sex value from API format (e.g., "MaleNeutered", "FemaleSpayed") to simple format ("Male", "Female")
                const normalizedSex = p.sex 
                  ? (p.sex.startsWith('Male') ? 'Male' : p.sex.startsWith('Female') ? 'Female' : p.sex)
                  : undefined;
                
                // Determine spayedNeutered based on whether the original sex value contains "Spayed" or "Neutered"
                const spayedNeutered = p.sex && (p.sex.includes('Spayed') || p.sex.includes('Neutered')) ? 'Yes' : 'No';
                
                return {
                  id: p.id,
                  dbId: p.dbId,
                  clientId: p.clientId,
                  name: p.name,
                  species: p.species,
                  breed: p.breed,
                  dob: p.dob,
                  sex: normalizedSex,
                  spayedNeutered: spayedNeutered,
                  subscription: p.subscription,
                  primaryProviderName: p.primaryProviderName,
                  photoUrl: p.photoUrl,
                  wellnessPlans: p.wellnessPlans,
                  alerts: petAlerts.get(p.id) ?? null,
                  needsCalmingMedications:
                    formData.petSpecificData?.[p.id]?.needsCalmingMedications || undefined,
                };
              }),
              // New pets added by existing client (only if selected and not an abandoned blank stub)
              ...(formData.existingClientNewPets || [])
                .filter(
                  (p) =>
                    formData.selectedPetIds.includes(p.id) &&
                    !isAbandonedAppointmentRequestPetStub(p),
                )
                .map(p => ({
                  id: p.id,
                  name: p.name,
                  species: p.species,
                  age: p.age,
                  spayedNeutered: p.spayedNeutered,
                  sex: p.sex,
                  breed: p.breed,
                  color: p.color,
                  weight: p.weight,
                  behaviorAtPreviousVisits: p.behaviorAtPreviousVisits,
                  needsCalmingMedications: p.needsCalmingMedications,
                  hasCalmingMedications: p.hasCalmingMedications,
                  needsMuzzleOrSpecialHandling: p.needsMuzzleOrSpecialHandling,
                  needsExtraHandling: p.needsExtraHandling,
                  new: true, // Mark as new pet for existing client
                }))
            ]
          : undefined,
        
        // Pet information for non-logged-in users
        petInfoText: !isLoggedIn && !formData.newClientPets?.length ? (formData.whatPets || formData.petInfo) : undefined,
        newClientPets: (() => {
          const pets = filterCompletedAppointmentRequestPets(formData.newClientPets);
          return pets.length > 0 ? pets : undefined;
        })(),
        existingClientNewPets: (() => {
          const pets = filterCompletedAppointmentRequestPets(
            (formData.existingClientNewPets || []).filter((p) =>
              formData.selectedPetIds.includes(p.id),
            ),
          );
          return pets.length > 0 ? pets : undefined;
        })(),
        newPetInfo: formData.newPetInfo || undefined,
        
        // All pets data (for logged-in users, include all pets even if not selected)
        allPets: isLoggedIn
          ? [
              // Existing pets from database
              ...(pets.length > 0 ? pets.map(p => {
                // Normalize sex value from API format (e.g., "MaleNeutered", "FemaleSpayed") to simple format ("Male", "Female")
                const normalizedSex = p.sex 
                  ? (p.sex.startsWith('Male') ? 'Male' : p.sex.startsWith('Female') ? 'Female' : p.sex)
                  : undefined;
                
                // Determine spayedNeutered based on whether the original sex value contains "Spayed" or "Neutered"
                const spayedNeutered = p.sex && (p.sex.includes('Spayed') || p.sex.includes('Neutered')) ? 'Yes' : 'No';
                
                return {
                  id: p.id,
                  dbId: p.dbId,
                  clientId: p.clientId,
                  name: p.name,
                  species: p.species,
                  breed: p.breed,
                  dob: p.dob,
                  sex: normalizedSex,
                  spayedNeutered: spayedNeutered,
                  subscription: p.subscription,
                  primaryProviderName: p.primaryProviderName,
                  photoUrl: p.photoUrl,
                  wellnessPlans: p.wellnessPlans,
                  alerts: petAlerts.get(p.id) ?? null,
                  isSelected: formData.selectedPetIds.includes(p.id),
                  needsCalmingMedications:
                    formData.petSpecificData?.[p.id]?.needsCalmingMedications || undefined,
                };
              }) : []),
              // New pets added by existing client (omit abandoned blank stubs)
              ...filterCompletedAppointmentRequestPets(formData.existingClientNewPets || []).map(p => ({
                id: p.id,
                name: p.name,
                species: p.species,
                age: p.age,
                spayedNeutered: p.spayedNeutered,
                sex: p.sex,
                breed: p.breed,
                color: p.color,
                weight: p.weight,
                behaviorAtPreviousVisits: p.behaviorAtPreviousVisits,
                needsCalmingMedications: p.needsCalmingMedications,
                hasCalmingMedications: p.hasCalmingMedications,
                needsMuzzleOrSpecialHandling: p.needsMuzzleOrSpecialHandling,
                needsExtraHandling: p.needsExtraHandling,
                isSelected: formData.selectedPetIds.includes(p.id),
                new: true, // Mark as new pet for existing client
              }))
            ]
          : undefined,
        otherPersonsOnAccount: formData.otherPersonsOnAccount || undefined,
        condoApartmentInfo: formData.condoApartmentInfo || undefined,
        
        // Veterinary History
        previousVeterinaryPractices: formData.previousVeterinaryPractices || formData.previousVeterinaryPracticesExisting || undefined,
        previousVeterinaryHospitals: formData.previousVeterinaryHospitals || undefined,
        okayToContactPreviousVets: !isLoggedIn ? 'Yes' : (formData.okayToContactPreviousVets || formData.okayToContactPreviousVetsExisting || undefined),
        hadVetCareElsewhere: formData.hadVetCareElsewhere || undefined,
        mayWeAskForRecords: formData.mayWeAskForRecords || undefined,
        
        // Pet Behavior & Handling - keep legacy fields for backward compatibility
        petBehaviorAtPreviousVisits: formData.petBehaviorAtPreviousVisits || formData.petBehaviorAtPreviousVisitsExisting || undefined,
        needsCalmingMedications: formData.needsCalmingMedications || undefined,
        hasCalmingMedications: formData.hasCalmingMedications || undefined,
        needsMuzzleOrSpecialHandling: formData.needsMuzzleOrSpecialHandling || undefined,
        
        // Per-pet data - include in payload for API processing (only fields for the selected type)
        petSpecificData: sanitizePetSpecificDataForPayload(formData.petSpecificData),
        
        // Appointment Details
        appointmentType: (() => {
          // Find the appointment type name from the first pet that has one
          let appointmentTypeName: string | undefined;
          
          // Check selectedPetIds (existing pets)
          if (formData.selectedPetIds && formData.petSpecificData) {
            for (const petId of formData.selectedPetIds) {
              const petData = formData.petSpecificData[petId];
              if (petData?.needsToday) {
                appointmentTypeName = petData.needsToday;
                break;
              }
            }
          }
          
          // Check newClientPets if not found yet
          if (!appointmentTypeName && formData.newClientPets && formData.petSpecificData) {
            for (const pet of formData.newClientPets) {
              const petData = formData.petSpecificData[pet.id];
              if (petData?.needsToday) {
                appointmentTypeName = petData.needsToday;
                break;
              }
            }
          }
          
          // Check existingClientNewPets if not found yet
          if (!appointmentTypeName && formData.existingClientNewPets && formData.petSpecificData) {
            for (const pet of formData.existingClientNewPets) {
              const petData = formData.petSpecificData[pet.id];
              if (petData?.needsToday) {
                appointmentTypeName = petData.needsToday;
                break;
              }
            }
          }
          
          // If we found an appointment type (now stored as prettyName), return it directly
          // The needsToday field now stores prettyName, so we can return it as-is
          if (appointmentTypeName) {
            // appointmentTypeName is now the prettyName since needsToday stores prettyName
            return appointmentTypeName;
          }
          
          // Fallback to old logic if no appointment type found
          return isEuthanasia ? 'euthanasia' : 'regular_visit';
        })(),
        preferredDoctor: (() => {
          const selectedDoctor = formData.preferredDoctorExisting || formData.preferredDoctor;
          if (!selectedDoctor || selectedDoctor === 'I have no preference') {
            return undefined;
          }
          return selectedDoctor;
        })(),
        preferredDoctorId: (() => {
          if (formData.selfScheduledSlot?.doctorId != null) {
            const slotDoctorId = formData.selfScheduledSlot.doctorId;
            return isNaN(Number(slotDoctorId)) ? String(slotDoctorId) : String(Number(slotDoctorId));
          }

          const selectedDoctor = formData.preferredDoctorExisting || formData.preferredDoctor;
          if (!selectedDoctor || selectedDoctor === 'I have no preference') {
            return undefined;
          }
          
          const providerList = isLoggedIn ? providers : (publicProviders.length > 0 ? publicProviders.map(p => ({
            id: p.id,
            name: p.name,
            email: p.email || '',
            pimsId: p.id,
          })) : providers);
          
          const doctor = resolveProviderFromDoctorName(selectedDoctor, providerList);
          
          if (doctor) {
            if (doctor.id) {
              return String(doctor.id);
            }
            return doctor.pimsId ? String(doctor.pimsId) : undefined;
          }
          
          return undefined;
        })(),
        serviceArea: formData.serviceArea || formData.serviceAreaVisit || undefined,
        
        // Euthanasia Specific Fields
        ...(isEuthanasia ? {
          euthanasiaReason: formData.euthanasiaReason || undefined,
          interestedInOtherOptions: formData.interestedInOtherOptions || undefined,
          urgency: formData.urgency || undefined,
          preferredDateTime: (() => {
            const trimmed = formData.preferredDateTime?.trim();
            return trimmed && trimmed.length > 0 ? trimmed : undefined;
          })(),
          selectedDateTimePreferences: (() => {
            const prefs = resolveSelectedDateTimePreferences(formData.selectedDateTimeSlots || {});
            console.log('[AppointmentForm] Euthanasia selectedDateTimePreferences:', prefs);
            return prefs;
          })(),
          noneOfWorkForMe: formData.noneOfWorkForMe || false,
          aftercarePreference: formData.aftercarePreference || undefined,
          // Include service minutes if times were selected from the list
          ...(Object.keys(formData.selectedDateTimeSlots || {}).length > 0 && serviceMinutesUsed !== null ? {
            serviceMinutes: serviceMinutesUsed,
          } : {}),
        } : {}),
        
        // Regular Visit Specific Fields
        ...(!isEuthanasia ? {
          visitDetails: formData.visitDetails || undefined,
          needsUrgentScheduling: formData.needsUrgentScheduling || undefined,
          preferredDateTime: (() => {
            if (!isOtherHowSoon(formData.howSoon)) return undefined;
            const trimmed = formData.preferredDateTime?.trim();
            return trimmed && trimmed.length > 0 ? trimmed : undefined;
          })(),
          selectedDateTimePreferences: (() => {
            const prefs = resolveSelectedDateTimePreferences(formData.selectedDateTimeSlotsVisit || {});
            console.log('[AppointmentForm] Regular visit selectedDateTimePreferences:', prefs);
            return prefs;
          })(),
          noneOfWorkForMe: formData.noneOfWorkForMeVisit || false,
          // Include service minutes if times were selected from the list
          ...(Object.keys(formData.selectedDateTimeSlotsVisit || {}).length > 0 && serviceMinutesUsed !== null ? {
            serviceMinutes: serviceMinutesUsed,
          } : {}),
        } : {}),
        
        // Online booking — client picked a slot on the appointment request form
        ...(isOnlineBookingSubmit ? {
          onlineBooking: true,
          ...(routingVisitPets.length > 0 ? { visitPets: routingVisitPets } : {}),
          selectedDateTimePreferences: [{
            preference: 1,
            dateTime: formData.selfScheduledSlot!.appointmentStart,
            display: formatAutobookDateTimePreferenceDisplay({
              doctorName: formData.selfScheduledSlot!.doctorName,
              appointmentStart: formData.selfScheduledSlot!.appointmentStart,
              windowDisplay: formData.selfScheduledSlot!.windowDisplay,
              display: formData.selfScheduledSlot!.display,
              practiceTz: DEFAULT_PRACTICE_TIMEZONE,
            }),
          }],
          serviceMinutes: formData.selfScheduledSlot!.serviceMinutes,
          noneOfWorkForMe: false,
          // Persist the reserved slot (doctor + arrival window) so staff follow-up
          // messaging can reference the held appointment.
          selfScheduledSlot: {
            doctorId: formData.selfScheduledSlot!.doctorId,
            doctorName: formData.selfScheduledSlot!.doctorName,
            appointmentStart: formData.selfScheduledSlot!.appointmentStart,
            display: formData.selfScheduledSlot!.display,
            serviceMinutes: formData.selfScheduledSlot!.serviceMinutes,
            windowStartIso: formData.selfScheduledSlot!.windowStartIso,
            windowEndIso: formData.selfScheduledSlot!.windowEndIso,
            windowDisplay: formData.selfScheduledSlot!.windowDisplay,
          },
          ...(formData.joinWaitlistIfSooner ? { joinWaitlistIfSooner: true } : {}),
        } : {
          onlineBooking: false,
        }),

        // Additional Information
        howSoon: formData.howSoon || undefined,
        schedulingNotes: formData.schedulingNotes?.trim() || undefined,
        anythingElse: formData.schedulingNotes?.trim() || undefined,
        membershipInterest: formData.membershipInterest || undefined,
        ...(!isExistingClient && formData.howDidYouHearAboutUs
          ? {
              howDidYouHearAboutUs: formData.howDidYouHearAboutUs,
              ...(formData.howDidYouHearAboutUs === 'Other' && formData.howDidYouHearAboutUsOther?.trim()
                ? { howDidYouHearAboutUsOther: formData.howDidYouHearAboutUsOther.trim() }
                : {}),
            }
          : {}),
        
        // Appointment request promotion — token (URL) takes precedence over typed code.
        // Skipped entirely when this email already redeemed the promotion.
        ...(promoAlreadyUsed
          ? {}
          : promoToken
          ? { promotionToken: promoToken }
          : appliedCodePromo?.code
          ? { promotionCode: appliedCodePromo.code }
          : {}),

        // Metadata
        formSessionId: formSessionIdRef.current,
        submittedAt: new Date().toISOString(),
        formFlow: {
          startedAsLoggedIn: isLoggedIn,
          startedAsExistingClient: formData.haveUsedServicesBefore === 'Yes',
        },
      };
      
      // Remove undefined values to clean up payload
      const cleanPayload = (obj: any): any => {
        if (Array.isArray(obj)) {
          return obj.map(cleanPayload);
        } else if (obj !== null && typeof obj === 'object') {
          const cleaned: any = {};
          Object.keys(obj).forEach(key => {
            const value = cleanPayload(obj[key]);
            if (value !== undefined) {
              cleaned[key] = value;
            }
          });
          return cleaned;
        }
        return obj;
      };
      
      const finalPayload = cleanPayload(submissionData);
      
      // Send to API endpoint
      const { data: submitResponse } = await http.post('/public/appointments/form', finalPayload);
      const responseMessage = extractApiResponseMessage(submitResponse?.message);
      
      // Track successful form submission
      const petCount = isLoggedIn 
        ? (formData.selectedPetIds?.length || 0)
        : (formData.newClientPets?.length || 0);
      
      markFormCompleted();
      setSubmitSuccessKind(appointmentFormSubmitSuccessKindFromMessage(responseMessage));
      trackFormEvent('appointment_form_submitted', {
        appointment_type: appointmentType,
        pet_count: petCount,
        has_preferred_doctor: !!submissionData.preferredDoctor,
        service_area: formData.serviceArea || formData.serviceAreaVisit || undefined,
        has_time_preferences: !!(formData.selectedDateTimeSlots && Object.keys(formData.selectedDateTimeSlots).length > 0) || 
                              !!(formData.selectedDateTimeSlotsVisit && Object.keys(formData.selectedDateTimeSlotsVisit).length > 0),
        self_scheduled: !!formData.selfScheduledSlot,
        online_booking: isOnlineBookingSubmit,
        how_soon: formData.howSoon || undefined,
        membership_interest: formData.membershipInterest || undefined,
      });
      
      setCurrentPage('success');
    } catch (error: any) {
      const status = error?.response?.status;
      const promoWasSubmitted = !promoAlreadyUsed && (!!promoToken || !!appliedCodePromo?.code);
      let errorMessage: string;
      if (status === 409 && promoWasSubmitted) {
        // The promotion was already redeemed with this email — drop it so the
        // user can resubmit without the discount.
        errorMessage =
          'This promotion has already been used with this email address. Please submit again without it.';
        if (appliedCodePromo) {
          setAppliedCodePromo(null);
          setPromoCodeError('This promotion has already been used with this email address.');
        } else {
          setPromoAlreadyUsed(true);
        }
      } else if (isSlotNoLongerAvailableError(status, error?.response?.data?.message)) {
        errorMessage =
          extractApiResponseMessage(error?.response?.data?.message) ||
          SLOT_NO_LONGER_AVAILABLE_MESSAGE;
        updateFormData('selfScheduledSlot', null);
        setSelfScheduleSlotError(errorMessage);
        setScheduleModalRefreshKey((k) => k + 1);
        setShowSelfScheduleModal(true);
        trackFormEvent('appointment_form_submit_failed', {
          error_message: errorMessage,
          appointment_type: appointmentType,
        });
        return;
      } else if (isOnlineBookingUnavailableError(status, error?.response?.data?.message)) {
        errorMessage = ONLINE_BOOKING_UNAVAILABLE_MESSAGE;
        updateFormData('selfScheduledSlot', null);
      } else {
        errorMessage = error?.response?.data?.message || 'Failed to submit form. Please try again.';
      }
      trackFormEvent('appointment_form_submit_failed', {
        error_message: errorMessage,
        appointment_type: appointmentType,
      });
      setErrors({ submit: errorMessage });
    } finally {
      setSubmitting(false);
    }
  };

  const baskervilleFont = "'Libre Baskerville', 'Times New Roman', serif";
  const isNewClientIntroStep = !isLoggedIn && currentPage === 'intro';
  const isLoggedInIntroLoading = isLoggedIn && currentPage === 'intro';
  const isNewClientPetStep = !isLoggedIn && currentPage === 'new-client-pet-info';
  const newClientCompactForm = isNewClientIntroStep || isNewClientPetStep;
  const newClientSectionGap = newClientCompactForm ? 16 : 20;
  const newClientLabelMb = newClientCompactForm ? 4 : 8;
  const newClientInputPadding = newClientCompactForm ? '8px 10px' : '12px';
  const newClientInputRadius = newClientCompactForm ? '6px' : '8px';

  const renderNewClientLogo = (compact?: boolean) => (
    <div
      onClick={handleBackToPortal}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: compact ? '6px' : isMobile ? '10px' : '20px',
        cursor: 'pointer',
      }}
    >
      <img
        src="/final_thick_lines_cropped.jpeg"
        alt="Vet At Your Door"
        style={{
          height: compact ? (isMobile ? 36 : 40) : isMobile ? '44px' : '60px',
          width: 'auto',
          opacity: 0.9,
          mixBlendMode: 'multiply',
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </div>
  );

  const renderNewClientStepIndicator = (currentStep: 1 | 2, compact?: boolean) => {
    const stepTitle = currentStep === 1 ? 'You' : 'Your Pet 🐾';
    const circleSize = compact ? (isMobile ? 22 : 24) : isMobile ? 26 : 30;
    const lineWidth = compact ? (isMobile ? 48 : 64) : isMobile ? 56 : 80;
    const activeGreen = '#10b981';

    const renderStepCircle = (stepNumber: 1 | 2) => {
      const isActive = currentStep === stepNumber;
      return (
        <div
          aria-current={isActive ? 'step' : undefined}
          style={{
            width: circleSize,
            height: circleSize,
            borderRadius: '50%',
            backgroundColor: isActive ? activeGreen : '#e5e7eb',
            color: isActive ? '#111827' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: isMobile ? '12px' : '13px',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {isActive ? stepNumber : ''}
        </div>
      );
    };

    return (
      <div
        role="progressbar"
        aria-valuenow={currentStep}
        aria-valuemin={1}
        aria-valuemax={2}
        aria-label={`Step ${currentStep} of 2: ${currentStep === 1 ? 'You' : 'Your Pet'}`}
        style={{ marginBottom: compact ? '10px' : '20px', textAlign: 'center' }}
      >
        <div
          style={{
            fontSize: compact ? '13px' : '14px',
            fontWeight: 600,
            color: '#374151',
            marginBottom: compact ? '6px' : '10px',
          }}
        >
          Step {currentStep} of 2: {stepTitle}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {renderStepCircle(1)}
          <div
            style={{
              width: lineWidth,
              height: 2,
              backgroundColor: currentStep === 2 ? activeGreen : '#e5e7eb',
              flexShrink: 0,
            }}
          />
          {renderStepCircle(2)}
        </div>
      </div>
    );
  };

  const renderNewClientPageTitles = (step: 1 | 2) => {
    const compact = newClientCompactForm;

    if (step === 2) {
      return (
        <div style={{ textAlign: 'center', marginBottom: compact ? '10px' : isMobile ? '20px' : '28px' }}>
          <h1
            style={{
              fontFamily: baskervilleFont,
              fontSize: compact ? (isMobile ? '20px' : '26px') : isMobile ? '22px' : '36px',
              fontWeight: 400,
              color: '#111827',
              marginBottom: compact ? '4px' : isMobile ? '6px' : '10px',
              lineHeight: 1.2,
            }}
          >
            Now let&apos;s meet your pet
          </h1>
          <p
            style={{
              fontSize: compact ? '13px' : isMobile ? '14px' : '16px',
              color: '#6b7280',
              margin: 0,
              lineHeight: compact ? 1.35 : 1.5,
              maxWidth: '520px',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            Just a few details and we&apos;re almost done.
          </p>
        </div>
      );
    }

    return (
      <div style={{ textAlign: 'center', marginBottom: compact ? '10px' : isMobile ? '20px' : '28px' }}>
        <h1
          style={{
            fontFamily: baskervilleFont,
            fontSize: compact ? (isMobile ? '20px' : '26px') : isMobile ? '22px' : '36px',
            fontWeight: 400,
            color: '#111827',
            marginBottom: compact ? '4px' : isMobile ? '6px' : '10px',
            lineHeight: 1.2,
          }}
        >
          Request an Appointment
        </h1>
        <h2
          style={{
            fontFamily: baskervilleFont,
            fontSize: compact ? (isMobile ? '16px' : '18px') : isMobile ? '18px' : '24px',
            fontWeight: 400,
            color: '#374151',
            marginBottom: compact ? '4px' : isMobile ? '6px' : '10px',
            lineHeight: 1.25,
          }}
        >
          Let&apos;s get to know each other first
        </h2>
        <p
          style={{
            fontSize: compact ? '12px' : '13px',
            fontWeight: 400,
            color: '#9ca3af',
            margin: 0,
            lineHeight: 1.4,
            maxWidth: '520px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Most families submit this form in under 2 minutes. ✓
        </p>
      </div>
    );
  };

  const renderNewClientPageHeader = (step: 1 | 2) => {
    const compact = newClientCompactForm;
    return (
      <>
        {renderNewClientLogo(compact)}
        {renderNewClientStepIndicator(step, compact)}
        {renderNewClientPageTitles(step)}
      </>
    );
  };

  const renderOtherHowSoonDateTimeField = () => {
    if (!isOtherHowSoon(formData.howSoon)) return null;
    return (
      <div style={{ marginTop: '16px' }} data-form-field="preferredDateTime">
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
          Please enter your preferred date and time: <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <textarea
          value={formData.preferredDateTime || ''}
          onChange={(e) => updateFormData('preferredDateTime', e.target.value)}
          rows={4}
          placeholder="Enter your preferred date and time here..."
          style={{
            width: '100%',
            padding: '12px',
            border: errors.preferredDateTime ? '1px solid #ef4444' : '1px solid #d1d5db',
            borderRadius: '8px',
            fontSize: '14px',
            fontFamily: 'inherit',
          }}
        />
        {errors.preferredDateTime && (
          <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
            {errors.preferredDateTime}
          </div>
        )}
      </div>
    );
  };

  // "None of these work" in the calendar modal → close it and pull the user's
  // attention to the scheduling-preferences field so they can tell us their times.
  const focusSchedulingNotes = useCallback(() => {
    setSelfScheduleSlotError(null);
    setShowSelfScheduleModal(false);
    setHighlightSchedulingNotes(true);
    window.setTimeout(() => {
      const el = schedulingNotesRef.current;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      }
    }, 60);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightSchedulingNotes(false), 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const renderSchedulingNotesField = (style?: {
    labelFontSize?: string;
    labelMb?: string | number;
    inputPadding?: string;
    inputRadius?: string;
    label?: string;
    showLabel?: boolean;
  }) => {
    const labelFontSize = style?.labelFontSize ?? '14px';
    const labelMb = style?.labelMb ?? '8px';
    const inputPadding = style?.inputPadding ?? '12px';
    const inputRadius = style?.inputRadius ?? '8px';
    const label =
      style?.label ?? 'Preferred days/times or anything we should know about scheduling';
    const showLabel = style?.showLabel ?? true;
    return (
      <div data-form-field="schedulingNotes">
        {showLabel ? (
          <label style={{ display: 'block', marginBottom: labelMb, fontWeight: 600, color: '#374151', fontSize: labelFontSize }}>
            {label}
          </label>
        ) : null}
        <textarea
          ref={schedulingNotesRef}
          value={formData.schedulingNotes || ''}
          onChange={(e) => updateFormData('schedulingNotes', e.target.value)}
          placeholder="For example: mornings are best, avoid Tuesdays, flexible, etc."
          rows={3}
          style={{
            width: '100%',
            padding: inputPadding,
            border: errors.schedulingNotes
              ? '2px solid #ef4444'
              : highlightSchedulingNotes
                ? '2px solid #10b981'
                : '1px solid #d1d5db',
            borderRadius: inputRadius,
            fontSize: '16px',
            fontFamily: 'inherit',
            resize: 'vertical',
            backgroundColor: '#fff',
            boxShadow: highlightSchedulingNotes ? '0 0 0 4px rgba(16,185,129,0.22)' : 'none',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          }}
        />
        {errors.schedulingNotes && (
          <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '6px' }}>
            {errors.schedulingNotes}
          </div>
        )}
      </div>
    );
  };

  const renderSchedulingLoadingSpinner = () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '28px 16px',
        marginBottom: '16px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '10px',
        fontSize: '14px',
        color: '#6b7280',
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          border: '3px solid #0d948833',
          borderTop: '3px solid #0d9488',
          borderRadius: '50%',
          animation: 'appt-form-spin 0.8s linear infinite',
          flexShrink: 0,
        }}
      />
      <span>Checking online scheduling options…</span>
      <style>{`@keyframes appt-form-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const renderManualSchedulingLiaisonBanner = () => (
    <div
      style={{
        marginBottom: '16px',
        padding: '16px',
        backgroundColor: '#f0fdf4',
        border: '1px solid #10b981',
        borderRadius: '8px',
        fontSize: '14px',
        color: '#065f46',
        lineHeight: 1.6,
      }}
    >
      <strong>We&apos;ll handle scheduling for you.</strong> Online self-booking isn&apos;t available for this visit. After you submit, our team will reach out to work on scheduling with you.
    </div>
  );

  const renderSchedulingOrDivider = (text = 'or tell us your preferences') => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        margin: '16px 0',
      }}
      aria-hidden
    >
      <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
      <span style={{ fontSize: '13px', fontWeight: 500, color: '#6b7280', whiteSpace: 'nowrap' }}>
        {text}
      </span>
      <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
    </div>
  );

  const renderSelfScheduleOrPreferencesBlock = (options: {
    hasAddress: boolean;
    onPickDate: () => void;
    schedulingNotesStyle?: {
      labelFontSize?: string;
      labelMb?: string | number;
      inputPadding?: string;
      inputRadius?: string;
    };
  }) => (
    <div
      data-form-field="selfScheduledSlot"
      style={{
        padding: '16px',
        backgroundColor: '#f9fafb',
        border: errors.selfScheduledSlot ? '2px solid #ef4444' : '1px solid #e5e7eb',
        borderRadius: '10px',
      }}
    >
      {errors.selfScheduledSlot && (
        <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '10px' }}>
          {errors.selfScheduledSlot}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={options.onPickDate}
          disabled={!options.hasAddress}
          style={{
            width: isMobile ? '100%' : 'auto',
            minWidth: isMobile ? undefined : '280px',
            padding: '12px 22px',
            backgroundColor: options.hasAddress ? '#0d9488' : '#e5e7eb',
            color: options.hasAddress ? '#ffffff' : '#9ca3af',
            border: options.hasAddress ? '2px solid #0f766e' : 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: 700,
            cursor: options.hasAddress ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: options.hasAddress ? '0 2px 5px rgba(13,148,136,0.22)' : 'none',
            transition: 'background-color 0.15s',
          }}
        >
          <span style={{ fontSize: 18 }}>📅</span>
          Pick a Date &amp; Time Now
        </button>
      </div>
      {!options.hasAddress && (
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px', textAlign: 'center' }}>
          {isLoggedIn ? 'Loading your address…' : 'Please enter your complete address above to choose a time.'}
        </div>
      )}
      {renderSchedulingOrDivider()}
      {renderSchedulingNotesField({
        ...options.schedulingNotesStyle,
        label: 'Tell us your preferred times',
      })}
    </div>
  );

  const renderPage = (override?: { page?: Page; embedded?: boolean }) => {
    const pageToRender = override?.page ?? currentPage;
    const embedded = override?.embedded ?? false;
    switch (pageToRender) {
      case 'intro':
        // Logged-in clients skip intro once client data loads; show a brief placeholder meanwhile
        if (isLoggedIn) {
          return (
            <div style={{ textAlign: 'center', padding: isMobile ? '32px 0' : '48px 0', color: '#6b7280', fontSize: '15px' }}>
              Loading your appointment request…
            </div>
          );
        }
        return (
          <div>
            {renderNewClientPageHeader(1)}

            <div style={{ marginBottom: newClientSectionGap }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                  gap: newClientCompactForm ? 8 : 12,
                }}
              >
                <div data-form-field="email">
                  <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                    Email <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={formData.email}
                    onChange={(e) => updateFormData('email', e.target.value)}
                    placeholder="example@example.com"
                    style={{
                      width: '100%',
                      padding: newClientInputPadding,
                      border: `1px solid ${errors.email ? '#ef4444' : '#d1d5db'}`,
                      borderRadius: newClientInputRadius,
                      fontSize: '14px',
                    }}
                  />
                  {checkingEmail && (
                    <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '4px', fontStyle: 'italic' }}>
                      Checking email...
                    </div>
                  )}
                  {emailCheckResult?.exists && !checkingEmail && (
                    <div style={{
                      marginTop: '8px',
                      padding: '10px',
                      backgroundColor: '#fef3c7',
                      border: '1px solid #fbbf24',
                      borderRadius: '8px',
                      fontSize: '14px',
                      color: '#92400e',
                    }}>
                      <strong>Looks like you&apos;re already one of our clients!</strong>{' '}
                      {emailCheckResult.hasAccount ? (
                        <>
                          Please{' '}
                          <a
                            href="#login"
                            onClick={(e) => {
                              e.preventDefault();
                              openExistingClientModal(emailCheckResult, 'login');
                            }}
                            style={{ color: '#d97706', textDecoration: 'underline', fontWeight: 600 }}
                          >
                            log in
                          </a>
                          {isCreateClientEnabled() && (
                            <>
                              {' '}or{' '}
                              <a
                                href="#create-account"
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigateToCreateClient();
                                }}
                                style={{ color: '#d97706', textDecoration: 'underline', fontWeight: 600 }}
                              >
                                create an account
                              </a>
                            </>
                          )}
                          {' '}using this email to request an appointment.
                        </>
                      ) : (
                        <>
                          We have <strong>{formData.email}</strong> on file.{' '}
                          {isCreateClientEnabled() ? (
                            <>
                              <a
                                href="#create-account"
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigateToCreateClient();
                                }}
                                style={{ color: '#d97706', textDecoration: 'underline', fontWeight: 600 }}
                              >
                                Create a portal account
                              </a>
                              {' '}with this email to request an appointment, or{' '}
                            </>
                          ) : null}
                          <a
                            href="#existing-client-help"
                            onClick={(e) => {
                              e.preventDefault();
                              openExistingClientModal(emailCheckResult);
                            }}
                            style={{ color: '#d97706', textDecoration: 'underline', fontWeight: 600 }}
                          >
                            see your options
                          </a>
                          .
                        </>
                      )}
                    </div>
                  )}
                  {errors.email && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.email}</div>
                  )}
                </div>
                <div data-form-field="phoneNumbers">
                  <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                    Phone Number <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={formData.phoneNumbers || ''}
                    onChange={(e) => updateFormData('phoneNumbers', e.target.value)}
                    placeholder="207-555-1234"
                    style={{
                      width: '100%',
                      padding: newClientInputPadding,
                      border: `1px solid ${errors.phoneNumbers ? '#ef4444' : '#d1d5db'}`,
                      borderRadius: newClientInputRadius,
                      fontSize: '14px',
                      fontFamily: 'inherit',
                    }}
                  />
                  {errors.phoneNumbers && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.phoneNumbers}</div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: newClientSectionGap }}>
              <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                Full name <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: newClientCompactForm ? 8 : 12 }}>
                <div data-form-field="fullName.first">
                  <input
                    type="text"
                    value={formData.fullName.first}
                    onChange={(e) => updateNestedFormData('fullName', 'first', e.target.value)}
                    placeholder="First Name"
                    style={{
                      width: '100%',
                      padding: newClientInputPadding,
                      border: `1px solid ${errors['fullName.first'] ? '#ef4444' : '#d1d5db'}`,
                      borderRadius: newClientInputRadius,
                      fontSize: '14px',
                    }}
                  />
                  {errors['fullName.first'] && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors['fullName.first']}</div>}
                </div>
                <div data-form-field="fullName.last">
                  <input
                    type="text"
                    value={formData.fullName.last}
                    onChange={(e) => updateNestedFormData('fullName', 'last', e.target.value)}
                    placeholder="Last Name"
                    style={{
                      width: '100%',
                      padding: newClientInputPadding,
                      border: `1px solid ${errors['fullName.last'] ? '#ef4444' : '#d1d5db'}`,
                      borderRadius: newClientInputRadius,
                      fontSize: '14px',
                    }}
                  />
                  {errors['fullName.last'] && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors['fullName.last']}</div>}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 8,
                marginBottom: newClientSectionGap,
                paddingTop: 20,
                borderTop: '1px solid #d1d5db',
              }}
              data-form-field="physicalAddress.line1"
            >
              <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                Home address (where we would show up) <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <AddressAutocomplete
                id="physical-address"
                value={formData.physicalAddress}
                onChange={(address) => setAddressFields('physicalAddress', address)}
                error={errors['physicalAddress.line1']}
                placeholder="Start typing your address"
                compact={newClientCompactForm}
                showConfirmedMessage={!newClientCompactForm}
                suppressDropdown={showExistingClientModal || showMembershipModal || !!appointmentTypeChangeModal}
              />
              {renderVisitZoneStatus(
                formData.physicalAddress.city,
                formData.physicalAddress.state,
              )}
            </div>

            <div
              style={{
                marginTop: 8,
                marginBottom: newClientSectionGap,
                paddingTop: 20,
                borderTop: '1px solid #d1d5db',
              }}
              data-form-field="mailingAddressSame"
            >
              <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                Do you have a different mailing address where we could send medications or other information if needed?
              </label>
              <p style={{ fontSize: '13px', color: '#6b7280', marginTop: 0, marginBottom: '12px', lineHeight: 1.5 }}>
                We ask in case we ever need to mail prescriptions, lab results, or other paperwork to you.
              </p>
              <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: newClientCompactForm ? 8 : 12 }}>
                {(
                  [
                    { value: 'No, it is the same.', label: 'No — same as my home address' },
                    { value: 'Yes, it is different.', label: 'Yes — I have a different mailing address' },
                  ] as const
                ).map(({ value, label }) => (
                  <label
                    key={value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: newClientInputPadding,
                      border: `1px solid ${errors.mailingAddressSame ? '#ef4444' : formData.mailingAddressSame === value ? '#10b981' : '#d1d5db'}`,
                      borderRadius: newClientInputRadius,
                      backgroundColor: formData.mailingAddressSame === value ? '#f0fdf4' : '#fff',
                      flex: 1,
                      fontSize: '14px',
                    }}
                  >
                    <input
                      type="radio"
                      name="mailingAddressSame"
                      value={value}
                      checked={formData.mailingAddressSame === value}
                      onChange={(e) => updateFormData('mailingAddressSame', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {errors.mailingAddressSame && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>{errors.mailingAddressSame}</div>
              )}
            </div>

            {formData.mailingAddressSame === 'Yes, it is different.' && (
              <div
                style={{
                  marginTop: -8,
                  marginBottom: newClientSectionGap,
                }}
                data-form-field="mailingAddress.line1"
              >
                <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                  Mailing address
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    marginBottom: '12px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#374151',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!formData.mailingAddressManualEntry}
                    onChange={(e) => {
                      const manual = e.target.checked;
                      setFormData((prev) => ({
                        ...prev,
                        mailingAddressManualEntry: manual,
                        mailingAddress: {
                          line1: '',
                          city: '',
                          state: '',
                          zip: '',
                          country: 'US',
                        },
                      }));
                      if (errors['mailingAddress.line1']) {
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next['mailingAddress.line1'];
                          delete next['mailingAddress.city'];
                          delete next['mailingAddress.state'];
                          delete next['mailingAddress.zip'];
                          return next;
                        });
                      }
                    }}
                    style={{ marginTop: '3px' }}
                  />
                  <span>My mailing address is a PO Box or isn&apos;t listed — I&apos;ll enter it manually</span>
                </label>
                {formData.mailingAddressManualEntry ? (
                  <ManualAddressFields
                    value={
                      formData.mailingAddress ?? {
                        line1: '',
                        city: '',
                        state: '',
                        zip: '',
                        country: 'US',
                      }
                    }
                    onChange={(address) => setAddressFields('mailingAddress', address)}
                    errors={errors}
                    errorPrefix="mailingAddress"
                    isMobile={isMobile}
                    line1Placeholder="PO Box 123 or street address"
                  />
                ) : (
                  <AddressAutocomplete
                    id="mailing-address"
                    value={
                      formData.mailingAddress ?? {
                        line1: '',
                        city: '',
                        state: '',
                        zip: '',
                        country: 'US',
                      }
                    }
                    onChange={(address) => setAddressFields('mailingAddress', address)}
                    error={errors['mailingAddress.line1']}
                    placeholder="Start typing your mailing address"
                    compact={newClientCompactForm}
                    showConfirmedMessage={!newClientCompactForm}
                    suppressDropdown={showExistingClientModal || showMembershipModal || !!appointmentTypeChangeModal}
                  />
                )}
              </div>
            )}

            <div
              style={{
                marginTop: 8,
                marginBottom: isNewClientIntroStep ? 0 : 20,
                paddingTop: 20,
                borderTop: '1px solid #d1d5db',
              }}
            >
              <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                Which veterinary practice(s), including specialists, have you used previously for your pet(s)?
              </label>
              <textarea
                value={formData.previousVeterinaryPractices || ''}
                onChange={(e) => updateFormData('previousVeterinaryPractices', e.target.value)}
                rows={isNewClientIntroStep ? 2 : 4}
                style={{
                  width: '100%',
                  padding: newClientInputPadding,
                  border: '1px solid #d1d5db',
                  borderRadius: newClientInputRadius,
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '8px', marginBottom: 0, lineHeight: 1.5 }}>
                We will contact the practice(s) listed above to obtain your pet&apos;s prior medical records.
              </p>
            </div>

            <div
              style={{
                marginTop: 8,
                marginBottom: isNewClientIntroStep ? 0 : 20,
                paddingTop: 20,
                borderTop: '1px solid #d1d5db',
              }}
              data-form-field="howDidYouHearAboutUs"
            >
              <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                How did you hear about us? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                value={formData.howDidYouHearAboutUs || ''}
                onChange={(e) => {
                  const value = e.target.value as HowDidYouHearAboutUsOption | '';
                  setFormData((prev) => ({
                    ...prev,
                    howDidYouHearAboutUs: value,
                    howDidYouHearAboutUsOther:
                      value === 'Other' ? prev.howDidYouHearAboutUsOther : '',
                  }));
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.howDidYouHearAboutUs;
                    if (value !== 'Other') delete next.howDidYouHearAboutUsOther;
                    return next;
                  });
                }}
                style={{
                  width: '100%',
                  padding: newClientInputPadding,
                  border: `1px solid ${errors.howDidYouHearAboutUs ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: newClientInputRadius,
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  backgroundColor: '#fff',
                }}
              >
                <option value="">Select an option</option>
                {HOW_DID_YOU_HEAR_ABOUT_US_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {errors.howDidYouHearAboutUs && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.howDidYouHearAboutUs}</div>
              )}
              {formData.howDidYouHearAboutUs === 'Other' && (
                <div style={{ marginTop: '12px' }} data-form-field="howDidYouHearAboutUsOther">
                  <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                    Please tell us how you heard about us <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.howDidYouHearAboutUsOther || ''}
                    onChange={(e) => {
                      updateFormData('howDidYouHearAboutUsOther', e.target.value);
                      if (errors.howDidYouHearAboutUsOther) {
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.howDidYouHearAboutUsOther;
                          return next;
                        });
                      }
                    }}
                    placeholder="How did you hear about us?"
                    style={{
                      width: '100%',
                      padding: newClientInputPadding,
                      border: `1px solid ${errors.howDidYouHearAboutUsOther ? '#ef4444' : '#d1d5db'}`,
                      borderRadius: newClientInputRadius,
                      fontSize: '14px',
                      fontFamily: 'inherit',
                    }}
                  />
                  {errors.howDidYouHearAboutUsOther && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.howDidYouHearAboutUsOther}</div>
                  )}
                </div>
              )}
            </div>

          </div>
        );

      case 'new-client':
        return null;

      case 'new-client-pet-info': {
        if (isLoggedIn) return null;

        const petFormTight = !embedded && newClientCompactForm;
        const petFieldMb = petFormTight ? 12 : 16;
        const petCardPad = petFormTight ? 12 : 16;
        const petLabelSize = petFormTight ? '13px' : '14px';
        const petInputPad = petFormTight ? newClientInputPadding : '8px';

        const updatePetSpecificData = (petId: string, field: string, value: any) => {
          setFormData(prev => {
            const petData = prev.petSpecificData || {};
            return {
              ...prev,
              petSpecificData: {
                ...petData,
                [petId]: {
                  ...petData[petId],
                  [field]: value,
                },
              },
            };
          });
        };

        const getPetData = (petId: string) => {
          return formData.petSpecificData?.[petId] || {};
        };

        const addNewClientPet = () => {
          const { pet, petSpecific } = createEmptyNewClientPetEntry();
          setFormData(prev => ({
            ...prev,
            newClientPets: [...(prev.newClientPets || []), pet],
            petSpecificData: {
              ...(prev.petSpecificData || {}),
              [pet.id]: petSpecific,
            },
          }));
        };

        const removeNewClientPet = (petId: string) => {
          setFormData(prev => ({
            ...prev,
            newClientPets: (prev.newClientPets || []).filter(p => p.id !== petId)
          }));
        };

        const updateNewClientPet = (petId: string, field: string, value: any) => {
          setFormData(prev => ({
            ...prev,
            newClientPets: (prev.newClientPets || []).map(pet => {
              if (pet.id !== petId) return pet;
              
              if (field === 'speciesChoice') {
                const choice = value as NewClientSpeciesChoice;
                const resolved = resolveSpeciesFromChoice(speciesList, choice);
                return {
                  ...pet,
                  speciesChoice: choice,
                  speciesId: resolved.speciesId,
                  species: resolved.species,
                  breed: '',
                  breedId: undefined,
                };
              }

              if (field === 'breed') {
                return {
                  ...pet,
                  breed: typeof value === 'string' ? value : pet.breed,
                  breedId: undefined,
                };
              }

              if (field === 'breedSelection') {
                const sel = value as { breed: string; breedId?: number };
                return {
                  ...pet,
                  breed: sel.breed,
                  breedId: sel.breedId,
                };
              }

              if (field === 'sex') {
                const sex = value as PetSexOption;
                return {
                  ...pet,
                  sex,
                  spayedNeutered: spayedNeuteredFromPetSex(sex),
                };
              }

              if (field === 'handlingNeeds') {
                return { ...pet, ...(value as PetHandlingFields) };
              }

              // If species is being changed, clear breed
              if (field === 'speciesId') {
                const selectedSpecies = speciesList.find(s => s.id === Number(value));
                return {
                  ...pet,
                  speciesId: value ? Number(value) : undefined,
                  species: selectedSpecies?.name || '',
                  breed: undefined,
                  breedId: undefined
                };
              }
              
              return { ...pet, [field]: value };
            })
          }));
        };

        const isNewClientPetPage = !embedded && newClientCompactForm;

        if (isNewClientPetPage) {
          return (
            <div>
              {renderNewClientPageHeader(2)}

              <div style={{ display: 'flex', flexDirection: 'column', gap: newClientSectionGap }}>
                {(formData.newClientPets || []).map((pet, index) => {
                  const petData = getPetData(pet.id);
                  const appointmentReasonOptions = getAppointmentTypeOptions(pet.id);
                  const selectedAppointmentType = getSelectedNewClientAppointmentType(
                    petData,
                    appointmentReasonOptions,
                  );
                  return (
                    <div
                      key={pet.id}
                      data-pet-id={pet.id}
                      style={{
                        padding: petCardPad,
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: petFieldMb }}>
                        <h3 style={{ fontSize: petFormTight ? '16px' : '17px', fontWeight: 700, color: '#111827', margin: 0 }}>
                          {pet.name?.trim() || `Pet ${index + 1}`}
                        </h3>
                        {(formData.newClientPets?.length || 0) > 1 && (
                          <button
                            type="button"
                            onClick={() => removeNewClientPet(pet.id)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#fee2e2',
                              color: '#991b1b',
                              border: '1px solid #fecaca',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div style={{ marginBottom: petFieldMb }} data-form-field={`newClientPet.${pet.id}.name`}>
                        <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                          Pet Name <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={pet.name || ''}
                          onChange={(e) => updateNewClientPet(pet.id, 'name', e.target.value)}
                          placeholder="Enter pet name"
                          style={{
                            width: '100%',
                            padding: newClientInputPadding,
                            border: `1px solid ${errors[`newClientPet.${pet.id}.name`] ? '#ef4444' : '#d1d5db'}`,
                            borderRadius: newClientInputRadius,
                            fontSize: '14px',
                          }}
                        />
                        {errors[`newClientPet.${pet.id}.name`] && (
                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors[`newClientPet.${pet.id}.name`]}</div>
                        )}
                      </div>

                      <div style={{ marginBottom: petFieldMb }} data-form-field={`newClientPet.${pet.id}.species`}>
                        <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                          Species <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <NewClientSpeciesPicker
                          value={pet.speciesChoice || ''}
                          onChange={(choice) => updateNewClientPet(pet.id, 'speciesChoice', choice)}
                          error={errors[`newClientPet.${pet.id}.species`]}
                        />
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: newClientCompactForm
                            ? isMobile
                              ? '1fr'
                              : 'minmax(0, 13fr) minmax(0, 7fr)'
                            : isMobile
                              ? '1fr'
                              : '1fr 1fr',
                          gap: newClientCompactForm ? 6 : 12,
                          marginBottom: petFieldMb,
                        }}
                      >
                        <div style={{ minWidth: 0 }} data-form-field={`newClientPet.${pet.id}.breed`}>
                          <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                            Breed <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          <BreedCombobox
                            speciesId={pet.speciesId}
                            freeTextOnly={pet.speciesChoice === 'Other'}
                            value={pet.breed || ''}
                            breedId={pet.breedId}
                            practiceId={practiceId}
                            placeholder="Start typing breed"
                            inputPadding={newClientInputPadding}
                            inputRadius={newClientInputRadius}
                            error={errors[`newClientPet.${pet.id}.breed`]}
                            onChange={(breed, breedId) =>
                              updateNewClientPet(pet.id, 'breedSelection', { breed, breedId })
                            }
                          />
                          {errors[`newClientPet.${pet.id}.breed`] && (
                            <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                              {errors[`newClientPet.${pet.id}.breed`]}
                            </div>
                          )}
                        </div>
                        <div style={{ minWidth: 0 }} data-form-field={`newClientPet.${pet.id}.age`}>
                          <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                            Age <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          <input
                            type="text"
                            value={pet.age || ''}
                            onChange={(e) => updateNewClientPet(pet.id, 'age', e.target.value)}
                            placeholder="e.g. 5 years, or DOB if you know it"
                            title="e.g. 5 years, or DOB if you know it"
                            style={{
                              width: '100%',
                              padding: newClientInputPadding,
                              border: `1px solid ${errors[`newClientPet.${pet.id}.age`] ? '#ef4444' : '#d1d5db'}`,
                              borderRadius: newClientInputRadius,
                              fontSize: '14px',
                            }}
                          />
                          {errors[`newClientPet.${pet.id}.age`] && (
                            <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors[`newClientPet.${pet.id}.age`]}</div>
                          )}
                        </div>
                      </div>

                      <div
                        style={{ marginBottom: petFieldMb, maxWidth: isMobile ? '100%' : 280 }}
                        data-form-field={`newClientPet.${pet.id}.weight`}
                      >
                        <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                          Weight
                        </label>
                        <input
                          type="text"
                          value={pet.weight || ''}
                          onChange={(e) => updateNewClientPet(pet.id, 'weight', e.target.value)}
                          placeholder="e.g. 45 lbs"
                          style={{
                            width: '100%',
                            padding: newClientInputPadding,
                            border: '1px solid #d1d5db',
                            borderRadius: newClientInputRadius,
                            fontSize: '14px',
                          }}
                        />
                      </div>

                      <div style={{ marginBottom: petFieldMb }} data-form-field={`newClientPet.${pet.id}.sex`}>
                        <PetSexSelect
                          value={pet.sex || ''}
                          onChange={(sex) => updateNewClientPet(pet.id, 'sex', sex)}
                          error={errors[`newClientPet.${pet.id}.sex`]}
                          labelMb={newClientLabelMb}
                          sectionGap={newClientSectionGap}
                        />
                      </div>

                      <div>
                        <PetVisitQuestionsBlock
                          pet={pet}
                          petData={petData}
                          appointmentOptions={appointmentReasonOptions}
                          loadingAppointmentTypes={loadingAppointmentTypes}
                          selectedAppointmentType={selectedAppointmentType}
                          errors={errors}
                          onUpdatePetData={updatePetSpecificData}
                          onSelectAppointmentType={(option) => applyPetNeedsTodaySelection(pet.id, option)}
                          inputPadding={newClientInputPadding}
                          inputRadius={newClientInputRadius}
                          labelMb={newClientLabelMb}
                          sectionGap={newClientSectionGap}
                        />
                        <div data-form-field={`newClientPet.${pet.id}.handlingNeeds`}>
                          <PetHandlingNeedsPicker
                            pet={pet}
                            petName={pet.name?.trim() || 'your pet'}
                            onChange={(fields) => updateNewClientPet(pet.id, 'handlingNeeds', fields)}
                            error={errors[`newClientPet.${pet.id}.handlingNeeds`]}
                            sectionGap={newClientSectionGap}
                            labelMb={newClientLabelMb}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 24, marginBottom: newClientSectionGap, paddingTop: 20, borderTop: '1px solid #d1d5db' }}>
                <button
                  type="button"
                  onClick={addNewClientPet}
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: '#f0fdf4',
                    color: '#10b981',
                    border: '2px dashed #10b981',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Include another pet for this visit (optional)
                </button>
                {errors.newClientPets && (
                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>{errors.newClientPets}</div>
                )}
              </div>

              {/* How soon — shown in compact new-client-pet-info page */}
              <div
                style={{
                  marginTop: newClientSectionGap,
                  marginBottom: newClientSectionGap,
                  paddingTop: 20,
                  borderTop: '1px solid #d1d5db',
                }}
              >
                <label style={{ display: 'block', marginBottom: newClientLabelMb, fontWeight: 600, color: '#111827', fontSize: '14px' }}>
                  How soon do you need to be seen? <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <NewClientHowSoonPicker
                  value={(formData.howSoon as HowSoonChoiceValue) || ''}
                  onChange={(option) => updateFormData('howSoon', option)}
                  error={errors.howSoon}
                />
                {renderOtherHowSoonDateTimeField()}
              </div>

              {renderPage({ page: 'request-visit-continued', embedded: true })}
            </div>
          );
        }

        return (
          <div>
            {!embedded && renderNewClientPageHeader(2)}
            <div style={{ marginBottom: petFormTight ? newClientSectionGap : 20 }}>
              <label style={{ display: 'block', marginBottom: petFormTight ? newClientLabelMb : 8, fontWeight: 600, color: '#374151', fontSize: petFormTight ? '13px' : undefined }}>
                Your Pet(s) <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ 
                border: `1px solid ${errors.newClientPets ? '#ef4444' : '#d1d5db'}`,
                borderRadius: petFormTight ? newClientInputRadius : '8px',
                padding: petFormTight ? 6 : 8,
                backgroundColor: '#f9fafb',
              }}>
                {(formData.newClientPets || []).map((pet, index) => (
                  <div key={pet.id} style={{ marginBottom: index < (formData.newClientPets?.length || 0) - 1 ? (petFormTight ? 10 : 16) : '0' }}>
                    <div style={{
                      padding: petCardPad,
                      backgroundColor: '#f0fdf4',
                      border: '1px solid #e5e7eb',
                      borderRadius: petFormTight ? newClientInputRadius : '8px',
                      borderLeft: '3px solid #10b981',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: petFieldMb }}>
                        <h3 style={{ fontSize: petFormTight ? '14px' : '16px', fontWeight: 600, color: '#111827', margin: 0 }}>
                          {pet.name || `Pet ${index + 1}`}
                        </h3>
                        <button
                          type="button"
                          onClick={() => removeNewClientPet(pet.id)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>

                      {/* Pet Name */}
                      <div style={{ marginBottom: petFieldMb }}>
                        <label style={{ display: 'block', marginBottom: petFormTight ? 4 : 6, fontWeight: 600, color: '#374151', fontSize: petLabelSize }}>
                          Pet Name <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={pet.name || ''}
                          onChange={(e) => updateNewClientPet(pet.id, 'name', e.target.value)}
                          placeholder="Enter pet name"
                          style={{
                            width: '100%',
                            padding: petInputPad,
                            border: `1px solid ${errors[`newClientPet.${pet.id}.name`] ? '#ef4444' : '#d1d5db'}`,
                            borderRadius: petFormTight ? newClientInputRadius : '6px',
                            fontSize: '14px',
                          }}
                        />
                        {errors[`newClientPet.${pet.id}.name`] && (
                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                            {errors[`newClientPet.${pet.id}.name`]}
                          </div>
                        )}
                      </div>

                      {/* Species and Age */}
                      <div style={{ marginBottom: petFieldMb }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: petFormTight ? 8 : 12 }}>
                          <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Species <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <select
                              value={pet.speciesId || ''}
                              onChange={(e) => updateNewClientPet(pet.id, 'speciesId', e.target.value)}
                              style={{
                                padding: '8px',
                                border: `1px solid ${errors[`newClientPet.${pet.id}.species`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                width: '100%',
                                backgroundColor: '#fff',
                              }}
                            >
                              <option value="">Select species...</option>
                              {loadingSpecies ? (
                                <option disabled>Loading species...</option>
                              ) : (
                                speciesList.map(species => (
                                  <option key={species.id} value={species.id}>
                                    {species.prettyName || species.name}
                                  </option>
                                ))
                              )}
                            </select>
                            {errors[`newClientPet.${pet.id}.species`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.species`]}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Age/DOB <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <input
                              type="text"
                              value={pet.age || ''}
                              onChange={(e) => updateNewClientPet(pet.id, 'age', e.target.value)}
                              placeholder="e.g., 5 years"
                              style={{
                                padding: '8px',
                                border: `1px solid ${errors[`newClientPet.${pet.id}.age`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                width: '100%',
                              }}
                            />
                            {errors[`newClientPet.${pet.id}.age`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.age`]}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div style={{ marginBottom: petFieldMb, maxWidth: isMobile ? '100%' : 200 }}>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                          Weight
                        </label>
                        <input
                          type="text"
                          value={pet.weight || ''}
                          onChange={(e) => updateNewClientPet(pet.id, 'weight', e.target.value)}
                          placeholder="e.g. 45 lbs"
                          style={{
                            padding: '8px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '14px',
                            width: '100%',
                          }}
                        />
                      </div>

                      {/* Calming medications & muzzle */}
                      <div style={{ marginBottom: petFieldMb }}>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                            gap: petFormTight ? 8 : 12,
                          }}
                        >
                          <div>
                            <label style={{ display: 'block', marginBottom: petFormTight ? 4 : 6, fontWeight: 600, color: '#374151', fontSize: petLabelSize }}>
                              Calming medications needed <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <div style={{ display: 'flex', gap: '12px' }}>
                              {['Yes', 'No'].map((option) => (
                                <label
                                  key={option}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                    padding: '8px 12px',
                                    border: `1px solid ${pet.needsCalmingMedications === option ? '#10b981' : '#d1d5db'}`,
                                    borderRadius: '6px',
                                    backgroundColor: pet.needsCalmingMedications === option ? '#f0fdf4' : '#fff',
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`needsCalmingMedications-${pet.id}`}
                                    value={option}
                                    checked={pet.needsCalmingMedications === option}
                                    onChange={(e) => {
                                      updateNewClientPet(pet.id, 'needsCalmingMedications', e.target.value);
                                      if (e.target.value === 'No') {
                                        updateNewClientPet(pet.id, 'hasCalmingMedications', '');
                                      }
                                    }}
                                    style={{ margin: 0 }}
                                  />
                                  <span style={{ fontSize: '14px' }}>{option}</span>
                                </label>
                              ))}
                            </div>
                            {errors[`newClientPet.${pet.id}.needsCalmingMedications`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.needsCalmingMedications`]}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: petFormTight ? 4 : 6, fontWeight: 600, color: '#374151', fontSize: petLabelSize }}>
                              Muzzle needed <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <div style={{ display: 'flex', gap: '12px' }}>
                              {['Yes', 'No'].map((option) => (
                                <label
                                  key={option}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    cursor: 'pointer',
                                    padding: petFormTight ? '6px 10px' : '8px 12px',
                                    border: `1px solid ${pet.needsMuzzleOrSpecialHandling === option ? '#10b981' : '#d1d5db'}`,
                                    borderRadius: petFormTight ? newClientInputRadius : '6px',
                                    backgroundColor: pet.needsMuzzleOrSpecialHandling === option ? '#f0fdf4' : '#fff',
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`needsMuzzleOrSpecialHandling-${pet.id}`}
                                    value={option}
                                    checked={pet.needsMuzzleOrSpecialHandling === option}
                                    onChange={(e) => updateNewClientPet(pet.id, 'needsMuzzleOrSpecialHandling', e.target.value)}
                                    style={{ margin: 0 }}
                                  />
                                  <span style={{ fontSize: '14px' }}>{option}</span>
                                </label>
                              ))}
                            </div>
                            {errors[`newClientPet.${pet.id}.needsMuzzleOrSpecialHandling`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.needsMuzzleOrSpecialHandling`]}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Has Calming Medications */}
                      {pet.needsCalmingMedications === 'Yes' && (
                        <div style={{ marginBottom: '16px' }}>
                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                            Do you have these medications on hand?
                          </label>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            {['Yes', 'No'].map((option) => (
                              <label
                                key={option}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  cursor: 'pointer',
                                  padding: '8px 12px',
                                  border: `1px solid ${pet.hasCalmingMedications === option ? '#10b981' : '#d1d5db'}`,
                                  borderRadius: '6px',
                                  backgroundColor: pet.hasCalmingMedications === option ? '#f0fdf4' : '#fff',
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`hasCalmingMedications-${pet.id}`}
                                  value={option}
                                  checked={pet.hasCalmingMedications === option}
                                  onChange={(e) => updateNewClientPet(pet.id, 'hasCalmingMedications', e.target.value)}
                                  style={{ margin: 0 }}
                                />
                                <span style={{ fontSize: '14px' }}>{option}</span>
                              </label>
                            ))}
                          </div>
                          {pet.hasCalmingMedications === 'No' && (
                            <div style={{ marginTop: '8px' }}>
                              <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 500 }}>
                                Unfortunately we cannot prescribe medications without having seen {pet.name || 'this pet'}. Please get the prescription from your previous vet so you can administer them prior to {pet.name || 'this pet'}'s first visit with us.
                              </span>
                            </div>
                          )}
                          {errors[`newClientPet.${pet.id}.hasCalmingMedications`] && (
                            <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                              {errors[`newClientPet.${pet.id}.hasCalmingMedications`]}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Questions for this pet */}
                      <div style={{
                        marginTop: petFormTight ? 4 : 8,
                        padding: petCardPad,
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: petFormTight ? newClientInputRadius : '8px',
                        borderLeft: '3px solid #10b981',
                      }}>
                        <h3 style={{ fontSize: petLabelSize, fontWeight: 600, color: '#111827', marginBottom: petFormTight ? 8 : 12 }}>
                          Questions for {pet.name || 'this pet'}
                        </h3>
                        
                        {/* What does your pet need today? */}
                        <div style={{ marginBottom: '4px' }}>
                          <label style={{ display: 'block', marginBottom: petFormTight ? 4 : 6, fontWeight: 600, color: '#374151', fontSize: petFormTight ? '13px' : '16px' }}>
                            What does {pet.name || 'this pet'} need today? (Please only choose one)
                          </label>
                          {(() => {
                            const petData = getPetData(pet.id);
                            const appointmentTypeOptions = getAppointmentTypeOptions(pet.id);

                            if (!isPhysicalAddressComplete(formData.physicalAddress)) {
                              return (
                                <div style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>
                                  Enter and confirm your address above to see appointment options.
                                </div>
                              );
                            }

                            if (loadingAppointmentTypes) {
                              return (
                                <div style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>
                                  Loading appointment types...
                                </div>
                              );
                            }

                            if (appointmentTypeOptions.length === 0) {
                              return (
                                <div style={{ padding: '12px', color: '#ef4444', fontSize: '14px' }}>
                                  No appointment types available. Please refresh the page.
                                </div>
                              );
                            }
                            
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {appointmentTypeOptions.map((option) => (
                                  <div key={option.name}>
                                    <label
                                      style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '8px',
                                        cursor: 'pointer',
                                        padding: '5px 0',
                                        backgroundColor: 'transparent',
                                        transition: 'all 0.2s ease',
                                      }}
                                    >
                                      <input
                                        type="radio"
                                        name={`needsToday-${pet.id}`}
                                        value={option.name}
                                        checked={(petData.needsToday === option.prettyName) || (petData.needsToday === option.name)}
                                        onChange={() => {
                                          attemptPetNeedsTodayChange(pet.id, option, getPetData(pet.id));
                                        }}
                                        style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                                      />
                                      <span style={{ fontSize: '16px', lineHeight: '1.4' }}>{option.prettyName}</span>
                                    </label>
                                    {(petData.needsToday === option.prettyName || petData.needsToday === option.name) && (
                                      <div style={{ marginLeft: '26px', marginTop: '8px', marginBottom: '8px' }}>
                                        {isEuthanasiaAppointmentType(option.name) ? (
                                          // Euthanasia questions
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                {EUTHANASIA_SHARE_PROMPT(pet.name || 'your pet')} <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <textarea
                                                value={petData.euthanasiaReason || ''}
                                                onChange={(e) => updatePetSpecificData(pet.id, 'euthanasiaReason', e.target.value)}
                                                rows={5}
                                                style={{
                                                  width: '100%',
                                                  padding: '8px',
                                                  border: `1px solid ${errors[`euthanasiaReason.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                                  borderRadius: '6px',
                                                  fontSize: '14px',
                                                  fontFamily: 'inherit',
                                                }}
                                              />
                                              {errors[`euthanasiaReason.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`euthanasiaReason.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                {EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS_LABEL} <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 10px', lineHeight: 1.45 }}>
                                                {EUTHANASIA_OTHER_OPTIONS_SUPPORT_TEXT}
                                              </p>
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS.map((opt) => (
                                                  <label
                                                    key={opt}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'flex-start',
                                                      gap: '8px',
                                                      cursor: 'pointer',
                                                      padding: '8px 12px',
                                                      border: `1px solid ${petData.interestedInOtherOptions === opt ? '#10b981' : '#d1d5db'}`,
                                                      borderRadius: '6px',
                                                      backgroundColor: petData.interestedInOtherOptions === opt ? '#f0fdf4' : '#fff',
                                                    }}
                                                  >
                                                    <input
                                                      type="radio"
                                                      name={`interestedInOtherOptions-${pet.id}`}
                                                      value={opt}
                                                      checked={petData.interestedInOtherOptions === opt}
                                                      onChange={(e) => updatePetSpecificData(pet.id, 'interestedInOtherOptions', e.target.value)}
                                                      style={{ marginTop: '2px', flexShrink: 0 }}
                                                    />
                                                    <span style={{ fontSize: '14px' }}>{opt}</span>
                                                  </label>
                                                ))}
                                              </div>
                                              {errors[`interestedInOtherOptions.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`interestedInOtherOptions.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                            <div data-form-field={`aftercarePreference.${pet.id}`}>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                {EUTHANASIA_AFTERCARE_LABEL} <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {EUTHANASIA_AFTERCARE_OPTIONS.map((opt) => (
                                                  <label
                                                    key={opt}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'flex-start',
                                                      gap: '8px',
                                                      cursor: 'pointer',
                                                      padding: '8px 12px',
                                                      border: `1px solid ${petData.aftercarePreference === opt ? '#10b981' : '#d1d5db'}`,
                                                      borderRadius: '6px',
                                                      backgroundColor: petData.aftercarePreference === opt ? '#f0fdf4' : '#fff',
                                                    }}
                                                  >
                                                    <input
                                                      type="radio"
                                                      name={`aftercarePreference-${pet.id}`}
                                                      value={opt}
                                                      checked={petData.aftercarePreference === opt}
                                                      onChange={(e) => updatePetSpecificData(pet.id, 'aftercarePreference', e.target.value)}
                                                      style={{ marginTop: '2px', flexShrink: 0 }}
                                                    />
                                                    <span style={{ fontSize: '14px' }}>{opt}</span>
                                                  </label>
                                                ))}
                                              </div>
                                              {errors[`aftercarePreference.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`aftercarePreference.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        ) : (
                                          <textarea
                                            value={petData.needsTodayDetails || ''}
                                            onChange={(e) => updatePetSpecificData(pet.id, 'needsTodayDetails', e.target.value)}
                                            placeholder={
                                              matchesAppointmentTypeName(option.name, ['wellness', 'check-up'])
                                                ? `Do you have any specific concerns you want to discuss at the visit?`
                                                : matchesAppointmentTypeName(option.name, ['not feeling well', 'illness', 'Medical Visit'])
                                                ? `Describe what is going on with ${pet.name || 'this pet'}`
                                                : matchesAppointmentTypeName(option.name, ['recheck', 'follow-up', 'Follow Up'])
                                                ? `What are we checking on for ${pet.name || 'this pet'}?`
                                                : 'Please provide details about the reason for this appointment...'
                                            }
                                            rows={3}
                                            style={{
                                              width: '100%',
                                              padding: '8px',
                                              border: `1px solid ${errors[`needsTodayDetails.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                              borderRadius: '6px',
                                              fontSize: '14px',
                                              fontFamily: 'inherit',
                                            }}
                                          />
                                        )}
                                        {errors[`needsTodayDetails.${pet.id}`] && (
                                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                            {errors[`needsTodayDetails.${pet.id}`]}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {errors[`needsToday.${pet.id}`] && (
                            <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>
                              {errors[`needsToday.${pet.id}`]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add Pet Button */}
                <button
                  type="button"
                  onClick={addNewClientPet}
                  style={{
                    width: '100%',
                    padding: '12px',
                    marginTop: '12px',
                    backgroundColor: '#f0fdf4',
                    color: '#10b981',
                    border: '2px dashed #10b981',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  <span>+</span>
                  <span>{formData.newClientPets && formData.newClientPets.length > 0 ? 'Add Another Pet' : 'Add Pet'}</span>
                </button>
              </div>
              {errors.newClientPets && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
                  {errors.newClientPets}
                </div>
              )}
            </div>

            {/* How soon do your pets need to be seen? - Single question for all pets */}
            <div style={{ marginTop: '24px', marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                How soon do you need to be seen? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <NewClientHowSoonPicker
                value={(formData.howSoon as HowSoonChoiceValue) || ''}
                onChange={(option) => updateFormData('howSoon', option)}
                error={errors.howSoon}
              />
              {renderOtherHowSoonDateTimeField()}
            </div>
            {!embedded && renderPage({ page: 'request-visit-continued', embedded: true })}
          </div>
        );
        break;
      }

      case 'existing-client':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Request an Appointment
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Welcome back! Let&apos;s get your visit request started.
              </p>
            </div>

            <div style={{ marginBottom: '20px' }} data-form-field="bestPhoneNumber">
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What is the best number to reach you? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="tel"
                value={formData.bestPhoneNumber || ''}
                onChange={(e) => {
                  // Normalize phone number: remove +1 prefix if present
                  const normalized = e.target.value.replace(/^\+1\s*/, '').trim();
                  updateFormData('bestPhoneNumber', normalized);
                }}
                placeholder="(207) 555-1234"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.bestPhoneNumber ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              />
              {errors.bestPhoneNumber && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.bestPhoneNumber}</div>}
            </div>
            {/* Display address on file - show if we have address data or original address */}
            {(() => {
              const addressToShow = formData.physicalAddress && (formData.physicalAddress.line1 || formData.physicalAddress.city || formData.physicalAddress.state || formData.physicalAddress.zip)
                ? formData.physicalAddress
                : originalAddress;
              
              return addressToShow && (addressToShow.line1 || addressToShow.city || addressToShow.state || addressToShow.zip) ? (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{
                    padding: '12px',
                    backgroundColor: '#f9fafb',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px',
                    color: '#374151',
                    lineHeight: '1.5',
                  }}>
                    {addressToShow.line1 && <div>{addressToShow.line1}</div>}
                    {addressToShow.line2 && <div>{addressToShow.line2}</div>}
                    {(addressToShow.city || addressToShow.state || addressToShow.zip) && (
                      <div>
                        {[addressToShow.city, addressToShow.state, addressToShow.zip]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Is this the address where we will come to see you? */}
            {(() => {
              const addressToCheck = formData.physicalAddress && (formData.physicalAddress.line1 || formData.physicalAddress.city || formData.physicalAddress.state || formData.physicalAddress.zip)
                ? formData.physicalAddress
                : originalAddress;
              
              return addressToCheck && (addressToCheck.line1 || addressToCheck.city || addressToCheck.state || addressToCheck.zip);
            })() && (
              <div style={{ marginBottom: '20px' }} data-form-field="isThisTheAddressWhereWeWillCome">
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  Is this the address where we will come to see you? <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  {['Yes', 'No'].map((option) => (
                    <label
                      key={option}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        padding: '12px',
                        border: `1px solid ${formData.isThisTheAddressWhereWeWillCome === option ? '#10b981' : '#d1d5db'}`,
                        borderRadius: '8px',
                        backgroundColor: formData.isThisTheAddressWhereWeWillCome === option ? '#f0fdf4' : '#fff',
                        flex: 1,
                      }}
                    >
                      <input
                        type="radio"
                        name="isThisTheAddressWhereWeWillCome"
                        value={option}
                        checked={formData.isThisTheAddressWhereWeWillCome === option}
                        onChange={(e) => updateFormData('isThisTheAddressWhereWeWillCome', e.target.value)}
                        style={{ margin: 0 }}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
                {errors.isThisTheAddressWhereWeWillCome && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.isThisTheAddressWhereWeWillCome}</div>}
                {formData.isThisTheAddressWhereWeWillCome !== 'No' &&
                  renderVisitZoneStatus(
                    formData.physicalAddress?.city || originalAddress?.city,
                    formData.physicalAddress?.state || originalAddress?.state,
                  )}
              </div>
            )}

            {/* Show new address fields if they answered "No" to "Is this the address where we will come to see you?" */}
            {formData.isThisTheAddressWhereWeWillCome === 'No' && (
              <>
                <div style={{ marginBottom: '20px' }} data-form-field="newPhysicalAddress.line1">
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Please let us know where we will meet you. <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <AddressAutocomplete
                    id="new-physical-address"
                    value={
                      formData.newPhysicalAddress ?? {
                        line1: '',
                        city: '',
                        state: '',
                        zip: '',
                        country: 'US',
                      }
                    }
                    onChange={(address) => setAddressFields('newPhysicalAddress', address)}
                    error={errors['newPhysicalAddress.line1']}
                    placeholder="Start typing your address"
                    suppressDropdown={showExistingClientModal || showMembershipModal || !!appointmentTypeChangeModal}
                  />
                  {renderVisitZoneStatus(
                    formData.newPhysicalAddress?.city,
                    formData.newPhysicalAddress?.state,
                  )}
                </div>
              </>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Did your pet(s) get veterinary care from another hospital (e.g. specialists, emergency, etc.) since the last time we saw your pet(s)?
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.hadVetCareElsewhere === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.hadVetCareElsewhere === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="hadVetCareElsewhere"
                      value={option}
                      checked={formData.hadVetCareElsewhere === option}
                      onChange={(e) => updateFormData('hadVetCareElsewhere', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            {formData.hadVetCareElsewhere === 'Yes' && (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Please let us know which veterinary hospitals you went to.
                  </label>
                  <textarea
                    value={formData.previousVeterinaryHospitals || ''}
                    onChange={(e) => updateFormData('previousVeterinaryHospitals', e.target.value)}
                    rows={4}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    May we ask for records from the above hospitals?
                  </label>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px', lineHeight: 1.5 }}>
                    Access to your pet&apos;s prior medical records is important for their safety and continuity of care. Declining to share available records may limit our ability to provide comprehensive care.
                  </p>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    {['Yes', 'No'].map((option) => (
                      <label
                        key={option}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          cursor: 'pointer',
                          padding: '12px',
                          border: `1px solid ${formData.mayWeAskForRecords === option ? '#10b981' : '#d1d5db'}`,
                          borderRadius: '8px',
                          backgroundColor: formData.mayWeAskForRecords === option ? '#f0fdf4' : '#fff',
                          flex: 1,
                        }}
                      >
                        <input
                          type="radio"
                          name="mayWeAskForRecords"
                          value={option}
                          checked={formData.mayWeAskForRecords === option}
                          onChange={(e) => updateFormData('mayWeAskForRecords', e.target.value)}
                          style={{ margin: 0 }}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {renderPage({ page: 'existing-client-pets', embedded: true })}
            {renderPage({ page: 'request-visit-continued', embedded: true })}

                        {/* Temporarily hidden - will be moved elsewhere */}
            {/* <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Are you looking for euthanasia for your pet? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.lookingForEuthanasiaExisting === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.lookingForEuthanasiaExisting === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="lookingForEuthanasiaExisting"
                      value={option}
                      checked={formData.lookingForEuthanasiaExisting === option}
                      onChange={(e) => updateFormData('lookingForEuthanasiaExisting', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
              {errors.lookingForEuthanasiaExisting && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.lookingForEuthanasiaExisting}</div>}
            </div> */}
          </div>
        );

      case 'existing-client-pets': {
        if (!embedded) return null;

        const updatePetSpecificData = (petId: string, field: string, value: any) => {
          setFormData(prev => {
            const petData = prev.petSpecificData || {};
            return {
              ...prev,
              petSpecificData: {
                ...petData,
                [petId]: {
                  ...petData[petId],
                  [field]: value,
                },
              },
            };
          });
        };

        const getPetData = (petId: string) => {
          return formData.petSpecificData?.[petId] || {};
        };

        const ecFieldMb = 10;
        const ecCardPad = 12;
        const ecLabelMb = 4;
        const ecInputPadding = '8px 10px';
        const ecInputRadius = '6px';
        const ecSectionGap = 10;

        const addExistingClientNewPet = () => {
          const { pet, petSpecific } = createEmptyNewClientPetEntry(
            `existing-new-pet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          );
          setFormData(prev => ({
            ...prev,
            existingClientNewPets: [...(prev.existingClientNewPets || []), pet],
            selectedPetIds: [...prev.selectedPetIds, pet.id],
            petSpecificData: {
              ...(prev.petSpecificData || {}),
              [pet.id]: petSpecific,
            },
          }));
        };

        const removeExistingClientNewPet = (petId: string) => {
          setFormData(prev => {
            const { [petId]: _removed, ...restPetSpecific } = prev.petSpecificData || {};
            return {
              ...prev,
              existingClientNewPets: (prev.existingClientNewPets || []).filter(p => p.id !== petId),
              selectedPetIds: prev.selectedPetIds.filter(id => id !== petId),
              petSpecificData: restPetSpecific,
            };
          });
        };

        const updateExistingClientNewPet = (petId: string, field: string, value: any) => {
          setFormData(prev => ({
            ...prev,
            existingClientNewPets: (prev.existingClientNewPets || []).map(pet => {
              if (pet.id !== petId) return pet;

              if (field === 'speciesChoice') {
                const choice = value as NewClientSpeciesChoice;
                const resolved = resolveSpeciesFromChoice(speciesList, choice);
                return {
                  ...pet,
                  speciesChoice: choice,
                  speciesId: resolved.speciesId,
                  species: resolved.species,
                  breed: '',
                  breedId: undefined,
                };
              }

              if (field === 'breedSelection') {
                const sel = value as { breed: string; breedId?: number };
                return {
                  ...pet,
                  breed: sel.breed,
                  breedId: sel.breedId,
                };
              }

              if (field === 'sex') {
                const sex = value as PetSexOption;
                return {
                  ...pet,
                  sex,
                  spayedNeutered: spayedNeuteredFromPetSex(sex),
                };
              }

              if (field === 'handlingNeeds') {
                return { ...pet, ...(value as PetHandlingFields) };
              }

              if (field === 'speciesId') {
                const selectedSpecies = speciesList.find(s => s.id === Number(value));
                return {
                  ...pet,
                  speciesId: value ? Number(value) : undefined,
                  species: selectedSpecies?.name || '',
                  breed: undefined,
                  breedId: undefined,
                };
              }

              return { ...pet, [field]: value };
            }),
          }));
        };

        return (
          <div>
            {!embedded && (
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Select Pet(s)
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Which pet(s) would you like the appointment for?
              </p>
            </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What pet(s) would you like the appointment for? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              {isLoggedIn && pets.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-form-field="selectedPetIds">
                  {pets.map((pet) => {
                    const isSelected = formData.selectedPetIds.includes(pet.id);
                    const petData = getPetData(pet.id);
                    const appointmentReasonOptions = getAppointmentTypeOptions(pet.id);
                    const selectedAppointmentType = getSelectedNewClientAppointmentType(
                      petData,
                      appointmentReasonOptions,
                    );
                    return (
                      <div
                        key={pet.id}
                        data-pet-id={pet.id}
                        style={{
                          padding: 12,
                          backgroundColor: '#fff',
                          border: `2px solid ${
                            isSelected ? '#10b981' : errors.selectedPetIds ? '#ef4444' : '#e5e7eb'
                          }`,
                          borderRadius: 12,
                          boxShadow: isSelected ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
                        }}
                      >
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData(prev => {
                                  const petDataMap = prev.petSpecificData || {};
                                  if (!petDataMap[pet.id]) {
                                    petDataMap[pet.id] = {
                                      needsToday: '',
                                      needsTodayDetails: '',
                                      euthanasiaReason: '',
                                      beenToVetLastThreeMonths: '',
                                      interestedInOtherOptions: '',
                                      aftercarePreference: '',
                                    };
                                  }
                                  return {
                                    ...prev,
                                    selectedPetIds: [...prev.selectedPetIds, pet.id],
                                    petSpecificData: petDataMap,
                                  };
                                });
                              } else {
                                updateFormData('selectedPetIds', formData.selectedPetIds.filter(id => id !== pet.id));
                              }
                            }}
                            style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#10b981' }}
                          />
                          <span style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{pet.name}</span>
                        </label>
                        {isSelected && (
                          <PetVisitQuestionsBlock
                            pet={pet}
                            petData={petData}
                            appointmentOptions={appointmentReasonOptions}
                            loadingAppointmentTypes={loadingAppointmentTypes}
                            selectedAppointmentType={selectedAppointmentType}
                            errors={errors}
                            onUpdatePetData={updatePetSpecificData}
                            onSelectAppointmentType={(option) =>
                              attemptPetNeedsTodayChange(pet.id, option, getPetData(pet.id))
                            }
                            showUsesCalmingMedications
                            calmingPremedType={calmingPremedTypeOption}
                            onUsesCalmingMedicationsChange={(checked) =>
                              handleUsesCalmingMedicationsChange(pet.id, checked)
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                  {formData.selectedPetIds.length === 0 && errors.selectedPetIds && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: 4 }}>
                      Please select at least one pet
                    </div>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={formData.whatPets || ''}
                  onChange={(e) => updateFormData('whatPets', e.target.value)}
                  placeholder="Enter pet name(s)"
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: `1px solid ${errors.whatPets ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: '8px',
                    fontSize: '14px',
                  }}
                />
              )}
              {errors.whatPets && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.whatPets}</div>}
              {errors.selectedPetIds && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.selectedPetIds}</div>}
            </div>

            {isLoggedIn && (
              <div style={{ marginTop: 10, marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={addExistingClientNewPet}
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: '#f0fdf4',
                    color: '#10b981',
                    border: '2px dashed #10b981',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#dcfce7';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#f0fdf4';
                  }}
                >
                  {formData.existingClientNewPets && formData.existingClientNewPets.length > 0
                    ? '+ Include another pet for this visit (optional)'
                    : '+ Add a new pet to this visit'}
                </button>
              </div>
            )}

            {isLoggedIn && formData.existingClientNewPets && formData.existingClientNewPets.length > 0 && (
              <div style={{ marginTop: 24, marginBottom: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: ecSectionGap }}>
                  {formData.existingClientNewPets.map((pet, index) => {
                    const petData = getPetData(pet.id);
                    const appointmentReasonOptions = getAppointmentTypeOptions(pet.id);
                    const selectedAppointmentType = getSelectedNewClientAppointmentType(
                      petData,
                      appointmentReasonOptions,
                    );
                    return (
                      <div
                        key={pet.id}
                        data-pet-id={pet.id}
                        style={{
                          padding: ecCardPad,
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: 12,
                          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: ecFieldMb,
                          }}
                        >
                          <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 }}>
                            {pet.name?.trim() || `New Pet ${index + 1}`}
                          </h3>
                          <button
                            type="button"
                            onClick={() => removeExistingClientNewPet(pet.id)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#fee2e2',
                              color: '#991b1b',
                              border: '1px solid #fecaca',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Remove
                          </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: ecSectionGap }}>
                        <div data-form-field={`existingClientNewPet.${pet.id}.name`}>
                          <label
                            style={{
                              display: 'block',
                              marginBottom: ecLabelMb,
                              fontWeight: 600,
                              color: '#111827',
                              fontSize: '14px',
                            }}
                          >
                            Pet Name <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          <input
                            type="text"
                            value={pet.name || ''}
                            onChange={(e) => updateExistingClientNewPet(pet.id, 'name', e.target.value)}
                            placeholder="Enter pet name"
                            style={{
                              width: '100%',
                              padding: ecInputPadding,
                              border: `1px solid ${errors[`existingClientNewPet.${pet.id}.name`] ? '#ef4444' : '#d1d5db'}`,
                              borderRadius: ecInputRadius,
                              fontSize: '14px',
                            }}
                          />
                          {errors[`existingClientNewPet.${pet.id}.name`] && (
                            <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                              {errors[`existingClientNewPet.${pet.id}.name`]}
                            </div>
                          )}
                        </div>

                        <div data-form-field={`existingClientNewPet.${pet.id}.species`}>
                          <label
                            style={{
                              display: 'block',
                              marginBottom: ecLabelMb,
                              fontWeight: 600,
                              color: '#111827',
                              fontSize: '14px',
                            }}
                          >
                            Species <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          <NewClientSpeciesPicker
                            value={pet.speciesChoice || ''}
                            onChange={(choice) => updateExistingClientNewPet(pet.id, 'speciesChoice', choice)}
                            error={errors[`existingClientNewPet.${pet.id}.species`]}
                          />
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 13fr) minmax(0, 7fr)',
                            gap: 6,
                          }}
                        >
                          <div style={{ minWidth: 0 }} data-form-field={`existingClientNewPet.${pet.id}.breed`}>
                            <label
                              style={{
                                display: 'block',
                                marginBottom: ecLabelMb,
                                fontWeight: 600,
                                color: '#111827',
                                fontSize: '14px',
                              }}
                            >
                              Breed <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <BreedCombobox
                              speciesId={pet.speciesId}
                              freeTextOnly={pet.speciesChoice === 'Other'}
                              value={pet.breed || ''}
                              breedId={pet.breedId}
                              practiceId={practiceId}
                              placeholder="Start typing breed"
                              inputPadding={ecInputPadding}
                              inputRadius={ecInputRadius}
                              error={errors[`existingClientNewPet.${pet.id}.breed`]}
                              onChange={(breed, breedId) =>
                                updateExistingClientNewPet(pet.id, 'breedSelection', { breed, breedId })
                              }
                            />
                            {errors[`existingClientNewPet.${pet.id}.breed`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`existingClientNewPet.${pet.id}.breed`]}
                              </div>
                            )}
                          </div>
                          <div style={{ minWidth: 0 }} data-form-field={`existingClientNewPet.${pet.id}.age`}>
                            <label
                              style={{
                                display: 'block',
                                marginBottom: ecLabelMb,
                                fontWeight: 600,
                                color: '#111827',
                                fontSize: '14px',
                              }}
                            >
                              Age <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <input
                              type="text"
                              value={pet.age || ''}
                              onChange={(e) => updateExistingClientNewPet(pet.id, 'age', e.target.value)}
                              placeholder="e.g. 5 years, or DOB if you know it"
                              title="e.g. 5 years, or DOB if you know it"
                              style={{
                                width: '100%',
                                padding: ecInputPadding,
                                border: `1px solid ${errors[`existingClientNewPet.${pet.id}.age`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: ecInputRadius,
                                fontSize: '14px',
                              }}
                            />
                            {errors[`existingClientNewPet.${pet.id}.age`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`existingClientNewPet.${pet.id}.age`]}
                              </div>
                            )}
                          </div>
                        </div>

                        <div
                          style={{ marginBottom: ecFieldMb, maxWidth: isMobile ? '100%' : 280 }}
                          data-form-field={`existingClientNewPet.${pet.id}.weight`}
                        >
                          <label
                            style={{
                              display: 'block',
                              marginBottom: ecLabelMb,
                              fontWeight: 600,
                              color: '#111827',
                              fontSize: '14px',
                            }}
                          >
                            Weight
                          </label>
                          <input
                            type="text"
                            value={pet.weight || ''}
                            onChange={(e) => updateExistingClientNewPet(pet.id, 'weight', e.target.value)}
                            placeholder="e.g. 45 lbs"
                            style={{
                              width: '100%',
                              padding: ecInputPadding,
                              border: '1px solid #d1d5db',
                              borderRadius: ecInputRadius,
                              fontSize: '14px',
                            }}
                          />
                        </div>

                        <div style={{ marginBottom: ecFieldMb }} data-form-field={`existingClientNewPet.${pet.id}.sex`}>
                          <PetSexSelect
                            value={pet.sex || ''}
                            onChange={(sex) => updateExistingClientNewPet(pet.id, 'sex', sex)}
                            error={errors[`existingClientNewPet.${pet.id}.sex`]}
                            labelMb={ecLabelMb}
                            sectionGap={ecSectionGap}
                          />
                        </div>

                        <div>
                          <PetVisitQuestionsBlock
                            pet={{ id: pet.id, name: pet.name }}
                            petData={petData}
                            appointmentOptions={appointmentReasonOptions}
                            loadingAppointmentTypes={loadingAppointmentTypes}
                            selectedAppointmentType={selectedAppointmentType}
                            errors={errors}
                            onUpdatePetData={updatePetSpecificData}
                            onSelectAppointmentType={(option) =>
                              attemptPetNeedsTodayChange(pet.id, option, getPetData(pet.id))
                            }
                            inputPadding={ecInputPadding}
                            inputRadius={ecInputRadius}
                            labelMb={ecLabelMb}
                            sectionGap={ecSectionGap}
                          />
                          <div data-form-field={`existingClientNewPet.${pet.id}.handlingNeeds`}>
                            <PetHandlingNeedsPicker
                              pet={pet}
                              petName={pet.name?.trim() || 'your pet'}
                              onChange={(fields) => updateExistingClientNewPet(pet.id, 'handlingNeeds', fields)}
                              error={errors[`existingClientNewPet.${pet.id}.handlingNeeds`]}
                              sectionGap={ecSectionGap}
                              labelMb={ecLabelMb}
                            />
                          </div>
                        </div>
                        </div>
                      </div>
                  );
                  })}
                </div>
              </div>
            )}

            {/* How soon do your pets need to be seen? - Single question for all pets */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                How soon do you need to be seen? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <NewClientHowSoonPicker
                value={(formData.howSoon as HowSoonChoiceValue) || ''}
                onChange={(option) => updateFormData('howSoon', option)}
                error={errors.howSoon}
              />
              {renderOtherHowSoonDateTimeField()}
            </div>
          </div>
        );
      }

      case 'euthanasia-intro':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Euthanasia
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Thank you for reaching out to us. We imagine this is a very difficult time for you and we are honored to help you through it. Please fill out the questions below and we will get back to you as soon as possible.
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                {EUTHANASIA_SHARE_PROMPT()} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={formData.euthanasiaReason || ''}
                onChange={(e) => updateFormData('euthanasiaReason', e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.euthanasiaReason ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
              {errors.euthanasiaReason && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.euthanasiaReason}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                {EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS_LABEL} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 12px', lineHeight: 1.5 }}>
                {EUTHANASIA_OTHER_OPTIONS_SUPPORT_TEXT}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS.map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.interestedInOtherOptions === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.interestedInOtherOptions === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="interestedInOtherOptions"
                      value={option}
                      checked={formData.interestedInOtherOptions === option}
                      onChange={(e) => updateFormData('interestedInOtherOptions', e.target.value)}
                      style={{ marginTop: '2px' }}
                    />
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
              {errors.interestedInOtherOptions && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.interestedInOtherOptions}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '20px' }} data-form-field="aftercarePreference">
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                {EUTHANASIA_AFTERCARE_LABEL} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {EUTHANASIA_AFTERCARE_OPTIONS.map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.aftercarePreference === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.aftercarePreference === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="aftercarePreference"
                      value={option}
                      checked={formData.aftercarePreference === option}
                      onChange={(e) => updateFormData('aftercarePreference', e.target.value)}
                      style={{ marginTop: '2px' }}
                    />
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
              {errors.aftercarePreference && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.aftercarePreference}
                </div>
              )}
            </div>
          </div>
        );

      case 'euthanasia-service-area':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Service Area
              </h1>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Which of our service areas do you need services in? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'Kennebunk / Greater Portland / Augusta Area',
                  'Maine High Peaks Area',
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.serviceArea === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.serviceArea === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="serviceArea"
                      value={option}
                      checked={formData.serviceArea === option}
                      onChange={(e) => updateFormData('serviceArea', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 'euthanasia-portland':
      case 'euthanasia-high-peaks':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Euthanasia
              </h1>
              <div style={{ 
                backgroundColor: '#fef3c7', 
                border: '1px solid #fbbf24', 
                borderRadius: '8px', 
                padding: '16px', 
                marginBottom: '20px',
                textAlign: 'left',
              }}>
                <p style={{ fontWeight: 600, marginBottom: '8px' }}>❗An important note about emergent euthanasias:❗</p>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>
                  We offer euthanasias during our normal business hours of 8:00am-5:00pm. We ALSO offer extended euthanasia hours of 5:00-7:00pm on most Mondays through Thursdays unless noted on the website.
                </p>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>
                  If you are contacting us during our normal or extended euthanasia hours and you need help urgently, please choose the "My pet is in immediate distress" option below.
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                How urgently do you need the euthanasia performed? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'My pet is in immediate distress (I need help now / within a few hours)',
                  'The procedure is not urgent / my pet can wait a few days.',
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.urgency === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.urgency === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="urgency"
                      value={option}
                      checked={formData.urgency === option}
                      onChange={(e) => updateFormData('urgency', e.target.value)}
                      style={{ marginTop: '2px' }}
                    />
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 'euthanasia-continued':
        // Check if any pet is selected for euthanasia (existing or new client pets)
        const hasEuthanasiaPetEuthanasiaPage = 
          (formData.selectedPetIds?.some(petId => {
            const petData = formData.petSpecificData?.[petId];
            return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
          }) || false) ||
          (formData.newClientPets?.some(pet => {
            const petData = formData.petSpecificData?.[pet.id];
            return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
          }) || false);

        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Euthanasia (Continued)
              </h1>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What is your preferred date/time for the euthanasia? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  Please enter your preferred date and time: <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  value={formData.preferredDateTime || ''}
                  onChange={(e) => updateFormData('preferredDateTime', e.target.value)}
                  rows={4}
                  placeholder="Enter your preferred date and time here..."
                  style={{
                    width: '100%',
                      padding: '12px',
                    border: errors.preferredDateTime ? '1px solid #ef4444' : '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                  }}
                />
                {errors.preferredDateTime && (
                  <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                    {errors.preferredDateTime}
                  </div>
                )}
              </div>
            </div>

          </div>
        );

      case 'request-visit-continued': {
        const isExistingClientFlow =
          isLoggedIn ||
          formData.haveUsedServicesBefore === 'Yes' ||
          currentPage === 'existing-client' ||
          currentPage === 'existing-client-pets';

        if (embedded) {
          // Embedded on single-page new client intro or existing client page
        } else if (!isExistingClientFlow) {
          return null;
        }

        return (
          <div style={embedded ? { marginTop: '16px' } : undefined}>
            {!embedded && (
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Request Visit (Continued)
              </h1>
            </div>
            )}

            {/* Doctor Selection - at the top of request visit page. Hidden via SHOW_DOCTOR_SELECTION flag. */}
            {SHOW_DOCTOR_SELECTION && (
            <div style={{ marginBottom: '32px', padding: '20px', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }} data-form-field="preferredDoctorExisting">
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                Select a Doctor <span style={{ color: '#ef4444' }}>*</span>{' '}
                <a 
                  href="https://www.vetatyourdoor.com/#team" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ color: '#3b82f6', textDecoration: 'underline', fontWeight: 400, fontSize: '14px' }}
                >
                  (View Our Team)
                </a>
              </label>
              {(() => {
                // Check if address is valid for new clients
                const hasValidAddress = isLoggedIn || (
                  formData.physicalAddress?.line1?.trim() &&
                  formData.physicalAddress?.city?.trim() &&
                  formData.physicalAddress?.state?.trim() &&
                  formData.physicalAddress?.zip?.trim()
                );
                const isDisabled = !isLoggedIn && !hasValidAddress;
                
                // Use the appropriate field based on client type
                const doctorValue = formData.preferredDoctorExisting || formData.preferredDoctor || '';
                const updateDoctor = (value: string) => {
                  if (isLoggedIn || formData.haveUsedServicesBefore === 'Yes') {
                    updateFormData('preferredDoctorExisting', value);
                  } else {
                    updateFormData('preferredDoctor', value);
                  }
                };
                
                return (
                  <>
                    <select
                      value={doctorValue}
                      onChange={(e) => updateDoctor(e.target.value)}
                      disabled={isDisabled || loadingVeterinarians}
                      style={{
                        width: '100%',
                        padding: '12px',
                        border: `1px solid ${errors.preferredDoctorExisting || errors.preferredDoctor ? '#ef4444' : '#d1d5db'}`,
                        borderRadius: '8px',
                        fontSize: '14px',
                        backgroundColor: (isDisabled || loadingVeterinarians) ? '#f3f4f6' : '#fff',
                        cursor: (isDisabled || loadingVeterinarians) ? 'not-allowed' : 'pointer',
                        opacity: (isDisabled || loadingVeterinarians) ? 0.6 : 1,
                      }}
                    >
                      <option value="">
                        {isDisabled 
                          ? 'Please enter your address above first...' 
                          : loadingVeterinarians
                          ? 'Loading doctors...'
                          : 'Select a doctor...'}
                      </option>
                      {!isDisabled && !loadingVeterinarians && (() => {
                        const providerList = (isLoggedIn || formData.haveUsedServicesBefore === 'Yes') 
                          ? providers 
                          : (publicProviders.length > 0 ? publicProviders : providers);
                        
                        return (
                          <>
                            <option value="I have no preference">I have no preference</option>
                            {providerList.map((provider) => {
                              // Check if name already starts with "Dr." to avoid duplication
                              const providerName = provider.name.startsWith('Dr. ') 
                                ? provider.name 
                                : `Dr. ${provider.name}`;
                              return (
                                <option key={provider.id} value={providerName}>
                                  {providerName}
                                </option>
                              );
                            })}
                            {(isLoggedIn || formData.haveUsedServicesBefore === 'Yes') && (
                              <option value="Whomever I saw last time (I don't remember their name)">
                                Whomever I saw last time (I don't remember their name)
                              </option>
                            )}
                          </>
                        );
                      })()}
                    </select>
                    {isDisabled && (
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' }}>
                        Please enter your complete address (street, city, state, zip) above to see available doctors.
                      </div>
                    )}
                    {(errors.preferredDoctorExisting || errors.preferredDoctor) && (
                      <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                        {errors.preferredDoctorExisting || errors.preferredDoctor}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            )}

            {/* Self-scheduling + fallback liaison banner */}
            {(() => {
              if (!formData.howSoon) return null;

              const schedulingNotesStyle = embedded && newClientCompactForm
                ? {
                    labelFontSize: '13px',
                    labelMb: newClientLabelMb,
                    inputPadding: newClientInputPadding,
                    inputRadius: newClientInputRadius,
                  }
                : embedded
                  ? { labelFontSize: '16px', labelMb: '6px' }
                  : undefined;

              const isManualScheduling = isManualSchedulingHowSoon(formData.howSoon);

              // Emergent / Other → liaison banner only
              if (isManualScheduling) {
                return (
                  <div style={{ marginBottom: '20px' }}>
                    {renderManualSchedulingLiaisonBanner()}
                    {renderSchedulingNotesField(schedulingNotesStyle)}
                  </div>
                );
              }

              // Still loading doctors — show spinner instead of the liaison fallback
              if (onlineBookingAvailabilityPending) {
                return (
                  <div style={{ marginBottom: '20px' }}>
                    {renderSchedulingLoadingSpinner()}
                  </div>
                );
              }

              // Manual request flow when online self-booking is not offered
              if (!onlineBookingOffered) {
                return (
                  <div style={{ marginBottom: '20px' }}>
                    {renderManualSchedulingLiaisonBanner()}
                    {renderOtherHowSoonDateTimeField()}
                    {errors.selfScheduledSlot && (
                      <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                        {errors.selfScheduledSlot}
                      </div>
                    )}
                    <div style={{ marginTop: '16px' }}>
                      {renderSchedulingNotesField(schedulingNotesStyle)}
                    </div>
                  </div>
                );
              }

              // Online booking: offer self-scheduling
              const confirmedSlot = formData.selfScheduledSlot;

              const confirmedSlotWindowDisplay =
                confirmedSlot?.windowDisplay ??
                (confirmedSlot
                  ? resolveClientArrivalWindowForScheduledStart(
                      confirmedSlot.appointmentStart,
                      primaryAppointmentType,
                      DEFAULT_PRACTICE_TIMEZONE,
                      {
                        appointmentEndIso:
                          DateTime.fromISO(confirmedSlot.appointmentStart)
                            .plus({ minutes: confirmedSlot.serviceMinutes })
                            .toISO() ?? undefined,
                      },
                    )?.windowDisplay
                  : undefined);

              // Build address string for modal.
              // When the client entered a new visit address, prefer that over the
              // lat/lon stored on their account (clientLocationRef).
              const useNewVisitAddress =
                isLoggedIn &&
                formData.isThisTheAddressWhereWeWillCome === 'No' &&
                isPhysicalAddressComplete(formData.newPhysicalAddress);
              const addrSource = useNewVisitAddress
                ? formData.newPhysicalAddress!
                : isPhysicalAddressComplete(formData.physicalAddress)
                  ? formData.physicalAddress
                  : null;
              const addrLine1 = addrSource?.line1 || '';
              const addrCity  = addrSource?.city  || '';
              const addrState = addrSource?.state || '';
              const addrZip   = addrSource?.zip   || '';
              const builtAddress = addrSource
                ? [addrLine1, addrCity, addrState, addrZip].filter(Boolean).join(', ')
                : '';
              const fullAddress = builtAddress || clientLocationRef.current.address || '';

              // For logged-in clients: location is ready once client record loaded or a
              // complete visit address is on the form (including a new address).
              const hasAddress = !!(
                (isLoggedIn && (clientLocationReady || useNewVisitAddress)) ||
                clientLocationRef.current.address ||
                addrSource
              );

              const lat = useNewVisitAddress
                ? (formData.newPhysicalAddress as AddressFields & { lat?: number })?.lat
                : clientLocationRef.current.lat ??
                  ((formData.physicalAddress as AddressFields & { lat?: number })?.lat);
              const lon = useNewVisitAddress
                ? (formData.newPhysicalAddress as AddressFields & { lon?: number })?.lon
                : clientLocationRef.current.lon ??
                  ((formData.physicalAddress as AddressFields & { lon?: number })?.lon);

              const numPets = routingVisitPetCount(formData);
              const newPatientCount = routingVisitNewPatientCount({
                isNewPatientRequest,
                selectedPetIds: formData.selectedPetIds,
                newClientPets: formData.newClientPets,
                existingClientNewPets: formData.existingClientNewPets,
              });

              return (
                <div style={{ marginBottom: '20px' }}>
                  {confirmedSlot ? (
                    /* ── Confirmed slot chip ── */
                    <>
                    <div style={{
                      padding: '14px 16px',
                      backgroundColor: '#f0fdf4',
                      border: '2px solid #10b981',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                    }}>
                      <span style={{ fontSize: 22, lineHeight: 1 }}>✅</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: '#065f46', marginBottom: '2px' }}>
                          Appointment Scheduled
                        </div>
                        <div style={{ fontSize: '14px', color: '#065f46' }}>
                          {DateTime.fromISO(confirmedSlot.appointmentStart).toFormat('cccc, LLLL d')} with{' '}
                          {confirmedSlot.doctorName}
                        </div>
                        {confirmedSlotWindowDisplay && (
                          <div style={{ fontSize: '13px', color: '#047857', marginTop: '4px' }}>
                            {confirmedSlotWindowDisplay}
                          </div>
                        )}
                        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                          Your appointment will be booked when you submit this form.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          updateFormData('selfScheduledSlot', null);
                          setShowSelfScheduleModal(true);
                        }}
                        style={{
                          background: 'none',
                          border: '1px solid #10b981',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '12px',
                          color: '#065f46',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Change
                      </button>
                    </div>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        marginTop: 12,
                        padding: '12px 14px',
                        border: '1px solid #d1d5db',
                        borderRadius: 10,
                        background: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!formData.joinWaitlistIfSooner}
                        onChange={(e) => updateFormData('joinWaitlistIfSooner', e.target.checked)}
                        style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }}
                      />
                      <span>
                        <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: '#111827' }}>
                          I&apos;d like an earlier appointment if one opens up
                        </span>
                        <span style={{ display: 'block', fontSize: 13, color: '#6b7280', marginTop: 2, fontWeight: 400 }}>
                          We&apos;ll keep this time. If a cancellation opens before then, we&apos;ll reach out.
                        </span>
                      </span>
                    </label>
                    </>
                  ) : (
                    renderSelfScheduleOrPreferencesBlock({
                      hasAddress,
                      schedulingNotesStyle,
                      onPickDate: () => setShowSelfScheduleModal(true),
                    })
                  )}

                  {/* Self-schedule modal */}
                  {showSelfScheduleModal && hasAddress && primaryAppointmentTypeId != null && (
                    <SelfScheduleCalendarModal
                      key={`${scheduleModalRefreshKey}-${lat ?? ''}-${lon ?? ''}-${builtAddress}-${primaryProviderDoctorId ?? ''}-${primaryAppointmentTypeId}-${onlineBookingPatientIds.join(',')}`}
                      practiceId={practiceId}
                      address={fullAddress}
                      lat={lat ?? undefined}
                      lon={lon ?? undefined}
                      numPets={numPets}
                      appointmentTypes={appointmentTypes}
                      appointmentTypeId={primaryAppointmentTypeId}
                      appointmentType={primaryAppointmentType}
                      preferredDoctorId={primaryProviderDoctorId}
                      chartPrimaryProviderId={chartPrimaryProviderDoctorId}
                      initialDoctorId={confirmedSlot?.doctorId ?? primaryProviderDoctorId}
                      isNewClient={!isLoggedIn}
                      newPatientCount={newPatientCount}
                      isNewPatientRequest={isNewPatientRequest}
                      visitPets={routingVisitPets}
                      patientIds={
                        onlineBookingPatientIds.length > 0
                          ? onlineBookingPatientIds
                          : undefined
                      }
                      rawVeterinarians={rawVeterinarianList}
                      slotPickerError={selfScheduleSlotError}
                      // Pass the already-fetched provider list so the modal doesn't need
                      // a second API call. Logged-in clients use the authenticated
                      // /employees/veterinarians endpoint (providers); new clients use
                      // the public endpoint (publicProviders).
                      preloadedDoctors={(() => {
                        if (bookableProvidersForScheduling.length === 0) return undefined;
                        return bookableProvidersForScheduling.map((p) =>
                          mapDoctorForSelfScheduleModal(p, rawVeterinarianList),
                        );
                      })()}
                      // In-zone doctors who can't be booked online for this visit type —
                      // shown greyed so the client can still request them.
                      requestOnlyDoctors={(() => {
                        if (visitAppointmentTypeIds.length === 0) return undefined;
                        const list = isLoggedIn
                          ? providers
                          : (publicProviders.length > 0 ? publicProviders : providers);
                        const reqOnly = list.filter((p) => {
                          const raw = resolveRawVeterinarianById(rawVeterinarianList, p.id);
                          const bookable = isNewPatientRequest
                            ? canBookOnlineForNewPatientRequestForVisitTypes(
                                raw,
                                visitAppointmentTypeIds,
                              )
                            : canBookOnlineForVisitTypes(raw, visitAppointmentTypeIds);
                          if (bookable) return false;
                          // For new-patient requests, only surface vets actually accepting
                          // new patients in this zone.
                          if (isNewPatientRequest && !isVeterinarianAcceptingNewPatientsInClientZone(raw)) {
                            return false;
                          }
                          return true;
                        });
                        if (reqOnly.length === 0) return undefined;
                        return reqOnly.map((p) =>
                          mapDoctorForSelfScheduleModal(p, rawVeterinarianList),
                        );
                      })()}
                      onRequestDoctor={({ doctorName, preferredTimes }) => {
                        const doctorField =
                          isLoggedIn || formData.haveUsedServicesBefore === 'Yes'
                            ? 'preferredDoctorExisting'
                            : 'preferredDoctor';
                        const doctorLabel = doctorName.startsWith('Dr. ')
                          ? doctorName
                          : `Dr. ${doctorName}`;
                        setFormData((prev) => {
                          const requestLine = preferredTimes
                            ? `Requested ${doctorLabel} — preferred times: ${preferredTimes}`
                            : `Requested ${doctorLabel}`;
                          const existingNotes = prev.schedulingNotes?.trim();
                          const mergedNotes = existingNotes
                            ? `${existingNotes}\n${requestLine}`
                            : requestLine;
                          return {
                            ...prev,
                            selfScheduledSlot: null,
                            [doctorField]: doctorLabel,
                            schedulingNotes: mergedNotes,
                          };
                        });
                        focusSchedulingNotes();
                      }}
                      onConfirm={(slot) => {
                        const doctorField =
                          isLoggedIn || formData.haveUsedServicesBefore === 'Yes'
                            ? 'preferredDoctorExisting'
                            : 'preferredDoctor';
                        const doctorLabel = slot.doctorName.startsWith('Dr. ')
                          ? slot.doctorName
                          : `Dr. ${slot.doctorName}`;
                        setFormData((prev) => ({
                          ...prev,
                          selfScheduledSlot: slot,
                          [doctorField]: doctorLabel,
                        }));
                        // Picking a slot satisfies the timing requirement.
                        setErrors((prev) => {
                          if (!prev.schedulingNotes && !prev.selfScheduledSlot) return prev;
                          const next = { ...prev };
                          delete next.schedulingNotes;
                          delete next.selfScheduledSlot;
                          return next;
                        });
                        setSelfScheduleSlotError(null);
                        setShowSelfScheduleModal(false);
                      }}
                      onClose={() => {
                        setSelfScheduleSlotError(null);
                        setShowSelfScheduleModal(false);
                      }}
                      onRequestPreferences={focusSchedulingNotes}
                    />
                  )}
                </div>
              );
            })()}

            {/* Show time slots when self-scheduling is allowed. Hidden via SHOW_TIME_SLOTS flag. */}
            {(() => {
              const isManualScheduling = isManualSchedulingHowSoon(formData.howSoon);
              return !isManualScheduling && SHOW_TIME_SLOTS;
            })() && (
            <div style={{ marginBottom: '20px' }}>
              {loadingSlots && (
                <div style={{
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '16px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #10b981',
                  borderRadius: '8px',
                }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    border: '3px solid #d1fae5',
                    borderTop: '3px solid #10b981',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <span style={{ fontSize: '14px', color: '#065f46', fontWeight: 500 }}>
                    Finding available times for {formData.preferredDoctorExisting || formData.preferredDoctor}...
                  </span>
                  <style>{`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              )}

              {!loadingSlots && recommendedSlots.length > 0 && (
                <>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Here are some possible dates and times. Our schedule is always changing, so these are not guaranteed, but we&apos;ll confirm availability with you as soon as we receive your request.
                  </label>
                  <div style={{ marginBottom: '20px' }} data-form-field="selectedDateTimeSlotsVisit">
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
                      Please select your preferred available times (in order of preference): <span style={{ color: '#ef4444' }}>*</span>
                    </div>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    marginBottom: '12px',
                  }}>
                    {recommendedSlots.map((slot, slotIdx) => {
                      const preference = (formData.selectedDateTimeSlotsVisit || {})[slot.iso];
                      const isSelected = preference !== undefined;
                      return (
                        <label
                          key={slotIdx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            cursor: 'pointer',
                            padding: '12px',
                            border: `1px solid ${isSelected ? '#10b981' : '#d1d5db'}`,
                            borderRadius: '8px',
                            backgroundColor: isSelected ? '#f0fdf4' : '#fff',
                            transition: 'all 0.2s',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const current = formData.selectedDateTimeSlotsVisit || {};
                              if (e.target.checked) {
                                if (formData.noneOfWorkForMeVisit) {
                                  updateFormData('noneOfWorkForMeVisit', false);
                                }
                                const existingPreferences = Object.values(current);
                                const nextPreference = existingPreferences.length > 0
                                  ? Math.max(...existingPreferences) + 1
                                  : 1;
                                updateFormData('selectedDateTimeSlotsVisit', { ...current, [slot.iso]: nextPreference });
                              } else {
                                const { [slot.iso]: removed, ...rest } = current;
                                const renumbered: Record<string, number> = {};
                                Object.entries(rest).forEach(([iso, pref]) => {
                                  renumbered[iso] = pref > removed ? pref - 1 : pref;
                                });
                                updateFormData('selectedDateTimeSlotsVisit', renumbered);
                              }
                            }}
                            style={{ margin: 0, cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '14px', flex: 1 }}>{slot.display}</span>
                          {isSelected && (
                            <span style={{
                              fontSize: '12px',
                              fontWeight: 600,
                              color: '#10b981',
                              backgroundColor: '#d1fae5',
                              padding: '4px 8px',
                              borderRadius: '4px',
                            }}>
                              Preference {preference}
                            </span>
                          )}
                        </label>
                      );
                    })}
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        cursor: 'pointer',
                        padding: '12px',
                        border: `1px solid ${formData.noneOfWorkForMeVisit ? '#ef4444' : '#d1d5db'}`,
                        borderRadius: '8px',
                        backgroundColor: formData.noneOfWorkForMeVisit ? '#fee2e2' : '#fff',
                        transition: 'all 0.2s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formData.noneOfWorkForMeVisit || false}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateFormData('selectedDateTimeSlotsVisit', {});
                            updateFormData('noneOfWorkForMeVisit', true);
                          } else {
                            updateFormData('noneOfWorkForMeVisit', false);
                          }
                        }}
                        style={{ margin: 0, cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '14px', flex: 1, color: formData.noneOfWorkForMeVisit ? '#991b1b' : '#374151' }}>
                        None of these work for me
                      </span>
                    </label>
                  </div>
                  {errors.selectedDateTimeSlotsVisit && (
                    <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                      {errors.selectedDateTimeSlotsVisit}
                    </div>
                  )}
                  </div>
                </>
              )}

              {!isExistingClientFlow &&
                !loadingSlots &&
                recommendedSlots.length === 0 &&
                (formData.preferredDoctorExisting || formData.preferredDoctor) && (
                renderManualSchedulingLiaisonBanner()
              )}
            </div>
            )}

          </div>
        );
      }

      default:
        return <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Page: {pageToRender} - Implementation in progress...</div>;
    }
  };

  const renderMembershipModal = () =>
    showMembershipModal && (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}
        onClick={() => {
          if (membershipModalStep === 'choose-pet') setShowMembershipModal(false);
        }}
      >
        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            padding: membershipModalStep === 'choose-pet' || membershipModalStep === 'success' ? '32px' : '0',
            maxWidth: membershipModalStep === 'signup' || membershipModalStep === 'payment' ? 'min(1120px, 96vw)' : '480px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {membershipEligiblePets.length > 1 && membershipModalStep !== 'success' && (
            <div
              style={{
                marginBottom: 16,
                padding: '12px 16px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                color: '#166534',
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Enroll more than one pet and receive a $75 credit for each additional pet. Credits may be used at any future Vet At Your Door visit.
            </div>
          )}
          {membershipModalStep === 'choose-pet' && (
            <>
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Explore membership
              </h2>
              <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '20px', lineHeight: 1.5 }}>
                Choose a pet to explore membership plans. You can explore memberships for additional pets after completing this one.
              </p>
              {membershipEligiblePets.length === 0 ? (
                <>
                  <p style={{ fontSize: '15px', color: '#374151', marginBottom: '24px' }}>
                    All selected pets already have an active membership, or no pets are selected. You can continue to submit your appointment request.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowMembershipModal(false)}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Done
                  </button>
                </>
              ) : membershipEligiblePets.length === 1 ? (
                <div style={{ marginBottom: '24px' }}>
                  <p style={{ fontSize: '15px', color: '#374151', marginBottom: '12px' }}>
                    Explore membership recommendations for <strong>{membershipEligiblePets[0].name}</strong>.
                  </p>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => openMembershipSignupForPet(membershipEligiblePets[0])}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#10b981',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Explore Membership Options
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowMembershipModal(false)}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#f3f4f6',
                        color: '#374151',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: '15px', color: '#374151', marginBottom: '12px' }}>
                    Which pet would you like to explore membership for?
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                    {membershipEligiblePets.map((p) => (
                      <label
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '12px',
                          cursor: 'pointer',
                          borderRadius: '8px',
                          border: `2px solid ${selectedMembershipPetId === p.id ? '#10b981' : '#e5e7eb'}`,
                          backgroundColor: selectedMembershipPetId === p.id ? '#f0fdf4' : '#fff',
                        }}
                      >
                        <input
                          type="radio"
                          name="membership-pet"
                          checked={selectedMembershipPetId === p.id}
                          onChange={() => setSelectedMembershipPetId(p.id)}
                          style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: 500, color: '#111827' }}>{p.name}</span>
                        {p.species && (
                          <span style={{ fontSize: '13px', color: '#6b7280' }}>({p.species})</span>
                        )}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={!selectedMembershipPetId}
                      onClick={() => {
                        const pet = membershipEligiblePets.find((p) => p.id === selectedMembershipPetId);
                        if (pet) openMembershipSignupForPet(pet);
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: selectedMembershipPetId ? '#10b981' : '#d1d5db',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: selectedMembershipPetId ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Explore Membership Options
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowMembershipModal(false)}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#f3f4f6',
                        color: '#374151',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {membershipModalStep === 'signup' && getModalPetForSignup() && (
            <div style={{ padding: '16px' }}>
              <MembershipSignup
                fromModal
                modalPet={getModalPetForSignup()}
                modalClientInfo={{
                  email: formData.email?.trim() || undefined,
                  fullName: formData.fullName,
                }}
                onProceedToPayment={(state) => {
                  setMembershipPaymentState(state);
                  setMembershipModalStep('payment');
                }}
                onCancel={() => {
                  setMembershipModalStep('choose-pet');
                  setSelectedMembershipPet(null);
                }}
              />
            </div>
          )}

          {membershipModalStep === 'payment' && membershipPaymentState && (
            <div style={{ padding: '16px' }}>
              <MembershipPayment
                fromModal
                initialState={membershipPaymentState}
                onSuccess={() => {
                  setLastSignedUpPetIds((prev) => [...prev, membershipPaymentState.petId]);
                  setMembershipModalStep('success');
                }}
                onBack={() => setMembershipModalStep('signup')}
                onSignUpAnother={(signedUpPetId) => {
                  setLastSignedUpPetIds((prev) => [...prev, signedUpPetId]);
                  setMembershipPaymentState(null);
                  setMembershipModalStep('choose-pet');
                  setSelectedMembershipPet(null);
                  setSelectedMembershipPetId(null);
                }}
              />
            </div>
          )}

          {membershipModalStep === 'success' && (
            <>
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Payment successful
              </h2>
              <p style={{ fontSize: '15px', color: '#374151', marginBottom: lastSignedUpPetIds.length >= 2 ? '12px' : '24px' }}>
                Membership signup is complete. You can sign up another pet or return to your appointment request.
              </p>
              {lastSignedUpPetIds.length >= 2 && (
                <p style={{ fontSize: '15px', padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#166534', marginBottom: '24px', lineHeight: 1.5 }}>
                  You will be receiving a $75 credit in your VAYD account to be used at any visit of your choosing — this won&apos;t expire.
                </p>
              )}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {membershipEligiblePets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMembershipModalStep('choose-pet');
                      setSelectedMembershipPet(null);
                      setSelectedMembershipPetId(null);
                    }}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Sign up another pet
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowMembershipModal(false);
                    setMembershipModalStep('choose-pet');
                    setMembershipPaymentState(null);
                    setSelectedMembershipPet(null);
                    setSelectedMembershipPetId(null);
                  }}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#f3f4f6',
                    color: '#374151',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Done – back to appointment request
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );

  if (currentPage === 'success') {
    return (
      <>
      <div style={{ minHeight: '100vh', width: '100%' }}>
        {/* Header - only show for logged-in users */}
        {isLoggedIn && (
          <header style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            background: '#f8fdfa',
            borderBottom: '1px solid rgba(17, 163, 106, 0.1)',
            backdropFilter: 'saturate(120%) blur(6px)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img
                src="/final_thick_lines_cropped.jpeg"
                alt="VAYD Scout Logo"
                style={{
                  height: '60px',
                  width: 'auto',
                  opacity: 0.9,
                  mixBlendMode: 'multiply',
                }}
              />
              <span style={{
                fontFamily: "'Libre Baskerville', 'Times New Roman', serif",
                fontWeight: 400,
                fontSize: '30px',
                color: '#2c1810',
                lineHeight: '60px',
                display: 'flex',
                alignItems: 'center',
              }}>
                Scout<sup style={{ fontSize: '9px', verticalAlign: 'super', marginLeft: '2px', lineHeight: 0, position: 'relative', top: '-8px' }}>TM</sup>
              </span>
            </div>
          </header>
        )}

        <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 16px' }}>
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            padding: '40px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>✓</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '12px' }}>
            Thank You!
          </h1>
          <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '16px' }}>
            {submitSuccessKind === 'online_confirmed'
              ? 'Your appointment has been booked successfully. Please check your email for confirmation details.'
              : 'We are working on booking your appointment and will be in touch shortly.'}
            {submitSuccessKind === 'online_confirmed' && formData.joinWaitlistIfSooner
              ? ' We’ll also reach out if an earlier time opens up.'
              : ''}
          </p>
          <style>{`
            .appt-form-view-pricing-btn:hover {
              transform: scale(1.02);
              box-shadow: 0 0 20px 4px rgba(15, 118, 110, 0.35);
            }
          `}</style>
          <a
            href="https://www.vetatyourdoor.com/pay-as-you-go"
            target="_blank"
            rel="noopener noreferrer"
            className="appt-form-view-pricing-btn"
            onClick={() => {
              trackFormEvent('appointment_form_confirmation_pricing_cta_clicked', {
                eligible_pet_count: membershipEligiblePets.length,
                membership_interest: formData.membershipInterest ?? undefined,
              });
            }}
            style={{
              padding: '10px 24px',
              backgroundColor: '#fff',
              color: '#0f766e',
              border: '2px solid #0f766e',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block',
              marginBottom: isExploreMembershipsVisible || isLoggedIn ? '24px' : 0,
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            Review Our Pricing
          </a>
          {isExploreMembershipsVisible && (
            <div
              style={{
                marginTop: '0',
                marginBottom: '24px',
                padding: '20px',
                backgroundColor: '#f0fdfa',
                border: '1px solid #99f6e4',
                borderRadius: '12px',
                textAlign: 'left',
              }}
            >
              <p style={{ fontSize: '15px', color: '#374151', lineHeight: 1.6, marginBottom: '12px', fontWeight: 700 }}>
                One-Team Membership is designed for families who want ongoing, relationship-based care with the same trusted veterinary team.
              </p>
              <p style={{ fontSize: '14px', color: '#111827', marginBottom: '8px' }}>Members receive:</p>
              <ul style={{ margin: '0 0 16px 20px', padding: 0, fontSize: '14px', color: '#374151', lineHeight: 1.7 }}>
                <li>Priority scheduling with their dedicated veterinary One-Team</li>
                <li>Comprehensive Wellness care, including travel fees</li>
                <li>Vaccines and recommended screening labs</li>
                <li>Priority 7-day support from VAYD staff</li>
                <li>50% off exams on additional visits</li>
                <li>Member pricing (10% off) in our online store</li>
              </ul>
              <p style={{ fontSize: '15px', fontWeight: 700, color: '#374151', lineHeight: 1.6, marginBottom: '16px' }}>
                If you&apos;d like ongoing care with Vet At Your Door, you can explore and join One-Team Membership below.
              </p>
              <style>{`
                @keyframes exploreMembershipsPopIn {
                  0% { transform: scale(0.92); opacity: 0.6; box-shadow: 0 0 0 0 rgba(15, 118, 110, 0); }
                  50% { transform: scale(1.06); opacity: 1; box-shadow: 0 0 0 8px rgba(15, 118, 110, 0.15); }
                  100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 rgba(15, 118, 110, 0); }
                }
                .appt-form-view-membership-btn:hover {
                  transform: scale(1.02);
                  box-shadow: 0 0 20px 4px rgba(15, 118, 110, 0.35);
                }
              `}</style>
              <button
                type="button"
                className="appt-form-view-membership-btn"
                onClick={() => {
                  trackFormEvent('appointment_form_confirmation_membership_cta_clicked', {
                    eligible_pet_count: membershipEligiblePets.length,
                    membership_interest: formData.membershipInterest ?? undefined,
                  });
                  setSelectedMembershipPetId(null);
                  setMembershipModalStep('choose-pet');
                  setShowMembershipModal(true);
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#0f766e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
              >
                Review & Join Membership Now
              </button>
              <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '16px', fontStyle: 'italic' }}>
                Membership is optional.
              </p>
            </div>
          )}
          {isLoggedIn && (
            <button
              onClick={() => navigate('/client-portal')}
              style={{
                padding: '12px 24px',
                backgroundColor: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Return to Portal
            </button>
          )}
        </div>
        </div>

        {/* Footer */}
        <footer
          style={{
            marginTop: '40px',
            padding: '24px 16px',
            borderTop: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '12px', color: '#6b7280' }}>
            © 2026. All rights reserved.
          </div>
        </footer>
      </div>
      {renderMembershipModal()}
    </>
    );
  }

  // Map page variations to main step IDs for progress tracking
  const getMainStepId = (page: Page): Page => {
    if (page === 'euthanasia-portland' || page === 'euthanasia-high-peaks') {
      return 'euthanasia-service-area';
    }
    // existing-client-pets is a separate step, so return it as-is
    return page;
  };

  // Determine progress steps based on flow - always show all steps for the user's flow
  const getProgressSteps = (): Array<{ id: Page; label: string }> => {
    const allSteps: Array<{ id: Page; label: string }> = [];
    
    // Determine if user is existing client (logged in) or new client
    const isExistingClient = isLoggedIn || formData.haveUsedServicesBefore === 'Yes' || 
                            currentPage === 'existing-client' || currentPage === 'existing-client-pets';
    
    if (isExistingClient) {
      allSteps.push({ id: 'existing-client', label: 'Request an Appointment' });
    } else {
      allSteps.push({ id: 'intro', label: 'Your info' });
      allSteps.push({ id: 'new-client-pet-info', label: 'Your pet' });
    }
    
    // Always return all steps - getStepStatus will handle highlighting
    return allSteps;
  };

  const progressSteps = getProgressSteps();
  
  const getStepStatus = (stepId: Page): 'completed' | 'current' | 'upcoming' => {
    const mainCurrentPage = getMainStepId(currentPage);
    const currentIndex = progressSteps.findIndex(s => s.id === mainCurrentPage);
    const stepIndex = progressSteps.findIndex(s => s.id === stepId);
    
    if (stepIndex === -1) return 'upcoming';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    return 'upcoming';
  };

  const renderProgressIndicator = () => {
    if ((currentPage as Page) === 'success') return null;
    const isNewClientMultiStep =
      !isLoggedIn &&
      formData.haveUsedServicesBefore !== 'Yes' &&
      (currentPage === 'intro' || currentPage === 'new-client-pet-info');
    if (isNewClientMultiStep) return null;
    if (progressSteps.length <= 1) return null;
    
    return (
      <div style={{
        width: isMobile ? '100%' : '220px',
        padding: '24px',
        backgroundColor: '#f9fafb',
        borderRadius: '12px',
        borderRight: isMobile ? 'none' : '1px solid #e5e7eb',
        borderBottom: isMobile ? '1px solid #e5e7eb' : 'none',
        marginBottom: isMobile ? '0' : '0',
        flexShrink: 0,
      }}>
        <h3 style={{
          fontSize: '14px',
          fontWeight: 700,
          color: '#111827',
          marginBottom: '20px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Progress
        </h3>
        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
        }}>
          {progressSteps.map((step, index) => {
            const status = getStepStatus(step.id);
            const isCompleted = status === 'completed';
            const isCurrent = status === 'current';
            
            return (
              <li
                key={step.id}
                style={{
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                }}
              >
                <div style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: `2px solid ${isCurrent ? '#10b981' : isCompleted ? '#10b981' : '#d1d5db'}`,
                  backgroundColor: isCurrent ? '#10b981' : isCompleted ? '#10b981' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px',
                }}>
                  {isCompleted && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M10 3L4.5 8.5L2 6"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <div style={{
                  flex: 1,
                  fontSize: '14px',
                  color: isCurrent ? '#10b981' : isCompleted ? '#6b7280' : '#9ca3af',
                  fontWeight: isCurrent ? 600 : isCompleted ? 500 : 400,
                }}>
                  {step.label}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  // Removed blocking loadingClientData check - form now shows immediately while data loads in background

  return (
    <div style={{ minHeight: '100vh', width: '100%' }}>
      {/* Header - only show for logged-in users */}
      {isLoggedIn && (
        <header style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          background: '#f8fdfa',
          borderBottom: '1px solid rgba(17, 163, 106, 0.1)',
          backdropFilter: 'saturate(120%) blur(6px)',
        }}>
          <div 
            onClick={handleBackToPortal}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px',
              cursor: 'pointer',
            }}
          >
            <img
              src="/final_thick_lines_cropped.jpeg"
              alt="VAYD Scout Logo"
              style={{
                height: '60px',
                width: 'auto',
                opacity: 0.9,
                mixBlendMode: 'multiply',
              }}
            />
            <span style={{
              fontFamily: "'Libre Baskerville', 'Times New Roman', serif",
              fontWeight: 400,
              fontSize: '30px',
              color: '#2c1810',
              lineHeight: '60px',
              display: 'flex',
              alignItems: 'center',
            }}>
              Scout<sup style={{ fontSize: '9px', verticalAlign: 'super', marginLeft: '2px', lineHeight: 0, position: 'relative', top: '-8px' }}>TM</sup>
            </span>
          </div>
        </header>
      )}

      {/* Employer / appointment promo banner — shown for URL token OR entered code */}
      {activePromo && (
        <div
          style={{
            background: 'linear-gradient(90deg, #ecfdf5 0%, #d1fae5 100%)',
            borderBottom: '1px solid #6ee7b7',
            padding: isMobile ? '10px 16px' : '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '20px' }}>🎉</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: isMobile ? '14px' : '15px', color: '#065f46' }}>
              {activePromo.name?.trim() || activePromo.companyName}
            </div>
            <div style={{ fontSize: isMobile ? '12px' : '13px', color: '#047857', marginTop: '2px' }}>
              {formatPromotionBannerSubtitle(activePromo, {
                isExistingClient: isExistingClientForPromo,
              })}
            </div>
          </div>
          <div
            style={{
              background: '#059669',
              color: '#fff',
              borderRadius: '9999px',
              padding: '4px 14px',
              fontSize: isMobile ? '12px' : '13px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {formatPromotionDiscount(activePromo)}
          </div>
        </div>
      )}

      {/* Promo already redeemed with this email — discount removed */}
      {promoAlreadyUsed && appointmentPromo && (
        <div
          style={{
            background: '#fffbeb',
            borderBottom: '1px solid #fcd34d',
            padding: isMobile ? '10px 16px' : '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '20px' }}>⚠️</span>
          <div style={{ fontSize: isMobile ? '13px' : '14px', color: '#92400e' }}>
            This promotion has already been used with this email address, so the discount won't be
            applied. You can still submit your appointment request.
          </div>
        </div>
      )}

      <div style={{
        maxWidth: '1200px',
        margin: newClientCompactForm ? '8px auto' : isMobile && !isLoggedIn ? '12px auto' : '40px auto',
        padding: newClientCompactForm ? '0 12px' : isMobile && !isLoggedIn ? '0 12px' : '0 16px',
      }}>
        {/* Mobile Progress Indicator - Top */}
        {isMobile && (
          <div style={{ marginBottom: '24px' }}>
            {renderProgressIndicator()}
          </div>
        )}
      
      <div style={{
        display: isMobile ? 'block' : 'flex',
        gap: '24px',
        alignItems: 'flex-start',
        flexDirection: isMobile ? 'column' : 'row',
      }}>
        {/* Progress Indicator - Left Side (Desktop) */}
        {!isMobile && renderProgressIndicator()}
        
        {/* Form Content - Right Side */}
        <div
          className="appt-request-form"
          style={{
          flex: 1,
          background: '#fff',
          borderRadius: '12px',
          padding: newClientCompactForm ? '16px 20px' : isMobile && !isLoggedIn ? '16px' : isMobile ? '24px' : '40px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          minWidth: 0, // Prevent flex item from overflowing
          width: '100%',
        }}
        >
          <style>{`
            .appt-request-form input::placeholder,
            .appt-request-form textarea::placeholder {
              font-style: italic;
            }
            .appt-request-form [data-form-field] {
              scroll-margin-top: 88px;
            }
          `}</style>
          {renderPage()}
        
        {errors.submit && (
          <div style={{
            marginTop: '20px',
            padding: '12px',
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            borderRadius: '8px',
            fontSize: '14px',
          }}>
            {errors.submit}
          </div>
        )}

        {!(isLoggedInIntroLoading) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: newClientCompactForm ? '12px' : '32px', gap: '12px' }}>
          <style>{`
            @keyframes apptFormSubmitPopIn {
              0% { transform: scale(0.92); opacity: 0.6; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
              50% { transform: scale(1.06); opacity: 1; box-shadow: 0 0 0 8px rgba(16, 185, 129, 0.25); }
              100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
            }
            @keyframes apptFormSubmitPulse {
              0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
              50% { transform: scale(1.04); box-shadow: 0 0 20px 4px rgba(16, 185, 129, 0.5); }
            }
            .appt-form-submit-btn {
              animation: apptFormSubmitPopIn 0.5s ease-out forwards,
                         apptFormSubmitPulse 2.2s ease-in-out 0.6s infinite;
            }
            .appt-form-submit-btn:hover:not(:disabled) {
              animation: none;
              transform: scale(1.05);
              box-shadow: 0 0 20px 4px rgba(16, 185, 129, 0.45);
            }
            @keyframes apptFormSubmitArrowBounce {
              0%, 100% { transform: translateX(0); opacity: 1; }
              50% { transform: translateX(4px); opacity: 0.9; }
            }
            .appt-form-submit-arrow {
              animation: apptFormSubmitArrowBounce 1.2s ease-in-out infinite;
            }
          `}</style>
          {currentPage !== 'intro' && currentPage !== 'existing-client' && (
            <button
              type="button"
              onClick={handleBack}
              style={{
                padding: '12px 24px',
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Previous
            </button>
          )}
          <div style={{ flex: 1 }} />

          {/* Promo code entry — only on the final submit step */}
          {SHOW_PROMO_CODE_FIELD && isOnSubmitStep && !promoToken && !activePromo && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Promo code"
                  value={promoCodeInput}
                  onChange={(e) => {
                    setPromoCodeInput(e.target.value.toUpperCase());
                    setPromoCodeError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void applyPromoCode();
                    }
                  }}
                  disabled={promoCodeApplying}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    padding: '8px 10px',
                    border: `1px solid ${promoCodeError ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    width: '140px',
                    outline: 'none',
                    background: '#fff',
                  }}
                />
                <button
                  type="button"
                  disabled={promoCodeApplying || !promoCodeInput.trim()}
                  onClick={() => {
                    void applyPromoCode();
                  }}
                  style={{
                    padding: '8px 14px',
                    background: '#0f766e',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: promoCodeApplying || !promoCodeInput.trim() ? 'not-allowed' : 'pointer',
                    opacity: promoCodeApplying || !promoCodeInput.trim() ? 0.6 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {promoCodeApplying ? '…' : 'Apply'}
                </button>
              </div>
              {promoCodeError && (
                <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 500 }}>
                  ✗ {promoCodeError}
                </span>
              )}
            </div>
          )}

          {/* Applied code pill — shown on the submit step once a code is active */}
          {isOnSubmitStep && !promoToken && appliedCodePromo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: '#ecfdf5',
                border: '1px solid #6ee7b7',
                borderRadius: '8px',
                padding: '7px 14px',
              }}
            >
              <span style={{ fontSize: '15px' }}>✓</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#065f46' }}>
                  <span style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                    {appliedCodePromo.code ?? 'Promo'}
                  </span>
                  {' — '}
                  {formatPromotionDiscount(appliedCodePromo)}
                </div>
                <div style={{ fontSize: '11px', color: '#047857', marginTop: '1px' }}>
                  {appliedCodePromo.name?.trim() || appliedCodePromo.companyName}
                  {appliedCodePromo.description ? ` · ${appliedCodePromo.description}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAppliedCodePromo(null);
                  setPromoCodeInput('');
                  setPromoCodeError(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '11px',
                  color: '#6b7280',
                  textDecoration: 'underline',
                  padding: 0,
                  marginLeft: '4px',
                  flexShrink: 0,
                }}
              >
                Remove
              </button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {isOnSubmitStep && (
              <span className="appt-form-submit-arrow" style={{ color: '#10b981', fontSize: '28px', fontWeight: 700, lineHeight: 1 }} aria-hidden>→</span>
            )}
            <button
              type="button"
              className={isOnSubmitStep ? 'appt-form-submit-btn' : undefined}
              onClick={handleNext}
              disabled={submitting || zoneBlocksProgress}
              style={{
                padding: '12px 24px',
                backgroundColor: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor:
                  submitting || zoneBlocksProgress
                    ? 'not-allowed'
                    : 'pointer',
                opacity:
                  submitting || zoneBlocksProgress
                    ? 0.6
                    : 1,
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
            >
              {submitting
                ? 'Submitting...'
                : visitAddressForZoneCheck && zoneCheckStatus === 'pending'
                  ? 'Confirming area…'
                  : isNewClientPetStep
                    ? 'Submit Appointment Request'
                    : isOnSubmitStep
                      ? 'Submit'
                      : 'Next'}
            </button>
          </div>
        </div>
        )}
        </div>
      </div>

      {/* Appointment type change — confirm data loss */}
      {appointmentTypeChangeModal && (
        <div
          role="presentation"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
            padding: '16px',
          }}
          onClick={() => setAppointmentTypeChangeModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="appt-type-change-title"
            aria-describedby="appt-type-change-desc"
            style={{
              backgroundColor: '#fff',
              borderRadius: '16px',
              padding: '28px',
              maxWidth: '440px',
              width: '100%',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
              borderLeft: '4px solid #f59e0b',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#b45309',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                fontWeight: 700,
                marginBottom: '18px',
              }}
              aria-hidden
            >
              !
            </div>
            <h2
              id="appt-type-change-title"
              style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: '0 0 10px 0', lineHeight: 1.3 }}
            >
              Change appointment type?
            </h2>
            <p
              id="appt-type-change-desc"
              style={{ fontSize: '15px', color: '#4b5563', margin: '0 0 8px 0', lineHeight: 1.55 }}
            >
              If you continue, everything you entered for the current appointment type will be cleared. This cannot be undone.
            </p>
            <p style={{ fontSize: '15px', color: '#111827', margin: '0 0 24px 0', lineHeight: 1.5, fontWeight: 500 }}>
              New selection:{' '}
              <span style={{ color: '#059669' }}>{appointmentTypeChangeModal.option.prettyName}</span>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setAppointmentTypeChangeModal(null)}
                style={{
                  padding: '11px 20px',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #e5e7eb',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Keep current type
              </button>
              <button
                type="button"
                onClick={() => {
                  const { petId, option } = appointmentTypeChangeModal;
                  applyPetNeedsTodaySelection(petId, option);
                  setAppointmentTypeChangeModal(null);
                }}
                style={{
                  padding: '11px 20px',
                  backgroundColor: '#059669',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
                }}
              >
                Clear and switch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Existing Client Modal — login in-place so users stay on the appointment form */}
      {showExistingClientModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10050,
          }}
          onClick={closeExistingClientModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="existing-client-modal-title"
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              padding: '32px',
              maxWidth: existingClientModalView === 'login' ? '440px' : '500px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              position: 'relative',
              zIndex: 10051,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="existing-client-modal-title"
              style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '16px' }}
            >
              {existingClientModalView === 'login'
                ? 'Log in to continue'
                : emailCheckForModal?.hasAccount
                  ? 'Account Already Exists'
                  : 'Email Already on File'}
            </h2>
            {existingClientModalView === 'login' ? (
              <>
                <p style={{ fontSize: '15px', color: '#374151', marginBottom: '20px', lineHeight: 1.5 }}>
                  {emailCheckForModal?.hasAccount ? (
                    <>
                      Log in with <strong>{formData.email}</strong> to request an appointment as an existing client.
                      Your pets and contact info will load automatically.
                    </>
                  ) : (
                    <>
                      If you already created a portal account for <strong>{formData.email}</strong>, log in below.
                      Otherwise, create an account first — we&apos;ll send a secure link to the email we have on file.
                    </>
                  )}
                </p>
                <ClientLoginForm
                  initialEmail={formData.email.trim()}
                  emailReadOnly={!!formData.email.trim()}
                  onSuccess={handleExistingClientLoginSuccess}
                />
                {!emailCheckForModal?.hasAccount && isCreateClientEnabled() && (
                  <div
                    style={{
                      marginTop: '20px',
                      paddingTop: '20px',
                      borderTop: '1px solid #e5e7eb',
                    }}
                  >
                    <p style={{ fontSize: '14px', color: '#374151', marginBottom: '12px', lineHeight: 1.5 }}>
                      No portal account yet? Create one with the email we have on file.
                    </p>
                    <button
                      type="button"
                      onClick={navigateToCreateClient}
                      style={{
                        width: '100%',
                        padding: '12px 20px',
                        backgroundColor: '#fff',
                        color: '#059669',
                        border: '2px solid #10b981',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Create Account
                    </button>
                  </div>
                )}
                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  {!emailCheckForModal?.hasAccount && (
                    <button
                      type="button"
                      onClick={() => setExistingClientModalView('message')}
                      style={{
                        padding: 0,
                        background: 'none',
                        border: 'none',
                        color: '#059669',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeExistingClientModal}
                    style={{
                      marginLeft: 'auto',
                      padding: '10px 20px',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '16px', color: '#374151', marginBottom: '24px', lineHeight: '1.5' }}>
                  {emailCheckForModal?.hasAccount ? (
                    <>
                      We found an account associated with <strong>{formData.email}</strong>. Log in to request an
                      appointment without leaving this form.
                    </>
                  ) : (
                    <>
                      We found <strong>{formData.email}</strong> in our system. Log in if you already have a portal
                      account, or create one to continue.
                    </>
                  )}
                </p>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={closeExistingClientModal}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  {emailCheckForModal?.hasAccount && (
                    <button
                      type="button"
                      onClick={() => setExistingClientModalView('login')}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#10b981',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Log in
                    </button>
                  )}
                  {!emailCheckForModal?.hasAccount && (
                    <>
                      <button
                        type="button"
                        onClick={() => setExistingClientModalView('login')}
                        style={{
                          padding: '10px 20px',
                          backgroundColor: '#fff',
                          color: '#059669',
                          border: '2px solid #10b981',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Log in
                      </button>
                      {isCreateClientEnabled() && (
                        <button
                          type="button"
                          onClick={navigateToCreateClient}
                          style={{
                            padding: '10px 20px',
                            backgroundColor: '#10b981',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Create Account
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {renderMembershipModal()}
      </div>

      {/* Footer — hidden on step 1 so the form fits one screen */}
      {!newClientCompactForm && (
        <footer
          style={{
            marginTop: 'auto',
            padding: '24px 16px',
            borderTop: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '12px', color: '#6b7280' }}>
            © 2026. All rights reserved.
          </div>
        </footer>
      )}
    </div>
  );
}

