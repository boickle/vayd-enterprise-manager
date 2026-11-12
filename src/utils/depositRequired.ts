/**
 * "Deposit required" (Nov 12, 2026): managers, billing and lead CLs mark a client; booking and
 * the schedule show it with the client alerts so CLs collect a deposit
 * (right-click the appointment → Client → Appointment Deposit).
 */
export function depositRequiredLine(client: unknown): string | null {
  if (!client || typeof client !== 'object') return null;
  const c = client as { depositRequired?: unknown; depositRequiredNote?: unknown };
  if (c.depositRequired !== true) return null;
  const note = typeof c.depositRequiredNote === 'string' ? c.depositRequiredNote.trim() : '';
  return `DEPOSIT REQUIRED${note ? ` (${note})` : ''}: collect a deposit for this visit (right-click the appointment → Client → Appointment Deposit).`;
}

/** Client alerts with the deposit line first, or null when there is neither. */
export function alertsWithDeposit(client: unknown, alerts: string | null | undefined): string | null {
  const dep = depositRequiredLine(client);
  const text = alerts?.trim() || null;
  if (dep && text) return `${dep}\n${text}`;
  return dep ?? text;
}
