/**
 * Best fit for one Schedule follow-ups card, without the full Routing page.
 *
 * Runs the same slot search Get Best Route runs for a forward booking (POST /routing/v2
 * with the same body, the same appointment-type filter on single-doctor results, and
 * the same ASAP "all doctors in zone" doctor list), so the list matches what the full
 * form would show for the same client, doctor, type, minutes and dates.
 *
 * Book books the slot right here, with the same appointment bodies, routing feedback,
 * pre-first neighbor move and forward-booking links the calendar's Book modal sends for
 * a forward booking (utils/routingBookVisits).
 */
import { DateTime } from 'luxon';
import { http } from '../../api/http';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { fetchPrimaryProviders } from '../../api/employee';
import { validateAddress } from '../../api/geo';
import {
  normalizeRoutingV2SlotSearchResponse,
  type RoutingV2SlotSearchResult,
} from '../../api/routing';
import { ROUTING_UNAVAILABLE_STAFF_MESSAGE } from '../RoutingUnavailableNotice';
import {
  collectRoutingResultDoctorIds,
  filterRoutingResultByAppointmentType,
} from '../../utils/routingAppointmentTypeFilter';
import {
  resolveRoutingCandidateIndex,
  routingTopCandidatesFromResult,
} from '../../utils/routingCandidates';
import type { RoutingCalendarPreviewPayloadV1 } from '../../utils/routingCalendarPreviewStorage';
import { fetchAppointmentsRangeForLocalDay, patchAppointment } from '../../api/appointments';
import {
  completeAllForwardBookingVisitsFromBook,
  completeForwardBookingFromBook,
} from '../../utils/forwardBookingBookComplete';
import { resolvePreFirstNeighborBumpTarget } from '../../utils/preFirstNeighborBump';
import { submitRoutingAcceptedFeedbackFromPreview } from '../../utils/routingBookFeedback';
import {
  createRoutingBookVisits,
  forwardBookingBookPrefillFromIntent,
} from '../../utils/routingBookVisits';
import type { RoutingForwardBookingIntentV1 } from '../../utils/routingForwardBookingIntent';
import { forwardBookingEntriesForChipSelection } from '../../utils/routingPatientSelection';
import { adjustRoutingSlotSearchDates } from '../../utils/routingSlotSearchDates';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import {
  doctorPimsIdsAcceptingAppointmentType,
  fetchVeterinariansForDoctorSelect,
} from '../../utils/veterinarianZoneLookup';

/** Routing's default for multi-doctor (ASAP) searches. */
const MAX_ADDED_DRIVE_MINUTES = 20;

export type BestFitWindow = { startDate: string; endDate: string };

/**
 * "What works for the owner?": Get Best Route's schedule preferences. Days are ISO
 * weekdays (1 = Monday); time of day is Routing's Early ('first') / End of day ('end').
 */
export type BestFitPrefs = {
  weekdays: number[];
  timeOfDay: 'first' | 'end' | null;
  /** Routing's "Force earliest available". */
  earliest: boolean;
};

export const NO_BEST_FIT_PREFS: BestFitPrefs = { weekdays: [], timeOfDay: null, earliest: false };

/** What the card asks for; the panel shows it and searches with it. */
export type BestFitRequest = {
  clientId: number;
  clientLabel: string | null;
  /** Card's provider (internal id) and, when the forward-booking row carried it, PIMS id. */
  providerId: number | null;
  doctorPimsId: string | null;
  providerName: string;
  /** Short doctor label for the panel, e.g. "Dr. Patel". */
  providerLabel?: string;
  appointmentTypeId: number;
  /** Appointment type `name` (Routing's Calculate Time key). */
  statsTypeKey: string;
  typeLabel: string;
  serviceMinutes: number;
  needsPremeds: boolean;
  pets: { id: number; name: string }[];
  window: BestFitWindow;
};

export type BestFitSlot = {
  key: string;
  date: string;
  suggestedStartIso: string;
  windowStartIso: string | null;
  windowEndIso: string | null;
  doctorPimsId: string;
  doctorName: string;
  score: number | null;
  addedDriveSeconds: number | null;
  projectedDriveSeconds: number | null;
  emptyDay: boolean;
  isFallbackDoctor: boolean;
  /** Household visits the doctor already has that day, when routing says. */
  dayVisitCount: number | null;
  /** Routing zone the visit falls in, when routing says. */
  zoneName: string | null;
  /** The routing candidate as Routing's results list holds it (for the calendar preview). */
  option: Record<string, unknown>;
};

