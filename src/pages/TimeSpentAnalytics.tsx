import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import isoWeek from 'dayjs/plugin/isoWeek';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { fetchDoctorMonth, type DoctorMonthDay } from '../api/appointments';
import { fetchDriveTime } from '../api/driveTime';

dayjs.extend(utc);
dayjs.extend(isoWeek);

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

/** All dates in [start, end] inclusive (YYYY-MM-DD). */
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

type ChartRow = { period: string; [typeName: string]: number | string };

/** Row for stacked chart with segments ordered by value (largest at bottom) per period. */
export type ChartRowOrdered = { period: string; [key: string]: number | string | undefined };

/** Appointment types to lump into "Other" (case-insensitive match). */
const OTHER_APPT_TYPES = new Set([
  'acupuncture',
  'ash drop off',
  'laser',
  'needs pre-appt meds',
  'ha - exisiting client',
  'ha - existing client', // in case of correct spelling
]);

/** Normalize type for chart: lump "Tech appointment*" into one type; specific types into Other. */
function normalizeAppointmentType(name: string | undefined): string {
  const s = (name && String(name).trim()) || '';
  if (!s) return 'Other';
  if (s.toLowerCase().startsWith('tech appointment')) return 'Tech appointment';
  if (OTHER_APPT_TYPES.has(s.toLowerCase())) return 'Other';
  return s;
}

/** Aggregate appts into buckets (key -> sumByType, countByType). */
function aggregateByBuckets(
  allDays: { date: string; appts: { appointmentType?: string; serviceMinutes?: number }[] }[],
  getBucketKey: (dateStr: string) => string,
  getBucketLabel: (dateStr: string) => string
): { key: string; label: string; sumByType: Map<string, number>; countByType: Map<string, number> }[] {
  const byKey = new Map<string, { label: string; sumByType: Map<string, number>; countByType: Map<string, number> }>();

  for (const day of allDays) {
    const date = day?.date?.slice(0, 10);
    if (!date) continue;
    const key = getBucketKey(date);
    const label = getBucketLabel(date);
    if (!byKey.has(key)) {
      byKey.set(key, { label, sumByType: new Map(), countByType: new Map() });
    }
    const entry = byKey.get(key)!;
    for (const a of day.appts ?? []) {
      const typeName = normalizeAppointmentType(a.appointmentType);
      const mins = Number.isFinite(a.serviceMinutes) ? a.serviceMinutes! : 0;
      entry.sumByType.set(typeName, (entry.sumByType.get(typeName) ?? 0) + mins);
      entry.countByType.set(typeName, (entry.countByType.get(typeName) ?? 0) + 1);
    }
  }

  return Array.from(byKey.entries()).map(([key, v]) => ({ key, label: v.label, sumByType: v.sumByType, countByType: v.countByType }));
}

/** Build chart rows from bucket aggregates; only include types with value > 0. */
function bucketsToChartRows(
  buckets: { key: string; label: string; sumByType: Map<string, number>; countByType: Map<string, number> }[],
  sortedTypes: string[]
): ChartRow[] {
  return buckets
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => {
      const row: ChartRow = { period: bucket.label };
      for (const typeName of sortedTypes) {
        const sum = bucket.sumByType.get(typeName) ?? 0;
        const count = bucket.countByType.get(typeName) ?? 0;
        if (count > 0) {
          const value = Math.round((sum / count) * 10) / 10;
          if (value > 0) row[typeName] = value;
        }
      }
      return row;
    });
}

/** For each date, for each appointment type: average service minutes. Appts without type go under "Other". */
function buildAvgMinutesByDayByType(
  start: Dayjs,
  end: Dayjs,
  allDays: { date: string; appts: { appointmentType?: string; serviceMinutes?: number }[] }[]
): ChartRow[] {
  const dates = dateRange(start, end);
  const byDate = new Map<string, { sumByType: Map<string, number>; countByType: Map<string, number> }>();

  for (const d of dates) {
    byDate.set(d, { sumByType: new Map(), countByType: new Map() });
  }

  for (const day of allDays) {
    const date = day?.date?.slice(0, 10);
    if (!date || !byDate.has(date)) continue;
    const entry = byDate.get(date)!;
    for (const a of day.appts ?? []) {
      const typeName = normalizeAppointmentType(a.appointmentType);
      const mins = Number.isFinite(a.serviceMinutes) ? a.serviceMinutes! : 0;
      entry.sumByType.set(typeName, (entry.sumByType.get(typeName) ?? 0) + mins);
      entry.countByType.set(typeName, (entry.countByType.get(typeName) ?? 0) + 1);
    }
  }

  const typeOrder = new Set<string>();
  for (const entry of byDate.values()) {
    for (const t of entry.sumByType.keys()) typeOrder.add(t);
  }
  const sortedTypes = Array.from(typeOrder).sort();

  const buckets = dates.map((date) => {
    const entry = byDate.get(date)!;
    return {
      key: date,
      label: date,
      sumByType: entry.sumByType,
      countByType: entry.countByType,
    };
  });
  return bucketsToChartRows(buckets, sortedTypes);
}

