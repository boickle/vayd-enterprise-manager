// src/pages/DoctorRevenueAnalytics.tsx
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
  Alert,
  Grid,
  Backdrop,
  CircularProgress,
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
} from 'recharts';

import { useAuth } from '../auth/useAuth';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchRevenueByDoctorForDay,
  type DoctorRevenueRow,
  fetchDoctorRevenueSeries,
} from '../api/opsStats';

dayjs.extend(utc);

// ---------- Types / utils ----------
type DateRange = { from: Dayjs; to: Dayjs };

function toISODate(d: Dayjs) {
  return d.utc().format('YYYY-MM-DD');
}
function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    Number(n) || 0
  );
}

const now = dayjs();
const PRESETS: Record<string, () => DateRange> = {
  '7D': () => ({ from: now.startOf('day').subtract(6, 'day'), to: now.startOf('day') }),
  '30D': () => ({ from: now.startOf('day').subtract(29, 'day'), to: now.startOf('day') }),
  '90D': () => ({ from: now.startOf('day').subtract(89, 'day'), to: now.startOf('day') }),
  YTD: () => ({ from: now.startOf('year'), to: now.startOf('day') }),
};

// ---------- Page ----------
export default function DoctorRevenueAnalyticsPage() {
  const { role, doctorId: myDoctorId } = (useAuth() as any) || {};
  const isAdmin = Array.isArray(role) ? role.includes('admin') || role.includes('owner') : false;

  // Filters
  const [range, setRange] = useState<DateRange>(PRESETS['30D']());
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  // Providers (single-select doctor for this page)
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(
    isAdmin ? null : myDoctorId ? String(myDoctorId) : null
  );
  const [providersLoading, setProvidersLoading] = useState(false);

  // Range series (line chart)
  const [series, setSeries] = useState<Array<{ date: string; total: number }>>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  // Per-day table
  const [revenueDate, setRevenueDate] = useState<string>(toISODate(range.to));
  const [rows, setRows] = useState<DoctorRevenueRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  useEffect(() => setRevenueDate(toISODate(range.to)), [range.to]);

  // Block the whole UI while anything is loading
  const blocking = providersLoading || seriesLoading || rowsLoading;

  // Provider name helper
  const selectedDoctorName = useMemo(() => {
    if (!selectedDoctorId) return null;
    const p = providers.find((pp) => String(pp.id) === selectedDoctorId);
    return p?.name ?? null;
  }, [providers, selectedDoctorId]);

  // ----- Load providers (admins only), default to first doctor -----
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isAdmin) return;
      try {
        setProvidersLoading(true);
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
        if (!selectedDoctorId && (arr as Provider[]).length) {
          setSelectedDoctorId(String((arr as Provider[])[0].id));
        }
      } catch {
        // ignore
      } finally {
        if (alive) setProvidersLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]); // selectedDoctorId intentionally not here

  // ----- Fetch RANGE revenue series via new endpoint -----
  useEffect(() => {
    let alive = true;
    (async () => {
      // For admins, require a doctor selection (endpoint is per-doctor)
      if (isAdmin && !selectedDoctorId) {
        setSeries([]);
        return;
      }

      setUnauthorized(false);
      setSeriesLoading(true);
      try {
        const resp = await fetchDoctorRevenueSeries({
          start: toISODate(range.from),
          end: toISODate(range.to),
          // Admins must pass doctorId; non-admins may omit (backend uses caller)
          doctorId: isAdmin ? selectedDoctorId! : undefined,
        });
        if (!alive) return;
        // Defensive sort
        const pts = (resp.series || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        setSeries(pts);
      } catch (err) {
        if (!alive) return;
        console.error('Doctor revenue series request failed:', err);
        setUnauthorized(true);
        setSeries([]);
      } finally {
        if (alive) setSeriesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range.from, range.to, isAdmin, selectedDoctorId]);

  // ----- Fetch per-day doctor breakdown (filters to the selected doctor) -----
  useEffect(() => {
    let alive = true;
    (async () => {
      // For admins, require a doctor selection
      if (isAdmin && !selectedDoctorId) {
        setRows([]);
        return;
      }

      setRowsLoading(true);
      try {
        const params: any = { date: revenueDate };
        if (isAdmin && selectedDoctorId) {
          params.providerIds = [selectedDoctorId];
        }
        // Non-admin: backend uses caller's doctor; no need to pass providerIds

        const list = await fetchRevenueByDoctorForDay(params);
        if (!alive) return;
        // This will typically be a single row for the selected doctor
        setRows(
          (list || [])
            .slice()
            .sort((a, b) => Number(b.totalServiceValue || 0) - Number(a.totalServiceValue || 0))
        );
      } catch (e) {
        if (!alive) return;
        console.error('Revenue by doctor (day) failed:', e);
        setRows([]);
      } finally {
        if (alive) setRowsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [revenueDate, isAdmin, selectedDoctorId]);

  // ----- Totals for header cards -----
  const totals = useMemo(() => {
    const revenue = series.reduce((s, p) => s + (Number(p.total) || 0), 0);
    const days = series.length;
    return {
      revenue,
      days,
      avgPerDay: days ? revenue / days : 0,
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

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      {/* Global loading overlay */}
      <Backdrop open={blocking} sx={{ color: '#fff', zIndex: (t) => t.zIndex.modal + 1 }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress color="inherit" />
          <Typography variant="body2">Loading revenue…</Typography>
        </Stack>
      </Backdrop>

      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {/* Header */}
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <Typography variant="h5" fontWeight={600}>
              Doctor Revenue Analytics
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Explore a single doctor’s revenue over any date range.
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

        {/* Admin: single-doctor picker */}
        {isAdmin ? (
          <Card variant="outlined">
            <CardHeader
              title="Doctor"
              subheader="Pick a single doctor to view their revenue series"
            />
            <CardContent>
              <FormControl fullWidth>
                <InputLabel id="doctor-label">Doctor</InputLabel>
                <Select
                  labelId="doctor-label"
                  label="Doctor"
                  value={selectedDoctorId ?? ''}
                  onChange={(e) => setSelectedDoctorId(String(e.target.value))}
                >
                  {providers.map((p) => (
                    <MenuItem key={String(p.id)} value={String(p.id)}>
                      {p.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {!selectedDoctorId && (
                <Alert sx={{ mt: 2 }} severity="info">
                  Select a doctor to load data.
                </Alert>
              )}
            </CardContent>
          </Card>
        ) : (
          <Alert severity="info">Showing revenue for your production only.</Alert>
        )}

        {/* Summary cards */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Total Revenue (range)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.revenue)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {totals.days} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Daily Avg (range)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.avgPerDay)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  avg revenue / day
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Revenue trend (per-doctor) */}
        <Card variant="outlined">
          <CardHeader
            title={
              selectedDoctorName
                ? `Revenue Trend — ${selectedDoctorName}`
                : 'Revenue Trend — (select a doctor)'
            }
          />
          <CardContent>
            <Box height={340}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => dayjs(d).format('MM/DD')}
                    minTickGap={24}
                  />
                  <YAxis tickFormatter={(v) => fmtUSD(Number(v) || 0)} />
                  <Tooltip
                    formatter={(value: number) => fmtUSD(value)}
                    labelFormatter={(l) => dayjs(l).format('ddd, MMM D, YYYY')}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>

        {/* Per-day table (shows the selected doctor's row for that day) */}
        <Card variant="outlined">
          <CardHeader
            title={
              selectedDoctorName
                ? `Revenue on ${dayjs(revenueDate).format('MMM D, YYYY')} — ${selectedDoctorName}`
                : `Revenue on ${dayjs(revenueDate).format('MMM D, YYYY')}`
            }
            subheader={
              isAdmin
                ? selectedDoctorId
                  ? 'Single doctor'
                  : 'Select a doctor to view'
                : 'Your revenue only'
            }
          />
          <CardContent>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" mb={2}>
              <DatePicker
                label="Pick a day"
                value={dayjs(revenueDate)}
                onChange={(v) => v && setRevenueDate(toISODate(v.startOf('day')))}
                slotProps={{ textField: { size: 'small' } }}
              />
              <Typography variant="subtitle2" color="text.secondary" sx={{ ml: 'auto' }}>
                {rowsLoading ? 'Loading…' : `${rows.length} row(s)`}
              </Typography>
              <Typography variant="h6" fontWeight={700}>
                Total: {fmtUSD(rows.reduce((s, r) => s + Number(r.totalServiceValue || 0), 0))}
              </Typography>
            </Box>

            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Doctor</th>
                    <th style={{ textAlign: 'right', padding: '8px' }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && !rowsLoading ? (
                    <tr>
                      <td
                        colSpan={2}
                        style={{ padding: '12px', color: 'var(--mui-palette-text-secondary)' }}
                      >
                        No revenue data for this day.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, i) => (
                      <tr
                        key={`${r.doctorId ?? 'none'}-${i}`}
                        style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}
                      >
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                          {r.doctorName ?? 'Not Specified'}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>
                          {fmtUSD(r.totalServiceValue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Box>
          </CardContent>
        </Card>

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
