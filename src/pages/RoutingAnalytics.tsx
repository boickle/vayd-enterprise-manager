import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { isEmployeeAnalyticsRestricted, normalizeAuthRoles } from '../utils/analyticsAccess';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import dayjs, { Dayjs } from 'dayjs';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { fetchRoutingUsage, type RoutingUsageUser } from '../api/routingUsage';
import { fetchFillDayUsage, type FillDayUsageUser } from '../api/fillDayUsage';
import {
  fetchAppointmentBookingsAnalytics,
  type AppointmentBookingDetail,
  type AppointmentBookingsAnalyticsUser,
} from '../api/appointmentBookingsAnalytics';

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
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

/** Linear regression trend for request count series. */
function addLinearTrend<T extends { requestCount: number }>(data: T[]): (T & { trend: number })[] {
  if (!data.length) return [];
  const n = data.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = Number(data[i]?.requestCount ?? 0);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const slope =
    n * sumXX - sumX * sumX !== 0 ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) : 0;
  const intercept = sumY / n - slope * (sumX / n);
  return data.map((row, i) => ({ ...row, trend: Math.max(0, intercept + slope * i) }));
}

/** Linear regression trend for total appointments booked (overview chart). */
function addTotalBookedTrend<T extends { totalBooked: number }>(
  data: T[]
): (T & { totalBookedTrend: number })[] {
  if (!data.length) return [];
  const n = data.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = Number(data[i]?.totalBooked ?? 0);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const slope =
    n * sumXX - sumX * sumX !== 0 ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) : 0;
  const intercept = sumY / n - slope * (sumX / n);
  return data.map((row, i) => ({
    ...row,
    totalBookedTrend: Math.max(0, intercept + slope * i),
  }));
}

const ALL_USERS = '';

type OverviewLineKey =
  | 'totalBooked'
  | 'existingPatientBooked'
  | 'newPatientBooked'
  | 'routingRequests'
  | 'scheduleLoaderRequests';

const OVERVIEW_LINE_DEFAULTS: Record<OverviewLineKey, boolean> = {
  totalBooked: true,
  existingPatientBooked: true,
  newPatientBooked: true,
  routingRequests: true,
  scheduleLoaderRequests: true,
};

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  '1D': () => {
    const now = dayjs().startOf('day');
    return { from: now, to: now };
  },
  '7D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(6, 'day'), to: now };
  },
  '30D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(29, 'day'), to: now };
  },
  '90D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(89, 'day'), to: now };
  },
  YTD: () => {
    const now = dayjs().startOf('day');
    return { from: now.startOf('year'), to: now };
  },
};

function displayName(u: { employeeName?: string; userEmail: string }): string {
  const name = u.employeeName?.trim();
  return name ? name : u.userEmail;
}

function displayNameFillDay(u: FillDayUsageUser): string {
  const name = u.employeeName?.trim();
  return name ? name : u.userEmail;
}

/** Entire-practice total vs period goal: green when booked ≥ goal, orange when within 10% under goal (≥90%), red otherwise. */
function totalBookedGoalMuiColor(
  booked: number,
  goal: number
): 'success' | 'warning' | 'error' | undefined {
  const b = Number(booked);
  const g = Number(goal);
  if (!(g > 0) || Number.isNaN(b) || Number.isNaN(g)) return undefined;
  if (b >= g) return 'success';
  if (b >= g * 0.9) return 'warning';
  return 'error';
}

function aggregateBookingsByDay(
  users: AppointmentBookingsAnalyticsUser[] | undefined,
  dates: string[],
  selectedUserEmail: string
): Array<{
  date: string;
  totalBooked: number;
  existingPatientBooked: number;
  newPatientBooked: number;
}> {
  const emptyDay = () => ({ totalBooked: 0, existingPatientBooked: 0, newPatientBooked: 0 });
  if (!users?.length) return dates.map((date) => ({ date, ...emptyDay() }));
  if (selectedUserEmail === ALL_USERS) {
    const byDate = new Map<string, ReturnType<typeof emptyDay>>();
    for (const date of dates) byDate.set(date, emptyDay());
    for (const u of users) {
      for (const d of u.bookingsByDay ?? []) {
        const date = d?.date?.slice(0, 10);
        if (!date || !byDate.has(date)) continue;
        const cur = byDate.get(date)!;
        cur.totalBooked += d.totalBooked ?? 0;
        cur.existingPatientBooked += d.existingPatientBooked ?? 0;
        cur.newPatientBooked += d.newPatientBooked ?? 0;
      }
    }
    return dates.map((date) => {
      const v = byDate.get(date) ?? emptyDay();
      return { date, ...v };
    });
  }
  const user = users.find((u) => u.userEmail === selectedUserEmail);
  if (!user) return dates.map((date) => ({ date, ...emptyDay() }));
  const byDate = new Map<string, ReturnType<typeof emptyDay>>();
  for (const date of dates) byDate.set(date, emptyDay());
  for (const d of user.bookingsByDay ?? []) {
    const date = d?.date?.slice(0, 10);
    if (!date || !byDate.has(date)) continue;
    byDate.set(date, {
      totalBooked: d.totalBooked ?? 0,
      existingPatientBooked: d.existingPatientBooked ?? 0,
      newPatientBooked: d.newPatientBooked ?? 0,
    });
  }
  return dates.map((date) => {
    const v = byDate.get(date) ?? emptyDay();
    return { date, ...v };
  });
}

