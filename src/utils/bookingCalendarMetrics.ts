import dayjs, { type Dayjs } from 'dayjs';
import {
  scheduleOverrideIsOff,
  type EmployeeWeeklySchedule,
  type EmployeeWeeklyScheduleZone,
  type ScheduleOverride,
} from '../api/appointmentSettings';
import { type DoctorMonthAppt, type DoctorMonthDay, shortZoneLabel } from '../api/appointments';
import { formatDoctorSelectZoneLabel } from '../api/employee';
import { pointsFromAppointmentRows, type AppointmentTypeCatalog } from './appointmentTypeSettings';
import { isTimeOffLabel } from './doctorTimeOff';

export const BOOKING_CALENDAR_WEEKS = 6;
export const DECISION_LEAD_DAYS = 14;
export const FILL_ON_TRACK_PCT = 90;
export const FILL_TRIM_PCT = 70;
export const UNZONED_KEY = '__unzoned__';
export const UNZONED_LABEL = 'Unzoned';

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type BookingCalendarAction = 'market' | 'trim' | 'watch' | 'on_track' | 'off';
export type BookingCalendarFillTone = 'off' | 'on_track' | 'watch' | 'behind';

export type ZoneChip = {
  key: string;
  label: string;
  count: number;
};

export type BookingCalendarDoctorInput = {
  id: string;
  name: string;
  fallbackDailyPointGoal?: number | null;
  weeklySchedules: EmployeeWeeklySchedule[];
  scheduleOverridesByDate: Map<string, ScheduleOverride>;
  goalsWorkdayByDate: Map<string, boolean>;
  pointGoalByDate: Map<string, number>;
  timeOffDates: Set<string>;
  monthDaysByDate: Map<string, DoctorMonthDay>;
};

export type DoctorDayMetrics = {
  doctorId: string;
  doctorName: string;
  working: boolean;
  zones: ZoneChip[];
  bookedVisits: number;
  bookedPoints: number;
  targetPoints: number;
  gapPoints: number;
  fillPct: number | null;
  action: BookingCalendarAction;
  decisionDate: string;
  decisionDatePassed: boolean;
};

export type CalendarDayMetrics = {
  date: string;
  daysUntil: number;
  isToday: boolean;
  isPast: boolean;
  doctorDays: number;
  zoneChips: ZoneChip[];
  bookedVisits: number;
  bookedPoints: number;
  targetPoints: number;
  gapPoints: number;
  fillPct: number | null;
  tone: BookingCalendarFillTone;
  action: BookingCalendarAction;
  decisionDate: string;
  decisionDatePassed: boolean;
  doctors: DoctorDayMetrics[];
};

export type BookingCalendarKpis = {
  openDoctorDays: number;
  bookedVisits: number;
  bookedPoints: number;
  targetPoints: number;
  marketingWindowGap: number;
  trimRiskDoctorDays: number;
};

export type MarketingBannerItem = {
  date: string;
  zoneChips: ZoneChip[];
  gapPoints: number;
  fillPct: number | null;
  doctorDays: number;
  bookedVisits: number;
};

export type TrimBannerItem = {
  date: string;
  doctorId: string;
  doctorName: string;
  zones: ZoneChip[];
  fillPct: number | null;
  bookedVisits: number;
  bookedPoints: number;
  targetPoints: number;
  decisionDate: string;
  decisionDatePassed: boolean;
};

export function toDateStr(d: Dayjs | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.format('YYYY-MM-DD');
}

export function dateStringsInclusive(start: Dayjs, end: Dayjs): string[] {
  const out: string[] = [];
  let d = start.startOf('day');
  const e = end.startOf('day');
  while (!d.isAfter(e)) {
    out.push(toDateStr(d));
    d = d.add(1, 'day');
  }
  return out;
}

