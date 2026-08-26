import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip as MuiTooltip,
  Typography,
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Line,
  Legend,
} from 'recharts';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { type DoctorRevenuePoint, type DoctorRevenueSeriesResponse } from '../api/opsStats';
import { type DoctorMonthDay } from '../api/appointments';
import {
  fetchAllAppointmentTypes,
  scheduleOverrideIsOff,
  type EmployeeWeeklySchedule,
  type ScheduleOverride,
} from '../api/appointmentSettings';
import { type PaymentPoint } from '../api/payments';
import {
  buildAppointmentTypeCatalog,
  pointsFromAppointmentRows,
  type AppointmentTypeCatalog,
} from '../utils/appointmentTypeSettings';
import { monthDayIsTimeOff } from '../utils/doctorTimeOff';
import {
  fetchDoctorMonthsCached,
  fetchDoctorRevenueSeriesCachedMany,
  fetchEmployeeGoalsCached,
  fetchEmployeeWeeklySchedulesCached,
  fetchPaymentsAnalyticsCached,
  fetchScheduleOverridesCached,
  PROJECTED_REVENUE_FETCH_CONCURRENCY,
} from '../utils/projectedRevenueFetch';
import { mapPool } from '../utils/asyncTtlCache';
import {
  buildDoctorPointsCapacity,
  DOCTOR_CAPACITY_LOOKBACK_DAYS,
  projectDoctorWeekdayPoints,
  type DoctorPointsCapacity,
} from '../utils/doctorPointsCapacity';
import { useAuth } from '../auth/useAuth';
import { useCommittedDateRange } from '../hooks/useCommittedDateRange';
import { isEmployeeAnalyticsRestricted, normalizeAuthRoles } from '../utils/analyticsAccess';

dayjs.extend(isoWeek);

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PRACTICE_TOTAL_ID = '__practice__';
/** Days of history (ending yesterday) used to estimate VSD per point — same as daily VSD estimate. */
const VSD_ESTIMATE_LOOKBACK_DAYS = 30;
/** Inclusive day count at or below this shows daily buckets; above shows weekly. */
const DAILY_MAX_DAYS = 30;

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    Number(n) || 0
  );
}

function dateRange(start: Dayjs, end: Dayjs): string[] {
  const out: string[] = [];
  let d = start.startOf('day');
  const e = end.startOf('day');
  while (!d.isAfter(e)) {
    out.push(toLocalDateStr(d));
    d = d.add(1, 'day');
  }
  return out;
}

function monthsInRange(start: Dayjs, end: Dayjs): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let d = start.startOf('month');
  const e = end.startOf('month');
  while (!d.isAfter(e)) {
    out.push({ year: d.year(), month: d.month() + 1 });
    d = d.add(1, 'month').startOf('month');
  }
  return out;
}

function seriesByDate(series: DoctorRevenuePoint[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of series) {
    const d = String(p?.date ?? '').slice(0, 10);
    if (d) m.set(d, (m.get(d) ?? 0) + Number(p?.total ?? 0));
  }
  return m;
}

