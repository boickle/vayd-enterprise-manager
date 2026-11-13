import type { BriefKind, BriefSession, BriefStatus } from './briefTypes';
import { isBriefKind } from './briefTypes';

const STORAGE_KEY = 'vayd-brief-sessions-v1';

function nowIso(): string {
  return new Date().toISOString();
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

/**
 * Jots made before Nov 13, 2026 were kept only in this browser. They are now saved on the
 * server (B8); `api/briefs.ts` uploads these once and then clears them here.
 */
export function readLegacyLocalBriefs(): BriefSession[] {
  return readAll();
}

/** Clears the uploaded Jots from this browser, keeping any whose upload failed (by id). */
export function clearLegacyLocalBriefs(keepIds: string[] = []): void {
  if (!keepIds.length) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
    return;
  }
  writeAll(readAll().filter((s) => keepIds.includes(s.id)));
}