/** Sunday of the week containing `today`, through 6 full weeks (42 days). */
export function sixWeekWindow(today: Dayjs = dayjs()): {
  start: Dayjs;
  end: Dayjs;
  dates: string[];
  weeks: string[][];
} {
  const start = today.startOf('day').subtract(today.day(), 'day');
  const end = start.add(BOOKING_CALENDAR_WEEKS * 7 - 1, 'day');
  const dates = dateStringsInclusive(start, end);
  const weeks: string[][] = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7));
  }
  return { start, end, dates, weeks };
}

export function monthsCoveringRange(
  startStr: string,
  endStr: string
): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let d = dayjs(startStr).startOf('month');
  const e = dayjs(endStr).startOf('month');
  while (!d.isAfter(e)) {
    out.push({ year: d.year(), month: d.month() + 1 });
    d = d.add(1, 'month');
  }
  return out;
}

export function decisionDateFor(dateStr: string): string {
  return dayjs(dateStr).subtract(DECISION_LEAD_DAYS, 'day').format('YYYY-MM-DD');
}

export function daysUntilDate(dateStr: string, todayStr: string): number {
  return dayjs(dateStr).startOf('day').diff(dayjs(todayStr).startOf('day'), 'day');
}

export function isWeeklyWorkday(
  schedules: EmployeeWeeklySchedule[] | undefined,
  dateStr: string
): boolean {
  const schedule = weeklyScheduleForDate(schedules, dateStr);
  return schedule?.isWorkday ?? false;
}

export function weeklyScheduleForDate(
  schedules: EmployeeWeeklySchedule[] | undefined,
  dateStr: string
): EmployeeWeeklySchedule | undefined {
  const dayOfWeek = dayjs(dateStr).day();
  return (schedules ?? []).find((s) => s.dayOfWeek === dayOfWeek);
}

function personKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Shared PIMS accounts that carry Veterinarian but are not field doctors. */
export function isNonDoctorPlaceholderName(name: string): boolean {
  const key = personKey(name);
  return (
    key.includes('hospital account') ||
    key.includes('tech team') ||
    key === 'hospital' ||
    key === 'account'
  );
}

function scheduleZoneCount(doc: BookingCalendarDoctorInput): number {
  let n = 0;
  for (const schedule of doc.weeklySchedules ?? []) {
    n += (schedule.zones ?? []).length;
  }
  return n;
}

function doctorHasBookedVisits(doc: BookingCalendarDoctorInput): boolean {
  for (const day of doc.monthDaysByDate.values()) {
    if ((day.appts ?? []).some(isCountableVisit)) return true;
  }
  return false;
}

/**
 * One row per person: drop placeholder accounts and duplicate employee records
 * (e.g. two Deirdre Frey rows), keeping the zoned field-doctor record.
 */
export function doctorsForCapacityCalendar(
  doctors: BookingCalendarDoctorInput[]
): BookingCalendarDoctorInput[] {
  const ranked = [...doctors]
    .filter((d) => !isNonDoctorPlaceholderName(d.name))
    .sort((a, b) => scheduleZoneCount(b) - scheduleZoneCount(a) || a.name.localeCompare(b.name));
  const byPerson = new Map<string, BookingCalendarDoctorInput>();
  for (const d of ranked) {
    const key = personKey(d.name);
    if (!key || byPerson.has(key)) continue;
    byPerson.set(key, d);
  }
  return [...byPerson.values()].filter((d) => scheduleZoneCount(d) > 0 || doctorHasBookedVisits(d));
}

export function hasServiceZone(zones: ZoneChip[]): boolean {
  return zones.some((z) => z.key !== UNZONED_KEY);
}

/**
 * Time off wins, then a date override, then the weekly template.
 * Goals `isWorkday` is not used here: getEffectiveWorkday defaults missing weekly
 * rows to a weekday shift, which invents doctor-days for techs and unscheduled providers.
 */
export function isDoctorWorkingOnDate(
  emp:
    | Pick<
        BookingCalendarDoctorInput,
        'weeklySchedules' | 'scheduleOverridesByDate' | 'timeOffDates'
      >
    | undefined,
  dateStr: string
): boolean {
  if (!emp) return false;
  if (emp.timeOffDates.has(dateStr)) return false;
  const override = emp.scheduleOverridesByDate.get(dateStr);
  if (override) return !scheduleOverrideIsOff(override);
  return isWeeklyWorkday(emp.weeklySchedules, dateStr);
}

