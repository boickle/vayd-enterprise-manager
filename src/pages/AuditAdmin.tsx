// src/pages/AuditAdmin.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Typography,
  Button,
  Popover,
  Stack,
  Divider,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  TextField,
  Alert,
  Grid,
  Backdrop,
  CircularProgress,
  Chip,
} from '@mui/material';
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
  BarChart,
  Bar,
} from 'recharts';

import { useAuth } from '../auth/useAuth';
import {
  fetchAuditSummary,
  fetchAuditDailySeries,
  fetchAuditTopUsers,
  fetchAuditTopEndpoints,
  fetchAuditHeatmap,
  fetchAuditRecentErrors,
  fetchAuditSlowRequests,
  type AuditSummary,
  type AuditDailySeries,
  type AuditTopUser,
  type AuditTopEndpoint,
  type AuditHeatmap,
  type AuditEventRow,
} from '../api/audit';

dayjs.extend(utc);

// ---------- Types / utils ----------
type DateRange = { from: Dayjs; to: Dayjs };

const now = dayjs();
const PRESETS: Record<string, () => DateRange> = {
  '7D': () => ({ from: now.startOf('day').subtract(6, 'day'), to: now.startOf('day') }),
  '30D': () => ({ from: now.startOf('day').subtract(29, 'day'), to: now.startOf('day') }),
  '90D': () => ({ from: now.startOf('day').subtract(89, 'day'), to: now.startOf('day') }),
  YTD: () => ({ from: now.startOf('year'), to: now.startOf('day') }),
};

const toISODate = (d: Dayjs) => d.utc().format('YYYY-MM-DD');
const n = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const fmtMs = (ms?: number | null) => `${Math.round(Number(ms ?? 0)).toLocaleString()} ms`;
const fmtPct = (p?: number | null) => `${Math.round((Number(p) || 0) * 100)}%`;

