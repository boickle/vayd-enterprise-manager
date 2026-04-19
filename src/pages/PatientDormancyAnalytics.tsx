import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchPatientDormancyAnalytics,
  type PatientDormancyAnalyticsResponse,
} from '../api/patientDormancyAnalytics';

const DEFAULT_TIMEZONE = 'America/New_York';

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

function dateRangeInclusive(start: Dayjs, end: Dayjs): string[] {
  const out: string[] = [];
  let d = start.startOf('day');
  const e = end.startOf('day');
  while (!d.isAfter(e)) {
    out.push(toLocalDateStr(d));
    d = d.add(1, 'day');
  }
  return out;
}

const PRESET_KEYS = ['Today', '7D', '30D', '90D', 'YTD'] as const;
type PresetKey = (typeof PRESET_KEYS)[number];

const PRESETS: Record<PresetKey, () => { from: Dayjs; to: Dayjs }> = {
  Today: () => {
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

function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography color="text.secondary" variant="body2" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h4" component="div">
          {value}
        </Typography>
        {subtitle ? (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

function countsByDateFromSeries(series: PatientDormancyAnalyticsResponse['byDay']): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(series)) return map;
  for (const row of series) {
    if (!row || typeof row.date !== 'string') continue;
    const key = row.date.slice(0, 10);
    const n = Number(row.count);
    map.set(key, Number.isFinite(n) ? n : 0);
  }
  return map;
}

type DormancyChartRow = {
  date: string;
  dormant: number;
  returning: number;
  /** Newly dormant minus returning (same day D). */
  net: number;
};

function mergeChartRows(
  dates: string[],
  byDay: PatientDormancyAnalyticsResponse['byDay'],
  returningByDay: PatientDormancyAnalyticsResponse['returningByDay']
): DormancyChartRow[] {
  const dormantMap = countsByDateFromSeries(byDay);
  const returningMap = countsByDateFromSeries(returningByDay);
  return dates.map((date) => {
    const dormant = dormantMap.get(date) ?? 0;
    const returning = returningMap.get(date) ?? 0;
    return { date, dormant, returning, net: dormant - returning };
  });
}

/** Ordinary least squares line y = intercept + slope * i, i = 0..n-1 (same as cancellations / routing charts). */
function linearRegressionTrend(yValues: number[]): number[] {
  const n = yValues.length;
  if (n === 0) return [];
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = Number(yValues[i] ?? 0);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = sumY / n - slope * (sumX / n);
  return yValues.map((_, i) => intercept + slope * i);
}

type DormancyChartRowWithTrends = DormancyChartRow & {
  dormantTrend: number;
  returningTrend: number;
  netTrend: number;
};

function addSeriesTrends(rows: DormancyChartRow[]): DormancyChartRowWithTrends[] {
  if (!rows.length) return [];
  const dormantRaw = linearRegressionTrend(rows.map((r) => r.dormant));
  const returningRaw = linearRegressionTrend(rows.map((r) => r.returning));
  const netRaw = linearRegressionTrend(rows.map((r) => r.net));
  return rows.map((row, i) => ({
    ...row,
    dormantTrend: Math.max(0, dormantRaw[i] ?? 0),
    returningTrend: Math.max(0, returningRaw[i] ?? 0),
    netTrend: netRaw[i] ?? 0,
  }));
}

type ActiveStockChartRow = {
  date: string;
  activePatients: number;
  activeClients: number;
  patientsWithApptLast12m: number;
  clientsWithApptActivePetLast12m: number;
  clientsWithApptNoActivePetLast12m: number;
};

function mergeActiveStockRows(
  dates: string[],
  series: {
    activePatientsByDay?: PatientDormancyAnalyticsResponse['activePatientsByDay'];
    activeClientsByDay?: PatientDormancyAnalyticsResponse['activeClientsByDay'];
    patientsWithAppointmentLast12MonthsByDay?: PatientDormancyAnalyticsResponse['patientsWithAppointmentLast12MonthsByDay'];
    clientsWithAppointmentLast12MonthsWithActivePetByDay?: PatientDormancyAnalyticsResponse['clientsWithAppointmentLast12MonthsWithActivePetByDay'];
    clientsWithAppointmentLast12MonthsNoActivePetByDay?: PatientDormancyAnalyticsResponse['clientsWithAppointmentLast12MonthsNoActivePetByDay'];
  }
): ActiveStockChartRow[] {
  const patientMap = countsByDateFromSeries(series.activePatientsByDay);
  const clientMap = countsByDateFromSeries(series.activeClientsByDay);
  const p12 = countsByDateFromSeries(series.patientsWithAppointmentLast12MonthsByDay);
  const cAp = countsByDateFromSeries(series.clientsWithAppointmentLast12MonthsWithActivePetByDay);
  const cNo = countsByDateFromSeries(series.clientsWithAppointmentLast12MonthsNoActivePetByDay);
  return dates.map((date) => ({
    date,
    activePatients: patientMap.get(date) ?? 0,
    activeClients: clientMap.get(date) ?? 0,
    patientsWithApptLast12m: p12.get(date) ?? 0,
    clientsWithApptActivePetLast12m: cAp.get(date) ?? 0,
    clientsWithApptNoActivePetLast12m: cNo.get(date) ?? 0,
  }));
}

type ActiveStockChartRowWithTrend = ActiveStockChartRow & {
  activePatientsTrend: number;
  activeClientsTrend: number;
};

function addActiveStockTrends(rows: ActiveStockChartRow[]): ActiveStockChartRowWithTrend[] {
  if (!rows.length) return [];
  const patientRaw = linearRegressionTrend(rows.map((r) => r.activePatients));
  const clientRaw = linearRegressionTrend(rows.map((r) => r.activeClients));
  return rows.map((row, i) => ({
    ...row,
    activePatientsTrend: Math.max(0, patientRaw[i] ?? 0),
    activeClientsTrend: Math.max(0, clientRaw[i] ?? 0),
  }));
}

type ActiveChartLineKey =
  | 'activePatients'
  | 'activeClients'
  | 'patientsTrend'
  | 'clientsTrend'
  | 'patientsLast12m'
  | 'clientsApptActivePet'
  | 'clientsApptNoActivePet';

const DEFAULT_ACTIVE_LINE_ON: Record<ActiveChartLineKey, boolean> = {
  activePatients: true,
  activeClients: true,
  patientsTrend: true,
  clientsTrend: true,
  patientsLast12m: true,
  clientsApptActivePet: true,
  clientsApptNoActivePet: true,
};

export default function PatientDormancyAnalyticsPage() {
  const [preset, setPreset] = useState<PresetKey | ''>('Today');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS.Today());
  const [timezoneInput, setTimezoneInput] = useState(DEFAULT_TIMEZONE);
  const [practiceIdInput, setPracticeIdInput] = useState('');
  const [data, setData] = useState<PatientDormancyAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLineOn, setActiveLineOn] = useState<Record<ActiveChartLineKey, boolean>>(
    () => ({ ...DEFAULT_ACTIVE_LINE_ON })
  );

  const start = range.from.startOf('day');
  const end = range.to.startOf('day');
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);
  const isSingleDay = start.isSame(end, 'day');
  const dates = useMemo(() => dateRangeInclusive(start, end), [start, end]);

  const practiceIdParsed = useMemo(() => {
    const t = practiceIdInput.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }, [practiceIdInput]);

  const timezoneParam = useMemo(() => {
    const z = timezoneInput.trim();
    if (!z || z === DEFAULT_TIMEZONE) return undefined;
    return z;
  }, [timezoneInput]);

  const shiftRange = (direction: -1 | 1) => {
    const days = end.diff(start, 'day') + 1;
    const shift = days * direction;
    setPreset('');
    setRange((r) => ({
      from: r.from.add(shift, 'day'),
      to: r.to.add(shift, 'day'),
    }));
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchPatientDormancyAnalytics({
      startDate: startStr,
      endDate: endStr,
      timezone: timezoneParam,
      practiceId: practiceIdParsed,
    })
      .then((res) => {
        if (!alive) return;
        setData(res);
      })
      .catch((e) => {
        if (!alive) return;
        console.error('Patient dormancy fetch failed:', e);
        setError(
          'Failed to load patient dormancy. Ensure the server exposes GET /analytics/patient-dormancy.',
        );
        setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [startStr, endStr, timezoneParam, practiceIdParsed]);

  const chartData = useMemo(
    () => mergeChartRows(dates, data?.byDay, data?.returningByDay),
    [dates, data?.byDay, data?.returningByDay]
  );
  const chartDataWithTrend = useMemo(() => addSeriesTrends(chartData), [chartData]);

  const activeChartData = useMemo(
    () =>
      mergeActiveStockRows(dates, {
        activePatientsByDay: data?.activePatientsByDay,
        activeClientsByDay: data?.activeClientsByDay,
        patientsWithAppointmentLast12MonthsByDay: data?.patientsWithAppointmentLast12MonthsByDay,
        clientsWithAppointmentLast12MonthsWithActivePetByDay:
          data?.clientsWithAppointmentLast12MonthsWithActivePetByDay,
        clientsWithAppointmentLast12MonthsNoActivePetByDay:
          data?.clientsWithAppointmentLast12MonthsNoActivePetByDay,
      }),
    [
      dates,
      data?.activePatientsByDay,
      data?.activeClientsByDay,
      data?.patientsWithAppointmentLast12MonthsByDay,
      data?.clientsWithAppointmentLast12MonthsWithActivePetByDay,
      data?.clientsWithAppointmentLast12MonthsNoActivePetByDay,
    ]
  );
  const activeChartWithTrend = useMemo(() => addActiveStockTrends(activeChartData), [activeChartData]);

  const todayStart = useMemo(() => dayjs().startOf('day'), []);
  const periodDays = end.diff(start, 'day') + 1;
  const canShiftRangeForward =
    isSingleDay || !end.add(periodDays, 'day').isAfter(todayStart, 'day');

  const totalFromApi = data?.totalDormantTransitionsInRange;
  const totalDisplayed =
    typeof totalFromApi === 'number' && Number.isFinite(totalFromApi)
      ? totalFromApi
      : chartData.reduce((s, r) => s + r.dormant, 0);

  const totalReturningFromApi = data?.totalReturningTransitionsInRange;
  const totalReturningDisplayed =
    typeof totalReturningFromApi === 'number' && Number.isFinite(totalReturningFromApi)
      ? totalReturningFromApi
      : chartData.reduce((s, r) => s + r.returning, 0);

  const netTotalDisplayed = totalDisplayed - totalReturningDisplayed;

  const hasActivePatientsSeries =
    data != null &&
    Array.isArray(data.activePatientsByDay) &&
    data.activePatientsByDay.length > 0;
  const hasActiveClientsSeries =
    data != null && Array.isArray(data.activeClientsByDay) && data.activeClientsByDay.length > 0;
  const hasPatientsLast12mSeries =
    data != null &&
    Array.isArray(data.patientsWithAppointmentLast12MonthsByDay) &&
    data.patientsWithAppointmentLast12MonthsByDay.length > 0;
  const hasClientsActivePetLast12mSeries =
    data != null &&
    Array.isArray(data.clientsWithAppointmentLast12MonthsWithActivePetByDay) &&
    data.clientsWithAppointmentLast12MonthsWithActivePetByDay.length > 0;
  const hasClientsNoActivePetLast12mSeries =
    data != null &&
    Array.isArray(data.clientsWithAppointmentLast12MonthsNoActivePetByDay) &&
    data.clientsWithAppointmentLast12MonthsNoActivePetByDay.length > 0;
  const hasActiveChartData =
    hasActivePatientsSeries ||
    hasActiveClientsSeries ||
    hasPatientsLast12mSeries ||
    hasClientsActivePetLast12mSeries ||
    hasClientsNoActivePetLast12mSeries;

  /** Values for the last calendar day in the selected range (`endStr`). */
  const activeLastDayRow = useMemo(() => {
    if (!activeChartData.length) return null;
    return activeChartData.find((r) => r.date === endStr) ?? null;
  }, [activeChartData, endStr]);

  const activePatientsOnLastDay =
    hasActivePatientsSeries && activeLastDayRow != null ? activeLastDayRow.activePatients : null;
  const activeClientsOnLastDay =
    hasActiveClientsSeries && activeLastDayRow != null ? activeLastDayRow.activeClients : null;
  const patientsWithApptLast12mOnLastDay =
    hasPatientsLast12mSeries && activeLastDayRow != null ? activeLastDayRow.patientsWithApptLast12m : null;
  const clientsWithApptActivePetOnLastDay =
    hasClientsActivePetLast12mSeries && activeLastDayRow != null
      ? activeLastDayRow.clientsWithApptActivePetLast12m
      : null;
  const clientsWithApptNoActivePetOnLastDay =
    hasClientsNoActivePetLast12mSeries && activeLastDayRow != null
      ? activeLastDayRow.clientsWithApptNoActivePetLast12m
      : null;

  /** Active patients (point-in-time) ÷ clients with active pet (12m window cohort), same day T. */
  const activePatientsPerClientWithActivePetLastDay =
    hasActivePatientsSeries &&
    hasClientsActivePetLast12mSeries &&
    activePatientsOnLastDay != null &&
    clientsWithApptActivePetOnLastDay != null &&
    clientsWithApptActivePetOnLastDay > 0
      ? activePatientsOnLastDay / clientsWithApptActivePetOnLastDay
      : null;

  const lastDayKpiSubtitle = `Last day in range (${endStr})`;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ py: 2, pb: 4 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Patient dormancy
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Daily newly dormant, returning, and net (dormant minus returning) use dormancy calendar day{' '}
          <strong>D</strong>. The lower chart combines point-in-time active counts, rolling 12-month visit cohorts for
          patients and clients, and optional trend lines; use the checkboxes to reduce clutter. Optional filters: IANA
          timezone for day boundaries (defaults to {DEFAULT_TIMEZONE} on the server) and practice ID to limit to one
          location.
        </Typography>

        <Card sx={{ mb: 3 }}>
          <CardHeader title="Date range" />
          <CardContent>
            <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" sx={{ mb: 2 }}>
              {PRESET_KEYS.map((key) => (
                <Button
                  key={key}
                  size="small"
                  variant={preset === key ? 'contained' : 'outlined'}
                  onClick={() => {
                    setPreset(key);
                    setRange(PRESETS[key]());
                  }}
                >
                  {key}
                </Button>
              ))}
            </Stack>

            <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
              <IconButton
                aria-label={isSingleDay ? 'Previous day' : 'Previous period'}
                size="small"
                onClick={() => {
                  setPreset('');
                  if (isSingleDay) {
                    setRange((r) => ({
                      from: r.from.subtract(1, 'day'),
                      to: r.from.subtract(1, 'day'),
                    }));
                  } else {
                    shiftRange(-1);
                  }
                }}
              >
                <ChevronLeft />
              </IconButton>
              <Typography variant="body2" sx={{ minWidth: 200 }}>
                {startStr === endStr ? startStr : `${startStr} → ${endStr}`}
              </Typography>
              <IconButton
                aria-label={isSingleDay ? 'Next day' : 'Next period'}
                size="small"
                onClick={() => {
                  setPreset('');
                  if (isSingleDay) {
                    setRange((r) => {
                      const next = r.from.add(1, 'day').startOf('day');
                      if (next.isAfter(todayStart, 'day')) return r;
                      return { from: next, to: next };
                    });
                  } else if (canShiftRangeForward) {
                    shiftRange(1);
                  }
                }}
                disabled={isSingleDay ? !start.isBefore(todayStart, 'day') : !canShiftRangeForward}
              >
                <ChevronRight />
              </IconButton>

              <DatePicker
                label="From"
                value={range.from}
                onChange={(v) => {
                  if (!v) return;
                  setPreset('');
                  setRange((r) => {
                    const to = r.to.startOf('day');
                    const from = v.startOf('day');
                    return from.isAfter(to) ? { from, to: from } : { from, to: r.to };
                  });
                }}
                maxDate={dayjs()}
                slotProps={{ textField: { size: 'small' } }}
              />
              <DatePicker
                label="To"
                value={range.to}
                onChange={(v) => {
                  if (!v) return;
                  setPreset('');
                  setRange((r) => {
                    const from = r.from.startOf('day');
                    let to = v.startOf('day');
                    const today = dayjs().startOf('day');
                    if (to.isAfter(today)) to = today;
                    return to.isBefore(from) ? { from: to, to } : { from: r.from, to };
                  });
                }}
                maxDate={dayjs()}
                slotProps={{ textField: { size: 'small' } }}
              />

              <TextField
                size="small"
                label="Timezone (IANA)"
                value={timezoneInput}
                onChange={(e) => setTimezoneInput(e.target.value)}
                sx={{ minWidth: 220 }}
                placeholder={DEFAULT_TIMEZONE}
              />
              <TextField
                size="small"
                label="Practice ID (optional)"
                value={practiceIdInput}
                onChange={(e) => setPracticeIdInput(e.target.value)}
                sx={{ width: 180 }}
                placeholder="All"
              />
            </Stack>
          </CardContent>
        </Card>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={6} md={4}>
                <KpiCard
                  title="Total dormant transitions"
                  value={totalDisplayed}
                  subtitle={`${startStr} through ${endStr} inclusive`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <KpiCard
                  title="Total returning (same D)"
                  value={totalReturningDisplayed}
                  subtitle={`${startStr} through ${endStr} inclusive`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <KpiCard
                  title="Net (dormant − returning)"
                  value={netTotalDisplayed}
                  subtitle="Total dormant minus total returning for this range"
                />
              </Grid>
            </Grid>

            {hasActiveChartData ? (
              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12}>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Patient and client counts on the last day of the selected range
                  </Typography>
                </Grid>
                {hasActivePatientsSeries ? (
                  <Grid item xs={12} sm={6} md={4}>
                    <KpiCard
                      title="Active patients"
                      value={
                        activePatientsOnLastDay != null ? activePatientsOnLastDay.toLocaleString() : '—'
                      }
                      subtitle={lastDayKpiSubtitle}
                    />
                  </Grid>
                ) : null}
                {hasClientsActivePetLast12mSeries ? (
                  <Grid item xs={12} sm={6} md={4}>
                    <KpiCard
                      title="Clients + active pet"
                      value={
                        clientsWithApptActivePetOnLastDay != null
                          ? clientsWithApptActivePetOnLastDay.toLocaleString()
                          : '—'
                      }
                      subtitle={lastDayKpiSubtitle}
                    />
                  </Grid>
                ) : null}
                {hasActiveClientsSeries ? (
                  <Grid item xs={12} sm={6} md={4}>
                    <KpiCard
                      title="Active clients"
                      value={
                        activeClientsOnLastDay != null ? activeClientsOnLastDay.toLocaleString() : '—'
                      }
                      subtitle={lastDayKpiSubtitle}
                    />
                  </Grid>
                ) : null}
                {hasActivePatientsSeries && hasClientsActivePetLast12mSeries ? (
                  <Grid item xs={12} sm={6} md={4}>
                    <KpiCard
                      title="Active patients ÷ clients (with active pet)"
                      value={
                        activePatientsPerClientWithActivePetLastDay != null
                          ? activePatientsPerClientWithActivePetLastDay.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 3,
                            })
                          : '—'
                      }
                      subtitle={
                        clientsWithApptActivePetOnLastDay === 0
                          ? `${lastDayKpiSubtitle} — no clients with active pet`
                          : `${lastDayKpiSubtitle} — active patients per client with active pet`
                      }
                    />
                  </Grid>
                ) : null}
                {hasPatientsLast12mSeries ? (
                  <Grid item xs={12} sm={6} md={4}>
                    <KpiCard
                      title="Patients (visit in 12m)"
                      value={
                        patientsWithApptLast12mOnLastDay != null
                          ? patientsWithApptLast12mOnLastDay.toLocaleString()
                          : '—'
                      }
                      subtitle={lastDayKpiSubtitle}
                    />
                  </Grid>
                ) : null}
                {hasClientsNoActivePetLast12mSeries ? (
                  <Grid item xs={12} sm={6} md={4}>
                    <KpiCard
                      title="Clients, no active pet"
                      value={
                        clientsWithApptNoActivePetOnLastDay != null
                          ? clientsWithApptNoActivePetOnLastDay.toLocaleString()
                          : '—'
                      }
                      subtitle={lastDayKpiSubtitle}
                    />
                  </Grid>
                ) : null}
              </Grid>
            ) : null}

            <Card>
              <CardHeader title="Newly dormant, returning, and net by dormancy day" />
              <CardContent sx={{ height: 420 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartDataWithTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => {
                        const num = Number(value ?? 0);
                        const nm = String(name ?? '').toLowerCase();
                        if (nm.includes('trend')) {
                          return [num.toFixed(1), String(name ?? 'Trend')];
                        }
                        return [String(Math.round(num)), String(name ?? '')];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="dormant"
                      name="Newly dormant"
                      stroke="#6a1b9a"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="returning"
                      name="Returning"
                      stroke="#00897b"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="net"
                      name="Net (dormant − returning)"
                      stroke="#e65100"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="dormantTrend"
                      name="Dormant trend"
                      stroke="#6a1b9a"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="returningTrend"
                      name="Returning trend"
                      stroke="#00897b"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="netTrend"
                      name="Net trend"
                      stroke="#e65100"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardHeader
                title="Active patients and clients by calendar day"
                subheader="Use the checkboxes to show or hide each series (including trends)."
              />
              <CardContent>
                {hasActiveChartData ? (
                  <>
                    <Stack direction="row" flexWrap="wrap" columnGap={2} rowGap={0.5} sx={{ mb: 1.5 }}>
                      {hasActivePatientsSeries ? (
                        <>
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={activeLineOn.activePatients}
                                onChange={(_, c) =>
                                  setActiveLineOn((p) => ({ ...p, activePatients: c }))
                                }
                              />
                            }
                            label="Active patients"
                            sx={{ mr: 0 }}
                          />
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={activeLineOn.patientsTrend}
                                onChange={(_, c) =>
                                  setActiveLineOn((p) => ({ ...p, patientsTrend: c }))
                                }
                              />
                            }
                            label="Patients trend"
                            sx={{ mr: 0 }}
                          />
                        </>
                      ) : null}
                      {hasActiveClientsSeries ? (
                        <>
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={activeLineOn.activeClients}
                                onChange={(_, c) =>
                                  setActiveLineOn((p) => ({ ...p, activeClients: c }))
                                }
                              />
                            }
                            label="Active clients"
                            sx={{ mr: 0 }}
                          />
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={activeLineOn.clientsTrend}
                                onChange={(_, c) =>
                                  setActiveLineOn((p) => ({ ...p, clientsTrend: c }))
                                }
                              />
                            }
                            label="Clients trend"
                            sx={{ mr: 0 }}
                          />
                        </>
                      ) : null}
                      {hasPatientsLast12mSeries ? (
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={activeLineOn.patientsLast12m}
                              onChange={(_, c) =>
                                setActiveLineOn((p) => ({ ...p, patientsLast12m: c }))
                              }
                            />
                          }
                          label="Patients (visit in 12m)"
                          sx={{ mr: 0 }}
                        />
                      ) : null}
                      {hasClientsActivePetLast12mSeries ? (
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={activeLineOn.clientsApptActivePet}
                              onChange={(_, c) =>
                                setActiveLineOn((p) => ({ ...p, clientsApptActivePet: c }))
                              }
                            />
                          }
                          label="Clients + active pet"
                          sx={{ mr: 0 }}
                        />
                      ) : null}
                      {hasClientsNoActivePetLast12mSeries ? (
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={activeLineOn.clientsApptNoActivePet}
                              onChange={(_, c) =>
                                setActiveLineOn((p) => ({ ...p, clientsApptNoActivePet: c }))
                              }
                            />
                          }
                          label="Clients, no active pet"
                          sx={{ mr: 0 }}
                        />
                      ) : null}
                    </Stack>
                    <Box sx={{ height: 420 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={activeChartWithTrend} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                          <YAxis
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) => {
                              const n = Number(v);
                              if (!Number.isFinite(n)) return String(v);
                              if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
                              return String(n);
                            }}
                          />
                          <Tooltip
                            formatter={(value: unknown, name: unknown) => {
                              const num = Number(value ?? 0);
                              const nm = String(name ?? '').toLowerCase();
                              if (nm.includes('trend')) {
                                return [
                                  num.toLocaleString(undefined, { maximumFractionDigits: 1 }),
                                  String(name ?? ''),
                                ];
                              }
                              return [Math.round(num).toLocaleString(), String(name ?? '')];
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          {activeLineOn.activePatients && hasActivePatientsSeries ? (
                            <Line
                              type="monotone"
                              dataKey="activePatients"
                              name="Active patients"
                              stroke="#1565c0"
                              strokeWidth={2}
                              dot={false}
                            />
                          ) : null}
                          {activeLineOn.activeClients && hasActiveClientsSeries ? (
                            <Line
                              type="monotone"
                              dataKey="activeClients"
                              name="Active clients"
                              stroke="#2e7d32"
                              strokeWidth={2}
                              dot={false}
                            />
                          ) : null}
                          {activeLineOn.patientsTrend && hasActivePatientsSeries ? (
                            <Line
                              type="monotone"
                              dataKey="activePatientsTrend"
                              name="Patients trend"
                              stroke="#1565c0"
                              strokeWidth={1.5}
                              strokeDasharray="5 5"
                              dot={false}
                            />
                          ) : null}
                          {activeLineOn.clientsTrend && hasActiveClientsSeries ? (
                            <Line
                              type="monotone"
                              dataKey="activeClientsTrend"
                              name="Clients trend"
                              stroke="#2e7d32"
                              strokeWidth={1.5}
                              strokeDasharray="5 5"
                              dot={false}
                            />
                          ) : null}
                          {activeLineOn.patientsLast12m && hasPatientsLast12mSeries ? (
                            <Line
                              type="monotone"
                              dataKey="patientsWithApptLast12m"
                              name="Patients (visit in 12m)"
                              stroke="#7b1fa2"
                              strokeWidth={2}
                              dot={false}
                            />
                          ) : null}
                          {activeLineOn.clientsApptActivePet && hasClientsActivePetLast12mSeries ? (
                            <Line
                              type="monotone"
                              dataKey="clientsWithApptActivePetLast12m"
                              name="Clients + active pet"
                              stroke="#6d4c41"
                              strokeWidth={2}
                              dot={false}
                            />
                          ) : null}
                          {activeLineOn.clientsApptNoActivePet && hasClientsNoActivePetLast12mSeries ? (
                            <Line
                              type="monotone"
                              dataKey="clientsWithApptNoActivePetLast12m"
                              name="Clients, no active pet"
                              stroke="#c62828"
                              strokeWidth={2}
                              dot={false}
                            />
                          ) : null}
                        </LineChart>
                      </ResponsiveContainer>
                    </Box>
                  </>
                ) : (
                  <Typography color="text.secondary">
                    None of the active / 12-month series were returned (
                    <code>activePatientsByDay</code>, <code>activeClientsByDay</code>,{' '}
                    <code>patientsWithAppointmentLast12MonthsByDay</code>,{' '}
                    <code>clientsWithAppointmentLast12MonthsWithActivePetByDay</code>,{' '}
                    <code>clientsWithAppointmentLast12MonthsNoActivePetByDay</code>).
                  </Typography>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </Box>
    </LocalizationProvider>
  );
}
