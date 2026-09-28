/**
 * Smoke: day Google Maps links prefer stored lat/lon over address text.
 * Thread: #bugs-scout 1790022636.564449 (Dakota Vlachos address / Maps vs Scout).
 *
 * Mirrors src/utils/maps.ts toLocationString + buildGoogleMapsLinksForDay origin/waypoints.
 *
 * Run: node scripts/mapsPreferCoordsSmoke.mjs
 */

function hasRoutableCoords(s) {
  return (
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lon) &&
    Math.abs(s.lat) > 1e-6 &&
    Math.abs(s.lon) > 1e-6
  );
}

function toLocationString(s) {
  if (hasRoutableCoords(s)) {
    return `${s.lat},${s.lon}`;
  }
  if (s.address && s.address.trim()) {
    return s.address.trim();
  }
  return `${s.lat},${s.lon}`;
}

function buildGoogleMapsLinksForDay(stops, opts) {
  const links = [];
  const hasStart = !!opts?.start;
  const hasEnd = !!opts?.end;
  const maxPerLink = hasStart && hasEnd ? 23 : hasStart || hasEnd ? 24 : 25;

  for (let i = 0; i < stops.length; i += maxPerLink) {
    const chunk = stops.slice(i, i + maxPerLink);
    const origin = hasStart && i === 0 ? opts.start : chunk[0];
    const destination =
      hasEnd && i + maxPerLink >= stops.length ? opts.end : chunk[chunk.length - 1];
    const waypoints = chunk
      .filter((p) => p !== origin && p !== destination)
      .map(toLocationString)
      .join('|');
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Unmappable address text + valid stored geocode → Maps must use coords (Scout routing).
const dakota = {
  lat: 43.6615,
  lon: -70.2553,
  address: 'Definitely Not A Real Street That Google Maps Cannot Find, Nowhere, ME 00000',
};
assert(toLocationString(dakota) === '43.6615,-70.2553', 'prefer lat/lon when coords present');

// Missing / zero coords → fall back to address text.
assert(
  toLocationString({ lat: 0, lon: 0, address: '151 Marlborough Rd, Portland, ME 04103' }) ===
    '151 Marlborough Rd, Portland, ME 04103',
  'address fallback when coords are 0,0'
);
assert(
  toLocationString({
    lat: Number.NaN,
    lon: Number.NaN,
    address: '  12 Oak St, Portland, ME  ',
  }) === '12 Oak St, Portland, ME',
  'address fallback when coords are NaN'
);

// Day route URL: waypoint must be lat,lon — not the bad address string.
const links = buildGoogleMapsLinksForDay(
  [
    { lat: 43.7, lon: -70.3, address: 'Start Client Bad Address XYZ' },
    dakota,
    { lat: 43.65, lon: -70.25, address: 'End Client Bad Address XYZ' },
  ],
  {
    start: { lat: 43.75, lon: -70.35 },
    end: { lat: 43.6, lon: -70.2 },
  }
);
assert(links.length === 1, 'one day link');
const url = links[0];
assert(url.includes(encodeURIComponent('43.6615,-70.2553')), 'Dakota waypoint uses coords');
assert(!url.includes('Definitely'), 'unmappable address text must not appear in Maps URL');
assert(url.includes(encodeURIComponent('43.75,-70.35')), 'depot origin uses coords');

console.log('mapsPreferCoordsSmoke: ok');