/** Week: bucket by ISO week (Mon–Sun), label "Week of Jan 6". */
function buildAvgMinutesByWeekByType(
  start: Dayjs,
  end: Dayjs,
  allDays: { date: string; appts: { appointmentType?: string; serviceMinutes?: number }[] }[]
): ChartRow[] {
  const weekStart = (d: string) => dayjs(d).startOf('isoWeek').format('YYYY-MM-DD');
  const weekLabel = (d: string) => `Week of ${dayjs(d).startOf('isoWeek').format('MMM D')}`;
  const buckets = aggregateByBuckets(allDays, weekStart, weekLabel);
  const typeOrder = new Set<string>();
  for (const b of buckets) {
    for (const t of b.sumByType.keys()) typeOrder.add(t);
  }
  return bucketsToChartRows(buckets, Array.from(typeOrder).sort());
}

/** Month: bucket by month, label "Jan 2026". */
function buildAvgMinutesByMonthByType(
  start: Dayjs,
  end: Dayjs,
  allDays: { date: string; appts: { appointmentType?: string; serviceMinutes?: number }[] }[]
): ChartRow[] {
  const monthKey = (d: string) => dayjs(d).startOf('month').format('YYYY-MM');
  const monthLabel = (d: string) => dayjs(d).format('MMM YYYY');
  const buckets = aggregateByBuckets(allDays, monthKey, monthLabel);
  const typeOrder = new Set<string>();
  for (const b of buckets) {
    for (const t of b.sumByType.keys()) typeOrder.add(t);
  }
  return bucketsToChartRows(buckets, Array.from(typeOrder).sort());
}

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
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

const TYPE_COLORS: Record<string, string> = {
  Wellness: '#3182bd',
  'Multi-Pet': '#31a354',
  Sick: '#e6550d',
  Euthanasia: '#d62728',
  'Tech appointment': '#756bb1',
  Other: '#636363',
};

function getColorForType(typeName: string, index: number): string {
  const palette = ['#3182bd', '#31a354', '#e6550d', '#d62728', '#756bb1', '#636363', '#8c6d31'];
  return TYPE_COLORS[typeName] ?? palette[index % palette.length];
}

/** For each row, sort types by value descending and output pos0, pos1, ... and type0, type1, ... so largest is bottom. */
function orderChartRowsByValuePerPeriod(rows: ChartRow[]): { data: ChartRowOrdered[]; maxSlots: number } {
  let maxSlots = 0;
  const data: ChartRowOrdered[] = rows.map((row) => {
    const entries = Object.entries(row)
      .filter(([k, v]) => k !== 'period' && typeof v === 'number' && v > 0)
      .sort(([, a], [, b]) => (b as number) - (a as number));
    maxSlots = Math.max(maxSlots, entries.length);
    const out: ChartRowOrdered = { period: row.period };
    entries.forEach(([typeName, value], i) => {
      out[`pos${i}`] = value as number;
      out[`type${i}`] = typeName;
    });
    return out;
  });
  return { data, maxSlots };
}

/** Linear regression trend for a series (index vs value). */
function addLinearTrend<T extends { driveMinutes: number }>(data: T[]): (T & { trend: number })[] {
  if (!data.length) return [];
  const n = data.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = Number(data[i]?.driveMinutes ?? 0);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const slope =
    n * sumXX - sumX * sumX !== 0 ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) : 0;
  const intercept = sumY / n - slope * (sumX / n);
  return data.map((row, i) => ({ ...row, trend: intercept + slope * i }));
}

const ALL_DVMS = '';
const DEFAULT_PRACTICE_ID = 1;

