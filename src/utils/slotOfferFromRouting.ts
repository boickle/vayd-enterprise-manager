import { DateTime } from 'luxon';
import type { SendSlotOfferPayload } from '../api/slotOffers';
import type { RoutingCalendarPreviewPayloadV1 } from './routingCalendarPreviewStorage';
import type { ForwardBookingCreatedVia } from '../api/forwardBooking';
import { isScheduleLoaderCalendarPreview } from './routingCalendarPreviewStorage';

type RoutingPreviewOption = RoutingCalendarPreviewPayloadV1['option'] & {
  suggestedStartSec?: number;
  score?: number;
  arrivalWindow?: {
    windowStartSec?: number;
    windowEndSec?: number;
    windowStartIso?: string;
    windowEndIso?: string;
  };
  clientZone?: { id?: number | string; name?: string | null } | null;
  effectiveZone?: { id?: number | string; name?: string | null } | null;
  flags?: string[];
  isFixedTimeCandidate?: boolean;
};

export function slotOfferFlowActive(
  prefill: { routingPreviewBook?: boolean; rescheduleAppointmentId?: number; forwardBookingCreatedVia?: ForwardBookingCreatedVia } | null | undefined,
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined
): boolean {
  if (!prefill?.routingPreviewBook || prefill.rescheduleAppointmentId != null) return false;
  if (prefill.forwardBookingCreatedVia === 'care_outreach' || prefill.forwardBookingCreatedVia === 'schedule_loader') {
    return true;
  }
  return isScheduleLoaderCalendarPreview(preview);
}

function zoneIdFromOption(opt: RoutingPreviewOption): number | null {
  for (const z of [opt.effectiveZone, opt.clientZone]) {
    if (z?.id != null && Number.isFinite(Number(z.id)) && Number(z.id) > 0) {
      return Number(z.id);
    }
  }
  return null;
}

function scheduledTimeSecFromOption(opt: RoutingPreviewOption, practiceTz: string): number | null {
  if (typeof opt.suggestedStartSec === 'number' && Number.isFinite(opt.suggestedStartSec)) {
    return Math.round(opt.suggestedStartSec);
  }
  return practiceLocalSecondsSinceMidnightFromIso(String(opt.suggestedStartIso ?? ''), practiceTz);
}

function practiceLocalSecondsSinceMidnightFromIso(iso: string, practiceTz: string): number | null {
  const trimmed = iso.trim();
  if (!trimmed) return null;
  const dt = DateTime.fromISO(trimmed, { zone: 'utc' }).setZone(practiceTz);
  const resolved = dt.isValid ? dt : DateTime.fromISO(trimmed, { setZone: true });
  if (!resolved.isValid) return null;
  return resolved.hour * 3600 + resolved.minute * 60 + Math.round(resolved.second);
}

function isFixedTimeFromOption(opt: RoutingPreviewOption): boolean {
  if (opt.isFixedTimeCandidate === true) return true;
  const flags = opt.flags;
  if (Array.isArray(flags)) {
    return flags.some((f) => String(f).toLowerCase().includes('fixed'));
  }
  return false;
}

