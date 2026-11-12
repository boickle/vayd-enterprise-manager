/**
 * Appointment request list → Routing prefill (same sessionStorage + event pattern as forward booking).
 */
import type { NavigateFunction } from 'react-router';
import { clearRoutingCalendarPreview } from './routingCalendarPreviewStorage';
import { ROUTING_DISMISS_FORWARD_BOOKING_EVENT } from './routingUiSnapshot';
import type { AppointmentRequestListTab } from '../appointments-nav';
import { returnToAppointmentRequestsList } from './appointmentRequestListReturnTab';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import {
  clientDisplayNameFromRequestData,
  formatRequestDataAddress,
  requestDataAnythingElse,
  requestDataAppointmentTypeForRouting,
  requestDataHowSoon,
  requestDataPreferredDoctor,
  requestDataPrimaryProviderSummary,
  requestDataServiceMinutes,
  requestDataUsesAlternateVisitAddress,
  requestDataClientId,
  requestDataPreferredPatientIds,
  resolveClientPatientFromRequestData,
  requestDataClientPimsId,
  requestDataWantsEarlierAppointment,
} from './appointmentRequestDisplay';
import { requestDataPetRowSummaries } from './appointmentRequestDetailDisplay';

export const ROUTING_APPOINTMENT_REQUEST_INTENT_STORAGE_KEY =
  'vayd:routing-appointment-request-intent-v1';
export const ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT =
  'vayd:routing-appointment-request-intent-updated';
export const ROUTING_DISMISS_APPOINTMENT_REQUEST_EVENT =
  'vayd:routing-dismiss-appointment-request';

export type RoutingAppointmentRequestIntentV1 = {
  v: 1;
  appliedToRoutingForm?: boolean;
  appointmentRequestSubmissionId: number;
  clientId?: string;
  patientId?: string;
  preferredPatientIds?: string[];
  clientDisplayLabel?: string;
  serviceMinutes: number;
  address?: string;
  /** Visit at alternate location — route without linking client (same as scheduler alternate stop). */
  isAlternateStop?: boolean;
  alternateAddressText?: string;
  preferredDoctorId?: string;
  preferredDoctorDisplayName?: string;
  /**
   * No preferred doctor on the form: the pet's primary doctor by name (requests store the
   * primary's name, not an id). Routing matches it against the provider list.
   */
  primaryDoctorName?: string;
  appointmentTypeName?: string;
  appointmentTypeId?: number;
  howSoon?: string;
  description?: string | null;
  clientPimsId?: string;
  pets?: Array<{
    name: string;
    appointmentType: string | null;
    appointmentTypeId?: number | null;
    /** Client reported calming meds — pet books as the flagged Pre-Meds type. */
    usesCalmingMedications?: boolean;
    patientId?: string | null;
    patientPimsId: string | null;
    clientDetails?: string | null;
  }>;
  /** Client asked to join the waitlist for a sooner time — Book pre-ticks the waitlist box. */
  joinWaitlistIfSooner?: boolean;
  /** When true, successful book navigates back to the appointment requests list. */
  returnToListAfterBook?: boolean;
  /** Tab to restore when leaving routing / scheduler back to the list. */
  returnListTab?: AppointmentRequestListTab;
  /** When set, exit / post-book navigates back to this Gmail thread instead of the Scout list. */
  returnToGmail?: {
    mailbox: string;
    threadId: string;
  };
  workspaceActive?: boolean;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function readRoutingAppointmentRequestIntent(): RoutingAppointmentRequestIntentV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ROUTING_APPOINTMENT_REQUEST_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as RoutingAppointmentRequestIntentV1;
    if (o?.v !== 1 || typeof o.appointmentRequestSubmissionId !== 'number') return null;
    return o;
  } catch {
    return null;
  }
}

export function appointmentRequestWorkspaceIsActive(): boolean {
  return readRoutingAppointmentRequestIntent()?.workspaceActive === true;
}

export function writeRoutingAppointmentRequestIntent(
  next: Omit<RoutingAppointmentRequestIntentV1, 'v' | 'appliedToRoutingForm'>
): void {
  if (typeof sessionStorage === 'undefined') return;
  const stored: RoutingAppointmentRequestIntentV1 = {
    v: 1,
    appliedToRoutingForm: false,
    ...next,
  };
  try {
    sessionStorage.setItem(ROUTING_APPOINTMENT_REQUEST_INTENT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT));
  }
}

export function markAppointmentRequestIntentAppliedToRoutingForm(): void {
  const cur = readRoutingAppointmentRequestIntent();
  if (!cur) return;
  try {
    sessionStorage.setItem(
      ROUTING_APPOINTMENT_REQUEST_INTENT_STORAGE_KEY,
      JSON.stringify({ ...cur, appliedToRoutingForm: true })
    );
  } catch {
    /* ignore */
  }
}

