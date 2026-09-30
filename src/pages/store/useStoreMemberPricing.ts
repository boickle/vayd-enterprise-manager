import { useEffect, useState } from 'react';
import { listMyStoreMemberDiscounts } from '../../api/onlineStore';
import { fetchClientPets, type Pet } from '../../api/clientPortal';
import { useAuth } from '../../auth/useAuth';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type StoreMemberPricing = {
  loggedIn: boolean;
  loading: boolean;
  pets: Pet[];
  /** patientId → percent off for that pet. */
  discounts: Record<number, number>;
};

export function petDbId(pet: Pet): number | null {
  const raw = pet.dbId ?? pet.id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const EMPTY: StoreMemberPricing = {
  loggedIn: false,
  loading: false,
  pets: [],
  discounts: {},
};

/**
 * Shared so the storefront banner and the cart read one copy of the household's
 * member pricing instead of each hitting the API on every mount.
 */
let cacheClientId: number | null = null;
let cached: { pets: Pet[]; discounts: Record<number, number> } | null = null;
let inFlight: Promise<{ pets: Pet[]; discounts: Record<number, number> }> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function load(clientId: number) {
  if (cacheClientId !== clientId) {
    cacheClientId = clientId;
    cached = null;
    inFlight = null;
  }
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = Promise.all([
    fetchClientPets().catch(() => [] as Pet[]),
    listMyStoreMemberDiscounts(PRACTICE_ID).catch(() => []),
  ])
    .then(([pets, rows]) => {
      const next = {
        pets,
        discounts: Object.fromEntries(rows.map((row) => [row.patientId, row.percent])),
      };
      // A later client switch may have already moved the cache on.
      if (cacheClientId === clientId) {
        cached = next;
        notify();
      }
      return next;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Drop the cache so the next read refetches (membership bought, logout, …). */
export function resetStoreMemberPricing() {
  cacheClientId = null;
  cached = null;
  inFlight = null;
  notify();
}

export function useStoreMemberPricing(): StoreMemberPricing {
  const auth = useAuth() as { token?: string | null; userId?: string | null };
  const clientId = auth.userId && Number.isFinite(Number(auth.userId)) ? Number(auth.userId) : null;
  const loggedIn = Boolean(auth.token && clientId);
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!loggedIn || clientId == null) return;
    let canceled = false;
    void load(clientId).then(() => {
      if (!canceled) setTick((n) => n + 1);
    });
    return () => {
      canceled = true;
    };
  }, [loggedIn, clientId]);

  if (!loggedIn || clientId == null) return EMPTY;
  const ready = cacheClientId === clientId && cached;
  if (!ready) return { loggedIn: true, loading: true, pets: [], discounts: {} };
  return { loggedIn: true, loading: false, pets: cached!.pets, discounts: cached!.discounts };
}