/** Where the visit is (resolved once per search, like Routing's client pick). */
export type BestFitPlace = { address: string; lat: number; lon: number };

export type BestFitSearchResult = {
  slots: BestFitSlot[];
  place: BestFitPlace;
  doctorPimsId: string | null;
  error: string | null;
};

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Client home address and coordinates, as Routing reads them on client pick. */
export async function resolveBestFitPlace(clientId: number): Promise<BestFitPlace> {
  const raw = (await fetchClientByIdStaff(clientId)) as Record<string, unknown> | null;
  const o = raw ?? {};
  const line = [str(o.address1 ?? o.address_1), str(o.city), str(o.state)]
    .filter(Boolean)
    .join(', ');
  const address = [line, str(o.zip ?? o.zipcode ?? o.zipCode)].filter(Boolean).join(' ').trim();
  const lat = num(o.lat ?? o.latitude);
  const lon = num(o.lon ?? o.longitude);
  if (lat != null && lon != null) return { address, lat, lon };
  if (!address) throw new Error('This client has no address on file. Use the full calendar.');
  const chk = await validateAddress(address, { minLevel: 'street' });
  if (!chk.ok) throw new Error(chk.message);
  return {
    address: chk.result.formattedAddress || address,
    lat: chk.result.lat,
    lon: chk.result.lon,
  };
}

type ProviderRow = { id: number | string; pimsId?: string | number | null; name?: string };
let providersPromise: Promise<ProviderRow[]> | null = null;
function providerRows(): Promise<ProviderRow[]> {
  providersPromise ??= fetchPrimaryProviders().catch(() => {
    providersPromise = null;
    return [];
  });
  return providersPromise;
}

/** Routing's doctor for a forward booking: the row's PIMS id, else the provider list. */
export async function resolveBestFitDoctorPimsId(req: BestFitRequest): Promise<string | null> {
  if (req.doctorPimsId?.trim()) return req.doctorPimsId.trim();
  if (req.providerId == null) return null;
  const row = (await providerRows()).find((p) => Number(p.id) === Number(req.providerId));
  return row ? str(row.pimsId) || str(row.id) || null : null;
}

/** Internal employee id for a PIMS doctor id (the calendar preview wants internal ids). */
export async function internalDoctorIdForPims(pimsId: string): Promise<string | null> {
  const row = (await providerRows()).find((p) => str(p.pimsId) === pimsId);
  if (row?.id != null) return String(row.id);
  try {
    const { data } = await http.get(`/employees/pims/${encodeURIComponent(pimsId)}`);
    const emp = Array.isArray(data) ? data[0] : data;
    const id = emp?.id ?? emp?.employee?.id;
    return id != null ? String(id) : null;
  } catch {
    return null;
  }
}

/** Zone doctors Routing pre-checks for an ASAP search. */
async function asapDoctorPimsIds(req: BestFitRequest, place: BestFitPlace): Promise<string[]> {
  const { providers } = await fetchVeterinariansForDoctorSelect({
    address: place.address,
    lat: place.lat,
    lon: place.lon,
    appointmentTypeId: req.appointmentTypeId,
  });
  return providers
    .filter(
      (v) =>
        v.seeingClientsInClientZone === true &&
        v.transitioningOutOfClientZone !== true &&
        v.acceptsSelectedAppointmentType !== false
    )
    .map((v) => (v.pimsId ? String(v.pimsId) : String(v.id)))
    .filter(Boolean);
}

