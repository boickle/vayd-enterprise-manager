import React, { useEffect, useMemo, useState } from 'react';
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
  TableHead,
  TableRow,
  Paper,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { fetchRoutingUsage, type RoutingUsageUser } from '../api/routingUsage';
import { fetchFillDayUsage, type FillDayUsageUser } from '../api/fillDayUsage';

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

const ALL_USERS = '';

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

function displayName(u: RoutingUsageUser): string {
  const name = u.employeeName?.trim();
  return name ? name : u.userEmail;
}

function displayNameFillDay(u: FillDayUsageUser): string {
  const name = u.employeeName?.trim();
  return name ? name : u.userEmail;
}

export default function RoutingAnalyticsPage() {
  const [preset, setPreset] = useState<string>('1D');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['1D']());
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>(ALL_USERS);
  const [selectedFillDayUserEmail, setSelectedFillDayUserEmail] = useState<string>(ALL_USERS);
  const [data, setData] = useState<{ users: RoutingUsageUser[] } | null>(null);
  const [fillDayData, setFillDayData] = useState<{ users: FillDayUsageUser[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    setFillDayError(null);
    let alive = true;
    let done = 0;
    const checkDone = () => {
      done += 1;
      if (done === 2 && alive) setLoading(false);
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
    return list;
  }, [data]);

  const fillDayUserOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [{ value: ALL_USERS, label: 'All users' }];
    for (const u of fillDayData?.users ?? []) {
      if (u.userEmail) list.push({ value: u.userEmail, label: displayNameFillDay(u) });
    }
    return list;
  }, [fillDayData]);

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
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Routing usage
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
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton
              aria-label={isSingleDay ? 'Previous day' : 'Previous period'}
              onClick={() => (isSingleDay ? setRange((r) => ({ from: r.from.subtract(1, 'day'), to: r.from.subtract(1, 'day') })) : shiftRange(-1))}
              size="small"
            >
              <ChevronLeft />
            </IconButton>
            <Typography variant="body1" component="span" sx={{ minWidth: 220, textAlign: 'center' }}>
              {isSingleDay
                ? range.from.format('ddd, MMM D, YYYY')
                : `${range.from.format('MMM D')} – ${range.to.format('MMM D, YYYY')}`}
            </Typography>
            <IconButton
              aria-label={isSingleDay ? 'Next day' : 'Next period'}
              onClick={() => (isSingleDay ? setRange((r) => ({ from: r.from.add(1, 'day'), to: r.from.add(1, 'day') })) : shiftRange(1))}
              size="small"
            >
              <ChevronRight />
            </IconButton>
          </CardContent>
        </Card>

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
    </LocalizationProvider>
  );
}
