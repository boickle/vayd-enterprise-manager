import React, { useEffect, useMemo, useState } from 'react';
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
} from 'recharts';
import { fetchPaymentsAnalytics, type PaymentPoint } from '../api/payments';

dayjs.extend(utc);

// ----------------------------------
// Types
// ----------------------------------
export type DateRange = {
  from: Dayjs;
  to: Dayjs;
};

// ----------------------------------
// Utilities
// ----------------------------------
function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}
function toISODate(d: Dayjs) {
  return d.utc().format('YYYY-MM-DD');
}
function daysBetween(a: Dayjs, b: Dayjs) {
  return Math.max(1, b.startOf('day').diff(a.startOf('day'), 'day') + 1);
}

// (optional) Mock – now unused but keep if you want a dev toggle
function generateMock(range: DateRange): PaymentPoint[] {
  const len = daysBetween(range.from, range.to);
  const base = Math.max(10, Math.round(200 - len));
  return Array.from({ length: len }).map((_, i) => {
    const day = range.from.startOf('day').add(i, 'day');
    const noise = (Math.sin(i / 3) + Math.cos(i / 5)) * 15 + (Math.random() - 0.5) * 20;
    const count = Math.max(0, Math.round(base / 10 + noise / 10));
    const revenue = Math.max(0, Math.round(base * 50 + noise * 20 + Math.random() * 150));
    return { date: toISODate(day), revenue, count };
  });
}

// Presets
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
export default function PaymentsAnalyticsPage() {
  const [range, setRange] = useState<DateRange>(PRESETS['30D']());
  const [series, setSeries] = useState<PaymentPoint[]>([]);
  const [metric, setMetric] = useState<'revenue' | 'count'>('revenue');
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const open = Boolean(anchorEl);

  useEffect(() => {
    let alive = true;
    setUnauthorized(false); // reset before fetching
    (async () => {
      try {
        const data = await fetchPaymentsAnalytics({
          start: toISODate(range.from),
          end: toISODate(range.to),
          // practiceId: 'your-id-here',
        });
        if (!alive) return;
        setSeries(data);
      } catch (err) {
        if (!alive) return;
        console.error('Payments analytics request failed:', err);
        setUnauthorized(true); // ← show unauthorized for any non-200
        setSeries([]); // clear data
      }
    })();
    return () => {
      alive = false;
    };
  }, [range.from, range.to]);

  const totals = useMemo(() => {
    const revenue = series.reduce((s, p) => s + p.revenue, 0);
    const count = series.reduce((s, p) => s + p.count, 0);
    const avg = series.length ? revenue / series.length : 0;
    return { revenue, count, avg };
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
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {/* Header */}
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <Typography variant="h5" fontWeight={600}>
              Payments Analytics
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Interactive trends and summaries.
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

        {/* Summary cards */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Total Revenue"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.revenue)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {series.length} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Payments"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {totals.count.toLocaleString()}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {series.length} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Daily Avg"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.avg)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  avg revenue / day
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Chart */}
        <Card variant="outlined">
          <CardHeader
            title="Trend"
            action={
              <Tabs value={metric} onChange={(_, v) => setMetric(v as 'revenue' | 'count')}>
                <Tab value="revenue" label="Revenue" />
                <Tab value="count" label="Count" />
              </Tabs>
            }
          />
          <CardContent>
            <Box height={320}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => dayjs(d).format('MM/DD')}
                    minTickGap={24}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) =>
                      metric === 'revenue' ? fmtUSD(v) : Math.round(v).toString()
                    }
                  />
                  <Tooltip
                    formatter={(value: number) =>
                      metric === 'revenue' ? fmtUSD(value) : value.toLocaleString()
                    }
                    labelFormatter={(l) => dayjs(l).format('ddd, MMM D, YYYY')}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey={metric}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>

        {/* Table */}
        <Card variant="outlined">
          <CardHeader title="Daily Breakdown" />
          <CardContent>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Revenue</th>
                    <th style={{ textAlign: 'left', padding: '8px' }}>Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((p) => (
                    <tr key={p.date} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                        {dayjs(p.date).format('MMM D, YYYY')}
                      </td>
                      <td style={{ padding: '8px' }}>{fmtUSD(p.revenue)}</td>
                      <td style={{ padding: '8px' }}>{p.count.toLocaleString()}</td>
                    </tr>
                  ))}
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
