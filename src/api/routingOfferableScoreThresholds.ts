// Practice-wide routing offerable score thresholds (by day proximity + appointment type).
// Admin writes via practice settings; the appointment form reads the public endpoint.
import { http } from './http';
import {
  getPracticeSettings,
  updatePracticeSettings,
} from './practiceSettings';
import {
  ROUTING_OFFERABLE_SCORE_THRESHOLDS_KEY,
  defaultRoutingOfferableScoreConfig,
  parseRoutingOfferableScoreConfig,
  serializeRoutingOfferableScoreConfig,
  type RoutingOfferableScoreConfig,
} from '../utils/routingOfferableScoreConfig';

export {
  ROUTING_OFFERABLE_SCORE_THRESHOLDS_KEY,
  defaultRoutingOfferableScoreConfig,
  parseRoutingOfferableScoreConfig,
  type RoutingOfferableScoreConfig,
};

/** Authenticated admin load (practice settings). */
export async function fetchRoutingOfferableScoreThresholds(
  practiceId: number,
): Promise<RoutingOfferableScoreConfig> {
  const settings = await getPracticeSettings(practiceId);
  return parseRoutingOfferableScoreConfig(
    settings[ROUTING_OFFERABLE_SCORE_THRESHOLDS_KEY as keyof typeof settings],
  );
}

/** Public read for the appointment request form (no admin auth required). */
export async function fetchPublicRoutingOfferableScoreThresholds(
  practiceId: number,
): Promise<RoutingOfferableScoreConfig> {
  const { data } = await http.get(
    '/public/appointments/routing-score-thresholds',
    { params: { practiceId } },
  );
  return parseRoutingOfferableScoreConfig(data);
}

export async function saveRoutingOfferableScoreThresholds(
  practiceId: number,
  config: RoutingOfferableScoreConfig,
): Promise<RoutingOfferableScoreConfig> {
  const payload = {
    [ROUTING_OFFERABLE_SCORE_THRESHOLDS_KEY]:
      serializeRoutingOfferableScoreConfig(config),
  } as const;
  const updated = await updatePracticeSettings(practiceId, payload);
  return parseRoutingOfferableScoreConfig(
    updated[ROUTING_OFFERABLE_SCORE_THRESHOLDS_KEY as keyof typeof updated],
  );
}