export function zoneChipFromScheduleZone(z: EmployeeWeeklyScheduleZone): ZoneChip {
  const id = z.zoneId ?? z.zone?.id;
  const name = z.zone?.name ?? null;
  const key = id != null ? String(id) : UNZONED_KEY;
  const label =
    shortZoneLabel(name) ??
    formatDoctorSelectZoneLabel(name) ??
    (key === UNZONED_KEY ? UNZONED_LABEL : key);
  return { key, label, count: 1 };
}

export function zonesForScheduleDay(
  schedules: EmployeeWeeklySchedule[] | undefined,
  dateStr: string
): ZoneChip[] {
  const schedule = weeklyScheduleForDate(schedules, dateStr);
  const zones = schedule?.zones ?? [];
  if (!zones.length) return [{ key: UNZONED_KEY, label: UNZONED_LABEL, count: 1 }];
  const chips: ZoneChip[] = [];
  const seen = new Set<string>();
  for (const z of zones) {
    const chip = zoneChipFromScheduleZone(z);
    if (seen.has(chip.key)) continue;
    seen.add(chip.key);
    chips.push(chip);
  }
  return chips.length ? chips : [{ key: UNZONED_KEY, label: UNZONED_LABEL, count: 1 }];
}

export function doctorAssignedToZone(
  zones: ZoneChip[],
  zoneKey: string | null | undefined
): boolean {
  if (!zoneKey) return true;
  return zones.some((z) => z.key === zoneKey);
}

export function mergeZoneChips(chips: ZoneChip[]): ZoneChip[] {
  const byKey = new Map<string, ZoneChip>();
  for (const c of chips) {
    const existing = byKey.get(c.key);
    if (existing) existing.count += c.count;
    else byKey.set(c.key, { key: c.key, label: c.label, count: c.count });
  }
  return [...byKey.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true })
  );
}

export function collectZoneOptions(doctors: BookingCalendarDoctorInput[]): ZoneChip[] {
  const byKey = new Map<string, ZoneChip>();
  for (const doc of doctors) {
    for (const schedule of doc.weeklySchedules ?? []) {
      for (const z of schedule.zones ?? []) {
        const chip = zoneChipFromScheduleZone(z);
        if (!byKey.has(chip.key)) byKey.set(chip.key, { ...chip, count: 0 });
      }
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true })
  );
}

export function formatZoneChips(chips: ZoneChip[]): string {
  if (!chips.length) return '—';
  return chips.map((c) => (c.count > 1 ? `${c.label}×${c.count}` : c.label)).join('  ');
}

export function isCountableVisit(appt: DoctorMonthAppt): boolean {
  if (isTimeOffLabel(appt.appointmentType) || isTimeOffLabel(appt.title)) return false;
  return true;
}

export function appointmentZoneKey(
  appt: Pick<DoctorMonthAppt, 'effectiveZone' | 'clientZone'>
): string {
  const z = appt.effectiveZone ?? appt.clientZone;
  if (z?.id != null && String(z.id).trim() !== '') return String(z.id);
  return UNZONED_KEY;
}

export function countableVisits(
  day: DoctorMonthDay | undefined,
  zoneKey?: string | null
): DoctorMonthAppt[] {
  const appts = (day?.appts ?? []).filter(isCountableVisit);
  if (!zoneKey) return appts;
  return appts.filter((a) => appointmentZoneKey(a) === zoneKey);
}

export function bookedPointsForVisits(
  visits: DoctorMonthAppt[],
  catalog?: AppointmentTypeCatalog
): number {
  return pointsFromAppointmentRows(
    visits.map((a) => ({
      appointmentType: a.appointmentType,
      appointmentTypeId: a.appointmentTypeId,
      isPersonalBlock: false,
    })),
    catalog
  );
}

