/** Room loader / pre-appt workflow from PIMS `confirmStatusName` (matches practice calendar RL icon). */
export const PRE_APPT_SENT_SNIPPET = 'Pre-Appt Email Sent';
export const PRE_APPT_COMPLETE_SNIPPET = 'Client Submitted Pre-Appt form';

/** Fired after send-to-client / status changes so open calendars can refresh RL badges without a full reload. */
export const ROOM_LOADER_SENT_STATUS_CHANGED_EVENT = 'vayd:room-loader-sent-status-changed';

export function notifyRoomLoaderSentStatusChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ROOM_LOADER_SENT_STATUS_CHANGED_EVENT));
}

export type RoomLoaderPreApptUiStatus = 'none' | 'sent' | 'complete';

const STATUS_RANK: Record<RoomLoaderPreApptUiStatus, number> = {
  none: 0,
  sent: 1,
  complete: 2,
};

/** Prefer the more advanced workflow state (complete > sent > not sent). */
export function preferRoomLoaderPreApptStatus(
  a: RoomLoaderPreApptUiStatus,
  b: RoomLoaderPreApptUiStatus
): RoomLoaderPreApptUiStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

export function roomLoaderPreApptUiStatus(
  confirmStatusName: string | null | undefined
): RoomLoaderPreApptUiStatus {
  const s = (confirmStatusName ?? '').trim().toLowerCase();
  if (!s) return 'none';
  if (s.includes(PRE_APPT_COMPLETE_SNIPPET.toLowerCase())) return 'complete';
  // Matches "Pre-Appt Email Sent" and "Pre-Appt Email Sent 2x"
  if (s.includes(PRE_APPT_SENT_SNIPPET.toLowerCase())) return 'sent';
  return 'none';
}

/**
 * Scout room-loader `sentStatus` (`sent_1` / `sent_2` / `completed`).
 * Used when PIMS `confirmStatusName` has not caught up after send-to-client.
 */
export function roomLoaderPreApptUiStatusFromSentStatus(
  sentStatus: string | null | undefined
): RoomLoaderPreApptUiStatus {
  const s = (sentStatus ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!s || s === 'not_sent') return 'none';
  if (s === 'completed' || s === 'complete') return 'complete';
  if (s === 'sent' || s.startsWith('sent_')) return 'sent';
  return 'none';
}

/** Combine PIMS confirm status with Scout room-loader sentStatus (best wins). */
export function resolveRoomLoaderPreApptUiStatus(
  confirmStatusName?: string | null,
  sentStatus?: string | null
): RoomLoaderPreApptUiStatus {
  return preferRoomLoaderPreApptStatus(
    roomLoaderPreApptUiStatus(confirmStatusName),
    roomLoaderPreApptUiStatusFromSentStatus(sentStatus)
  );
}

/** Best status across pets / appointments at one stop (complete beats sent beats not sent). */
export function aggregateRoomLoaderPreApptStatus(
  confirmStatusNames: readonly (string | null | undefined)[]
): RoomLoaderPreApptUiStatus {
  let best: RoomLoaderPreApptUiStatus = 'none';
  for (const name of confirmStatusNames) {
    const st = roomLoaderPreApptUiStatus(name);
    if (st === 'complete') return 'complete';
    if (st === 'sent') best = 'sent';
  }
  return best;
}

export function chartRoomLoaderAction(opts: {
  confirmStatusName?: string | null;
  sentStatus?: string | null;
  timesSentToClient?: number | null;
  hasStaffForm?: boolean;
  hasClientResponse?: boolean;
}): { mode: 'send' | 'resend' | 'view'; label: string } {
  const ui = resolveRoomLoaderPreApptUiStatus(opts.confirmStatusName, opts.sentStatus);
  if (opts.hasClientResponse || ui === 'complete') {
    return { mode: 'view', label: 'View Room Loader' };
  }
  if (
    opts.hasStaffForm ||
    (opts.timesSentToClient ?? 0) > 0 ||
    ui === 'sent'
  ) {
    return { mode: 'resend', label: 'Re-send Room Loader' };
  }
  return { mode: 'send', label: 'Send Room Loader' };
}

export function roomLoaderPreApptDisplayLabel(status: RoomLoaderPreApptUiStatus): string {
  if (status === 'complete') return 'Client submitted form';
  if (status === 'sent') return 'Email sent';
  return 'Not sent';
}