/** POST /routing/v2 body, field for field what Get Best Route sends with its defaults. */
export function buildBestFitRoutingBody(args: {
  req: BestFitRequest;
  place: BestFitPlace;
  tz: string;
  asap: boolean;
  doctorPimsId: string | null;
  asapDoctorIds?: string[];
  practiceId?: number;
  prefs?: BestFitPrefs;
}): Record<string, unknown> {
  const { req, place, tz, asap } = args;
  const prefs = args.prefs ?? NO_BEST_FIT_PREFS;
  const days = [...new Set(prefs.weekdays)].sort((a, b) => a - b);
  const dates = adjustRoutingSlotSearchDates(req.window.startDate, req.window.endDate, tz);
  const newAppt: Record<string, unknown> = {
    serviceMinutes: req.serviceMinutes,
    lat: place.lat,
    lon: place.lon,
    address: place.address,
    clientId: String(req.clientId),
    appointmentTypeId: req.appointmentTypeId,
    ...(req.needsPremeds
      ? { needsPremeds: true, practiceId: args.practiceId ?? currentPracticeId() }
      : {}),
  };
  const base = {
    startDate: dates.startDate,
    endDate: dates.endDate,
    numDays: dates.numDays,
    newAppt,
    useTraffic: false,
    // ASAP turns on "use reserve" in Routing.
    ignoreEmergencyBlocks: asap,
    // Routing sends one day as a number (older servers), several as a list.
    preferredWeekday: days.length === 0 ? null : days.length === 1 ? days[0] : days,
    preferredTimeOfDay: prefs.timeOfDay,
    preferEdge: null,
    ...(prefs.earliest ? { preferEarliestFeasibleStart: true } : {}),
  };
  return asap
    ? {
        doctorIds: args.asapDoctorIds ?? [],
        ...base,
        maxAddedDriveMinutes: MAX_ADDED_DRIVE_MINUTES,
      }
    : { doctorId: args.doctorPimsId ?? '', ...base };
}

type Candidate = Record<string, unknown> & {
  doctorId?: string;
  doctorName?: string;
  date?: string;
  suggestedStartIso?: string;
  insertionIndex?: number;
  score?: number;
  routingRequestId?: string;
};

function slotStartMs(c: Candidate): number {
  const aw = c.arrivalWindow as { windowStartIso?: string } | undefined;
  const iso = c.suggestedStartIso ?? aw?.windowStartIso;
  const dt = iso ? DateTime.fromISO(iso) : null;
  return dt?.isValid ? dt.toMillis() : Number.POSITIVE_INFINITY;
}

/** Routing's results list (winner + alternates, or every doctor's top), sorted as it sorts. */
export function bestFitSlotsFromResult(
  result: RoutingV2SlotSearchResult,
  opts: { asap: boolean; requestedDoctorPimsId: string | null; requestedDoctorName: string }
): BestFitSlot[] {
  const r = result as RoutingV2SlotSearchResult & {
    routingRequestId?: string;
    selectedDoctorPimsId?: string;
    doctorPimsId?: string;
    selectedDoctorDisplayName?: string;
    selectedDoctor?: { name?: string };
  };
  const top = routingTopCandidatesFromResult(r as never) as Candidate[];
  const rows: Candidate[] = [];
  if (r.doctors?.length) {
    for (const d of r.doctors) {
      const docTop = (d.top ?? []) as Candidate[];
      for (const w of docTop)
        rows.push({
          ...w,
          doctorId: d.pimsId,
          doctorName: str(d.name) || str(w.doctorName),
          candidateIndex: resolveRoutingCandidateIndex(w, docTop),
        });
    }
  } else {
    const list = [r.winner, ...(r.alternates ?? [])].filter(Boolean) as Candidate[];
    for (const w of list.length ? list : top)
      rows.push({ ...w, candidateIndex: resolveRoutingCandidateIndex(w, top) });
  }
  const defaultPid =
    str(r.selectedDoctorPimsId) || str(r.doctorPimsId) || str(opts.requestedDoctorPimsId);
  const defaultName =
    str(r.selectedDoctor?.name) || str(r.selectedDoctorDisplayName) || opts.requestedDoctorName;

  const slots = rows
    .filter((c) => str(c.suggestedStartIso) && str(c.date))
    .map((c): BestFitSlot => {
      const pid = str(c.doctorId) || defaultPid;
      const name = str(c.doctorName) || (pid === defaultPid ? defaultName : `Doctor ${pid}`);
      const aw = c.arrivalWindow as { windowStartIso?: string; windowEndIso?: string } | undefined;
      const flags = c.flags as unknown;
      const emptyDay = Boolean(
        c.dayIsEmpty || c._emptyDay || (Array.isArray(flags) && flags.includes('EMPTY'))
      );
      const fallback =
        c.isFallbackDoctor === true ||
        (!opts.asap && !!opts.requestedDoctorPimsId && !!pid && pid !== opts.requestedDoctorPimsId);
      const option = {
        ...c,
        doctorPimsId: pid,
        doctorName: name,
        routingRequestId: c.routingRequestId ?? r.routingRequestId,
      };
      const zone = (c.effectiveZone ?? c.clientZone) as { name?: unknown } | undefined;
      return {
        key: `${pid}-${c.date}-${c.insertionIndex ?? ''}-${c.candidateIndex ?? ''}`,
        date: String(c.date).slice(0, 10),
        suggestedStartIso: String(c.suggestedStartIso),
        windowStartIso: aw?.windowStartIso ?? null,
        windowEndIso: aw?.windowEndIso ?? null,
        doctorPimsId: pid,
        doctorName: name,
        score: num(c.score),
        addedDriveSeconds: num(c.addedDriveSeconds),
        projectedDriveSeconds: num(c.projectedDriveSeconds),
        emptyDay,
        isFallbackDoctor: fallback,
        dayVisitCount: num(c.dayHouseholdCount ?? c.dayClientVisitCount),
        zoneName: str(zone?.name) || null,
        option,
      };
    });
  const byScore = (a: BestFitSlot, b: BestFitSlot) =>
    (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY);
  // Routing sorts ASAP results by date and time, everything else by score.
  slots.sort(
    opts.asap ? (a, b) => slotStartMs(a.option) - slotStartMs(b.option) || byScore(a, b) : byScore
  );
  return slots;
}

