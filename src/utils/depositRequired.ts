/**
 * "Deposit required" (Nov 12, 2026): managers, billing and lead CLs mark a client; booking and
 * the schedule show it with the client alerts so CLs collect a deposit
 * (right-click the appointment → Client → Appointment Deposit).
 */
export function depositRequiredLine(client: unknown, opts?: { depositPaid?: boolean }): string | null {
  if (!client || typeof client !== 'object') return null;
  const c = client as { depositRequired?: unknown; depositRequiredNote?: unknown };
  if (c.depositRequired !== true) return null;
  const note = typeof c.depositRequiredNote === 'string' ? c.depositRequiredNote.trim() : '';
  if (opts?.depositPaid) return `DEPOSIT REQUIRED${note ? ` (${note})` : ''}: the deposit for this visit is paid.`;
  return `DEPOSIT REQUIRED${note ? ` (${note})` : ''}: collect a deposit for this visit (right-click the appointment → Client → Appointment Deposit).`;
}

/** Client alerts with the deposit line first, or null when there is neither. */
export function alertsWithDeposit(
  client: unknown,
  alerts: string | null | undefined,
  opts?: { depositPaid?: boolean },
): string | null {
  const dep = depositRequiredLine(client, opts);
  const text = alerts?.trim() || null;
  if (dep && text) return `${dep}\n${text}`;
  return dep ?? text;
}

export type DepositBadgeState = 'needed' | 'requested' | 'part_paid' | 'paid';

/**
 * Schedule badge for a visit's deposit (PAY-A18): paid, asked for (or partly paid), or needed
 * (client marked "Deposit required" and nothing asked for yet). Null: no badge.
 */
export function depositBadgeState(
  client: unknown,
  status: 'none' | 'requested' | 'part_paid' | 'paid' | null | undefined,
): DepositBadgeState | null {
  if (status === 'paid' || status === 'part_paid' || status === 'requested') return status;
  return depositRequiredLine(client) ? 'needed' : null;
}

export function depositBadgeTitle(
  state: DepositBadgeState,
  amounts?: { requested?: number; paid?: number } | null,
): string {
  const m = (n: number | undefined) => `$${(Math.round((n ?? 0) * 100) / 100).toFixed(2)}`;
  switch (state) {
    case 'paid':
      return `Deposit paid (${m(amounts?.paid)})`;
    case 'part_paid':
      return `Deposit partly paid: ${m(amounts?.paid)} of ${m(amounts?.requested)}`;
    case 'requested':
      return `Deposit asked for (${m(amounts?.requested)}), not paid yet`;
    default:
      return 'Deposit required: not asked for yet';
  }
}
