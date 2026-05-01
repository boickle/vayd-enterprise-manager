// src/utils/maps.ts
export type Stop = { lat: number; lon: number; label?: string; address?: string };

function toLocationString(s: Stop): string {
  // Prefer address if available, otherwise fall back to lat/lon
  if (s.address && s.address.trim()) {
    return s.address.trim();
  }
  return `${s.lat},${s.lon}`;
}

/** ~1m grid so slightly different geocodes for the same stop still dedupe together. */
function roundedCoordPair(lat: number, lon: number, decimals: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const m = 10 ** decimals;
  const rl = Math.round(lat * m) / m;
  const rn = Math.round(lon * m) / m;
  return `${rl},${rn}`;
}

/**
 * One comparable key for "same mailing address" despite Rd vs Road, etc.
 * Avoids short tokens that collide with state (CT), titles (Dr), or city names (St. …).
 * Used only for deduping map URLs, not for display.
 */
function canonicalAddressKey(raw: string): string {
  let s = raw
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Longer / compound forms first. Prefer full words; only use abbreviations that rarely collide.
  const replacements: [RegExp, string][] = [
    [/\bparkway\b/g, ' pkwy '],
    [/\bpkwy\b/g, ' pkwy '],
    [/\bhighway\b/g, ' hwy '],
    [/\bhwy\b/g, ' hwy '],
    [/\bfreeway\b/g, ' fwy '],
    [/\bfwy\b/g, ' fwy '],
    [/\bturnpike\b/g, ' tpke '],
    [/\btpke\b/g, ' tpke '],
    [/\bexpressway\b/g, ' expy '],
    [/\bexpy\b/g, ' expy '],
    [/\bmountain\b/g, ' mtn '],
    [/\bmtn\b/g, ' mtn '],
    [/\bterrace\b/g, ' ter '],
    [/\bter\b/g, ' ter '],
    [/\bboulevard\b/g, ' blvd '],
    [/\bblvd\b/g, ' blvd '],
    [/\bavenue\b/g, ' ave '],
    [/\bave\b/g, ' ave '],
    [/\bstreet\b/g, ' st '],
    [/\broad\b/g, ' rd '],
    [/\brd\b/g, ' rd '],
    [/\bdrive\b/g, ' dr '],
    [/\blane\b/g, ' ln '],
    [/\bln\b/g, ' ln '],
    [/\bcircle\b/g, ' cir '],
    [/\bcir\b/g, ' cir '],
    [/\bplace\b/g, ' pl '],
    [/\btrail\b/g, ' trl '],
    [/\btrl\b/g, ' trl '],
    [/\broute\b/g, ' rte '],
    [/\brte\b/g, ' rte '],
    [/\bcrescent\b/g, ' cres '],
    [/\bcres\b/g, ' cres '],
    [/\bgardens\b/g, ' gdns '],
    [/\bgdns\b/g, ' gdns '],
    [/\bpoint\b/g, ' pt '],
    [/\bcommons\b/g, ' cmns '],
    [/\bcmns\b/g, ' cmns '],
  ];

  for (const [re, rep] of replacements) {
    s = s.replace(re, rep);
  }

  return s.replace(/\s+/g, ' ').trim();
}

/** Drop duplicate map stops: same rounded coords and/or same canonical address. */
function dedupeStopsForMapsUrl(stops: Stop[]): Stop[] {
  const seen = new Set<string>();
  const out: Stop[] = [];
  for (const s of stops) {
    const tags: string[] = [];
    const pair = roundedCoordPair(Number(s.lat), Number(s.lon), 5);
    if (pair) tags.push(`c:${pair}`);
    const addrRaw = s.address?.trim();
    if (addrRaw) tags.push(`a:${canonicalAddressKey(addrRaw)}`);
    if (tags.length === 0) tags.push(`f:${toLocationString(s)}`);

    if (tags.some((t) => seen.has(t))) continue;
    for (const t of tags) seen.add(t);
    out.push(s);
  }
  return out;
}

function waypointSegmentDedupeKey(segment: string): string {
  const compact = segment.replace(/\s/g, '');
  const coordMatch = /^(-?\d+\.?\d*),(-?\d+\.?\d*)$/.exec(compact);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    const pair = roundedCoordPair(lat, lon, 5);
    if (pair) return `c:${pair}`;
  }
  return `a:${canonicalAddressKey(segment)}`;
}

function dedupePipeWaypoints(waypoints: string): string {
  if (!waypoints) return '';
  const parts = waypoints.split('|');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const k = waypointSegmentDedupeKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join('|');
}

/** Build 1..N Google Maps links. If start/end provided, use them as origin/destination. */
export function buildGoogleMapsLinksForDay(
  stops: Stop[],
  opts?: { start?: Stop | null; end?: Stop | null }
): string[] {
  const inner = dedupeStopsForMapsUrl(stops);
  const links: string[] = [];

  // Each link can include origin + destination + waypoints <= 25 points
  // So max waypoints per link = 23 (when both origin and destination present).
  const hasStart = !!opts?.start;
  const hasEnd = !!opts?.end;
  const maxPerLink = hasStart && hasEnd ? 23 : hasStart || hasEnd ? 24 : 25;

  for (let i = 0; i < inner.length; i += maxPerLink) {
    const chunk = inner.slice(i, i + maxPerLink);

    const origin = hasStart && i === 0 ? opts!.start! : chunk[0];
    const destination =
      hasEnd && i + maxPerLink >= inner.length ? opts!.end! : chunk[chunk.length - 1];

    const waypointsRaw = chunk
      .filter((p) => p !== origin && p !== destination)
      .map(toLocationString)
      .join('|');
    const waypoints = dedupePipeWaypoints(waypointsRaw);

    const params = new URLSearchParams();
    params.set('api', '1');
    params.set('origin', toLocationString(origin));
    params.set('destination', toLocationString(destination));
    if (waypoints) params.set('waypoints', waypoints);
    params.set('travelmode', 'driving');

    links.push(`https://www.google.com/maps/dir/?${params.toString()}`);
  }

  return links;
}
