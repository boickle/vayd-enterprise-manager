import { DateTime } from 'luxon';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import {
  formatForwardBookingOnHoldBookedAt,
  formatForwardBookingOnHoldElapsedSince,
  forwardBookingOnHoldOver24ChipColors,
  linkedAppointmentBookedAtIso,
} from './forwardBookingOnHold';
import { linkedAppointmentEvetIdsFromRecord } from './appointmentRequestLinkedEvet';
import { appointmentLinkedClientLabel } from './schedulerVisitDisplay';
import { isAppointmentCancelledOnPracticeCalendar } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';

export type AppointmentRequestBookedApptSummary = {
  start: string;
  end?: string | null;
  typeName: string | null;
  providerName: string | null;
  /** Primary provider internal id — for scheduler focus navigation. */
  providerInternalId: string | null;
  points: number;
  description: string | null;
  instructions: string | null;
  appointmentBookedAtIso?: string | null;
  /** From linked appointment once client/patient are attached in eVet. */
  clientPimsId?: string | null;
  patientPimsId?: string | null;
  patientInternalId?: string | null;
  patientName?: string | null;
  /** Client / household on the linked calendar appointment (after HOLD conversion). */
  linkedClientLabel?: string | null;
  /** True when the linked hold was cancelled on the practice calendar. */
  appointmentCancelled?: boolean;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function appointmentPrimaryProviderInternalId(appt: Record<string, unknown>): string | null {
  const pp = appt.primaryProvider;
  if (pp && typeof pp === 'object') {
    const id = (pp as { id?: unknown }).id;
    if (id != null && String(id).trim()) return String(id);
  }
  const flat = (appt as { primaryProviderId?: unknown }).primaryProviderId;
  if (flat != null && String(flat).trim()) return String(flat);
  return null;
}

export function appointmentPrimaryProviderDisplayName(appt: Record<string, unknown>): string | null {
  const pp = appt.primaryProvider;
  if (pp && typeof pp === 'object') {
    const o = pp as Record<string, unknown>;
    const parts = [pickStr(o.title), pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean);
    if (parts.length) return parts.join(' ');
    return pickStr(o.name);
  }
  return pickStr(appt.providerName) ?? pickStr(appt.doctorName);
}

export function appointmentRequestLinkedVisitIsOnHold(
  summary: AppointmentRequestBookedApptSummary | null | undefined
): boolean {
  return summary != null && !summary.appointmentCancelled && summary.points <= 0;
}

export function appointmentRequestOnHoldSinceIso(
  summary: AppointmentRequestBookedApptSummary | null | undefined
): string | null {
  return summary?.appointmentBookedAtIso?.trim() || null;
}

export function appointmentRequestOnHoldOver24Hours(
  summary: AppointmentRequestBookedApptSummary | null | undefined,
  now: DateTime = DateTime.now()
): boolean {
  const iso = appointmentRequestOnHoldSinceIso(summary);
  if (!iso) return false;
  const placed = DateTime.fromISO(iso, { zone: 'utc' });
  if (!placed.isValid) return false;
  return now.diff(placed, 'hours').hours >= 24;
}

export function appointmentRequestOnHoldOver24ChipColors(): { background: string; color: string } {
  return forwardBookingOnHoldOver24ChipColors();
}

export function formatAppointmentRequestOnHoldBookedAt(
  iso: string | null | undefined,
  practiceTz: string
): string | null {
  return formatForwardBookingOnHoldBookedAt(iso, practiceTz);
}

export function formatAppointmentRequestOnHoldElapsedSince(
  iso: string | null | undefined,
  now: DateTime = DateTime.now()
): string | null {
  return formatForwardBookingOnHoldElapsedSince(iso, now);
}

export function appointmentRequestBookedSummaryFromAppointment(
  appt: Record<string, unknown> & {
    appointmentStart?: string | null;
    appointmentEnd?: string | null;
    appointmentType?: unknown;
    description?: string | null;
    instructions?: string | null;
  },
  points: number
): AppointmentRequestBookedApptSummary {
  const at = appt.appointmentType;
  const typeName =
    (typeof at === 'object' && at
      ? String((at as { name?: unknown; prettyName?: unknown }).name ?? (at as { prettyName?: unknown }).prettyName ?? '').trim()
      : typeof at === 'string'
        ? String(at).trim()
        : '') || null;
  const linkedEvet = linkedAppointmentEvetIdsFromRecord(appt);
  return {
    start: String(appt.appointmentStart ?? ''),
    end: appt.appointmentEnd ?? null,
    typeName: typeName || null,
    providerName: appointmentPrimaryProviderDisplayName(appt),
    providerInternalId: appointmentPrimaryProviderInternalId(appt),
    points,
    description: appt.description?.trim() || null,
    instructions: appt.instructions?.trim() || null,
    appointmentBookedAtIso: linkedAppointmentBookedAtIso(appt),
    clientPimsId: linkedEvet.clientPimsId,
    patientPimsId: linkedEvet.patientPimsId,
    patientInternalId: linkedEvet.patientInternalId,
    patientName: linkedEvet.patientName,
    linkedClientLabel: appointmentLinkedClientLabel(appt as Appointment),
    appointmentCancelled: isAppointmentCancelledOnPracticeCalendar(
      appt as Appointment & Record<string, unknown>,
    ),
  };
}

export function appointmentRequestSubmissionIsOnHold(
  item: AppointmentRequestSubmissionItem,
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
  householdClumpByBookedApptId?: ReadonlyMap<number, number[]>,
): boolean {
  const apptId = item.bookedAppointmentId;
  if (apptId == null) return false;
  const anchorId = Number(apptId);
  const clumpIds = householdClumpByBookedApptId?.get(anchorId) ?? [anchorId];
  for (const id of clumpIds) {
    const summary = bookedApptMeta.get(id);
    if (appointmentRequestLinkedVisitIsOnHold(summary)) return true;
  }
  return false;
}

export {
  formatForwardBookingOnHoldBookedAt,
  formatForwardBookingOnHoldElapsedSince,
};
