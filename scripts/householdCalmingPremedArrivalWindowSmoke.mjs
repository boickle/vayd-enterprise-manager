/**
 * Smoke: mixed Pre-Meds + Standard household pins the stop to the Pre-Meds (~1hr)
 * window without changing sibling appointment types.
 *
 * Thread: bugs-scout 1790342445.020949 (Morgan / Deirdre).
 *
 * Run: node scripts/householdCalmingPremedArrivalWindowSmoke.mjs
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function normalizeAppointmentTypeName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ');
}

function appointmentTypeNameLooksLikeCalmingPremed(name, prettyName) {
  const key = normalizeAppointmentTypeName(name);
  const pretty = normalizeAppointmentTypeName(prettyName);
  const blob = `${key} ${pretty}`.trim();
  if (!blob) return false;
  return (
    blob.includes('pre med') ||
    blob.includes('premed') ||
    blob.includes('pre appt med') ||
    blob.includes('pre-appt med') ||
    (blob.includes('pre') && blob.includes('med'))
  );
}

function findCalmingPremedAppointmentType(types) {
  if (!types?.length) return undefined;
  const flagged = types.find((t) => t.isCalmingPremedType === true && t.isDeleted !== true);
  if (flagged) return flagged;
  return types.find((t) => {
    if (t.isDeleted === true) return false;
    return appointmentTypeNameLooksLikeCalmingPremed(t.name, t.prettyName);
  });
}

function carrierIsCalmingPremed(carrier, catalog) {
  if (carrier == null) return false;
  const catalogPremed = findCalmingPremedAppointmentType(catalog);
  if (typeof carrier === 'string') {
    const name = carrier.trim();
    if (!name) return false;
    if (catalogPremed) {
      const n = normalizeAppointmentTypeName(name);
      if (
        n === normalizeAppointmentTypeName(catalogPremed.name) ||
        n === normalizeAppointmentTypeName(catalogPremed.prettyName)
      ) {
        return true;
      }
    }
    return appointmentTypeNameLooksLikeCalmingPremed(name);
  }
  if (carrier.isCalmingPremedType === true) return true;
  if (
    catalogPremed?.id != null &&
    carrier.id != null &&
    Number(carrier.id) === Number(catalogPremed.id)
  ) {
    return true;
  }
  return appointmentTypeNameLooksLikeCalmingPremed(carrier.name, carrier.prettyName);
}

function trimWindow(ew) {
  const startIso = ew?.startIso?.trim() || '';
  const endIso = ew?.endIso?.trim() || '';
  if (!startIso || !endIso) return null;
  return { startIso, endIso };
}

function unionWindows(windows) {
  if (windows.length === 0) return undefined;
  let startIso = windows[0].startIso;
  let endIso = windows[0].endIso;
  for (let i = 1; i < windows.length; i++) {
    const w = windows[i];
    const w0 = Date.parse(startIso);
    const w1 = Date.parse(endIso);
    const n0 = Date.parse(w.startIso);
    const n1 = Date.parse(w.endIso);
    if (Number.isFinite(n0) && (!Number.isFinite(w0) || n0 < w0)) startIso = w.startIso;
    if (Number.isFinite(n1) && (!Number.isFinite(w1) || n1 > w1)) endIso = w.endIso;
  }
  return { startIso, endIso };
}

/** Mirrors resolveClumpArrivalWindowWithCalmingPremedOverride (no recompute path). */
function resolveClumpArrivalWindowWithCalmingPremedOverride(items, opts = {}) {
  const catalog = opts.catalog;
  const premedItems = items.filter((item) => carrierIsCalmingPremed(item.appointmentType, catalog));
  if (premedItems.length > 0) {
    const premedWindows = [];
    for (const item of premedItems) {
      const win = trimWindow(item.effectiveWindow);
      if (win) premedWindows.push(win);
    }
    return {
      effectiveWindow: unionWindows(premedWindows),
      pinnedByCalmingPremed: true,
    };
  }
  const allWindows = [];
  for (const item of items) {
    const win = trimWindow(item.effectiveWindow);
    if (win) allWindows.push(win);
  }
  return {
    effectiveWindow: unionWindows(allWindows),
    pinnedByCalmingPremed: false,
  };
}

