export type RecentKind = 'patient' | 'client';

export type RecentRecord = {
  kind: RecentKind;
  id: string;
  name: string;
  subtitle?: string;
  href: string;
  at: number;
};

const KEY = 'scout.recentRecords.v1';
const MAX = 15;
const EVENT = 'scout-recent-records';

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function read(): RecentRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is RecentRecord => {
        if (!row || typeof row !== 'object') return false;
        const r = row as RecentRecord;
        return (r.kind === 'patient' || r.kind === 'client') && Boolean(trim(r.id) && trim(r.name) && trim(r.href));
      })
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function write(rows: RecentRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)));
  } catch {
    /* quota / private mode */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function listRecentRecords(): RecentRecord[] {
  return read();
}

export function pushRecentRecord(entry: {
  kind: RecentKind;
  id: string | number;
  name: string;
  subtitle?: string | null;
  href?: string;
}): void {
  const id = trim(entry.id);
  const name = trim(entry.name);
  if (!id || !name) return;
  const href =
    trim(entry.href) ||
    (entry.kind === 'client'
      ? `/schedule/clients?clientId=${encodeURIComponent(id)}`
      : `/schedule/patients?patientId=${encodeURIComponent(id)}`);
  const next: RecentRecord = {
    kind: entry.kind,
    id,
    name,
    subtitle: trim(entry.subtitle) || undefined,
    href,
    at: Date.now(),
  };
  const rest = read().filter((r) => !(r.kind === next.kind && r.id === next.id));
  write([next, ...rest]);
}

export function subscribeRecentRecords(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key == null) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function clientHref(id: string | number): string {
  return `/schedule/clients?clientId=${encodeURIComponent(String(id))}`;
}

export function patientHref(id: string | number): string {
  return `/schedule/patients?patientId=${encodeURIComponent(String(id))}`;
}
