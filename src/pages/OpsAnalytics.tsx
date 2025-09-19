import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Typography,
  Button,
  Tabs,
  Tab,
  Popover,
  Stack,
  Divider,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Chip,
} from '@mui/material';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import { CalendarMonth, Refresh } from '@mui/icons-material';
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
import { useAuth } from '../auth/useAuth';
import { fetchPrimaryProviders, type Provider } from '../api/employee';

// You will need to implement this API on your backend similar to fetchPaymentsAnalytics
// and add a thin client wrapper here. See the type and expected response below.
import { fetchOpsStatsAnalytics, type OpsStatPoint } from '../api/opsStats';

// If you want to prototype without backend first, you can export a mock below
// and temporarily swap the import to `fetchOpsStatsAnalyticsMock`.
// import { fetchOpsStatsAnalyticsMock as fetchOpsStatsAnalytics } from '../api/opsStats.mock';

dayjs.extend(utc);

// ----------------------------------
// Types
// ----------------------------------
export type DateRange = {
  from: Dayjs;
  to: Dayjs;
};

// Charted metrics (keys must exist on OpsStatPoint)
const METRICS = [
  { key: 'driveMin', label: 'Drive (min)', axis: 'min' },
  { key: 'householdMin', label: 'Households (min)', axis: 'min' },
  { key: 'shiftMin', label: 'Shift (min)', axis: 'min' },
  { key: 'whiteMin', label: 'Whitespace (min)', axis: 'min' },
  { key: 'whitePct', label: 'Whitespace (%)', axis: 'pct' },
  { key: 'hdRatio', label: 'H:D ratio', axis: 'ratio' },
  { key: 'points', label: 'Points', axis: 'count' },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];

// ----------------------------------
// Utilities
// ----------------------------------
function toISODate(d: Dayjs) {
  return d.utc().format('YYYY-MM-DD');
}
function daysBetween(a: Dayjs, b: Dayjs) {
  return Math.max(1, b.startOf('day').diff(a.startOf('day'), 'day') + 1);
}

const now = dayjs();
const PRESETS: Record<string, () => DateRange> = {
  '7D': () => ({ from: now.startOf('day').subtract(6, 'day'), to: now.startOf('day') }),
  '30D': () => ({ from: now.startOf('day').subtract(29, 'day'), to: now.startOf('day') }),
  '90D': () => ({ from: now.startOf('day').subtract(89, 'day'), to: now.startOf('day') }),
  YTD: () => ({ from: now.startOf('year'), to: now.startOf('day') }),
};

