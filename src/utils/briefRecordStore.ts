export type OutsideRecordSummary = {
  id: string;
  patientId: string;
  fileName: string;
  uploadedAt: string;
  summary: string;
  /** Chart document holding the original file. Only set after Accept (or leftover from an earlier auto-upload). */
  chartDocumentId?: number | null;
  /** Staff who uploaded the file and directed the summary. */
  uploadedByName?: string | null;
};

/** What landed on the chart after Accept — used to scroll and highlight the new Timeline rows. */
export type OutsideRecordAcceptResult = {
  chartDocumentId?: number | null;
  scoutNoteId?: string | null;
};

/** Original files stay in memory until Accept. localStorage only holds the summary. */
const pendingFiles = new Map<string, File>();

export function stashOutsideRecordFile(id: string, file: File): void {
  pendingFiles.set(id, file);
}

export function peekOutsideRecordFile(id: string): File | undefined {
  return pendingFiles.get(id);
}

export function takeOutsideRecordFile(id: string): File | undefined {
  const file = pendingFiles.get(id);
  pendingFiles.delete(id);
  return file;
}

export function discardOutsideRecordFile(id: string): void {
  pendingFiles.delete(id);
}

export type CaseHistorySummary = {
  id: string;
  patientId: string;
  asOfDate: string;
  createdAt: string;
  summary: string;
};

export type CaseHistoryChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

const OUTSIDE_KEY = 'vayd-jot-outside-records-v1';
const HISTORY_KEY = 'vayd-jot-case-history-v1';
const CHAT_KEY = 'vayd-jot-case-history-chat-v1';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJson(key: string, rows: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* quota / private mode */
  }
}

