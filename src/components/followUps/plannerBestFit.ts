/**
 * Best fit for one Schedule follow-ups card, without the full Routing page.
 *
 * Runs the same slot search Get Best Route runs for a forward booking (POST /routing/v2
 * with the same body, the same appointment-type filter on single-doctor results, and
 * the same ASAP "all doctors in zone" doctor list), so the list matches what the full
 * form would show for the same client, doctor, type, minutes and dates.
 *
 * Booking still goes through the calendar: picking a slot writes the same calendar
 * preview Routing's "View placement" writes, and the embedded calendar's Book button
 * books it (and reports back to the planner) exactly as the full flow does.
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
import {
  writeRoutingCalendarPreview,
  type RoutingCalendarPreviewPayloadV1,
} from '../../utils/routingCalendarPreviewStorage';
import { adjustRoutingSlotSearchDates } from '../../utils/routingSlotSearchDates';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import {
  doctorPimsIdsAcceptingAppointmentType,
  fetchVeterinariansForDoctorSelect,
} from '../../utils/veterinarianZoneLookup';

/** Routing's default for multi-doctor (ASAP) searches. */
const MAX_ADDED_DRIVE_MINUTES = 20;

export type BestFitWindow = { startDate: string; endDate: string };

/** What the card asks for; the panel shows it and searches with it. */
export type BestFitRequest = {
  clientId: number;
  clientLabel: string | null;
  /** Card's provider (internal id) and, when the forward-booking row carried it, PIMS id. */
  providerId: number | null;
  doctorPimsId: string | null;
  providerName: string;
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
}): Record<string, unknown> {
  const { req, place, tz, asap } = args;
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
    preferredWeekday: null,
    preferredTimeOfDay: null,
    preferEdge: null,
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
}): Promise<BestFitSearchResult> {
  const { req, tz, asap } = args;
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
        error: 'Pick a doctor on the card, or turn on ASAP all doctors in zone.',
      };
    }
    const asapDoctorIds = asap ? await asapDoctorPimsIds(req, place) : undefined;
    if (asap && !asapDoctorIds?.length) {
      return { slots: [], place, doctorPimsId, error: 'No doctors see clients in this zone.' };
    }
    const body = buildBestFitRoutingBody({ req, place, tz, asap, doctorPimsId, asapDoctorIds });
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
 * Put the picked slot on the calendar preview, the same payload Routing's "View
 * placement" writes, so the calendar's Book books it the normal way.
 */
export async function writeBestFitCalendarPreview(args: {
  slot: BestFitSlot;
  req: BestFitRequest;
  place: BestFitPlace;
}): Promise<boolean> {
  const { slot, req, place } = args;
  const internalId = await internalDoctorIdForPims(slot.doctorPimsId);
  if (!internalId) return false;
  const opt = slot.option as Candidate;
  const payload: RoutingCalendarPreviewPayloadV1 = {
    version: 1,
    listOptionKey: slot.key,
    option: {
      ...opt,
      doctorPimsId: internalId,
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
  writeRoutingCalendarPreview(payload);
  return true;
}