/** Run the search for a card. Never throws: problems come back as `error`. */
export async function searchPlannerBestFit(args: {
  req: BestFitRequest;
  tz: string;
  asap: boolean;
  prefs?: BestFitPrefs;
}): Promise<BestFitSearchResult> {
  const { req, tz, asap, prefs } = args;
  let place: BestFitPlace = { address: '', lat: NaN, lon: NaN };
  let doctorPimsId: string | null = null;
  try {
    place = await resolveBestFitPlace(req.clientId);
    doctorPimsId = await resolveBestFitDoctorPimsId(req);
    if (!asap && !doctorPimsId) {
      return {
        slots: [],
        place,
        doctorPimsId,
        error: 'Pick a doctor on the card, or choose Any doctor in zone.',
      };
    }
    const asapDoctorIds = asap ? await asapDoctorPimsIds(req, place) : undefined;
    if (asap && !asapDoctorIds?.length) {
      return { slots: [], place, doctorPimsId, error: 'No doctors see clients in this zone.' };
    }
    const body = buildBestFitRoutingBody({
      req,
      place,
      tz,
      asap,
      doctorPimsId,
      asapDoctorIds,
      prefs,
    });
    const { data } = await http.post<RoutingV2SlotSearchResult>('/routing/v2', body);
    if ((data as { routingUnavailable?: boolean } | null)?.routingUnavailable === true) {
      return { slots: [], place, doctorPimsId, error: ROUTING_UNAVAILABLE_STAFF_MESSAGE };
    }
    let normalized = normalizeRoutingV2SlotSearchResponse(data);
    if (!asap && doctorPimsId) {
      // Auto-widen still honors Settings → appointment types (as Routing does).
      const accepting = await doctorPimsIdsAcceptingAppointmentType(
        collectRoutingResultDoctorIds(normalized as never),
        req.appointmentTypeId
      );
      normalized = filterRoutingResultByAppointmentType(normalized as never, {
        requestedDoctorId: doctorPimsId,
        appointmentTypeId: req.appointmentTypeId,
        doctorsAcceptingType: accepting,
        asapAllDoctorSearch: false,
        multiDoctor: false,
      }) as RoutingV2SlotSearchResult;
    }
    return {
      slots: bestFitSlotsFromResult(normalized, {
        asap,
        requestedDoctorPimsId: doctorPimsId,
        requestedDoctorName: req.providerName,
      }),
      place,
      doctorPimsId,
      error: null,
    };
  } catch (e) {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
      (e instanceof Error ? e.message : '') ||
      'Could not search for times.';
    return { slots: [], place, doctorPimsId, error: msg };
  }
}

/**
 * The slot as Routing's "View placement" calendar preview holds it. Booking passes it to
 * the routing feedback call, as the calendar's Book does with its preview.
 */
