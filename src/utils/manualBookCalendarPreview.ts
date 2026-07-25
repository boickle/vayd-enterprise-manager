import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import type { SchedulerBookPrefill } from '../pages/SchedulerBookModal';
import type {
  ManualBookPreviewDraft,
  RoutingCalendarPreviewPayloadV1,
} from './routingCalendarPreviewStorage';
import {
  patientsForAppointment,
} from './schedulerAddPet';
import { appointmentAlternateAddressText } from '../api/appointments';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function coordsFromClientPayload(payload: unknown): { lat?: number; lon?: number } {
  if (!payload || typeof payload !== 'object') return {};
  const o = payload as Record<string, unknown>;
  const latRaw = o.lat ?? o.latitude;
  const lonRaw = o.lon ?? o.longitude;
  const lat = typeof latRaw === 'number' ? latRaw : Number(latRaw);
  const lon = typeof lonRaw === 'number' ? lonRaw : Number(lonRaw);
  return {
    ...(Number.isFinite(lat) ? { lat } : {}),
    ...(Number.isFinite(lon) ? { lon } : {}),
  };
}

export function clientAddressPartsFromPayload(payload: unknown): {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
} {
  if (!payload || typeof payload !== 'object') return {};
  const o = payload as Record<string, unknown>;
  const address1 = pickStr(o.address1 ?? o.address);
  const city = pickStr(o.city);
  const state = pickStr(o.state);
  const zip = pickStr(o.zip ?? o.zipcode);
  const full =
    pickStr(o.fullAddress) ||
    [address1, city, state, zip].filter(Boolean).join(', ') ||
    undefined;
  return {
    ...(full ? { address: full } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(zip ? { zip } : {}),
  };
}

export function dayKeyFromAppointmentIso(iso: string, practiceTz: string): string | null {
  const d = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  return d.isValid ? d.toISODate() : null;
}

/** Where to splice the synthetic visit into doctor-day for drive ETA refresh. */
export function computeManualBookInsertionIndex(
  dayKey: string,
  startIso: string,
  appointments: readonly Appointment[],
  practiceTz: string,
  opts?: { excludeAppointmentIds?: ReadonlySet<number> },
): number {
  const newStartMs = DateTime.fromISO(startIso, { zone: 'utc' }).toMillis();
  if (!Number.isFinite(newStartMs)) return 0;
  const exclude = opts?.excludeAppointmentIds;

  const timedOnDay = appointments
    .filter((a) => {
      if (a.allDay) return false;
      if (exclude && typeof a.id === 'number' && exclude.has(a.id)) return false;
      return dayKeyFromAppointmentIso(a.appointmentStart, practiceTz) === dayKey;
    })
    .sort(
      (a, b) =>
        DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).toMillis() -
        DateTime.fromISO(b.appointmentStart, { zone: 'utc' }).toMillis(),
    );

  let idx = 0;
  for (const a of timedOnDay) {
    const ms = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).toMillis();
    if (Number.isFinite(ms) && ms < newStartMs) idx += 1;
    else break;
  }
  return idx;
}

export function manualBookPrefillFromDraft(draft: ManualBookPreviewDraft): SchedulerBookPrefill {
  return {
    modalTitle: draft.modalTitle,
    clientId: draft.clientId,
    clientLabel: draft.clientLabel,
    appointmentTypeId: draft.appointmentTypeId,
    providerId: String(draft.primaryProviderId),
    preferredPatientId: draft.patientId,
    defaultDescription: draft.description,
    defaultInstructions: draft.instructions,
    additionalEmployeeIds: draft.additionalEmployeeIds,
    ...(draft.coVisitAddPet ? { coVisitAddPet: true } : {}),
    ...(draft.coVisitAnchorAppointmentId != null
      ? { coVisitAnchorAppointmentId: draft.coVisitAnchorAppointmentId }
      : {}),
    ...(draft.alternateAddressText?.trim()
      ? { coVisitAlternateAddress: draft.alternateAddressText.trim() }
      : {}),
  };
}

function clientPimsIdFromAppointment(a: Appointment | undefined): string | undefined {
  if (!a) return undefined;
  const fromClient = pickStr(a.client?.pimsId);
  if (fromClient) return fromClient;
  const row = a as Appointment & { clientPimsId?: string | null };
  return pickStr(row.clientPimsId) ?? undefined;
}

