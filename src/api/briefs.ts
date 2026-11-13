import axios from 'axios';
import { http } from './http';
import type { BriefKind, BriefSession } from '../utils/briefTypes';
import {
  readLegacyLocalBriefs,
  clearLegacyLocalBriefs,
  type CreateBriefInput,
} from '../utils/briefStore';

function isNotImplemented(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const status = err.response?.status;
  return status === 404 || status === 501;
}

export type { CreateBriefInput };

/** Jots before Nov 13, 2026 lived in one browser; the first load on each device uploads them (B8). */
let legacyUpload: Promise<void> | null = null;

function uploadLegacyBriefs(): Promise<void> {
  if (legacyUpload) return legacyUpload;
  legacyUpload = (async () => {
    const rows = readLegacyLocalBriefs();
    if (!rows.length) return;
    const left: string[] = [];
    for (const row of rows) {
      try {
        await http.post<BriefSession>('/briefs', {
          kind: row.kind,
          title: row.title,
          date: row.date,
          employeeId: row.employeeId ?? null,
          patientId: row.patientId ?? null,
          patientName: row.patientName ?? null,
          clientId: row.clientId ?? null,
          clientName: row.clientName ?? null,
          clientPhone: row.clientPhone ?? null,
          appointmentId: row.appointmentId ?? null,
          soapEncounterId: row.soapEncounterId ?? null,
          transcript: row.transcript,
          rawTranscript: row.rawTranscript ?? null,
          status: row.status,
          injectedAt: row.injectedAt ?? null,
          audioFileName: row.audioFileName ?? null,
          createdAt: row.createdAt,
        });
      } catch {
        left.push(row.id);
      }
    }
    clearLegacyLocalBriefs(left);
  })();
  return legacyUpload;
}

export type BriefListFilter = {
  /** Your own Jots for this day (YYYY-MM-DD). */
  date?: string;
  /** Every Jot about this pet, by anyone on staff. */
  patientId?: string | number;
  appointmentId?: number;
  kind?: BriefKind;
};

/** Jots saved on the server (B8). */
export async function listBriefs(filter: BriefListFilter = {}): Promise<BriefSession[]> {
  await uploadLegacyBriefs();
  const params: Record<string, string> = {};
  if (filter.date) params.date = filter.date;
  if (filter.patientId != null && String(filter.patientId).trim()) {
    params.patientId = String(filter.patientId);
  }
  if (filter.appointmentId != null) params.appointmentId = String(filter.appointmentId);
  if (filter.kind) params.kind = filter.kind;
  const { data } = await http.get<BriefSession[]>('/briefs', { params });
  return Array.isArray(data) ? data : [];
}

export async function getBrief(id: string): Promise<BriefSession | null> {
  try {
    const { data } = await http.get<BriefSession>(`/briefs/${encodeURIComponent(id)}`);
    return data?.id ? data : null;
  } catch (err) {
    if (isNotImplemented(err)) return null;
    throw err;
  }
}

export async function saveBrief(input: CreateBriefInput): Promise<BriefSession> {
  const { data } = await http.post<BriefSession>('/briefs', input);
  return data;
}

export async function patchBrief(
  id: string,
  patch: Partial<Omit<BriefSession, 'id' | 'createdAt'>>
): Promise<BriefSession | null> {
  const { data } = await http.patch<BriefSession>(`/briefs/${encodeURIComponent(id)}`, patch);
  return data?.id ? data : null;
}

export async function removeBrief(id: string): Promise<void> {
  await http.delete(`/briefs/${encodeURIComponent(id)}`);
}

export async function markBriefsInjected(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await http.post('/briefs/mark-injected', { ids });
}

/** Prep notes for this pet not yet added to the visit's SOAP. */
export async function pendingPrevisitBriefs(opts: {
  patientId: string | number;
  appointmentId?: number | null;
}): Promise<BriefSession[]> {
  const rows = await listBriefs({ patientId: opts.patientId, kind: 'previsit' });
  return rows.filter((s) => {
    if (s.status === 'injected' || s.status === 'archived') return false;
    if (!s.transcript.trim()) return false;
    if (opts.appointmentId != null && s.appointmentId != null) {
      return s.appointmentId === opts.appointmentId;
    }
    return true;
  });
}

/** Open prep session already linked to this visit, if any. */
export async function findOpenPrevisitForAppointment(
  appointmentId: number,
  patientId: string | number
): Promise<BriefSession | null> {
  const rows = await listBriefs({ appointmentId, kind: 'previsit' });
  const id = String(patientId);
  return (
    rows.find(
      (s) => s.status !== 'archived' && s.patientId != null && String(s.patientId) === id
    ) ?? null
  );
}

export async function mergePatientsStaff(opts: {
  keepPatientId: string | number;
  absorbPatientId: string | number;
}): Promise<{ ok: boolean; message: string }> {
  try {
    await http.post(`/patients/${encodeURIComponent(String(opts.keepPatientId))}/merge`, {
      sourcePatientId: Number(opts.absorbPatientId),
    });
    return { ok: true, message: 'Charts merged. Visits, records and reminders are on this chart now.' };
  } catch (err) {
    if (isNotImplemented(err)) {
      return {
        ok: false,
        message:
          'Merge is not available on the server yet. Nothing was changed on the chart — ask an admin to merge these charts.',
      };
    }
    const message =
      axios.isAxiosError(err) && typeof err.response?.data?.message === 'string'
        ? err.response.data.message
        : err instanceof Error
          ? err.message
          : 'Could not merge patients.';
    return { ok: false, message };
  }
}