export function listOutsideRecords(patientId: string): OutsideRecordSummary[] {
  const id = String(patientId);
  return readJson<OutsideRecordSummary>(OUTSIDE_KEY)
    .filter((r) => r && r.patientId === id && typeof r.summary === 'string')
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function saveOutsideRecord(input: {
  patientId: string;
  fileName: string;
  summary: string;
  chartDocumentId?: number | null;
  file?: File;
  uploadedByName?: string | null;
}): OutsideRecordSummary {
  const row: OutsideRecordSummary = {
    id: newId(),
    patientId: String(input.patientId),
    fileName: input.fileName.trim() || 'Uploaded record',
    uploadedAt: nowIso(),
    summary: input.summary.trim(),
    chartDocumentId: input.chartDocumentId ?? null,
    uploadedByName: input.uploadedByName?.trim() || null,
  };
  if (input.file) stashOutsideRecordFile(row.id, input.file);
  writeJson(OUTSIDE_KEY, [row, ...readJson<OutsideRecordSummary>(OUTSIDE_KEY)]);
  return row;
}

/** Drop pending reviews for this pet so Upload File opens as a blank slate. */
export function clearOutsideRecordsForPatient(patientId: string): void {
  const id = String(patientId);
  const kept = readJson<OutsideRecordSummary>(OUTSIDE_KEY).filter((r) => {
    if (!r || r.patientId !== id) return true;
    discardOutsideRecordFile(r.id);
    return false;
  });
  writeJson(OUTSIDE_KEY, kept);
}

export function deleteOutsideRecord(id: string): void {
  discardOutsideRecordFile(id);
  writeJson(
    OUTSIDE_KEY,
    readJson<OutsideRecordSummary>(OUTSIDE_KEY).filter((r) => r.id !== id)
  );
}

export function listCaseHistorySummaries(patientId: string): CaseHistorySummary[] {
  const id = String(patientId);
  return readJson<CaseHistorySummary>(HISTORY_KEY)
    .filter((r) => r && r.patientId === id && typeof r.summary === 'string')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveCaseHistorySummary(input: {
  patientId: string;
  asOfDate: string;
  summary: string;
}): CaseHistorySummary {
  const row: CaseHistorySummary = {
    id: newId(),
    patientId: String(input.patientId),
    asOfDate: input.asOfDate,
    createdAt: nowIso(),
    summary: input.summary.trim(),
  };
  writeJson(HISTORY_KEY, [row, ...readJson<CaseHistorySummary>(HISTORY_KEY)]);
  return row;
}

export function deleteCaseHistorySummary(id: string): void {
  writeJson(
    HISTORY_KEY,
    readJson<CaseHistorySummary>(HISTORY_KEY).filter((r) => r.id !== id)
  );
}

type StoredChat = { patientId: string; ownerId?: string; messages: CaseHistoryChatMessage[] };

const CHAT_KEY_V2 = 'vayd-jot-case-history-chat-v2';

function chatOwnerId(ownerId?: string | null): string {
  return String(ownerId ?? '').trim() || 'local';
}

function chatMatches(row: StoredChat, patientId: string, ownerId: string): boolean {
  return row.patientId === patientId && chatOwnerId(row.ownerId) === ownerId;
}

/** Move a pre-login thread on this browser into the current user's private thread once. */
function claimLegacyChat(patientId: string, ownerId: string): StoredChat | null {
  const legacy = readJson<StoredChat>(CHAT_KEY);
  const idx = legacy.findIndex((r) => r && r.patientId === patientId && !r.ownerId);
  if (idx < 0) return null;
  const claimed: StoredChat = { patientId, ownerId, messages: legacy[idx].messages ?? [] };
  writeJson(
    CHAT_KEY,
    legacy.filter((_, i) => i !== idx)
  );
  const next = [claimed, ...readJson<StoredChat>(CHAT_KEY_V2).filter((r) => !chatMatches(r, patientId, ownerId))];
  writeJson(CHAT_KEY_V2, next);
  return claimed;
}

export function listCaseHistoryChat(
  patientId: string,
  ownerId?: string | null
): CaseHistoryChatMessage[] {
  const id = String(patientId);
  const owner = chatOwnerId(ownerId);
  const rows = readJson<StoredChat>(CHAT_KEY_V2);
  const found = rows.find((r) => r && chatMatches(r, id, owner));
  if (found) return Array.isArray(found.messages) ? found.messages : [];
  const claimed = claimLegacyChat(id, owner);
  return claimed?.messages ?? [];
}

export function appendCaseHistoryChat(
  patientId: string,
  message: Omit<CaseHistoryChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ownerId?: string | null
): CaseHistoryChatMessage {
  const row: CaseHistoryChatMessage = {
    id: message.id ?? newId(),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt ?? nowIso(),
  };
  const id = String(patientId);
  const owner = chatOwnerId(ownerId);
  listCaseHistoryChat(id, owner);
  const rows = readJson<StoredChat>(CHAT_KEY_V2);
  const idx = rows.findIndex((r) => r && chatMatches(r, id, owner));
  if (idx >= 0) {
    rows[idx] = { patientId: id, ownerId: owner, messages: [...rows[idx].messages, row] };
  } else {
    rows.unshift({ patientId: id, ownerId: owner, messages: [row] });
  }
  writeJson(CHAT_KEY_V2, rows);
  return row;
}

export function replaceCaseHistoryChat(
  patientId: string,
  messages: CaseHistoryChatMessage[],
  ownerId?: string | null
): CaseHistoryChatMessage[] {
  const id = String(patientId);
  const owner = chatOwnerId(ownerId);
  const next = Array.isArray(messages) ? messages : [];
  const rows = readJson<StoredChat>(CHAT_KEY_V2).filter((r) => !chatMatches(r, id, owner));
  if (next.length) rows.unshift({ patientId: id, ownerId: owner, messages: next });
  writeJson(CHAT_KEY_V2, rows);
  return next;
}

export function clearCaseHistoryChat(patientId: string, ownerId?: string | null): void {
  const id = String(patientId);
  const owner = chatOwnerId(ownerId);
  writeJson(
    CHAT_KEY_V2,
    readJson<StoredChat>(CHAT_KEY_V2).filter((r) => !chatMatches(r, id, owner))
  );
}
