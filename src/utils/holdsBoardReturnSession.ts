/** Scheduler → Holds board return with row exit animation. */
export const HOLDS_BOARD_RETURN_KEY = 'vayd:holds-board-return-v1';

export type HoldsBoardReturnExitKind = 'booked' | 'removed';

export type HoldsBoardReturnV1 = {
  v: 1;
  appointmentIds: number[];
  exitKind: HoldsBoardReturnExitKind;
  clientLabel?: string | null;
  /** Original Holds board row — scroll + exit animation target. */
  groupKey?: string | null;
  /** Sort hint when the hold no longer appears in GET /holds. */
  snapshotAppointmentStart?: string | null;
};

export function writeHoldsBoardReturnSession(
  next: Omit<HoldsBoardReturnV1, 'v'>,
): void {
  if (typeof sessionStorage === 'undefined') return;
  const appointmentIds = [
    ...new Set(
      next.appointmentIds.filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (appointmentIds.length === 0) return;
  const clientLabel = next.clientLabel?.trim() || null;
  const groupKey = next.groupKey?.trim() || null;
  const snapshotAppointmentStart =
    typeof next.snapshotAppointmentStart === 'string' && next.snapshotAppointmentStart.trim()
      ? next.snapshotAppointmentStart.trim()
      : null;
  try {
    sessionStorage.setItem(
      HOLDS_BOARD_RETURN_KEY,
      JSON.stringify({
        v: 1,
        appointmentIds,
        exitKind: next.exitKind,
        clientLabel,
        groupKey,
        snapshotAppointmentStart,
      }),
    );
  } catch {
    /* quota */
  }
}

export function readHoldsBoardReturnSession(): HoldsBoardReturnV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(HOLDS_BOARD_RETURN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as HoldsBoardReturnV1;
    if (o?.v !== 1 || !Array.isArray(o.appointmentIds)) return null;
    if (o.exitKind !== 'booked' && o.exitKind !== 'removed') return null;
    const appointmentIds = o.appointmentIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (appointmentIds.length === 0) return null;
    const clientLabel =
      typeof o.clientLabel === 'string' && o.clientLabel.trim()
        ? o.clientLabel.trim()
        : null;
    const groupKey =
      typeof o.groupKey === 'string' && o.groupKey.trim() ? o.groupKey.trim() : null;
    const snapshotAppointmentStart =
      typeof o.snapshotAppointmentStart === 'string' && o.snapshotAppointmentStart.trim()
        ? o.snapshotAppointmentStart.trim()
        : null;
    return {
      v: 1,
      appointmentIds,
      exitKind: o.exitKind,
      clientLabel,
      groupKey,
      snapshotAppointmentStart,
    };
  } catch {
    return null;
  }
}

export function clearHoldsBoardReturnSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(HOLDS_BOARD_RETURN_KEY);
  } catch {
    /* ignore */
  }
}
