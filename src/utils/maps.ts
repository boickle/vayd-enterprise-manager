// src/utils/maps.ts
export type Stop = { lat: number; lon: number; label?: string };

function toLatLng(s: Stop) {
  return `${s.lat},${s.lon}`;
}

/** Build 1..N Google Maps links. If start/end provided, use them as origin/destination. */
export function buildGoogleMapsLinksForDay(
  stops: Stop[],
  opts?: { start?: Stop | null; end?: Stop | null }
): string[] {
  const inner = [...stops]; // waypoints
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

    const waypoints = chunk
      .filter((p) => p !== origin && p !== destination)
      .map(toLatLng)
      .join('|');

    const params = new URLSearchParams();
    params.set('api', '1');
    params.set('origin', toLatLng(origin));
    params.set('destination', toLatLng(destination));
    if (waypoints) params.set('waypoints', waypoints);
    params.set('travelmode', 'driving');

    links.push(`https://www.google.com/maps/dir/?${params.toString()}`);
  }

  return links;
}
