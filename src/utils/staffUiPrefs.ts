/** Staff layout prefs (client record sections). Cached locally; mirrored on the user row. */

import { patchUserUiPrefs } from '../api/users';

export type StaffClientLayout = {
  pets: boolean;
  visits: boolean;
  prefs: boolean;
  comms: boolean;
  contact: boolean;
};

export const DEFAULT_STAFF_CLIENT_LAYOUT: StaffClientLayout = {
  pets: true,
  visits: true,
  prefs: true,
  comms: true,
  contact: false,
};

function storageKey(userId: string): string {
  return `scout.staffUi.clientLayout.${userId}`;
}

/** users.id from GET /users — preferred over JWT clientId/sub mix. */
let resolvedUserId: string | null = null;

function prefUserId(hint?: string | null): string | null {
  return resolvedUserId || hint || null;
}

function asLayout(raw: unknown): StaffClientLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<StaffClientLayout>;
  return {
    pets: parsed.pets !== false,
    visits: parsed.visits !== false,
    prefs: parsed.prefs !== false,
    comms: parsed.comms !== false,
    contact: parsed.contact === true,
  };
}

export function readStaffClientLayout(userId: string | null | undefined): StaffClientLayout {
  userId = prefUserId(userId);
  if (!userId || typeof localStorage === 'undefined') return { ...DEFAULT_STAFF_CLIENT_LAYOUT };
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULT_STAFF_CLIENT_LAYOUT };
    return asLayout(JSON.parse(raw)) ?? { ...DEFAULT_STAFF_CLIENT_LAYOUT };
  } catch {
    return { ...DEFAULT_STAFF_CLIENT_LAYOUT };
  }
}

function writeLocal(userId: string, layout: StaffClientLayout) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(layout));
  } catch {
    /* ignore quota / private mode */
  }
}

export const STAFF_UI_PREFS_EVENT = 'scout-staff-ui-prefs';

function notifyPrefsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STAFF_UI_PREFS_EVENT));
}

export function applyStaffUiPrefsFromServer(
  userId: string | null | undefined,
  uiPrefs: unknown,
): StaffClientLayout | null {
  if (!userId) return null;
  resolvedUserId = userId;
  const server = asLayout(
    uiPrefs && typeof uiPrefs === 'object'
      ? (uiPrefs as { clientLayout?: unknown }).clientLayout
      : null,
  );
  if (server) {
    writeLocal(userId, server);
    notifyPrefsChanged();
    return server;
  }
  const localKey = storageKey(userId);
  const hadLocal =
    typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(localKey));
  if (hadLocal) {
    schedulePersist(userId, readStaffClientLayout(userId));
  }
  return null;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistUserId: string | null = null;
let persistLayout: StaffClientLayout | null = null;

function schedulePersist(userId: string, layout: StaffClientLayout) {
  persistUserId = userId;
  persistLayout = layout;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const id = persistUserId;
    const next = persistLayout;
    if (!id || !next) return;
    void patchUserUiPrefs({ clientLayout: next }).catch(() => {
      /* keep the local cache; next login on this browser still works */
    });
  }, 400);
}

export function writeStaffClientLayout(
  userId: string | null | undefined,
  patch: Partial<StaffClientLayout>,
): StaffClientLayout {
  const next = { ...readStaffClientLayout(userId), ...patch };
  userId = prefUserId(userId);
  if (!userId) return next;
  writeLocal(userId, next);
  schedulePersist(userId, next);
  return next;
}
