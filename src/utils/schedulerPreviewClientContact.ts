import { fetchAppointmentById } from '../api/appointments';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import type { Provider } from '../api/employee';
import type { Appointment } from '../api/roomLoader';
import type { PreviewPopoverClientContact } from '../components/PreviewPopoverClientContact';
import { resolveQuoFromLine } from './quoContact';
import type { RoutingCalendarPreviewPayloadV1 } from './routingCalendarPreviewStorage';
import { readRoutingRescheduleIntent } from './routingRescheduleIntent';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function clientPhoneFromStaffPayload(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return pickStr(o.phone1) ?? pickStr(o.phone2) ?? pickStr(o.phone);
}

export function previewClientContactFromAppointment(
  appt: Appointment | null | undefined,
  providers: readonly Provider[]
): PreviewPopoverClientContact | null {
  const phone = pickStr(appt?.client?.phone1) ?? pickStr(appt?.client?.phone2);
  if (!phone) return null;
  return {
    phone,
    fromLine: resolveQuoFromLine({
      appointmentPrimaryProvider: appt?.primaryProvider,
      providers,
    }),
  };
}

function reschedulePreviewAppointmentIds(
  preview: RoutingCalendarPreviewPayloadV1
): number[] {
  if (preview.rescheduleAppointmentIds?.length) {
    return preview.rescheduleAppointmentIds.filter((id) => Number.isFinite(Number(id))).map(Number);
  }
  if (preview.rescheduleAppointmentId != null && Number.isFinite(Number(preview.rescheduleAppointmentId))) {
    return [Number(preview.rescheduleAppointmentId)];
  }
  return [];
}

export function reschedulePreviewClientId(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined
): string | null {
  const intent = readRoutingRescheduleIntent();
  return (
    intent?.clientId?.trim() ||
    preview?.newApptMeta?.clientId?.trim() ||
    (preview?.scheduleLoaderReturn?.clientId != null
      ? String(preview.scheduleLoaderReturn.clientId)
      : null) ||
    null
  );
}

export function routingPreviewClientId(
  preview: RoutingCalendarPreviewPayloadV1 | null | undefined,
  isReschedule: boolean
): string | null {
  if (isReschedule) return reschedulePreviewClientId(preview);
  return (
    preview?.newApptMeta?.clientId?.trim() ||
    preview?.manualBookDraft?.clientId?.trim() ||
    (preview?.scheduleLoaderReturn?.clientId != null
      ? String(preview.scheduleLoaderReturn.clientId)
      : null) ||
    null
  );
}

/** Quo line for the doctor on the proposed calendar slot (not the source visit assignee). */
function quoFromLineForRoutingPreview(
  preview: RoutingCalendarPreviewPayloadV1,
  providers: readonly Provider[]
): string | null {
  const docId = pickStr(preview.option?.doctorPimsId);
  if (!docId || !providers.length) return null;
  const row = providers.find(
    (p) => String(p.id) === docId || String(p.pimsId ?? '') === docId
  );
  return resolveQuoFromLine({
    appointmentPrimaryProvider: row ?? { id: docId },
    providers,
  });
}

/** Client phone + Quo line for routing / reschedule calendar preview popovers. */
export async function loadRoutingPreviewClientContact(args: {
  preview: RoutingCalendarPreviewPayloadV1;
  isReschedule: boolean;
  rawAppointments: readonly Appointment[];
  providers: readonly Provider[];
  practiceId: number;
}): Promise<PreviewPopoverClientContact | null> {
  const fromLine = quoFromLineForRoutingPreview(args.preview, args.providers);

  if (args.isReschedule) {
    const ids = reschedulePreviewAppointmentIds(args.preview);
    const firstId = ids[0];

    let appt: Appointment | null =
      firstId != null ? args.rawAppointments.find((a) => a.id === firstId) ?? null : null;

    const syncContact = previewClientContactFromAppointment(appt, args.providers);
    if (syncContact) {
      return { ...syncContact, fromLine: fromLine ?? syncContact.fromLine };
    }

    if (firstId != null) {
      try {
        appt = await fetchAppointmentById(firstId, { practiceId: args.practiceId });
        const fetchedContact = previewClientContactFromAppointment(appt, args.providers);
        if (fetchedContact) {
          return { ...fetchedContact, fromLine: fromLine ?? fetchedContact.fromLine };
        }
      } catch {
        /* fall through to client lookup */
      }
    }
  }

  const clientId = routingPreviewClientId(args.preview, args.isReschedule);
  if (!clientId) return null;

  try {
    const raw = await fetchClientByIdStaff(clientId);
    const phone = clientPhoneFromStaffPayload(raw);
    if (!phone) return null;
    return { phone, fromLine };
  } catch {
    return null;
  }
}
