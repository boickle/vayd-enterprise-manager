/**
 * Smoke: weekly zone assignment / routing date-range.
 *
 * Old bug: a week search required the zone on every weekday, including an
 * empty or off Sunday, so the doctor looked out-of-zone.
 *
 * Run: node scripts/employeeWeekZonesSmoke.mjs
 */

function assignedWeekZones(zones) {
  if (!Array.isArray(zones)) return [];
  return zones
    .map((z) => {
      const zoneId = Number(z.zoneId ?? z.zone?.id);
      if (!Number.isFinite(zoneId) || zoneId <= 0) return null;
      return { zoneId };
    })
    .filter(Boolean);
}

function scheduleForDay(employee, dayOfWeek) {
  return employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
}

function isWeeklyWorkday(employee, dayOfWeek) {
  const schedule = scheduleForDay(employee, dayOfWeek);
  return schedule != null && schedule.isWorkday === true;
}

function donorScheduleZones(employee) {
  const schedules = employee.weeklySchedules ?? [];
  const workdays = schedules.filter((s) => s.isWorkday === true);
  for (const schedule of [...workdays, ...schedules]) {
    if (Array.isArray(schedule.zones) && schedule.zones.length > 0) {
      return schedule.zones;
    }
  }
  return [];
}

function resolveScheduleZonesForDay(employee, dayOfWeek) {
  const own = scheduleForDay(employee, dayOfWeek)?.zones;
  if (Array.isArray(own) && own.length > 0) return own;
  return donorScheduleZones(employee);
}

function daysToRequireZoneAssignment(employee, daysOfWeek) {
  if (!daysOfWeek?.length) return null;
  const targetDays = daysOfWeek.filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
  if (targetDays.length === 0) return [];
  const workdays = targetDays.filter((dow) => isWeeklyWorkday(employee, dow));
  return workdays.length > 0 ? workdays : null;
}

function hasZoneOnDay(employee, zoneId, dayOfWeek) {
  return resolveScheduleZonesForDay(employee, dayOfWeek).some(
    (z) => Number(z.zoneId ?? z.zone?.id) === zoneId
  );
}

function isAssignedNew(employee, zoneId, daysOfWeek) {
  const schedules = employee.weeklySchedules ?? [];
  if (schedules.length === 0) return false;
  const requiredDays = daysToRequireZoneAssignment(employee, daysOfWeek);
  if (requiredDays) {
    if (requiredDays.length === 0) return false;
    return requiredDays.every((dow) => hasZoneOnDay(employee, zoneId, dow));
  }
  return schedules.some((schedule) =>
    resolveScheduleZonesForDay(employee, schedule.dayOfWeek).some(
      (z) => Number(z.zoneId ?? z.zone?.id) === zoneId
    )
  );
}

/** Old Settings / routing rule: every day in the range must have the zone. */
function isAssignedOld(employee, zoneId, daysOfWeek) {
  const schedules = employee.weeklySchedules ?? [];
  if (schedules.length === 0) return false;
  if (daysOfWeek?.length) {
    return daysOfWeek.every((dow) => {
      const zones = scheduleForDay(employee, dow)?.zones;
      return Array.isArray(zones) && zones.some((z) => Number(z.zoneId) === zoneId);
    });
  }
  return schedules.some((s) => (s.zones ?? []).some((z) => Number(z.zoneId) === zoneId));
}

function zonesToPersistForDay(explicit, employee, dayOfWeek) {
  if (explicit !== undefined) return assignedWeekZones(explicit);
  return assignedWeekZones(scheduleForDay(employee, dayOfWeek)?.zones);
}

const BID1 = 10;
const week = [0, 1, 2, 3, 4, 5, 6];
const monSat = [1, 2, 3, 4, 5, 6];

function workdaysMonSat() {
  return week.map((dayOfWeek) => ({
    dayOfWeek,
    isWorkday: dayOfWeek >= 1 && dayOfWeek <= 6,
    zones: dayOfWeek === 0 ? [] : [{ zoneId: BID1, acceptingNewPatients: true }],
  }));
}

const cases = [
  {
    name: 'Mon–Sat filled, Sunday off empty: week search still assigned',
    employee: { weeklySchedules: workdaysMonSat() },
    expectOld: false,
    expectNew: true,
  },
  {
    name: 'Sunday missing row: week search still assigned',
    employee: {
      weeklySchedules: workdaysMonSat().filter((s) => s.dayOfWeek !== 0),
    },
    expectOld: false,
    expectNew: true,
  },
  {
    name: 'Sunday workday empty inherits Mon zones',
    employee: {
      weeklySchedules: week.map((dayOfWeek) => ({
        dayOfWeek,
        isWorkday: true,
        zones: dayOfWeek === 0 ? [] : [{ zoneId: BID1, acceptingNewPatients: true }],
      })),
    },
    expectOld: false,
    expectNew: true,
  },
  {
    name: 'Doctor not in zone on any day stays unassigned',
    employee: {
      weeklySchedules: week.map((dayOfWeek) => ({
        dayOfWeek,
        isWorkday: dayOfWeek >= 1 && dayOfWeek <= 5,
        zones: [],
      })),
    },
    expectOld: false,
    expectNew: false,
  },
  {
    name: 'Mon–Sat only (no Sunday in range) already worked',
    employee: { weeklySchedules: workdaysMonSat() },
    days: monSat,
    expectOld: true,
    expectNew: true,
  },
];

let failed = 0;
for (const c of cases) {
  const old = isAssignedOld(c.employee, BID1, c.days ?? week);
  const next = isAssignedNew(c.employee, BID1, c.days ?? week);
  const ok = old === c.expectOld && next === c.expectNew;
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${c.name}: old=${old} (want ${c.expectOld}) new=${next} (want ${c.expectNew})`);
  } else {
    console.log(`ok  ${c.name}`);
  }
}

const inheritEmp = {
  weeklySchedules: workdaysMonSat(),
};
const sundayPersist = zonesToPersistForDay([], inheritEmp, 0);
if (sundayPersist.length !== 0) {
  failed += 1;
  console.error('FAIL save empty Sunday should stay empty', sundayPersist);
} else {
  console.log('ok  save empty Sunday stays empty');
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll employee week-zone smokes passed.');
