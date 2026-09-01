import { DateTime } from 'luxon';
import type { NavigateFunction } from 'react-router';
import {
  appointmentAlternateAddressText,
  appointmentHasAlternateLocation,
  fetchAppointmentById,
  fetchAppointmentsRangeForLocalDay,
  fetchDoctorDay,
} from '../api/appointments';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import type { Appointment, Client } from '../api/roomLoader';
import { geocodeRoutingAddressText } from './verifiedAddress';
import { clearRoutingAppointmentRequestIntent } from './routingAppointmentRequestIntent';
import type { RoutingCalendarPreviewPayloadV1 } from './routingCalendarPreviewStorage';
import { writeRoutingCalendarPreview } from './routingCalendarPreviewStorage';
import { clearRoutingForwardBookingIntent } from './routingForwardBookingIntent';
import {
  buildRoutingRescheduleIntentFromAppointment,
  writeRoutingRescheduleIntent,
  type RoutingRescheduleIntentV1,
} from './routingRescheduleIntent';
import { fetchAndCacheRescheduleSourcePlacementSnapshot } from './routingRescheduleScoreCompare';
import { writeSchedulerCalendarHandoff } from './schedulerCalendarHandoff';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusOptimizeReturnSession,
  writeSchedulerFocusSession,
} from './schedulerFocusAppointment';
import type { OptimizeMove } from './scheduleOptimizeMoves';

export type ScheduleOptimizeApplyTarget = {
  id: string;
  appointmentIds: number[];
  newStartIso: string;
  newEndIso: string;
  toDate: string;
  fromDate: string;
  client: string;
  clientId: number | null;
  petNames: string[];
  insertionIndex?: number;
  fromTimeLabel?: string;
  toTimeLabel?: string;
  fromWindowLabel?: string | null;
  toWindowLabel?: string | null;
  clientPhone?: string | null;
  originalStartIso?: string;
  driveDeltaMin?: number;
};

