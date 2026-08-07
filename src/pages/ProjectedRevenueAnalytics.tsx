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
import {
  fetchDoctorRevenueSeries,
  type DoctorRevenuePoint,
  type DoctorRevenueSeriesResponse,
} from '../api/opsStats';
import { fetchDoctorMonth, type DoctorMonthDay } from '../api/appointments';
import {
  fetchAllAppointmentTypes,
  fetchEmployee,
  scheduleOverrideIsOff,
  type EmployeeWeeklySchedule,
  type ScheduleOverride,
} from '../api/appointmentSettings';
import { fetchAppointmentBookingsAnalytics } from '../api/appointmentBookingsAnalytics';
import { fetchEmployeeGoals } from '../api/employeeGoals';
import { fetchPaymentsAnalytics, type PaymentPoint } from '../api/payments';
import {
  buildAppointmentTypeCatalog,
  pointsFromAppointmentRows,
  type AppointmentTypeCatalog,
} from '../utils/appointmentTypeSettings';
import { fetchScheduleOverridesByDate } from '../utils/scheduleOverrideMerge';
import { monthDayIsTimeOff } from '../utils/doctorTimeOff';
import {
  BOOKING_FILL_SERVICE_LOOKBACK_DAYS,
  bookingFillHistoryWindow,
  buildBookingFillCurve,
  flattenBookingAnalyticsDetails,
  projectPointsWithFillCurve,
  type BookingFillCurve,
  type BookingForFillCurve,
} from '../utils/bookingFillCurve';
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

/**
 * Weekday-aware trailing averages for pharmacy / membership.
 * Missing days in the series count as $0 so sparse data does not inflate the mean.
 */
function buildAncillaryDailyRates(
  series: PaymentPoint[],
  histStart: Dayjs,
  histEnd: Dayjs
): {
  pharmacyByDow: number[];
  membershipByDow: number[];
  pharmacyOverall: number;
  membershipOverall: number;
  sampleDays: number;
} {
  const pharmacyByDate = new Map<string, number>();
  const membershipByDate = new Map<string, number>();
  for (const p of series) {
    const d = String(p?.date ?? '').slice(0, 10);
    if (!d) continue;
    pharmacyByDate.set(d, Number(p.onlinePharmacyRevenue) || 0);
    membershipByDate.set(d, membershipRevenueForDay(p));
  }

  const pharmacySums = Array.from({ length: 7 }, () => 0);
  const membershipSums = Array.from({ length: 7 }, () => 0);
  const counts = Array.from({ length: 7 }, () => 0);
  let pharmacyTotal = 0;
  let membershipTotal = 0;
  let sampleDays = 0;

  for (const dateStr of dateRange(histStart, histEnd)) {
    const dow = dayjs(dateStr).day();
    const pharmacy = pharmacyByDate.get(dateStr) ?? 0;
    const membership = membershipByDate.get(dateStr) ?? 0;
    pharmacySums[dow] += pharmacy;
    membershipSums[dow] += membership;
    counts[dow] += 1;
    pharmacyTotal += pharmacy;
    membershipTotal += membership;
    sampleDays += 1;
  }

  const overallPharmacy = sampleDays > 0 ? pharmacyTotal / sampleDays : 0;
  const overallMembership = sampleDays > 0 ? membershipTotal / sampleDays : 0;
  const pharmacyByDow = pharmacySums.map((s, i) =>
    counts[i] > 0 ? s / counts[i] : overallPharmacy
  );
  const membershipByDow = membershipSums.map((s, i) =>
    counts[i] > 0 ? s / counts[i] : overallMembership
  );

  return {
    pharmacyByDow,
    membershipByDow,
    pharmacyOverall: overallPharmacy,
    membershipOverall: overallMembership,
    sampleDays,
  };
}

function ancillaryForDate(
  dateStr: string,
  rates: {
    pharmacyByDow: number[];
    membershipByDow: number[];
    pharmacyOverall: number;
    membershipOverall: number;
  } | null
): { pharmacy: number; membership: number } {
  if (!rates) return { pharmacy: 0, membership: 0 };
  const dow = dayjs(dateStr).day();
  return {
    pharmacy: rates.pharmacyByDow[dow] ?? rates.pharmacyOverall,
    membership: rates.membershipByDow[dow] ?? rates.membershipOverall,
  };
}