function aggregateRoutingRequestsByDay(
  users: RoutingUsageUser[] | undefined,
  dates: string[],
  selectedUserEmail: string
): { date: string; requestCount: number }[] {
  if (!users?.length) return dates.map((date) => ({ date, requestCount: 0 }));
  if (selectedUserEmail === ALL_USERS) {
    const byDate = new Map<string, number>();
    for (const date of dates) byDate.set(date, 0);
    for (const u of users) {
      for (const d of u.requestsByDay ?? []) {
        const date = d?.date?.slice(0, 10);
        if (date && byDate.has(date)) byDate.set(date, (byDate.get(date) ?? 0) + (d.requestCount ?? 0));
      }
    }
    return dates.map((date) => ({ date, requestCount: byDate.get(date) ?? 0 }));
  }
  const user = users.find((u) => u.userEmail === selectedUserEmail);
  if (!user) return dates.map((date) => ({ date, requestCount: 0 }));
  const byDate = new Map<string, number>();
  for (const date of dates) byDate.set(date, 0);
  for (const d of user.requestsByDay ?? []) {
    const date = d?.date?.slice(0, 10);
    if (date && byDate.has(date)) byDate.set(date, d.requestCount ?? 0);
  }
  return dates.map((date) => ({ date, requestCount: byDate.get(date) ?? 0 }));
}

function aggregateScheduleLoaderRequestsByDay(
  users: FillDayUsageUser[] | undefined,
  dates: string[],
  selectedUserEmail: string
): { date: string; requestCount: number }[] {
  if (!users?.length) return dates.map((date) => ({ date, requestCount: 0 }));
  if (selectedUserEmail === ALL_USERS) {
    const byDate = new Map<string, number>();
    for (const date of dates) byDate.set(date, 0);
    for (const u of users) {
      for (const d of u.requestsByDay ?? []) {
        const date = d?.date?.slice(0, 10);
        if (date && byDate.has(date)) byDate.set(date, (byDate.get(date) ?? 0) + (d.requestCount ?? 0));
      }
    }
    return dates.map((date) => ({ date, requestCount: byDate.get(date) ?? 0 }));
  }
  const user = users.find((u) => u.userEmail === selectedUserEmail);
  if (!user) return dates.map((date) => ({ date, requestCount: 0 }));
  const byDate = new Map<string, number>();
  for (const date of dates) byDate.set(date, 0);
  for (const d of user.requestsByDay ?? []) {
    const date = d?.date?.slice(0, 10);
    if (date && byDate.has(date)) byDate.set(date, d.requestCount ?? 0);
  }
  return dates.map((date) => ({ date, requestCount: byDate.get(date) ?? 0 }));
}

/** Flatten booking rows for the selected employee(s) and dates (calendar days in range). */
function collectBookingDetails(
  users: AppointmentBookingsAnalyticsUser[] | undefined,
  dates: string[],
  selectedUserEmail: string
): AppointmentBookingDetail[] {
  const dateSet = new Set(dates);
  const out: AppointmentBookingDetail[] = [];
  if (!users?.length) return out;
  const userList =
    selectedUserEmail === ALL_USERS
      ? users
      : users.filter((u) => u.userEmail === selectedUserEmail);
  for (const u of userList) {
    for (const day of u.bookingsByDay ?? []) {
      const dayStr = day?.date?.slice(0, 10);
      if (!dayStr || !dateSet.has(dayStr)) continue;
      for (const b of day.bookings ?? []) {
        out.push(b);
      }
    }
  }
  return out;
}

