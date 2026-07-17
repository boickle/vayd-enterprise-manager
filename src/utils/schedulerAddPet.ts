import { DateTime } from 'luxon';
import {
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
} from '../api/appointments';
import type { Appointment, Patient } from '../api/roomLoader';
import { extractPatientsFromClientPayload } from '../pages/SchedulerBookModal';
import { pickStr } from './schedulerVisitDisplay';
import { SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID } from './routingCalendarPreviewStorage';

type ClientPetRow = { id: number | string; name: string; isActive?: boolean; isDeleted?: boolean };

function patientIdsMatch(a: Patient, b: Patient): boolean {
  if (String(a.id) === String(b.id) && Number(a.id) > 0) return true;
  const ap = a.pimsId != null ? String(a.pimsId).trim() : '';
  const bp = b.pimsId != null ? String(b.pimsId).trim() : '';
  if (ap !== '' && bp !== '' && ap === bp) return true;
  const an = pickStr(a.name)?.toLowerCase();
  const bn = pickStr(b.name)?.toLowerCase();
  return !!(an && bn && an === bn);
}

function normalizePatientRow(p: Patient): Patient {
  const row = p as Patient & Record<string, unknown>;
  const pimsId =
    pickStr(row.pimsId) ??
    pickStr(row.patientPimsId) ??
    pickStr(row.pims_id) ??
    undefined;
  if (pimsId && pickStr(row.pimsId) !== pimsId) {
    return { ...p, pimsId };
  }
  return p;
}

function enrichPatientFromFallback(primary: Patient, fallback: Patient): Patient {
  const out = { ...primary } as Patient & Record<string, unknown>;
  const fo = fallback as Record<string, unknown>;
  const mergeKeys = [
    'sex',
    'gender',
    'sexDescription',
    'sexAndNeuter',
    'sexAndNeuterStatus',
    'neuterStatus',
    'spayNeuterStatus',
    'alteredStatus',
    'altered',
    'sexStatus',
    'dob',
    'breed',
    'breedEntity',
    'species',
    'speciesEntity',
    'alerts',
    'weight',
    'lastWeight',
    'lastWeightDate',
    'weightLbs',
    'lastWeightLbs',
  ];
  for (const k of mergeKeys) {
    const cur = out[k];
    const fb = fo[k];
    if ((cur == null || cur === '') && fb != null && fb !== '') {
      out[k] = fb;
    }
  }
  return out;
}

function patientFromAppointmentFlatFields(a: Appointment): Patient | null {
  const row = a as Appointment & Record<string, unknown>;
  const name = pickStr(row.patientName);
  if (!name) return null;
  const pimsId = pickStr(row.patientPimsId);
  const idRaw = row.patientId ?? pimsId ?? 0;
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
  return {
    id: Number.isFinite(id) && id > 0 ? id : 0,
    name,
    pimsId: pimsId ?? undefined,
    alerts: pickStr(row.alerts) ?? undefined,
    sex:
      pickStr(row.patientSex) ??
      pickStr(row.sex) ??
      pickStr(row.gender) ??
      pickStr(row.sexDescription) ??
      pickStr(row.sexAndNeuter) ??
      undefined,
    dob: pickStr(row.patientDob) ?? pickStr(row.dob) ?? undefined,
    breed: pickStr(row.patientBreed) ?? pickStr(row.breed) ?? undefined,
    species: pickStr(row.patientSpecies) ?? pickStr(row.species) ?? undefined,
    isActive: true,
    isDeleted: false,
    pimsType: 'EVET',
  } as Patient;
}

/** Support `patients[]` from API when present; otherwise single `patient`. */
export function patientsForAppointment(a: Appointment): Patient[] {
  const sing = a.patient ? normalizePatientRow(a.patient) : null;
  const multi = (a as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) {
    return multi.map((raw) => {
      const p = normalizePatientRow(raw);
      if (sing && patientIdsMatch(p, sing)) return enrichPatientFromFallback(p, sing);
      return p;
    });
  }
  if (sing) return [sing];
  const flat = patientFromAppointmentFlatFields(a);
  return flat ? [normalizePatientRow(flat)] : [];
}