export type GroupByOption = 'day' | 'week' | 'month';

export default function TimeSpentAnalyticsPage() {
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [preset, setPreset] = useState<string>('30D');
  const [doctorId, setDoctorId] = useState<string>(ALL_DVMS);
  const [groupBy, setGroupBy] = useState<GroupByOption>('day');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawDays, setRawDays] = useState<{ date: string; appts: DoctorMonthDay['appts'] }[]>([]);
  const [driveTimeData, setDriveTimeData] = useState<{ date: string; driveMinutes: number }[]>([]);
  const [driveTimeLoading, setDriveTimeLoading] = useState(false);

  const start = range.from.startOf('day');
  const end = range.to.startOf('day');
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);
  const monthPairs = useMemo(() => monthsInRange(start, end), [start, end]);

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
    setLoading(true);
    setError(null);
    let alive = true;

    (async () => {
      try {
        if (doctorId === ALL_DVMS && providers.length === 0) {
          setRawDays([]);
          setLoading(false);
          return;
        }

        const requests: Promise<{ days: DoctorMonthDay[] }>[] = [];
        if (doctorId === ALL_DVMS) {
          for (const p of providers) {
            for (const { year, month } of monthPairs) {
              requests.push(
                fetchDoctorMonth(year, month, String(p.id ?? p.pimsId ?? '')).then((r) => ({
                  days: r.days ?? [],
                }))
              );
            }
          }
        } else {
          for (const { year, month } of monthPairs) {
            requests.push(
              fetchDoctorMonth(year, month, doctorId).then((r) => ({ days: r.days ?? [] }))
            );
          }
        }

        const results = await Promise.all(requests);
        if (!alive) return;

        const byDate = new Map<string, { date: string; appts: DoctorMonthDay['appts'] }>();
        for (const { days } of results) {
          for (const day of days) {
            const date = day?.date?.slice(0, 10);
            if (!date) continue;
            const existing = byDate.get(date);
            const appts = (day.appts ?? []) as DoctorMonthDay['appts'];
            if (existing) {
              existing.appts = [...(existing.appts ?? []), ...appts];
            } else {
              byDate.set(date, { date, appts });
            }
          }
        }

        const sorted = dateRange(start, end).map((date) => {
          const d = byDate.get(date);
          return d ?? { date, appts: [] };
        });
        setRawDays(sorted);
      } catch (e) {
        if (!alive) return;
        console.error('Time spent fetch failed:', e);
        setError('Failed to load appointment data');
        setRawDays([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [startStr, endStr, doctorId, monthPairs.length, providers.length]);

  useEffect(() => {
    const dates = dateRange(start, end);
    setDriveTimeLoading(true);
    setDriveTimeData([]);
    let alive = true;

    (async () => {
      try {
        const results = await Promise.all(
          dates.map((date) =>
            fetchDriveTime({
              practiceId: DEFAULT_PRACTICE_ID,
              startDate: date,
              endDate: date,
            })
          )
        );
        if (!alive) return;

        const rows: { date: string; driveMinutes: number }[] = dates.map((date, i) => {
          const res = results[i];
          if (doctorId === ALL_DVMS) {
            return { date, driveMinutes: res?.totalDriveMinutes ?? 0 };
          }
          const doc = (res?.byDoctor ?? []).find(
            (d) => String(d.doctorId) === doctorId || String(d.pimsId) === doctorId
          );
          return { date, driveMinutes: doc?.driveMinutes ?? 0 };
        });
        setDriveTimeData(rows);
      } catch (e) {
        if (!alive) return;
        console.error('Drive time fetch failed:', e);
        setDriveTimeData([]);
      } finally {
        if (alive) setDriveTimeLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [startStr, endStr, doctorId]);

  const chartData = useMemo(() => {
    if (groupBy === 'week') return buildAvgMinutesByWeekByType(start, end, rawDays);
    if (groupBy === 'month') return buildAvgMinutesByMonthByType(start, end, rawDays);
    return buildAvgMinutesByDayByType(start, end, rawDays);
  }, [start, end, rawDays, groupBy]);

  const { data: chartDataOrdered, maxSlots } = useMemo(
    () => orderChartRowsByValuePerPeriod(chartData),
    [chartData]
  );

  const slotIndices = useMemo(() => Array.from({ length: maxSlots }, (_, i) => i), [maxSlots]);

  const doctorOptions = useMemo(() => {
    const list: { id: string; label: string }[] = [{ id: ALL_DVMS, label: 'All DVMs' }];
    for (const p of providers) {
      list.push({ id: String(p.id ?? p.pimsId ?? ''), label: p.name });
    }
    return list;
  }, [providers]);

  const driveTimeDataWithTrend = useMemo(
    () => addLinearTrend(driveTimeData),
    [driveTimeData]
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Average Appointment Length by Type
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
          </CardContent>
        </Card>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Card>
          <CardHeader
            title="Time spent by appointment type"
            subheader={
              groupBy === 'day'
                ? 'Stacked average minutes per appointment type per day. Filter by doctor or view entire practice.'
                : groupBy === 'week'
                  ? 'Stacked average minutes per appointment type per week. Filter by doctor or view entire practice.'
                  : 'Stacked average minutes per appointment type per month. Filter by doctor or view entire practice.'
            }
          />
          <CardContent>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel id="time-spent-doctor-label">Doctor</InputLabel>
                <Select
                  labelId="time-spent-doctor-label"
                  value={doctorId}
                  label="Doctor"
                  onChange={(e) => setDoctorId(e.target.value)}
                >
                  {doctorOptions.map((opt) => (
                    <MenuItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="time-spent-group-label">Group by</InputLabel>
                <Select
                  labelId="time-spent-group-label"
                  value={groupBy}
                  label="Group by"
                  onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
                >
                  <MenuItem value="day">By day</MenuItem>
                  <MenuItem value="week">By week</MenuItem>
                  <MenuItem value="month">By month</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="time-spent-metric-label">Metric</InputLabel>
                <Select
                  labelId="time-spent-metric-label"
                  value="avg"
                  label="Metric"
                  disabled
                >
                  <MenuItem value="avg">Avg minutes per appt</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ width: '100%', height: 400 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartDataOrdered}
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis label={{ value: 'Minutes', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length || !label) return null;
                        const row = payload[0]?.payload as ChartRowOrdered;
                        const items = slotIndices
                          .map((i) => ({
                            type: row[`type${i}`] as string | undefined,
                            value: row[`pos${i}`] as number | undefined,
                          }))
                          .filter((x) => x.type && (x.value ?? 0) > 0);
                        return (
                          <Box
                            sx={{
                              bgcolor: 'background.paper',
                              border: '1px solid',
                              borderColor: 'divider',
                              borderRadius: 1,
                              p: 1.5,
                              boxShadow: 1,
                            }}
                          >
                            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                              {String(label)}
                            </Typography>
                            {items.map(({ type, value }) => (
                              <Typography key={type} variant="body2">
                                {type}: {value != null ? `${Number(value)} mins` : '0 mins'}
                              </Typography>
                            ))}
                          </Box>
                        );
                      }}
                    />
                    {slotIndices.map((i) => (
                      <Bar key={i} dataKey={`pos${i}`} stackId="time" name={`Slot ${i}`} isAnimationActive={false}>
                        {chartDataOrdered.map((entry, idx) => (
                          <Cell
                            key={`cell-${i}-${idx}`}
                            fill={getColorForType((entry[`type${i}`] as string) ?? '', i)}
                          />
                        ))}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}
          </CardContent>
        </Card>

        <Card sx={{ mt: 3 }}>
          <CardHeader
            title="Drive time"
            subheader={
              doctorId === ALL_DVMS
                ? 'Total drive minutes per day for the entire practice.'
                : 'Drive minutes per day for the selected doctor.'
            }
          />
          <CardContent>
            {driveTimeLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ width: '100%', height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={driveTimeDataWithTrend}
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis
                      label={{ value: 'Minutes', angle: -90, position: 'insideLeft' }}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value: number | undefined, name: string | undefined) => [
                        value != null ? `${Number(value).toFixed(1)} mins` : '0 mins',
                        (name ?? '') === 'trend' ? 'Trend' : 'Drive time',
                      ]}
                      labelFormatter={(label) => String(label)}
                    />
                    <Line
                      type="monotone"
                      dataKey="driveMinutes"
                      stroke="#636363"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Drive time"
                    />
                    <Line
                      type="monotone"
                      dataKey="trend"
                      stroke="#636363"
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
      </Box>
    </LocalizationProvider>
  );
}