/** Mean of (revenue ÷ points) over days in [histStart, histEnd] where points > 0. */
function meanHistoricalVsdPerPoint(
  series: DoctorRevenuePoint[],
  pointsByDate: Record<string, number>,
  histStart: Dayjs,
  histEnd: Dayjs
): number | null {
  const revByDate = seriesByDate(series);
  const ratios: number[] = [];
  for (const dateStr of dateRange(histStart, histEnd)) {
    const pts = pointsByDate[dateStr] ?? 0;
    if (pts <= 0) continue;
    const rev = revByDate.get(dateStr) ?? 0;
    ratios.push(Number(rev) / pts);
  }
  if (!ratios.length) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

/** Practice-wide trailing VSD/pt across providers. */
function meanPracticeHistoricalVsdPerPoint(
  providerIds: string[],
  histResponses: { doctorId: string; response: DoctorRevenueSeriesResponse }[],
  pointsByDoctorByDate: Record<string, Record<string, number>>,
  histStart: Dayjs,
  histEnd: Dayjs
): number | null {
  const revByDoctorByDate = new Map<string, Map<string, number>>();
  for (const id of providerIds) {
    const hist = histResponses.find((x) => x.doctorId === id);
    if (!hist) continue;
    revByDoctorByDate.set(id, seriesByDate(hist.response.series ?? []));
  }
  const ratios: number[] = [];
  for (const dateStr of dateRange(histStart, histEnd)) {
    let rev = 0;
    let pts = 0;
    for (const id of providerIds) {
      rev += revByDoctorByDate.get(id)?.get(dateStr) ?? 0;
      pts += pointsByDoctorByDate[id]?.[dateStr] ?? 0;
    }
    if (pts > 0) ratios.push(rev / pts);
  }
  if (!ratios.length) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

function pointsFromMonthDay(day: DoctorMonthDay, catalog?: AppointmentTypeCatalog): number {
  const apptsWithType = (day.appts ?? []).map((a) => ({
    appointmentType: a.appointmentType,
    appointmentTypeId: (a as { appointmentTypeId?: number }).appointmentTypeId,
    isPersonalBlock: false,
  }));
  const blocksAsPersonal = (day.blocks ?? []).map(() => ({ isPersonalBlock: true }));
  return pointsFromAppointmentRows([...apptsWithType, ...blocksAsPersonal], catalog);
}

/** Square + Stripe membership recurring revenue for one payment day. */
function membershipRevenueForDay(p: PaymentPoint): number {
  return (Number(p.subscriptionRevenue) || 0) + (Number(p.stripeRevenue) || 0);
}

type AncillaryDailyRates = {
  /** Plain pharmacy average (shown in summaries); projections use baseline + growth. */
  pharmacyOverall: number;
  /** Recent half-window pharmacy $/day — starting point for the next projected day. */
  pharmacyBaseline: number;
  /** Linear pharmacy growth $/calendar-day from the lookback window. */
  pharmacyDailyGrowth: number;
  /** Recent half-window membership $/day — starting point for the next projected day. */
  membershipBaseline: number;
  /** Linear membership growth $/calendar-day from the lookback window. */
  membershipDailyGrowth: number;
  /** Plain membership average (shown in summaries); projections use baseline + growth. */
  membershipOverall: number;
  sampleDays: number;
};

/**
 * Trailing ancillary rates from Payments over the lookback window.
 * Pharmacy (onlinePharmacyRevenue) and membership (Square subscriptionRevenue + Stripe
 * stripeRevenue only) each use half-window growth: change from the first half to the
 * second half, spread per calendar day, so future days step from the recent half's
 * average with that daily growth applied. Missing days count as $0.
 */
function buildAncillaryDailyRates(
  series: PaymentPoint[],
  histStart: Dayjs,
  histEnd: Dayjs
): AncillaryDailyRates {
  const pharmacyByDate = new Map<string, number>();
  const membershipByDate = new Map<string, number>();
  for (const p of series) {
    const d = String(p?.date ?? '').slice(0, 10);
    if (!d) continue;
    pharmacyByDate.set(d, Number(p.onlinePharmacyRevenue) || 0);
    membershipByDate.set(d, membershipRevenueForDay(p));
  }

  const dates = dateRange(histStart, histEnd);
  let pharmacyTotal = 0;
  let membershipTotal = 0;
  const pharmacySeries: number[] = [];
  const membershipSeries: number[] = [];

  for (const dateStr of dates) {
    const pharmacy = pharmacyByDate.get(dateStr) ?? 0;
    const membership = membershipByDate.get(dateStr) ?? 0;
    pharmacyTotal += pharmacy;
    membershipTotal += membership;
    pharmacySeries.push(pharmacy);
    membershipSeries.push(membership);
  }

  const sampleDays = dates.length;
  const pharmacyTrend = ancillaryGrowthFromWindow(pharmacySeries);
  const membershipTrend = ancillaryGrowthFromWindow(membershipSeries);

  return {
    pharmacyOverall: sampleDays > 0 ? pharmacyTotal / sampleDays : 0,
    pharmacyBaseline: pharmacyTrend.baseline,
    pharmacyDailyGrowth: pharmacyTrend.dailyGrowth,
    membershipBaseline: membershipTrend.baseline,
    membershipDailyGrowth: membershipTrend.dailyGrowth,
    membershipOverall: sampleDays > 0 ? membershipTotal / sampleDays : 0,
    sampleDays,
  };
}

/**
 * Growth from the lookback window: compare first-half vs second-half averages
 * (smoother than fitting noisy billing days), use the recent half as the near-term baseline,
 * and spread the half-to-half change across the days between the two half midpoints.
 */
function ancillaryGrowthFromWindow(values: number[]): {
  baseline: number;
  dailyGrowth: number;
} {
  const n = values.length;
  if (n <= 0) return { baseline: 0, dailyGrowth: 0 };
  if (n === 1) return { baseline: Math.max(0, values[0] ?? 0), dailyGrowth: 0 };

  const mid = Math.floor(n / 2);
  const first = values.slice(0, mid);
  const second = values.slice(mid);
  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const firstAvg = avg(first);
  const secondAvg = avg(second);
  // Days between half midpoints (at least 1).
  const firstMid = (first.length - 1) / 2;
  const secondMid = mid + (second.length - 1) / 2;
  const spanDays = Math.max(1, secondMid - firstMid);
  const dailyGrowth = (secondAvg - firstAvg) / spanDays;
  return {
    baseline: Math.max(0, secondAvg),
    dailyGrowth,
  };
}

/**
 * Pharmacy and membership each start from their recent half-window average and add
 * one day of measured growth per calendar day past today.
 */
function ancillaryForDate(
  dateStr: string,
  rates: AncillaryDailyRates | null,
  today: Dayjs = dayjs().startOf('day')
): { pharmacy: number; membership: number } {
  if (!rates) return { pharmacy: 0, membership: 0 };
  const daysUntil = Math.max(0, dayjs(dateStr).startOf('day').diff(today, 'day'));
  return {
    pharmacy: Math.max(0, rates.pharmacyBaseline + rates.pharmacyDailyGrowth * daysUntil),
    membership: Math.max(0, rates.membershipBaseline + rates.membershipDailyGrowth * daysUntil),
  };
}

type DoctorScheduleInfo = {
  id: string;
  weeklySchedules: EmployeeWeeklySchedule[];
  scheduleOverridesByDate: Map<string, ScheduleOverride>;
  /** Server-resolved workday flags from the goals breakdown (weekly + overrides already merged). */
  goalsWorkdayByDate: Map<string, boolean>;
  /** Daily revenue goal per date; once actual meets it, the day stops being estimated up. */
  revenueGoalByDate: Map<string, number>;
  /** Daily point goal per date; fallback when a doctor has no history for that weekday. */
  pointGoalByDate: Map<string, number>;
  /** Dates blocked out on the calendar for vacation / OOO / holiday. */
  timeOffDates: Set<string>;
};

/** True if the employee is scheduled to work on the given date (by day of week). */
function isWeeklyWorkday(
  emp: { weeklySchedules?: EmployeeWeeklySchedule[] },
  dateStr: string
): boolean {
  const schedules = emp.weeklySchedules ?? [];
  const dayOfWeek = dayjs(dateStr).day();
  const schedule = schedules.find((s) => s.dayOfWeek === dayOfWeek);
  return schedule?.isWorkday ?? false;
}

/**
 * Whether a doctor is expected to work on a date.
 * Calendar time off wins, then schedule OFF overrides, then the server-resolved goals
 * breakdown, then the weekly schedule. Vacation is often only on the calendar, so checking
 * the weekly schedule alone would project revenue straight through a week off.
 */
function isDoctorWorkingOnDate(emp: DoctorScheduleInfo | undefined, dateStr: string): boolean {
  if (!emp) return false;
  if (emp.timeOffDates.has(dateStr)) return false;
  const override = emp.scheduleOverridesByDate.get(dateStr);
  if (override) return !scheduleOverrideIsOff(override);
  const goalsWorkday = emp.goalsWorkdayByDate.get(dateStr);
  if (goalsWorkday != null) return goalsWorkday;
  return isWeeklyWorkday(emp, dateStr);
}

/** Future-looking presets (from today forward). */
const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  '7D': () => {
    const today = dayjs().startOf('day');
    return { from: today, to: today.add(6, 'day') };
  },
  '30D': () => {
    const today = dayjs().startOf('day');
    return { from: today, to: today.add(29, 'day') };
  },
  '90D': () => {
    const today = dayjs().startOf('day');
    return { from: today, to: today.add(89, 'day') };
  },
};

type BucketRow = {
  key: string;
  label: string;
  /** Treatment revenue from currently booked points only (projected days) or actual VSD (past/today). */
  bookedEstimated: number;
  /** Treatment revenue after fill-in (future) or actual VSD (past/today). */
  treatmentEstimated: number;
  /** Pharmacy: actual payments (past/today) or trailing trend (future). */
  pharmacyEstimated: number;
  /** Membership: actual payments (past/today) or trailing trend (future). */
  membershipEstimated: number;
  /** treatment + pharmacy + membership (practice) or treatment only (doctor). */
  estimated: number;
  points: number;
  projectedPoints: number;
  /** Points the scheduled doctors typically complete — the expectation before bookings. */
  typicalDayPoints: number;
  /** Doctor-days scheduled in this bucket (per day for daily rows). */
  workingDoctorCount: number;
  appointmentCount: number;
  /** True when every day in this bucket used actual revenue (not a forecast). */
  isActual: boolean;
  /** Days in bucket that used actuals (for mixed weekly buckets). */
  actualDayCount: number;
  /** Days in bucket that used projections. */
  projectedDayCount: number;
  /** Projected days where nobody was scheduled (weekend, day off, vacation). */
  offDayCount: number;
  /** Current day where actual so far was topped up with an estimate for remaining visits. */
  partialDayCount: number;
};

export default function ProjectedRevenueAnalyticsPage() {
  const { range, draftRange, applyRange, onCustomFromChange, onCustomToChange } =
    useCommittedDateRange(PRESETS['7D']());
  const [preset, setPreset] = useState<string>('7D');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [graphSelection, setGraphSelection] = useState<string>(PRACTICE_TOTAL_ID);
  const [typeCatalog, setTypeCatalog] = useState<AppointmentTypeCatalog | undefined>();
  /** Raw doctor/month days — points are derived in a memo so catalog arrival doesn't re-fetch. */
  const [monthDaysByDoctor, setMonthDaysByDoctor] = useState<Record<string, DoctorMonthDay[]>>({});
  const [histDoctorResponses, setHistDoctorResponses] = useState<
    { doctorId: string; name: string; response: DoctorRevenueSeriesResponse }[]
  >([]);
  const [paymentHistorySeries, setPaymentHistorySeries] = useState<PaymentPoint[]>([]);
  const [doctorSchedulesBase, setDoctorSchedulesBase] = useState<
    Record<string, Omit<DoctorScheduleInfo, 'timeOffDates'>>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const start = range.from.startOf('day');
  const end = range.to.startOf('day');
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);
  const dayCount = end.diff(start, 'day') + 1;
  const useDailyBuckets = dayCount <= DAILY_MAX_DAYS;

  const { role, assignedDoctorIds } = useAuth() as {
    role?: string[];
    assignedDoctorIds?: string[];
  };
  const normalizedRoles = normalizeAuthRoles(role);
  const restrictEmployeeAnalytics = isEmployeeAnalyticsRestricted(normalizedRoles);
  const assignedDoctorIdSet = useMemo(
    () => new Set((assignedDoctorIds ?? []).map((x) => String(x).trim()).filter(Boolean)),
    [assignedDoctorIds]
  );

  const providersForApi = useMemo(() => {
    if (!restrictEmployeeAnalytics) return providers;
    if (!assignedDoctorIdSet.size) return [];
    return providers.filter((p) => {
      const id = String(p.id ?? '').trim();
      const pims = p.pimsId != null ? String(p.pimsId).trim() : '';
      return (id && assignedDoctorIdSet.has(id)) || (pims && assignedDoctorIdSet.has(pims));
    });
  }, [providers, restrictEmployeeAnalytics, assignedDoctorIdSet]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchPrimaryProviders();
        if (!alive) return;
        setProviders(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!alive) return;
        console.error('fetchPrimaryProviders failed:', e);
        setError('Failed to load providers');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false })
      .then((rows) => {
        if (alive) setTypeCatalog(buildAppointmentTypeCatalog(Array.isArray(rows) ? rows : []));
      })
      .catch(() => {
        if (alive) setTypeCatalog(undefined);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Prefetch practice-wide payment history as soon as the page mounts.
  useEffect(() => {
    const todayD = dayjs().startOf('day');
    const rateHistEnd = todayD.subtract(1, 'day');
    const rateHistStart = rateHistEnd.subtract(VSD_ESTIMATE_LOOKBACK_DAYS - 1, 'day');
    void fetchPaymentsAnalyticsCached({
      start: toLocalDateStr(rateHistStart),
      end: toLocalDateStr(todayD),
      practiceId: PRACTICE_ID,
    });
  }, []);

  // Load booked appointment points, trailing point/VSD history, schedules, and payments.
  useEffect(() => {
    if (!providersForApi.length) {
      setMonthDaysByDoctor({});
      setHistDoctorResponses([]);
      setPaymentHistorySeries([]);
      setDoctorSchedulesBase({});
      setLoading(false);
      return;
    }

    const todayD = dayjs().startOf('day');
    const rateHistEnd = todayD.subtract(1, 'day');
    const rateHistStart = rateHistEnd.subtract(VSD_ESTIMATE_LOOKBACK_DAYS - 1, 'day');
    // Typical-day averages read further back than the VSD rate, so pull the wider window.
    const capacityHistStart = rateHistEnd.subtract(DOCTOR_CAPACITY_LOOKBACK_DAYS - 1, 'day');
    const historyStart = capacityHistStart.isBefore(rateHistStart)
      ? capacityHistStart
      : rateHistStart;
    // Actuals for any selected days through today; extend fetch back if the range starts earlier.
    const actualsStart = start.isAfter(todayD) ? null : start;
    const fetchStart =
      actualsStart && actualsStart.isBefore(historyStart) ? actualsStart : historyStart;
    const fetchStartStr = toLocalDateStr(fetchStart);
    const fetchEndStr = toLocalDateStr(todayD);
    // Treatment is often invoiced when a visit is booked, so future dates already carry real
    // revenue. Pull the whole selected range so projections can floor at what is on the books.
    const revenueEndStr = toLocalDateStr(end.isAfter(todayD) ? end : todayD);
    // Include today in hist months so today's calendar points can be projected too
    const projectionMonths = monthsInRange(start, end);
    const histMonths = monthsInRange(fetchStart, todayD);
    const monthKey = (y: number, m: number) => `${y}-${m}`;
    const allMonthPairs = new Map<string, { year: number; month: number }>();
    for (const p of [...projectionMonths, ...histMonths]) {
      allMonthPairs.set(monthKey(p.year, p.month), p);
    }
    const monthPairs = Array.from(allMonthPairs.values());
    // Schedules/overrides for both the averaging window and selected future range.
    const scheduleDates = dateRange(fetchStart, end);
    const doctorIds = providersForApi.map((p) => String(p.id));

    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [revenueResults, pointResults, paymentsSeries, scheduleResults] = await Promise.all([
          fetchDoctorRevenueSeriesCachedMany(
            providersForApi.map((p) => ({ id: String(p.id), name: p.name })),
            fetchStartStr,
            revenueEndStr
          ),
          fetchDoctorMonthsCached(doctorIds, monthPairs),
          fetchPaymentsAnalyticsCached({
            start: fetchStartStr,
            end: fetchEndStr,
            practiceId: PRACTICE_ID,
          }),
          mapPool(providersForApi, PROJECTED_REVENUE_FETCH_CONCURRENCY, async (p) => {
            const id = String(p.id);
            const empId = Number(p.id);
            if (!Number.isFinite(empId)) {
              return {
                id,
                weeklySchedules: [] as EmployeeWeeklySchedule[],
                scheduleOverridesByDate: new Map<string, ScheduleOverride>(),
                goalsWorkdayByDate: new Map<string, boolean>(),
                revenueGoalByDate: new Map<string, number>(),
                pointGoalByDate: new Map<string, number>(),
              };
            }
            const [weeklySchedules, scheduleOverridesByDate, goals] = await Promise.all([
              fetchEmployeeWeeklySchedulesCached(empId),
              fetchScheduleOverridesCached(empId, scheduleDates),
              fetchEmployeeGoalsCached(empId, fetchStartStr, endStr),
            ]);
            const goalsWorkdayByDate = new Map<string, boolean>();
            const revenueGoalByDate = new Map<string, number>();
            const pointGoalByDate = new Map<string, number>();
            for (const item of goals?.dailyGoalBreakdown ?? []) {
              const date = String(item?.date ?? '').slice(0, 10);
              if (!date) continue;
              goalsWorkdayByDate.set(date, Boolean(item.isWorkday));
              revenueGoalByDate.set(date, Number(item.dailyRevenueGoal) || 0);
              pointGoalByDate.set(date, Number(item.dailyPointGoal) || 0);
            }
            return {
              id,
              weeklySchedules,
              scheduleOverridesByDate,
              goalsWorkdayByDate,
              revenueGoalByDate,
              pointGoalByDate,
            };
          }),
        ]);

        if (!alive) return;

        const daysByDoctor: Record<string, DoctorMonthDay[]> = {};
        for (const { doctorId, days } of pointResults) {
          if (!daysByDoctor[doctorId]) daysByDoctor[doctorId] = [];
          daysByDoctor[doctorId].push(...days);
        }

        const schedulesById: Record<string, Omit<DoctorScheduleInfo, 'timeOffDates'>> = {};
        for (const s of scheduleResults) {
          schedulesById[s.id] = s;
        }

        setHistDoctorResponses(revenueResults);
        setMonthDaysByDoctor(daysByDoctor);
        setPaymentHistorySeries(Array.isArray(paymentsSeries) ? paymentsSeries : []);
        setDoctorSchedulesBase(schedulesById);
      } catch (e) {
        if (!alive) return;
        console.error('Projected revenue fetch failed:', e);
        setError('Failed to load projected revenue data');
        setMonthDaysByDoctor({});
        setHistDoctorResponses([]);
        setPaymentHistorySeries([]);
        setDoctorSchedulesBase({});
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // start/end dayjs objects track startStr/endStr; omit them to avoid identity churn.
  }, [providersForApi, startStr, endStr]);

  /** Derive points / counts / time-off from cached month days + type catalog. */
  const {
    pointsByDoctorByDate,
    histPointsByDoctorByDate,
    apptCountByDoctorByDate,
    doctorSchedules,
  } = useMemo(() => {
    const pointsByDoctor: Record<string, Record<string, number>> = {};
    const countsByDoctor: Record<string, Record<string, number>> = {};
    const timeOffByDoctor: Record<string, Set<string>> = {};

    for (const [doctorId, days] of Object.entries(monthDaysByDoctor)) {
      if (!pointsByDoctor[doctorId]) pointsByDoctor[doctorId] = {};
      if (!countsByDoctor[doctorId]) countsByDoctor[doctorId] = {};
      if (!timeOffByDoctor[doctorId]) timeOffByDoctor[doctorId] = new Set<string>();
      for (const day of days) {
        const date = day?.date?.slice(0, 10);
        if (!date) continue;
        pointsByDoctor[doctorId][date] = pointsFromMonthDay(day, typeCatalog);
        countsByDoctor[doctorId][date] = (day.appts ?? []).length;
        if (monthDayIsTimeOff(day)) timeOffByDoctor[doctorId].add(date);
      }
    }

    const schedules: Record<string, DoctorScheduleInfo> = {};
    for (const [id, base] of Object.entries(doctorSchedulesBase)) {
      schedules[id] = {
        ...base,
        timeOffDates: timeOffByDoctor[id] ?? new Set<string>(),
      };
    }

    return {
      pointsByDoctorByDate: pointsByDoctor,
      histPointsByDoctorByDate: pointsByDoctor,
      apptCountByDoctorByDate: countsByDoctor,
      doctorSchedules: schedules,
    };
  }, [monthDaysByDoctor, doctorSchedulesBase, typeCatalog]);

  const ratesByDoctor = useMemo(() => {
    const todayD = dayjs().startOf('day');
    const histEnd = todayD.subtract(1, 'day');
    const histStart = histEnd.subtract(VSD_ESTIMATE_LOOKBACK_DAYS - 1, 'day');
    const providerIds = providersForApi.map((p) => String(p.id));
    const practiceAvg = meanPracticeHistoricalVsdPerPoint(
      providerIds,
      histDoctorResponses,
      histPointsByDoctorByDate,
      histStart,
      histEnd
    );

    const byDoctor: Record<
      string,
      { rate: number | null; usedPracticeFallback: boolean; personalAvg: number | null }
    > = {};
    for (const p of providersForApi) {
      const id = String(p.id);
      const hist = histDoctorResponses.find((x) => x.doctorId === id);
      const histPts = histPointsByDoctorByDate[id] ?? {};
      const personalAvg = hist
        ? meanHistoricalVsdPerPoint(hist.response.series ?? [], histPts, histStart, histEnd)
        : null;
      const usedPracticeFallback = personalAvg == null && practiceAvg != null;
      byDoctor[id] = {
        rate: personalAvg ?? practiceAvg,
        usedPracticeFallback,
        personalAvg,
      };
    }
    return { byDoctor, practiceAvg };
  }, [providersForApi, histDoctorResponses, histPointsByDoctorByDate]);

  /** Each doctor's trailing-30-day point average, kept separately for every weekday. */
  const weekdayCapacityByDoctor = useMemo(() => {
    const todayD = dayjs().startOf('day');
    const histEnd = todayD.subtract(1, 'day');
    const histStart = histEnd.subtract(DOCTOR_CAPACITY_LOOKBACK_DAYS - 1, 'day');

    const capacityById: Record<string, DoctorPointsCapacity> = {};
    for (const p of providersForApi) {
      const id = String(p.id);
      capacityById[id] = buildDoctorPointsCapacity(
        histPointsByDoctorByDate[id],
        histStart,
        histEnd,
        {
          timeOffDates: doctorSchedules[id]?.timeOffDates,
          isWorkday: (date) => isDoctorWorkingOnDate(doctorSchedules[id], date),
        }
      );
    }

    return capacityById;
  }, [providersForApi, histPointsByDoctorByDate, doctorSchedules]);

  /** Posted treatment VSD by doctor/date from ops revenue series; includes pre-billed future dates. */
  const actualTreatmentByDoctorByDate = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const { doctorId, response } of histDoctorResponses) {
      out[doctorId] = {};
      for (const p of response.series ?? []) {
        const d = String(p?.date ?? '').slice(0, 10);
        if (d) out[doctorId][d] = (out[doctorId][d] ?? 0) + Number(p?.total ?? 0);
      }
    }
    return out;
  }, [histDoctorResponses]);

  /** Actual pharmacy / membership payments by date (through today). */
  const actualAncillaryByDate = useMemo(() => {
    const out = new Map<string, { pharmacy: number; membership: number }>();
    for (const p of paymentHistorySeries) {
      const d = String(p?.date ?? '').slice(0, 10);
      if (!d) continue;
      out.set(d, {
        pharmacy: Number(p.onlinePharmacyRevenue) || 0,
        membership: membershipRevenueForDay(p),
      });
    }
    return out;
  }, [paymentHistorySeries]);

  /** Pharmacy + membership with measured daily growth (from Payments). */
  const ancillaryRates = useMemo(() => {
    const todayD = dayjs().startOf('day');
    const histEnd = todayD.subtract(1, 'day');
    const histStart = histEnd.subtract(VSD_ESTIMATE_LOOKBACK_DAYS - 1, 'day');
    return buildAncillaryDailyRates(paymentHistorySeries, histStart, histEnd);
  }, [paymentHistorySeries]);

  const includeAncillary = graphSelection === PRACTICE_TOTAL_ID;
  const todayCalStr = toLocalDateStr(dayjs().startOf('day'));

  /** Per-day revenue: actuals through today, projections for future days. */
  const dailyEstimates = useMemo(() => {
    const dates = dateRange(start, end);
    const todayD = dayjs().startOf('day');

    return dates.map((date) => {
      const isActual = !dayjs(date).startOf('day').isAfter(todayD);
      const points = (() => {
        if (graphSelection === PRACTICE_TOTAL_ID) {
          return providersForApi.reduce(
            (s, p) => s + (pointsByDoctorByDate[String(p.id)]?.[date] ?? 0),
            0
          );
        }
        return pointsByDoctorByDate[graphSelection]?.[date] ?? 0;
      })();
      const appointmentCount = (() => {
        if (graphSelection === PRACTICE_TOTAL_ID) {
          return providersForApi.reduce(
            (s, p) => s + (apptCountByDoctorByDate[String(p.id)]?.[date] ?? 0),
            0
          );
        }
        return apptCountByDoctorByDate[graphSelection]?.[date] ?? 0;
      })();
      const typicalForDoctor = (id: string, bookedPoints = 0) => {
        const provider = providersForApi.find((p) => String(p.id) === id);
        return projectDoctorWeekdayPoints({
          bookedPoints,
          date,
          capacity: weekdayCapacityByDoctor[id],
          dailyPointGoal:
            doctorSchedules[id]?.pointGoalByDate.get(date) ?? provider?.dailyPointGoal,
        });
      };

      if (isActual) {
        const isToday = date === todayCalStr;
        const idsForDay =
          graphSelection === PRACTICE_TOTAL_ID
            ? providersForApi.map((p) => String(p.id))
            : [graphSelection];

        let actualTreatment = 0;
        let treatment = 0;
        let estimateExceedsActual = false;
        let workingDoctorCount = 0;
        let typicalDayPoints = 0;
        for (const id of idsForDay) {
          const bookedPts = pointsByDoctorByDate[id]?.[date] ?? 0;
          // Drs column: only doctors with appointments already on the books.
          if (bookedPts > 0) workingDoctorCount += 1;
          if (isDoctorWorkingOnDate(doctorSchedules[id], date)) {
            typicalDayPoints += typicalForDoctor(id).points ?? 0;
          }
          const actual = actualTreatmentByDoctorByDate[id]?.[date] ?? 0;
          actualTreatment += actual;
          if (!isToday) {
            treatment += actual;
            continue;
          }
          // Once a doctor has hit their revenue goal, stop estimating more for the day.
          const goal = doctorSchedules[id]?.revenueGoalByDate.get(date) ?? 0;
          if (goal > 0 && actual >= goal) {
            treatment += actual;
            continue;
          }
          // Treatment is often invoiced when the visit is booked rather than when it is
          // delivered, so today's posted revenue already covers appointments that have not
          // happened yet. Adding a points estimate on top would count those twice; take
          // whichever view of the day is larger instead.
          const rate = ratesByDoctor.byDoctor[id]?.rate;
          const estimate = rate != null && bookedPts > 0 ? rate * bookedPts : 0;
          if (estimate > actual) estimateExceedsActual = true;
          treatment += Math.max(actual, estimate);
        }

        const ancillaryActual = includeAncillary
          ? (actualAncillaryByDate.get(date) ?? { pharmacy: 0, membership: 0 })
          : { pharmacy: 0, membership: 0 };
        return {
          date,
          bookedEstimated: actualTreatment,
          treatmentEstimated: treatment,
          pharmacyEstimated: ancillaryActual.pharmacy,
          membershipEstimated: ancillaryActual.membership,
          estimated: treatment + ancillaryActual.pharmacy + ancillaryActual.membership,
          points,
          projectedPoints: points,
          typicalDayPoints,
          workingDoctorCount,
          appointmentCount,
          daysUntil: 0,
          fillFraction: null as number | null,
          isActual: true,
          isPartialToday: isToday && estimateExceedsActual,
          isDayOff: false,
        };
      }

      const daysUntil = Math.max(0, dayjs(date).startOf('day').diff(todayD, 'day'));
      const ancillary = includeAncillary
        ? ancillaryForDate(date, ancillaryRates, todayD)
        : { pharmacy: 0, membership: 0 };
      // Revenue already invoiced against this future date. It is a floor, not an addition: the
      // points estimate is predicting the same visits this money was billed for.
      const postedFor = (id: string) => actualTreatmentByDoctorByDate[id]?.[date] ?? 0;

      /** One future day for one doctor: points, then treatment at that doctor's VSD/point. */
      const projectDoctor = (id: string) => {
        const pts = pointsByDoctorByDate[id]?.[date] ?? 0;
        const posted = postedFor(id);
        const working = isDoctorWorkingOnDate(doctorSchedules[id], date);
        const rate = ratesByDoctor.byDoctor[id]?.rate;
        const weekdayProjection = typicalForDoctor(id, pts);
        // Off with something already booked: that is all there will be.
        const projection = working ? weekdayProjection : { projectedPoints: pts };
        return {
          working,
          posted,
          points: pts,
          projectedPoints: projection.projectedPoints,
          fillFraction: null as number | null,
          typicalDayPoints: working ? (weekdayProjection.points ?? 0) : 0,
          bookedTreatment: Math.max(rate != null ? rate * pts : 0, posted),
          projectedTreatment: Math.max(
            rate != null ? rate * projection.projectedPoints : 0,
            posted
          ),
        };
      };

      if (graphSelection === PRACTICE_TOTAL_ID) {
        // Each doctor is projected against their own typical day and then summed, so a day
        // staffed by two high-volume doctors does not project like a day staffed by two quiet
        // ones. A blended per-doctor average would make both days identical.
        let points = 0;
        let projectedPoints = 0;
        let typicalDayPoints = 0;
        let bookedTreatment = 0;
        let projectedTreatment = 0;
        let postedTotal = 0;
        let workingDoctorCount = 0;
        let scheduledDoctorCount = 0;
        let fillFraction: number | null = null;

        for (const p of providersForApi) {
          const d = projectDoctor(String(p.id));
          postedTotal += d.posted;
          if (!d.working && d.points <= 0 && d.posted <= 0) continue;
          // Drs column: only doctors with appointments already on the books.
          if (d.points > 0) workingDoctorCount += 1;
          if (d.working) {
            scheduledDoctorCount += 1;
            if (fillFraction == null) fillFraction = d.fillFraction;
          }
          points += d.points;
          projectedPoints += d.projectedPoints;
          typicalDayPoints += d.typicalDayPoints;
          bookedTreatment += d.bookedTreatment;
          projectedTreatment += d.projectedTreatment;
        }

        // No one scheduled and nothing on the books → $0 treatment (weekends / all OFF).
        if (scheduledDoctorCount === 0 && points <= 0 && postedTotal <= 0) {
          return {
            date,
            bookedEstimated: 0,
            treatmentEstimated: 0,
            pharmacyEstimated: ancillary.pharmacy,
            membershipEstimated: ancillary.membership,
            estimated: ancillary.pharmacy + ancillary.membership,
            points: 0,
            projectedPoints: 0,
            typicalDayPoints: 0,
            workingDoctorCount: 0,
            appointmentCount,
            daysUntil,
            fillFraction: null,
            isActual: false,
            isPartialToday: false,
            isDayOff: true,
          };
        }

        const treatmentEstimated = Math.max(projectedTreatment, postedTotal);
        const bookedEstimated = Math.max(bookedTreatment, postedTotal);
        return {
          date,
          bookedEstimated,
          treatmentEstimated,
          pharmacyEstimated: ancillary.pharmacy,
          membershipEstimated: ancillary.membership,
          estimated: treatmentEstimated + ancillary.pharmacy + ancillary.membership,
          points,
          projectedPoints,
          typicalDayPoints,
          workingDoctorCount,
          appointmentCount,
          daysUntil,
          fillFraction,
          isActual: false,
          isPartialToday: false,
          isDayOff: false,
        };
      }

      const doctor = projectDoctor(graphSelection);
      if (!doctor.working && doctor.points <= 0 && doctor.posted <= 0) {
        return {
          date,
          bookedEstimated: 0,
          treatmentEstimated: 0,
          pharmacyEstimated: 0,
          membershipEstimated: 0,
          estimated: 0,
          points: 0,
          projectedPoints: 0,
          typicalDayPoints: 0,
          workingDoctorCount: 0,
          appointmentCount,
          daysUntil,
          fillFraction: null,
          isActual: false,
          isPartialToday: false,
          isDayOff: true,
        };
      }

      return {
        date,
        bookedEstimated: doctor.bookedTreatment,
        treatmentEstimated: doctor.projectedTreatment,
        pharmacyEstimated: 0,
        membershipEstimated: 0,
        estimated: doctor.projectedTreatment,
        points: doctor.points,
        projectedPoints: doctor.projectedPoints,
        typicalDayPoints: doctor.typicalDayPoints,
        workingDoctorCount: doctor.points > 0 ? 1 : 0,
        appointmentCount,
        daysUntil,
        fillFraction: doctor.fillFraction,
        isActual: false,
        isPartialToday: false,
        isDayOff: !doctor.working,
      };
    });
  }, [
    start,
    end,
    graphSelection,
    includeAncillary,
    providersForApi,
    pointsByDoctorByDate,
    apptCountByDoctorByDate,
    todayCalStr,
    ratesByDoctor,
    ancillaryRates,
    actualTreatmentByDoctorByDate,
    actualAncillaryByDate,
    doctorSchedules,
    weekdayCapacityByDoctor,
  ]);

  const buckets: BucketRow[] = useMemo(() => {
    if (useDailyBuckets) {
      return dailyEstimates.map((d) => ({
        key: d.date,
        label: dayjs(d.date).format('MMM D'),
        bookedEstimated: d.bookedEstimated,
        treatmentEstimated: d.treatmentEstimated,
        pharmacyEstimated: d.pharmacyEstimated,
        membershipEstimated: d.membershipEstimated,
        estimated: d.estimated,
        points: d.points,
        projectedPoints: d.projectedPoints,
        typicalDayPoints: d.typicalDayPoints,
        workingDoctorCount: d.workingDoctorCount,
        appointmentCount: d.appointmentCount,
        isActual: d.isActual,
        actualDayCount: d.isActual ? 1 : 0,
        projectedDayCount: d.isActual ? 0 : 1,
        offDayCount: d.isDayOff ? 1 : 0,
        partialDayCount: d.isPartialToday ? 1 : 0,
      }));
    }

    const byWeek = new Map<string, BucketRow>();
    for (const d of dailyEstimates) {
      const weekStart = dayjs(d.date).startOf('isoWeek');
      const key = toLocalDateStr(weekStart);
      const existing = byWeek.get(key);
      if (!existing) {
        byWeek.set(key, {
          key,
          label: `Week of ${weekStart.format('MMM D')}`,
          bookedEstimated: d.bookedEstimated,
          treatmentEstimated: d.treatmentEstimated,
          pharmacyEstimated: d.pharmacyEstimated,
          membershipEstimated: d.membershipEstimated,
          estimated: d.estimated,
          points: d.points,
          projectedPoints: d.projectedPoints,
          typicalDayPoints: d.typicalDayPoints,
          workingDoctorCount: d.workingDoctorCount,
          appointmentCount: d.appointmentCount,
          isActual: d.isActual,
          actualDayCount: d.isActual ? 1 : 0,
          projectedDayCount: d.isActual ? 0 : 1,
          offDayCount: d.isDayOff ? 1 : 0,
          partialDayCount: d.isPartialToday ? 1 : 0,
        });
      } else {
        existing.bookedEstimated += d.bookedEstimated;
        existing.treatmentEstimated += d.treatmentEstimated;
        existing.pharmacyEstimated += d.pharmacyEstimated;
        existing.membershipEstimated += d.membershipEstimated;
        existing.estimated += d.estimated;
        existing.points += d.points;
        existing.projectedPoints += d.projectedPoints;
        existing.typicalDayPoints += d.typicalDayPoints;
        existing.workingDoctorCount += d.workingDoctorCount;
        existing.appointmentCount += d.appointmentCount;
        existing.actualDayCount += d.isActual ? 1 : 0;
        existing.projectedDayCount += d.isActual ? 0 : 1;
        existing.offDayCount += d.isDayOff ? 1 : 0;
        existing.partialDayCount += d.isPartialToday ? 1 : 0;
        existing.isActual = existing.projectedDayCount === 0;
      }
    }
    return Array.from(byWeek.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [dailyEstimates, useDailyBuckets]);

  const totals = useMemo(() => {
    return buckets.reduce(
      (acc, b) => {
        acc.bookedEstimated += b.bookedEstimated;
        acc.treatmentEstimated += b.treatmentEstimated;
        acc.pharmacyEstimated += b.pharmacyEstimated;
        acc.membershipEstimated += b.membershipEstimated;
        acc.estimated += b.estimated;
        acc.points += b.points;
        acc.projectedPoints += b.projectedPoints;
        acc.typicalDayPoints += b.typicalDayPoints;
        acc.appointmentCount += b.appointmentCount;
        acc.actualDayCount += b.actualDayCount;
        acc.projectedDayCount += b.projectedDayCount;
        acc.offDayCount += b.offDayCount;
        acc.partialDayCount += b.partialDayCount;
        return acc;
      },
      {
        bookedEstimated: 0,
        treatmentEstimated: 0,
        pharmacyEstimated: 0,
        membershipEstimated: 0,
        estimated: 0,
        points: 0,
        projectedPoints: 0,
        typicalDayPoints: 0,
        appointmentCount: 0,
        actualDayCount: 0,
        projectedDayCount: 0,
        offDayCount: 0,
        partialDayCount: 0,
      }
    );
  }, [buckets]);

  const actualVsProjectedTotals = useMemo(() => {
    let actualTotal = 0;
    let projectedTotal = 0;
    let actualTreatment = 0;
    let projectedTreatment = 0;
    for (const d of dailyEstimates) {
      if (d.isActual) {
        actualTotal += d.estimated;
        actualTreatment += d.treatmentEstimated;
      } else {
        projectedTotal += d.estimated;
        projectedTreatment += d.treatmentEstimated;
      }
    }
    return { actualTotal, projectedTotal, actualTreatment, projectedTreatment };
  }, [dailyEstimates]);
  const graphOptions = useMemo(() => {
    const opts = [{ id: PRACTICE_TOTAL_ID, label: 'Practice total' }];
    for (const p of providersForApi) {
      opts.push({ id: String(p.id), label: p.name });
    }
    return opts;
  }, [providersForApi]);

  useEffect(() => {
    if (graphSelection === PRACTICE_TOTAL_ID) return;
    if (!providersForApi.some((p) => String(p.id) === graphSelection)) {
      setGraphSelection(PRACTICE_TOTAL_ID);
    }
  }, [providersForApi, graphSelection]);

  const chartData = useMemo(
    () =>
      buckets.map((b) => ({
        period: b.label,
        estimated: Math.round(b.estimated * 100) / 100,
        treatmentEstimated: Math.round(b.treatmentEstimated * 100) / 100,
        bookedEstimated: Math.round(b.bookedEstimated * 100) / 100,
        pharmacyEstimated: Math.round(b.pharmacyEstimated * 100) / 100,
        membershipEstimated: Math.round(b.membershipEstimated * 100) / 100,
        points: Math.round(b.points * 10) / 10,
        projectedPoints: Math.round(b.projectedPoints * 10) / 10,
      })),
    [buckets]
  );

  const hasAnyRate = Object.values(ratesByDoctor.byDoctor).some((r) => r.rate != null);
  const expectedAdditionalTreatment = useMemo(
    () =>
      dailyEstimates
        .filter((d) => !d.isActual)
        .reduce((s, d) => s + Math.max(0, d.treatmentEstimated - d.bookedEstimated), 0),
    [dailyEstimates]
  );
  const hasMixedActualProjected = totals.actualDayCount > 0 && totals.projectedDayCount > 0;
  const chartLabel = (name: string) => {
    switch (name) {
      case 'estimated':
        return includeAncillary ? 'Total' : 'Treatment';
      case 'treatmentEstimated':
        return 'Treatment (VSD)';
      case 'bookedEstimated':
        return 'Treatment on the books';
      case 'pharmacyEstimated':
        return 'Pharmacy';
      case 'membershipEstimated':
        return 'Membership';
      default:
        return name;
    }
  };

  function bucketSourceLabel(b: BucketRow): string {
    if (b.actualDayCount > 0 && b.projectedDayCount > 0) return 'Mixed';
    if (b.isActual) return b.partialDayCount > 0 ? 'Est. full day' : 'Actual';
    if (b.projectedDayCount > 0 && b.offDayCount === b.projectedDayCount) return 'Not scheduled';
    return 'Projected';
  }

  if (loading) {
    return (
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box
          sx={{
            pb: 3,
            minHeight: 320,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CircularProgress />
        </Box>
      </LocalizationProvider>
    );
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Projected Revenue
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Past days use actual treatment VSD and (for practice totals) actual pharmacy / membership
          payments. For today, each doctor shows the greater of their posted VSD and their booked
          points × trailing {VSD_ESTIMATE_LOOKBACK_DAYS}-day VSD per point — treatment is often
          invoiced at booking, so the two are never added together. A doctor whose posted VSD
          already meets their daily revenue goal shows actual only. For future days, each scheduled
          doctor is expected to reach their own average for that specific weekday over the trailing{' '}
          {DOCTOR_CAPACITY_LOOKBACK_DAYS} days, shown as Typical pts. For example, a doctor&apos;s
          recent Fridays determine future Fridays; Mondays do not affect them. Expected points are
          that weekday average or the points already booked, whichever is higher—there is no
          additional booking-fill multiplier. Expected points are then priced at each doctor&apos;s
          trailing {VSD_ESTIMATE_LOOKBACK_DAYS}-day VSD per point, plus pharmacy and Square + Stripe
          membership revenue that each follow their measured daily growth trend from the last{' '}
          {VSD_ESTIMATE_LOOKBACK_DAYS} days. Because visits are billed at booking, a future day
          never projects below the treatment revenue already invoiced against it. Days nobody is
          scheduled get no expected volume (weekly schedules, OFF overrides, and calendar time off
          all count), and cancelled visits never count as booked points.
          {useDailyBuckets
            ? ' Showing daily totals for this range.'
            : ' Range is over 30 days — showing weekly totals.'}
        </Typography>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Date range"
            action={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {Object.keys(PRESETS).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setPreset(key);
                      applyRange(PRESETS[key]());
                    }}
                    style={{
                      padding: '6px 12px',
                      border: preset === key ? '2px solid #1976d2' : '1px solid #ccc',
                      borderRadius: 4,
                      background: preset === key ? '#e3f2fd' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {key}
                  </button>
                ))}
              </Box>
            }
          />
          <CardContent sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <DatePicker
              label="From"
              value={draftRange.from}
              onChange={(d) => {
                if (d) {
                  setPreset('');
                  onCustomFromChange(d);
                }
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="To"
              value={draftRange.to}
              onChange={(d) => {
                if (d) {
                  setPreset('');
                  onCustomToChange(d);
                }
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
          </CardContent>
        </Card>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!hasAnyRate && totals.projectedDayCount > 0 && !error && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No trailing VSD/point history is available yet, so future-day estimates cannot be
            calculated. Past and today still show actual revenue when available.
          </Alert>
        )}

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Summary"
            subheader={`${start.format('MMM D, YYYY')} – ${end.format('MMM D, YYYY')}${
              hasMixedActualProjected
                ? ` · actual through ${dayjs(todayCalStr).format('MMM D')}, projected after`
                : totals.actualDayCount > 0 && totals.projectedDayCount === 0
                  ? ' · actuals only'
                  : totals.projectedDayCount > 0
                    ? ' · projected only'
                    : ''
            }`}
            action={
              <FormControl size="small" sx={{ minWidth: 220, mr: 1, mt: 0.5 }}>
                <InputLabel id="projected-scope-label">Show for</InputLabel>
                <Select
                  labelId="projected-scope-label"
                  value={graphSelection}
                  label="Show for"
                  onChange={(e) => setGraphSelection(e.target.value)}
                >
                  {graphOptions.map((opt) => (
                    <MenuItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            }
          />
          <CardContent>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  {includeAncillary
                    ? 'Total (actual + projected)'
                    : 'Treatment (actual + projected)'}
                </Typography>
                <Typography variant="h5">{fmtUSD(totals.estimated)}</Typography>
              </Box>
              {hasMixedActualProjected && (
                <>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Actual through today
                    </Typography>
                    <Typography variant="h5">
                      {fmtUSD(actualVsProjectedTotals.actualTotal)}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Projected remaining
                    </Typography>
                    <Typography variant="h5">
                      {fmtUSD(actualVsProjectedTotals.projectedTotal)}
                    </Typography>
                  </Box>
                </>
              )}
              {includeAncillary && (
                <>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Treatment (VSD)
                    </Typography>
                    <Typography variant="h5">{fmtUSD(totals.treatmentEstimated)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Pharmacy
                    </Typography>
                    <Typography variant="h5">{fmtUSD(totals.pharmacyEstimated)}</Typography>
                    {totals.projectedDayCount > 0 && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {ancillaryRates.pharmacyDailyGrowth >= 0 ? '+' : ''}
                        {fmtUSD(ancillaryRates.pharmacyDailyGrowth)}/day growth · near-term ~
                        {fmtUSD(ancillaryRates.pharmacyBaseline)}
                      </Typography>
                    )}
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Membership
                    </Typography>
                    <Typography variant="h5">{fmtUSD(totals.membershipEstimated)}</Typography>
                    {totals.projectedDayCount > 0 && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {ancillaryRates.membershipDailyGrowth >= 0 ? '+' : ''}
                        {fmtUSD(ancillaryRates.membershipDailyGrowth)}/day growth · near-term ~
                        {fmtUSD(ancillaryRates.membershipBaseline)}
                      </Typography>
                    )}
                  </Box>
                </>
              )}
              {totals.projectedDayCount > 0 && (
                <>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Treatment on the books (future)
                    </Typography>
                    <Typography variant="h5">
                      {fmtUSD(
                        dailyEstimates
                          .filter((d) => !d.isActual)
                          .reduce((s, d) => s + d.bookedEstimated, 0)
                      )}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Expected above the books
                    </Typography>
                    <Typography variant="h5">{fmtUSD(expectedAdditionalTreatment)}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      room from booked points to weekday averages
                    </Typography>
                  </Box>
                </>
              )}
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Booked / expected points
                </Typography>
                <Typography variant="h5">
                  {Math.round(totals.points * 10) / 10}
                  {' / '}
                  {Math.round(totals.projectedPoints * 10) / 10}
                </Typography>
                {totals.typicalDayPoints > 0 && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    {Math.round(totals.typicalDayPoints * 10) / 10} typical for the doctors
                    scheduled
                  </Typography>
                )}
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Booked appointments
                </Typography>
                <Typography variant="h5">{totals.appointmentCount}</Typography>
              </Box>
              {graphSelection !== PRACTICE_TOTAL_ID &&
                ratesByDoctor.byDoctor[graphSelection]?.rate != null && (
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      VSD / point (trailing)
                    </Typography>
                    <Typography variant="h5">
                      {fmtUSD(ratesByDoctor.byDoctor[graphSelection].rate!)}
                      {ratesByDoctor.byDoctor[graphSelection].usedPracticeFallback && (
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: 1 }}
                        >
                          (practice avg)
                        </Typography>
                      )}
                    </Typography>
                  </Box>
                )}
              {graphSelection === PRACTICE_TOTAL_ID && ratesByDoctor.practiceAvg != null && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Practice VSD / point (trailing)
                  </Typography>
                  <Typography variant="h5">{fmtUSD(ratesByDoctor.practiceAvg)}</Typography>
                </Box>
              )}
            </Box>
            {!includeAncillary && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                Pharmacy and membership are practice-wide — switch to Practice total to include
                them.
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title={useDailyBuckets ? 'Revenue by day' : 'Revenue by week'}
            subheader={
              hasMixedActualProjected
                ? 'Through today = actual; after today = projected (treatment fill-in + ancillary averages)'
                : includeAncillary
                  ? 'Includes treatment, pharmacy, and membership'
                  : 'Treatment revenue for the selected provider'
            }
          />
          <CardContent>
            {chartData.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No data for this range.
              </Typography>
            ) : (
              <Box sx={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                    <YAxis
                      tickFormatter={(v) =>
                        new Intl.NumberFormat(undefined, {
                          style: 'currency',
                          currency: 'USD',
                          maximumFractionDigits: 0,
                        }).format(Number(v) || 0)
                      }
                      width={72}
                    />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => [
                        fmtUSD(Number(value ?? 0)),
                        chartLabel(String(name)),
                      ]}
                    />
                    <Legend formatter={(value) => chartLabel(String(value))} />
                    <Line
                      type="monotone"
                      dataKey="estimated"
                      stroke="#1976d2"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="estimated"
                    />
                    {includeAncillary && (
                      <Line
                        type="monotone"
                        dataKey="treatmentEstimated"
                        stroke="#1565c0"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={{ r: 2 }}
                        name="treatmentEstimated"
                      />
                    )}
                    {!includeAncillary && (
                      <Line
                        type="monotone"
                        dataKey="bookedEstimated"
                        stroke="#90caf9"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={{ r: 2 }}
                        name="bookedEstimated"
                      />
                    )}
                    {includeAncillary && (
                      <>
                        <Line
                          type="monotone"
                          dataKey="pharmacyEstimated"
                          stroke="#2e7d32"
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          name="pharmacyEstimated"
                        />
                        <Line
                          type="monotone"
                          dataKey="membershipEstimated"
                          stroke="#6a1b9a"
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          name="membershipEstimated"
                        />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title={useDailyBuckets ? 'Daily breakdown' : 'Weekly breakdown'} />
          <CardContent sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{useDailyBuckets ? 'Date' : 'Week'}</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell align="right">
                    <MuiTooltip
                      title={
                        useDailyBuckets
                          ? 'Doctors with at least one appointment on the books that day.'
                          : 'Doctor-days: sum of doctors with appointments on the books across each day in the week.'
                      }
                    >
                      <span>{useDailyBuckets ? 'Drs' : 'Dr-days'}</span>
                    </MuiTooltip>
                  </TableCell>
                  <TableCell align="right">Appts</TableCell>
                  <TableCell align="right">Booked pts</TableCell>
                  <TableCell align="right">Typical pts</TableCell>
                  <TableCell align="right">Expected pts</TableCell>
                  <TableCell align="right">Treatment</TableCell>
                  {includeAncillary && (
                    <>
                      <TableCell align="right">Pharmacy</TableCell>
                      <TableCell align="right">Membership</TableCell>
                    </>
                  )}
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {buckets.map((b) => (
                  <TableRow key={b.key}>
                    <TableCell>
                      {useDailyBuckets ? dayjs(b.key).format('ddd, MMM D, YYYY') : b.label}
                    </TableCell>
                    <TableCell>{bucketSourceLabel(b)}</TableCell>
                    <TableCell align="right">{b.workingDoctorCount}</TableCell>
                    <TableCell align="right">{b.appointmentCount}</TableCell>
                    <TableCell align="right">{Math.round(b.points * 10) / 10}</TableCell>
                    <TableCell align="right">
                      {b.typicalDayPoints > 0 ? Math.round(b.typicalDayPoints * 10) / 10 : '—'}
                    </TableCell>
                    <TableCell align="right">{Math.round(b.projectedPoints * 10) / 10}</TableCell>
                    <TableCell align="right">{fmtUSD(b.treatmentEstimated)}</TableCell>
                    {includeAncillary && (
                      <>
                        <TableCell align="right">{fmtUSD(b.pharmacyEstimated)}</TableCell>
                        <TableCell align="right">{fmtUSD(b.membershipEstimated)}</TableCell>
                      </>
                    )}
                    <TableCell align="right">{fmtUSD(b.estimated)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>
                    <Typography variant="subtitle2">Total</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="subtitle2">
                      {hasMixedActualProjected
                        ? 'Mixed'
                        : totals.actualDayCount > 0
                          ? 'Actual'
                          : 'Projected'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" />
                  <TableCell align="right">
                    <Typography variant="subtitle2">{totals.appointmentCount}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="subtitle2">
                      {Math.round(totals.points * 10) / 10}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="subtitle2">
                      {totals.typicalDayPoints > 0
                        ? Math.round(totals.typicalDayPoints * 10) / 10
                        : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="subtitle2">
                      {Math.round(totals.projectedPoints * 10) / 10}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="subtitle2">{fmtUSD(totals.treatmentEstimated)}</Typography>
                  </TableCell>
                  {includeAncillary && (
                    <>
                      <TableCell align="right">
                        <Typography variant="subtitle2">
                          {fmtUSD(totals.pharmacyEstimated)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="subtitle2">
                          {fmtUSD(totals.membershipEstimated)}
                        </Typography>
                      </TableCell>
                    </>
                  )}
                  <TableCell align="right">
                    <Typography variant="subtitle2">{fmtUSD(totals.estimated)}</Typography>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Box>
    </LocalizationProvider>
  );
}