/** Pets already on the visit (align targets) plus the pet being added. */
function buildCoVisitPreviewPatients(
  draft: ManualBookPreviewDraft,
  appointments: readonly Appointment[],
  _practiceTz: string,
): { id: number | string; name: string }[] {
  const byId = new Map<string, { id: number | string; name: string }>();

  const alignIds = new Set(
    (draft.coVisitAlignAppointmentIds ?? [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  // Only list existing pets on the red chip when those visits are hidden (align-all preview).
  if (alignIds.size > 0) {
    for (const a of appointments) {
      if (typeof a.id !== 'number' || !alignIds.has(a.id)) continue;
      for (const p of patientsForAppointment(a)) {
        const id = p.id != null ? String(p.id) : '';
        const name = pickStr(p.name) || (id ? `Pet ${id}` : '');
        if (!name) continue;
        const key = id || name.toLowerCase();
        if (!byId.has(key)) byId.set(key, { id: p.id ?? name, name });
      }
    }
  }

  if (draft.patientId) {
    const id = draft.patientId;
    const name = draft.patientLabel?.trim() || `Pet ${id}`;
    if (!byId.has(String(id))) byId.set(String(id), { id, name });
  }

  return [...byId.values()];
}

export function buildManualBookCalendarPreviewPayload(args: {
  draft: ManualBookPreviewDraft;
  doctorName: string;
  appointments: readonly Appointment[];
  practiceTz: string;
}): RoutingCalendarPreviewPayloadV1 {
  const { draft, doctorName, appointments, practiceTz } = args;
  const startUtc = DateTime.fromISO(draft.appointmentStartIso, { zone: 'utc' });
  const endUtc = DateTime.fromISO(draft.appointmentEndIso, { zone: 'utc' });
  const dayKey =
    (startUtc.isValid ? startUtc.setZone(practiceTz).toISODate() : null) ?? '';
  const serviceMinutes = Math.max(
    1,
    endUtc.isValid && startUtc.isValid
      ? Math.round(endUtc.diff(startUtc, 'minutes').minutes)
      : 30,
  );

  const alignHideIds = new Set(
    (draft.coVisitAlignAppointmentIds ?? [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  const insertionIndex = computeManualBookInsertionIndex(
    dayKey,
    draft.appointmentStartIso,
    appointments,
    practiceTz,
    alignHideIds.size > 0 ? { excludeAppointmentIds: alignHideIds } : undefined,
  );

  const clientLabel =
    draft.clientLabel?.trim() ||
    (draft.clientId ? `Client #${draft.clientId}` : 'New appointment');

  const anchorId = Number(draft.coVisitAnchorAppointmentId);
  const anchor =
    Number.isFinite(anchorId) && anchorId > 0
      ? appointments.find((a) => Number(a.id) === anchorId)
      : undefined;

  const previewPatients = draft.coVisitAddPet
    ? buildCoVisitPreviewPatients(draft, appointments, practiceTz)
    : draft.patientId && draft.patientLabel?.trim()
      ? [{ id: draft.patientId, name: draft.patientLabel.trim() }]
      : draft.patientId
        ? [{ id: draft.patientId, name: `Pet ${draft.patientId}` }]
        : undefined;

  const altText = draft.alternateAddressText?.trim() || '';
  const anchorAlt = anchor ? appointmentAlternateAddressText(anchor)?.trim() || '' : '';
  const routingAlt = altText || (draft.coVisitAddPet ? anchorAlt : '');
  const useAlternate = Boolean(routingAlt);

  const clientPimsId = clientPimsIdFromAppointment(anchor);

  return {
    version: 1,
    previewSource: 'manual-book',
    manualBookDraft: draft,
    option: {
      date: dayKey,
      suggestedStartIso: draft.appointmentStartIso,
      doctorPimsId: String(draft.primaryProviderId),
      doctorName,
      insertionIndex,
      clientName: clientLabel,
    },
    serviceMinutes,
    newApptMeta: {
      ...(draft.clientId ? { clientId: draft.clientId } : {}),
      ...(clientPimsId ? { clientPimsId } : {}),
      ...(useAlternate
        ? { address: routingAlt }
        : {
            ...(draft.clientAddress ? { address: draft.clientAddress } : {}),
            ...(draft.clientCity ? { city: draft.clientCity } : {}),
            ...(draft.clientState ? { state: draft.clientState } : {}),
            ...(draft.clientZip ? { zip: draft.clientZip } : {}),
          }),
      // Never attach client-home coords for an alternate stop — doctor-day inject copies the
      // anchor visit's already-geocoded ALT lat/lon. Putting home here made ETA route to home.
      ...(!useAlternate && draft.clientLat != null && Number.isFinite(draft.clientLat)
        ? { lat: draft.clientLat }
        : {}),
      ...(!useAlternate && draft.clientLon != null && Number.isFinite(draft.clientLon)
        ? { lon: draft.clientLon }
        : {}),
    },
    ...(useAlternate ? { routingUsesAlternateAddress: true } : {}),
    appointmentTypeId: draft.appointmentTypeId,
    clientDisplayLabel: clientLabel,
    ...(previewPatients?.length ? { previewPatients } : {}),
  };
}
