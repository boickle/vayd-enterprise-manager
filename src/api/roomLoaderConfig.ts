// src/api/roomLoaderConfig.ts
// Loads and saves the practice-scoped configuration for the client Room Loader form.
// Staff edit this under Settings -> Room Loader; the public form receives the same shape
// on `GET /public/room-loader/form` so no catalog codes are hardcoded in the UI.
import { http } from './http';
import {
  normalizeRoomLoaderConfig,
  ROOM_LOADER_CONFIG_VERSION,
  type RoomLoaderConfig,
} from '../utils/roomLoaderConfigTypes';
import {
  resolveRoomLoaderConfig,
  roomLoaderConfigIsUnconfigured,
  vaydRoomLoaderConfigSeed,
} from '../utils/roomLoaderConfigSeed';

export * from '../utils/roomLoaderConfigTypes';
export {
  resolveRoomLoaderConfig,
  roomLoaderConfigIsUnconfigured,
  vaydDeclineReasons,
  vaydItemQuestions,
  vaydRoomLoaderConfigSeed,
  vaydSampleInstructions,
  vaydVaccineGatedOffers,
} from '../utils/roomLoaderConfigSeed';

/** GET /room-loader/config — practice resolved from the caller's token. */
export async function getRoomLoaderConfig(): Promise<RoomLoaderConfig> {
  const { data } = await http.get<{ config: unknown }>('/room-loader/config');
  return resolveRoomLoaderConfig(data?.config);
}

/**
 * When this practice has never saved Room Loader settings, write the VAYD starter
 * document so QA and production keep the same panels after deploy.
 */
export async function ensureRoomLoaderConfigSeeded(): Promise<RoomLoaderConfig> {
  const { data } = await http.get<{ config: unknown }>('/room-loader/config');
  if (!roomLoaderConfigIsUnconfigured(normalizeRoomLoaderConfig(data?.config))) {
    return resolveRoomLoaderConfig(data?.config);
  }
  return saveRoomLoaderConfig(vaydRoomLoaderConfigSeed());
}

/** PUT /room-loader/config — replaces the whole document. */
export async function saveRoomLoaderConfig(config: RoomLoaderConfig): Promise<RoomLoaderConfig> {
  const { data } = await http.put<{ config: unknown }>('/room-loader/config', {
    config: { ...config, version: ROOM_LOADER_CONFIG_VERSION },
  });
  return normalizeRoomLoaderConfig(data?.config);
}
