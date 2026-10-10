import axios from 'axios';
import { http } from './http';
import type { OutsideHospital } from './outsideHospitals';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const PRACTICE_ID = currentPracticeId();
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
  /** Every document filed against this request; older rows may only have `chartDocumentId`. */
  chartDocumentIds?: number[] | null;
  summaryNoteId?: string | null;
  summarizedAt?: string | null;
  /** Set once the CL summarized the records and entered reminders. */
  closedOutAt?: string | null;
  closedOutByName?: string | null;
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

/** Received but not yet summarized and closed out — the CL still owes work on it. */
export function recordsRequestNeedsReview(row: RecordsRequestRow): boolean {
  return row.status === 'received' && !row.closedOutAt;
}

export async function updateRecordsRequest(
  id: number,
  body: {
    status?: RecordsRequestStatus;
    notes?: string;
    summaryNoteId?: string;
    closedOut?: boolean;
  },
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

export function recordsRequestDocumentIds(row: RecordsRequestRow): number[] {
  const ids = Array.isArray(row.chartDocumentIds) ? row.chartDocumentIds : [];
  if (ids.length) return ids.map(Number).filter((id) => Number.isFinite(id) && id > 0);
  return row.chartDocumentId ? [row.chartDocumentId] : [];
}

/** Files faxed or posted records against a request — same chart write as the emailed link. */
export async function uploadRecordsRequestFiles(
  id: number,
  files: File[],
): Promise<{ ok: boolean; chartDocumentIds: number[] }> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
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
  files: File[];
  note?: string;
}): Promise<{ ok: boolean }> {
  const form = new FormData();
  for (const file of opts.files) form.append('files', file);
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
