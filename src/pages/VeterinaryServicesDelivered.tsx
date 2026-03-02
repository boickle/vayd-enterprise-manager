import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  List,
  ListItem,
  ListItemText,
  Backdrop,
  CircularProgress,
  Alert,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
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
import {
  fetchDoctorMonth,
  type DoctorMonthDay,
} from '../api/appointments';

dayjs.extend(utc);

const PRACTICE_TOTAL_ID = '__practice__';

/** Format date as YYYY-MM-DD in local time (for API and chart consistency). */
function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    Number(n) || 0
  );
}

/** All dates in [start, end] inclusive (YYYY-MM-DD, local time). */
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

/** Sum series by date into a map; missing dates are 0. */
function seriesByDate(series: DoctorRevenuePoint[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of series) {
    const d = String(p?.date ?? '').slice(0, 10);
    if (d) m.set(d, (m.get(d) ?? 0) + Number(p?.total ?? 0));
  }
  return m;
}

/** Compute linear regression trend values for chart data (index vs total). */
function addLinearTrend<T extends { total: number }>(
  data: T[]
): (T & { trend: number })[] {
  if (!data.length) return [];
  const n = data.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = Number(data[i]?.total ?? 0);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const slope = n * sumXX - sumX * sumX !== 0
    ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
    : 0;
  const intercept = sumY / n - slope * (sumX / n);
  return data.map((row, i) => ({
    ...row,
    trend: intercept + slope * i,
  }));
}

/** Points from appointments (same rules as My Day: 1 normal, 0.5 tech, 2 euthanasia; skip personal blocks). */
function pointsFromAppts(
  appts: { appointmentType?: string; isPersonalBlock?: boolean }[]
): number {
  return (appts ?? []).reduce((total, a) => {
    if ((a as any)?.isPersonalBlock) return total;
    const type = (a?.appointmentType || '').toLowerCase();
    if (type === 'euthanasia') return total + 2;
    if (type.includes('tech appointment')) return total + 0.5;
    return total + 1;
  }, 0);
}

/** Points for one day from month API: appts (with appointmentType) + blocks (counted as personal). */
function pointsFromMonthDay(day: DoctorMonthDay): number {
  const apptsWithType = (day.appts ?? []).map((a) => ({
    appointmentType: a.appointmentType,
    isPersonalBlock: false,
  }));
  const blocksAsPersonal = (day.blocks ?? []).map(() => ({ isPersonalBlock: true }));
  return pointsFromAppts([...apptsWithType, ...blocksAsPersonal]);
}

/** Unique (year, month) pairs that span [start, end] (month 1-based). */
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

