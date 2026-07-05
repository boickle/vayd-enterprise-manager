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
import { requestDataAppointmentTypeForRouting, requestDataSelfScheduledSlot } from './appointmentRequestDisplay';
import {
  normalizeAppointmentTypeName,
  pointsPerPatientForType,
  type AppointmentTypeCatalog,
} from './appointmentTypeSettings';

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

export function appointmentRequestSubmissionLinkedPoints(
  item: AppointmentRequestSubmissionItem,
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
  catalog?: AppointmentTypeCatalog | null,
): number | null {
  const apptId = item.bookedAppointmentId;
  if (apptId == null) return null;
  const summary = bookedApptMeta.get(Number(apptId));
  if (summary != null) {
    if (summary.appointmentCancelled) return null;
    return summary.points;
  }
  if (!catalog) return null;
  const { label, typeId } = requestDataAppointmentTypeForRouting(item.requestData ?? {});
  if (typeId == null && !label?.trim()) return null;
  return pointsPerPatientForType(catalog, { typeId, typeName: label });
}

/** On hold when the linked calendar appointment has 0 ops points (same rule as forward booking). */
export function appointmentRequestSubmissionIsOnHold(
  item: AppointmentRequestSubmissionItem,
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
  catalog?: AppointmentTypeCatalog | null,
): boolean {
  if (item.bookedAppointmentId == null) return false;
  const linkedPoints = item.linkedVisitPoints;
  if (linkedPoints != null && Number.isFinite(linkedPoints)) {
    return linkedPoints <= 0;
  }
  const points = appointmentRequestSubmissionLinkedPoints(item, bookedApptMeta, catalog);
  return points != null && points <= 0;
}

/** Booked tab / booked styling — not when the linked visit is on hold (0 points). */
export function appointmentRequestSubmissionCountsAsBooked(
  item: AppointmentRequestSubmissionItem,
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
  catalog?: AppointmentTypeCatalog | null,
): boolean {
  if ((item.status ?? 'new') !== 'booked') return false;
  return !appointmentRequestSubmissionIsOnHold(item, bookedApptMeta, catalog);
}

/** Calendar summary when hydrated, else the client’s self-scheduled slot from the request payload. */
export function resolveAppointmentRequestBookedVisitSummary(
  item: AppointmentRequestSubmissionItem,
  bookedSummary: AppointmentRequestBookedApptSummary | undefined,
  catalog?: AppointmentTypeCatalog | null,
): AppointmentRequestBookedApptSummary | null {
  if (bookedSummary?.start?.trim()) return bookedSummary;
  const slot = requestDataSelfScheduledSlot(item.requestData ?? {});
  if (!slot?.appointmentStart?.trim()) return bookedSummary ?? null;

  const points =
    item.linkedVisitPoints ??
    (() => {
      if (!catalog) return 0;
      const { label, typeId } = requestDataAppointmentTypeForRouting(item.requestData ?? {});
      return pointsPerPatientForType(catalog, { typeId, typeName: label });
    })();

  const { label } = requestDataAppointmentTypeForRouting(item.requestData ?? {});
  return {
    start: slot.appointmentStart.trim(),
    end: slot.windowEndIso,
    typeName: label?.trim() || null,
    providerName: slot.doctorName,
    providerInternalId: null,
    points: points ?? 0,
    description: null,
    instructions: null,
  };
}

export function appointmentRequestBookedVisitLabels(args: {
  requestData: Record<string, unknown>;
  bookedSummary?: AppointmentRequestBookedApptSummary | null;
  practiceTz: string;
  typeCatalog?: AppointmentTypeCatalog | null;
}): {
  bookedLabel: string | null;
  providerLabel: string | null;
} {
  const { requestData, bookedSummary, practiceTz, typeCatalog } = args;
  const slot = requestDataSelfScheduledSlot(requestData);
  const start = bookedSummary?.start?.trim() || slot?.appointmentStart?.trim() || null;
  const end = bookedSummary?.end?.trim() || slot?.windowEndIso?.trim() || null;
  const provider =
    bookedSummary?.providerName?.trim() || slot?.doctorName?.trim() || null;
  const typeName = resolveBookedVisitInternalTypeName(requestData, bookedSummary, typeCatalog);

  if (!start) {
    return { bookedLabel: null, providerLabel: provider };
  }

  const startDt = DateTime.fromISO(start, { zone: 'utc' }).setZone(practiceTz);
  if (!startDt.isValid) {
    return { bookedLabel: null, providerLabel: provider };
  }

  const isOnHold = (bookedSummary?.points ?? 0) <= 0;
  const leadPrefix = isOnHold ? 'On hold. ' : '';
  const datePart = startDt.toFormat('EEE, MMMM d yyyy');
  const typePart = typeName ? `${typeName} - ` : '';
  const arrivalWindow = formatBookedVisitArrivalWindow(slot, start, end, practiceTz);

  let bookedLabel: string;
  if (arrivalWindow) {
    bookedLabel = `${leadPrefix}${typePart}${datePart}. Arrival window: ${arrivalWindow}`;
  } else {
    const endDt = end ? DateTime.fromISO(end, { zone: 'utc' }).setZone(practiceTz) : null;
    if (endDt?.isValid) {
      bookedLabel = `${leadPrefix}${typePart}${datePart}. ${startDt.toFormat('h:mm a')} – ${endDt.toFormat('h:mm a')}`;
    } else {
      bookedLabel = `${leadPrefix}${typePart}${datePart}. ${startDt.toFormat('h:mm a')}`;
    }
  }

  return { bookedLabel, providerLabel: provider };
}

function resolveBookedVisitInternalTypeName(
  requestData: Record<string, unknown>,
  bookedSummary: AppointmentRequestBookedApptSummary | null | undefined,
  catalog?: AppointmentTypeCatalog | null,
): string | null {
  const summaryName = bookedSummary?.typeName?.trim();
  if (summaryName) {
    if (catalog) {
      const row = catalog.byName.get(normalizeAppointmentTypeName(summaryName));
      const name = row?.name?.trim();
      if (name) return name;
    }
    return summaryName;
  }

  const { typeId } = requestDataAppointmentTypeForRouting(requestData);
  if (typeId != null && catalog?.byId.has(typeId)) {
    const row = catalog.byId.get(typeId);
    const name = row?.name?.trim();
    if (name) return name;
  }

  return null;
}

function formatBookedVisitArrivalWindow(
  slot: ReturnType<typeof requestDataSelfScheduledSlot>,
  start: string,
  end: string | null | undefined,
  practiceTz: string,
): string | null {
  const windowDisplay = slot?.windowDisplay?.trim();
  if (windowDisplay) {
    const betweenMatch = windowDisplay.match(/between\s+(.+?)\s+and\s+(.+)$/i);
    if (betweenMatch) {
      return `${betweenMatch[1].trim()} and ${betweenMatch[2].trim()}`;
    }
    return windowDisplay;
  }

  const windowStart = slot?.windowStartIso?.trim() || start;
  const windowEnd = slot?.windowEndIso?.trim() || end?.trim() || null;
  const startDt = DateTime.fromISO(windowStart, { zone: 'utc' }).setZone(practiceTz);
  if (!startDt.isValid) return null;
  const endDt = windowEnd
    ? DateTime.fromISO(windowEnd, { zone: 'utc' }).setZone(practiceTz)
    : null;
  if (endDt?.isValid) {
    return `${startDt.toFormat('h:mm a')} and ${endDt.toFormat('h:mm a')}`;
  }
  return null;
}

export {
  formatForwardBookingOnHoldBookedAt,
  formatForwardBookingOnHoldElapsedSince,
};
