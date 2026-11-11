// src/api/zones.ts
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { http } from './http';

export type ZoneMapProperties = {
  id: number;
  name: string;
  description: string;
  /** A point inside the zone, for placing its name. */
  labelLat: number;
  labelLon: number;
};

export type ZoneMapFeatureCollection = FeatureCollection<Polygon | MultiPolygon, ZoneMapProperties>;

/**
 * Active zone boundaries as GeoJSON, for the Work Zones map.
 * GET /zones/map
 */
export async function fetchZonesMap(): Promise<ZoneMapFeatureCollection> {
  const { data } = await http.get('/zones/map');
  return data as ZoneMapFeatureCollection;
}
