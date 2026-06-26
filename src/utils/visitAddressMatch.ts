import type { Appointment } from '../api/roomLoader';
import { appointmentAlternateAddressText } from '../api/appointments';
import type { ClientSearchRow } from '../api/clientsStaff';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

const STREET_SUFFIX_TO_ABBREV: Record<string, string> = {
  alley: 'aly',
  aly: 'aly',
  avenue: 'ave',
  ave: 'ave',
  boulevard: 'blvd',
  blvd: 'blvd',
  circle: 'cir',
  cir: 'cir',
  court: 'ct',
  ct: 'ct',
  drive: 'dr',
  dr: 'dr',
  highway: 'hwy',
  hwy: 'hwy',
  lane: 'ln',
  ln: 'ln',
  parkway: 'pkwy',
  pkwy: 'pkwy',
  place: 'pl',
  pl: 'pl',
  road: 'rd',
  rd: 'rd',
  street: 'st',
  st: 'st',
  terrace: 'ter',
  ter: 'ter',
  trail: 'trl',
  trl: 'trl',
  way: 'way',
};

const US_STATE_ABBREVS = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'ia', 'id', 'il', 'in', 'ks', 'ky',
  'la', 'ma', 'md', 'me', 'mi', 'mn', 'mo', 'ms', 'mt', 'nc', 'nd', 'ne', 'nh', 'nj', 'nm', 'nv', 'ny',
  'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'va', 'vt', 'wa', 'wi', 'wv', 'wy',
]);

const ADDRESS_MATCH_STOP_TOKENS = new Set([
  ...US_STATE_ABBREVS,
  ...Object.keys(STREET_SUFFIX_TO_ABBREV),
  ...Object.values(STREET_SUFFIX_TO_ABBREV),
  'usa',
  'united',
  'states',
  'of',
  'america',
]);

function normalizeStreetToken(token: string): string {
  return STREET_SUFFIX_TO_ABBREV[token] ?? token;
}

