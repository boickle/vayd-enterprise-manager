import { applyMergeFields, type MergeValues } from './messageTemplateFields';
import { SYSTEM_TEMPLATE_SEEDS } from './messageTemplateSeeds';
import type { MessageTemplate } from './messageTemplateTypes';

type Cached = {
  body: string;
  subject: string;
  customized: boolean;
};

const byKey = new Map<string, Cached>();
let all: MessageTemplate[] = [];
const listeners = new Set<() => void>();

export function listCachedMessageTemplates(): MessageTemplate[] {
  return all;
}

export function hydrateMessageTemplateCache(rows: MessageTemplate[]): void {
  all = rows;
  byKey.clear();
  for (const row of rows) {
    if (!row.systemKey || !row.isActive) continue;
    byKey.set(row.systemKey, {
      body: row.body,
      subject: row.subject,
      customized: row.isCustomized,
    });
  }
  listeners.forEach((fn) => fn());
}

export function subscribeMessageTemplates(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function applySystemTemplate(
  systemKey: string,
  values: MergeValues,
  fallback?: string,
): string {
  const row = byKey.get(systemKey);
  const body =
    row?.customized && row.body.trim()
      ? row.body
      : seedBodyFor(systemKey) || fallback || '';
  return applyMergeFields(body, values);
}

export function applySystemSubject(
  systemKey: string,
  values: MergeValues,
  fallback?: string,
): string {
  const row = byKey.get(systemKey);
  const subject =
    row?.customized && row.subject.trim()
      ? row.subject
      : SYSTEM_TEMPLATE_SEEDS.find((s) => s.systemKey === systemKey)?.subject ||
        fallback ||
        '';
  return applyMergeFields(subject, values);
}

export function applySystemTemplateIfCustom(
  systemKey: string,
  values: MergeValues,
  fallback: string,
): string {
  const row = byKey.get(systemKey);
  if (!row?.customized || !row.body.trim()) return fallback;
  return applyMergeFields(row.body, values);
}

export function applySystemSubjectIfCustom(
  systemKey: string,
  values: MergeValues,
  fallback: string,
): string {
  const row = byKey.get(systemKey);
  if (!row?.customized || !row.subject.trim()) return fallback;
  return applyMergeFields(row.subject, values);
}

export function seedBodyFor(systemKey: string): string {
  return SYSTEM_TEMPLATE_SEEDS.find((s) => s.systemKey === systemKey)?.body ?? '';
}