export function bestFitPreviewPayload(args: {
  slot: BestFitSlot;
  req: BestFitRequest;
  place: BestFitPlace;
  /** Internal employee id of the slot's doctor. */
  internalDoctorId: string;
}): RoutingCalendarPreviewPayloadV1 {
  const { slot, req, place } = args;
  const opt = slot.option as Candidate;
  return {
    version: 1,
    listOptionKey: slot.key,
    option: {
      ...opt,
      doctorPimsId: args.internalDoctorId,
      doctorName: slot.doctorName,
      date: slot.date,
      suggestedStartIso: slot.suggestedStartIso,
      insertionIndex: Number(opt.insertionIndex ?? 0),
    },
    serviceMinutes: Math.max(1, req.serviceMinutes || 30),
    newApptMeta: {
      clientId: String(req.clientId),
      address: place.address,
      lat: place.lat,
      lon: place.lon,
    },
    appointmentTypeId: req.appointmentTypeId,
    appointmentTypeChosenInRouting: true,
    routingStatsTypeKey: req.statsTypeKey,
    ...(req.needsPremeds ? { needsPremeds: true } : {}),
    clientDisplayLabel: req.clientLabel ?? undefined,
    ...(req.pets.length ? { previewPatients: req.pets } : {}),
    routingRequestId: str(opt.routingRequestId) || undefined,
    candidateIndex: typeof opt.candidateIndex === 'number' ? opt.candidateIndex : undefined,
    candidateId: str(opt.candidateId) || undefined,
  };
}

// ---------------------------------------------------------------------------
// How the panel shows a slot
// ---------------------------------------------------------------------------

export type BestFitQuality = 'Best fit' | 'Great' | 'Good';

/**
 * A tag per slot from the routing score (lower is better): the best score is "Best fit",
 * scores within a quarter of it "Great", the rest "Good". Without scores, by rank.
 */
export function bestFitQualities(slots: readonly BestFitSlot[]): Map<string, BestFitQuality> {
  const out = new Map<string, BestFitQuality>();
  const scores = slots.map((s) => s.score).filter((v): v is number => v != null);
  const best = scores.length ? Math.min(...scores) : null;
  slots.forEach((s, i) => {
    if (best == null || s.score == null) {
      out.set(s.key, i === 0 ? 'Best fit' : i <= 2 ? 'Great' : 'Good');
      return;
    }
    if (s.score === best) out.set(s.key, 'Best fit');
    else if (s.score <= best + Math.max(Math.abs(best) * 0.25, 1)) out.set(s.key, 'Great');
    else out.set(s.key, 'Good');
  });
  // Only one slot is the best fit (ties go to the first listed).
  let seen = false;
  for (const s of slots) {
    if (out.get(s.key) !== 'Best fit') continue;
    if (seen) out.set(s.key, 'Great');
    seen = true;
  }
  return out;
}

/** "Dr. Patel" from "Priya Patel" (titles and single names kept as they are). */
export function doctorShortName(name: string): string {
  const n = name.trim();
  if (!n || /^dr\.?\s/i.test(n)) return n;
  const parts = n.split(/\s+/);
  return parts.length > 1 ? `Dr. ${parts[parts.length - 1]}` : n;
}