/** Lowercase, collapse whitespace, strip trailing punctuation and country suffix noise. */
export function normalizeAddressForMatch(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw
    .toLowerCase()
    .replace(/\b(united states( of america)?|usa)\b/g, '')
    .replace(/[^\w\s#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  s = s
    .split(' ')
    .map((token) => normalizeStreetToken(token))
    .join(' ');
  return s || null;
}

export type VisitAddressMatchQuality = 'exact' | 'strong' | 'weak' | 'none';

export function clientAddressFromRecord(c: Record<string, unknown>): string | null {
  const formatted =
    pickStr(c.formattedAddress) ??
    pickStr(c.fullAddress) ??
    pickStr(c.address) ??
    pickStr(c.homeAddress);
  if (formatted) return formatted;

  const zip = pickStr(c.zip) ?? pickStr(c.zipcode);
  const parts = [
    pickStr(c.address1),
    pickStr(c.address2),
    [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', '),
    zip,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function clientSearchRowHomeAddress(c: ClientSearchRow): string | null {
  return clientAddressFromRecord(c as Record<string, unknown>);
}

export function visitAddressFromPlainRow(appt: Appointment): string | null {
  const o = appt as Record<string, unknown>;
  const zip = pickStr(o.zip) ?? pickStr(o.zipcode);
  const parts = [
    pickStr(o.address1),
    [pickStr(o.city), pickStr(o.state)].filter(Boolean).join(', '),
    zip,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function visitAddressForLinkMatching(appt: Appointment): string | null {
  return appointmentAlternateAddressText(appt) ?? visitAddressFromPlainRow(appt);
}

export function appointmentResolvedClientId(appt: Appointment): string | null {
  const fromClient = appt.client?.id;
  if (fromClient != null && String(fromClient).trim()) return String(fromClient).trim();
  const raw = (appt as { clientId?: unknown }).clientId;
  if (raw != null && String(raw).trim()) return String(raw).trim();
  return null;
}

function extractStreetNumber(normalized: string): string | null {
  const m = normalized.match(/\b(\d+[a-z]?)\b/);
  return m?.[1] ?? null;
}

function extractZip(normalized: string): string | null {
  const m = normalized.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m?.[1] ?? null;
}

function significantAddressTokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .filter((token) => token.length >= 4 && !ADDRESS_MATCH_STOP_TOKENS.has(token));
}

function sharedSignificantAddressTokens(a: string, b: string): boolean {
  const aTokens = new Set(significantAddressTokens(a));
  for (const token of significantAddressTokens(b)) {
    if (aTokens.has(token)) return true;
  }
  return false;
}

/** Search strings to fan out when `/clients/by-address` misses the right household. */
export function addressSearchQueriesFromVisit(visitAddress: string): string[] {
  const raw = visitAddress.trim();
  if (!raw) return [];

  const queries = new Set<string>();
  const commaParts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (commaParts[0]) queries.add(commaParts[0]);

  const norm = normalizeAddressForMatch(raw);
  if (!norm) return [...queries];

  const num = extractStreetNumber(norm);
  const zip = extractZip(norm);
  const tokens = norm.split(' ').filter(Boolean);
  const numIdx = num ? tokens.findIndex((token) => token === num) : -1;
  if (numIdx >= 0) {
    const afterNum = tokens.slice(numIdx + 1).filter((token) => !US_STATE_ABBREVS.has(token));
    if (afterNum.length >= 2) queries.add([num, ...afterNum.slice(0, 2)].join(' '));
    if (afterNum.length >= 1) queries.add([num, afterNum[0]].join(' '));
    if (afterNum.length >= 3) queries.add([num, ...afterNum.slice(0, 3)].join(' '));
  }
  if (num && zip) queries.add(`${num} ${zip}`);

  for (const token of significantAddressTokens(norm)) {
    if (zip) queries.add(`${token} ${zip}`);
  }

  return [...queries].filter((query) => query.trim().length >= 3);
}

/** Compare visit address to a client home address for link validation. */
export function compareVisitAddressToClientHome(
  visitAddress: string | null | undefined,
  clientHomeAddress: string | null | undefined
): VisitAddressMatchQuality {
  const visitNorm = normalizeAddressForMatch(visitAddress);
  const homeNorm = normalizeAddressForMatch(clientHomeAddress);
  if (!visitNorm || !homeNorm) return 'none';
  if (visitNorm === homeNorm) return 'exact';
  if (visitNorm.includes(homeNorm) || homeNorm.includes(visitNorm)) return 'strong';

  const visitNum = extractStreetNumber(visitNorm);
  const homeNum = extractStreetNumber(homeNorm);
  const visitZip = extractZip(visitNorm);
  const homeZip = extractZip(homeNorm);
  if (
    visitNum &&
    homeNum &&
    visitNum === homeNum &&
    visitZip &&
    homeZip &&
    visitZip === homeZip &&
    sharedSignificantAddressTokens(visitNorm, homeNorm)
  ) {
    return 'strong';
  }
  if (visitZip && homeZip && visitZip === homeZip) return 'weak';
  return 'none';
}

export function addressMatchAllowsLink(quality: VisitAddressMatchQuality): boolean {
  return quality === 'exact' || quality === 'strong';
}

/** Linking this client on save will clear the alternate routing address. */
export function editVisitLinkClearsAlternateAddress(
  appt: Appointment,
  linkSelection:
    | {
        clientId?: string | null;
        clientHomeAddress?: string | null;
        keepAlternateAddress?: boolean;
      }
    | null
    | undefined
): boolean {
  if (!linkSelection?.clientId?.trim() || linkSelection.keepAlternateAddress === true) return false;
  const visitAddress = visitAddressForLinkMatching(appt);
  if (!visitAddress?.trim()) return false;
  return addressMatchAllowsLink(
    compareVisitAddressToClientHome(visitAddress, linkSelection.clientHomeAddress)
  );
}

export function visitAddressMatchLabel(quality: VisitAddressMatchQuality): string | null {
  switch (quality) {
    case 'exact':
      return 'Address match';
    case 'strong':
      return 'Likely match';
    case 'weak':
      return 'Possible match';
    default:
      return null;
  }
}
