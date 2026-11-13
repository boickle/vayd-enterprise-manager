import { describe, expect, it } from 'vitest';
import type { Position } from 'geojson';
import {
  formatMiles,
  googleMapsUrl,
  locateInZones,
  nearestBoundaryPoint,
  zoneContains,
  type LocatableZone,
} from './zoneMapLocate';

/** Axis-aligned box in [lon, lat], optionally with a box-shaped hole. */
function box(
  id: number,
  name: string,
  [w, s, e, n]: [number, number, number, number],
  hole?: [number, number, number, number]
): LocatableZone {
  const ring = (b: [number, number, number, number]): Position[] => [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
    [b[0], b[1]],
  ];
  return {
    type: 'Feature',
    properties: { id, name },
    geometry: {
      type: 'Polygon',
      coordinates: hole ? [ring([w, s, e, n]), ring(hole)] : [ring([w, s, e, n])],
    },
  };
}

// One degree of latitude is ~69.1 miles.
const MILES_PER_DEG_LAT = 69.09;

describe('zoneContains', () => {
  const zone = box(1, 'A', [-71, 44, -70, 45]);

  it('is true inside and false outside', () => {
    expect(zoneContains(zone, 44.5, -70.5)).toBe(true);
    expect(zoneContains(zone, 45.5, -70.5)).toBe(false);
    expect(zoneContains(zone, 44.5, -69.5)).toBe(false);
  });

  it('treats a hole as outside', () => {
    const donut = box(2, 'Donut', [-71, 44, -70, 45], [-70.6, 44.4, -70.4, 44.6]);
    expect(zoneContains(donut, 44.5, -70.5)).toBe(false);
    expect(zoneContains(donut, 44.2, -70.5)).toBe(true);
  });

  it('handles MultiPolygon zones', () => {
    const multi: LocatableZone = {
      type: 'Feature',
      properties: { id: 3, name: 'Islands' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          box(0, '', [-71, 44, -70.8, 44.2]).geometry.coordinates as Position[][],
          box(0, '', [-70.2, 44, -70, 44.2]).geometry.coordinates as Position[][],
        ],
      },
    };
    expect(zoneContains(multi, 44.1, -70.1)).toBe(true);
    expect(zoneContains(multi, 44.1, -70.5)).toBe(false);
  });
});

describe('nearestBoundaryPoint', () => {
  it('measures straight-line miles to the closest edge', () => {
    const zone = box(1, 'A', [-71, 44, -70, 45]);
    // 0.1° south of the southern edge, mid-way along it.
    const r = nearestBoundaryPoint(zone, 43.9, -70.5)!;
    expect(r.miles).toBeCloseTo(0.1 * MILES_PER_DEG_LAT, 1);
    expect(r.point[0]).toBeCloseTo(44, 6);
    expect(r.point[1]).toBeCloseTo(-70.5, 6);
  });

  it('snaps to a corner when the point is diagonally outside', () => {
    const zone = box(1, 'A', [-71, 44, -70, 45]);
    const r = nearestBoundaryPoint(zone, 45.1, -69.9)!;
    expect(r.point[0]).toBeCloseTo(45, 6);
    expect(r.point[1]).toBeCloseTo(-70, 6);
  });
});

describe('locateInZones', () => {
  const north = box(1, 'North', [-71, 44.5, -70, 45]);
  const south = box(2, 'South', [-71, 44, -70, 44.6]); // overlaps North by 0.1°
  const far = box(3, 'Far', [-68, 44, -67, 45]);

  it('lists every zone containing the point, closest edge first', () => {
    const r = locateInZones([north, south, far], 44.58, -70.5);
    expect(r.inside.map((z) => z.name)).toEqual(['South', 'North']);
    expect(r.nearest).toBeNull();
  });

  it('reports the nearest zone when the point is in none', () => {
    const r = locateInZones([north, south, far], 44.5, -69.5);
    expect(r.inside).toEqual([]);
    expect(r.nearest?.name).toBe('North');
    expect(r.nearest!.edgeMiles).toBeGreaterThan(20);
    expect(r.nearest!.edgeMiles).toBeLessThan(30);
  });

  it('returns nothing for an empty zone list', () => {
    expect(locateInZones([], 44, -70)).toEqual({ inside: [], nearest: null });
  });
});

describe('formatMiles', () => {
  it('rounds for reading over the phone', () => {
    expect(formatMiles(0.04)).toBe('under 0.1 mi');
    expect(formatMiles(2.36)).toBe('2.4 mi');
    expect(formatMiles(18.4)).toBe('18 mi');
  });
});

describe('googleMapsUrl', () => {
  it('builds a search link for the point', () => {
    expect(googleMapsUrl(44.1, -70.2)).toBe(
      'https://www.google.com/maps/search/?api=1&query=44.100000,-70.200000'
    );
  });
});
