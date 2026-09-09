/**
 * Smoke: HOLD - 1 hour Calculate Time minutes stay at 60 (not stats/fallback 45).
 * Run: node scripts/routingHoldOneHourMinutesSmoke.mjs
 *
 * Mirrors helpers in src/utils/routingServiceMinutes.ts
 */

const ROUTING_FALLBACK_SERVICE_MINUTES = 45;
const ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS = 5;

function normalizeAppointmentType(name) {
  const s = (name && String(name).trim()) || '';
  if (!s) return 'Other';
  if (s.toLowerCase().startsWith('tech appointment')) return 'Tech appointment';
  return s;
}

function parseExplicitDurationMinutesFromTypeLabel(label) {
  const s = String(label ?? '').trim().toLowerCase();
  if (!s) return null;

  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (Number.isFinite(hours) && hours > 0) return Math.max(1, Math.round(hours * 60));
  }

  const minMatch = s.match(/(\d+)\s*(?:minutes?|mins?)\b/);
  if (minMatch) {
    const mins = Number(minMatch[1]);
    if (Number.isFinite(mins) && mins > 0) return Math.max(1, Math.round(mins));
  }

  return null;
}

function isHoldTypeForRoutingServiceMinutes(matchedType, typeKey) {
  if (matchedType?.isHold === true) return true;
  const labels = [matchedType?.name, matchedType?.prettyName, typeKey]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return labels.some((label) => /\bhold\b/i.test(label));
}

function defaultDurationMinutesForRoutingTypeSelection(matchedType, pets) {
  const dur = matchedType?.defaultDuration != null ? Number(matchedType.defaultDuration) : NaN;
  if (!Number.isFinite(dur) || dur <= 0) return null;
  const petCount = Math.max(1, Math.floor(pets) || 1);
  return Math.round(dur * petCount);
}

function holdTypeBaseServiceMinutes(matchedType, typeKey, pets) {
  if (!isHoldTypeForRoutingServiceMinutes(matchedType, typeKey)) return null;

  const petCount = Math.max(1, Math.floor(Number(pets)) || 1);
  const labels = [matchedType?.name, matchedType?.prettyName, typeKey];
  for (const label of labels) {
    const parsed = parseExplicitDurationMinutesFromTypeLabel(label);
    if (parsed != null) return Math.round(parsed * petCount);
  }

  return defaultDurationMinutesForRoutingTypeSelection(matchedType, petCount);
}

function routingApptTypeStatsMeetMinInstances(
  row,
  minInstances = ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS
) {
  return row.count + row.multipetCount >= minInstances;
}

function estimatedServiceMinutesFromStatsRow(row, pets) {
  const n = Math.floor(Number(pets));
  const petCount = Number.isFinite(n) && n >= 1 ? n : 1;
  const hasSingle = row.count > 0 && row.avgMinutes > 0;
  const mp = row.multipetAvgMinutes;
  const hasMp = mp != null && mp > 0;

  if (petCount === 1) {
    if (hasSingle) return Math.round(row.avgMinutes);
    if (hasMp) return Math.round(mp);
    return null;
  }
  if (hasMp) return Math.round(mp * petCount);
  if (hasSingle) return Math.round(row.avgMinutes * petCount);
  return null;
}

function resolveRoutingApptStatsRow(typeKey, apptLengthsRows, matchedType) {
  const key = typeKey.trim();
  if (!key) return undefined;
  const statsByNorm = new Map();
  for (const row of apptLengthsRows) {
    const norm = normalizeAppointmentType(row.typeName);
    if (norm) statsByNorm.set(norm, row);
  }
  const norm = normalizeAppointmentType(key);
  const prettyNorm = matchedType?.prettyName
    ? normalizeAppointmentType(String(matchedType.prettyName))
    : '';
  return (
    statsByNorm.get(norm) ??
    (prettyNorm ? statsByNorm.get(prettyNorm) : undefined) ??
    apptLengthsRows.find((row) => {
      const rowNorm = normalizeAppointmentType(row.typeName);
      return rowNorm === norm || (prettyNorm !== '' && rowNorm === prettyNorm);
    })
  );
}

