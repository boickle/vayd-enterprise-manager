import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { isEmployeeAnalyticsRestricted, normalizeAuthRoles } from '../utils/analyticsAccess';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
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
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchForwardBookingAnalytics,
  type ForwardBookingAnalyticsProviderDay,
  type ForwardBookingAnalyticsResponse,
} from '../api/forwardBookingAnalytics';

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

const ALL_PROVIDERS = '';
const OTHER_PROVIDERS_KEY = '__other__';

type ChartPoint = {
  date: string;
  total: number;
  forwardBooked: number;
  rate: number | null;
  trend: number | null;
};

type ProviderTotal = {
  key: string;
  name: string;
  totalAppointments: number;
  forwardBooked: number;
};

function formatPercent(forwardBooked: number, total: number): string {
  if (total <= 0) return '—';
  return `${((forwardBooked / total) * 100).toFixed(1)}%`;
}

function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

/** Linear regression on days that have appointments, mapped back onto the calendar index. */
function addRateTrend(data: Omit<ChartPoint, 'trend'>[]): ChartPoint[] {
  const points = data
    .map((row, i) => ({ i, y: row.rate }))
    .filter((p): p is { i: number; y: number } => p.y != null);
  if (!points.length) return data.map((row) => ({ ...row, trend: null }));

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    sumX += p.i;
    sumY += p.y;
    sumXY += p.i * p.y;
    sumXX += p.i * p.i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = sumY / n - slope * (sumX / n);
  return data.map((row, i) => ({
    ...row,
    trend: Math.min(100, Math.max(0, intercept + slope * i)),
  }));
}

function providerKeys(row: ForwardBookingAnalyticsProviderDay): string[] {
  const keys: string[] = [];
  if (row.primaryProviderId != null) keys.push(String(row.primaryProviderId));
  const pims = row.primaryProviderPimsId?.trim();
  if (pims) keys.push(pims);
  return keys;
}

function allowedIdsForSelection(selected: string, providers: Provider[]): Set<string> {
  const allowed = new Set<string>([selected]);
  const p = providers.find((x) => String(x.id) === selected);
  if (p?.pimsId != null && String(p.pimsId).trim()) allowed.add(String(p.pimsId).trim());
  return allowed;
}

function rowMatchesProvider(
  row: ForwardBookingAnalyticsProviderDay,
  selected: string,
  providers: Provider[]
): boolean {
  if (!selected) return true;
  const allowed = allowedIdsForSelection(selected, providers);
  return providerKeys(row).some((k) => allowed.has(k));
}

function rowIsAssigned(row: ForwardBookingAnalyticsProviderDay, assigned: Set<string>): boolean {
  if (!assigned.size) return false;
  return providerKeys(row).some((k) => assigned.has(k));
}

function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
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

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <Paper sx={{ p: 1.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="body2">Appropriate appointments: {formatCount(row.total)}</Typography>
      <Typography variant="body2">Future visit booked: {formatCount(row.forwardBooked)}</Typography>
      <Typography variant="body2">
        Rate: {row.rate == null ? '—' : `${row.rate.toFixed(1)}%`}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Trend: {row.trend == null ? '—' : `${row.trend.toFixed(1)}%`}
      </Typography>
    </Paper>
  );
}

