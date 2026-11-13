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

export type ZoneMapDoctorZone = {
  zoneId: number;
  name: string;
  isPrimary: boolean;
  acceptingNewPatients: boolean;
  transitioningOutOfZone: boolean;
};

export type ZoneMapDoctor = {
  employeeId: number;
  name: string;
  title: string | null;
  /** Set only when the primary zone is one of `zones`. */
  primaryZoneId: number | null;
  /** Primary zone first, then backups by name. */
  zones: ZoneMapDoctorZone[];
};

/**
 * Active zone boundaries as GeoJSON, for the Work Zones map.
 * GET /zones/map
 */
export async function fetchZonesMap(): Promise<ZoneMapFeatureCollection> {
  const { data } = await http.get('/zones/map');
  return data as ZoneMapFeatureCollection;
}

/**
 * Active doctors with their zones and primary zone, for the Work Zones map.
 * GET /zones/map/doctors
 */
export async function fetchZonesMapDoctors(): Promise<ZoneMapDoctor[]> {
  const { data } = await http.get('/zones/map/doctors');
  return Array.isArray(data) ? (data as ZoneMapDoctor[]) : [];
}