/** Build practice total series: for each date in range, sum all doctors' totals. */
function buildPracticeSeries(
  start: Dayjs,
  end: Dayjs,
  doctorResponses: { doctorId: string; response: DoctorRevenueSeriesResponse }[]
): { date: string; total: number }[] {
  const byDate = new Map<string, number>();
  for (const d of dateRange(start, end)) {
    byDate.set(d, 0);
  }
  for (const { response } of doctorResponses) {
    const series = Array.isArray(response?.series) ? response.series : [];
    for (const p of series) {
      const d = String(p?.date ?? '').slice(0, 10);
      if (byDate.has(d)) {
        byDate.set(d, (byDate.get(d) ?? 0) + Number(p?.total ?? 0));
      }
    }
  }
  return Array.from(byDate.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Presets use local time; "now" is evaluated when the preset is applied. */
const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  Today: () => {
    const today = dayjs().startOf('day');
    return { from: today, to: today };
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

export default function VeterinaryServicesDeliveredPage() {
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [preset, setPreset] = useState<string>('30D');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [doctorResponses, setDoctorResponses] = useState<
    { doctorId: string; name: string; response: DoctorRevenueSeriesResponse }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphSelection, setGraphSelection] = useState<string>(PRACTICE_TOTAL_ID);
  const [excludeZeroRevenueDays, setExcludeZeroRevenueDays] = useState(false);
  const [pointsByDoctorByDate, setPointsByDoctorByDate] = useState<
    Record<string, Record<string, number>>
  >({});
  const [pointsLoading, setPointsLoading] = useState(false);

  const start = range.from.startOf('day');
  const end = range.to.startOf('day');
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);
  const isSingleDay = start.isSame(end, 'day');
  const today = dayjs().startOf('day');
  const canGoNext = end.isBefore(today);

  // Load providers
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

  // Load each doctor's revenue series for the date range
  useEffect(() => {
    if (!providers.length) {
      setDoctorResponses([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const results = await Promise.all(
          providers.map(async (p) => {
            const id = String(p.id);
            const response = await fetchDoctorRevenueSeries({
              start: startStr,
              end: endStr,
              doctorId: id,
            });
            return { doctorId: id, name: p.name, response };
          })
        );
        if (!alive) return;
        setDoctorResponses(results);
      } catch (e) {
        if (!alive) return;
        console.error('VSD fetch failed:', e);
        setError('Failed to load revenue data');
        setDoctorResponses([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [providers.length, startStr, endStr]);

  // Load appointments per doctor per month for points (one request per doctor per month in range)
  useEffect(() => {
    if (isSingleDay || !providers.length) {
      setPointsByDoctorByDate({});
      setPointsLoading(false);
      return;
    }
    const monthPairs = monthsInRange(start, end);
    let alive = true;
    setPointsLoading(true);
    (async () => {
      try {
        const entries = providers.flatMap((p) =>
          monthPairs.map(({ year, month }) => ({ doctorId: String(p.id), year, month }))
        );
        const results = await Promise.all(
          entries.map(async ({ doctorId, year, month }) => {
            const resp = await fetchDoctorMonth(year, month, doctorId);
            return { doctorId, days: resp?.days ?? [] };
          })
        );
        if (!alive) return;
        const byDoctorByDate: Record<string, Record<string, number>> = {};
        for (const { doctorId, days } of results) {
          if (!byDoctorByDate[doctorId]) byDoctorByDate[doctorId] = {};
          for (const day of days) {
            const date = day?.date?.slice(0, 10);
            if (date) byDoctorByDate[doctorId][date] = pointsFromMonthDay(day);
          }
        }
        setPointsByDoctorByDate(byDoctorByDate);
      } catch (e) {
        if (!alive) return;
        console.error('Points (appointments) fetch failed:', e);
        setPointsByDoctorByDate({});
      } finally {
        if (alive) setPointsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isSingleDay, providers.length, startStr, endStr]);

  const practiceSeries = useMemo(
    () =>
      buildPracticeSeries(
        start,
        end,
        doctorResponses.map((r) => ({ doctorId: r.doctorId, response: r.response }))
      ),
    [start, end, doctorResponses]
  );

  const practiceTotal = useMemo(
    () => practiceSeries.reduce((s, p) => s + Number(p.total), 0),
    [practiceSeries]
  );

  const chartData = useMemo(() => {
    let data: { date: string; total: number }[];
    if (graphSelection === PRACTICE_TOTAL_ID) {
      data = practiceSeries;
    } else {
      const dr = doctorResponses.find((r) => String(r.doctorId) === graphSelection);
      if (!dr) {
        data = practiceSeries;
      } else {
        const byDate = seriesByDate(dr.response.series ?? []);
        data = dateRange(start, end).map((date) => ({
          date,
          total: byDate.get(date) ?? 0,
        }));
      }
    }
    return addLinearTrend(data);
  }, [graphSelection, doctorResponses, practiceSeries, start, end]);

  const chartDisplayData = useMemo(() => {
    if (!excludeZeroRevenueDays) return chartData;
    const filtered = chartData
      .filter((d) => Number(d.total) !== 0)
      .map((d) => ({ date: d.date, total: d.total }));
    return addLinearTrend(filtered);
  }, [chartData, excludeZeroRevenueDays]);

  /** Points per date for current graph selection (practice = sum over doctors; one doctor = that doctor). */
  const pointsPerDateForSelection = useMemo(() => {
    const map = new Map<string, number>();
    const dates = dateRange(start, end);
    if (graphSelection === PRACTICE_TOTAL_ID) {
      for (const date of dates) {
        let sum = 0;
        for (const p of providers) {
          const id = String(p.id);
          sum += pointsByDoctorByDate[id]?.[date] ?? 0;
        }
        map.set(date, sum);
      }
    } else {
      const doc = pointsByDoctorByDate[graphSelection];
      for (const date of dates) {
        map.set(date, doc?.[date] ?? 0);
      }
    }
    return map;
  }, [graphSelection, pointsByDoctorByDate, start, end, providers]);

  /** VSD per point by date (revenue / points; 0 when no points). Same structure as chartData. */
  const vsdPerPointChartData = useMemo(() => {
    const pointsMap = pointsPerDateForSelection;
    return chartData.map((row) => {
      const pts = pointsMap.get(row.date) ?? 0;
      const vsdPerPoint = pts > 0 ? Number(row.total) / pts : 0;
      return { ...row, points: pts, vsdPerPoint };
    });
  }, [chartData, pointsPerDateForSelection]);

  const vsdPerPointDisplayData = useMemo(() => {
    const base =
      excludeZeroRevenueDays
        ? vsdPerPointChartData.filter((d) => Number(d.total) !== 0)
        : vsdPerPointChartData;
    const withTrend = addLinearTrend(
      base.map((d) => ({ date: d.date, total: d.vsdPerPoint }))
    ) as { date: string; total: number; trend: number }[];
    return withTrend.map((row, i) => ({
      date: row.date,
      vsdPerPoint: row.total,
      trend: row.trend,
      points: base[i]?.points ?? 0,
    }));
  }, [vsdPerPointChartData, excludeZeroRevenueDays]);

  const graphOptions = useMemo(() => {
    const options: { id: string; label: string }[] = [
      { id: PRACTICE_TOTAL_ID, label: 'Practice total' },
    ];
    doctorResponses.forEach((r) => {
      options.push({ id: String(r.doctorId), label: r.name });
    });
    return options;
  }, [doctorResponses]);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Veterinary Services Delivered
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
          <CardContent sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            {isSingleDay ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <IconButton
                  aria-label="Previous day"
                  onClick={() => {
                    setPreset('');
                    setRange((r) => ({
                      from: r.from.subtract(1, 'day').startOf('day'),
                      to: r.to.subtract(1, 'day').startOf('day'),
                    }));
                  }}
                >
                  <ChevronLeft />
                </IconButton>
                <DatePicker
                  label="Date"
                  value={range.from}
                  onChange={(d) => {
                    if (d) {
                      setPreset('');
                      const day = d.startOf('day');
                      setRange({ from: day, to: day });
                    }
                  }}
                  slotProps={{ textField: { size: 'small', sx: { minWidth: 160 } } }}
                />
                <IconButton
                  aria-label="Next day"
                  disabled={!canGoNext}
                  onClick={() => {
                    if (!canGoNext) return;
                    setPreset('');
                    setRange((r) => ({
                      from: r.from.add(1, 'day').startOf('day'),
                      to: r.to.add(1, 'day').startOf('day'),
                    }));
                  }}
                >
                  <ChevronRight />
                </IconButton>
              </Box>
            ) : (
              <>
                <DatePicker
                  label="From"
                  value={range.from}
                  onChange={(d) => d && setRange((r) => ({ ...r, from: d.startOf('day') }))}
                  slotProps={{ textField: { size: 'small' } }}
                />
                <DatePicker
                  label="To"
                  value={range.to}
                  onChange={(d) => d && setRange((r) => ({ ...r, to: d.startOf('day') }))}
                  slotProps={{ textField: { size: 'small' } }}
                />
              </>
            )}
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
              title="VSD over time"
              subheader="Switch between practice total and individual doctors"
            />
            <CardContent>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel id="vsd-graph-label">Show in graph</InputLabel>
                  <Select
                    labelId="vsd-graph-label"
                    value={graphSelection}
                    label="Show in graph"
                    onChange={(e) => setGraphSelection(e.target.value)}
                  >
                    {graphOptions.map((opt) => (
                      <MenuItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={excludeZeroRevenueDays}
                      onChange={(e) => setExcludeZeroRevenueDays(e.target.checked)}
                    />
                  }
                  label="Exclude zero revenue days"
                />
              </Box>
              <Box sx={{ width: '100%', height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartDisplayData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      formatter={(value: number | undefined, name: string | undefined) => [
                        fmtUSD(value ?? 0),
                        name ?? '',
                      ]}
                      labelFormatter={(label) => String(label)}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#1976d2"
                      strokeWidth={2}
                      dot={false}
                      name="VSD"
                    />
                    <Line
                      type="monotone"
                      dataKey="trend"
                      stroke="#ed6c02"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                      name="Trend"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2, mb: 1 }}>
                VSD per point (revenue ÷ points; points: 1 normal, 0.5 tech, 2 euthanasia)
              </Typography>
              <Box sx={{ width: '100%', height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={vsdPerPointDisplayData}
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      formatter={(value: number | undefined, name: string | undefined) => [
                        fmtUSD(value ?? 0),
                        name ?? '',
                      ]}
                      labelFormatter={(label) => String(label)}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="vsdPerPoint"
                      stroke="#2e7d32"
                      strokeWidth={2}
                      dot={false}
                      name="VSD per point"
                    />
                    <Line
                      type="monotone"
                      dataKey="trend"
                      stroke="#ed6c02"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                      name="Trend"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader
            title={isSingleDay ? `VSD for ${start.format('MMMM D, YYYY')}` : 'Totals for selected range'}
          />
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              Practice total: {fmtUSD(practiceTotal)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              By doctor
            </Typography>
            <List dense disablePadding>
              {doctorResponses
                .slice()
                .sort((a, b) => Number(b.response.total ?? 0) - Number(a.response.total ?? 0))
                .map((r) => (
                  <ListItem
                    key={r.doctorId}
                    disablePadding
                    sx={{ py: 0.5, display: 'flex', justifyContent: 'space-between' }}
                  >
                    <ListItemText primary={r.name} primaryTypographyProps={{ variant: 'body2' }} />
                    <Typography variant="body2" fontWeight={500}>
                      {fmtUSD(Number(r.response.total ?? 0))}
                    </Typography>
                  </ListItem>
                ))}
            </List>
          </CardContent>
        </Card>

        <Backdrop
          open={loading || pointsLoading}
          sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
        >
          <CircularProgress color="inherit" />
        </Backdrop>
      </Box>
    </LocalizationProvider>
  );
}
