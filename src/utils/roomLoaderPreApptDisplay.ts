/** Room loader / pre-appt workflow from PIMS `confirmStatusName` (matches practice calendar RL icon). */
export const PRE_APPT_SENT_SNIPPET = 'Pre-Appt Email Sent';
export const PRE_APPT_COMPLETE_SNIPPET = 'Client Submitted Pre-Appt form';

export type RoomLoaderPreApptUiStatus = 'none' | 'sent' | 'complete';

export function roomLoaderPreApptUiStatus(
  confirmStatusName: string | null | undefined
): RoomLoaderPreApptUiStatus {
  const s = (confirmStatusName ?? '').trim();
  if (!s) return 'none';
  if (s.includes(PRE_APPT_COMPLETE_SNIPPET)) return 'complete';
  if (s.includes(PRE_APPT_SENT_SNIPPET)) return 'sent';
  return 'none';
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

/** Keep completed/sent pre-appt confirm status when a refresh omits it (e.g. after reschedule sync). */
export function mergeAppointmentPreserveRoomLoaderConfirmStatus<
  T extends { confirmStatusName?: string | null },
>(previous: T | null | undefined, incoming: T): T {
  if (!previous) return incoming;
  const prevStatus = roomLoaderPreApptUiStatus(previous.confirmStatusName);
  const nextStatus = roomLoaderPreApptUiStatus(incoming.confirmStatusName);
  if (
    (prevStatus === 'complete' || prevStatus === 'sent') &&
    nextStatus === 'none'
  ) {
    return { ...incoming, confirmStatusName: previous.confirmStatusName };
  }
  if (prevStatus === 'complete' && nextStatus === 'sent') {
    return { ...incoming, confirmStatusName: previous.confirmStatusName };
  }
  return incoming;
}
