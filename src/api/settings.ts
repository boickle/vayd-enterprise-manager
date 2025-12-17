import { http } from './http';

export type ReminderSettings = {
  appointmentRemindersEnabled?: boolean;
  serviceRemindersEnabled?: boolean;
  appointmentReminders?: {
    emailEnabled?: boolean;
    smsEnabled?: boolean;
    email?: number[]; // cadences in hours/days
    sms?: number[]; // cadences in hours/days
  };
  serviceReminders?: {
    emailEnabled?: boolean;
    smsEnabled?: boolean;
  };
};

export type PracticeSettings = {
  reminders?: ReminderSettings;
};

export async function fetchPracticeSettings(practiceId: string | number = 1): Promise<PracticeSettings> {
  const { data } = await http.get(`/practice/${practiceId}/settings`);
  return data || {};
}

export async function updatePracticeSettings(
  practiceId: string | number = 1,
  settings: Partial<PracticeSettings>
): Promise<PracticeSettings> {
  const { data } = await http.patch(`/practice/${practiceId}/settings`, settings);
  return data || {};
}

