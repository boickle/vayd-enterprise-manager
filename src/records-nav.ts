/** Records requests: its own item under Scheduling (owner, Nov 13, 2026; was a Scheduling Tools tab). */
export const RECORDS_PATH = '/schedule/records';

/** The Records page, optionally filtered to a search (client name, pet, hospital). */
export function recordsPath(q?: string): string {
  return q ? `${RECORDS_PATH}?q=${encodeURIComponent(q)}` : RECORDS_PATH;
}
