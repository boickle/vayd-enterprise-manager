/**
 * Appointment request list → Routing prefill (same sessionStorage + event pattern as forward booking).
 */
import { clearRoutingCalendarPreview } from './routingCalendarPreviewStorage';
import { ROUTING_DISMISS_FORWARD_BOOKING_EVENT } from './routingUiSnapshot';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import {
  clientDisplayNameFromRequestData,
  formatRequestDataAddress,
  requestDataAnythingElse,
  requestDataHowSoon,
  requestDataPreferredDoctor,
  requestDataServiceMinutes,
  resolveClientPatientFromRequestData,
} from './appointmentRequestDisplay';

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
  preferredDoctorId?: string;
  preferredDoctorDisplayName?: string;
  appointmentTypeName?: string;
  howSoon?: string;
  description?: string | null;
  /** When true, successful book navigates back to the appointment requests list. */
  returnToListAfterBook?: boolean;
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

export function buildRoutingAppointmentRequestIntentFromSubmission(
  item: AppointmentRequestSubmissionItem
): Omit<RoutingAppointmentRequestIntentV1, 'v' | 'appliedToRoutingForm'> {
  const rd = item.requestData ?? {};
  const resolved = resolveClientPatientFromRequestData(rd);
  const mins = requestDataServiceMinutes(rd) ?? 45;
  const doctorId = pickStr(rd.preferredDoctorId);

  return {
    appointmentRequestSubmissionId: item.id,
    ...(resolved
      ? {
          clientId: resolved.clientId,
          patientId: resolved.patientId,
          preferredPatientIds: resolved.preferredPatientIds,
        }
      : {}),
    clientDisplayLabel: clientDisplayNameFromRequestData(rd),
    serviceMinutes: mins,
    address: formatRequestDataAddress(rd) ?? undefined,
    preferredDoctorId: doctorId ?? undefined,
    preferredDoctorDisplayName: requestDataPreferredDoctor(rd) ?? undefined,
    appointmentTypeName:
      typeof rd.appointmentType === 'string' ? rd.appointmentType.trim() || undefined : undefined,
    howSoon: requestDataHowSoon(rd) ?? undefined,
    description: requestDataAnythingElse(rd),
  };
}
