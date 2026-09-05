/** Staff layout prefs (client + patient record sections). Cached locally; mirrored on the user row. */

import { patchUserUiPrefs } from '../api/users';

export type StaffClientLayout = {
  pets: boolean;
  visits: boolean;
  prefs: boolean;
  household: boolean;
  comms: boolean;
  contact: boolean;
};

export type StaffPatientLayout = {
  /** true = section expanded */
  visits: boolean;
  reminders: boolean;
  casePrep: boolean;
  weight: boolean;
};

export const DEFAULT_STAFF_CLIENT_LAYOUT: StaffClientLayout = {
  pets: true,
  visits: true,
  prefs: true,
  household: true,
  comms: true,
  contact: false,
};

export const DEFAULT_STAFF_PATIENT_LAYOUT: StaffPatientLayout = {
  visits: false,
  reminders: false,
  casePrep: true,
  weight: false,
};

function clientStorageKey(userId: string): string {
  return `scout.staffUi.clientLayout.${userId}`;
}

function patientStorageKey(userId: string): string {
  return `scout.staffUi.patientLayout.${userId}`;
}

/** users.id from GET /users — preferred over JWT clientId/sub mix. */
let resolvedUserId: string | null = null;

function prefUserId(hint?: string | null): string | null {
  return resolvedUserId || hint || null;
}

function asClientLayout(raw: unknown): StaffClientLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<StaffClientLayout>;
  return {
    pets: parsed.pets !== false,
    visits: parsed.visits !== false,
    prefs: parsed.prefs !== false,
    household: parsed.household !== false,
    comms: parsed.comms !== false,
    contact: parsed.contact === true,
  };
}

function asPatientLayout(raw: unknown): StaffPatientLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<StaffPatientLayout>;
  return {
    visits: parsed.visits === true,
    reminders: parsed.reminders === true,
    casePrep: parsed.casePrep !== false,
    weight: parsed.weight === true,
  };
}

export function readStaffClientLayout(userId: string | null | undefined): StaffClientLayout {
  userId = prefUserId(userId);
  if (!userId || typeof localStorage === 'undefined') return { ...DEFAULT_STAFF_CLIENT_LAYOUT };
  try {
    const raw = localStorage.getItem(clientStorageKey(userId));
    if (!raw) return { ...DEFAULT_STAFF_CLIENT_LAYOUT };
    return asClientLayout(JSON.parse(raw)) ?? { ...DEFAULT_STAFF_CLIENT_LAYOUT };
  } catch {
    return { ...DEFAULT_STAFF_CLIENT_LAYOUT };
  }
}

export function readStaffPatientLayout(userId: string | null | undefined): StaffPatientLayout {
  userId = prefUserId(userId);
  if (!userId || typeof localStorage === 'undefined') return { ...DEFAULT_STAFF_PATIENT_LAYOUT };
  try {
    const raw = localStorage.getItem(patientStorageKey(userId));
    if (!raw) return { ...DEFAULT_STAFF_PATIENT_LAYOUT };
    return asPatientLayout(JSON.parse(raw)) ?? { ...DEFAULT_STAFF_PATIENT_LAYOUT };
  } catch {
    return { ...DEFAULT_STAFF_PATIENT_LAYOUT };
  }
}

function writeClientLocal(userId: string, layout: StaffClientLayout) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(clientStorageKey(userId), JSON.stringify(layout));
  } catch {
    /* ignore quota / private mode */
  }
}

function writePatientLocal(userId: string, layout: StaffPatientLayout) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(patientStorageKey(userId), JSON.stringify(layout));
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
  const prefs = uiPrefs && typeof uiPrefs === 'object' ? (uiPrefs as Record<string, unknown>) : null;

  const serverClient = asClientLayout(prefs?.clientLayout);
  if (serverClient) {
    writeClientLocal(userId, serverClient);
  } else {
    const localKey = clientStorageKey(userId);
    const hadLocal =
      typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(localKey));
    if (hadLocal) {
      schedulePersistClient(userId, readStaffClientLayout(userId));
    }
  }

  const serverPatient = asPatientLayout(prefs?.patientLayout);
  if (serverPatient) {
    writePatientLocal(userId, serverPatient);
  } else {
    const localKey = patientStorageKey(userId);
    const hadLocal =
      typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(localKey));
    if (hadLocal) {
      schedulePersistPatient(userId, readStaffPatientLayout(userId));
    }
  }

  notifyPrefsChanged();
  return serverClient;
}

let persistClientTimer: ReturnType<typeof setTimeout> | null = null;
let persistClientUserId: string | null = null;
let persistClientLayout: StaffClientLayout | null = null;

function schedulePersistClient(userId: string, layout: StaffClientLayout) {
  persistClientUserId = userId;
  persistClientLayout = layout;
  if (persistClientTimer) clearTimeout(persistClientTimer);
  persistClientTimer = setTimeout(() => {
    persistClientTimer = null;
    const id = persistClientUserId;
    const next = persistClientLayout;
    if (!id || !next) return;
    void patchUserUiPrefs({ clientLayout: next }).catch(() => {
      /* keep the local cache; next login on this browser still works */
    });
  }, 400);
}

let persistPatientTimer: ReturnType<typeof setTimeout> | null = null;
let persistPatientUserId: string | null = null;
let persistPatientLayout: StaffPatientLayout | null = null;

function schedulePersistPatient(userId: string, layout: StaffPatientLayout) {
  persistPatientUserId = userId;
  persistPatientLayout = layout;
  if (persistPatientTimer) clearTimeout(persistPatientTimer);
  persistPatientTimer = setTimeout(() => {
    persistPatientTimer = null;
    const id = persistPatientUserId;
    const next = persistPatientLayout;
    if (!id || !next) return;
    void patchUserUiPrefs({ patientLayout: next }).catch(() => {
      /* keep the local cache */
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
  writeClientLocal(userId, next);
  schedulePersistClient(userId, next);
  return next;
}

export function writeStaffPatientLayout(
  userId: string | null | undefined,
  patch: Partial<StaffPatientLayout>,
): StaffPatientLayout {
  const next = { ...readStaffPatientLayout(userId), ...patch };
  userId = prefUserId(userId);
  if (!userId) return next;
  writePatientLocal(userId, next);
  schedulePersistPatient(userId, next);
  return next;
}
