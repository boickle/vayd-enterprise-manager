import axios from 'axios';
import { http } from './http';
import type { BriefSession } from '../utils/briefTypes';
import {
  createLocalBrief,
  deleteLocalBrief,
  getLocalBrief,
  listLocalBriefs,
  updateLocalBrief,
  type CreateBriefInput,
} from '../utils/briefStore';

function isNotImplemented(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const status = err.response?.status;
  return status === 404 || status === 501;
}

/**
 * Jot sessions are stored locally until the practice API exposes `/briefs`.
 * Create/update still attempt the server so a later backend can take over without a UI rewrite.
 */
export async function listBriefs(): Promise<BriefSession[]> {
  try {
    const { data } = await http.get<BriefSession[]>('/briefs');
    if (Array.isArray(data) && data.length) return data;
  } catch (err) {
    if (!isNotImplemented(err)) {
      /* fall through to local — network errors should not hide drafts */
    }
  }
  return listLocalBriefs();
}

export async function saveBrief(input: CreateBriefInput): Promise<BriefSession> {
  try {
    const { data } = await http.post<BriefSession>('/briefs', input);
    if (data?.id) return data;
  } catch (err) {
    if (!isNotImplemented(err)) {
      /* keep going locally */
    }
  }
  return createLocalBrief(input);
}

export async function patchBrief(
  id: string,
  patch: Partial<Omit<BriefSession, 'id' | 'createdAt'>>
): Promise<BriefSession | null> {
  try {
    const { data } = await http.patch<BriefSession>(`/briefs/${encodeURIComponent(id)}`, patch);
    if (data?.id) {
      updateLocalBrief(id, data);
      return data;
    }
  } catch (err) {
    if (!isNotImplemented(err)) {
      /* keep going locally */
    }
  }
  return updateLocalBrief(id, patch);
}

export async function removeBrief(id: string): Promise<void> {
  try {
    await http.delete(`/briefs/${encodeURIComponent(id)}`);
  } catch (err) {
    if (!isNotImplemented(err)) {
      /* still drop the local copy */
    }
  }
  deleteLocalBrief(id);
}

export function briefById(id: string): BriefSession | null {
  return getLocalBrief(id);
}

export async function mergePatientsStaff(opts: {
  keepPatientId: string | number;
  absorbPatientId: string | number;
}): Promise<{ ok: boolean; message: string }> {
  try {
    await http.post(`/patients/${encodeURIComponent(String(opts.keepPatientId))}/merge`, {
      sourcePatientId: opts.absorbPatientId,
    });
    return { ok: true, message: 'Patients merged.' };
  } catch (err) {
    if (isNotImplemented(err)) {
      return {
        ok: false,
        message:
          'Merge is not available on the server yet. Nothing was changed on the chart — ask an admin if this pairing still needs to happen in eVet.',
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
