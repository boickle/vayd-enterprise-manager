// src/api/practiceSettings.ts
// Practice reminder settings – GET/PUT /practice/:practiceId/settings
// Cadence keys use JSON array of CadenceEntry; other keys use strings.
import { http } from './http';

export interface CadenceEntry {
  days: number;
  channels: ('email' | 'sms')[];
  smsFallback?: 'email' | 'none';
}

/** Practice setting: company has an online store (price target next to branches). */
export const ONLINE_STORE_IMPLEMENTED_KEY = 'inventory.onlineStoreImplemented' as const;
/** Branch that fulfills online store orders (stock draws). */
export const ONLINE_STORE_FULFILLMENT_BRANCH_KEY =
  'inventory.onlineStoreFulfillmentBranchId' as const;
/** Inventory location within that branch for online store fulfillment. */
export const ONLINE_STORE_FULFILLMENT_LOCATION_KEY =
  'inventory.onlineStoreFulfillmentLocationId' as const;
/** Quo / OpenPhone line used for pharmacy RX texts on mail orders. */
export const MAIL_ORDER_RX_LINE_PHONE_KEY = 'inventory.mailOrderRxLinePhone' as const;
/** When true, refill charges are excluded from provider VSD unless the item overrides. */
export const EXCLUDE_PRODUCTION_WHEN_REFILLING_KEY =
  'inventory.excludeProductionWhenRefilling' as const;
/**
 * When true, membership plan fee invoice lines are attributed to a provider’s VSD.
 * When false/unset, the fee has no provider and lands in Not Specified.
 */
export const MEMBERSHIP_ASSIGN_FEE_TO_PROVIDER_KEY =
  'membership.assignFeeToProvider' as const;
/** Calendar hours after payment during which post-visit signup re-prices without override. */
export const MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_KEY =
  'membership.postVisitSignupWindowHours' as const;
export const MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_DEFAULT = 24;

export type ReminderSettings = {
  'reminders.enableEmail'?: string;
  'reminders.enableSms'?: string;
  'reminders.appointmentCadence'?: CadenceEntry[];
  'reminders.healthCadence'?: CadenceEntry[];
  'reminders.appointmentWindowDays'?: string;
  'reminders.testRedirectEmail'?: string;
  'reminders.testRedirectPhone'?: string;
  /** Exclude reminders whose name contains any of these phrases (case-insensitive match is typical on the backend) */
  'reminders.excludedNamePhrases'?: string[];
  /** Exclude from SMS only: reminders whose name contains any of these phrases will not be sent via SMS (email still sent if enabled). */
  'reminders.smsExcludedNamePhrases'?: string[];
  /** Include only reminders whose type is in this list (reminder type names). Empty = no filter (include all). */
  'reminders.includedReminderTypes'?: string[];
  /** Weekly CL seat par targets: { phones, outreach, email }. */
  'cl.seatPar'?: { phones: number; outreach: number; email: number } | string;
  /**
   * Per-date CL seat overrides (day off / seat swap), stored as a JSON string
   * (practice settings non-cadence keys are strings).
   * Shape: [{ employeeId, date, seat: 'phones'|'outreach'|'email'|'off', notes? }]
   */
  'cl.seatDayOverrides'?: string;
  /**
   * Whether this practice runs an online store. `'true'` / `'false'`; unset = No (opt-in).
   * When Yes, Inventory pricing treats Online Store as a price target alongside branches.
   */
  'inventory.onlineStoreImplemented'?: string;
  /** Branch id (string) used when fulfilling online store orders. */
  'inventory.onlineStoreFulfillmentBranchId'?: string;
  /** Inventory location id (string) within the fulfillment branch. */
  'inventory.onlineStoreFulfillmentLocationId'?: string;
  /** Quo / OpenPhone phone for the pharmacy RX line (E.164 or 10-digit). */
  'inventory.mailOrderRxLinePhone'?: string;
  /** JSON array of mail-order shipping / pick-up types. */
  'inventory.mailShippingTypes'?: string;
  /** `'true'` / `'false'`; unset = No. Item-level override wins when set. */
  'inventory.excludeProductionWhenRefilling'?: string;
  /**
   * `'true'` / `'false'`; unset = No (Not Specified).
   * When Yes, membership plan fees on invoices are assigned to a provider’s VSD.
   */
  'membership.assignFeeToProvider'?: string;
  /**
   * Calendar hours after invoice payment for post-visit membership signup
   * without an audited override. Unset = 24.
   */
  'membership.postVisitSignupWindowHours'?: string;
  /**
   * Practice daily appointment bookings goals by day of week (JSON string).
   * Shape: { "0": 37, "1": 37, ... } where 0=Sunday … 6=Saturday.
   */
  'appointmentBookings.goalsByDayOfWeek'?: string;
  /**
   * Max routing scores for client-offered slots (JSON string).
   * Shape: { defaults: { sameDay, nextDay, withinWeek, later }, memberBonus, byAppointmentTypeId }.
   * See `routingOfferableScoreConfig.ts`.
   */
  'routing.offerableScoreThresholds'?: string;
  /** Letterhead on Rx / vaccination labels. Falls back to GET /practice/info when unset. */
  'labels.practiceName'?: string;
  'labels.practicePhone'?: string;
  'labels.practiceAddress'?: string;
  /** PNG/JPEG data URL printed on Rx labels. */
  'labels.practiceLogo'?: string;
  /** JSON map of employeeId → PNG data URL for provider signatures. */
  'labels.providerSignatures'?: string;
  /** JSON: { ink, clayCharge, clayFree } catalog item refs for euthanasia paw prints. */
  'euthanasia.pawPrintItems'?: string;
  /** JSON map of employeeId → { ink, clayCharge, clayFree } booleans. */
  'euthanasia.providerPawPrintOfferings'?: string;
  /** JSON map of ash-return choice keys → client-facing labels. */
  'euthanasia.ashReturnLabels'?: string;
  /** JSON: included urn + substitute urns for private cremation. */
  'euthanasia.privateCremationUrns'?: string;
  /** Default memorial-store subcategory on the consent form. */
  'euthanasia.memorialDefaultSubcategory'?: string;
  /**
   * Live chat / priority support hours by day (JSON string).
   * Shape: { sunday: { open, close } | null, monday: ..., ... }.
   * See `chatHours.ts`.
   */
  'chat.hoursOfOperation'?: string;
  /**
   * Online auto-book duration and lead-time settings (JSON string).
   * Shape: { singlePatientMinutes, multiPetPerPetMinutes, newClientLeadTimeHours, existingClientLeadTimeHours }.
   */
  'onlineBooking.autoBookSettings'?: string;
};