export default function ForwardBookingAnalytics() {
  const [preset, setPreset] = useState<string>('30D');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [data, setData] = useState<ForwardBookingAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(ALL_PROVIDERS);

  const { role, assignedDoctorIds } = useAuth() as {
    role?: string | string[];
    assignedDoctorIds?: string[];
  };
  const normalizedRoles = normalizeAuthRoles(role);
  const restrictEmployeeAnalytics = isEmployeeAnalyticsRestricted(normalizedRoles);
  const assignedDoctorIdSet = useMemo(
    () => new Set((assignedDoctorIds ?? []).map((x) => String(x).trim()).filter(Boolean)),
    [assignedDoctorIds]
  );

  const start = range.from.startOf('day');
  const end = range.to.startOf('day');
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);
  const isSingleDay = start.isSame(end, 'day');
  const dates = useMemo(() => dateRange(start, end), [start, end]);

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
    fetchPrimaryProviders()
      .then((list) => {
        if (!alive) return;
        setProviders(list ?? []);
        setProvidersError(null);
      })
      .catch((e) => {
        if (!alive) return;
        console.error('fetchPrimaryProviders failed:', e);
        setProvidersError('Could not load provider list for filtering.');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let alive = true;
    fetchForwardBookingAnalytics({ startDate: startStr, endDate: endStr })
      .then((res) => {
        if (!alive) return;
        setData(res);
      })
      .catch((e) => {
        if (!alive) return;
        console.error('Forward booking analytics fetch failed:', e);
        setError(
          'Failed to load forward booking analytics. Ensure the server exposes GET /analytics/forward-booking.'
        );
        setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [startStr, endStr]);

  const providerOptions = useMemo(() => {
    const allLabel = restrictEmployeeAnalytics ? 'Entire practice' : 'All primary providers';
    const opts = [{ value: ALL_PROVIDERS, label: allLabel }];
    const list = restrictEmployeeAnalytics
      ? providers.filter(
          (p) =>
            assignedDoctorIdSet.has(String(p.id)) ||
            (p.pimsId != null && assignedDoctorIdSet.has(String(p.pimsId)))
        )
      : providers;
    for (const p of list) {
      opts.push({ value: String(p.id), label: p.name || String(p.id) });
    }
    return opts;
  }, [providers, restrictEmployeeAnalytics, assignedDoctorIdSet]);

  useEffect(() => {
    const allowed = new Set(providerOptions.map((o) => o.value));
    if (!allowed.has(selectedProviderId)) setSelectedProviderId(ALL_PROVIDERS);
  }, [providerOptions, selectedProviderId]);

  const filteredDays = useMemo(() => {
    const rows = data?.byProviderDay ?? [];
    return rows.filter((row) => rowMatchesProvider(row, selectedProviderId, providers));
  }, [data?.byProviderDay, selectedProviderId, providers]);

  const totals = useMemo(() => {
    let totalAppointments = 0;
    let forwardBooked = 0;
    for (const row of filteredDays) {
      totalAppointments += Number(row.totalAppointments) || 0;
      forwardBooked += Number(row.forwardBooked) || 0;
    }
    return { totalAppointments, forwardBooked };
  }, [filteredDays]);

  const chartData = useMemo(() => {
    const byDate = new Map<string, { total: number; forwardBooked: number }>();
    for (const date of dates) byDate.set(date, { total: 0, forwardBooked: 0 });
    for (const row of filteredDays) {
      const bucket = byDate.get(row.date);
      if (!bucket) continue;
      bucket.total += Number(row.totalAppointments) || 0;
      bucket.forwardBooked += Number(row.forwardBooked) || 0;
    }
    const series = dates.map((date) => {
      const bucket = byDate.get(date) ?? { total: 0, forwardBooked: 0 };
      return {
        date,
        total: bucket.total,
        forwardBooked: bucket.forwardBooked,
        rate: bucket.total > 0 ? (bucket.forwardBooked / bucket.total) * 100 : null,
      };
    });
    return addRateTrend(series);
  }, [dates, filteredDays]);

  const providerRows = useMemo(() => {
    const map = new Map<string, ProviderTotal>();
    const showOtherRollup = restrictEmployeeAnalytics && selectedProviderId === ALL_PROVIDERS;
    for (const row of filteredDays) {
      const assigned = rowIsAssigned(row, assignedDoctorIdSet);
      const hideName = showOtherRollup && !assigned;
      const key = hideName
        ? OTHER_PROVIDERS_KEY
        : row.primaryProviderId != null
          ? `id:${row.primaryProviderId}`
          : 'unassigned';
      const name = hideName ? 'Other providers' : row.primaryProviderName || 'Unassigned';
      const existing = map.get(key);
      if (existing) {
        existing.totalAppointments += Number(row.totalAppointments) || 0;
        existing.forwardBooked += Number(row.forwardBooked) || 0;
      } else {
        map.set(key, {
          key,
          name,
          totalAppointments: Number(row.totalAppointments) || 0,
          forwardBooked: Number(row.forwardBooked) || 0,
        });
      }
    }
    return [...map.values()].sort((a, b) => {
      const rateA = a.totalAppointments > 0 ? a.forwardBooked / a.totalAppointments : -1;
      const rateB = b.totalAppointments > 0 ? b.forwardBooked / b.totalAppointments : -1;
      if (rateB !== rateA) return rateB - rateA;
      return b.totalAppointments - a.totalAppointments;
    });
  }, [filteredDays, restrictEmployeeAnalytics, selectedProviderId, assignedDoctorIdSet]);

  const hasChartPoints = chartData.some((row) => row.rate != null);
  const scopeLabel =
    selectedProviderId === ALL_PROVIDERS
      ? restrictEmployeeAnalytics
        ? 'Entire practice'
        : 'All primary providers'
      : (providerOptions.find((o) => o.value === selectedProviderId)?.label ?? 'Selected provider');

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Forward Booking
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Of the appointments each team saw, how many led to another visit on the calendar.
          Euthanasia visits and End Visit choices of Not appropriate are left out. A visit counts
          only when a later appointment is really there: the forward-booking list entry was booked,
          a follow-up was created during the visit (Booked at appointment), a later visit was
          already on the calendar (Already booked), or a Labs pending visit later produced a
          booking. Choosing Forward book without a booking yet does not count. Holds, blocks,
          and cancellations are excluded, as are appointments the team never finished.
        </Typography>

        {providersError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {providersError}
          </Alert>
        )}

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
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <IconButton
              aria-label={isSingleDay ? 'Previous day' : 'Previous period'}
              onClick={() => {
                if (isSingleDay) {
                  setPreset('');
                  setRange((r) => ({ from: r.from.subtract(1, 'day'), to: r.from.subtract(1, 'day') }));
                } else {
                  shiftRange(-1);
                }
              }}
              size="small"
            >
              <ChevronLeft />
            </IconButton>
            <Typography variant="body2" sx={{ minWidth: 200 }}>
              {startStr === endStr ? startStr : `${startStr} → ${endStr}`}
            </Typography>
            <IconButton
              aria-label={isSingleDay ? 'Next day' : 'Next period'}
              onClick={() => {
                if (isSingleDay) {
                  setPreset('');
                  setRange((r) => ({ from: r.from.add(1, 'day'), to: r.from.add(1, 'day') }));
                } else {
                  shiftRange(1);
                }
              }}
              size="small"
            >
              <ChevronRight />
            </IconButton>
            <DatePicker
              label="From"
              value={range.from}
              onChange={(v) => {
                if (!v?.isValid()) return;
                setPreset('');
                setRange((r) => {
                  const from = v.startOf('day');
                  const to = r.to.startOf('day');
                  return from.isAfter(to) ? { from, to: from } : { from, to };
                });
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="To"
              value={range.to}
              onChange={(v) => {
                if (!v?.isValid()) return;
                setPreset('');
                setRange((r) => {
                  const to = v.startOf('day');
                  const from = r.from.startOf('day');
                  return to.isBefore(from) ? { from: to, to } : { from, to };
                });
              }}
              slotProps={{ textField: { size: 'small' } }}
            />

            <FormControl size="small" sx={{ minWidth: 220, ml: { xs: 0, sm: 2 } }}>
              <InputLabel id="forward-booking-provider-label">Primary provider</InputLabel>
              <Select
                labelId="forward-booking-provider-label"
                label="Primary provider"
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(String(e.target.value))}
              >
                {providerOptions.map((o) => (
                  <MenuItem key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </CardContent>
        </Card>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} sm={4}>
                <KpiCard
                  title="Appropriate appointments"
                  value={formatCount(totals.totalAppointments)}
                  subtitle={scopeLabel}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <KpiCard
                  title="Future visit booked"
                  value={formatCount(totals.forwardBooked)}
                  subtitle="A later visit is on the calendar"
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <KpiCard
                  title="Percent with a future visit"
                  value={formatPercent(totals.forwardBooked, totals.totalAppointments)}
                  subtitle="Future visit booked ÷ appropriate appointments"
                />
              </Grid>
            </Grid>

            <Card sx={{ mb: 3 }}>
              <CardHeader
                title="Future visits booked"
                subheader={`${scopeLabel}. Daily percent of appropriate appointments that led to a later visit, with a linear trend.`}
              />
              <CardContent sx={{ height: 360 }}>
                {hasChartPoints ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${v}%`}
                        domain={[0, 'auto']}
                        width={48}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="rate"
                        name="Future visit booked"
                        stroke="#1565c0"
                        dot={false}
                        strokeWidth={2}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="trend"
                        name="Trend"
                        stroke="#1565c0"
                        strokeWidth={1.5}
                        strokeDasharray="5 5"
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Typography color="text.secondary">No appointments in this range.</Typography>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                title="By primary provider"
                subheader={
                  restrictEmployeeAnalytics && selectedProviderId === ALL_PROVIDERS
                    ? 'Practice total above. Named rows are providers assigned to you; everyone else is combined.'
                    : 'Teams ranked by the share of appropriate appointments that led to a later visit.'
                }
              />
              <CardContent sx={{ pt: 0 }}>
                {providerRows.length === 0 ? (
                  <Typography color="text.secondary">No appointments in this range.</Typography>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Primary provider</TableCell>
                          <TableCell align="right">Appropriate appointments</TableCell>
                          <TableCell align="right">Future visit booked</TableCell>
                          <TableCell align="right">Future visit %</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {providerRows.map((row) => (
                          <TableRow key={row.key} hover>
                            <TableCell>{row.name}</TableCell>
                            <TableCell align="right">{formatCount(row.totalAppointments)}</TableCell>
                            <TableCell align="right">{formatCount(row.forwardBooked)}</TableCell>
                            <TableCell align="right">
                              {formatPercent(row.forwardBooked, row.totalAppointments)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {formatCount(totals.totalAppointments)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {formatCount(totals.forwardBooked)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {formatPercent(totals.forwardBooked, totals.totalAppointments)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </Box>
    </LocalizationProvider>
  );
}
