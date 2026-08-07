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
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  buildAppointmentTypeCatalog,
  pointsFromAppointmentRows,
  type AppointmentTypeCatalog,
} from '../utils/appointmentTypeSettings';
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
  estimated: number;
  points: number;
  appointmentCount: number;
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
  useEffect(() => {
    if (!providersForApi.length) {
      setPointsByDoctorByDate({});
      setApptCountByDoctorByDate({});
      setHistDoctorResponses([]);
      setHistPointsByDoctorByDate({});
      setLoading(false);
      return;
    }

    const todayD = dayjs().startOf('day');
    const histEnd = todayD.subtract(1, 'day');
    const histStart = histEnd.subtract(VSD_ESTIMATE_LOOKBACK_DAYS - 1, 'day');
    const histStartStr = toLocalDateStr(histStart);
    const histEndStr = toLocalDateStr(histEnd);

    // Include today in hist months so today's calendar points can be projected too
    const projectionMonths = monthsInRange(start, end);
    const histMonths = monthsInRange(histStart, todayD);
    const monthKey = (y: number, m: number) => `${y}-${m}`;
    const allMonthPairs = new Map<string, { year: number; month: number }>();
    for (const p of [...projectionMonths, ...histMonths]) {
      allMonthPairs.set(monthKey(p.year, p.month), p);
    }
    const monthPairs = Array.from(allMonthPairs.values());

    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const revenueResults = await Promise.all(
          providersForApi.map(async (p) => {
            const id = String(p.id);
            const response = await fetchDoctorRevenueSeries({
              start: histStartStr,
              end: histEndStr,
              doctorId: id,
            });
            return { doctorId: id, name: p.name, response };
          })
        );

        const pointResults = await Promise.all(
          providersForApi.flatMap((p) =>
            monthPairs.map(async ({ year, month }) => {
              const doctorId = String(p.id);
              const resp = await fetchDoctorMonth(year, month, doctorId);
              return { doctorId, days: resp?.days ?? [] };
            })
          )
        );

        if (!alive) return;

        const pointsByDoctor: Record<string, Record<string, number>> = {};
        const countsByDoctor: Record<string, Record<string, number>> = {};
        for (const { doctorId, days } of pointResults) {
          if (!pointsByDoctor[doctorId]) pointsByDoctor[doctorId] = {};
          if (!countsByDoctor[doctorId]) countsByDoctor[doctorId] = {};
          for (const day of days) {
            const date = day?.date?.slice(0, 10);
            if (!date) continue;
            pointsByDoctor[doctorId][date] = pointsFromMonthDay(day, typeCatalog);
            countsByDoctor[doctorId][date] = (day.appts ?? []).length;
          }
        }

        setHistDoctorResponses(revenueResults);
        setHistPointsByDoctorByDate(pointsByDoctor);
        setPointsByDoctorByDate(pointsByDoctor);
        setApptCountByDoctorByDate(countsByDoctor);
      } catch (e) {
        if (!alive) return;
        console.error('Projected revenue fetch failed:', e);
        setError('Failed to load projected revenue data');
        setPointsByDoctorByDate({});
        setApptCountByDoctorByDate({});
        setHistDoctorResponses([]);
        setHistPointsByDoctorByDate({});
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

  /** Per-day estimated revenue / points / appt counts for the selected range. */
  const dailyEstimates = useMemo(() => {
    const dates = dateRange(start, end);
    const providerIds =
      graphSelection === PRACTICE_TOTAL_ID
        ? providersForApi.map((p) => String(p.id))
        : [graphSelection];

    return dates.map((date) => {
      let estimated = 0;
      let points = 0;
      let appointmentCount = 0;
      let hasRate = false;
      for (const id of providerIds) {
        const pts = pointsByDoctorByDate[id]?.[date] ?? 0;
        const count = apptCountByDoctorByDate[id]?.[date] ?? 0;
        const rate = ratesByDoctor.byDoctor[id]?.rate;
        points += pts;
        appointmentCount += count;
        if (rate != null) {
          estimated += rate * pts;
          hasRate = true;
        }
      }
      return {
        date,
        estimated: hasRate ? estimated : 0,
        points,
        appointmentCount,
      };
    });
  }, [
    start,
    end,
    graphSelection,
    providersForApi,
    pointsByDoctorByDate,
    apptCountByDoctorByDate,
    ratesByDoctor,
  ]);

  const buckets: BucketRow[] = useMemo(() => {
    if (useDailyBuckets) {
      return dailyEstimates.map((d) => ({
        key: d.date,
        label: dayjs(d.date).format('MMM D'),
        estimated: d.estimated,
        points: d.points,
        appointmentCount: d.appointmentCount,
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
          estimated: d.estimated,
          points: d.points,
          appointmentCount: d.appointmentCount,
        });
      } else {
        existing.estimated += d.estimated;
        existing.points += d.points;
        existing.appointmentCount += d.appointmentCount;
      }
    }
    return Array.from(byWeek.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [dailyEstimates, useDailyBuckets]);

  const totals = useMemo(() => {
    return buckets.reduce(
      (acc, b) => {
        acc.estimated += b.estimated;
        acc.points += b.points;
        acc.appointmentCount += b.appointmentCount;
        return acc;
      },
      { estimated: 0, points: 0, appointmentCount: 0 }
    );
  }, [buckets]);

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
        points: Math.round(b.points * 10) / 10,
      })),
    [buckets]
  );

  const hasAnyRate = Object.values(ratesByDoctor.byDoctor).some((r) => r.rate != null);

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
          Estimates practice revenue from booked appointments using each doctor&apos;s trailing{' '}
          {VSD_ESTIMATE_LOOKBACK_DAYS}-day average VSD per point (same method as estimated daily VSD).
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

        {!hasAnyRate && !error && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No trailing VSD/point history is available yet, so estimates cannot be calculated. Once
            doctors have delivered services over the last {VSD_ESTIMATE_LOOKBACK_DAYS} days, projections
            will appear here.
          </Alert>
        )}

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Summary"
            subheader={`${start.format('MMM D, YYYY')} – ${end.format('MMM D, YYYY')}`}
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
                  Projected revenue
                </Typography>
                <Typography variant="h5">{fmtUSD(totals.estimated)}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Booked points
                </Typography>
                <Typography variant="h5">{Math.round(totals.points * 10) / 10}</Typography>
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
          </CardContent>
        </Card>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title={useDailyBuckets ? 'Projected revenue by day' : 'Projected revenue by week'}
            subheader="Based on booked appointment points × trailing VSD per point"
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
                      yAxisId="revenue"
                      tickFormatter={(v) =>
                        new Intl.NumberFormat(undefined, {
                          style: 'currency',
                          currency: 'USD',
                          maximumFractionDigits: 0,
                        }).format(Number(v) || 0)
                      }
                      width={72}
                    />
                    <YAxis yAxisId="points" orientation="right" width={48} />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => [
                        String(name) === 'estimated'
                          ? fmtUSD(Number(value ?? 0))
                          : Number(value ?? 0),
                        String(name) === 'estimated' ? 'Projected' : 'Points',
                      ]}
                    />
                    <Legend
                      formatter={(value) => (value === 'estimated' ? 'Projected revenue' : 'Points')}
                    />
                    <Line
                      yAxisId="revenue"
                      type="monotone"
                      dataKey="estimated"
                      stroke="#1976d2"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="estimated"
                    />
                    <Line
                      yAxisId="points"
                      type="monotone"
                      dataKey="points"
                      stroke="#2e7d32"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={{ r: 2 }}
                      name="points"
                    />
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
                  <TableCell align="right">Appointments</TableCell>
                  <TableCell align="right">Points</TableCell>
                  <TableCell align="right">Projected revenue</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {buckets.map((b) => (
                  <TableRow key={b.key}>
                    <TableCell>
                      {useDailyBuckets ? dayjs(b.key).format('ddd, MMM D, YYYY') : b.label}
                    </TableCell>
                    <TableCell align="right">{b.appointmentCount}</TableCell>
                    <TableCell align="right">{Math.round(b.points * 10) / 10}</TableCell>
                    <TableCell align="right">{fmtUSD(b.estimated)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>
                    <Typography variant="subtitle2">Total</Typography>
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
