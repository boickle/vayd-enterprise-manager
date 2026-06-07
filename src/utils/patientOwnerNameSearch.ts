import type { PatientSearchRow } from '../api/patients';
import { clientsForPatientSearchRow } from './pimsPatientSearchRow';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function tokenizePatientOwnerSearchQuery(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean);
}

export function patientDisplayNameFromRow(row: PatientSearchRow): string {
  const r = row as Record<string, unknown>;
  const joined = [pickStr(row.firstName), pickStr(row.lastName)].filter(Boolean).join(' ').trim();
  return (pickStr(row.name) ?? pickStr(r.patientName) ?? joined) || 'Patient';
}

function petFirstTokenFromRow(row: PatientSearchRow): string {
  const fn = pickStr(row.firstName);
  if (fn) return fn.split(/\s+/).filter(Boolean)[0] ?? fn;
  const display = patientDisplayNameFromRow(row);
  return display.split(/\s+/).filter(Boolean)[0] ?? display;
}

function clientNamesForRow(row: PatientSearchRow): string[] {
  const names: string[] = [];
  const r = row as Record<string, unknown>;
  const ownerJoined = [pickStr(r.clientFirstName), pickStr(r.clientLastName)].filter(Boolean).join(' ').trim();
  if (ownerJoined) names.push(ownerJoined);
  const cln = pickStr(r.clientLastName);
  if (cln) names.push(cln);
  const cl = pickStr(r.clientName) ?? pickStr(r.ownerName);
  if (cl) names.push(cl);
  for (const c of clientsForPatientSearchRow(row)) {
    if (c.name.trim()) names.push(c.name.trim());
  }
  return names;
}

function clientFirstLastFromName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    first: (parts[0] ?? '').toLowerCase(),
    last: (parts[parts.length - 1] ?? '').toLowerCase(),
  };
}

function clientPartsFromRow(row: PatientSearchRow): Array<{ first: string; last: string; full: string }> {
  const out: Array<{ first: string; last: string; full: string }> = [];
  const seen = new Set<string>();
  const r = row as Record<string, unknown>;
  const fn = pickStr(r.clientFirstName);
  const ln = pickStr(r.clientLastName);
  if (fn || ln) {
    const full = [fn, ln].filter(Boolean).join(' ').toLowerCase();
    if (!seen.has(full)) {
      seen.add(full);
      out.push({ first: (fn ?? '').toLowerCase(), last: (ln ?? '').toLowerCase(), full });
    }
  }
  for (const name of clientNamesForRow(row)) {
    const full = name.toLowerCase();
    if (seen.has(full)) continue;
    seen.add(full);
    const { first, last } = clientFirstLastFromName(name);
    out.push({ first, last, full });
  }
  return out;
}

function clientTextMatchesQuery(clientText: string, clientQuery: string): boolean {
  const name = clientText.toLowerCase();
  const q = clientQuery.toLowerCase();
  if (!q) return true;
  if (name.includes(q)) return true;
  const parts = name.split(/\s+/).filter(Boolean);
  const lastName = parts[parts.length - 1]?.toLowerCase() ?? '';
  if (lastName && (lastName.includes(q) || q.includes(lastName))) return true;
  const qParts = q.split(/\s+/).filter(Boolean);
  return qParts.every((t) => name.includes(t) || lastName.includes(t));
}

/** True when query is "Nala" + "Wilson" style (pet given name + client surname). */
export function patientRowMatchesOwnerNameQuery(row: PatientSearchRow, tokens: string[]): boolean {
  if (tokens.length < 2) return true;

  const petToken = tokens[0]!.toLowerCase();
  const clientQuery = tokens.slice(1).join(' ').trim();
  if (!petToken || !clientQuery) return true;

  const petFirst = petFirstTokenFromRow(row).toLowerCase();
  const display = patientDisplayNameFromRow(row).toLowerCase();
  const petMatches =
    petFirst === petToken ||
    petFirst.startsWith(petToken) ||
    display.startsWith(`${petToken} `) ||
    display.split(/\s+/).some((w) => w.startsWith(petToken));
  if (!petMatches) return false;

  return clientNamesForRow(row).some((n) => clientTextMatchesQuery(n, clientQuery));
}

/** True when tokens match client first + last (e.g. Elise Smith as the person). */
export function patientRowMatchesClientPersonQuery(row: PatientSearchRow, tokens: string[]): boolean {
  if (tokens.length < 2) return true;
  const t0 = tokens[0]!.toLowerCase();
  const tLast = tokens[tokens.length - 1]!.toLowerCase();
  const query = tokens.join(' ').toLowerCase();

  return clientPartsFromRow(row).some(({ first, last, full }) => {
    if (full.includes(query)) return true;
    if (!first || !last) return false;
    const firstOk = first === t0 || first.startsWith(t0);
    const lastOk = last === tLast || last.startsWith(tLast);
    return firstOk && lastOk;
  });
}

