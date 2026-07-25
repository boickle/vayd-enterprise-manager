import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { fetchSchedulingOutreachSmsFrom } from '../api/clientSms';
import { fetchPrimaryProviders } from '../api/employee';
import { fetchOpenPhoneCallSummary } from '../api/openphoneCalls';
import { lineKeyForPhone } from '../utils/clientMessagesByLine';
import { phonesMatchForQuo } from '../utils/quoContact';

export type OpenPhoneLineDirectoryEntry = {
  phone: string;
  label: string;
};

export type OpenPhoneLineDirectory = Map<string, OpenPhoneLineDirectoryEntry>;

function providerLineLabel(firstName?: string | null, lastName?: string | null): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name ? `${name}'s line` : 'Provider line';
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

/** Reminders + provider Quo lines — fast path for message history labels. */
async function loadOpenPhoneLineDirectoryCore(): Promise<OpenPhoneLineDirectory> {
  const directory: OpenPhoneLineDirectory = new Map();

  const [remindersFrom, providers] = await Promise.all([
    fetchSchedulingOutreachSmsFrom().catch(() => null),
    fetchPrimaryProviders().catch(() => []),
  ]);

  if (remindersFrom) {
    mergeDirectoryEntries(directory, remindersFrom, 'Reminders Line');
  }

  for (const provider of providers) {
    const phone = provider.quoLinePhone?.trim();
    if (!phone) continue;
    mergeDirectoryEntries(directory, phone, providerLineLabel(provider.firstName, provider.lastName));
  }

  return directory;
}

async function enrichDirectoryFromCallSummary(
  directory: OpenPhoneLineDirectory,
): Promise<OpenPhoneLineDirectory> {
  const summary = await fetchOpenPhoneCallSummary({
    from: DateTime.now().minus({ years: 1 }).toISO()!,
    to: DateTime.now().toISO()!,
  }).catch(() => null);

  if (!summary?.numbers?.length) return directory;

  const next = new Map(directory);
  for (const row of summary.numbers) {
    const phone = row.phoneNumber?.trim();
    if (!phone) continue;
    const key = lineKeyForPhone(phone);
    if (next.has(key)) continue;
    const label = row.label?.trim() || phone;
    mergeDirectoryEntries(next, phone, label);
  }
  return next;
}

let cachedDirectory: OpenPhoneLineDirectory | null = null;
let loadPromise: Promise<OpenPhoneLineDirectory> | null = null;

async function ensureOpenPhoneLineDirectory(): Promise<OpenPhoneLineDirectory> {
  if (cachedDirectory) return cachedDirectory;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const core = await loadOpenPhoneLineDirectoryCore();
    cachedDirectory = core;
    void enrichDirectoryFromCallSummary(core).then((enriched) => {
      cachedDirectory = enriched;
    });
    return core;
  })().finally(() => {
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
  return { phone: linePhone, label: linePhone };
}

export function directoryEntryMatchesPhone(
  entry: OpenPhoneLineDirectoryEntry,
  phone: string | null | undefined,
): boolean {
  return phonesMatchForQuo(entry.phone, phone);
}

export function useOpenPhoneLineDirectory(enabled: boolean): {
  directory: OpenPhoneLineDirectory;
} {
  const [directory, setDirectory] = useState<OpenPhoneLineDirectory>(
    () => cachedDirectory ?? new Map(),
  );

  useEffect(() => {
    if (!enabled) {
      if (!cachedDirectory) setDirectory(new Map());
      return;
    }

    if (cachedDirectory) {
      setDirectory(cachedDirectory);
      return;
    }

    let cancelled = false;
    void ensureOpenPhoneLineDirectory().then((map) => {
      if (!cancelled) setDirectory(map);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { directory };
}
