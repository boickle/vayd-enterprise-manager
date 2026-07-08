/**
 * Scout-owned Gmail compose templates (canned responses).
 *
 * Gmail's native "Templates" feature is not exposed through the Gmail API, so we
 * persist templates locally per browser. Templates capture a subject + body that
 * staff can insert into a compose, plus save / overwrite / delete management.
 */
export type GmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: string;
};

const STORAGE_KEY = 'scout.gmailTemplates.v1';

function isTemplate(value: unknown): value is GmailTemplate {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.subject === 'string' &&
    typeof t.body === 'string'
  );
}

function readRaw(): GmailTemplate[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTemplate) : [];
  } catch {
    return [];
  }
}

function writeRaw(list: GmailTemplate[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore storage quota / private mode */
  }
}

function sortByName(list: GmailTemplate[]): GmailTemplate[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function newId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** All saved templates, sorted by name. */
export function loadGmailTemplates(): GmailTemplate[] {
  return sortByName(readRaw());
}

/** Add a new template; returns the updated (sorted) list. */
export function createGmailTemplate(input: {
  name: string;
  subject: string;
  body: string;
}): GmailTemplate[] {
  const list = readRaw();
  list.push({
    id: newId(),
    name: input.name.trim(),
    subject: input.subject,
    body: input.body,
    updatedAt: new Date().toISOString(),
  });
  writeRaw(list);
  return sortByName(list);
}

/** Replace an existing template's subject/body (and optional name). */
export function overwriteGmailTemplate(
  id: string,
  input: { subject: string; body: string; name?: string },
): GmailTemplate[] {
  const list = readRaw().map((t) =>
    t.id === id
      ? {
          ...t,
          subject: input.subject,
          body: input.body,
          name: input.name?.trim() || t.name,
          updatedAt: new Date().toISOString(),
        }
      : t,
  );
  writeRaw(list);
  return sortByName(list);
}

/** Remove a template; returns the updated list. */
export function deleteGmailTemplate(id: string): GmailTemplate[] {
  const list = readRaw().filter((t) => t.id !== id);
  writeRaw(list);
  return sortByName(list);
}
