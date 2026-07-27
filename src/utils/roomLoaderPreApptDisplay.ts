/** Room loader / pre-appt workflow from PIMS `confirmStatusName` (matches practice calendar RL icon). */
export const PRE_APPT_SENT_SNIPPET = 'Pre-Appt Email Sent';
export const PRE_APPT_COMPLETE_SNIPPET = 'Client Submitted Pre-Appt form';

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
  appointments?: readonly { id?: number | null }[] | null;
};

/** Map appointment id → best Scout room-loader UI status for calendar RL badges. */
export function buildRoomLoaderPreApptStatusByAppointmentId(
  loaders: readonly RoomLoaderStatusSource[]
): Map<number, RoomLoaderPreApptUiStatus> {
  const map = new Map<number, RoomLoaderPreApptUiStatus>();
  for (const rl of loaders) {
    const ui = roomLoaderPreApptUiStatusFromSentStatus(rl.sentStatus);
    if (ui === 'none') continue;
    for (const a of rl.appointments ?? []) {
      const id = Number(a?.id);
      if (!Number.isFinite(id)) continue;
      const prev = map.get(id) ?? 'none';
      map.set(id, preferRoomLoaderPreApptStatus(prev, ui));
    }
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