/** A short plain reason, e.g. "Dr. Patel already has 4 visits that day · 6 min extra drive". */
export function bestFitReason(slot: BestFitSlot): string {
  const dr = doctorShortName(slot.doctorName);
  const zone = slot.zoneName ? ` in ${slot.zoneName}` : '';
  const n = slot.dayVisitCount;
  const day = slot.emptyDay
    ? `Open day for ${dr}${zone}`
    : n != null && n >= 3
      ? `${dr} already has ${n} visits${zone} that day`
      : n != null && n > 0
        ? `Light day for ${dr}${zone}`
        : n === 0
          ? `Open day for ${dr}${zone}`
          : `On ${dr}'s route${zone} that day`;
  const drive =
    slot.addedDriveSeconds != null
      ? `${Math.max(0, Math.round(slot.addedDriveSeconds / 60))} min extra drive`
      : null;
  return [day, drive, slot.isFallbackDoctor ? 'not the requested doctor' : null]
    .filter(Boolean)
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

/** One pet's visit at the slot. */
export type BestFitBookVisit = {
  patientId: number;
  appointmentTypeId: number;
  /** "What does <pet> need?" (the appointment's Description). */
  description: string;
  needsPremeds: boolean;
};

export type BestFitBookResult = {
  appointmentIds: number[];
  startIso: string;
  endIso: string;
  providerId: number;
  /** Booked, but something after the create did not save (shown to staff). */
  warnings: string[];
};

/**
 * Book the slot with no calendar: what the calendar's Book modal does for a forward
 * booking from this slot's preview. One appointment per pet at the slot's start for the
 * card's minutes, booked via routing; then the routing feedback link, the pre-first
 * neighbor move, and each pet's forward-booking row marked booked with its appointment.
 */
export async function bookBestFitSlot(args: {
  practiceId: number;
  slot: BestFitSlot;
  req: BestFitRequest;
  place: BestFitPlace;
  tz: string;
  visits: BestFitBookVisit[];
  /** The card's forward-booking intent (startPlannerSlotSearch wrote it). */
  intent: RoutingForwardBookingIntentV1 | null;
}): Promise<BestFitBookResult> {
  const { slot, req, tz } = args;
  if (!args.visits.length) throw new Error('No pets to book.');
  const internalId = await internalDoctorIdForPims(slot.doctorPimsId);
  const providerId = Number(internalId);
  if (!internalId || !Number.isFinite(providerId)) {
    throw new Error(`Could not find ${slot.doctorName} in the provider list.`);
  }
  // Same times the calendar gives a routing slot: suggested start + the card's minutes.
  const start = DateTime.fromISO(slot.suggestedStartIso, { zone: 'utc' });
  if (!start.isValid) throw new Error('This time is not valid any more. Search again.');
  const minutes = Math.max(1, Math.floor(req.serviceMinutes) || 30);
  const startIso = start.toUTC().toISO()!;
  const endIso = start.plus({ minutes }).toUTC().toISO()!;
  const preview = bestFitPreviewPayload({ ...args, internalDoctorId: internalId });

  // Booking before the doctor's first visit moves that visit to follow this one.
  const insertionIndex = Number((slot.option as Candidate).insertionIndex);
  let bump: ReturnType<typeof resolvePreFirstNeighborBumpTarget> = null;
  if (insertionIndex === 0) {
    try {
      const day = await fetchAppointmentsRangeForLocalDay({
        dateIso: start.setZone(tz).toISODate()!,
        practiceTimeZone: tz,
        primaryProviderId: providerId,
        practiceId: args.practiceId,
      });
      bump = resolvePreFirstNeighborBumpTarget({
        insertionIndex: 0,
        suggestedStartIso: startIso,
        suggestedEndIso: endIso,
        practiceTz: tz,
        providerId: String(providerId),
        appointments: day,
      });
    } catch {
      bump = null;
    }
  }

  const created = await createRoutingBookVisits(
    {
      practiceId: args.practiceId,
      primaryProviderId: providerId,
      clientId: req.clientId,
      appointmentStart: startIso,
      appointmentEnd: endIso,
      bookedViaRouting: true,
    },
    args.visits.map((v) => ({
      patientId: String(v.patientId),
      appointmentTypeId: v.appointmentTypeId,
      description: v.description,
      instructions: '',
      needsPremeds: v.needsPremeds,
    }))
  );
  const firstId = created.firstAppointmentId;
  if (firstId == null) throw new Error('The appointment was not created. Try again.');
  const warnings: string[] = [];

  const fb = await submitRoutingAcceptedFeedbackFromPreview(firstId, preview);
  if (!fb.submitted && fb.error) {
    warnings.push('Routing could not be linked to this suggestion. ' + fb.error);
  }

  if (bump) {
    try {
      await patchAppointment(
        bump.appointmentId,
        {
          appointmentStart: bump.appointmentStart,
          appointmentEnd: bump.appointmentEnd,
          bookedViaRouting: true,
        },
        { practiceId: args.practiceId }
      );
    } catch (e) {
      warnings.push(
        e instanceof Error && e.message.trim()
          ? e.message
          : 'Could not update the next visit time to match the route.'
      );
    }
  }

  if (args.intent) {
    const link = forwardBookingBookPrefillFromIntent(
      args.intent,
      forwardBookingEntriesForChipSelection(
        args.intent,
        args.visits.map((v) => String(v.patientId))
      )
    );
    if (link.forwardBookingVisitCompletes?.length) {
      const multi = await completeAllForwardBookingVisitsFromBook(created.createdByPatientId, link);
      if (multi.warnings.length) {
        warnings.push(
          'Some forward bookings could not be marked complete. ' + multi.warnings.join(' ')
        );
      }
    } else {
      const one = await completeForwardBookingFromBook(firstId, link);
      if (!one.completed && one.error) {
        warnings.push('The forward booking could not be linked. ' + one.error);
      }
    }
  }

  return { appointmentIds: created.appointmentIds, startIso, endIso, providerId, warnings };
}