export type ClientNameLike = {
  firstName?: string;
  lastName?: string;
  [key: string]: unknown;
};

export function clientRowDisplayName(c: ClientNameLike): string {
  const joined = [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim();
  const name = pickStr(c.name);
  return joined || name || '';
}

export function clientRowMatchesNameTokens(c: ClientNameLike, tokens: string[]): boolean {
  if (tokens.length < 2) return true;
  const t0 = tokens[0]!.toLowerCase();
  const tLast = tokens[tokens.length - 1]!.toLowerCase();
  const first = (pickStr(c.firstName) ?? '').toLowerCase();
  const last = (pickStr(c.lastName) ?? '').toLowerCase();
  const full = clientRowDisplayName(c).toLowerCase();
  const query = tokens.join(' ').toLowerCase();

  if (full.includes(query)) return true;
  if (first && last) {
    const firstOk = first === t0 || first.startsWith(t0);
    const lastOk = last === tLast || last.startsWith(tLast);
    if (firstOk && lastOk) return true;
  }
  const parsed = clientFirstLastFromName(full);
  if (parsed.first && parsed.last) {
    const firstOk = parsed.first === t0 || parsed.first.startsWith(t0);
    const lastOk = parsed.last === tLast || parsed.last.startsWith(tLast);
    if (firstOk && lastOk) return true;
  }
  return false;
}

export function scorePatientSearchRow(row: PatientSearchRow, query: string): number {
  const tokens = tokenizePatientOwnerSearchQuery(query);
  const qLower = query.toLowerCase();
  let score = 0;

  const petName = patientDisplayNameFromRow(row).toLowerCase();
  const petFirst = petFirstTokenFromRow(row).toLowerCase();
  const clientParts = clientPartsFromRow(row);

  if (tokens.length >= 2) {
    const t0 = tokens[0]!.toLowerCase();
    const tLast = tokens[tokens.length - 1]!.toLowerCase();
    const queryJoined = tokens.join(' ').toLowerCase();

    for (const { first, last, full } of clientParts) {
      if (full === queryJoined) score = Math.max(score, 100);
      else if (first === t0 && last === tLast) score = Math.max(score, 98);
      else if (first.startsWith(t0) && last.startsWith(tLast)) score = Math.max(score, 88);
      else if ((first === t0 || first.startsWith(t0)) && (last === tLast || last.startsWith(tLast))) {
        score = Math.max(score, 78);
      } else if (full.includes(queryJoined)) score = Math.max(score, 72);
    }

    for (const { last } of clientParts) {
      if (petFirst === t0 && last === tLast) score = Math.max(score, 96);
      else if (petFirst.startsWith(t0) && last.startsWith(tLast)) score = Math.max(score, 82);
      else if ((petFirst === t0 || petFirst.startsWith(t0)) && (last === tLast || last.startsWith(tLast))) {
        score = Math.max(score, 74);
      }
    }

    if (patientRowMatchesOwnerNameQuery(row, tokens)) score = Math.max(score, 80);
    if (patientRowMatchesClientPersonQuery(row, tokens)) score = Math.max(score, 85);

    for (const { last } of clientParts) {
      if (last === tLast || last.startsWith(tLast)) score = Math.max(score, 18);
    }
    if (petFirst === t0 || petFirst.startsWith(t0)) score = Math.max(score, 16);
  }

  if (petName.includes(qLower)) score = Math.max(score, 52);
  for (const { full } of clientParts) {
    if (full.includes(qLower)) score = Math.max(score, 56);
  }

  if (tokens.length === 1) {
    const t = tokens[0]!.toLowerCase();
    if (petFirst === t) score = Math.max(score, 62);
    else if (petFirst.startsWith(t)) score = Math.max(score, 48);
    for (const { first, full } of clientParts) {
      if (first === t) score = Math.max(score, 58);
      else if (full.includes(t)) score = Math.max(score, 42);
    }
  }

  return score;
}

export function rankPatientSearchResults(rows: PatientSearchRow[], query: string): PatientSearchRow[] {
  if (rows.length === 0) return rows;

  const scored = rows.map((row) => ({ row, score: scorePatientSearchRow(row, query) }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return patientDisplayNameFromRow(a.row).localeCompare(patientDisplayNameFromRow(b.row), undefined, {
      sensitivity: 'base',
    });
  });

  const maxScore = scored[0]?.score ?? 0;
  if (maxScore <= 0) return rows;

  const minScore =
    maxScore >= 70 ? Math.max(25, maxScore - 45) : maxScore >= 40 ? Math.max(12, maxScore - 28) : 1;
  const filtered = scored.filter((entry) => entry.score >= minScore);
  const list = (filtered.length > 0 ? filtered : scored.slice(0, 80)).map((entry) => entry.row);
  return list;
}

export function dedupePatientSearchRows(rows: PatientSearchRow[]): PatientSearchRow[] {
  const seen = new Set<string>();
  const out: PatientSearchRow[] = [];
  for (const row of rows) {
    const key = String(row.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
