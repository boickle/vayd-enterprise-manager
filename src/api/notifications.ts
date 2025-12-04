// src/api/notifications.ts
import { http } from './http';

export type OverdueReminderClient = {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone1: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zipcode: string;
  fullAddress: string;
};

export type OverdueReminderProvider = {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  pimsId: string;
};

export type OverdueReminderReminder = {
  reminderId: number;
  description: string;
  dueDate: string;
  patient: {
    id: number;
    name: string;
  };
};

export type OverdueReminderTimeSlot = {
  date: string;
  time: string;
  doctorName: string;
  doctorId: number;
};

export type OverdueReminderItem = {
  client: OverdueReminderClient;
  primaryProvider: OverdueReminderProvider;
  receptionistEmail: string | null;
  reminders: OverdueReminderReminder[];
  timeSlots: OverdueReminderTimeSlot[];
};

export type OverdueRemindersResponse = {
  success: boolean;
  count: number;
  data: OverdueReminderItem[];
};

export async function fetchOverdueReminders(): Promise<OverdueRemindersResponse> {
  const { data } = await http.get<OverdueRemindersResponse>('/notifications/overdue-reminders');
  return data;
}