function coerceListMove(
  move: ScheduleOptimizeApplyTarget,
  explicit?: OptimizeMove
): OptimizeMove | undefined {
  if (explicit) return explicit;
  if (!move.id.trim() || move.appointmentIds.length === 0) return undefined;
  return {
    id: move.id,
    scope: move.fromDate === move.toDate ? 'day' : 'week',
    client: move.client,
    clientId: move.clientId,
    clientPhone: move.clientPhone ?? null,
    petNames: move.petNames,
    appointmentType: null,
    appointmentDescription: null,
    roomLoaderStatus: 'Not sent',
    roomLoaderStatusColor: '#dc2626',
    fromDate: move.fromDate,
    toDate: move.toDate,
    fromTimeLabel: move.fromTimeLabel ?? '',
    toTimeLabel: move.toTimeLabel ?? '',
    fromWindowLabel: move.fromWindowLabel ?? null,
    toWindowLabel: move.toWindowLabel ?? null,
    appointmentIds: move.appointmentIds,
    originalStartIso: move.originalStartIso ?? '',
    newStartIso: move.newStartIso,
    newEndIso: move.newEndIso,
    insertionIndex: Math.max(0, Math.round(Number(move.insertionIndex) || 0)),
    windowWarningsBefore: 0,
    windowWarningsAfter: 0,
    driveDeltaMin: Number.isFinite(move.driveDeltaMin) ? Number(move.driveDeltaMin) : 0,
    ppdhBefore: null,
    ppdhAfter: null,
    reason: '',
  };
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function trimStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function formatStreetAddress(row: {
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  zip?: string | null;
}): string | null {
  const zip = trimStr(row.zipcode) ?? trimStr(row.zip);
  const parts = [
    trimStr(row.address1),
    [trimStr(row.city), trimStr(row.state)].filter(Boolean).join(', '),
    zip,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function coordsFromUnknown(row: unknown): { lat: number; lon: number } | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;
  const lat = num(rec.lat) ?? num(rec.latitude);
  const lon = num(rec.lon) ?? num(rec.lng) ?? num(rec.longitude);
  if (lat == null || lon == null) return null;
  if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return null;
  return { lat, lon };
}

/** Visit-level coords (including an already-geocoded ALT stop). Never client home. */
function appointmentVisitCoords(appt: Appointment): { lat: number; lon: number } | null {
  const rec = appt as Appointment & Record<string, unknown>;
  return (
    coordsFromUnknown(appt) ||
    coordsFromUnknown(rec.alternateAddress) ||
    coordsFromUnknown(rec.location) ||
    null
  );
}

function appointmentAddress(appt: Appointment, usesAlt: boolean): string | null {
  const alt = appointmentAlternateAddressText(appt)?.trim() || null;
  if (alt) return alt;
  const visitStreet = formatStreetAddress(appt as Appointment & { zip?: string | null });
  if (usesAlt) return visitStreet;
  return visitStreet || formatStreetAddress(appt.client ?? {}) || null;
}

function clientFromUnknown(raw: unknown): Client | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<Client> & { zip?: string | null };
  if (row.id == null) return null;
  return row as Client;
}

async function resolveStopMeta(
  appt: Appointment,
  opts?: { doctorId?: string; dateIso?: string }
): Promise<{
  address: string;
  lat: number;
  lon: number;
  usesAlt: boolean;
}> {
  let usesAlt = appointmentHasAlternateLocation(appt);
  let coords = appointmentVisitCoords(appt);
  let address = appointmentAddress(appt, usesAlt);

  // Doctor-day rows carry the routed stop (ALT included). GET /appointments/:id often has
  // alternate text only, with no lat/lon.
  if ((!coords || !address) && opts?.doctorId?.trim() && opts?.dateIso?.trim()) {
    try {
      const day = await fetchDoctorDay(opts.dateIso.trim(), opts.doctorId.trim());
      const row = (day.appointments ?? []).find((a) => Number(a.id) === Number(appt.id));
      if (row) {
        coords = coords ?? coordsFromUnknown(row);
        const dayAlt =
          appointmentAlternateAddressText(row as unknown as Appointment)?.trim() || null;
        if (dayAlt || row.isAlternateStop) usesAlt = true;
        address = address || dayAlt || formatStreetAddress(row) || null;
      }
    } catch {
      /* geocode / client fallback */
    }
  }

  if (!usesAlt && (!coords || !address) && appt.client?.id != null) {
    try {
      const client = clientFromUnknown(await fetchClientByIdStaff(appt.client.id));
      if (client) {
        coords = coords ?? coordsFromUnknown(client);
        address = address ?? formatStreetAddress(client);
      }
    } catch {
      /* appointment row may already have enough */
    }
  }

  if (address && !coords) {
    const geo = await geocodeRoutingAddressText(address);
    if (geo.ok) {
      return { address: geo.address, lat: geo.lat, lon: geo.lon, usesAlt };
    }
  }

  if (!address || !coords) {
    throw new Error(
      usesAlt
        ? 'This visit’s alternate address could not be mapped for calendar preview.'
        : 'This visit is missing a mapped address, so it cannot be previewed on the calendar.'
    );
  }
  return { address, lat: coords.lat, lon: coords.lon, usesAlt };
}

/**
 * Open the practice calendar with the visit locked as a proposed reschedule
 * (same preview + Apply path as Routing / forward booking).
 */
export async function beginScheduleOptimizeApplyInCalendar(args: {
  move: ScheduleOptimizeApplyTarget;
  doctorId: string;
  doctorName: string;
  practiceId: number;
  practiceTz: string;
  navigate: NavigateFunction;
  returnPath: string;
  queueItemId: string;
  fromCurrentView?: boolean;
  /** Full suggestion for Add to list / SMS; viewing preview does not add it to the queue. */
  listMove?: OptimizeMove;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const {
    move,
    doctorId,
    doctorName,
    practiceId,
    practiceTz,
    navigate,
    returnPath,
    queueItemId,
    fromCurrentView,
    listMove,
  } = args;
  const appointmentIds = [...new Set(move.appointmentIds.filter((id) => Number.isFinite(id) && id > 0))];
  const anchorId = appointmentIds[0];
  if (anchorId == null) {
    return { ok: false, reason: 'This suggestion is missing an appointment to move.' };
  }

  const appt = await fetchAppointmentById(anchorId, { practiceId });
  if (!appt) {
    return { ok: false, reason: 'Could not load this visit to preview on the calendar.' };
  }

  let sameCalendarDayAppointments: Appointment[] = [];
  const dateIso = move.fromDate.trim();
  const providerId = num(appt.primaryProvider?.id) ?? num(doctorId);
  if (dateIso && providerId != null) {
    try {
      sameCalendarDayAppointments = await fetchAppointmentsRangeForLocalDay({
        dateIso,
        practiceTimeZone: practiceTz,
        primaryProviderId: providerId,
        practiceId,
      });
    } catch {
      /* single-visit fallback */
    }
  }

  const built = buildRoutingRescheduleIntentFromAppointment(appt, {
    practiceTz,
    sameCalendarDayAppointments,
    allowAddressOnly: true,
  });
  if (!built) {
    return {
      ok: false,
      reason: 'This visit cannot be previewed here (needs a linked client or a visit address).',
    };
  }

  const idSet = new Set(appointmentIds);
  const sameDayVisits = (built.sameDayVisits ?? []).filter((v) => idSet.has(v.appointmentId));
  const household = appointmentIds.length > 1 || sameDayVisits.length > 1;
  const intent: RoutingRescheduleIntentV1 = {
    ...built,
    sameDayVisits,
    rescheduleScope: household ? 'household_day' : 'selected_pet',
    primaryProviderInternalId: doctorId.trim() || built.primaryProviderInternalId,
    sourceProviderInternalId: doctorId.trim() || built.sourceProviderInternalId,
    primaryDoctorDisplayName: doctorName.trim() || built.primaryDoctorDisplayName,
    sourceDoctorDisplayName: doctorName.trim() || built.sourceDoctorDisplayName,
    returnPath: returnPath.trim() || '/schedule/scheduler',
  };

  let stop: { address: string; lat: number; lon: number; usesAlt: boolean };
  try {
    stop = await resolveStopMeta(appt, {
      doctorId: doctorId.trim() || undefined,
      dateIso: move.fromDate.trim() || dateIso || undefined,
    });
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'Missing visit address.' };
  }

  const start = DateTime.fromISO(move.newStartIso);
  const end = DateTime.fromISO(move.newEndIso);
  const serviceMinutes =
    start.isValid && end.isValid
      ? Math.max(1, Math.round(end.diff(start, 'minutes').minutes))
      : Math.max(1, intent.serviceMinutes || 45);

  const typeId = intent.appointmentTypeId;
  if (typeId == null || !Number.isFinite(typeId) || typeId <= 0) {
    return { ok: false, reason: 'This visit is missing an appointment type.' };
  }

  const usesAlt = stop.usesAlt || Boolean(intent.isAlternateStop);
  if (usesAlt && stop.address.trim()) {
    intent.isAlternateStop = true;
    intent.alternateAddressText = stop.address;
    intent.address = stop.address;
  }
  const previewPatients =
    sameDayVisits.length > 0
      ? sameDayVisits
          .filter((v) => String(v.patientId ?? '').trim())
          .map((v) => ({
            id: v.patientId,
            name: v.patientName?.trim() || `Pet ${v.patientId}`,
          }))
      : move.petNames.map((name, i) => ({ id: `opt-${i}`, name }));

  const storedMove = coerceListMove(move, listMove);
  const payload: RoutingCalendarPreviewPayloadV1 = {
    version: 1,
    previewSource: 'schedule-optimize',
    scheduleOptimizeReturn: {
      queueItemId,
      returnHref: fromCurrentView
        ? '/schedule/scheduler'
        : returnPath.trim() || '/schedule/scheduler',
      ...(fromCurrentView ? { fromCurrentView: true } : {}),
      ...(storedMove ? { listMove: storedMove } : {}),
    },
    option: {
      date: move.toDate,
      suggestedStartIso: move.newStartIso,
      doctorPimsId: doctorId,
      doctorName: doctorName.trim() || 'Provider',
      insertionIndex: Math.max(0, Math.round(Number(move.insertionIndex) || 0)),
      positionInDay: Math.max(1, Math.round(Number(move.insertionIndex) || 0) + 1),
    },
    serviceMinutes,
    newApptMeta: {
      ...(move.clientId != null ? { clientId: String(move.clientId) } : built.clientId
        ? { clientId: built.clientId }
        : {}),
      address: stop.address,
      lat: stop.lat,
      lon: stop.lon,
    },
    ...(usesAlt ? { routingUsesAlternateAddress: true } : {}),
    appointmentTypeId: typeId,
    clientDisplayLabel: move.client.trim() || built.clientDisplayLabel,
    rescheduleAppointmentId: appointmentIds[0],
    rescheduleAppointmentIds: appointmentIds,
    ...(intent.patientId?.trim() ? { reschedulePatientId: intent.patientId } : {}),
    ...(previewPatients.length > 0 ? { previewPatients } : {}),
  };

  clearRoutingForwardBookingIntent();
  clearRoutingAppointmentRequestIntent();
  writeRoutingRescheduleIntent(intent);
  writeRoutingCalendarPreview(payload);
  writeSchedulerCalendarHandoff({
    anchorDate: move.toDate,
    view: 'week',
    providerFilter: doctorId,
    routingDoctorPimsId: intent.primaryDoctorPimsId,
    routingDoctorLabel: doctorName,
  });
  void fetchAndCacheRescheduleSourcePlacementSnapshot(intent);
  navigate('/schedule/scheduler?routingPreview=1');
  return { ok: true };
}

/** Jump to the visit’s current calendar slot as a preview (Back / Dismiss / View optimized). */
export function openScheduleOptimizeCurrentAppointment(args: {
  move: ScheduleOptimizeApplyTarget;
  doctorId: string;
  doctorName: string;
  practiceId: number;
  queueItemId: string;
  fromDate: string;
  navigate: NavigateFunction;
  returnHref: string;
  reopenModal?: boolean;
  listMove?: OptimizeMove;
}): boolean {
  const id = args.move.appointmentIds.find((n) => Number.isFinite(n) && n > 0);
  if (id == null) return false;
  const dateHint = args.fromDate.trim() || args.move.fromDate.trim() || null;
  const providerHint = args.doctorId.trim() || null;
  writeSchedulerFocusOptimizeReturnSession({
    returnHref: args.returnHref,
    reopenModal: Boolean(args.reopenModal),
    doctorId: args.doctorId,
    doctorName: args.doctorName,
    practiceId: args.practiceId,
    queueItemId: args.queueItemId,
    move: {
      id: args.move.id,
      appointmentIds: args.move.appointmentIds,
      newStartIso: args.move.newStartIso,
      newEndIso: args.move.newEndIso,
      toDate: args.move.toDate,
      fromDate: args.move.fromDate,
      client: args.move.client,
      clientId: args.move.clientId,
      petNames: args.move.petNames,
      insertionIndex: args.move.insertionIndex,
      ...(args.listMove
        ? {
            fromTimeLabel: args.listMove.fromTimeLabel,
            toTimeLabel: args.listMove.toTimeLabel,
            fromWindowLabel: args.listMove.fromWindowLabel,
            toWindowLabel: args.listMove.toWindowLabel,
            clientPhone: args.listMove.clientPhone,
            originalStartIso: args.listMove.originalStartIso,
            driveDeltaMin: args.listMove.driveDeltaMin,
          }
        : {}),
    },
  });
  writeSchedulerFocusSession({
    appointmentId: id,
    dateHint,
    providerHint,
  });
  args.navigate(
    buildSchedulerFocusAppointmentUrl(id, {
      date: dateHint ?? undefined,
      providerId: providerHint ?? undefined,
    })
  );
  return true;
}
