/**
 * The three aftercare plans a catalog item can stand for. Mirrors
 * `src/common/aftercare.ts` in the API.
 *
 * There is no "unsure" here on purpose: not knowing yet is a conversation with
 * staff, never something that can sit on an estimate as a priced line.
 */
export const AFTERCARE_ITEM_TYPES = [
  'private_cremation',
  'burial_at_sea',
  'home_burial',
] as const;

export type AftercareItemType = (typeof AFTERCARE_ITEM_TYPES)[number];

/** What the family reads on the consent form when an item has no wording of its own. */
export const AFTERCARE_ITEM_LABELS: Record<AftercareItemType, string> = {
  private_cremation:
    'Private cremation — your pet is cremated on their own and their ashes come back to you',
  burial_at_sea:
    'Cremation without return of ashes — your pet is given a burial at sea on a Memorial Reef Sphere',
  home_burial: 'You will bury your pet at home or arrange their aftercare yourself',
};

/** Short wording for staff screens, where the full sentence is too much. */
export const AFTERCARE_STAFF_LABELS: Record<AftercareItemType, string> = {
  private_cremation: 'Private cremation (ashes returned)',
  burial_at_sea: 'Burial at sea (no ashes returned)',
  home_burial: 'Home burial / owner arranges',
};

const AFTERCARE_NOT_CONFIRMED_PREFIX = 'AFTERCARE NOT CONFIRMED';

export type AftercareNotConfirmedNote = {
  when: string | null;
  quoted: string | null;
  askedFor: string | null;
  /** Appointment notes with the system block removed. */
  otherNotes: string;
};

/**
 * Pulls the aftercare-not-confirmed block out of appointment notes so the
 * resend screen can show it as a banner instead of a run-on paragraph.
 */
export function parseAftercareNotConfirmedNote(
  raw: string | null | undefined,
): AftercareNotConfirmedNote | null {
  const text = String(raw ?? '');
  if (!text.toUpperCase().includes(AFTERCARE_NOT_CONFIRMED_PREFIX)) return null;

  const lines = text.split(/\r?\n/);
  const other: string[] = [];
  let block: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith(AFTERCARE_NOT_CONFIRMED_PREFIX)) {
      inBlock = true;
      block = [trimmed];
      continue;
    }
    if (inBlock) {
      if (
        !trimmed ||
        /^(quoted|owner asked for|consent not signed)/i.test(trimmed)
      ) {
        if (trimmed) block.push(trimmed);
        if (!trimmed) inBlock = false;
        continue;
      }
      inBlock = false;
    }
    if (trimmed) other.push(line);
  }

  const joined = block.join('\n');
  const header = block[0] ?? '';
  const whenMatch = header.match(
    new RegExp(`${AFTERCARE_NOT_CONFIRMED_PREFIX}\\s+(.+?)(?::\\s*|$)`, 'i'),
  );
  const quotedMatch =
    joined.match(/quoted:?\s+(.+?)(?:;|\n|$)/i) ||
    joined.match(/Quoted:\s+(.+)/i);
  const askedMatch =
    joined.match(/owner asked for:\s+(.+?)(?:;|\n|$)/i) ||
    joined.match(/Owner asked for:\s+(.+)/i);

  return {
    when: whenMatch?.[1]?.replace(/:$/, '').trim() || null,
    quoted: quotedMatch?.[1]?.trim() || null,
    askedFor: askedMatch?.[1]?.trim() || null,
    otherNotes: other.join('\n').trim(),
  };
}