export function fillPct(bookedPoints: number, targetPoints: number): number | null {
  if (!(targetPoints > 0)) return null;
  return (bookedPoints / targetPoints) * 100;
}

export function fillTone(args: {
  doctorDays: number;
  fillPct: number | null;
}): BookingCalendarFillTone {
  if (args.doctorDays <= 0) return 'off';
  if (args.fillPct == null) return 'watch';
  if (args.fillPct >= FILL_ON_TRACK_PCT) return 'on_track';
  if (args.fillPct >= FILL_TRIM_PCT) return 'watch';
  return 'behind';
}

export function recommendAction(args: {
  doctorDays: number;
  daysUntil: number;
  fillPct: number | null;
}): BookingCalendarAction {
  if (args.doctorDays <= 0 || args.daysUntil < 0) return 'off';
  if (args.fillPct == null) return 'watch';
  if (args.fillPct >= FILL_ON_TRACK_PCT) return 'on_track';
  if (args.daysUntil > DECISION_LEAD_DAYS) return 'market';
  if (args.fillPct < FILL_TRIM_PCT) return 'trim';
  return 'watch';
}

export function pointGoalForDate(doc: BookingCalendarDoctorInput, dateStr: string): number {
  const fromMap = doc.pointGoalByDate.get(dateStr);
  if (fromMap != null && Number.isFinite(fromMap) && fromMap > 0) return fromMap;
  const fallback = Number(doc.fallbackDailyPointGoal);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 0;
}

export function actionLabel(action: BookingCalendarAction): string {
  switch (action) {
    case 'market':
      return 'Market';
    case 'trim':
      return 'Trim';
    case 'watch':
      return 'Watch';
    case 'on_track':
      return 'On track';
    default:
      return 'Off';
  }
}

