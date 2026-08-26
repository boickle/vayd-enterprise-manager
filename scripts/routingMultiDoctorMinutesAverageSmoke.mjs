/**
 * Smoke checks for ASAP / multi-doctor Calculate Time minutes averaging.
 * Run: node scripts/routingMultiDoctorMinutesAverageSmoke.mjs
 *
 * Mirrors pure helpers in src/utils/routingServiceMinutes.ts
 * (`averageApptLengthStatsAcrossDoctors`).
 */

const ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS = 5;

function normalizeAppointmentType(name) {
  const s = (name && String(name).trim()) || '';
  if (!s) return 'Other';
  if (s.toLowerCase().startsWith('tech appointment')) return 'Tech appointment';
  return s;
}

function routingApptTypeStatsMeetMinInstances(row, minInstances = ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS) {
  return row.count + row.multipetCount >= minInstances;
}

function averageApptLengthStatsAcrossDoctors(perDoctorRows) {
  const byNorm = new Map();

  for (const rows of perDoctorRows) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!routingApptTypeStatsMeetMinInstances(row)) continue;
      const norm = normalizeAppointmentType(row.typeName);
      if (!norm) continue;
      let acc = byNorm.get(norm);
      if (!acc) {
        acc = {
          typeName: String(row.typeName ?? '').trim() || norm,
          singleSum: 0,
          singleN: 0,
          mpSum: 0,
          mpN: 0,
        };
        byNorm.set(norm, acc);
      }
      if (row.count > 0 && row.avgMinutes > 0) {
        acc.singleSum += row.avgMinutes;
        acc.singleN += 1;
      }
      if (row.multipetAvgMinutes != null && row.multipetAvgMinutes > 0) {
        acc.mpSum += row.multipetAvgMinutes;
        acc.mpN += 1;
      }
    }
  }

  const out = [];
  for (const acc of byNorm.values()) {
    const avgMinutes =
      acc.singleN > 0 ? Math.round((acc.singleSum / acc.singleN) * 10) / 10 : 0;
    const multipetAvgMinutes =
      acc.mpN > 0 ? Math.round((acc.mpSum / acc.mpN) * 10) / 10 : null;
    if (avgMinutes <= 0 && (multipetAvgMinutes == null || multipetAvgMinutes <= 0)) continue;
    out.push({
      typeName: acc.typeName,
      avgMinutes,
      count: avgMinutes > 0 ? ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS : 0,
      multipetAvgMinutes,
      multipetCount:
        multipetAvgMinutes != null && multipetAvgMinutes > 0
          ? ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS
          : 0,
    });
  }

  return out.sort((a, b) => {
    const totalA = a.count + a.multipetCount;
    const totalB = b.count + b.multipetCount;
    if (totalB !== totalA) return totalB - totalA;
    return a.typeName.localeCompare(b.typeName);
  });
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Doctor A euthanasia ~45, Doctor B ~60 → average 52.5 → round display 52 or 53 via Math.round on estimate
const averaged = averageApptLengthStatsAcrossDoctors([
  [
    {
      typeName: 'Euthanasia',
      avgMinutes: 45,
      count: 8,
      multipetAvgMinutes: null,
      multipetCount: 0,
    },
  ],
  [
    {
      typeName: 'Euthanasia',
      avgMinutes: 60,
      count: 6,
      multipetAvgMinutes: null,
      multipetCount: 0,
    },
  ],
  // Insufficient history — must not pull the average down
  [
    {
      typeName: 'Euthanasia',
      avgMinutes: 20,
      count: 2,
      multipetAvgMinutes: null,
      multipetCount: 0,
    },
  ],
]);

assert(averaged.length === 1, 'one type row');
assert(averaged[0].typeName === 'Euthanasia', 'type name preserved');
assert(averaged[0].avgMinutes === 52.5, `expected 52.5, got ${averaged[0].avgMinutes}`);
assert(
  routingApptTypeStatsMeetMinInstances(averaged[0]),
  'synthetic row must meet min-instance gate',
);
assert(
  estimatedServiceMinutesFromStatsRow(averaged[0], 1) === 53,
  `1-pet estimate should round 52.5 → 53, got ${estimatedServiceMinutesFromStatsRow(averaged[0], 1)}`,
);

// Multipet average across doctors
const mpAveraged = averageApptLengthStatsAcrossDoctors([
  [
    {
      typeName: 'Standard',
      avgMinutes: 40,
      count: 10,
      multipetAvgMinutes: 25,
      multipetCount: 8,
    },
  ],
  [
    {
      typeName: 'Standard',
      avgMinutes: 50,
      count: 10,
      multipetAvgMinutes: 35,
      multipetCount: 6,
    },
  ],
]);
assert(mpAveraged[0].avgMinutes === 45, `single avg 45, got ${mpAveraged[0].avgMinutes}`);
assert(
  mpAveraged[0].multipetAvgMinutes === 30,
  `multipet avg 30, got ${mpAveraged[0].multipetAvgMinutes}`,
);
assert(
  estimatedServiceMinutesFromStatsRow(mpAveraged[0], 2) === 60,
  `2 pets × 30 multipet avg = 60, got ${estimatedServiceMinutesFromStatsRow(mpAveraged[0], 2)}`,
);

// Empty / no qualifying doctors
assert(averageApptLengthStatsAcrossDoctors([]).length === 0, 'empty input');
assert(
  averageApptLengthStatsAcrossDoctors([
    [{ typeName: 'Euthanasia', avgMinutes: 30, count: 1, multipetAvgMinutes: null, multipetCount: 0 }],
  ]).length === 0,
  'below min instances yields no row',
);

console.log('routingMultiDoctorMinutesAverageSmoke: ok');