// ----------------------------------
// Main component
// ----------------------------------
export default function OpsAnalyticsPage() {
  const { userEmail, role, doctorId: myDoctorId } = (useAuth() as any) || {};
  const isAdmin = Array.isArray(role) ? role.includes('admin') || role.includes('owner') : false;
  const [range, setRange] = useState<DateRange>(PRESETS['30D']());
  const [metric, setMetric] = useState<MetricKey>('driveMin');
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerIds, setProviderIds] = useState<string[]>([]);
  // All provider IDs (for admin default)
  const allProviderIds = useMemo(() => providers.map((p) => String(p.id)), [providers]);
  const [smoothWindow, setSmoothWindow] = useState<number>(7); // 1 = off
  const [normalize, setNormalize] = useState<boolean>(false);
  const [ignoreZeros, setIgnoreZeros] = useState<boolean>(true); // treat zeros as gaps

  // Are we currently on "ALL providers"?
  const isAllSelected =
    Array.isArray(allProviderIds) &&
    allProviderIds.length > 0 &&
    providerIds.length === allProviderIds.length &&
    providerIds.every((id) => allProviderIds.includes(id));

  /** Track previous selection to infer the clicked value on change */
  const prevProviderIdsRef = useRef<string[]>(providerIds);
  useEffect(() => {
    prevProviderIdsRef.current = providerIds;
  }, [providerIds]);

  /** Switch from ALL -> single on first user click; otherwise honor multi-select */
  const handleProvidersChange = (e: any) => {
    const next = e.target.value as string[]; // MUI multiple returns string[]
    const prev = prevProviderIdsRef.current;

    if (isAllSelected) {
      // Find the value the user actually clicked
      const removed = prev.find((id) => !next.includes(id));
      const added = next.find((id) => !prev.includes(id));
      const clicked = added ?? removed ?? next[0];
      setProviderIds(clicked ? [clicked] : next);
    } else {
      setProviderIds(next);
    }
  };
  const [series, setSeries] = useState<OpsStatPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    if (providers.length === 0) return;
    setProviderIds((prev) => (prev.length > 0 ? prev : providers.map((p) => String(p.id))));
  }, [isAdmin, providers]);

  const open = Boolean(anchorEl);

  // Load provider list for admin dropdown
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isAdmin) return;
      try {
        const list = await fetchPrimaryProviders();

        if (!alive) return;
        const arr = Array.isArray(list)
          ? list
          : Array.isArray((list as any)?.data)
            ? (list as any).data
            : Array.isArray((list as any)?.items)
              ? (list as any).items
              : [];
        setProviders(arr as Provider[]);
      } catch (e) {
        // silently ignore; admin can still type IDs via query param if needed
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  // Fetch series when filters change
  useEffect(() => {
    let alive = true;
    setUnauthorized(false);
    setLoading(true);
    // inside useEffect that calls fetchOpsStatsAnalytics
    (async () => {
      try {
        const params: any = {
          start: toISODate(range.from),
          end: toISODate(range.to),
          // Always an array if present
          providerIds: isAdmin
            ? providerIds.length
              ? providerIds
              : undefined // admin → possibly ALL or specific picks
            : myDoctorId
              ? [String(myDoctorId)]
              : undefined, // non-admin → themselves
        };

        const data = await fetchOpsStatsAnalytics(params);
        if (!alive) return;
        setSeries(data);
      } catch (err) {
        if (!alive) return;
        console.error('Ops analytics request failed:', err);
        setUnauthorized(true);
        setSeries([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [range.from, range.to, isAdmin, myDoctorId, JSON.stringify(providerIds)]);

  // Totals / avgs across selected date range
  const totals = useMemo(() => {
    const sum = (k: MetricKey) => series.reduce((s, p) => s + (Number(p[k]) || 0), 0);
    const len = series.length || 1;
    return {
      driveMin: sum('driveMin'),
      householdMin: sum('householdMin'),
      shiftMin: sum('shiftMin'),
      whiteMin: sum('whiteMin'),
      whitePctAvg: series.reduce((s, p) => s + (Number(p.whitePct) || 0), 0) / len,
      hdRatioAvg: series.reduce((s, p) => s + (Number(p.hdRatio) || 0), 0) / len,
      points: sum('points'),
      days: series.length,
    };
  }, [series]);

  if (unauthorized) {
    return (
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box p={3}>
          <Alert severity="error">Unauthorized</Alert>
        </Box>
      </LocalizationProvider>
    );
  }

  function movingAverage(values: (number | null)[], window: number) {
    if (window <= 1) return values;
    const out: (number | null)[] = Array(values.length).fill(null);
    let sum = 0;
    let count = 0;
    const queue: (number | null)[] = [];

    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      queue.push(v);
      if (v != null) {
        sum += v;
        count++;
      }
      if (queue.length > window) {
        const dropped = queue.shift();
        if (dropped != null) {
          sum -= dropped;
          count--;
        }
      }
      out[i] = count > 0 ? sum / count : null;
    }
    return out;
  }

  function minMaxNormalize(values: (number | null)[]) {
    let min = Infinity,
      max = -Infinity;
    for (const v of values) {
      if (v == null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || max === min) return values.map((v) => (v == null ? null : 1));
    return values.map((v) => (v == null ? null : (v - min) / (max - min)));
  }

  const chartData = useMemo(() => {
    // pull the active metric values in order
    const rawVals = series.map((p) => {
      const v = Number((p as any)[metric] ?? 0);
      // optionally treat 0s as gaps (helps when many days are zero)
      return ignoreZeros && v === 0 ? null : v;
    });

    // smooth (1 == off)
    const smoothed = movingAverage(rawVals, smoothWindow);

    // normalize (optional)
    const finalVals = normalize ? minMaxNormalize(smoothed) : smoothed;

    // recharts wants a number, use nulls + connectNulls to avoid spikes from gaps
    return series.map((p, i) => ({ ...p, value: finalVals[i] }));
  }, [series, metric, smoothWindow, normalize, ignoreZeros]);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {/* Header */}
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <Typography variant="h5" fontWeight={600}>
              Operations Analytics
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Trends for Drive, Households, H:D ratio, Whitespace, Shift, and Points.
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Box
              display="flex"
              justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
              gap={1}
              flexWrap="wrap"
            >
              {Object.keys(PRESETS).map((k) => (
                <Button
                  key={k}
                  variant="outlined"
                  size="small"
                  onClick={() => setRange(PRESETS[k]())}
                >
                  {k}
                </Button>
              ))}
              <Button
                variant="outlined"
                size="small"
                startIcon={<CalendarMonth />}
                onClick={(e) => setAnchorEl(e.currentTarget)}
              >
                {range.from.format('MMM D, YYYY')} – {range.to.format('MMM D, YYYY')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                title="Refresh"
                onClick={() => setRange({ ...range })}
              >
                <Refresh fontSize="small" />
              </Button>
            </Box>
          </Grid>
        </Grid>

        {/* Admin: provider picker */}
        {isAdmin ? (
          <Card variant="outlined">
            <CardHeader
              title="Providers"
              subheader="Choose one or more, or leave empty for ALL providers"
            />
            <CardContent>
              <FormControl fullWidth>
                <InputLabel id="providers-label">Providers</InputLabel>
                <Select
                  labelId="providers-label"
                  label="Providers"
                  multiple
                  value={providerIds}
                  onChange={handleProvidersChange}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((id) => {
                        const p = providers.find((pp) => String(pp.id) === String(id));
                        return <Chip key={id} label={p ? p.name : id} size="small" />;
                      })}
                    </Box>
                  )}
                >
                  {providers.map((p) => (
                    <MenuItem key={String(p.id)} value={String(p.id)}>
                      {p.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </CardContent>
          </Card>
        ) : (
          <Alert severity="info">Showing analytics for your schedule only.</Alert>
        )}

        {/* Summary cards */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Drive (total)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {totals.driveMin.toLocaleString()} min
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {totals.days} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Households (total)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {totals.householdMin.toLocaleString()} min
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {totals.days} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Whitespace avg"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {Math.round(totals.whitePctAvg)}%
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  avg of daily %
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="H:D ratio avg"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {totals.hdRatioAvg.toFixed(2)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  avg of daily ratios
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Shift (total)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {totals.shiftMin.toLocaleString()} min
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {totals.days} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Points (total)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {totals.points.toLocaleString()}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {totals.days} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Trend chart */}
        <Card variant="outlined">
          <CardHeader
            title="Trend"
            action={
              <Tabs value={metric} onChange={(_, v) => setMetric(v as MetricKey)}>
                {METRICS.map((m) => (
                  <Tab key={m.key} value={m.key} label={m.label} />
                ))}
              </Tabs>
            }
          />
          <CardContent>
            <Box height={340}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => dayjs(d).format('MM/DD')}
                    minTickGap={24}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) => {
                      if (normalize) return Number(v).toFixed(2); // 0..1
                      const m = METRICS.find((mm) => mm.key === metric);
                      if (!m) return String(v);
                      if (m.axis === 'pct') return `${Math.round(Number(v))}%`;
                      if (m.axis === 'ratio') return Number(v).toFixed(2);
                      return Math.round(Number(v)).toString();
                    }}
                    domain={normalize ? [0, 1] : ['auto', 'auto']}
                  />
                  <Tooltip
                    formatter={(value: number) => {
                      if (normalize) return Number(value).toFixed(2);
                      const m = METRICS.find((mm) => mm.key === metric);
                      if (!m) return value;
                      if (m.axis === 'pct') return `${Math.round(value)}%`;
                      if (m.axis === 'ratio') return Number(value).toFixed(2);
                      return Math.round(value).toLocaleString();
                    }}
                    labelFormatter={(l) => dayjs(l).format('ddd, MMM D, YYYY')}
                  />
                  {/* optional: faint raw line for context */}
                  {/* <Line yAxisId="left" type="monotone" dataKey={metric} strokeWidth={1} dot={false} opacity={0.2} /> */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="value"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>

            {/* simple controls */}
            <Box display="flex" gap={2} mt={2} alignItems="center" flexWrap="wrap">
              <FormControl size="small">
                <InputLabel id="ma-label">Smoothing</InputLabel>
                <Select
                  labelId="ma-label"
                  label="Smoothing"
                  value={smoothWindow}
                  onChange={(e) => setSmoothWindow(Number(e.target.value))}
                  sx={{ minWidth: 140 }}
                >
                  <MenuItem value={1}>Off</MenuItem>
                  <MenuItem value={3}>3-day MA</MenuItem>
                  <MenuItem value={7}>7-day MA</MenuItem>
                  <MenuItem value={14}>14-day MA</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small">
                <InputLabel id="norm-label">Scale</InputLabel>
                <Select
                  labelId="norm-label"
                  label="Scale"
                  value={normalize ? 'norm' : 'raw'}
                  onChange={(e) => setNormalize(e.target.value === 'norm')}
                  sx={{ minWidth: 140 }}
                >
                  <MenuItem value="raw">Raw</MenuItem>
                  <MenuItem value="norm">Normalized (0–1)</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small">
                <InputLabel id="zeros-label">Zeros</InputLabel>
                <Select
                  labelId="zeros-label"
                  label="Zeros"
                  value={ignoreZeros ? 'ignore' : 'keep'}
                  onChange={(e) => setIgnoreZeros(e.target.value === 'ignore')}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value="keep">Keep zeros</MenuItem>
                  <MenuItem value="ignore">Treat zeros as gaps</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </CardContent>
        </Card>

        {/* Small multiples (optional): compare 3 core metrics at once */}
        <Grid container spacing={2}>
          {(['driveMin', 'householdMin', 'whitePct'] as MetricKey[]).map((k) => (
            <Grid key={k} item xs={12} md={4}>
              <Card variant="outlined">
                <CardHeader title={METRICS.find((m) => m.key === k)?.label || k} />
                <CardContent>
                  <Box height={220}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={series} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(d) => dayjs(d).format('MM/DD')}
                          minTickGap={24}
                        />
                        <YAxis
                          tickFormatter={(v) =>
                            k === 'whitePct' ? `${Math.round(v)}%` : Math.round(v).toString()
                          }
                        />
                        <Tooltip
                          formatter={(value: number) =>
                            k === 'whitePct'
                              ? `${Math.round(value)}%`
                              : Math.round(value).toLocaleString()
                          }
                          labelFormatter={(l) => dayjs(l).format('MMM D, YYYY')}
                        />
                        <Line
                          type="monotone"
                          dataKey={k}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Date Range Popover */}
        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          PaperProps={{ sx: { p: 2, width: 420 } }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Stack spacing={1} flex={1}>
              <DatePicker
                label="Start date"
                value={range.from}
                onChange={(v) => v && setRange((r) => ({ ...r, from: v.startOf('day') }))}
              />
              <DatePicker
                label="End date"
                value={range.to}
                onChange={(v) => v && setRange((r) => ({ ...r, to: v.startOf('day') }))}
              />
            </Stack>
            <Divider flexItem orientation="vertical" />
            <Stack spacing={1} minWidth={180}>
              <Typography variant="subtitle2" color="text.secondary">
                Quick ranges
              </Typography>
              <Button variant="outlined" onClick={() => setRange(PRESETS['7D']())}>
                Last 7 days
              </Button>
              <Button variant="outlined" onClick={() => setRange(PRESETS['30D']())}>
                Last 30 days
              </Button>
              <Button variant="outlined" onClick={() => setRange(PRESETS['90D']())}>
                Last 90 days
              </Button>
              <Button variant="outlined" onClick={() => setRange(PRESETS['YTD']())}>
                Year to date
              </Button>
              <Box display="flex" gap={1} mt={1}>
                <Button fullWidth variant="contained" onClick={() => setAnchorEl(null)}>
                  Apply
                </Button>
                <Button fullWidth variant="outlined" onClick={() => setAnchorEl(null)}>
                  Cancel
                </Button>
              </Box>
            </Stack>
          </Stack>
        </Popover>
      </Box>
    </LocalizationProvider>
  );
}

// ----------------------------------
// Expected API contract (example)
// ----------------------------------
// export type OpsStatPoint = {
//   date: string;           // YYYY-MM-DD (local or UTC, but be consistent)
//   driveMin: number;       // total minutes driving for the day (include depot legs or whatever you show in header)
//   householdMin: number;   // total household service minutes for the day
//   shiftMin: number;       // total shift minutes for the day (scheduled or derived)
//   whiteMin: number;       // whitespace minutes for the day
//   whitePct: number;       // 0..100
//   hdRatio: number;        // householdMin / driveMin (Infinity-safe on backend -> large number)
//   points: number;         // points tally using same rules as header (euth=2, tech appt=0.5, else=1)
// };
//
// export async function fetchOpsStatsAnalytics(params: {
//   start: string;              // YYYY-MM-DD inclusive
//   end: string;                // YYYY-MM-DD inclusive
//   providerIds?: string[];     // if omitted/empty and caller is admin, treat as ALL providers
// }): Promise<OpsStatPoint[]> {
//   // Implement against your API
//   return fetch(`/api/analytics/ops?start=${params.start}&end=${params.end}&providerIds=${(params.providerIds||[]).join(',')}`)
//     .then((r) => {
//       if (!r.ok) throw new Error('Request failed');
//       return r.json();
//     });
// }
