/** Session ack — household visit warning already shown for this client on Routing. */

export const ROUTING_HOUSEHOLD_VISIT_ACK_KEY = 'vayd:routing-household-visit-ack-v1';

export function readRoutingHouseholdVisitAckClientId(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ROUTING_HOUSEHOLD_VISIT_ACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; clientId?: unknown };
    if (parsed?.v !== 1) return null;
    const clientId = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : '';
    return clientId || null;
  } catch {
    return null;
  }
}

export function isRoutingHouseholdVisitAcked(clientId: string): boolean {
  const id = clientId.trim();
  if (!id) return false;
  return readRoutingHouseholdVisitAckClientId() === id;
}

export function writeRoutingHouseholdVisitAck(clientId: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const id = clientId.trim();
  if (!id) return;
  try {
    sessionStorage.setItem(
      ROUTING_HOUSEHOLD_VISIT_ACK_KEY,
      JSON.stringify({ v: 1, clientId: id }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearRoutingHouseholdVisitAck(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_HOUSEHOLD_VISIT_ACK_KEY);
  } catch {
    /* ignore */
  }
}
