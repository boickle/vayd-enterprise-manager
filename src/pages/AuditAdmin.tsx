import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Typography,
  Button,
  Grid,
  Backdrop,
  CircularProgress,
  Stack,
  Divider,
  Popover,
} from '@mui/material';
import { CalendarMonth, Refresh } from '@mui/icons-material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
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
import { fetchAuditDailySeries } from '../api/audit';

type DateRange = { from: Dayjs; to: Dayjs };

// ===== helpers =====
const todayStart = () => dayjs().startOf('day');
const presetsNow = () => {
  const now = todayStart();
  return {
    '7D': { from: now.subtract(6, 'day'), to: now },
    '30D': { from: now.subtract(29, 'day'), to: now },
    '90D': { from: now.subtract(89, 'day'), to: now },
    YTD: { from: dayjs().startOf('year'), to: now },
  } as const;
};
const fmtLocalISO = (d: Dayjs) => d.format('YYYY-MM-DD');
const toISODateExclusiveEnd = (d: Dayjs) => d.add(1, 'day').format('YYYY-MM-DD');

const fmtTick = (d: string) => dayjs(d).format('MM/DD');
const fmtLabel = (d: string) => dayjs(d).format('ddd, MMM D, YYYY');

export default function AuditUsage() {
  const { role } = (useAuth() as any) || {};
  const isAdmin = Array.isArray(role)
    ? role.some((r) => ['admin', 'owner', 'superadmin'].includes(r))
    : false;

  const [range, setRange] = useState<DateRange>(presetsNow()['30D']);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const openRange = Boolean(anchorEl);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Array<{ day: string; requests: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  const startISO = fmtLocalISO(range.from);
  const endISO = toISODateExclusiveEnd(range.to); // exclusive end

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchAuditDailySeries({ start: startISO, end: endISO });
        if (!alive) return;

        // Accepts either an array or {days: [...]}
        const series: any[] = Array.isArray(data) ? data : (data?.days ?? []);

        // 🔑 Normalize ISO timestamps ("2025-10-22T04:00:00.000Z") to local YYYY-MM-DD
        const mapped = series
          .filter((d) => d && d.date != null)
          .map((d) => ({
            day: dayjs(String(d.date)).format('YYYY-MM-DD'),
            requests: Number(d.requests) || 0,
          }));

        setRows(mapped);
      } catch (e: any) {
        console.error('fetchAuditDailySeries failed', e);
        setRows([]);
        setError(e?.message || 'Failed to load');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [startISO, endISO]);

  const points = rows.length;
  const totalRequests = useMemo(
    () => rows.reduce((sum, r) => sum + (Number.isFinite(r.requests) ? r.requests : 0), 0),
    [rows]
  );

  if (!isAdmin) {
    return (
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box p={3}>
          <Typography color="error">You need admin privileges to view usage.</Typography>
        </Box>
      </LocalizationProvider>
    );
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Backdrop open={loading} sx={{ color: '#fff', zIndex: (t) => t.zIndex.modal + 1 }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress color="inherit" />
          <Typography variant="body2">Loading usage…</Typography>
        </Stack>
      </Backdrop>

      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {/* Header / controls */}
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={7}>
            <Typography variant="h5" fontWeight={600}>
              System Usage
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Requests per day (adjust the range).
            </Typography>
          </Grid>
          <Grid item xs={12} md={5}>
            <Box
              display="flex"
              justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
              gap={1}
              flexWrap="wrap"
            >
              {Object.entries(presetsNow()).map(([k, v]) => (
                <Button key={k} variant="outlined" size="small" onClick={() => setRange(v)}>
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

        {/* Debug strip */}
        <Card variant="outlined">
          <CardContent>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <Typography variant="body2" color="text.secondary">
                Window: <b>{startISO}</b> → <b>{endISO}</b> <em>(end exclusive)</em>
              </Typography>
              <Divider flexItem orientation="vertical" />
              <Typography variant="body2" color="text.secondary">
                Points: <b>{points}</b>
              </Typography>
              <Divider flexItem orientation="vertical" />
              <Typography variant="body2" color="text.secondary">
                Total requests: <b>{totalRequests.toLocaleString()}</b>
              </Typography>
              {error && (
                <>
                  <Divider flexItem orientation="vertical" />
                  <Typography variant="body2" color="error">
                    Error: {error}
                  </Typography>
                </>
              )}
            </Box>
          </CardContent>
        </Card>

        {/* Chart */}
        <Card variant="outlined">
          <CardHeader title="Requests per Day" />
          <CardContent>
            <Box sx={{ width: '100%', height: 360, minHeight: 360 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickFormatter={fmtTick} minTickGap={24} />
                  <YAxis />
                  <Tooltip
                    formatter={(v: number) => (typeof v === 'number' ? v.toLocaleString() : v)}
                    labelFormatter={fmtLabel}
                  />
                  <Line type="monotone" dataKey="requests" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>

        {/* Date range popover */}
        <Popover
          open={openRange}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          PaperProps={{ sx: { p: 2, width: 420 } }}
        >
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <DatePicker
                label="Start date"
                value={range.from}
                onChange={(v) => v && setRange((r) => ({ ...r, from: v.startOf('day') }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <DatePicker
                label="End date"
                value={range.to}
                onChange={(v) => v && setRange((r) => ({ ...r, to: v.startOf('day') }))}
              />
            </Grid>
            <Grid item xs={12}>
              <Box display="flex" gap={1} justifyContent="flex-end">
                <Button variant="contained" onClick={() => setAnchorEl(null)}>
                  Apply
                </Button>
                <Button variant="outlined" onClick={() => setAnchorEl(null)}>
                  Cancel
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Popover>
      </Box>
    </LocalizationProvider>
  );
}
