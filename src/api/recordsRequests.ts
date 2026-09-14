import axios from 'axios';
import { http } from './http';
import type { OutsideHospital } from './outsideHospitals';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/**
 * The outside hospital has no login, and the shared `http` client would attach a
 * stale staff token and try to refresh it on 401. Public calls get their own client.
 */
const publicRecordsClient = axios.create({ baseURL, withCredentials: false });

export type RecordsRequestStatus = 'pending' | 'received' | 'declined' | 'cancelled';

/** Calendar badge state for one appointment. */
export type RecordsRequestUiStatus = 'none' | 'pending' | 'partial' | 'received';

/** Raw entity, as returned by create / update. */
export type RecordsRequest = {
  id: number;
  practiceId: number;
  appointmentId: number | null;
  patientId: number;
  clientId: number | null;
  outsideHospitalId: number | null;
  outsideHospital?: OutsideHospital | null;
  freeTextHospital: string | null;
  status: RecordsRequestStatus;
  source: string;
  requestedAt: string;
  requestedByEmployeeId: number | null;
  authorizationAttestedAt: string | null;
  authorizationAttestedByName: string | null;
  receivedAt: string | null;
  chartDocumentId: number | null;
  notes: string | null;
  sentAt: string | null;
  sentToEmail: string | null;
};

/** Flattened list row — patient, client, visit, and requester resolved server-side. */
export type RecordsRequestRow = {
  id: number;
  status: RecordsRequestStatus;
  requestedAt: string | null;
  sentAt: string | null;
  sentToEmail: string | null;
  receivedAt: string | null;
  chartDocumentId: number | null;
  notes: string | null;
  authorizationAttestedByName: string | null;
  outsideHospitalId: number | null;
  hospitalName: string | null;
  hospitalEmail: string | null;
  hospitalPhone: string | null;
  patientId: number;
  patientName: string | null;
  species: string | null;
  clientId: number | null;
  clientName: string | null;
  appointmentId: number | null;
  appointmentStart: string | null;
  requestedByName: string | null;
};

export type RecordsRequestTarget = {
  outsideHospitalId?: number;
  freeTextHospital?: string;
  email?: string;
};

export function recordsRequestHospitalName(row: RecordsRequestRow): string {
  return row.hospitalName ?? 'Unknown hospital';
}

export async function listRecordsRequests(opts: {
  appointmentId?: number;
  patientId?: number;
  status?: RecordsRequestStatus;
}): Promise<RecordsRequestRow[]> {
  const { data } = await http.get<RecordsRequestRow[]>('/records-requests', {
    params: {
      practiceId: PRACTICE_ID,
      ...(opts.appointmentId ? { appointmentId: opts.appointmentId } : {}),
      ...(opts.patientId ? { patientId: opts.patientId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

/** A hospital we are still waiting on, for the calendar's call/email actions. */
export type RecordsRequestPendingContact = {
  name: string;
  phone: string | null;
  email: string | null;
};

export type RecordsRequestStatusesResponse = {
  statuses: Record<number, RecordsRequestUiStatus>;
  pendingContacts: Record<number, RecordsRequestPendingContact[]>;
};

export async function getRecordsRequestStatuses(
  appointmentIds: number[],
): Promise<RecordsRequestStatusesResponse> {
  const ids = appointmentIds.filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return { statuses: {}, pendingContacts: {} };
  const { data } = await http.get<RecordsRequestStatusesResponse>(
    '/records-requests/statuses',
    { params: { practiceId: PRACTICE_ID, appointmentIds: ids.join(',') } },
  );
  return {
    statuses: data?.statuses ?? {},
    pendingContacts: data?.pendingContacts ?? {},
  };
}

export async function createRecordsRequests(body: {
  appointmentId?: number;
  patientId: number;
  clientId?: number;
  targets: RecordsRequestTarget[];
  authorizationAttested?: boolean;
  notes?: string;
  sendEmail?: boolean;
}): Promise<{ requests: RecordsRequest[]; emailed: number; skipped: string[] }> {
  const { data } = await http.post('/records-requests', {
    practiceId: PRACTICE_ID,
    ...body,
  });
  return {
    requests: Array.isArray(data?.requests) ? data.requests : [],
    emailed: Number(data?.emailed) || 0,
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
  };
}

export async function updateRecordsRequest(
  id: number,
  body: { status?: RecordsRequestStatus; notes?: string },
): Promise<RecordsRequest> {
  const { data } = await http.patch<RecordsRequest>(
    `/records-requests/${encodeURIComponent(id)}`,
    { practiceId: PRACTICE_ID, ...body },
  );
  return data;
}

export async function resendRecordsRequest(
  id: number,
  email?: string,
): Promise<{ sentTo: string; uploadUrl: string }> {
  const { data } = await http.post(
    `/records-requests/${encodeURIComponent(id)}/send`,
    { practiceId: PRACTICE_ID, ...(email?.trim() ? { email: email.trim() } : {}) },
  );
  return data;
}

/** Files a faxed or posted record against a request — same chart write and auto-summary as the emailed link. */
export async function uploadRecordsRequestFile(
  id: number,
  file: File,
): Promise<{ ok: boolean; chartDocumentId: number }> {
  const form = new FormData();
  form.append('file', file);
  form.append('practiceId', String(PRACTICE_ID));
  const { data } = await http.post(
    `/records-requests/${encodeURIComponent(id)}/upload`,
    form,
  );
  return data;
}

/** Fires after a send so the scheduler badge repaints without a range reload. */
export const RECORDS_REQUEST_STATUS_CHANGED_EVENT = 'vayd:records-request-status-changed';

export function notifyRecordsRequestStatusChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(RECORDS_REQUEST_STATUS_CHANGED_EVENT));
}

// --- Public (outside hospital, no login) ---

export type PublicRecordsRequestForm = {
  hospitalName: string;
  patientName: string;
  species: string | null;
  breed: string | null;
  clientName: string | null;
  practiceName: string;
  requestedAt: string | null;
  alreadyReceived: boolean;
  expiresAt: string | null;
};

export async function getPublicRecordsRequestForm(
  token: string,
): Promise<PublicRecordsRequestForm> {
  const { data } = await publicRecordsClient.get<PublicRecordsRequestForm>(
    '/public/records-request/form',
    { params: { token } },
  );
  return data;
}

export async function submitPublicRecordsUpload(opts: {
  token: string;
  file: File;
  note?: string;
}): Promise<{ ok: boolean }> {
  const form = new FormData();
  form.append('file', opts.file);
  form.append('token', opts.token);
  if (opts.note?.trim()) form.append('note', opts.note.trim());
  const { data } = await publicRecordsClient.post('/public/records-request/upload', form);
  return data;
}

export async function declinePublicRecordsRequest(opts: {
  token: string;
  note?: string;
}): Promise<{ ok: boolean }> {
  const form = new FormData();
  form.append('token', opts.token);
  form.append('noRecords', 'true');
  if (opts.note?.trim()) form.append('note', opts.note.trim());
  const { data } = await publicRecordsClient.post('/public/records-request/upload', form);
  return data;
}
