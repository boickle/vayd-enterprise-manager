// src/api/geo.ts
import { http } from './http';

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const { data } = await http.get('/geo/reverse', { params: { lat, lon } });
  return data?.address ?? data?.formattedAddress ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