export function clFirstNameFromStaffEmail(userEmail?: string | null): string {
  const email = userEmail?.trim();
  if (!email) return 'Your care team';
  const local = email.split('@')[0] ?? '';
  const part = local.split(/[._-]/)[0] ?? local;
  if (!part) return 'Your care team';
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/** Resolve internal client id from book-modal / routing preview state (not only React selectedClientId). */
export function resolveSlotOfferClientId(opts: {
  selectedClientId?: string | null;
  prefillClientId?: string | null;
  preview?: Pick<RoutingCalendarPreviewPayloadV1, 'newApptMeta' | 'scheduleLoaderReturn'> | null;
  forwardBookingClientId?: string | null;
}): number | null {
  const candidates = [
    opts.selectedClientId,
    opts.prefillClientId,
    opts.preview?.newApptMeta?.clientId,
    opts.preview?.scheduleLoaderReturn?.clientId != null
      ? String(opts.preview.scheduleLoaderReturn.clientId)
      : null,
    opts.forwardBookingClientId,
  ];
  for (const raw of candidates) {
    const id = Number(String(raw ?? '').trim());
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

export function resolveSlotOfferPetIds(opts: {
  perVisitRoutingBook: boolean;
  routingBookVisitEdits: ReadonlyArray<{
    selected?: boolean;
    isNoPatient?: boolean;
    patientId?: string;
  }>;
  selectedPatientId?: string | null;
  preferredPatientIds?: readonly (string | number)[];
  previewPatients?: readonly { id: number | string }[];
  forwardBookingPatientId?: string | null;
}): number[] {
  const fromEdits = opts.routingBookVisitEdits
    .filter((v) => v.selected && !v.isNoPatient && v.patientId?.trim())
    .map((v) => Number(v.patientId))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (fromEdits.length > 0) return fromEdits;

  if (opts.selectedPatientId && Number.isFinite(Number(opts.selectedPatientId))) {
    const id = Number(opts.selectedPatientId);
    if (id > 0) return [id];
  }

  const fromPreferred = (opts.preferredPatientIds ?? [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (fromPreferred.length > 0) return fromPreferred;

  const fromPreview = (opts.previewPatients ?? [])
    .map((p) => Number(p.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (fromPreview.length > 0) return fromPreview;

  const fb = Number(String(opts.forwardBookingPatientId ?? '').trim());
  if (Number.isFinite(fb) && fb > 0) return [fb];

  return [];
}

export type SlotOfferBookVisitPayload = {
  patientId: number;
  appointmentTypeId: number;
  description?: string;
  instructions?: string;
};

export function resolveSlotOfferBookNotes(opts: {
  perVisitRoutingBook: boolean;
  routingBookVisitEdits: ReadonlyArray<{
    selected?: boolean;
    isNoPatient?: boolean;
    patientId?: string;
    appointmentTypeId?: string;
    description?: string;
    instructions?: string;
  }>;
  description: string;
  instructions: string;
}): {
  bookDescription?: string;
  bookInstructions?: string;
  bookVisits?: SlotOfferBookVisitPayload[];
  appointmentTypeId?: number;
} {
  if (opts.perVisitRoutingBook) {
    const selected = opts.routingBookVisitEdits.filter(
      (v) => v.selected && !v.isNoPatient && v.patientId?.trim()
    );
    if (selected.length === 0) return {};
    const bookVisits = selected
      .map((visit) => {
        const patientId = Number(visit.patientId);
        const appointmentTypeId = Number(visit.appointmentTypeId);
        if (
          !Number.isFinite(patientId) ||
          patientId <= 0 ||
          !Number.isFinite(appointmentTypeId) ||
          appointmentTypeId <= 0
        ) {
          return null;
        }
        return {
          patientId,
          appointmentTypeId,
          ...(visit.description?.trim()
            ? { description: visit.description.trim() }
            : {}),
          ...(visit.instructions?.trim()
            ? { instructions: visit.instructions.trim() }
            : {}),
        };
      })
      .filter(Boolean) as SlotOfferBookVisitPayload[];
    if (bookVisits.length === 0) return {};
    return {
      bookVisits,
      appointmentTypeId: bookVisits[0]!.appointmentTypeId,
    };
  }
  const bookDescription = opts.description.trim();
  const bookInstructions = opts.instructions.trim();
  return {
    ...(bookDescription ? { bookDescription } : {}),
    ...(bookInstructions ? { bookInstructions } : {}),
  };
}

export function routingPreviewServiceMinutes(
  preview: Pick<RoutingCalendarPreviewPayloadV1, 'serviceMinutes'>
): number {
  const mins = Number(preview.serviceMinutes);
  return Number.isFinite(mins) && mins > 0 ? Math.max(1, Math.round(mins)) : 30;
}

/** v2 candidate score from the routing picker (not prefScore). */
export function routingPreviewCandidateScore(opt: RoutingPreviewOption): number | undefined {
  const score = opt.score;
  return typeof score === 'number' && Number.isFinite(score) ? score : undefined;
}

export function buildSendSlotOfferPayload(opts: {
  practiceId: number;
  preview: RoutingCalendarPreviewPayloadV1;
  practiceTz: string;
  clientId: number;
  petIds: number[];
  doctorId: number;
  appointmentTypeId: number;
  clFirstName: string;
  zoneId?: number | null;
}): SendSlotOfferPayload | { error: string } {
  const opt = opts.preview.option as RoutingPreviewOption;
  const offeredSlotDatetime = String(opt.suggestedStartIso ?? '').trim();
  const slotDate = String(opt.date ?? '').trim();
  if (!offeredSlotDatetime || !slotDate) {
    return { error: 'This routing slot is missing a suggested start time.' };
  }

  const aw = opt.arrivalWindow;
  const arrivalWindowStart = aw?.windowStartIso?.trim();
  const arrivalWindowEnd = aw?.windowEndIso?.trim();
  if (!arrivalWindowStart || !arrivalWindowEnd) {
    return { error: 'This routing slot is missing an arrival window.' };
  }
  const windowStartSec =
    aw?.windowStartSec != null && Number.isFinite(Number(aw.windowStartSec))
      ? Math.round(Number(aw.windowStartSec))
      : practiceLocalSecondsSinceMidnightFromIso(arrivalWindowStart, opts.practiceTz);
  const windowEndSec =
    aw?.windowEndSec != null && Number.isFinite(Number(aw.windowEndSec))
      ? Math.round(Number(aw.windowEndSec))
      : practiceLocalSecondsSinceMidnightFromIso(arrivalWindowEnd, opts.practiceTz);
  if (windowStartSec == null || windowEndSec == null) {
    return { error: 'This routing slot is missing arrival window times.' };
  }

  const scheduledTimeSec = scheduledTimeSecFromOption(opt, opts.practiceTz);
  if (scheduledTimeSec == null) {
    return { error: 'Could not determine scheduled time for this slot.' };
  }

  const zoneId = opts.zoneId ?? zoneIdFromOption(opt);
  if (zoneId == null) {
    return { error: 'Could not determine zone for this slot.' };
  }

  if (!Number.isFinite(opts.clientId) || opts.clientId <= 0) {
    return { error: 'Select a client before sending a text offer.' };
  }
  const petIds = opts.petIds.filter((id) => Number.isFinite(id) && id > 0);
  if (petIds.length === 0) {
    return { error: 'Select at least one pet before sending a text offer.' };
  }
  if (!Number.isFinite(opts.doctorId) || opts.doctorId <= 0) {
    return { error: 'Select a provider before sending a text offer.' };
  }
  if (!Number.isFinite(opts.appointmentTypeId) || opts.appointmentTypeId <= 0) {
    return { error: 'Select an appointment type before sending a text offer.' };
  }

  const routingScore = routingPreviewCandidateScore(opt);

  return {
    practiceId: opts.practiceId,
    clientId: opts.clientId,
    petIds,
    doctorId: opts.doctorId,
    zoneId,
    appointmentTypeId: opts.appointmentTypeId,
    serviceMinutes: routingPreviewServiceMinutes(opts.preview),
    ...(routingScore != null ? { routingScore } : {}),
    offeredSlotDatetime,
    insertionIndex: Math.max(0, Math.round(Number(opt.insertionIndex) || 0)),
    slotDate,
    scheduledTimeSec,
    arrivalWindowStart,
    arrivalWindowEnd,
    windowStartSec,
    windowEndSec,
    isFixedTimeCandidate: isFixedTimeFromOption(opt),
    clFirstName: opts.clFirstName.trim() || 'Your care team',
  };
}
