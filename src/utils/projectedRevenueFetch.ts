import { fetchDoctorMonth, type DoctorMonthDay } from '../api/appointments';
import {
  fetchAppointmentBookingsAnalytics,
  type AppointmentBookingsAnalyticsResponse,
} from '../api/appointmentBookingsAnalytics';
import {
  fetchEmployee,
  type EmployeeWeeklySchedule,
  type ScheduleOverride,
} from '../api/appointmentSettings';
import { fetchEmployeeGoals, type EmployeeGoalsResponseDto } from '../api/employeeGoals';
import {
  fetchDoctorRevenueSeries,
  type DoctorRevenueSeriesResponse,
} from '../api/opsStats';
import { fetchPaymentsAnalytics, type PaymentPoint } from '../api/payments';
import { fetchScheduleOverridesByDate } from './scheduleOverrideMerge';
import { createAsyncTtlCache, mapPool } from './asyncTtlCache';

/** Shared cache for Projected Revenue — survives date-range switches within a session. */
const cache = createAsyncTtlCache(3 * 60_000);

/** Lookback / fill-curve history changes slowly; keep longer. */
const LOOKBACK_TTL_MS = 5 * 60_000;
/** Employee weekly schedules rarely change mid-session. */
const EMPLOYEE_TTL_MS = 10 * 60_000;
/** Cap parallel doctor/month fan-out so the browser isn't flooded. */
export const PROJECTED_REVENUE_FETCH_CONCURRENCY = 8;

export type CachedDoctorMonth = {
  doctorId: string;
  year: number;
  month: number;
  days: DoctorMonthDay[];
};

export async function fetchDoctorMonthCached(
  year: number,
  month: number,
  doctorId: string
): Promise<CachedDoctorMonth> {
  return cache.getOrFetch(
    `month:${doctorId}:${year}-${month}`,
    async () => {
      const resp = await fetchDoctorMonth(year, month, doctorId);
      return { doctorId, year, month, days: resp?.days ?? [] };
    },
    LOOKBACK_TTL_MS
  );
}

export async function fetchDoctorRevenueSeriesCached(params: {
  start: string;
  end: string;
  doctorId: string;
}): Promise<DoctorRevenueSeriesResponse> {
  return cache.getOrFetch(
    `rev:${params.doctorId}:${params.start}:${params.end}`,
    () => fetchDoctorRevenueSeries(params),
    LOOKBACK_TTL_MS
  );
}

export async function fetchBookingsAnalyticsCached(params: {
  startDate: string;
  endDate: string;
}): Promise<AppointmentBookingsAnalyticsResponse | null> {
  return cache.getOrFetch(
    `bookings:${params.startDate}:${params.endDate}`,
    async () => {
      try {
        return await fetchAppointmentBookingsAnalytics(params);
      } catch (e) {
        console.error('Booking history for fill curve failed:', e);
        return null;
      }
    },
    LOOKBACK_TTL_MS
  );
}

export async function fetchPaymentsAnalyticsCached(params: {
  start: string;
  end: string;
  practiceId: number;
}): Promise<PaymentPoint[]> {
  return cache.getOrFetch(
    `payments:${params.practiceId}:${params.start}:${params.end}`,
    async () => {
      try {
        return await fetchPaymentsAnalytics(params);
      } catch (e) {
        console.error('Payments history for pharmacy/membership failed:', e);
        return [] as PaymentPoint[];
      }
    },
    LOOKBACK_TTL_MS
  );
}

export async function fetchEmployeeWeeklySchedulesCached(
  empId: number
): Promise<EmployeeWeeklySchedule[]> {
  return cache.getOrFetch(
    `employee:${empId}:weekly`,
    async () => {
      const employee = await fetchEmployee(empId).catch(() => null);
      return employee?.weeklySchedules ?? [];
    },
    EMPLOYEE_TTL_MS
  );
}

export async function fetchScheduleOverridesCached(
  empId: number,
  dates: string[]
): Promise<Map<string, ScheduleOverride>> {
  if (!dates.length) return new Map();
  const sorted = [...dates].sort();
  const startDate = sorted[0]!;
  const endDate = sorted[sorted.length - 1]!;
  return cache.getOrFetch(
    `overrides:${empId}:${startDate}:${endDate}`,
    () =>
      fetchScheduleOverridesByDate(empId, dates).catch(
        () => new Map<string, ScheduleOverride>()
      ),
    2 * 60_000
  );
}

export async function fetchEmployeeGoalsCached(
  empId: number,
  startDate: string,
  endDate: string
): Promise<EmployeeGoalsResponseDto | null> {
  return cache.getOrFetch(
    `goals:${empId}:${startDate}:${endDate}`,
    () => fetchEmployeeGoals(empId, { startDate, endDate }).catch(() => null),
    2 * 60_000
  );
}

/** Fan-out doctor×month fetches with concurrency + cache. */
export async function fetchDoctorMonthsCached(
  doctorIds: string[],
  monthPairs: { year: number; month: number }[]
): Promise<CachedDoctorMonth[]> {
  const jobs = doctorIds.flatMap((doctorId) =>
    monthPairs.map((pair) => ({ doctorId, ...pair }))
  );
  return mapPool(jobs, PROJECTED_REVENUE_FETCH_CONCURRENCY, ({ doctorId, year, month }) =>
    fetchDoctorMonthCached(year, month, doctorId)
  );
}

/** Fan-out doctor revenue series with concurrency + cache. */
export async function fetchDoctorRevenueSeriesCachedMany(
  doctors: { id: string; name: string }[],
  start: string,
  end: string
): Promise<{ doctorId: string; name: string; response: DoctorRevenueSeriesResponse }[]> {
  return mapPool(doctors, PROJECTED_REVENUE_FETCH_CONCURRENCY, async (p) => {
    const doctorId = String(p.id);
    const response = await fetchDoctorRevenueSeriesCached({ start, end, doctorId });
    return { doctorId, name: p.name, response };
  });
}
