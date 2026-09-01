import { http } from './http';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type ScoutChartNoteStatus = 'draft' | 'finalized';

export type ScoutChartNote = {
  id: string;
  practiceId: number;
  patientId: number;
  clientId: number | null;
  body: string;
  status: ScoutChartNoteStatus;
  createdByEmployeeId: number | null;
  finalizedByEmployeeId: number | null;
  finalizedByEmployee?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  finalizedAt: string | null;
  created: string;
  updated: string;
};

export async function listScoutChartNotes(
  patientId: number,
  status?: ScoutChartNoteStatus
): Promise<ScoutChartNote[]> {
  const { data } = await http.get<ScoutChartNote[]>('/scout-chart/notes', {
    params: { practiceId: PRACTICE_ID, patientId, ...(status ? { status } : {}) },
  });
  return Array.isArray(data) ? data : [];
}

export async function createScoutChartNote(body: {
  patientId: number;
  clientId?: number | null;
  body?: string;
}): Promise<ScoutChartNote> {
  const { data } = await http.post<ScoutChartNote>('/scout-chart/notes', {
    practiceId: PRACTICE_ID,
    patientId: body.patientId,
    clientId: body.clientId ?? undefined,
    body: body.body ?? '',
  });
  return data;
}

export async function updateScoutChartNote(
  id: string,
  body: string
): Promise<ScoutChartNote> {
  const { data } = await http.patch<ScoutChartNote>(`/scout-chart/notes/${encodeURIComponent(id)}`, {
    practiceId: PRACTICE_ID,
    body,
  });
  return data;
}

export async function finalizeScoutChartNote(id: string): Promise<ScoutChartNote> {
  const { data } = await http.post<ScoutChartNote>(
    `/scout-chart/notes/${encodeURIComponent(id)}/finalize`,
    { practiceId: PRACTICE_ID }
  );
  return data;
}

export type ClientCommunicationRow = {
  id: number;
  serviceDate: string;
  typeLabel: string;
  message: string;
  destination: string | null;
  statusDetails: string | null;
  sentFrom?: string | null;
  sentByName?: string | null;
  patientId?: number | null;
  patientName?: string | null;
  patientNames?: string[];
  includeOnMedicalRecordView: boolean;
};

export async function listClientCommunications(
  clientId: number
): Promise<ClientCommunicationRow[]> {
  const { data } = await http.get<ClientCommunicationRow[]>('/scout-chart/communications', {
    params: { practiceId: PRACTICE_ID, clientId },
  });
  return Array.isArray(data) ? data : [];
}

export async function recordScoutChartCommunication(body: {
  patientId?: number | null;
  patientIds?: number[];
  clientId: number;
  channel: 'email' | 'sms';
  body: string;
  subject?: string;
  destination?: string;
  sentFrom?: string;
  typeLabel?: string;
  includeOnMedicalRecord?: boolean;
}): Promise<void> {
  await http.post('/scout-chart/communications', {
    practiceId: PRACTICE_ID,
    ...body,
    patientId: body.patientId ?? undefined,
    patientIds: body.patientIds?.length ? body.patientIds : undefined,
  });
}
