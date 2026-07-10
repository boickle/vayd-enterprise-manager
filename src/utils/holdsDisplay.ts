import type { HoldListItem } from '../api/holds';

export type ParsedOnlineBookingHoldDescription = {
  clientName: string | null;
  /** True when description is only the standard HOLD title (client + pet identifiers). */
  isBoilerplateTitle: boolean;
  petName: string | null;
};

function holdDescriptionText(hold: HoldListItem): string {
  return hold.description?.trim() || hold.instructions?.trim() || '';
}

/** Parse short online-booking HOLD calendar titles from the description field. */
export function parseOnlineBookingHoldDescription(
  text: string
): ParsedOnlineBookingHoldDescription | null {
  const trimmed = text.trim();
  if (!/^Online Booking/i.test(trimmed)) return null;

  // "Online Booking - Deirdre Frey (Current client) for Floofy"
  const existingClientHold = trimmed.match(
    /^Online Booking\s*-\s*(.+?)\s*\(\s*Current client\s*\)(?:\s+for\s+(.+?))?\s*$/i
  );
  if (existingClientHold) {
    return {
      clientName: existingClientHold[1]?.trim() || null,
      petName: existingClientHold[2]?.trim() || null,
      isBoilerplateTitle: true,
    };
  }

  // "Online Booking - Jane Doe. Fluffy: reason" or "Online Booking - Jane Doe, Fluffy"
  const newClientHold = trimmed.match(
    /^Online Booking\s*-\s*(.+?)(?:\.\s*([A-Za-z0-9][A-Za-z0-9' -]{0,40}?)(?::|\.)|\s*,\s*([A-Za-z0-9][A-Za-z0-9' -]{0,40}?))\s*$/i
  );
  if (newClientHold) {
    const clientName = newClientHold[1]?.trim() || null;
    const petName = (newClientHold[2] ?? newClientHold[3])?.trim() || null;
    return {
      clientName,
      petName,
      isBoilerplateTitle: Boolean(clientName && petName && !newClientHold[1]?.includes(':')),
    };
  }

  // "Online Booking - Client Name" only
  const clientOnly = trimmed.match(/^Online Booking\s*-\s*(.+?)\s*$/i);
  if (clientOnly) {
    const rest = clientOnly[1]?.trim() ?? '';
    if (/^\(.+\)\s*for\s+/i.test(rest)) return null;
    const forPet = rest.match(/^(.+?)\s+for\s+(.+?)\s*$/i);
    if (forPet) {
      return {
        clientName: forPet[1]?.trim() || null,
        petName: forPet[2]?.trim() || null,
        isBoilerplateTitle: true,
      };
    }
    return {
      clientName: rest || null,
      petName: null,
      isBoilerplateTitle: false,
    };
  }

  return null;
}

export function resolveHoldClientLabel(hold: HoldListItem): string {
  if (hold.client) {
    const name = `${hold.client.firstName ?? ''} ${hold.client.lastName ?? ''}`.trim();
    if (name) return name;
    return `Client #${hold.client.id}`;
  }
  const parsed = parseOnlineBookingHoldDescription(hold.description ?? '');
  if (parsed?.clientName) return parsed.clientName;
  return 'No client';
}

export function resolveHoldPatientLabel(hold: HoldListItem): string {
  const linked = hold.patient?.name?.trim();
  if (linked) return linked;
  const parsed = parseOnlineBookingHoldDescription(hold.description ?? '');
  if (parsed?.petName) return parsed.petName;
  return 'No patient listed';
}

function noteAlreadyShown(note: string, hold: HoldListItem): boolean {
  const parsed = parseOnlineBookingHoldDescription(note);
  if (!parsed?.isBoilerplateTitle) return false;

  const client = resolveHoldClientLabel(hold).trim().toLowerCase();
  const patient = resolveHoldPatientLabel(hold).trim().toLowerCase();
  const parsedClient = parsed.clientName?.trim().toLowerCase() ?? '';
  const parsedPet = parsed.petName?.trim().toLowerCase() ?? '';

  if (parsedClient && parsedClient !== client) return false;
  if (parsedPet && parsedPet !== patient && patient !== 'no patient listed') return false;
  return true;
}

export function holdPatientInlineNotes(hold: HoldListItem): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (note: string) => {
    const trimmed = note.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  const desc = hold.description?.trim() ?? '';
  if (desc && !noteAlreadyShown(desc, hold)) {
    push(desc);
  }

  const instructions = hold.instructions?.trim() ?? '';
  if (instructions && instructions !== desc) {
    push(instructions);
  }

  return out;
}

/** Notes to show below the card — excludes online-booking titles already in the header. */
export function holdHouseholdSupplementalNotes(holds: readonly HoldListItem[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (note: string) => {
    const trimmed = note.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  for (const h of holds) {
    const desc = h.description?.trim() ?? '';
    if (desc && !noteAlreadyShown(desc, h)) {
      push(desc);
    }

    const instructions = h.instructions?.trim() ?? '';
    if (instructions && instructions !== desc) {
      push(instructions);
    }
  }

  return out;
}

export function holdDescriptionHaystack(hold: HoldListItem): string {
  return holdDescriptionText(hold);
}
