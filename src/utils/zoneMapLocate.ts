import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

/** Minimal zone shape the locator needs: an id, a name and its boundary. */
export type LocatableZone = Feature<Polygon | MultiPolygon, { id: number; name: string }>;

export type ZoneHit = {
  zoneId: number;
  name: string;
  /** Straight-line miles from the point to this zone's boundary. */
  edgeMiles: number;
  /** Closest point on that boundary, as [lat, lon]. */
  edgePoint: [number, number];
};

export type ZoneLocation = {
  /** Every zone containing the point, closest edge first. Zones may overlap. */
  inside: ZoneHit[];
  /** When the point is in no zone: the zone whose boundary is closest. */
  nearest: ZoneHit | null;
};

const EARTH_RADIUS_MILES = 3958.8;
const DEG = Math.PI / 180;

/**
 * Holes smaller than this are ignored. The zone boundaries came from KMZ
 * drawings, and cleaning them up left dozens of slivers inside each zone
 * (BR3 had 79, all under 0.002 sq mi). Without this, "distance to the edge"
 * measured to an invisible sliver instead of the zone's real boundary.
 */
export const MIN_HOLE_SQ_MILES = 0.1;

/** Area of a [lon, lat] ring in square miles (flat projection; fine at zone scale). */
export function ringAreaSqMiles(ring: Position[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][1];
  const kx = Math.cos(lat0 * DEG) * DEG * EARTH_RADIUS_MILES;
  const ky = DEG * EARTH_RADIUS_MILES;
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][0] * kx * (ring[i][1] * ky) - ring[i][0] * kx * (ring[j][1] * ky);
  }
  return Math.abs(twice) / 2;
}

/**
 * Polygons of a zone as lists of rings ([outer, ...holes]) in [lon, lat],
 * with sliver holes dropped.
 */
function polygonsOf(zone: LocatableZone): Position[][][] {
  const g = zone.geometry;
  if (!g) return [];
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polygons.map(([outer, ...holes]) => [
    outer,
    ...holes.filter((hole) => ringAreaSqMiles(hole) >= MIN_HOLE_SQ_MILES),
  ]);
}

/** Ray-casting test; coordinates are [lon, lat]. */
function ringContains(ring: Position[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function zoneContains(zone: LocatableZone, lat: number, lon: number): boolean {
  return polygonsOf(zone).some(
    ([outer, ...holes]) =>
      outer != null &&
      ringContains(outer, lon, lat) &&
      !holes.some((hole) => ringContains(hole, lon, lat))
  );
}

/**
 * Closest point on the zone's boundary (outer rings and holes).
 * Uses a flat projection centred on the point, which is accurate to well
 * under 1% at the tens-of-miles scale of a work zone.
 */
export function nearestBoundaryPoint(
  zone: LocatableZone,
  lat: number,
  lon: number
): { miles: number; point: [number, number] } | null {
  const kx = Math.cos(lat * DEG) * DEG * EARTH_RADIUS_MILES; // miles per degree lon
  const ky = DEG * EARTH_RADIUS_MILES; // miles per degree lat

  let best: { miles: number; point: [number, number] } | null = null;
  for (const rings of polygonsOf(zone)) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        // Segment endpoints in miles, relative to the point.
        const ax = (ring[i - 1][0] - lon) * kx;
        const ay = (ring[i - 1][1] - lat) * ky;
        const bx = (ring[i][0] - lon) * kx;
        const by = (ring[i][1] - lat) * ky;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        const px = ax + t * dx;
        const py = ay + t * dy;
        const miles = Math.hypot(px, py);
        if (!best || miles < best.miles) {
          best = { miles, point: [lat + py / ky, lon + px / kx] };
        }
      }
    }
  }
  return best;
}

/** Which zones contain the point, or which zone is closest when none does. */
export function locateInZones(zones: LocatableZone[], lat: number, lon: number): ZoneLocation {
  const inside: ZoneHit[] = [];
  let nearest: ZoneHit | null = null;

  for (const zone of zones) {
    const edge = nearestBoundaryPoint(zone, lat, lon);
    if (!edge) continue;
    const hit: ZoneHit = {
      zoneId: zone.properties.id,
      name: zone.properties.name,
      edgeMiles: edge.miles,
      edgePoint: edge.point,
    };
    if (zoneContains(zone, lat, lon)) inside.push(hit);
    else if (!nearest || hit.edgeMiles < nearest.edgeMiles) nearest = hit;
  }

  inside.sort((a, b) => a.edgeMiles - b.edgeMiles);
  return { inside, nearest: inside.length > 0 ? null : nearest };
}

/** "0.3 mi", "2.4 mi", "18 mi". */
export function formatMiles(miles: number): string {
  if (miles < 0.1) return 'under 0.1 mi';
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}
