import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import type { SchedulerBookPrefill } from '../pages/SchedulerBookModal';
import type {
  ManualBookPreviewDraft,
  RoutingCalendarPreviewPayloadV1,
} from './routingCalendarPreviewStorage';

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
): number {
  const newStartMs = DateTime.fromISO(startIso, { zone: 'utc' }).toMillis();
  if (!Number.isFinite(newStartMs)) return 0;

  const timedOnDay = appointments
    .filter((a) => !a.allDay && dayKeyFromAppointmentIso(a.appointmentStart, practiceTz) === dayKey)
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
  };
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
  const insertionIndex = computeManualBookInsertionIndex(
    dayKey,
    draft.appointmentStartIso,
    appointments,
    practiceTz,
  );
  const clientLabel =
    draft.clientLabel?.trim() ||
    (draft.clientId ? `Client #${draft.clientId}` : 'New appointment');
  const previewPatients =
    draft.patientId && draft.patientLabel?.trim()
      ? [{ id: draft.patientId, name: draft.patientLabel.trim() }]
      : draft.patientId
        ? [{ id: draft.patientId, name: `Pet ${draft.patientId}` }]
        : undefined;

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
      ...(draft.clientAddress ? { address: draft.clientAddress } : {}),
      ...(draft.clientCity ? { city: draft.clientCity } : {}),
      ...(draft.clientState ? { state: draft.clientState } : {}),
      ...(draft.clientZip ? { zip: draft.clientZip } : {}),
      ...(draft.clientLat != null && Number.isFinite(draft.clientLat)
        ? { lat: draft.clientLat }
        : {}),
      ...(draft.clientLon != null && Number.isFinite(draft.clientLon)
        ? { lon: draft.clientLon }
        : {}),
    },
    appointmentTypeId: draft.appointmentTypeId,
    clientDisplayLabel: clientLabel,
    ...(previewPatients?.length ? { previewPatients } : {}),
  };
}
