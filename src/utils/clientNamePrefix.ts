export const CLIENT_NAME_PREFIX_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'Mr', label: 'Mr' },
  { value: 'Mrs', label: 'Mrs' },
  { value: 'Ms', label: 'Ms' },
  { value: 'Miss', label: 'Miss' },
  { value: 'Dr', label: 'Dr' },
  { value: 'Mx', label: 'Mx' },
  { value: 'Prof', label: 'Prof' },
];

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function personName(first: unknown, last: unknown): string {
  return [pickStr(first), pickStr(last)].filter(Boolean).join(' ');
}

const NAME_PREFIX_TOKEN = /^(mr|mrs|ms|miss|dr|mx|prof)\.?$/i;

/** First given name, skipping Dr. / Mr. / etc. on a display name. */
export function firstNameFromDisplayName(full: string | null | undefined): string {
  const parts = String(full ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  let i = 0;
  if (NAME_PREFIX_TOKEN.test(parts[0])) i += 1;
  while (i < parts.length && (parts[i] === '&' || /^and$/i.test(parts[i]))) i += 1;
  return parts[i] ?? '';
}

export function formatNamePrefix(prefix: unknown): string {
  const raw = pickStr(prefix);
  if (!raw) return '';
  return /[.]$/.test(raw) ? raw : `${raw}.`;
}

/** "Dr. Jane Smith" / "Jane Smith & Brian Oickle" */
export function formatClientDisplayName(c: {
  namePrefix?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  secondFirstName?: unknown;
  secondLastName?: unknown;
  id?: unknown;
}): string {
  const primary = personName(c.firstName, c.lastName);
  const prefixed = primary ? [formatNamePrefix(c.namePrefix), primary].filter(Boolean).join(' ') : '';
  const second = personName(c.secondFirstName, c.secondLastName);
  if (prefixed && second) return `${prefixed} & ${second}`;
  return prefixed || second || (c.id != null ? `Client #${String(c.id)}` : 'Client');
}
