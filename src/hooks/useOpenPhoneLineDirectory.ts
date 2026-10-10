import { useEffect, useState } from 'react';
import { fetchOpenPhonePhoneNumbers } from '../api/openphoneCalls';
import { lineKeyForPhone } from '../utils/clientMessagesByLine';
import { phonesMatchForQuo } from '../utils/quoContact';

export type OpenPhoneLineDirectoryEntry = {
  phone: string;
  label: string;
};

export type OpenPhoneLineDirectory = Map<string, OpenPhoneLineDirectoryEntry>;

function looksLikePhoneLabel(label: string, phone: string): boolean {
  if (phonesMatchForQuo(label, phone)) return true;
  return /^\+?\d[\d\s().-]*$/.test(label.trim());
}

function mergeDirectoryEntries(
  directory: OpenPhoneLineDirectory,
  phone: string,
  label: string,
): void {
  const trimmedPhone = phone.trim();
  const trimmedLabel = label.trim();
  if (!trimmedPhone || !trimmedLabel) return;
  directory.set(lineKeyForPhone(trimmedPhone), { phone: trimmedPhone, label: trimmedLabel });
}

function quoInboxName(phone: string, name: string | null | undefined): string {
  const trimmed = name?.trim() ?? '';
  if (trimmed && !looksLikePhoneLabel(trimmed, phone)) return trimmed;
  return phone;
}

function sortDirectoryLines(directory: OpenPhoneLineDirectory): OpenPhoneLineDirectoryEntry[] {
  return [...directory.values()].sort((a, b) => {
    const an = displayNameForQuoLine(a);
    const bn = displayNameForQuoLine(b);
    const aNamed = an !== 'Quo line';
    const bNamed = bn !== 'Quo line';
    if (aNamed !== bNamed) return aNamed ? -1 : 1;
    return an.localeCompare(bn) || a.phone.localeCompare(b.phone);
  });
}

/** Names come from Quo (`GET /v1/phone-numbers` name field), not a local guess list. */
async function loadOpenPhoneLineDirectoryCore(): Promise<OpenPhoneLineDirectory> {
  const directory: OpenPhoneLineDirectory = new Map();
  const lines = await fetchOpenPhonePhoneNumbers().catch(() => []);
  for (const line of lines) {
    mergeDirectoryEntries(directory, line.phone, quoInboxName(line.phone, line.name));
  }
  return directory;
}

let cachedDirectory: OpenPhoneLineDirectory | null = null;
let loadPromise: Promise<OpenPhoneLineDirectory> | null = null;
const directoryListeners = new Set<(directory: OpenPhoneLineDirectory) => void>();

function publishDirectory(next: OpenPhoneLineDirectory): void {
  cachedDirectory = next;
  for (const listener of directoryListeners) listener(next);
}

async function ensureOpenPhoneLineDirectory(): Promise<OpenPhoneLineDirectory> {
  if (cachedDirectory && cachedDirectory.size > 0) return cachedDirectory;
  if (loadPromise) return loadPromise;

  loadPromise = loadOpenPhoneLineDirectoryCore()
    .then((directory) => {
      publishDirectory(directory);
      return directory;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

/** Load Quo / OpenPhone line labels keyed by normalized phone digits. */
export async function loadOpenPhoneLineDirectory(): Promise<OpenPhoneLineDirectory> {
  return ensureOpenPhoneLineDirectory();
}

export function resolveLineDirectoryEntry(
  directory: OpenPhoneLineDirectory,
  linePhone: string,
): OpenPhoneLineDirectoryEntry {
  const key = lineKeyForPhone(linePhone);
  const hit = directory.get(key);
  if (hit) return hit;
  for (const entry of directory.values()) {
    if (phonesMatchForQuo(entry.phone, linePhone)) return entry;
  }
  return { phone: linePhone, label: linePhone };
}

export function displayNameForQuoLine(entry: OpenPhoneLineDirectoryEntry): string {
  if (entry.label && !looksLikePhoneLabel(entry.label, entry.phone)) return entry.label;
  return 'Quo line';
}

export function directoryEntryMatchesPhone(
  entry: OpenPhoneLineDirectoryEntry,
  phone: string | null | undefined,
): boolean {
  return phonesMatchForQuo(entry.phone, phone);
}

export function useOpenPhoneLineDirectory(enabled: boolean): {
  directory: OpenPhoneLineDirectory;
  lines: OpenPhoneLineDirectoryEntry[];
} {
  const [directory, setDirectory] = useState<OpenPhoneLineDirectory>(
    () => cachedDirectory ?? new Map(),
  );

  useEffect(() => {
    if (!enabled) {
      if (!cachedDirectory) setDirectory(new Map());
      return;
    }

    const onChange = (map: OpenPhoneLineDirectory) => {
      setDirectory(new Map(map));
    };
    directoryListeners.add(onChange);
    if (cachedDirectory) onChange(cachedDirectory);
    void ensureOpenPhoneLineDirectory().then((map) => {
      onChange(map);
    });

    return () => {
      directoryListeners.delete(onChange);
    };
  }, [enabled]);

  return { directory, lines: sortDirectoryLines(directory) };
}
