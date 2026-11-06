// src/api/practices.ts
import { http } from './http';
import { HOST_PRACTICE_ID_STORAGE_KEY } from '../utils/practiceIdFromToken';

export type PracticeSummary = {
  key: string;
  name: string;
  primaryHost: string | null;
};

/** Single-use code that signs the person into `practice`; redeem it on that practice's host. */
export type PracticeHandoff = {
  code: string;
  practice: PracticeSummary;
};

/** Asks the API which practice owns this host and remembers its id for signed-out pages. */
export async function loadHostPractice(): Promise<void> {
  const { data } = await http.get<{ key: string; practiceId: number; name: string | null }>(
    '/public/practice/current'
  );
  if (Number.isInteger(data?.practiceId) && data.practiceId > 0) {
    localStorage.setItem(HOST_PRACTICE_ID_STORAGE_KEY, String(data.practiceId));
  }
}

export async function fetchMyPractices() {
  const { data } = await http.get<{ current: string; practices: PracticeSummary[] }>(
    '/auth/practices'
  );
  return data;
}

export async function startPracticeSwitch(practiceKey: string) {
  const { data } = await http.post<PracticeHandoff>('/auth/switch-practice', { practiceKey });
  return data;
}

/** Page on the practice's own host that redeems the code, or null when this host can redeem it. */
export function practiceHandoffUrl(handoff: PracticeHandoff): string | null {
  const host = handoff.practice.primaryHost;
  if (!host || host === window.location.hostname) return null;
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${window.location.protocol}//${host}${port}/auth/handoff?code=${encodeURIComponent(
    handoff.code
  )}`;
}
