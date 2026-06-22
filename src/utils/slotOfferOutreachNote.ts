import { DateTime } from 'luxon';
import { fetchUnscheduledReminders, patchReminder, type UnscheduledReminder } from '../api/careOutreach';
import type { SendSlotOfferPayload } from '../api/slotOffers';
import type { Provider } from '../api/employee';
import {
  appendStaffNoteLine,
  formatEmployeeFirstNameLastInitial,
  resolveAppointmentChangeActorFromAuth,
  type AppointmentChangeActor,
} from './appointmentChangeAuditNote';
import { careOutreachChipCountFetchRange } from './careOutreachPriorityFilters';
import { careOutreachReminderIsHidden } from './careOutreachReminderVisibility';
import { formatForwardBookingSmsBookedSlot } from './forwardBookingSmsMessage';

function initialOutreachNotes(r: UnscheduledReminder): string {
  const any = r as Record<string, unknown>;
  const snake = typeof any.outreach_notes === 'string' ? any.outreach_notes : null;
  return String(r.outreachNotes ?? snake ?? r.notes ?? '').trim();
}

export function buildSlotOfferOutreachNoteLine(opts: {
  offeredSlotDatetime: string;
  arrivalWindowStart: string;
  arrivalWindowEnd: string;
  slotDate?: string | null;
  practiceTz: string;
  actor: AppointmentChangeActor;
  loggedAt?: DateTime;
}): string {
  const tz = opts.practiceTz;
  const sched = DateTime.fromISO(opts.offeredSlotDatetime, { zone: 'utc' }).setZone(tz);
  const schedResolved = sched.isValid ? sched : DateTime.fromISO(opts.offeredSlotDatetime, { setZone: true });
  const apptDateLabel = schedResolved.isValid
    ? schedResolved.toFormat('MM/dd/yyyy')
    : (opts.slotDate?.trim() || '—');
  const scheduledTimeLabel = schedResolved.isValid ? schedResolved.toFormat('h:mm a') : '—';

  const window = formatForwardBookingSmsBookedSlot(
    opts.arrivalWindowStart,
    opts.arrivalWindowEnd,
    tz,
    opts.slotDate?.trim() || opts.offeredSlotDatetime
  );
  const windowLabel = `${window.windowStart} - ${window.windowEnd}`;

  const logged = (opts.loggedAt ?? DateTime.now()).setZone(tz);
  const loggedLabel = logged.isValid ? logged.toFormat('MM/dd/yyyy h:mm a') : DateTime.now().toFormat('MM/dd/yyyy h:mm a');
  const staff = formatEmployeeFirstNameLastInitial(opts.actor);

  return `Texted offer for ${apptDateLabel} at ${scheduledTimeLabel} with arrival window ${windowLabel} on ${loggedLabel} - ${staff}`;
}

async function reminderIdsForSlotOfferPatients(
  practiceId: number,
  clientId: number,
  petIds: readonly number[]
): Promise<UnscheduledReminder[]> {
  const wantPets = new Set(petIds.map(Number).filter((id) => Number.isFinite(id) && id > 0));
  if (wantPets.size === 0) return [];

  const range = careOutreachChipCountFetchRange();
  const list = await fetchUnscheduledReminders({
    practiceId,
    dueDateFrom: range.from,
    dueDateTo: range.to,
    limit: 2000,
  });

  const matches: UnscheduledReminder[] = [];
  for (const r of list) {
    if (careOutreachReminderIsHidden(r)) continue;
    const pid = r.patient?.id;
    if (pid == null || !wantPets.has(Number(pid))) continue;
    const clientRef = r.patient?.clients?.[0] ?? r.patient?.client ?? null;
    const rowClientId = clientRef?.id;
    if (rowClientId != null && Number(rowClientId) !== Number(clientId)) continue;
    matches.push(r);
  }
  return matches;
}

/** Append outreach log line to each visible unscheduled reminder for the offered pets. */
export async function applySlotOfferOutreachNotes(opts: {
  payload: SendSlotOfferPayload;
  practiceTz: string;
  token?: string | null;
  userEmail?: string | null;
  doctorId?: string | null;
  providers?: readonly Provider[];
}): Promise<{ applied: number; warning?: string }> {
  const { payload, practiceTz } = opts;
  const line = buildSlotOfferOutreachNoteLine({
    offeredSlotDatetime: payload.offeredSlotDatetime,
    arrivalWindowStart: payload.arrivalWindowStart,
    arrivalWindowEnd: payload.arrivalWindowEnd,
    slotDate: payload.slotDate,
    practiceTz,
    actor: resolveAppointmentChangeActorFromAuth({
      token: opts.token,
      userEmail: opts.userEmail,
      doctorId: opts.doctorId,
      providers: opts.providers,
    }),
  });

  let reminders: UnscheduledReminder[];
  try {
    reminders = await reminderIdsForSlotOfferPatients(
      payload.practiceId,
      payload.clientId,
      payload.petIds
    );
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
      (e as Error)?.message ??
      'Could not load reminders for outreach notes.';
    return { applied: 0, warning: String(msg) };
  }

  if (reminders.length === 0) {
    return { applied: 0, warning: 'Offer sent, but no matching outreach reminders were found to log notes on.' };
  }

  let applied = 0;
  const errors: string[] = [];
  for (const r of reminders) {
    const id = Number(r.id);
    if (!Number.isFinite(id)) continue;
    const next = appendStaffNoteLine(initialOutreachNotes(r), line);
    try {
      await patchReminder(id, { outreachNotes: next });
      applied += 1;
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not save outreach note.';
      errors.push(String(msg));
    }
  }

  if (applied === 0) {
    return {
      applied: 0,
      warning: errors[0] ?? 'Could not save outreach notes.',
    };
  }
  if (errors.length > 0) {
    return {
      applied,
      warning: `Offer sent; outreach notes saved for ${applied} reminder(s), but some could not be updated.`,
    };
  }
  return { applied };
}
