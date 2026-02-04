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
};

export type ReminderSettingsForm = {
  enableEmail: boolean;
  enableSms: boolean;
  appointmentWindowDays: number;
  appointmentCadence: CadenceEntry[];
  healthCadence: CadenceEntry[];
  testRedirectEmail: string;
  testRedirectPhone: string;
};

const REMINDER_KEYS = {
  enableEmail: 'reminders.enableEmail',
  enableSms: 'reminders.enableSms',
  appointmentCadence: 'reminders.appointmentCadence',
  healthCadence: 'reminders.healthCadence',
  appointmentWindowDays: 'reminders.appointmentWindowDays',
  testRedirectEmail: 'reminders.testRedirectEmail',
  testRedirectPhone: 'reminders.testRedirectPhone',
} as const;

function ensureCadenceArray(
  value: CadenceEntry[] | string | undefined
): CadenceEntry[] {
  if (Array.isArray(value)) return value;
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
  };
}
