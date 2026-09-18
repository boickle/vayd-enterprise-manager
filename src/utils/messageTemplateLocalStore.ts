import { STARTER_STAFF_TEMPLATES, SYSTEM_TEMPLATE_SEEDS } from './messageTemplateSeeds';
import type { MessageTemplate, MessageTemplateWrite } from './messageTemplateTypes';

const KEY = 'scout.messageTemplates.v1';
const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function seedRows(): MessageTemplate[] {
  const stamped = nowIso();
  const system = SYSTEM_TEMPLATE_SEEDS.map((s) => ({
    id: `sys_${s.systemKey}`,
    practiceId: PRACTICE_ID,
    name: s.name,
    description: s.description,
    channel: s.channel,
    category: s.category,
    subject: s.subject,
    body: s.body,
    systemKey: s.systemKey,
    isSystem: true,
    isCustomized: false,
    isActive: true,
    createdAt: stamped,
    updatedAt: stamped,
  }));
  const staff = STARTER_STAFF_TEMPLATES.map((s) => ({
    id: `staff_${s.starterKey}`,
    practiceId: PRACTICE_ID,
    name: s.name,
    description: s.description,
    channel: s.channel,
    category: s.category,
    subject: s.subject,
    body: s.body,
    systemKey: null,
    isSystem: false,
    isCustomized: false,
    isActive: true,
    createdAt: stamped,
    updatedAt: stamped,
  }));
  return [...system, ...staff];
}

function read(): MessageTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const seeded = seedRows();
      write(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as MessageTemplate[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seeded = seedRows();
      write(seeded);
      return seeded;
    }
    return parsed;
  } catch {
    return seedRows();
  }
}

function write(rows: MessageTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

function sortRows(rows: MessageTemplate[]): MessageTemplate[] {
  return [...rows].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function localListMessageTemplates(): MessageTemplate[] {
  return sortRows(read());
}

export function localCreateMessageTemplate(input: MessageTemplateWrite): MessageTemplate {
  const stamped = nowIso();
  const row: MessageTemplate = {
    id: newId('tpl'),
    practiceId: PRACTICE_ID,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    channel: input.channel,
    category: input.category ?? 'general',
    subject: input.subject ?? '',
    body: input.body,
    systemKey: null,
    isSystem: false,
    isCustomized: false,
    isActive: input.isActive !== false,
    createdAt: stamped,
    updatedAt: stamped,
  };
  write([row, ...read()]);
  return row;
}

export function localPatchMessageTemplate(
  id: string,
  input: Partial<MessageTemplateWrite>,
): MessageTemplate {
  const rows = read();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error('Template not found');
  const prev = rows[idx]!;
  const next: MessageTemplate = {
    ...prev,
    name: input.name?.trim() ?? prev.name,
    description: input.description !== undefined ? input.description.trim() : prev.description,
    channel: input.channel ?? prev.channel,
    category: input.category ?? prev.category,
    subject: input.subject ?? prev.subject,
    body: input.body ?? prev.body,
    isActive: input.isActive ?? prev.isActive,
    isCustomized: prev.isSystem ? true : prev.isCustomized,
    updatedAt: nowIso(),
  };
  rows[idx] = next;
  write(rows);
  return next;
}

export function localDeleteMessageTemplate(id: string): void {
  const row = read().find((r) => r.id === id);
  if (row?.isSystem) throw new Error('Automatic templates cannot be deleted.');
  write(read().filter((r) => r.id !== id));
}

export function localResetMessageTemplate(id: string): MessageTemplate {
  const rows = read();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error('Template not found');
  const prev = rows[idx]!;
  if (!prev.systemKey) throw new Error('Only automatic templates can be reset.');
  const seed = (awaitImportSeed(prev.systemKey));
  const next: MessageTemplate = {
    ...prev,
    name: seed?.name ?? prev.name,
    description: seed?.description ?? prev.description,
    subject: seed?.subject ?? '',
    body: seed?.body ?? '',
    isCustomized: false,
    updatedAt: nowIso(),
  };
  rows[idx] = next;
  write(rows);
  return next;
}

function awaitImportSeed(systemKey: string) {
  return SYSTEM_TEMPLATE_SEEDS.find((s) => s.systemKey === systemKey);
}