export function clearRoutingAppointmentRequestIntent(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_APPOINTMENT_REQUEST_INTENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT));
  }
}

export function dismissRoutingAppointmentRequestWorkspace(): void {
  clearRoutingAppointmentRequestIntent();
  clearRoutingCalendarPreview();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_DISMISS_APPOINTMENT_REQUEST_EVENT));
  }
}

export const GMAIL_INBOX_PATH = '/schedule/email';

export function buildGmailInboxReturnPath(mailbox: string, threadId: string): string {
  const params = new URLSearchParams();
  params.set('mailbox', mailbox.trim());
  params.set('thread', threadId.trim());
  return `${GMAIL_INBOX_PATH}?${params.toString()}`;
}

/** Leave appointment-request routing / scheduler workspace — Gmail thread or Scout list. */
export function returnFromAppointmentRequestWorkspace(
  navigate: NavigateFunction,
  intent: RoutingAppointmentRequestIntentV1 | null | undefined,
  opts?: { replace?: boolean },
): void {
  const gmail = intent?.returnToGmail;
  if (gmail?.mailbox?.trim() && gmail.threadId?.trim()) {
    navigate(buildGmailInboxReturnPath(gmail.mailbox, gmail.threadId), {
      replace: opts?.replace,
    });
    return;
  }
  returnToAppointmentRequestsList(navigate, intent?.returnListTab ?? 'new', {
    replace: opts?.replace,
  });
}

export function buildRoutingAppointmentRequestIntentFromSubmission(
  item: AppointmentRequestSubmissionItem
): Omit<RoutingAppointmentRequestIntentV1, 'v' | 'appliedToRoutingForm'> {
  const rd = item.requestData ?? {};
  const resolved = resolveClientPatientFromRequestData(rd);
  const clientId = requestDataClientId(rd);
  const preferredPatientIds = requestDataPreferredPatientIds(rd);
  const mins = requestDataServiceMinutes(rd) ?? 45;
  const doctorId = pickStr(rd.preferredDoctorId);
  // Route defaults to the client's preferred doctor, else the (first) pet's primary doctor.
  const primaryDoctorName =
    requestDataPrimaryProviderSummary(rd)?.split(',')[0]?.trim() || null;
  const alternateAddress = formatRequestDataAddress(rd);
  const usesAlternateVisitAddress = requestDataUsesAlternateVisitAddress(rd);
  const apptType = requestDataAppointmentTypeForRouting(rd);
  const petSummaries = requestDataPetRowSummaries(rd);
  const usesPerPetTypes = petSummaries.length > 0;

  return {
    appointmentRequestSubmissionId: item.id,
    ...(clientId ? { clientId } : {}),
    ...(!usesAlternateVisitAddress && clientId
      ? {
          ...(preferredPatientIds.length > 0
            ? {
                patientId: resolved?.patientId ?? preferredPatientIds[0],
                preferredPatientIds,
              }
            : resolved
              ? {
                  patientId: resolved.patientId,
                  preferredPatientIds: resolved.preferredPatientIds,
                }
              : {}),
        }
      : {}),
    clientDisplayLabel: clientDisplayNameFromRequestData(rd),
    serviceMinutes: mins,
    ...(usesAlternateVisitAddress && alternateAddress
      ? {
          isAlternateStop: true,
          alternateAddressText: alternateAddress,
          address: alternateAddress,
        }
      : alternateAddress
        ? { address: alternateAddress }
        : {}),
    preferredDoctorId: doctorId ?? undefined,
    preferredDoctorDisplayName: requestDataPreferredDoctor(rd) ?? undefined,
    ...(!doctorId && primaryDoctorName ? { primaryDoctorName } : {}),
    ...(!usesPerPetTypes
      ? {
          appointmentTypeName: apptType.label ?? undefined,
          ...(apptType.typeId != null ? { appointmentTypeId: apptType.typeId } : {}),
        }
      : {}),
    howSoon: requestDataHowSoon(rd) ?? undefined,
    description: requestDataAnythingElse(rd),
    clientPimsId: requestDataClientPimsId(rd) ?? undefined,
    ...(requestDataWantsEarlierAppointment(rd) ? { joinWaitlistIfSooner: true } : {}),
    pets: petSummaries.map((pet) => ({
      name: pet.name,
      appointmentType: pet.appointmentType,
      ...(pet.appointmentTypeId != null ? { appointmentTypeId: pet.appointmentTypeId } : {}),
      ...(pet.usesCalmingMedications ? { usesCalmingMedications: true } : {}),
      ...(pet.patientId ? { patientId: pet.patientId } : {}),
      patientPimsId: pet.patientPimsId,
      ...(pet.clientDetails ? { clientDetails: pet.clientDetails } : {}),
    })),
  };
}
