import { http } from './http';
import {
  getPracticeSettings,
  updatePracticeSettings,
} from './practiceSettings';
import {
  ONLINE_BOOKING_AUTO_BOOK_SETTINGS_KEY,
  defaultOnlineBookingAutoBookSettings,
  parseOnlineBookingAutoBookSettings,
  serializeOnlineBookingAutoBookSettings,
  type OnlineBookingAutoBookSettings,
} from '../utils/onlineBookingAutoBookSettings';

export {
  ONLINE_BOOKING_AUTO_BOOK_SETTINGS_KEY,
  defaultOnlineBookingAutoBookSettings,
  parseOnlineBookingAutoBookSettings,
  type OnlineBookingAutoBookSettings,
};

/** Authenticated admin load (practice settings). */
export async function fetchOnlineBookingAutoBookSettings(
  practiceId: number,
): Promise<OnlineBookingAutoBookSettings> {
  const settings = await getPracticeSettings(practiceId);
  return parseOnlineBookingAutoBookSettings(
    settings[ONLINE_BOOKING_AUTO_BOOK_SETTINGS_KEY as keyof typeof settings],
  );
}

/** Public read for the appointment request form. */
export async function fetchPublicOnlineBookingAutoBookSettings(
  practiceId: number,
): Promise<OnlineBookingAutoBookSettings> {
  const { data } = await http.get('/public/appointments/online-booking-settings', {
    params: { practiceId },
  });
  return parseOnlineBookingAutoBookSettings(data);
}

export async function saveOnlineBookingAutoBookSettings(
  practiceId: number,
  config: OnlineBookingAutoBookSettings,
): Promise<OnlineBookingAutoBookSettings> {
  const payload = {
    [ONLINE_BOOKING_AUTO_BOOK_SETTINGS_KEY]:
      serializeOnlineBookingAutoBookSettings(config),
  } as const;
  const updated = await updatePracticeSettings(practiceId, payload);
  return parseOnlineBookingAutoBookSettings(
    updated[ONLINE_BOOKING_AUTO_BOOK_SETTINGS_KEY as keyof typeof updated],
  );
}
