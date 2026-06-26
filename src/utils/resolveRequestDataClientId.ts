import { searchClientsStaff, type ClientSearchRow } from '../api/clientsStaff';
import {
  clientDisplayNameFromRequestData,
  requestDataClientId,
  requestDataEmail,
} from './appointmentRequestDisplay';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function readList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  const s = pickStr(v);
  return s ? [s] : [];
}

function emailsFor(row: ClientSearchRow): string[] {
  const r = row as Record<string, unknown>;
  return readList(r.emails ?? r.emailAddresses ?? r.email);
}

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

/** Staff-side client id resolution — sync fields first, then search by email / name. */
export async function resolveRequestDataClientIdStaff(
  requestData: Record<string, unknown>,
): Promise<string | null> {
  const sync = requestDataClientId(requestData);
  if (sync) return sync;

  const loggedInId =
    pickStr(requestData.userId) ??
    pickStr(requestData.loggedInClientId);
  if (loggedInId) return loggedInId;

  const email = requestDataEmail(requestData);
  if (email) {
    try {
      const rows = await searchClientsStaff(email, { includeInactive: true });
      const target = normalizeEmail(email);
      const exact = rows.find((r) =>
        emailsFor(r).some((e) => normalizeEmail(e) === target),
      );
      if (exact?.id != null) return String(exact.id);
      if (rows.length === 1 && rows[0]?.id != null) return String(rows[0].id);
    } catch {
      /* fall through */
    }
  }

  const fn = pickStr((requestData.fullName as { first?: string })?.first);
  const ln = pickStr((requestData.fullName as { last?: string })?.last);
  const nameQuery = [fn, ln].filter(Boolean).join(' ').trim() || clientDisplayNameFromRequestData(requestData);
  if (nameQuery && nameQuery !== 'Unknown') {
    try {
      const rows = await searchClientsStaff(nameQuery, { includeInactive: true });
      if (rows.length === 1 && rows[0]?.id != null) return String(rows[0].id);
      if (fn && ln) {
        const match = rows.find(
          (r) =>
            pickStr(r.firstName)?.toLowerCase() === fn.toLowerCase() &&
            pickStr(r.lastName)?.toLowerCase() === ln.toLowerCase(),
        );
        if (match?.id != null) return String(match.id);
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}