export function formatPoints(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatFillPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${Math.round(pct)}%`;
}

export function formatGapLabel(gap: number): string {
  if (!Number.isFinite(gap) || Math.abs(gap) < 0.05) return 'On goal';
  if (gap > 0) return `Gap ${formatPoints(gap)}`;
  return `Ahead ${formatPoints(-gap)}`;
}

export function buildBookingCalendar(args: {
  dates: string[];
  today: string;
  doctors: BookingCalendarDoctorInput[];
  catalog?: AppointmentTypeCatalog;
  doctorId?: string | null;
  zoneKey?: string | null;
}): CalendarDayMetrics[] {
  const today = args.today.slice(0, 10);
  const doctorId = args.doctorId?.trim() || null;
  const zoneKey = args.zoneKey?.trim() || null;
  const roster = doctorsForCapacityCalendar(args.doctors);
  const doctors = doctorId ? roster.filter((d) => d.id === doctorId) : roster;

  return args.dates.map((date) => {
    const daysUntil = daysUntilDate(date, today);
    const decisionDate = decisionDateFor(date);
    const decisionDatePassed = decisionDate < today;
    const doctorRows: DoctorDayMetrics[] = [];

    for (const doc of doctors) {
      const assignedZones = zonesForScheduleDay(doc.weeklySchedules, date);
      if (!doctorAssignedToZone(assignedZones, zoneKey)) continue;
      const scheduled = isDoctorWorkingOnDate(doc, date);
      const visits = countableVisits(doc.monthDaysByDate.get(date), zoneKey);
      const bookedVisits = visits.length;
      const bookedPts = bookedPointsForVisits(visits, args.catalog);
      const working = scheduled && hasServiceZone(assignedZones);
      if (!working && bookedVisits <= 0) continue;

      const target = working ? pointGoalForDate(doc, date) : 0;
      const pct = fillPct(bookedPts, target);
      const zones = zoneKey
        ? assignedZones.filter((z) => z.key === zoneKey).map((z) => ({ ...z, count: 1 }))
        : assignedZones;
      doctorRows.push({
        doctorId: doc.id,
        doctorName: doc.name,
        working,
        zones,
        bookedVisits,
        bookedPoints: bookedPts,
        targetPoints: target,
        gapPoints: target - bookedPts,
        fillPct: pct,
        action: recommendAction({
          doctorDays: working ? 1 : 0,
          daysUntil,
          fillPct: pct,
        }),
        decisionDate,
        decisionDatePassed,
      });
    }

    const workingRows = doctorRows.filter((d) => d.working);
    const doctorDays = workingRows.length;
    const bookedVisits = doctorRows.reduce((s, d) => s + d.bookedVisits, 0);
    const bookedPoints = doctorRows.reduce((s, d) => s + d.bookedPoints, 0);
    const targetPoints = workingRows.reduce((s, d) => s + d.targetPoints, 0);
    const pct = fillPct(bookedPoints, targetPoints);
    const zoneChips = mergeZoneChips(workingRows.flatMap((d) => d.zones));

    return {
      date,
      daysUntil,
      isToday: date === today,
      isPast: daysUntil < 0,
      doctorDays,
      zoneChips,
      bookedVisits,
      bookedPoints,
      targetPoints,
      gapPoints: targetPoints - bookedPoints,
      fillPct: pct,
      tone: fillTone({ doctorDays, fillPct: pct }),
      action: recommendAction({ doctorDays, daysUntil, fillPct: pct }),
      decisionDate,
      decisionDatePassed,
      doctors: doctorRows.sort((a, b) => a.doctorName.localeCompare(b.doctorName)),
    };
  });
}

export function summarizeBookingCalendar(days: CalendarDayMetrics[]): BookingCalendarKpis {
  let openDoctorDays = 0;
  let bookedVisits = 0;
  let bookedPoints = 0;
  let targetPoints = 0;
  let marketingTarget = 0;
  let marketingBooked = 0;
  let trimRiskDoctorDays = 0;

  for (const day of days) {
    openDoctorDays += day.doctorDays;
    bookedVisits += day.bookedVisits;
    bookedPoints += day.bookedPoints;
    targetPoints += day.targetPoints;
    if (day.daysUntil > DECISION_LEAD_DAYS) {
      marketingTarget += day.targetPoints;
      marketingBooked += day.bookedPoints;
    }
    if (day.daysUntil >= 0 && day.daysUntil <= DECISION_LEAD_DAYS) {
      for (const doc of day.doctors) {
        if (doc.working && doc.action === 'trim') trimRiskDoctorDays += 1;
      }
    }
  }

  return {
    openDoctorDays,
    bookedVisits,
    bookedPoints,
    targetPoints,
    marketingWindowGap: Math.max(0, marketingTarget - marketingBooked),
    trimRiskDoctorDays,
  };
}

export function marketingBannerItems(days: CalendarDayMetrics[], limit = 8): MarketingBannerItem[] {
  return days
    .filter((d) => d.action === 'market' && d.gapPoints > 0)
    .sort((a, b) => b.gapPoints - a.gapPoints)
    .slice(0, limit)
    .map((d) => ({
      date: d.date,
      zoneChips: d.zoneChips,
      gapPoints: d.gapPoints,
      fillPct: d.fillPct,
      doctorDays: d.doctorDays,
      bookedVisits: d.bookedVisits,
    }));
}

export function trimBannerItems(days: CalendarDayMetrics[], limit = 12): TrimBannerItem[] {
  const items: TrimBannerItem[] = [];
  for (const day of days) {
    if (day.daysUntil < 0 || day.daysUntil > DECISION_LEAD_DAYS) continue;
    for (const doc of day.doctors) {
      if (!doc.working || doc.action !== 'trim') continue;
      items.push({
        date: day.date,
        doctorId: doc.doctorId,
        doctorName: doc.doctorName,
        zones: doc.zones,
        fillPct: doc.fillPct,
        bookedVisits: doc.bookedVisits,
        bookedPoints: doc.bookedPoints,
        targetPoints: doc.targetPoints,
        decisionDate: doc.decisionDate,
        decisionDatePassed: doc.decisionDatePassed,
      });
    }
  }
  return items
    .sort((a, b) => a.date.localeCompare(b.date) || a.doctorName.localeCompare(b.doctorName))
    .slice(0, limit);
}