/** Client visit with no linked patient (e.g. booked from routing without pets on file). */
export function appointmentHasNoPatient(a: Appointment): boolean {
  if (a.id === SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID) return false;
  if (patientsForAppointment(a).length > 0) return false;
  if (isPracticeCalendarBlockAppointment(a)) return false;
  const typeLabel = [a.appointmentType?.prettyName, a.appointmentType?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (typeLabel.includes('note to staff')) return false;
  const clientId =
    a.client?.id ?? (a as { clientId?: number | string | null }).clientId;
  return clientId != null && String(clientId).trim() !== '';
}

function isAppointmentVisible(a: Appointment): boolean {
  if (a.isDeleted) return false;
  if (a.isActive === false) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return true;
}

function isActiveClientPet(row: ClientPetRow): boolean {
  if (row.isDeleted === true) return false;
  if (row.isActive === false) return false;
  return true;
}

function appointmentInterval(a: Appointment): { start: number; end: number } | null {
  const s = DateTime.fromISO(a.appointmentStart, { zone: 'utc' });
  const e = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' });
  if (!s.isValid || !e.isValid) return null;
  return { start: s.toMillis(), end: e.toMillis() };
}

/** Overlap or back-to-back (touching) on the timeline — same “clump” as routing/household blocks. */
export function appointmentIntervalsClumped(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function samePracticeDay(isoA: string, isoB: string, practiceTz: string): boolean {
  const a = DateTime.fromISO(isoA, { zone: 'utc' }).setZone(practiceTz);
  const b = DateTime.fromISO(isoB, { zone: 'utc' }).setZone(practiceTz);
  if (!a.isValid || !b.isValid) return false;
  return a.toISODate() === b.toISODate();
}

/**
 * All appointments in the anchor’s clump: same client, same day, connected by overlap or touching
 * (e.g. Sadie 10:15–10:40 and Tucker 10:40–11:10).
 */
export function appointmentsInClientVisitClump(
  anchor: Appointment,
  allAppointments: Appointment[],
  practiceTz: string
): Appointment[] {
  const clientId = anchor.client?.id;
  if (clientId == null) return [anchor];

  const cid = String(clientId);
  const candidates = allAppointments.filter((a) => {
    if (!isAppointmentVisible(a)) return false;
    if (a.allDay) return false;
    if (a.client?.id == null || String(a.client.id) !== cid) return false;
    return samePracticeDay(a.appointmentStart, anchor.appointmentStart, practiceTz);
  });

  const anchorInList = candidates.some((a) => a.id === anchor.id);
  const list = anchorInList ? candidates : [...candidates, anchor];

  const intervals = new Map<number, { start: number; end: number }>();
  for (const a of list) {
    const iv = appointmentInterval(a);
    if (iv) intervals.set(a.id, iv);
  }

  const anchorIv = intervals.get(anchor.id);
  if (!anchorIv) return [anchor];

  const cluster = new Set<number>([anchor.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of list) {
      if (cluster.has(a.id)) continue;
      const iv = intervals.get(a.id);
      if (!iv) continue;
      for (const cid2 of cluster) {
        const cIv = intervals.get(cid2);
        if (!cIv) continue;
        if (appointmentIntervalsClumped(iv.start, iv.end, cIv.start, cIv.end)) {
          cluster.add(a.id);
          grew = true;
          break;
        }
      }
    }
  }

  return list.filter((a) => cluster.has(a.id));
}

function appointmentDescriptionHaystack(a: Appointment): string {
  return [a.description, a.instructions].filter(Boolean).join(' ');
}

function descriptionIncludesClientLabel(a: Appointment, clientLabel: string): boolean {
  const label = clientLabel.trim().toLowerCase();
  if (!label) return true;
  return appointmentDescriptionHaystack(a).toLowerCase().includes(label);
}

/**
 * Multi-pet online holds often share one start/end with no linked client yet — same slot, same
 * client name in the calendar description (e.g. two "Hold for Client" rows side by side).
 */
export function appointmentsInSameCalendarSlot(
  anchor: Appointment,
  allAppointments: Appointment[],
  practiceTz: string,
  opts?: { descriptionMustInclude?: string | null },
): Appointment[] {
  const anchorStart = anchor.appointmentStart;
  const anchorEnd = anchor.appointmentEnd;
  if (!anchorStart?.trim() || !anchorEnd?.trim()) return [anchor];

  const clientFilter = opts?.descriptionMustInclude?.trim() ?? null;
  const matches = allAppointments.filter((a) => {
    if (!isAppointmentVisible(a)) return false;
    if (a.allDay) return false;
    if (!samePracticeDay(a.appointmentStart, anchorStart, practiceTz)) return false;
    if (a.appointmentStart !== anchorStart || a.appointmentEnd !== anchorEnd) return false;
    if (clientFilter && !descriptionIncludesClientLabel(a, clientFilter)) return false;
    return true;
  });

  const anchorInList = matches.some((a) => a.id === anchor.id);
  const list = anchorInList ? matches : [...matches, anchor];
  return list.length > 0 ? list : [anchor];
}

/** Client-linked clump first; fall back to same-slot holds for new-client online booking. */
export function resolveHouseholdVisitAppointments(
  anchor: Appointment,
  allAppointments: Appointment[],
  practiceTz: string,
  opts?: { clientLabel?: string | null },
): Appointment[] {
  const byClient = appointmentsInClientVisitClump(anchor, allAppointments, practiceTz);
  if (byClient.length > 1) return byClient;

  const bySlot = appointmentsInSameCalendarSlot(anchor, allAppointments, practiceTz, {
    descriptionMustInclude: opts?.clientLabel,
  });
  if (bySlot.length > 1) return bySlot;

  return byClient.length > 0 ? byClient : [anchor];
}

/** Label for multi-pet edit picker — patient chart name, else pet name from hold description. */
export function petEditChoiceLabelForAppointment(appt: Appointment): string {
  const fromPatients = patientsForAppointment(appt)
    .map((p) => pickStr(p.name))
    .filter(Boolean)
    .join(', ');
  if (fromPatients) return fromPatients;

  const hay = appointmentDescriptionHaystack(appt);

  // "Online Booking - Client Name. PetName:" or ". PetName."
  const onlineBookingPet = hay.match(
    /Online Booking\s*-\s*[^.]+\.\s*([A-Za-z0-9][A-Za-z0-9' -]{0,30}?)(?:\s*:|\.(?:\s|$))/i,
  );
  if (onlineBookingPet?.[1]?.trim()) {
    const name = onlineBookingPet[1].trim();
    if (!looksLikeHoldDescriptionPhrase(name)) return name;
  }

  return 'Pet';
}

function looksLikeHoldDescriptionPhrase(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return true;
  const blocked = [
    'what is going on',
    'aftercare',
    'been to the vet',
    'wellness',
    'euthanasia',
    'quality of life',
    'online booking',
  ];
  return blocked.some((phrase) => lower.includes(phrase));
}

/** Calendar appointment ids for the anchor’s household visit clump (multi-pet same slot). */
export function householdAppointmentIdsInVisitClump(
  anchor: Appointment | null | undefined,
  allAppointments: Appointment[],
  practiceTz: string,
): number[] {
  if (!anchor || anchor.id == null) return [];
  const clump = appointmentsInClientVisitClump(anchor, allAppointments, practiceTz);
  const ids = clump
    .map((a) => Number(a.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length > 0) return ids;
  const anchorId = Number(anchor.id);
  return Number.isFinite(anchorId) && anchorId > 0 ? [anchorId] : [];
}

export function patientIdsInVisitClump(
  anchor: Appointment,
  allAppointments: Appointment[],
  practiceTz: string
): string[] {
  const out = new Set<string>();
  for (const a of appointmentsInClientVisitClump(anchor, allAppointments, practiceTz)) {
    for (const p of patientsForAppointment(a)) {
      if (p.id != null) out.add(String(p.id));
    }
  }
  return [...out];
}

export function excludePatientIdsForAddPet(
  anchorAppt: Appointment,
  allAppointments: Appointment[],
  practiceTz: string
): string[] {
  const out = new Set(patientIdsInVisitClump(anchorAppt, allAppointments, practiceTz));
  const clientId = anchorAppt.client?.id;
  if (clientId == null) return [...out];
  const cid = String(clientId);
  // Also block pets already booked elsewhere the same day (e.g. a prior add-pet that
  // landed at home without ALT) so "Add another pet" cannot create a duplicate.
  for (const a of allAppointments) {
    if (!isAppointmentVisible(a)) continue;
    if (a.allDay) continue;
    if (a.client?.id == null || String(a.client.id) !== cid) continue;
    if (!samePracticeDay(a.appointmentStart, anchorAppt.appointmentStart, practiceTz)) continue;
    for (const p of patientsForAppointment(a)) {
      if (p.id != null) out.add(String(p.id));
    }
  }
  return [...out];
}

/** Routing-selected pets must remain bookable even when they overlap an existing visit at the slot. */
export function filterSlotExcludeForRoutingBook(
  excludeIds: readonly string[] | undefined,
  keepPatientIds: readonly string[]
): string[] | undefined {
  if (!excludeIds?.length) return excludeIds ? [...excludeIds] : undefined;
  if (!keepPatientIds.length) return [...excludeIds];
  const keep = new Set(keepPatientIds.map(String));
  const filtered = excludeIds.filter((id) => !keep.has(String(id)));
  return filtered.length > 0 ? filtered : undefined;
}

/** Pets already in a timed visit overlapping this slot (same client) — omit from routing book picker. */
export function excludePatientIdsAtSlot(
  clientId: string,
  slotStartMs: number,
  slotEndMs: number,
  allAppointments: Appointment[],
  options?: { excludeAppointmentId?: number }
): string[] {
  const cid = String(clientId);
  const excludeApptId = options?.excludeAppointmentId;
  const out = new Set<string>();
  for (const a of allAppointments) {
    if (!isAppointmentVisible(a)) continue;
    if (a.allDay) continue;
    if (excludeApptId != null && a.id === excludeApptId) continue;
    if (a.client?.id == null || String(a.client.id) !== cid) continue;
    const iv = appointmentInterval(a);
    if (!iv) continue;
    if (!appointmentIntervalsClumped(slotStartMs, slotEndMs, iv.start, iv.end)) continue;
    for (const p of patientsForAppointment(a)) {
      if (p.id != null) out.add(String(p.id));
    }
  }
  return [...out];
}

export function activeClientPetsFromPayload(payload: unknown): ClientPetRow[] {
  return extractPatientsFromClientPayload(payload).filter(isActiveClientPet);
}

export function hasAddPetChoices(clientPets: ClientPetRow[], excludePatientIds: string[]): boolean {
  const exclude = new Set(excludePatientIds.map(String));
  return clientPets.some((p) => !exclude.has(String(p.id)));
}

export function addPetMenuTitle(ready: boolean | null): string | undefined {
  if (ready === null) return 'Checking which pets can be added…';
  if (ready === false) {
    return 'Every pet for this client is already in this visit block on the schedule.';
  }
  return undefined;
}

export function appointmentSupportsAddPet(appt: Appointment): boolean {
  if (appt.allDay) return false;
  return appt.client?.id != null;
}