function estimateRoutingBaseServiceMinutesForSelection(
  typeKey,
  pets,
  apptLengthsRows,
  resolveType
) {
  const key = typeKey.trim();
  if (!key) return null;
  const matched = resolveType(key);

  const holdMins = holdTypeBaseServiceMinutes(matched, key, pets);
  if (holdMins != null && holdMins >= 1) return holdMins;
  if (isHoldTypeForRoutingServiceMinutes(matched, key)) {
    return ROUTING_FALLBACK_SERVICE_MINUTES;
  }

  const row = resolveRoutingApptStatsRow(key, apptLengthsRows, matched);
  let mins = null;
  if (row && routingApptTypeStatsMeetMinInstances(row)) {
    mins = estimatedServiceMinutesFromStatsRow(row, pets);
  }
  if (mins == null || mins < 1) {
    mins = defaultDurationMinutesForRoutingTypeSelection(matched, pets);
  }
  if (mins == null || mins < 1) {
    mins = ROUTING_FALLBACK_SERVICE_MINUTES;
  }
  return mins;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pollutedHoldStats = [
  {
    typeName: 'HOLD - 1 hour',
    avgMinutes: 45,
    count: 12,
    multipetAvgMinutes: null,
    multipetCount: 0,
  },
];

const holdOneHour = {
  id: 99,
  name: 'HOLD - 1 hour',
  prettyName: 'HOLD - 1 hour',
  defaultDuration: 45, // settings often left at create-form default
  isHold: true,
};

const resolveHold = (key) =>
  key === 'HOLD - 1 hour' || key === holdOneHour.name ? holdOneHour : undefined;

assert(
  parseExplicitDurationMinutesFromTypeLabel('HOLD - 1 hour') === 60,
  'HOLD - 1 hour label parses to 60'
);
assert(
  parseExplicitDurationMinutesFromTypeLabel('HOLD – 30 min') === 30,
  'HOLD 30 min label parses to 30'
);
assert(
  parseExplicitDurationMinutesFromTypeLabel('HOLD - In Office') == null,
  'HOLD without duration does not invent minutes'
);

assert(
  estimateRoutingBaseServiceMinutesForSelection(
    'HOLD - 1 hour',
    1,
    pollutedHoldStats,
    resolveHold
  ) === 60,
  'HOLD - 1 hour wins over polluted 45-min historical average'
);

assert(
  estimateRoutingBaseServiceMinutesForSelection(
    'HOLD - 1 hour',
    2,
    pollutedHoldStats,
    resolveHold
  ) === 120,
  'HOLD - 1 hour scales by pet count'
);

const holdNoLabel = {
  id: 100,
  name: 'HOLD',
  prettyName: 'HOLD',
  defaultDuration: 60,
  isHold: true,
};
assert(
  estimateRoutingBaseServiceMinutesForSelection('HOLD', 1, pollutedHoldStats, (key) =>
    key === 'HOLD' ? holdNoLabel : undefined
  ) === 60,
  'HOLD without label duration uses catalog defaultDuration (skips stats)'
);

const euth = {
  id: 2,
  name: 'Euthanasia',
  prettyName: 'Euthanasia',
  defaultDuration: 90,
  isHold: false,
};
assert(
  estimateRoutingBaseServiceMinutesForSelection(
    'Euthanasia',
    1,
    [{ typeName: 'Euthanasia', avgMinutes: 75, count: 10, multipetAvgMinutes: null, multipetCount: 0 }],
    (key) => (key === 'Euthanasia' ? euth : undefined)
  ) === 75,
  'non-HOLD types still prefer doctor stats when available'
);

console.log('routingHoldOneHourMinutesSmoke: ok');