/** True only when the practice explicitly enabled an online store (default No). */
export function isOnlineStoreImplemented(
  settings: Pick<ReminderSettings, 'inventory.onlineStoreImplemented'> | null | undefined
): boolean {
  return settings?.[ONLINE_STORE_IMPLEMENTED_KEY] === 'true';
}

export function parseOnlineStoreFulfillmentBranchId(
  settings: Pick<ReminderSettings, 'inventory.onlineStoreFulfillmentBranchId'> | null | undefined
): number | null {
  const raw = settings?.[ONLINE_STORE_FULFILLMENT_BRANCH_KEY];
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseOnlineStoreFulfillmentLocationId(
  settings: Pick<ReminderSettings, 'inventory.onlineStoreFulfillmentLocationId'> | null | undefined
): number | null {
  const raw = settings?.[ONLINE_STORE_FULFILLMENT_LOCATION_KEY];
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseMailOrderRxLinePhone(
  settings: Pick<ReminderSettings, 'inventory.mailOrderRxLinePhone'> | null | undefined,
): string {
  return String(settings?.[MAIL_ORDER_RX_LINE_PHONE_KEY] || '').trim();
}

/** Default No — membership fees land in Not Specified VSD unless explicitly assigned. */
export function membershipAssignFeeToProvider(
  settings: Pick<ReminderSettings, 'membership.assignFeeToProvider'> | null | undefined,
): boolean {
  return settings?.[MEMBERSHIP_ASSIGN_FEE_TO_PROVIDER_KEY] === 'true';
}

/** Default 24 calendar hours. */
export function membershipPostVisitSignupWindowHours(
  settings: Pick<
    ReminderSettings,
    'membership.postVisitSignupWindowHours'
  > | null | undefined,
): number {
  const raw = settings?.[MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_KEY];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return MEMBERSHIP_POST_VISIT_SIGNUP_WINDOW_HOURS_DEFAULT;
  return Math.min(720, Math.round(n));
}

export type ReminderSettingsForm = {
  enableEmail: boolean;
  enableSms: boolean;
  appointmentWindowDays: number;
  appointmentCadence: CadenceEntry[];
  healthCadence: CadenceEntry[];
  testRedirectEmail: string;
  testRedirectPhone: string;
  excludedNamePhrases: string[];
  smsExcludedNamePhrases: string[];
  includedReminderTypes: string[];
};

const REMINDER_KEYS = {
  enableEmail: 'reminders.enableEmail',
  enableSms: 'reminders.enableSms',
  appointmentCadence: 'reminders.appointmentCadence',
  healthCadence: 'reminders.healthCadence',
  appointmentWindowDays: 'reminders.appointmentWindowDays',
  testRedirectEmail: 'reminders.testRedirectEmail',
  testRedirectPhone: 'reminders.testRedirectPhone',
  excludedNamePhrases: 'reminders.excludedNamePhrases',
  smsExcludedNamePhrases: 'reminders.smsExcludedNamePhrases',
  includedReminderTypes: 'reminders.includedReminderTypes',
} as const;

function ensureCadenceArray(
  value: CadenceEntry[] | string | undefined
): CadenceEntry[] {
  if (Array.isArray(value)) return value;
  return [];
}

function ensureStringArray(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.filter((s) => typeof s === 'string' && s.trim() !== '');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

/**
 * GET /practice/:practiceId/settings
 * Returns all practice settings. Cadence keys are JSON arrays; others are strings.
 */
export async function getPracticeSettings(practiceId: number): Promise<ReminderSettings> {
  const { data } = await http.get<ReminderSettings>(`/practice/${practiceId}/settings`);
  return data ?? {};
}

/**
 * PUT /practice/:practiceId/settings
 * Updates one or more settings. Cadence keys accept JSON arrays; others accept strings.
 * Returns the full settings map after the update.
 */
export async function updatePracticeSettings(
  practiceId: number,
  settings: ReminderSettings
): Promise<ReminderSettings> {
  const { data } = await http.put<ReminderSettings>(`/practice/${practiceId}/settings`, {
    settings,
  });
  return data ?? {};
}

/**
 * Map API response to form-friendly shape. Cadence keys come as arrays.
 */
export function settingsToForm(settings: ReminderSettings): ReminderSettingsForm {
  return {
    enableEmail: settings[REMINDER_KEYS.enableEmail] !== 'false',
    enableSms: settings[REMINDER_KEYS.enableSms] !== 'false',
    appointmentWindowDays: parseInt(
      settings[REMINDER_KEYS.appointmentWindowDays] ?? '30',
      10
    ),
    appointmentCadence: ensureCadenceArray(settings[REMINDER_KEYS.appointmentCadence]),
    healthCadence: ensureCadenceArray(settings[REMINDER_KEYS.healthCadence]),
    testRedirectEmail: settings[REMINDER_KEYS.testRedirectEmail] ?? '',
    testRedirectPhone: settings[REMINDER_KEYS.testRedirectPhone] ?? '',
    excludedNamePhrases: ensureStringArray(settings[REMINDER_KEYS.excludedNamePhrases]),
    smsExcludedNamePhrases: ensureStringArray(settings[REMINDER_KEYS.smsExcludedNamePhrases]),
    includedReminderTypes: ensureStringArray(settings[REMINDER_KEYS.includedReminderTypes]),
  };
}

/**
 * Map form values to API payload. Cadence keys are sent as arrays.
 */
export function formToSettings(form: ReminderSettingsForm): ReminderSettings {
  return {
    [REMINDER_KEYS.enableEmail]: form.enableEmail ? 'true' : 'false',
    [REMINDER_KEYS.enableSms]: form.enableSms ? 'true' : 'false',
    [REMINDER_KEYS.appointmentWindowDays]: String(form.appointmentWindowDays),
    [REMINDER_KEYS.appointmentCadence]: form.appointmentCadence,
    [REMINDER_KEYS.healthCadence]: form.healthCadence,
    [REMINDER_KEYS.testRedirectEmail]: form.testRedirectEmail || '',
    [REMINDER_KEYS.testRedirectPhone]: form.testRedirectPhone || '',
    [REMINDER_KEYS.excludedNamePhrases]: form.excludedNamePhrases.filter((s) => s.trim() !== ''),
    [REMINDER_KEYS.smsExcludedNamePhrases]: form.smsExcludedNamePhrases.filter((s) => s.trim() !== ''),
    // Scout sends every client reminder (not Callback / ToDo). Do not persist an eVet include-list.
    [REMINDER_KEYS.includedReminderTypes]: [],
  };
}