export function roomLoaderPreApptDisplayColor(status: RoomLoaderPreApptUiStatus): string {
  if (status === 'complete') return '#16a34a';
  if (status === 'sent') return '#ca8a04';
  return '#dc2626';
}

type RoomLoaderStatusSource = {
  sentStatus?: string | null;
  appointments?: readonly {
    id?: number | null;
    patient?: { id?: number | null } | null;
  }[] | null;
  patients?: readonly { id?: number | null }[] | null;
};

type CalendarAppointmentForRoomLoaderStatus = {
  id?: number | null;
  patient?: { id?: number | null } | null;
  patients?: readonly { id?: number | null }[] | null;
  patientId?: number | string | null;
};

function roomLoaderPatientIdsFromStatusSource(rl: RoomLoaderStatusSource): number[] {
  const ids = new Set<number>();
  for (const p of rl.patients ?? []) {
    const id = Number(p?.id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  for (const a of rl.appointments ?? []) {
    const id = Number(a?.patient?.id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

function calendarAppointmentPatientIds(a: CalendarAppointmentForRoomLoaderStatus): number[] {
  const ids = new Set<number>();
  for (const p of a.patients ?? []) {
    const id = Number(p?.id);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  const nested = Number(a.patient?.id);
  if (Number.isFinite(nested) && nested > 0) ids.add(nested);
  const flat = Number(a.patientId);
  if (Number.isFinite(flat) && flat > 0) ids.add(flat);
  return [...ids];
}

/** Map appointment id → best Scout room-loader UI status for calendar RL badges. */
export function buildRoomLoaderPreApptStatusByAppointmentId(
  loaders: readonly RoomLoaderStatusSource[],
  /**
   * When provided, also attribute sent/completed status onto calendar appointments that share
   * patients with a room loader but are not linked by appointment id yet (e.g. after a
   * doctor-to-doctor move that recreates or re-keys the visit).
   */
  calendarAppointments?: readonly CalendarAppointmentForRoomLoaderStatus[] | null
): Map<number, RoomLoaderPreApptUiStatus> {
  const map = new Map<number, RoomLoaderPreApptUiStatus>();
  const byPatient = new Map<number, RoomLoaderPreApptUiStatus>();

  for (const rl of loaders) {
    const ui = roomLoaderPreApptUiStatusFromSentStatus(rl.sentStatus);
    if (ui === 'none') continue;
    for (const a of rl.appointments ?? []) {
      const id = Number(a?.id);
      if (!Number.isFinite(id)) continue;
      const prev = map.get(id) ?? 'none';
      map.set(id, preferRoomLoaderPreApptStatus(prev, ui));
    }
    for (const patientId of roomLoaderPatientIdsFromStatusSource(rl)) {
      const prev = byPatient.get(patientId) ?? 'none';
      byPatient.set(patientId, preferRoomLoaderPreApptStatus(prev, ui));
    }
  }

  if (!calendarAppointments?.length || byPatient.size === 0) return map;

  for (const appt of calendarAppointments) {
    const apptId = Number(appt?.id);
    if (!Number.isFinite(apptId) || apptId <= 0) continue;
    let bestFromPatients: RoomLoaderPreApptUiStatus = 'none';
    for (const patientId of calendarAppointmentPatientIds(appt)) {
      bestFromPatients = preferRoomLoaderPreApptStatus(
        bestFromPatients,
        byPatient.get(patientId) ?? 'none'
      );
    }
    if (bestFromPatients === 'none') continue;
    const prev = map.get(apptId) ?? 'none';
    map.set(apptId, preferRoomLoaderPreApptStatus(prev, bestFromPatients));
  }

  return map;
}

/** Keep completed/sent pre-appt confirm status when a refresh omits it (e.g. after reschedule sync). */
export function mergeAppointmentPreserveRoomLoaderConfirmStatus<
  T extends { confirmStatusName?: string | null },
>(previous: T | null | undefined, incoming: T): T {
  if (!previous) return incoming;
  const prevStatus = roomLoaderPreApptUiStatus(previous.confirmStatusName);
  const nextStatus = roomLoaderPreApptUiStatus(incoming.confirmStatusName);
  if ((prevStatus === 'complete' || prevStatus === 'sent') && nextStatus === 'none') {
    return { ...incoming, confirmStatusName: previous.confirmStatusName };
  }
  if (prevStatus === 'complete' && nextStatus === 'sent') {
    return { ...incoming, confirmStatusName: previous.confirmStatusName };
  }
  return incoming;
}
