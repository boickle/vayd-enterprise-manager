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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { fetchDoctorMonth, type DoctorMonthDay } from '../api/appointments';

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

const ALL_DVMS = '';

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

  const chartData = useMemo(() => {
    if (groupBy === 'week') return buildAvgMinutesByWeekByType(start, end, rawDays);
    if (groupBy === 'month') return buildAvgMinutesByMonthByType(start, end, rawDays);
    return buildAvgMinutesByDayByType(start, end, rawDays);
  }, [start, end, rawDays, groupBy]);

  const typeKeys = useMemo(() => {
    if (chartData.length === 0) return [];
    const keys = new Set<string>();
    for (const row of chartData) {
      for (const k of Object.keys(row)) {
        if (k !== 'period') keys.add(k);
      }
    }
    const totals = new Map<string, number>();
    for (const key of keys) {
      let sum = 0;
      for (const row of chartData) {
        const v = row[key];
        if (typeof v === 'number' && v > 0) sum += v;
      }
      totals.set(key, sum);
    }
    return Array.from(keys).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }, [chartData]);

  const doctorOptions = useMemo(() => {
    const list: { id: string; label: string }[] = [{ id: ALL_DVMS, label: 'All DVMs' }];
    for (const p of providers) {
      list.push({ id: String(p.id ?? p.pimsId ?? ''), label: p.name });
    }
    return list;
  }, [providers]);

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
                    data={chartData}
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis label={{ value: 'Minutes', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number | undefined, name: string | undefined) => [
                        value != null ? `${Number(value)} mins` : '0 mins',
                        name ?? '',
                      ]}
                      labelFormatter={(label) => String(label)}
                    />
                    {typeKeys.map((dataKey, i) => (
                      <Bar
                        key={dataKey}
                        dataKey={dataKey}
                        stackId="time"
                        fill={getColorForType(dataKey, i)}
                        name={dataKey}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </LocalizationProvider>
  );
}
