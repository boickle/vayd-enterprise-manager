import { http } from './http';
import axios from 'axios';

export type WaitlistStatus = 'waiting' | 'booked' | 'removed';
export type WaitlistPreferredWindow = 'asap' | 'week' | 'two_weeks' | 'month' | 'flexible';
export type WaitlistCreatedVia = 'staff' | 'online_booking';

export type WaitlistClientRef = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  phone1?: string | null;
  email?: string | null;
  alerts?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  lat?: number | null;
  lon?: number | null;
  pimsId?: string | null;
};

export type WaitlistPatientRef = {
  id: number;
  name: string | null;
  pimsId?: string | null;
};

export type WaitlistProviderRef = {
  id: number;
  pimsId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

export type WaitlistEmployeeRef = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

export type WaitlistEntry = {
  id: number;
  practiceId: number;
  status: WaitlistStatus;
  clientId: number;
  patientIds: number[];
  appointmentTypeId: number | null;
  appointmentTypeName: string | null;
  preferredProviderId: number | null;
  preferredWindow: WaitlistPreferredWindow;
  createdVia?: WaitlistCreatedVia | null;
  preferredStartDate: string | null;
  preferredEndDate: string | null;
  serviceMinutes: number | null;
  notes: string | null;
  lastContactedAt: string | null;
  bookedAppointmentId: number | null;
  bookedAppointmentStart: string | null;
  bookedAt: string | null;
  removedAt: string | null;
  removedReason: string | null;
  created: string;
  updated: string;
  client?: WaitlistClientRef | null;
  patients: WaitlistPatientRef[];
  preferredProvider?: WaitlistProviderRef | null;
  createdBy?: WaitlistEmployeeRef | null;
};

export type FetchWaitlistParams = {
  practiceId: number;
  status?: WaitlistStatus;
  limit?: number;
};

export type CreateWaitlistPayload = {
  practiceId: number;
  clientId: number;
  patientIds: number[];
  appointmentTypeId?: number;
  preferredProviderId?: number;
  preferredWindow?: WaitlistPreferredWindow;
  preferredStartDate?: string;
  preferredEndDate?: string;
  serviceMinutes?: number;
  notes?: string;
};

export type PatchWaitlistPayload = {
  practiceId: number;
  patientIds?: number[];
  appointmentTypeId?: number | null;
  preferredProviderId?: number | null;
  preferredWindow?: WaitlistPreferredWindow;
  preferredStartDate?: string | null;
  preferredEndDate?: string | null;
  serviceMinutes?: number | null;
  notes?: string | null;
  status?: WaitlistStatus;
  bookedAppointmentId?: number;
  removedReason?: string;
  touchLastContacted?: boolean;
};

function unwrapEntry(raw: unknown): WaitlistEntry {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (o.entry && typeof o.entry === 'object') return o.entry as WaitlistEntry;
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) {
      return o.data as WaitlistEntry;
    }
  }
  return raw as WaitlistEntry;
}

export async function fetchWaitlist(params: FetchWaitlistParams): Promise<WaitlistEntry[]> {
  const { data } = await http.get<{ items?: WaitlistEntry[] } | WaitlistEntry[]>('/waitlist', {
    params,
  });
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createWaitlistEntry(body: CreateWaitlistPayload): Promise<WaitlistEntry> {
  const { data } = await http.post('/waitlist', body);
  return unwrapEntry(data);
}

export async function patchWaitlistEntry(
  id: number,
  body: PatchWaitlistPayload,
): Promise<WaitlistEntry> {
  const { data } = await http.patch(`/waitlist/${id}`, body);
  return unwrapEntry(data);
}

export function waitlistConflictExistingId(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  const data = error.response?.data as { existingId?: unknown } | undefined;
  const id = Number(data?.existingId);
  return Number.isFinite(id) && id > 0 ? id : null;
}
