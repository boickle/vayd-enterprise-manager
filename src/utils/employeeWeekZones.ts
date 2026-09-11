import type {
  Employee,
  EmployeeWeeklySchedule,
  EmployeeWeeklyScheduleZone,
} from '../api/appointmentSettings';

export type WeekZoneAssign = {
  zoneId: number;
  acceptingNewPatients: boolean;
  transitioningOutOfZone?: boolean;
};

export function scheduleForDay(
  employee: Pick<Employee, 'weeklySchedules'>,
  dayOfWeek: number
): EmployeeWeeklySchedule | undefined {
  return employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
}

export function isWeeklyWorkday(
  employee: Pick<Employee, 'weeklySchedules'>,
  dayOfWeek: number
): boolean {
  const schedule = scheduleForDay(employee, dayOfWeek);
  return schedule != null && schedule.isWorkday === true;
}

export function assignedWeekZones(
  zones?: EmployeeWeeklyScheduleZone[] | null
): WeekZoneAssign[] {
  if (!Array.isArray(zones)) return [];
  const assigned: WeekZoneAssign[] = [];
  for (const z of zones) {
    const zoneId = Number(z.zoneId ?? z.zone?.id);
    if (!Number.isFinite(zoneId) || zoneId <= 0) continue;
    assigned.push({
      zoneId,
      acceptingNewPatients: z.acceptingNewPatients === true,
      transitioningOutOfZone: z.transitioningOutOfZone === true,
    });
  }
  return assigned;
}

/** First filled workday, then any filled day. Used when a day was never set. */
export function donorScheduleZones(
  employee: Pick<Employee, 'weeklySchedules'>
): EmployeeWeeklyScheduleZone[] {
  const schedules = employee.weeklySchedules ?? [];
  const workdays = schedules.filter((s) => s.isWorkday === true);
  for (const schedule of [...workdays, ...schedules]) {
    if (Array.isArray(schedule.zones) && schedule.zones.length > 0) {
      return schedule.zones;
    }
  }
  return [];
}

/**
 * Zones for that weekday. An empty day inherits from another filled day so a
 * blank Sunday does not drop the doctor out of routing.
 */
export function resolveScheduleZonesForDay(
  employee: Pick<Employee, 'weeklySchedules'>,
  dayOfWeek: number
): EmployeeWeeklyScheduleZone[] {
  const own = scheduleForDay(employee, dayOfWeek)?.zones;
  if (Array.isArray(own) && own.length > 0) return own;
  return donorScheduleZones(employee);
}

/**
 * Weekdays that must have the zone for a date-range check.
 * Off days are skipped. If the whole span is off, returns null (check any day).
 */
export function daysToRequireZoneAssignment(
  employee: Pick<Employee, 'weeklySchedules'>,
  daysOfWeek?: readonly number[] | null
): number[] | null {
  if (!daysOfWeek?.length) return null;
  const targetDays = daysOfWeek.filter((d) => Number.isFinite(d) && d >= 0 && d <= 6);
  if (targetDays.length === 0) return [];
  const workdays = targetDays.filter((dow) => isWeeklyWorkday(employee, dow));
  return workdays.length > 0 ? workdays : null;
}

/** Persist exactly what is on the row. Empty stays empty. */
export function zonesToPersistForDay(
  explicit: WeekZoneAssign[] | EmployeeWeeklyScheduleZone[] | undefined,
  employee: Pick<Employee, 'weeklySchedules'>,
  dayOfWeek: number
): WeekZoneAssign[] {
  if (explicit !== undefined) return assignedWeekZones(explicit);
  return assignedWeekZones(scheduleForDay(employee, dayOfWeek)?.zones);
}
