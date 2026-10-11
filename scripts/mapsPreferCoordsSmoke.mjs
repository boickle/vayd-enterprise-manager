/**
 * Smoke: day Google Maps links prefer the street address over lat/lon.
 * Coordinates are the fallback when the address is missing or the
 * "Address not available" placeholder. A lat/lon pin is reverse-geocoded
 * by Google to the nearest house.
 *
 * Mirrors src/utils/maps.ts toLocationString + buildGoogleMapsLinksForDay.
 *
 * Run: node scripts/mapsPreferCoordsSmoke.mjs
 */

function toLocationString(s) {
  const address = s.address?.trim() ?? '';
  if (address && !/^address not available$/i.test(address)) return address;
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

const lincoln = {
  lat: 43.66,
  lon: -70.25,
  address: '72 Lincoln St, Portland, ME 04101',
};
assert(
  toLocationString(lincoln) === '72 Lincoln St, Portland, ME 04101',
  'prefer street address when coords are also present'
);

assert(
  toLocationString({ lat: 43.6615, lon: -70.2553, address: 'Address not available' }) ===
    '43.6615,-70.2553',
  'placeholder address falls back to coords'
);
assert(
  toLocationString({ lat: 43.6615, lon: -70.2553 }) === '43.6615,-70.2553',
  'missing address falls back to coords'
);
assert(
  toLocationString({ lat: 0, lon: 0, address: '151 Marlborough Rd, Portland, ME 04103' }) ===
    '151 Marlborough Rd, Portland, ME 04103',
  'address used when coords are 0,0'
);
assert(
  toLocationString({
    lat: Number.NaN,
    lon: Number.NaN,
    address: '  12 Oak St, Portland, ME  ',
  }) === '12 Oak St, Portland, ME',
  'trimmed address used when coords are NaN'
);

const links = buildGoogleMapsLinksForDay(
  [
    { lat: 43.7, lon: -70.3, address: '12 Oak St, Portland, ME 04101' },
    lincoln,
    { lat: 43.65, lon: -70.25, address: '440 Hallhollowell Rd, Augusta, ME 04330' },
  ],
  {
    start: { lat: 43.75, lon: -70.35, address: '657 Old Portland Rd, Brunswick, ME 04011' },
    end: { lat: 43.6, lon: -70.2 },
  }
);
assert(links.length === 1, 'one day link');
const url = links[0];
assert(url.includes('72+Lincoln+St'), 'waypoint uses street address');
assert(!url.includes('43.66'), 'waypoint must not use lat/lon when a street address is present');
assert(url.includes('657+Old+Portland+Rd'), 'depot origin uses address');
assert(url.includes(encodeURIComponent('43.6,-70.2')), 'depot end without an address uses coords');

console.log('mapsPreferCoordsSmoke: ok');
