import type { BriefKind, BriefSession, BriefStatus } from './briefTypes';
import { isBriefKind } from './briefTypes';

const STORAGE_KEY = 'vayd-brief-sessions-v1';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `brief-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isStatus(value: unknown): value is BriefStatus {
  return value === 'draft' || value === 'recorded' || value === 'injected' || value === 'archived';
}

function normalizeSession(raw: unknown): BriefSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === 'string' && isBriefKind(o.kind) ? o.kind : null;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
  if (!kind || !id) return null;
  const createdAt = typeof o.createdAt === 'string' ? o.createdAt : nowIso();
  const date =
    typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date)
      ? o.date
      : createdAt.slice(0, 10);
  return {
    id,
    kind,
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : kind,
    createdAt,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : createdAt,
    date,
    employeeId: typeof o.employeeId === 'string' ? o.employeeId : null,
    patientId:
      typeof o.patientId === 'string' || typeof o.patientId === 'number' ? o.patientId : null,
    patientName: typeof o.patientName === 'string' ? o.patientName : null,
    clientId: typeof o.clientId === 'string' || typeof o.clientId === 'number' ? o.clientId : null,
    clientName: typeof o.clientName === 'string' ? o.clientName : null,
    clientPhone: typeof o.clientPhone === 'string' ? o.clientPhone : null,
    appointmentId: typeof o.appointmentId === 'number' ? o.appointmentId : null,
    soapEncounterId: typeof o.soapEncounterId === 'string' ? o.soapEncounterId : null,
    transcript: typeof o.transcript === 'string' ? o.transcript : '',
    rawTranscript: typeof o.rawTranscript === 'string' ? o.rawTranscript : null,
    status: isStatus(o.status) ? o.status : 'draft',
    injectedAt: typeof o.injectedAt === 'string' ? o.injectedAt : null,
    audioFileName: typeof o.audioFileName === 'string' ? o.audioFileName : null,
  };
}

function readAll(): BriefSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSession).filter((s): s is BriefSession => s != null);
  } catch {
    return [];
  }
}

function writeAll(rows: BriefSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* private mode / quota */
  }
}

export type CreateBriefInput = {
  kind: BriefKind;
  title: string;
  date: string;
  employeeId?: string | null;
  patientId?: string | number | null;
  patientName?: string | null;
  clientId?: string | number | null;
  clientName?: string | null;
  clientPhone?: string | null;
  appointmentId?: number | null;
  soapEncounterId?: string | null;
  transcript?: string;
  status?: BriefStatus;
};

export function listLocalBriefs(): BriefSession[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getLocalBrief(id: string): BriefSession | null {
  return readAll().find((s) => s.id === id) ?? null;
}

export function createLocalBrief(input: CreateBriefInput): BriefSession {
  const createdAt = nowIso();
  const session: BriefSession = {
    id: newId(),
    kind: input.kind,
    title: input.title.trim() || input.kind,
    createdAt,
    updatedAt: createdAt,
    date: input.date,
    employeeId: input.employeeId ?? null,
    patientId: input.patientId ?? null,
    patientName: input.patientName ?? null,
    clientId: input.clientId ?? null,
    clientName: input.clientName ?? null,
    clientPhone: input.clientPhone ?? null,
    appointmentId: input.appointmentId ?? null,
    soapEncounterId: input.soapEncounterId ?? null,
    transcript: input.transcript ?? '',
    rawTranscript: null,
    status: input.status ?? 'draft',
    injectedAt: null,
    audioFileName: null,
  };
  writeAll([session, ...readAll()]);
  return session;
}

export function updateLocalBrief(
  id: string,
  patch: Partial<Omit<BriefSession, 'id' | 'createdAt'>>
): BriefSession | null {
  const rows = readAll();
  const idx = rows.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const next: BriefSession = {
    ...rows[idx]!,
    ...patch,
    id,
    createdAt: rows[idx]!.createdAt,
    updatedAt: nowIso(),
  };
  rows[idx] = next;
  writeAll(rows);
  return next;
}

export function deleteLocalBrief(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id));
}

export function listLocalBriefsForPatient(patientId: string | number): BriefSession[] {
  const id = String(patientId);
  return listLocalBriefs().filter((s) => s.patientId != null && String(s.patientId) === id);
}

export function listLocalBriefsForDate(date: string): BriefSession[] {
  return listLocalBriefs().filter((s) => s.date === date && s.status !== 'archived');
}

export function pendingPrevisitBriefs(opts: {
  patientId: string | number;
  appointmentId?: number | null;
}): BriefSession[] {
  const id = String(opts.patientId);
  return listLocalBriefs().filter((s) => {
    if (s.kind !== 'previsit') return false;
    if (s.status === 'injected' || s.status === 'archived') return false;
    if (!s.transcript.trim()) return false;
    if (s.patientId == null || String(s.patientId) !== id) return false;
    if (opts.appointmentId != null && s.appointmentId != null) {
      return s.appointmentId === opts.appointmentId;
    }
    return true;
  });
}

export function markBriefsInjected(ids: string[]): void {
  const at = nowIso();
  const rows = readAll().map((s) =>
    ids.includes(s.id) ? { ...s, status: 'injected' as const, injectedAt: at, updatedAt: at } : s
  );
  writeAll(rows);
}
