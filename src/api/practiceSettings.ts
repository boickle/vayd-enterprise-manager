// src/api/practiceSettings.ts
// Practice reminder settings – GET/PUT /practice/:practiceId/settings
// Cadence keys use JSON array of CadenceEntry; other keys use strings.
import { http } from './http';

export interface CadenceEntry {
  days: number;
  channels: ('email' | 'sms')[];
  smsFallback?: 'email' | 'none';
}

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
};

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
    [REMINDER_KEYS.includedReminderTypes]: form.includedReminderTypes.filter((s) => s.trim() !== ''),
  };
}