type DoctorScheduleInfo = {
  id: string;
  weeklySchedules: EmployeeWeeklySchedule[];
  scheduleOverridesByDate: Map<string, ScheduleOverride>;
  /** Server-resolved workday flags from the goals breakdown (weekly + overrides already merged). */
  goalsWorkdayByDate: Map<string, boolean>;
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
  /** Pharmacy: actual payments (past/today) or trailing weekday avg (future). */
  pharmacyEstimated: number;
  /** Membership: actual payments (past/today) or trailing weekday avg (future). */
  membershipEstimated: number;
  /** treatment + pharmacy + membership (practice) or treatment only (doctor). */
  estimated: number;
  points: number;
  projectedPoints: number;
  appointmentCount: number;
  /** True when every day in this bucket used actual revenue (not a forecast). */
  isActual: boolean;
  /** Days in bucket that used actuals (for mixed weekly buckets). */
  actualDayCount: number;
  /** Days in bucket that used projections. */
  projectedDayCount: number;
  /** Projected days where nobody was scheduled (weekend, day off, vacation). */
  offDayCount: number;
};

export default function ProjectedRevenueAnalyticsPage() {
  const { range, draftRange, applyRange, onCustomFromChange, onCustomToChange } =
    useCommittedDateRange(PRESETS['7D']());
  const [preset, setPreset] = useState<string>('7D');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [graphSelection, setGraphSelection] = useState<string>(PRACTICE_TOTAL_ID);
  const [typeCatalog, setTypeCatalog] = useState<AppointmentTypeCatalog | undefined>();
  const [pointsByDoctorByDate, setPointsByDoctorByDate] = useState<
    Record<string, Record<string, number>>
  >({});
  const [apptCountByDoctorByDate, setApptCountByDoctorByDate] = useState<
    Record<string, Record<string, number>>
  >({});
  const [histDoctorResponses, setHistDoctorResponses] = useState<
    { doctorId: string; name: string; response: DoctorRevenueSeriesResponse }[]
  >([]);
  const [histPointsByDoctorByDate, setHistPointsByDoctorByDate] = useState<
    Record<string, Record<string, number>>
  >({});
  const [bookingHistoryRows, setBookingHistoryRows] = useState<BookingForFillCurve[]>([]);
  const [paymentHistorySeries, setPaymentHistorySeries] = useState<PaymentPoint[]>([]);
  const [doctorSchedules, setDoctorSchedules] = useState<Record<string, DoctorScheduleInfo>>({});
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

  // Load booked appointment points for the selected projection range + trailing VSD history for rates
  // + historical bookings for the late-booking fill curve + actual revenue through today for past days.
  useEffect(() => {
    if (!providersForApi.length) {
      setPointsByDoctorByDate({});
      setApptCountByDoctorByDate({});
      setHistDoctorResponses([]);
      setHistPointsByDoctorByDate({});
      setBookingHistoryRows([]);
      setPaymentHistorySeries([]);
      setDoctorSchedules({});
      setLoading(false);
      return;
    }

    const todayD = dayjs().startOf('day');
    const rateHistEnd = todayD.subtract(1, 'day');
    const rateHistStart = rateHistEnd.subtract(VSD_ESTIMATE_LOOKBACK_DAYS - 1, 'day');
    // Actuals for any selected days through today; extend fetch back if the range starts earlier.
    const actualsStart = start.isAfter(todayD) ? null : start;
    const fetchStart =
      actualsStart && actualsStart.isBefore(rateHistStart) ? actualsStart : rateHistStart;
    const fetchEnd = todayD;
    const fetchStartStr = toLocalDateStr(fetchStart);
    const fetchEndStr = toLocalDateStr(fetchEnd);
    const fillWindow = bookingFillHistoryWindow(todayD);

    // Include today in hist months so today's calendar points can be projected too
    const projectionMonths = monthsInRange(start, end);
    const histMonths = monthsInRange(fetchStart, todayD);
    const monthKey = (y: number, m: number) => `${y}-${m}`;
    const allMonthPairs = new Map<string, { year: number; month: number }>();
    for (const p of [...projectionMonths, ...histMonths]) {
      allMonthPairs.set(monthKey(p.year, p.month), p);
    }
    const monthPairs = Array.from(allMonthPairs.values());
    // Schedules/overrides for the selected range (needed for future non-workday zeroing).
    const scheduleDates = dateRange(start, end);

    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [revenueResults, pointResults, bookingsResp, paymentsSeries, scheduleResults] =
          await Promise.all([
            Promise.all(
              providersForApi.map(async (p) => {
                const id = String(p.id);
                const response = await fetchDoctorRevenueSeries({
                  start: fetchStartStr,
                  end: fetchEndStr,
                  doctorId: id,
                });
                return { doctorId: id, name: p.name, response };
              })
            ),
            Promise.all(
              providersForApi.flatMap((p) =>
                monthPairs.map(async ({ year, month }) => {
                  const doctorId = String(p.id);
                  const resp = await fetchDoctorMonth(year, month, doctorId);
                  return { doctorId, days: resp?.days ?? [] };
                })
              )
            ),
            fetchAppointmentBookingsAnalytics({
              startDate: toLocalDateStr(fillWindow.bookedStart),
              endDate: toLocalDateStr(fillWindow.bookedEnd),
            }).catch((e) => {
              console.error('Booking history for fill curve failed:', e);
              return null;
            }),
            fetchPaymentsAnalytics({
              start: fetchStartStr,
              end: fetchEndStr,
              practiceId: PRACTICE_ID,
            }).catch((e) => {
              console.error('Payments history for pharmacy/membership failed:', e);
              return [] as PaymentPoint[];
            }),
            Promise.all(
              providersForApi.map(async (p) => {
                const id = String(p.id);
                const empId = Number(p.id);
                if (!Number.isFinite(empId)) {
                  return {
                    id,
                    weeklySchedules: [] as EmployeeWeeklySchedule[],
                    scheduleOverridesByDate: new Map<string, ScheduleOverride>(),
                    goalsWorkdayByDate: new Map<string, boolean>(),
                    timeOffDates: new Set<string>(),
                  } satisfies DoctorScheduleInfo;
                }
                const [employee, scheduleOverridesByDate, goals] = await Promise.all([
                  fetchEmployee(empId).catch(() => null),
                  fetchScheduleOverridesByDate(empId, scheduleDates).catch(
                    () => new Map<string, ScheduleOverride>()
                  ),
                  fetchEmployeeGoals(empId, { startDate: startStr, endDate: endStr }).catch(
                    () => null
                  ),
                ]);
                const goalsWorkdayByDate = new Map<string, boolean>();
                for (const item of goals?.dailyGoalBreakdown ?? []) {
                  const date = String(item?.date ?? '').slice(0, 10);
                  if (date) goalsWorkdayByDate.set(date, Boolean(item.isWorkday));
                }
                return {
                  id,
                  weeklySchedules: employee?.weeklySchedules ?? [],
                  scheduleOverridesByDate,
                  goalsWorkdayByDate,
                  timeOffDates: new Set<string>(),
                } satisfies DoctorScheduleInfo;
              })
            ),
          ]);

        if (!alive) return;

        const pointsByDoctor: Record<string, Record<string, number>> = {};
        const countsByDoctor: Record<string, Record<string, number>> = {};
        const timeOffByDoctor: Record<string, Set<string>> = {};
        for (const { doctorId, days } of pointResults) {
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

        const schedulesById: Record<string, DoctorScheduleInfo> = {};
        for (const s of scheduleResults) {
          schedulesById[s.id] = {
            ...s,
            timeOffDates: timeOffByDoctor[s.id] ?? new Set<string>(),
          };
        }

        setHistDoctorResponses(revenueResults);
        setHistPointsByDoctorByDate(pointsByDoctor);
        setPointsByDoctorByDate(pointsByDoctor);
        setApptCountByDoctorByDate(countsByDoctor);
        setBookingHistoryRows(flattenBookingAnalyticsDetails(bookingsResp?.users));
        setPaymentHistorySeries(Array.isArray(paymentsSeries) ? paymentsSeries : []);
        setDoctorSchedules(schedulesById);
      } catch (e) {
        if (!alive) return;
        console.error('Projected revenue fetch failed:', e);
        setError('Failed to load projected revenue data');
        setPointsByDoctorByDate({});
        setApptCountByDoctorByDate({});
        setHistDoctorResponses([]);
        setHistPointsByDoctorByDate({});
        setBookingHistoryRows([]);
        setPaymentHistorySeries([]);
        setDoctorSchedules({});
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [providersForApi, startStr, endStr, typeCatalog]);

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

  /** Actual treatment VSD by doctor/date from ops revenue series (through today). */
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

  /** Practice + per-doctor booking fill curves from historical bookedAt → appointmentStart lead times. */
  const fillCurves = useMemo(() => {
    const todayD = dayjs().startOf('day');
    const { serviceStart, serviceEnd } = bookingFillHistoryWindow(todayD);
    const practice = buildBookingFillCurve(bookingHistoryRows, serviceStart, serviceEnd);
    const byDoctor: Record<string, BookingFillCurve> = {};
    for (const p of providersForApi) {
      const id = String(p.id);
      const doctorCurve = buildBookingFillCurve(bookingHistoryRows, serviceStart, serviceEnd, {
        primaryProviderId: id,
      });
      // Fall back to practice curve when a doctor has too few completed days.
      byDoctor[id] = doctorCurve.sampleDays >= 5 ? doctorCurve : practice;
    }
    return { practice, byDoctor };
  }, [bookingHistoryRows, providersForApi]);

  /** Trailing weekday averages for pharmacy + membership (practice-wide, from Payments). */
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

      if (isActual) {
        let treatment = 0;
        if (graphSelection === PRACTICE_TOTAL_ID) {
          for (const p of providersForApi) {
            treatment += actualTreatmentByDoctorByDate[String(p.id)]?.[date] ?? 0;
          }
        } else {
          treatment = actualTreatmentByDoctorByDate[graphSelection]?.[date] ?? 0;
        }
        const ancillaryActual = includeAncillary
          ? actualAncillaryByDate.get(date) ?? { pharmacy: 0, membership: 0 }
          : { pharmacy: 0, membership: 0 };
        return {
          date,
          bookedEstimated: treatment,
          treatmentEstimated: treatment,
          pharmacyEstimated: ancillaryActual.pharmacy,
          membershipEstimated: ancillaryActual.membership,
          estimated: treatment + ancillaryActual.pharmacy + ancillaryActual.membership,
          points,
          projectedPoints: points,
          appointmentCount,
          daysUntil: 0,
          fillFraction: null as number | null,
          isActual: true,
          isDayOff: false,
        };
      }

      const daysUntil = Math.max(0, dayjs(date).startOf('day').diff(todayD, 'day'));
      const ancillary = includeAncillary
        ? ancillaryForDate(date, ancillaryRates)
        : { pharmacy: 0, membership: 0 };

      if (graphSelection === PRACTICE_TOTAL_ID) {
        // Split the day between doctors who are scheduled and doctors who are off. Only the
        // working side gets late-booking fill; an off doctor keeps whatever is already booked.
        const workingIds: string[] = [];
        let workingPoints = 0;
        let workingBooked = 0;
        let hasWorkingRate = false;
        let offPoints = 0;
        let offBooked = 0;
        for (const p of providersForApi) {
          const id = String(p.id);
          const pts = pointsByDoctorByDate[id]?.[date] ?? 0;
          const rate = ratesByDoctor.byDoctor[id]?.rate;
          if (isDoctorWorkingOnDate(doctorSchedules[id], date)) {
            workingIds.push(id);
            workingPoints += pts;
            if (rate != null) {
              workingBooked += rate * pts;
              hasWorkingRate = true;
            }
            continue;
          }
          if (pts <= 0) continue;
          offPoints += pts;
          if (rate != null) offBooked += rate * pts;
        }

        // No one scheduled and nothing on the books → $0 treatment (weekends / all OFF).
        if (workingIds.length === 0 && offPoints <= 0) {
          return {
            date,
            bookedEstimated: 0,
            treatmentEstimated: 0,
            pharmacyEstimated: ancillary.pharmacy,
            membershipEstimated: ancillary.membership,
            estimated: ancillary.pharmacy + ancillary.membership,
            points: 0,
            projectedPoints: 0,
            appointmentCount,
            daysUntil,
            fillFraction: null,
            isActual: false,
            isDayOff: true,
          };
        }

        const fill = projectPointsWithFillCurve(workingPoints, daysUntil, fillCurves.practice);
        // Scale empty-day practice remaining when only a subset of doctors are working.
        let projectedWorkingPoints = fill.projectedPoints;
        if (workingPoints <= 0 && workingIds.length > 0 && providersForApi.length > 0) {
          projectedWorkingPoints =
            fill.projectedPoints * (workingIds.length / providersForApi.length);
        }

        let workingTreatment = 0;
        if (workingPoints > 0 && hasWorkingRate) {
          workingTreatment = workingBooked * (projectedWorkingPoints / workingPoints);
        } else if (ratesByDoctor.practiceAvg != null) {
          workingTreatment = ratesByDoctor.practiceAvg * projectedWorkingPoints;
        }

        const treatmentEstimated = workingTreatment + offBooked;
        const bookedEstimated = workingBooked + offBooked;
        return {
          date,
          bookedEstimated,
          treatmentEstimated,
          pharmacyEstimated: ancillary.pharmacy,
          membershipEstimated: ancillary.membership,
          estimated: treatmentEstimated + ancillary.pharmacy + ancillary.membership,
          points: workingPoints + offPoints,
          projectedPoints: projectedWorkingPoints + offPoints,
          appointmentCount,
          daysUntil,
          fillFraction: fill.fillFraction,
          isActual: false,
          isDayOff: false,
        };
      }

      const id = graphSelection;
      const pts = pointsByDoctorByDate[id]?.[date] ?? 0;
      const working = isDoctorWorkingOnDate(doctorSchedules[id], date);
      if (!working && pts <= 0) {
        return {
          date,
          bookedEstimated: 0,
          treatmentEstimated: 0,
          pharmacyEstimated: 0,
          membershipEstimated: 0,
          estimated: 0,
          points: 0,
          projectedPoints: 0,
          appointmentCount,
          daysUntil,
          fillFraction: null,
          isActual: false,
          isDayOff: true,
        };
      }

      const rate = ratesByDoctor.byDoctor[id]?.rate;
      const curve = fillCurves.byDoctor[id] ?? fillCurves.practice;
      // Off with something already booked: that is all there will be, no late fill.
      const fill = working
        ? projectPointsWithFillCurve(pts, daysUntil, curve)
        : { projectedPoints: pts, fillFraction: null as number | null };
      const bookedEstimated = rate != null ? rate * pts : 0;
      const treatmentEstimated = rate != null ? rate * fill.projectedPoints : 0;

      return {
        date,
        bookedEstimated,
        treatmentEstimated,
        pharmacyEstimated: 0,
        membershipEstimated: 0,
        estimated: treatmentEstimated,
        points: pts,
        projectedPoints: fill.projectedPoints,
        appointmentCount,
        daysUntil,
        fillFraction: fill.fillFraction,
        isActual: false,
        isDayOff: !working,
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
    ratesByDoctor,
    fillCurves,
    ancillaryRates,
    actualTreatmentByDoctorByDate,
    actualAncillaryByDate,
    doctorSchedules,
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
        appointmentCount: d.appointmentCount,
        isActual: d.isActual,
        actualDayCount: d.isActual ? 1 : 0,
        projectedDayCount: d.isActual ? 0 : 1,
        offDayCount: d.isDayOff ? 1 : 0,
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
          appointmentCount: d.appointmentCount,
          isActual: d.isActual,
          actualDayCount: d.isActual ? 1 : 0,
          projectedDayCount: d.isActual ? 0 : 1,
          offDayCount: d.isDayOff ? 1 : 0,
        });
      } else {
        existing.bookedEstimated += d.bookedEstimated;
        existing.treatmentEstimated += d.treatmentEstimated;
        existing.pharmacyEstimated += d.pharmacyEstimated;
        existing.membershipEstimated += d.membershipEstimated;
        existing.estimated += d.estimated;
        existing.points += d.points;
        existing.projectedPoints += d.projectedPoints;
        existing.appointmentCount += d.appointmentCount;
        existing.actualDayCount += d.isActual ? 1 : 0;
        existing.projectedDayCount += d.isActual ? 0 : 1;
        existing.offDayCount += d.isDayOff ? 1 : 0;
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
        acc.appointmentCount += b.appointmentCount;
        acc.actualDayCount += b.actualDayCount;
        acc.projectedDayCount += b.projectedDayCount;
        acc.offDayCount += b.offDayCount;
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
        appointmentCount: 0,
        actualDayCount: 0,
        projectedDayCount: 0,
        offDayCount: 0,
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
  const fillSampleDays = fillCurves.practice.sampleDays;
  const expectedAdditionalTreatment = useMemo(
    () =>
      dailyEstimates
        .filter((d) => !d.isActual)
        .reduce((s, d) => s + Math.max(0, d.treatmentEstimated - d.bookedEstimated), 0),
    [dailyEstimates]
  );
  const hasMixedActualProjected =
    totals.actualDayCount > 0 && totals.projectedDayCount > 0;
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
    if (b.isActual) return 'Actual';
    if (b.projectedDayCount > 0 && b.offDayCount === b.projectedDayCount) return 'Not scheduled';
    return 'Projected';
  }

  if (loading) {
    return (
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box sx={{ pb: 3, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
          Days through today use actual treatment VSD and (for practice totals) actual pharmacy /
          membership payments. Future days estimate treatment from booked appointments × trailing{' '}
          {VSD_ESTIMATE_LOOKBACK_DAYS}-day VSD per point, with late-booking fill-in from the last{' '}
          {BOOKING_FILL_SERVICE_LOOKBACK_DAYS} days of lead-time history, plus pharmacy and membership
          weekday averages from Payments. Future treatment fill-in respects weekly schedules and OFF
          overrides (no invented volume on days nobody is working).
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

        {hasAnyRate && fillSampleDays === 0 && totals.projectedDayCount > 0 && !error && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No historical booking lead-time data was found, so future projections use currently booked
            appointments only (no late-booking fill-in).
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
            }${fillSampleDays > 0 ? ` · fill curve from ${fillSampleDays} past service days` : ''}`}
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
                  {includeAncillary ? 'Total (actual + projected)' : 'Treatment (actual + projected)'}
                </Typography>
                <Typography variant="h5">{fmtUSD(totals.estimated)}</Typography>
              </Box>
              {hasMixedActualProjected && (
                <>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Actual through today
                    </Typography>
                    <Typography variant="h5">{fmtUSD(actualVsProjectedTotals.actualTotal)}</Typography>
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
                      <Typography variant="caption" color="text.secondary">
                        future ~{fmtUSD(ancillaryRates.pharmacyOverall)}/day
                      </Typography>
                    )}
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      Membership
                    </Typography>
                    <Typography variant="h5">{fmtUSD(totals.membershipEstimated)}</Typography>
                    {totals.projectedDayCount > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        future ~{fmtUSD(ancillaryRates.membershipOverall)}/day
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
                      Expected from late bookings
                    </Typography>
                    <Typography variant="h5">{fmtUSD(expectedAdditionalTreatment)}</Typography>
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
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
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
                Pharmacy and membership are practice-wide — switch to Practice total to include them.
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
                  <TableCell align="right">Appts</TableCell>
                  <TableCell align="right">Booked pts</TableCell>
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
                    <TableCell align="right">{b.appointmentCount}</TableCell>
                    <TableCell align="right">{Math.round(b.points * 10) / 10}</TableCell>
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
                      {Math.round(totals.projectedPoints * 10) / 10}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="subtitle2">{fmtUSD(totals.treatmentEstimated)}</Typography>
                  </TableCell>
                  {includeAncillary && (
                    <>
                      <TableCell align="right">
                        <Typography variant="subtitle2">{fmtUSD(totals.pharmacyEstimated)}</Typography>
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
