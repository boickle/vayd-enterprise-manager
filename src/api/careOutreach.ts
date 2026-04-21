// src/api/careOutreach.ts
import { http } from './http';

/** Client row as nested on patient (household) — shape aligns with reminder list payloads. */
export type CareOutreachClientRef = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  phone1?: string | null;
  isMember?: boolean;
};

export type CareOutreachPatientRef = {
  id: number;
  name?: string | null;
  isMember?: boolean;
  membershipName?: string | null;
  clients?: CareOutreachClientRef[];
  client?: CareOutreachClientRef | null;
};

export type CareOutreachEmployeeRef = {
  id?: number;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  designation?: string | null;
};

export type UnscheduledReminder = {
  id: number;
  description: string;
  dueDate?: string | null;
  /** Preferred field for CL outreach log (backend may use this or `notes`). */
  outreachNotes?: string | null;
  notes?: string | null;
  patient?: CareOutreachPatientRef | null;
  employee?: CareOutreachEmployeeRef | null;
  practice?: { id: number; name?: string };
};

export type FetchUnscheduledRemindersParams = {
  dueDateFrom?: string;
  dueDateTo?: string;
  practiceId?: number;
  limit?: number;
  /** ISO datetime — appointments with start >= asOf count as “future”; default server now. */
  asOf?: string;
};

/**
 * GET /reminders/unscheduled — reminders still needing a visit with the assigned provider
 * (excluded when patient already has a future non-canceled appointment with that provider).
 */
export async function fetchUnscheduledReminders(
  params: FetchUnscheduledRemindersParams
): Promise<UnscheduledReminder[]> {
  const { data } = await http.get<UnscheduledReminder[]>('/reminders/unscheduled', { params });
  return Array.isArray(data) ? data : [];
}

/**
 * Persist outreach notes on the reminder. Backend should accept partial updates on PATCH /reminders/:id.
 * Body field: `outreachNotes`. If your API differs, adjust here only.
 */
export async function patchReminderOutreachNotes(
  reminderId: number,
  outreachNotes: string
): Promise<UnscheduledReminder> {
  const { data } = await http.patch<UnscheduledReminder>(`/reminders/${reminderId}`, {
    outreachNotes,
  });
  return data;
}