export default function RoutingAnalyticsPage() {
  const { userEmail, role, assignedDoctorIds } = useAuth() as {
    userEmail?: string | null;
    role?: string[];
    assignedDoctorIds?: string[];
  };
  const normalizedRoles = normalizeAuthRoles(role);
  const restrictEmployeeAnalytics = isEmployeeAnalyticsRestricted(normalizedRoles);
  const assignedDoctorIdSet = useMemo(
    () => new Set((assignedDoctorIds ?? []).map((x) => String(x).trim()).filter(Boolean)),
    [assignedDoctorIds]
  );

  const [preset, setPreset] = useState<string>('1D');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['1D']());
  const [selectedOverviewUserEmail, setSelectedOverviewUserEmail] = useState<string>(ALL_USERS);
  const [overviewLinesVisible, setOverviewLinesVisible] =
    useState<Record<OverviewLineKey, boolean>>(OVERVIEW_LINE_DEFAULTS);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>(ALL_USERS);
  const [selectedFillDayUserEmail, setSelectedFillDayUserEmail] = useState<string>(ALL_USERS);
  const [data, setData] = useState<{ users: RoutingUsageUser[] } | null>(null);
  const [bookingsData, setBookingsData] = useState<{
    users: AppointmentBookingsAnalyticsUser[];
    appointmentBookingsGoal?: number;
  } | null>(null);
  const [fillDayData, setFillDayData] = useState<{ users: FillDayUsageUser[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [fillDayError, setFillDayError] = useState<string | null>(null);

  const start = range.from.startOf('day');
  const end = range.to.startOf('day');
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);
  const isSingleDay = start.isSame(end, 'day');
  const dates = useMemo(() => dateRange(start, end), [start, end]);

  const shiftRange = (direction: -1 | 1) => {
    const days = end.diff(start, 'day') + 1;
    const shift = days * direction;
    setRange((r) => ({
      from: r.from.add(shift, 'day'),
      to: r.to.add(shift, 'day'),
    }));
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    setBookingsError(null);
    setFillDayError(null);
    let alive = true;
    let done = 0;
    const checkDone = () => {
      done += 1;
      if (done === 3 && alive) setLoading(false);
    };

    fetchRoutingUsage({ startDate: startStr, endDate: endStr })
      .then((res) => {
        if (!alive) return;
        setData({ users: res?.users ?? [] });
      })
      .catch((e) => {
        if (!alive) return;
        console.error('Routing usage fetch failed:', e);
        setError('Failed to load routing usage');
        setData(null);
      })
      .finally(checkDone);

    fetchAppointmentBookingsAnalytics({ startDate: startStr, endDate: endStr })
      .then((res) => {
        if (!alive) return;
        setBookingsData({
          users: res?.users ?? [],
          appointmentBookingsGoal: res?.appointmentBookingsGoal,
        });
      })
      .catch((e) => {
        if (!alive) return;
        console.error('Appointment bookings analytics fetch failed:', e);
        setBookingsError('Failed to load appointment booking counts');
        setBookingsData(null);
      })
      .finally(checkDone);

    fetchFillDayUsage({ startDate: startStr, endDate: endStr })
      .then((res) => {
        if (!alive) return;
        setFillDayData({ users: res?.users ?? [] });
      })
      .catch((e) => {
        if (!alive) return;
        console.error('Schedule loader usage fetch failed:', e);
        setFillDayError('Failed to load schedule loader usage');
        setFillDayData(null);
      })
      .finally(checkDone);

    return () => {
      alive = false;
    };
  }, [startStr, endStr]);

  const overviewChartData = useMemo(() => {
    const bookingRows = aggregateBookingsByDay(bookingsData?.users, dates, selectedOverviewUserEmail);
    const routingRows = aggregateRoutingRequestsByDay(data?.users, dates, selectedOverviewUserEmail);
    const scheduleLoaderRows = aggregateScheduleLoaderRequestsByDay(
      fillDayData?.users,
      dates,
      selectedOverviewUserEmail
    );
    return dates.map((date, i) => ({
      date,
      totalBooked: bookingRows[i]?.totalBooked ?? 0,
      existingPatientBooked: bookingRows[i]?.existingPatientBooked ?? 0,
      newPatientBooked: bookingRows[i]?.newPatientBooked ?? 0,
      routingRequests: routingRows[i]?.requestCount ?? 0,
      scheduleLoaderRequests: scheduleLoaderRows[i]?.requestCount ?? 0,
    }));
  }, [bookingsData, data, fillDayData, dates, selectedOverviewUserEmail]);

  const overviewChartDataWithTrend = useMemo(
    () => addTotalBookedTrend(overviewChartData),
    [overviewChartData]
  );

  const overviewUserOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const u of bookingsData?.users ?? []) {
      if (u.userEmail) labels.set(u.userEmail, displayName(u));
    }
    for (const u of data?.users ?? []) {
      if (u.userEmail && !labels.has(u.userEmail)) labels.set(u.userEmail, displayName(u));
    }
    for (const u of fillDayData?.users ?? []) {
      if (u.userEmail && !labels.has(u.userEmail)) labels.set(u.userEmail, displayNameFillDay(u));
    }
    const sorted = [...labels.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const full = [{ value: ALL_USERS, label: 'Entire practice' }, ...sorted.map(([value, label]) => ({ value, label }))];
    if (!restrictEmployeeAnalytics) return full;
    const selfEmail = userEmail ? String(userEmail).trim().toLowerCase() : '';
    const selfEntry = selfEmail
      ? sorted.find(([email]) => String(email).trim().toLowerCase() === selfEmail)
      : undefined;
    return [
      { value: ALL_USERS, label: 'Entire practice' },
      ...(selfEntry ? [{ value: selfEntry[0], label: selfEntry[1] }] : []),
    ];
  }, [bookingsData, data, fillDayData, restrictEmployeeAnalytics, userEmail]);

  useEffect(() => {
    if (!restrictEmployeeAnalytics) return;
    const allowed = new Set(overviewUserOptions.map((o) => o.value));
    if (!allowed.has(selectedOverviewUserEmail)) setSelectedOverviewUserEmail(ALL_USERS);
  }, [restrictEmployeeAnalytics, overviewUserOptions, selectedOverviewUserEmail]);

  /** Per-employee routing, schedule loader, and booking counts summed over the selected date range. */
  const employeeBookingTableRows = useMemo(() => {
    const datesSet = new Set(dates);
    const bookingUsers = bookingsData?.users ?? [];
    const routingUsers = data?.users ?? [];
    const fillUsers = fillDayData?.users ?? [];

    const collectMetrics = (email: string) => {
      const bu = bookingUsers.find((x) => x.userEmail === email);
      const ru = routingUsers.find((x) => x.userEmail === email);
      const fu = fillUsers.find((x) => x.userEmail === email);
      let totalBooked = 0;
      let existingPatientBooked = 0;
      let newPatientBooked = 0;
      let routingRequests = 0;
      let scheduleLoaderRequests = 0;
      for (const d of bu?.bookingsByDay ?? []) {
        const date = d?.date?.slice(0, 10);
        if (!date || !datesSet.has(date)) continue;
        totalBooked += d.totalBooked ?? 0;
        existingPatientBooked += d.existingPatientBooked ?? 0;
        newPatientBooked += d.newPatientBooked ?? 0;
      }
      for (const d of ru?.requestsByDay ?? []) {
        const date = d?.date?.slice(0, 10);
        if (!date || !datesSet.has(date)) continue;
        routingRequests += d.requestCount ?? 0;
      }
      for (const d of fu?.requestsByDay ?? []) {
        const date = d?.date?.slice(0, 10);
        if (!date || !datesSet.has(date)) continue;
        scheduleLoaderRequests += d.requestCount ?? 0;
      }
      const name = bu
        ? displayName(bu)
        : ru
          ? displayName(ru)
          : fu
            ? displayNameFillDay(fu)
            : (overviewUserOptions.find((o) => o.value === email)?.label ?? email);
      return {
        key: email,
        name,
        totalBooked,
        existingPatientBooked,
        newPatientBooked,
        routingRequests,
        scheduleLoaderRequests,
      };
    };

    if (selectedOverviewUserEmail === ALL_USERS) {
      const emails = new Set<string>();
      for (const u of bookingUsers) {
        if (u.userEmail) emails.add(u.userEmail);
      }
      for (const u of routingUsers) {
        if (u.userEmail) emails.add(u.userEmail);
      }
      for (const u of fillUsers) {
        if (u.userEmail) emails.add(u.userEmail);
      }
      return [...emails]
        .map((email) => collectMetrics(email))
        .filter(
          (r) =>
            r.totalBooked > 0 || r.routingRequests > 0 || r.scheduleLoaderRequests > 0
        )
        .sort((a, b) => {
          if (b.totalBooked !== a.totalBooked) return b.totalBooked - a.totalBooked;
          const bTools = b.routingRequests + b.scheduleLoaderRequests;
          const aTools = a.routingRequests + a.scheduleLoaderRequests;
          return bTools - aTools;
        });
    }

    const email = selectedOverviewUserEmail;
    return [collectMetrics(email)];
  }, [dates, bookingsData, data, fillDayData, selectedOverviewUserEmail, overviewUserOptions]);

  const employeeBookingTableColumnTotals = useMemo(
    () =>
      employeeBookingTableRows.reduce(
        (acc, r) => ({
          routingRequests: acc.routingRequests + r.routingRequests,
          scheduleLoaderRequests: acc.scheduleLoaderRequests + r.scheduleLoaderRequests,
          newPatientBooked: acc.newPatientBooked + r.newPatientBooked,
          existingPatientBooked: acc.existingPatientBooked + r.existingPatientBooked,
          totalBooked: acc.totalBooked + r.totalBooked,
        }),
        {
          routingRequests: 0,
          scheduleLoaderRequests: 0,
          newPatientBooked: 0,
          existingPatientBooked: 0,
          totalBooked: 0,
        }
      ),
    [employeeBookingTableRows]
  );

  /** Goal vs booked (colored) is shown only for a single selected day; multi-day ranges show a plain total. */
  const practiceBookingGoalDisplay = useMemo(() => {
    if (!isSingleDay) return null;
    const rawGoal = bookingsData?.appointmentBookingsGoal;
    const goal =
      typeof rawGoal === 'number' && Number.isFinite(rawGoal) && rawGoal > 0 ? rawGoal : undefined;
    if (goal === undefined) return null;
    const booked = employeeBookingTableColumnTotals.totalBooked;
    const color = totalBookedGoalMuiColor(booked, goal);
    return { booked, goal, color };
  }, [
    isSingleDay,
    bookingsData?.appointmentBookingsGoal,
    employeeBookingTableColumnTotals.totalBooked,
  ]);

  const overviewBookingDetails = useMemo(
    () => collectBookingDetails(bookingsData?.users, dates, selectedOverviewUserEmail),
    [bookingsData, dates, selectedOverviewUserEmail]
  );

  const providerBreakdownRows = useMemo(() => {
    const map = new Map<string, { label: string; count: number; providerKey: string }>();
    for (const b of overviewBookingDetails) {
      const id = b.primaryProviderId;
      const key =
        id != null && id !== undefined && !Number.isNaN(Number(id))
          ? `id:${Number(id)}`
          : `name:${(b.primaryProviderName ?? '').trim() || '_'}`;
      const label = (b.primaryProviderName ?? '').trim() || 'Unknown provider';
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else map.set(key, { label, count: 1, providerKey: key });
    }
    let rows = [...map.values()].sort((a, b) => b.count - a.count);
    if (restrictEmployeeAnalytics && assignedDoctorIdSet.size > 0) {
      rows = rows.filter((row) => {
        if (!row.providerKey.startsWith('id:')) return false;
        const id = row.providerKey.slice(3);
        return assignedDoctorIdSet.has(id);
      });
    }
    return rows;
  }, [overviewBookingDetails, restrictEmployeeAnalytics, assignedDoctorIdSet]);

  const appointmentTypeBreakdownRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of overviewBookingDetails) {
      const pretty = (b.appointmentTypePrettyName ?? '').trim();
      const raw = (b.appointmentTypeName ?? '').trim();
      const label = pretty || raw || 'Unknown type';
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [overviewBookingDetails]);

  const overviewScopeDescription = useMemo(() => {
    if (selectedOverviewUserEmail === ALL_USERS) {
      return 'Counts include appointments booked by any employee in the practice.';
    }
    const u = bookingsData?.users?.find((x) => x.userEmail === selectedOverviewUserEmail);
    return u
      ? `Counts include only appointments booked by ${displayName(u)}.`
      : 'Counts for the selected employee.';
  }, [selectedOverviewUserEmail, bookingsData]);

  const chartData = useMemo(() => {
    if (!data?.users?.length) return [];
    if (selectedUserEmail === ALL_USERS) {
      const byDate = new Map<string, number>();
      for (const date of dates) byDate.set(date, 0);
      for (const u of data.users) {
        for (const d of u.requestsByDay ?? []) {
          const date = d?.date?.slice(0, 10);
          if (date && byDate.has(date)) byDate.set(date, (byDate.get(date) ?? 0) + (d.requestCount ?? 0));
        }
      }
      return dates.map((date) => ({ date, requestCount: byDate.get(date) ?? 0 }));
    }
    const user = data.users.find((u) => u.userEmail === selectedUserEmail);
    if (!user) return [];
    const byDate = new Map<string, number>();
    for (const date of dates) byDate.set(date, 0);
    for (const d of user.requestsByDay ?? []) {
      const date = d?.date?.slice(0, 10);
      if (date && byDate.has(date)) byDate.set(date, d.requestCount ?? 0);
    }
    return dates.map((date) => ({ date, requestCount: byDate.get(date) ?? 0 }));
  }, [data, selectedUserEmail, dates]);

  const fillDayChartData = useMemo(() => {
    if (!fillDayData?.users?.length) return [];
    if (selectedFillDayUserEmail === ALL_USERS) {
      const byDate = new Map<string, number>();
      for (const date of dates) byDate.set(date, 0);
      for (const u of fillDayData.users) {
        for (const d of u.requestsByDay ?? []) {
          const date = d?.date?.slice(0, 10);
          if (date && byDate.has(date)) byDate.set(date, (byDate.get(date) ?? 0) + (d.requestCount ?? 0));
        }
      }
      return dates.map((date) => ({ date, requestCount: byDate.get(date) ?? 0 }));
    }
    const user = fillDayData.users.find((u) => u.userEmail === selectedFillDayUserEmail);
    if (!user) return [];
    const byDate = new Map<string, number>();
    for (const date of dates) byDate.set(date, 0);
    for (const d of user.requestsByDay ?? []) {
      const date = d?.date?.slice(0, 10);
      if (date && byDate.has(date)) byDate.set(date, d.requestCount ?? 0);
    }
    return dates.map((date) => ({ date, requestCount: byDate.get(date) ?? 0 }));
  }, [fillDayData, selectedFillDayUserEmail, dates]);

  const userOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [{ value: ALL_USERS, label: 'All users' }];
    for (const u of data?.users ?? []) {
      if (u.userEmail) list.push({ value: u.userEmail, label: displayName(u) });
    }
    if (!restrictEmployeeAnalytics) return list;
    const selfEmail = userEmail ? String(userEmail).trim().toLowerCase() : '';
    if (!selfEmail) return [list[0]];
    const self = list.find((o) => String(o.value).trim().toLowerCase() === selfEmail);
    return [list[0], ...(self ? [self] : [])];
  }, [data, restrictEmployeeAnalytics, userEmail]);

  const fillDayUserOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [{ value: ALL_USERS, label: 'All users' }];
    for (const u of fillDayData?.users ?? []) {
      if (u.userEmail) list.push({ value: u.userEmail, label: displayNameFillDay(u) });
    }
    if (!restrictEmployeeAnalytics) return list;
    const selfEmail = userEmail ? String(userEmail).trim().toLowerCase() : '';
    if (!selfEmail) return [list[0]];
    const self = list.find((o) => String(o.value).trim().toLowerCase() === selfEmail);
    return [list[0], ...(self ? [self] : [])];
  }, [fillDayData, restrictEmployeeAnalytics, userEmail]);

  useEffect(() => {
    if (!restrictEmployeeAnalytics) return;
    const allowed = new Set(userOptions.map((o) => o.value));
    if (!allowed.has(selectedUserEmail)) setSelectedUserEmail(ALL_USERS);
  }, [restrictEmployeeAnalytics, userOptions, selectedUserEmail]);

  useEffect(() => {
    if (!restrictEmployeeAnalytics) return;
    const allowed = new Set(fillDayUserOptions.map((o) => o.value));
    if (!allowed.has(selectedFillDayUserEmail)) setSelectedFillDayUserEmail(ALL_USERS);
  }, [restrictEmployeeAnalytics, fillDayUserOptions, selectedFillDayUserEmail]);

  const chartDataWithTrend = useMemo(() => addLinearTrend(chartData), [chartData]);
  const fillDayChartDataWithTrend = useMemo(() => addLinearTrend(fillDayChartData), [fillDayChartData]);

  const usersSorted = useMemo(() => {
    const users = data?.users ?? [];
    return [...users].sort((a, b) => (b.totalRequests ?? 0) - (a.totalRequests ?? 0));
  }, [data]);

  const fillDayUsersSorted = useMemo(() => {
    const users = fillDayData?.users ?? [];
    return [...users].sort((a, b) => (b.totalRequests ?? 0) - (a.totalRequests ?? 0));
  }, [fillDayData]);

  return (
    <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Appointments & routing usage
        </Typography>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Date range"
            action={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(['1D', '7D', '30D', '90D', 'YTD'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setPreset(key);
                      setRange(PRESETS[key]());
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
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              Use Start date / End date for a specific range (browser date picker); presets and arrows still work.
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
                rowGap: 1.5,
              }}
            >
              <IconButton
                aria-label={isSingleDay ? 'Previous day' : 'Previous period'}
                onClick={() =>
                  isSingleDay
                    ? setRange((r) => ({ from: r.from.subtract(1, 'day'), to: r.from.subtract(1, 'day') }))
                    : shiftRange(-1)
                }
                size="small"
              >
                <ChevronLeft />
              </IconButton>
              <Typography variant="body1" component="span" sx={{ minWidth: 200, textAlign: 'center' }}>
                {isSingleDay
                  ? range.from.format('ddd, MMM D, YYYY')
                  : `${range.from.format('MMM D')} – ${range.to.format('MMM D, YYYY')}`}
              </Typography>
              <IconButton
                aria-label={isSingleDay ? 'Next day' : 'Next period'}
                onClick={() =>
                  isSingleDay
                    ? setRange((r) => ({ from: r.from.add(1, 'day'), to: r.from.add(1, 'day') }))
                    : shiftRange(1)
                }
                size="small"
              >
                <ChevronRight />
              </IconButton>
              <TextField
                label="Start date"
                type="date"
                size="small"
                value={startStr}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const next = dayjs(v, 'YYYY-MM-DD', true);
                  if (!next.isValid()) return;
                  setPreset('');
                  setRange((r) => {
                    const to = r.to.startOf('day');
                    const from = next.startOf('day');
                    return { from, to: from.isAfter(to) ? from : to };
                  });
                }}
                InputLabelProps={{ shrink: true }}
                inputProps={{ 'aria-label': 'Custom range start date' }}
                sx={{ minWidth: 168 }}
              />
              <TextField
                label="End date"
                type="date"
                size="small"
                value={endStr}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const next = dayjs(v, 'YYYY-MM-DD', true);
                  if (!next.isValid()) return;
                  setPreset('');
                  setRange((r) => {
                    const from = r.from.startOf('day');
                    const to = next.startOf('day');
                    return { from: to.isBefore(from) ? to : from, to };
                  });
                }}
                InputLabelProps={{ shrink: true }}
                inputProps={{ 'aria-label': 'Custom range end date' }}
                sx={{ minWidth: 168 }}
              />
            </Box>
          </CardContent>
        </Card>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Bookings & tool usage by employee"
            subheader={
              isSingleDay
                ? 'Per employee: routing requests, schedule loader (fill-day) requests, and appointments booked (new patient, existing patient, total) for the selected day. Entire practice lists anyone with activity that day; one employee shows that row even if all counts are zero. Totals at the bottom sum the visible rows.'
                : 'Per employee: totals over the selected date range (same columns as single-day). Entire practice lists anyone with activity in the range. The chart below shows daily trends for the employee filter; dashed blue line is a linear trend of total appointments. Click a legend label to show or hide a series. Totals at the bottom sum the visible rows.'
            }
          />
          <CardContent>
            {bookingsError && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {bookingsError} — appointment lines show as zero until the API is available.
              </Alert>
            )}
            {fillDayError && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {fillDayError} — schedule loader line and counts show as zero until the API is available.
              </Alert>
            )}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
              <FormControl size="small" sx={{ minWidth: 280 }}>
                <InputLabel id="overview-employee-label">Employee</InputLabel>
                <Select
                  labelId="overview-employee-label"
                  value={selectedOverviewUserEmail}
                  label="Employee"
                  onChange={(e) => setSelectedOverviewUserEmail(e.target.value)}
                >
                  {overviewUserOptions.map((opt) => (
                    <MenuItem key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Employee</TableCell>
                        <TableCell align="right">Routing requests</TableCell>
                        <TableCell align="right">Schedule loader requests</TableCell>
                        <TableCell align="right">New patient</TableCell>
                        <TableCell align="right">Existing patient</TableCell>
                        <TableCell align="right">Total appointments</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {employeeBookingTableRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} align="center">
                            <Typography variant="body2" color="text.secondary">
                              {selectedOverviewUserEmail !== ALL_USERS
                                ? 'No data for this employee in this date range.'
                                : 'No routing, schedule loader, or booking activity in this date range.'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        employeeBookingTableRows.map((row) => (
                          <TableRow key={row.key}>
                            <TableCell>{row.name}</TableCell>
                            <TableCell align="right">{row.routingRequests}</TableCell>
                            <TableCell align="right">{row.scheduleLoaderRequests}</TableCell>
                            <TableCell align="right">{row.newPatientBooked}</TableCell>
                            <TableCell align="right">{row.existingPatientBooked}</TableCell>
                            <TableCell align="right">{row.totalBooked}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    {employeeBookingTableRows.length > 0 ? (
                      <TableFooter>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {employeeBookingTableColumnTotals.routingRequests}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {employeeBookingTableColumnTotals.scheduleLoaderRequests}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {employeeBookingTableColumnTotals.newPatientBooked}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {employeeBookingTableColumnTotals.existingPatientBooked}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {selectedOverviewUserEmail === ALL_USERS && practiceBookingGoalDisplay ? (
                              <Typography
                                component="span"
                                variant="body2"
                                sx={{
                                  fontWeight: 600,
                                  color:
                                    practiceBookingGoalDisplay.color === 'success'
                                      ? 'success.main'
                                      : practiceBookingGoalDisplay.color === 'warning'
                                        ? 'warning.main'
                                        : 'error.main',
                                }}
                              >
                                {practiceBookingGoalDisplay.booked}/{practiceBookingGoalDisplay.goal} booked
                              </Typography>
                            ) : (
                              employeeBookingTableColumnTotals.totalBooked
                            )}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    ) : null}
                  </Table>
                </TableContainer>
                {!isSingleDay ? (
                  <Box sx={{ width: '100%', height: 400, mt: 3 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={overviewChartDataWithTrend}
                        margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis
                          yAxisId="left"
                          label={{ value: 'Appointments booked', angle: -90, position: 'insideLeft' }}
                          tick={{ fontSize: 11 }}
                          allowDecimals={false}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          label={{
                            value: 'Routing & schedule loader requests',
                            angle: 90,
                            position: 'insideRight',
                          }}
                          tick={{ fontSize: 11 }}
                          allowDecimals={false}
                        />
                        <Tooltip
                          formatter={(value: unknown, name: unknown) => {
                            const n = name != null ? String(name) : '';
                            const isTrend = n.includes('trend');
                            const v =
                              value != null
                                ? isTrend
                                  ? Number(value).toFixed(1)
                                  : String(Math.round(Number(value)))
                                : '0';
                            return [v, n];
                          }}
                          labelFormatter={(label) => String(label)}
                        />
                        <Legend
                          wrapperStyle={{ paddingTop: 8 }}
                          content={({ payload }) => (
                            <Box
                              component="ul"
                              sx={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                justifyContent: 'center',
                                gap: 1,
                                listStyle: 'none',
                                m: 0,
                                p: 0,
                              }}
                            >
                              {(payload ?? []).map((entry) => {
                                const raw = String(entry.dataKey ?? '');
                                if (!(raw in OVERVIEW_LINE_DEFAULTS)) return null;
                                const key = raw as OverviewLineKey;
                                const visible = overviewLinesVisible[key];
                                return (
                                  <Box
                                    component="li"
                                    key={String(entry.dataKey)}
                                  >
                                    <button
                                      type="button"
                                      aria-pressed={visible}
                                      title={visible ? 'Hide series' : 'Show series'}
                                      onClick={() =>
                                        setOverviewLinesVisible((v) => ({
                                          ...v,
                                          [key]: !v[key],
                                        }))
                                      }
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '4px 10px',
                                        border: `1px solid ${visible ? (entry.color ?? '#ccc') : '#e0e0e0'}`,
                                        borderRadius: 6,
                                        background: visible ? 'rgba(0,0,0,0.02)' : '#f5f5f5',
                                        cursor: 'pointer',
                                        fontSize: 13,
                                        color: visible ? 'inherit' : '#9e9e9e',
                                        textDecoration: visible ? 'none' : 'line-through',
                                      }}
                                    >
                                      <span
                                        style={{
                                          width: 10,
                                          height: 10,
                                          borderRadius: 2,
                                          background: entry.color,
                                          opacity: visible ? 1 : 0.35,
                                          flexShrink: 0,
                                        }}
                                        aria-hidden
                                      />
                                      {entry.value}
                                    </button>
                                  </Box>
                                );
                              })}
                            </Box>
                          )}
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="totalBooked"
                          name="Total appointments booked"
                          stroke="#1565c0"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          hide={!overviewLinesVisible.totalBooked}
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="totalBookedTrend"
                          name="Total appointments (trend)"
                          stroke="#1565c0"
                          strokeWidth={1.5}
                          strokeDasharray="6 4"
                          dot={false}
                          legendType="none"
                          hide={!overviewLinesVisible.totalBooked}
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="existingPatientBooked"
                          name="Existing patient bookings"
                          stroke="#2e7d32"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          hide={!overviewLinesVisible.existingPatientBooked}
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="newPatientBooked"
                          name="New patient bookings"
                          stroke="#ed6c02"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          hide={!overviewLinesVisible.newPatientBooked}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="routingRequests"
                          name="Routing requests"
                          stroke="#7b1fa2"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          hide={!overviewLinesVisible.routingRequests}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="scheduleLoaderRequests"
                          name="Schedule loader requests"
                          stroke="#00838f"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          hide={!overviewLinesVisible.scheduleLoaderRequests}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </Box>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        {!bookingsError && !loading && (
          <>
            <Card sx={{ mb: 3 }}>
              <CardHeader
                title="By primary provider"
                subheader={`Appointments in the selected date range, grouped by the appointment's primary provider. ${overviewScopeDescription}`}
              />
              <CardContent>
                {providerBreakdownRows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No appointment detail in this range. Detail rows appear when the API includes a{' '}
                    <code>bookings</code> array on each day.
                  </Typography>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Primary provider</TableCell>
                          <TableCell align="right">Appointments booked</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {providerBreakdownRows.map((row, idx) => (
                          <TableRow key={`provider-${idx}-${row.label}`}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell align="right">{row.count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardHeader
                title="By appointment type"
                subheader={`Uses the pretty name when present, otherwise the internal type name. ${overviewScopeDescription}`}
              />
              <CardContent>
                {appointmentTypeBreakdownRows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No appointment detail in this range.
                  </Typography>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Appointment type</TableCell>
                          <TableCell align="right">Appointments booked</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {appointmentTypeBreakdownRows.map((row, idx) => (
                          <TableRow key={`type-${idx}-${row.label}`}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell align="right">{row.count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!isSingleDay && (
          <Card sx={{ mb: 3 }}>
            <CardHeader
              title="Routing requests by day"
              subheader="Overall or filter by user to see one user."
            />
            <CardContent>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 280 }}>
                  <InputLabel id="routing-user-label">User</InputLabel>
                  <Select
                    labelId="routing-user-label"
                    value={selectedUserEmail}
                    label="User"
                    onChange={(e) => setSelectedUserEmail(e.target.value)}
                  >
                    {userOptions.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <Box sx={{ width: '100%', height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartDataWithTrend}
                      margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis
                        label={{ value: 'Requests', angle: -90, position: 'insideLeft' }}
                        tick={{ fontSize: 11 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        formatter={(value: unknown, name: unknown) => [
                          value != null ? `${Number(value).toFixed(1)} requests` : '0',
                          (name ?? '') === 'trend' ? 'Trend' : 'Requests',
                        ]}
                        labelFormatter={(label) => String(label)}
                      />
                      <Line
                        type="monotone"
                        dataKey="requestCount"
                        stroke="#1976d2"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name="Requests"
                      />
                      <Line
                        type="monotone"
                        dataKey="trend"
                        stroke="#1976d2"
                        strokeWidth={1.5}
                        strokeDasharray="5 5"
                        dot={false}
                        name="Trend"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        )}

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Usage by user"
            subheader={isSingleDay ? 'Routing requests per user for the selected day.' : 'Total routing requests per user in the selected date range.'}
          />
          <CardContent>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress />
              </Box>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell align="right">Total requests</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {usersSorted.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} align="center">
                          No usage data in this range.
                        </TableCell>
                      </TableRow>
                    ) : (
                      usersSorted.map((u) => (
                        <TableRow
                          key={u.userEmail}
                          onClick={() => !isSingleDay && setSelectedUserEmail(u.userEmail)}
                          sx={!isSingleDay ? { cursor: 'pointer' } : undefined}
                        >
                          <TableCell>{displayName(u)}</TableCell>
                          <TableCell align="right">{u.totalRequests ?? 0}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        <Typography variant="h6" sx={{ mt: 4, mb: 2 }}>
          Schedule Loader Usage
        </Typography>

        {fillDayError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {fillDayError}
          </Alert>
        )}

        {!isSingleDay && (
          <Card sx={{ mb: 3 }}>
            <CardHeader
              title="Schedule Loader requests by day"
              subheader="Overall or filter by user to see one user."
            />
            <CardContent>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 280 }}>
                  <InputLabel id="fill-day-user-label">User</InputLabel>
                  <Select
                    labelId="fill-day-user-label"
                    value={selectedFillDayUserEmail}
                    label="User"
                    onChange={(e) => setSelectedFillDayUserEmail(e.target.value)}
                  >
                    {fillDayUserOptions.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <Box sx={{ width: '100%', height: 360 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={fillDayChartDataWithTrend}
                      margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis
                        label={{ value: 'Requests', angle: -90, position: 'insideLeft' }}
                        tick={{ fontSize: 11 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        formatter={(value: unknown, name: unknown) => [
                          value != null ? `${Number(value).toFixed(1)} requests` : '0',
                          (name ?? '') === 'trend' ? 'Trend' : 'Requests',
                        ]}
                        labelFormatter={(label) => String(label)}
                      />
                      <Line
                        type="monotone"
                        dataKey="requestCount"
                        stroke="#2e7d32"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name="Requests"
                      />
                      <Line
                        type="monotone"
                        dataKey="trend"
                        stroke="#2e7d32"
                        strokeWidth={1.5}
                        strokeDasharray="5 5"
                        dot={false}
                        name="Trend"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Usage by user"
            subheader={isSingleDay ? 'Schedule loader (fill-day) requests per user for the selected day.' : 'Total schedule loader (fill-day) requests per user in the selected date range.'}
          />
          <CardContent>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress />
              </Box>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell align="right">Total requests</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {fillDayUsersSorted.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} align="center">
                          No usage data in this range.
                        </TableCell>
                      </TableRow>
                    ) : (
                      fillDayUsersSorted.map((u) => (
                        <TableRow
                          key={u.userEmail}
                          onClick={() => !isSingleDay && setSelectedFillDayUserEmail(u.userEmail)}
                          sx={!isSingleDay ? { cursor: 'pointer' } : undefined}
                        >
                          <TableCell>{displayNameFillDay(u)}</TableCell>
                          <TableCell align="right">{u.totalRequests ?? 0}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
    </Box>
  );
}