const start = '2026-10-15T15:00:00.000Z';
const premedWindow = {
  startIso: '2026-10-15T14:30:00.000Z',
  endIso: '2026-10-15T15:30:00.000Z',
};
const standardWindow = {
  startIso: '2026-10-15T14:00:00.000Z',
  endIso: '2026-10-15T16:00:00.000Z',
};

const catalog = [
  { id: 1, name: 'Standard', prettyName: 'Standard', isCalmingPremedType: false },
  {
    id: 2,
    name: 'Pre-Meds',
    prettyName: 'Needs Pre-Meds',
    isCalmingPremedType: true,
    windowBeforeMinutes: 30,
    windowAfterMinutes: 30,
  },
];

// --- Mixed household: Pre-Meds wins (does not union with Standard 2hr) ---
const mixed = resolveClumpArrivalWindowWithCalmingPremedOverride(
  [
    {
      appointmentType: { id: 2, name: 'Pre-Meds', isCalmingPremedType: true },
      effectiveWindow: premedWindow,
      scheduledStartIso: start,
    },
    {
      appointmentType: { id: 1, name: 'Standard' },
      effectiveWindow: standardWindow,
      scheduledStartIso: start,
    },
  ],
  { catalog },
);

assert(mixed.pinnedByCalmingPremed === true, 'mixed clump should pin by Pre-Meds');
assert(
  mixed.effectiveWindow?.startIso === premedWindow.startIso &&
    mixed.effectiveWindow?.endIso === premedWindow.endIso,
  'mixed clump must use Pre-Meds 1hr window, not Standard 2hr union'
);

// --- Name-only doctor-day rows (string appointmentType) ---
const byName = resolveClumpArrivalWindowWithCalmingPremedOverride(
  [
    {
      appointmentType: 'Pre-Meds',
      effectiveWindow: premedWindow,
    },
    {
      appointmentType: 'Standard',
      effectiveWindow: standardWindow,
    },
  ],
  { catalog },
);
assert(byName.pinnedByCalmingPremed === true, 'string Pre-Meds type should pin');
assert(
  byName.effectiveWindow?.startIso === premedWindow.startIso,
  'string Pre-Meds type should keep 1hr window'
);

// --- No Pre-Meds: legacy union (widest) ---
const noPremed = resolveClumpArrivalWindowWithCalmingPremedOverride([
  { appointmentType: 'Standard', effectiveWindow: standardWindow },
  {
    appointmentType: 'Tech',
    effectiveWindow: {
      startIso: '2026-10-15T14:15:00.000Z',
      endIso: '2026-10-15T15:45:00.000Z',
    },
  },
]);
assert(noPremed.pinnedByCalmingPremed === false, 'no Pre-Meds should not pin');
assert(
  noPremed.effectiveWindow?.startIso === standardWindow.startIso &&
    noPremed.effectiveWindow?.endIso === standardWindow.endIso,
  'without Pre-Meds, union should keep widest window'
);

// --- Sibling stamp keeps types distinct ---
function applyOverrides(appts) {
  const resolved = resolveClumpArrivalWindowWithCalmingPremedOverride(
    appts.map((a) => ({
      appointmentType: a.appointmentType,
      effectiveWindow: a.effectiveWindow,
    })),
    { catalog },
  );
  if (!resolved.pinnedByCalmingPremed || !resolved.effectiveWindow) return appts;
  return appts.map((a) => ({
    ...a,
    effectiveWindow: resolved.effectiveWindow,
  }));
}

const stamped = applyOverrides([
  {
    id: 10,
    appointmentType: { id: 2, name: 'Pre-Meds', isCalmingPremedType: true },
    effectiveWindow: premedWindow,
  },
  {
    id: 11,
    appointmentType: { id: 1, name: 'Standard' },
    effectiveWindow: standardWindow,
  },
]);

assert(
  stamped[0].appointmentType.name === 'Pre-Meds' && stamped[1].appointmentType.name === 'Standard',
  'appointment types (colors) must stay distinct'
);
assert(
  stamped[0].effectiveWindow.startIso === premedWindow.startIso &&
    stamped[1].effectiveWindow.startIso === premedWindow.startIso,
  'both siblings should share Pre-Meds arrival window'
);

console.log('householdCalmingPremedArrivalWindowSmoke: ok');
