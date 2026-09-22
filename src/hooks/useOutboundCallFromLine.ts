import { useEffect, useState } from 'react';
import { fetchEmployee } from '../api/appointmentSettings';
import { fetchPracticeMainPhone } from '../api/clientPortal';
import { useAuth } from '../auth/useAuth';
import { PRACTICE_MAIN_LINE_FALLBACK } from '../utils/practicePhone';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';

const CACHE_TTL_MS = 10 * 60 * 1000;

type Cache = { fromLine: string; fetchedAt: number };
let cache: Cache | null = null;
const listeners = new Set<(line: string) => void>();

function pickLine(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

/**
 * The Quo inbox the current user should place calls from.
 *
 * Prefer their own `quoLinePhone`. Staff without one — common for people who are not
 * assigned a personal inbox — go out on the practice main line so Quo still has a
 * workspace number to originate from.
 */
async function loadFromLine(employeeId: number | null, practiceId: number): Promise<string> {
  const [emp, main] = await Promise.all([
    employeeId != null && Number.isFinite(employeeId)
      ? fetchEmployee(employeeId).catch(() => null)
      : Promise.resolve(null),
    fetchPracticeMainPhone(practiceId).catch(() => null),
  ]);
  const staff = pickLine((emp as { quoLinePhone?: string | null } | null)?.quoLinePhone);
  return staff ?? pickLine(main) ?? PRACTICE_MAIN_LINE_FALLBACK;
}

/** Quo `from` line for click-to-call. Falls back to the practice main number. */
export function useOutboundCallFromLine(): string {
  const { token, employeeId } = useAuth();
  const [fromLine, setFromLine] = useState(cache?.fromLine ?? PRACTICE_MAIN_LINE_FALLBACK);

  useEffect(() => {
    const onChange = (line: string) => setFromLine(line);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  useEffect(() => {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      setFromLine(cache.fromLine);
      return;
    }
    let cancelled = false;
    const empId = employeeId != null ? Number(employeeId) : null;
    const practiceId = resolvePracticeIdFromToken(token);
    void loadFromLine(empId, practiceId).then((line) => {
      if (cancelled) return;
      cache = { fromLine: line, fetchedAt: Date.now() };
      listeners.forEach((fn) => fn(line));
    });
    return () => {
      cancelled = true;
    };
  }, [token, employeeId]);

  return fromLine;
}