// ---------- Page ----------
export default function AuditAdminPage() {
  const { role } = (useAuth() as any) || {};
  const isAdmin = Array.isArray(role)
    ? role.includes('admin') || role.includes('owner') || role.includes('superadmin')
    : false;

  // Filters
  const [range, setRange] = useState<DateRange>(PRESETS['30D']());
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const openRange = Boolean(anchorEl);

  // Optional filters for top lists
  const [httpMethod, setHttpMethod] = useState<string>('ALL');
  const [pathPrefix, setPathPrefix] = useState<string>('');
  const [topLimit, setTopLimit] = useState<number>(10);
  const [minSlowMs, setMinSlowMs] = useState<number>(1500);

  // Data
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [series, setSeries] = useState<AuditDailySeries | null>(null);
  const [heatmap, setHeatmap] = useState<AuditHeatmap | null>(null);
  const [topUsers, setTopUsers] = useState<AuditTopUser[]>([]);
  const [topEndpoints, setTopEndpoints] = useState<AuditTopEndpoint[]>([]);
  const [recentErrors, setRecentErrors] = useState<AuditEventRow[]>([]);
  const [slowRequests, setSlowRequests] = useState<AuditEventRow[]>([]);

  // Loading
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [loadingHeatmap, setLoadingHeatmap] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const blocking =
    loadingSummary ||
    loadingSeries ||
    loadingHeatmap ||
    loadingUsers ||
    loadingEndpoints ||
    loadingErrors ||
    loadingSlow;

  // Unauthorized guard (frontend hint; backend already protects)
  if (!isAdmin) {
    return (
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box p={3}>
          <Alert severity="error">You need admin privileges to view audit analytics.</Alert>
        </Box>
      </LocalizationProvider>
    );
  }

  const startISO = toISODate(range.from);
  const endISO = toISODate(range.to);
  const methodFilter = httpMethod === 'ALL' ? undefined : httpMethod;
  const pathFilter = pathPrefix?.trim() ? pathPrefix.trim() : undefined;

  // Fetch: Summary, Daily Series, Heatmap
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingSummary(true);
        const s = await fetchAuditSummary({ start: startISO, end: endISO });
        if (!alive) return;
        setSummary(s);
      } finally {
        if (alive) setLoadingSummary(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [startISO, endISO]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingSeries(true);
        const d = await fetchAuditDailySeries({ start: startISO, end: endISO });
        if (!alive) return;
        setSeries(d);
      } finally {
        if (alive) setLoadingSeries(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [startISO, endISO]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingHeatmap(true);
        const h = await fetchAuditHeatmap({ start: startISO, end: endISO });
        if (!alive) return;
        setHeatmap(h);
      } finally {
        if (alive) setLoadingHeatmap(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [startISO, endISO]);

  // Fetch: Top Users / Endpoints (with filters)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingUsers(true);
        const rows = await fetchAuditTopUsers({
          start: startISO,
          end: endISO,
          limit: topLimit,
          method: methodFilter,
          pathPrefix: pathFilter,
        });
        if (!alive) return;
        setTopUsers(rows);
      } finally {
        if (alive) setLoadingUsers(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startISO, endISO, topLimit, httpMethod, pathPrefix]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingEndpoints(true);
        const rows = await fetchAuditTopEndpoints({
          start: startISO,
          end: endISO,
          limit: topLimit,
          method: methodFilter,
          pathPrefix: pathFilter,
        });
        if (!alive) return;
        setTopEndpoints(rows);
      } finally {
        if (alive) setLoadingEndpoints(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startISO, endISO, topLimit, httpMethod, pathPrefix]);

  // Fetch: Error and Slow lists
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingErrors(true);
        const rows = await fetchAuditRecentErrors({ start: startISO, end: endISO, limit: 25 });
        if (!alive) return;
        setRecentErrors(rows);
      } finally {
        if (alive) setLoadingErrors(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [startISO, endISO]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingSlow(true);
        const rows = await fetchAuditSlowRequests({
          start: startISO,
          end: endISO,
          minDurationMs: minSlowMs,
          limit: 25,
        });
        if (!alive) return;
        setSlowRequests(rows);
      } finally {
        if (alive) setLoadingSlow(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [startISO, endISO, minSlowMs]);

  // Derived
  const lineSeries = useMemo(() => {
    const days = series?.days ?? [];
    return days.map((d) => ({
      date: d.date,
      requests: n(d.requests),
      errors: n(d.errors),
      avgDurationMs: n(d.avgDurationMs),
    }));
  }, [series]);

  const maxHeatCount = useMemo(() => {
    const cells = heatmap?.cells ?? [];
    return cells.reduce((m, c) => Math.max(m, n(c.count)), 0);
  }, [heatmap]);

  // Heatmap color helper (0..1 → rgba primary w/ alpha)
  const cellBg = (count: number) => {
    if (!maxHeatCount) return 'rgba(0,0,0,0.04)';
    const alpha = Math.min(1, Math.max(0.06, count / maxHeatCount)); // ensure visible
    return `rgba(25, 118, 210, ${alpha})`; // MUI primary[700] base color w/ alpha
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      {/* Global loading overlay */}
      <Backdrop open={blocking} sx={{ color: '#fff', zIndex: (t) => t.zIndex.modal + 1 }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress color="inherit" />
          <Typography variant="body2">Loading audit analytics…</Typography>
        </Stack>
      </Backdrop>

      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {/* Header */}
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={7}>
            <Typography variant="h5" fontWeight={600}>
              Audit Analytics (Super Admin)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Traffic, errors, performance, and usage patterns across your application.
            </Typography>
          </Grid>
          <Grid item xs={12} md={5}>
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

        {/* Summary */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Total Requests"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {summary ? summary.totalRequests.toLocaleString() : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {startISO} → {endISO}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Distinct Users"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {summary ? summary.distinctUsers.toLocaleString() : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  by userId
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Errors"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {summary ? summary.errorCount.toLocaleString() : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  status ≥ 400
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Avg Duration"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {summary ? fmtMs(summary.avgDurationMs) : '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  mean across period
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Daily trend */}
        <Card variant="outlined">
          <CardHeader title="Daily Requests & Errors" />
          <CardContent>
            <Box height={320}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={lineSeries} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => dayjs(d).format('MM/DD')}
                    minTickGap={24}
                  />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip
                    formatter={(value: number, key) =>
                      key === 'avgDurationMs' ? fmtMs(value) : value.toLocaleString()
                    }
                    labelFormatter={(l) => dayjs(l).format('ddd, MMM D, YYYY')}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="requests"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="errors"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avgDurationMs"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>

        {/* Filters for top lists */}
        <Card variant="outlined">
          <CardHeader title="Filters" />
          <CardContent>
            <Box display="flex" gap={2} flexWrap="wrap">
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel id="http-method-label">HTTP Method</InputLabel>
                <Select
                  labelId="http-method-label"
                  label="HTTP Method"
                  value={httpMethod}
                  onChange={(e) => setHttpMethod(String(e.target.value))}
                >
                  {['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                    <MenuItem key={m} value={m}>
                      {m}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                label="Path starts with"
                placeholder="/api/"
                value={pathPrefix}
                onChange={(e) => setPathPrefix(e.target.value)}
              />
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel id="top-limit-label">Top limit</InputLabel>
                <Select
                  labelId="top-limit-label"
                  label="Top limit"
                  value={topLimit}
                  onChange={(e) => setTopLimit(Number(e.target.value))}
                >
                  {[5, 10, 20, 50].map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                label="Slow threshold (ms)"
                type="number"
                value={minSlowMs}
                onChange={(e) => setMinSlowMs(Math.max(0, Number(e.target.value)))}
                sx={{ width: 200, marginLeft: 'auto' }}
              />
            </Box>
          </CardContent>
        </Card>

        {/* Top Endpoints & Top Users */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={7}>
            <Card variant="outlined">
              <CardHeader title="Top Endpoints" subheader="By request count" />
              <CardContent>
                <Box height={320}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={topEndpoints.map((r) => ({ ...r, label: r.path }))}
                      margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tickFormatter={(s) =>
                          String(s).length > 16 ? `${String(s).slice(0, 16)}…` : s
                        }
                      />
                      <YAxis />
                      <Tooltip
                        formatter={(v: number, k: string, p) => {
                          if (k === 'avgDurationMs') return fmtMs(v);
                          if (k === 'errorRate') return fmtPct(v);
                          return v.toLocaleString();
                        }}
                        labelFormatter={(l) => String(l)}
                      />
                      <Bar dataKey="count" name="Requests" />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
                <Box sx={{ overflowX: 'auto', mt: 2 }}>
                  <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                        <th style={{ textAlign: 'left', padding: 8 }}>Path</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Requests</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Users</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Avg. Duration</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Error Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topEndpoints.map((r, i) => (
                        <tr
                          key={`${r.path}-${i}`}
                          style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}
                        >
                          <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                            <Chip size="small" label={r.path} />
                          </td>
                          <td style={{ padding: 8, textAlign: 'right' }}>
                            {r.count.toLocaleString()}
                          </td>
                          <td style={{ padding: 8, textAlign: 'right' }}>
                            {r.uniqueUsers.toLocaleString()}
                          </td>
                          <td style={{ padding: 8, textAlign: 'right' }}>
                            {fmtMs(r.avgDurationMs)}
                          </td>
                          <td style={{ padding: 8, textAlign: 'right' }}>{fmtPct(r.errorRate)}</td>
                        </tr>
                      ))}
                      {topEndpoints.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ padding: 8 }}>
                            No data
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={5}>
            <Card variant="outlined">
              <CardHeader title="Top Users" subheader="By requests" />
              <CardContent>
                <Box sx={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                        <th style={{ textAlign: 'left', padding: 8 }}>User</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Requests</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Errors</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Avg. Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topUsers.map((u, i) => (
                        <tr
                          key={`${u.userId ?? 'null'}-${i}`}
                          style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}
                        >
                          <td style={{ padding: 8 }}>
                            {u.userId ? (
                              <Chip size="small" label={u.userId} />
                            ) : (
                              <em>Anonymous/Null</em>
                            )}
                          </td>
                          <td style={{ padding: 8, textAlign: 'right' }}>
                            {u.count.toLocaleString()}
                          </td>
                          <td style={{ padding: 8, textAlign: 'right' }}>
                            {u.errorCount.toLocaleString()}
                          </td>
                          <td style={{ padding: 8, textAlign: 'right' }}>
                            {fmtMs(u.avgDurationMs)}
                          </td>
                        </tr>
                      ))}
                      {topUsers.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ padding: 8 }}>
                            No data
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Weekly/hourly Heatmap */}
        <Card variant="outlined">
          <CardHeader title="Activity Heatmap" subheader="Requests by weekday × hour" />
          <CardContent>
            <Box sx={{ overflowX: 'auto' }}>
              <Grid container columns={25} spacing={0} sx={{ minWidth: 680 }}>
                {/* Header row */}
                <Grid item xs={1} />
                {Array.from({ length: 24 }).map((_, h) => (
                  <Grid key={`h-${h}`} item xs={1}>
                    <Box
                      sx={{
                        textAlign: 'center',
                        fontSize: 12,
                        color: 'text.secondary',
                        py: 0.5,
                      }}
                    >
                      {h}
                    </Box>
                  </Grid>
                ))}
                {/* Rows */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w, wi) => (
                  <React.Fragment key={`w-${wi}`}>
                    <Grid item xs={1}>
                      <Box sx={{ fontSize: 12, color: 'text.secondary', py: 0.5 }}>{w}</Box>
                    </Grid>
                    {Array.from({ length: 24 }).map((_, h) => {
                      const count =
                        heatmap?.cells.find((c) => c.weekday === wi && c.hour === h)?.count || 0;
                      return (
                        <Grid key={`c-${wi}-${h}`} item xs={1}>
                          <Box
                            sx={{
                              height: 22,
                              borderRadius: 0.5,
                              background: cellBg(count),
                            }}
                            title={`${w} ${h}:00 — ${count.toLocaleString()} requests`}
                          />
                        </Grid>
                      );
                    })}
                  </React.Fragment>
                ))}
              </Grid>
            </Box>
          </CardContent>
        </Card>

        {/* Recent Errors & Slow Requests */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Card variant="outlined">
              <CardHeader title="Recent Errors" subheader="Latest error responses within range" />
              <CardContent>
                <Box sx={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                        <th style={{ textAlign: 'left', padding: 8 }}>When</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Method</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Path</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Status</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Duration</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentErrors.map((r, i) => (
                        <tr
                          key={`${r.occurredAt}-${i}`}
                          style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}
                        >
                          <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                            {dayjs(r.occurredAt).format('MMM D, HH:mm:ss')}
                          </td>
                          <td style={{ padding: 8 }}>{r.method}</td>
                          <td style={{ padding: 8 }}>{r.path}</td>
                          <td style={{ padding: 8, textAlign: 'right' }}>{r.statusCode ?? '-'}</td>
                          <td style={{ padding: 8, textAlign: 'right' }}>{fmtMs(r.durationMs)}</td>
                          <td style={{ padding: 8 }}>{r.userId ?? <em>—</em>}</td>
                        </tr>
                      ))}
                      {recentErrors.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ padding: 8 }}>
                            No errors
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card variant="outlined">
              <CardHeader title="Slow Requests" subheader={`≥ ${minSlowMs.toLocaleString()} ms`} />
              <CardContent>
                <Box sx={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                        <th style={{ textAlign: 'left', padding: 8 }}>When</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Method</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Path</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Status</th>
                        <th style={{ textAlign: 'right', padding: 8 }}>Duration</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slowRequests.map((r, i) => (
                        <tr
                          key={`${r.occurredAt}-${i}`}
                          style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}
                        >
                          <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                            {dayjs(r.occurredAt).format('MMM D, HH:mm:ss')}
                          </td>
                          <td style={{ padding: 8 }}>{r.method}</td>
                          <td style={{ padding: 8 }}>{r.path}</td>
                          <td style={{ padding: 8, textAlign: 'right' }}>{r.statusCode ?? '-'}</td>
                          <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>
                            {fmtMs(r.durationMs)}
                          </td>
                          <td style={{ padding: 8 }}>{r.userId ?? <em>—</em>}</td>
                        </tr>
                      ))}
                      {slowRequests.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ padding: 8 }}>
                            No slow requests
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Date Range Popover */}
        <Popover
          open={openRange}
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
