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
  CircularProgress,
  FormControlLabel,
  Checkbox,
  FormGroup,
} from '@mui/material';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import { CalendarMonth, ChevronLeft, ChevronRight, CheckCircle, Refresh, Warning } from '@mui/icons-material';
import IconButton from '@mui/material/IconButton';
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
import {
  fetchPaymentsAnalytics,
  fetchPaymentsLeaderboards,
  fetchPaymentsReconciliation,
  fetchSquarePayments,
  fetchStripeRevenue,
  filterSquarePaymentsForDay,
  sumCreditCardPaymentsForDay,
  sumSquarePayments,
  type PaymentPoint,
  type PaymentsLeaderboardEntry,
  type PaymentsLeaderboards,
} from '../api/payments';
import DayPaymentsListModal from '../components/DayPaymentsListModal';
import SquareDayReconciliationModal from '../components/SquareDayReconciliationModal';
import TodaysPaymentsDetailModal from '../components/TodaysPaymentsDetailModal';

dayjs.extend(utc);

// ----------------------------------
// Types
// ----------------------------------
export type DateRange = {
  from: Dayjs;
  to: Dayjs;
};

type ChartLineKey =
  | 'practiceRevenue'
  | 'onlinePharmacyRevenue'
  | 'subscriptionRevenue'
  | 'totalRevenue'
  | 'trend';

const defaultChartLineVisibility: Record<ChartLineKey, boolean> = {
  practiceRevenue: true,
  onlinePharmacyRevenue: true,
  subscriptionRevenue: true,
  totalRevenue: true,
  trend: true,
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
const dayKeyUTC = (d: string | Date | dayjs.Dayjs) => dayjs.utc(d).format('YYYY-MM-DD');
function findPaymentPointForDay(points: PaymentPoint[], localDayKey: string): PaymentPoint | null {
  const utcKey = dayjs(localDayKey).utc().format('YYYY-MM-DD');
  const matches = (p: PaymentPoint) =>
    p.date === localDayKey || p.date === utcKey || dayKeyUTC(p.date) === utcKey;
  return points.find(matches) ?? null;
}

/** Linear regression trend for total revenue series. */
function addLinearTrend<T extends { totalRevenue: number }>(data: T[]): (T & { trend: number })[] {
  if (!data.length) return [];
  const n = data.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = Number(data[i]?.totalRevenue ?? 0);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const slope =
    n * sumXX - sumX * sumX !== 0 ? (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX) : 0;
  const intercept = sumY / n - slope * (sumX / n);
  return data.map((row, i) => ({ ...row, trend: Math.max(0, intercept + slope * i) }));
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
  const [range, setRange] = useState<DateRange>(PRESETS['7D']());
  const [series, setSeries] = useState<PaymentPoint[]>([]);
  const [leaderboards, setLeaderboards] = useState<PaymentsLeaderboards | null>(null);
  const [leaderboardsLoading, setLeaderboardsLoading] = useState(true);
  /** Single-day analytics when the selected revenue day is outside the chart range. */
  const [revenueDayOverride, setRevenueDayOverride] = useState<PaymentPoint | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chartLineVisible, setChartLineVisible] =
    useState<Record<ChartLineKey, boolean>>(defaultChartLineVisibility);
  const [paymentsDetailOpen, setPaymentsDetailOpen] = useState(false);
  const [paymentsListOpen, setPaymentsListOpen] = useState(false);
  const [squareReconcileOpen, setSquareReconcileOpen] = useState(false);
  const [revenueDay, setRevenueDay] = useState<Dayjs>(() => dayjs().startOf('day'));
  const [squareLoading, setSquareLoading] = useState(false);
  const [squareError, setSquareError] = useState<string | null>(null);
  const [squareTotal, setSquareTotal] = useState(0);
  const [squareCount, setSquareCount] = useState(0);
  const [squareCardTotal, setSquareCardTotal] = useState(0);
  const [squareCardCount, setSquareCardCount] = useState(0);
  const [oursCardTotal, setOursCardTotal] = useState(0);
  const [oursCardCount, setOursCardCount] = useState(0);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [stripeTotal, setStripeTotal] = useState(0);
  const [stripeCount, setStripeCount] = useState(0);
  const open = Boolean(anchorEl);

  const today = dayjs().startOf('day');
  const revenueDayKey = revenueDay.format('YYYY-MM-DD');
  const isRevenueDayToday = revenueDay.isSame(today, 'day');
  const canAdvanceRevenueDay = revenueDay.isBefore(today, 'day');
  const revenueDayLabel = revenueDay.format('dddd, MMM D, YYYY');

  const toggleChartLine = (key: ChartLineKey) => {
    setChartLineVisible((v) => ({ ...v, [key]: !v[key] }));
  };

  // Fetch selected-range series (for chart + header totals)
  useEffect(() => {
    let alive = true;
    setUnauthorized(false);
    setLoading(true);
    (async () => {
      try {
        const data = await fetchPaymentsAnalytics({
          start: toISODate(range.from),
          end: toISODate(range.to),
        });
        if (!alive) return;
        setSeries(data);
      } catch (err) {
        if (!alive) return;
        console.error('Payments analytics request failed:', err);
        setUnauthorized(true);
        setSeries([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range.from, range.to]);

  // Lightweight all-time leaderboards (SQL top-N) — avoids fetching every day since 2000
  useEffect(() => {
    let alive = true;
    setLeaderboardsLoading(true);
    (async () => {
      try {
        const boards = await fetchPaymentsLeaderboards({ limit: 10 });
        if (!alive) return;
        setLeaderboards(boards);
      } catch (_) {
        if (!alive) return;
        setLeaderboards(null);
      } finally {
        if (alive) setLeaderboardsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // When browsing a day outside the selected chart range, fetch that single day (with Square)
  useEffect(() => {
    const inSeries = findPaymentPointForDay(series, revenueDayKey);
    if (inSeries) {
      setRevenueDayOverride(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const rows = await fetchPaymentsAnalytics({
          start: revenueDayKey,
          end: revenueDayKey,
        });
        if (!alive) return;
        setRevenueDayOverride(findPaymentPointForDay(rows, revenueDayKey));
      } catch (_) {
        if (!alive) return;
        setRevenueDayOverride(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [series, revenueDayKey]);

  // Square received + credit card comparison for the selected daily revenue day
  useEffect(() => {
    let alive = true;
    setSquareLoading(true);
    setSquareError(null);
    (async () => {
      try {
        const [allSquare, cardSquare, reconciliation] = await Promise.all([
          fetchSquarePayments({
            start: revenueDayKey,
            end: revenueDayKey,
            completedOnly: true,
          }),
          fetchSquarePayments({
            start: revenueDayKey,
            end: revenueDayKey,
            cardOnly: true,
            completedOnly: true,
          }),
          fetchPaymentsReconciliation({ start: revenueDayKey, end: revenueDayKey }),
        ]);
        if (!alive) return;

        const daySquare = filterSquarePaymentsForDay(allSquare.payments, revenueDayKey);
        const dayCardSquare = filterSquarePaymentsForDay(cardSquare.payments, revenueDayKey);
        const allTotals = sumSquarePayments(daySquare);
        const cardTotals = sumSquarePayments(dayCardSquare);
        const oursCards = sumCreditCardPaymentsForDay(reconciliation, revenueDayKey);

        setSquareTotal(allTotals.total);
        setSquareCount(allTotals.count);
        setSquareCardTotal(cardTotals.total);
        setSquareCardCount(cardTotals.count);
        setOursCardTotal(oursCards.total);
        setOursCardCount(oursCards.count);
      } catch (err: unknown) {
        if (!alive) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 503) {
          setSquareError('Square is not configured on the server.');
        } else {
          setSquareError(
            err instanceof Error ? err.message : 'Failed to load Square payments'
          );
        }
        setSquareTotal(0);
        setSquareCount(0);
        setSquareCardTotal(0);
        setSquareCardCount(0);
        setOursCardTotal(0);
        setOursCardCount(0);
      } finally {
        if (alive) setSquareLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [revenueDayKey]);

  // Stripe received for the selected daily revenue day (memberships from Dec 2025 only —
  // earlier Stripe would double-count charges already in Pulse).
  useEffect(() => {
    let alive = true;
    if (revenueDayKey < '2025-12-01') {
      setStripeLoading(false);
      setStripeError(null);
      setStripeTotal(0);
      setStripeCount(0);
      return;
    }
    setStripeLoading(true);
    setStripeError(null);
    (async () => {
      try {
        const res = await fetchStripeRevenue({
          start: revenueDayKey,
          end: revenueDayKey,
        });
        if (!alive) return;

        // Prefer the byDay row for the exact day; fall back to range totals
        const dayRow = res.byDay.find((d) => d.date.slice(0, 10) === revenueDayKey);
        setStripeTotal(dayRow ? dayRow.revenue : res.totalRevenue);
        setStripeCount(dayRow ? dayRow.count : res.totalCount);
      } catch (err: unknown) {
        if (!alive) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 503) {
          setStripeError('Stripe is not configured on the server.');
        } else {
          setStripeError(
            err instanceof Error ? err.message : 'Failed to load Stripe revenue'
          );
        }
        setStripeTotal(0);
        setStripeCount(0);
      } finally {
        if (alive) setStripeLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [revenueDayKey]);

  const creditCardTotalsMatch = useMemo(() => {
    return Math.abs(oursCardTotal - squareCardTotal) < 0.005;
  }, [oursCardTotal, squareCardTotal]);
  const creditCardCountMatch = oursCardCount === squareCardCount;
  const creditCardFullyMatch = creditCardTotalsMatch && creditCardCountMatch;
  const creditCardDifference = oursCardTotal - squareCardTotal;

  const totals = useMemo(() => {
    const revenue = series.reduce((s, p) => s + p.revenue, 0);
    const practiceRevenue = series.reduce((s, p) => s + (p.practiceRevenue ?? 0), 0);
    const onlinePharmacyRevenue = series.reduce(
      (s, p) => s + (p.onlinePharmacyRevenue ?? 0),
      0
    );
    const subscriptionRevenue = series.reduce(
      (s, p) => s + (p.subscriptionRevenue ?? 0),
      0
    );
    const stripeRevenue = series.reduce((s, p) => s + (p.stripeRevenue ?? 0), 0);
    const total = revenue + subscriptionRevenue + stripeRevenue;
    const avg = series.length ? total / series.length : 0;
    return {
      revenue,
      practiceRevenue,
      onlinePharmacyRevenue,
      subscriptionRevenue,
      stripeRevenue,
      total,
      avg,
    };
  }, [series]);

  const chartData = useMemo(
    () =>
      series.map((p) => ({
        ...p,
        totalRevenue:
          p.revenue + (p.subscriptionRevenue ?? 0) + (p.stripeRevenue ?? 0),
      })),
    [series]
  );

  const chartDataWithTrend = useMemo(() => addLinearTrend(chartData), [chartData]);

  // ---------- Leaderboards + daily revenue card ----------
  /** Revenue row for the day selected on the daily revenue card (local + UTC date matching). */
  const revenueDayRow = useMemo(() => {
    return findPaymentPointForDay(series, revenueDayKey) ?? revenueDayOverride ?? null;
  }, [series, revenueDayOverride, revenueDayKey]);
  const revenueDayPracticeRevenue = revenueDayRow?.practiceRevenue ?? 0;
  const revenueDayOnlinePharmacyRevenue = revenueDayRow?.onlinePharmacyRevenue ?? 0;
  /** Square (subscription) revenue for the day, from the payments analytics series. */
  const revenueDaySquareRevenue = revenueDayRow?.subscriptionRevenue ?? 0;
  const revenueDayPaymentsBreakdown = revenueDayPracticeRevenue + revenueDayOnlinePharmacyRevenue;
  const revenueDayRecordedRevenue = revenueDayRow?.revenue ?? 0;
  const revenueDayUseLegacyPaymentsRow =
    revenueDayPaymentsBreakdown === 0 && revenueDayRecordedRevenue !== 0;
  const revenueDayPaymentsTotal = revenueDayUseLegacyPaymentsRow
    ? revenueDayRecordedRevenue
    : revenueDayPaymentsBreakdown > 0
      ? revenueDayPaymentsBreakdown
      : revenueDayRecordedRevenue;
  const revenueDayTotalRevenue = revenueDayPaymentsTotal + revenueDaySquareRevenue + stripeTotal;

  /** Fallback: derive top-N from the current chart range if the leaderboards API fails. */
  const rangeLeaderboards = useMemo((): PaymentsLeaderboards => {
    const dayTotals = series.map((p) => ({
      key: p.date,
      // Match chart / daily card: DB revenue + Square subscriptions + Stripe
      revenue: p.revenue + (p.subscriptionRevenue ?? 0) + (p.stripeRevenue ?? 0),
      count: p.count,
    }));
    const topDays: PaymentsLeaderboardEntry[] = [...dayTotals]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const monthMap = new Map<string, PaymentsLeaderboardEntry>();
    const yearMap = new Map<string, PaymentsLeaderboardEntry>();
    for (const p of dayTotals) {
      const monthKey = dayjs.utc(p.key).format('YYYY-MM');
      const yearKey = dayjs.utc(p.key).format('YYYY');
      const month = monthMap.get(monthKey) || { key: monthKey, revenue: 0, count: 0 };
      month.revenue += p.revenue;
      month.count += p.count;
      monthMap.set(monthKey, month);
      const year = yearMap.get(yearKey) || { key: yearKey, revenue: 0, count: 0 };
      year.revenue += p.revenue;
      year.count += p.count;
      yearMap.set(yearKey, year);
    }
    const byRevenue = (a: PaymentsLeaderboardEntry, b: PaymentsLeaderboardEntry) =>
      b.revenue - a.revenue;
    return {
      topDays,
      topMonths: Array.from(monthMap.values()).sort(byRevenue).slice(0, 10),
      topYears: Array.from(yearMap.values()).sort(byRevenue).slice(0, 10),
    };
  }, [series]);

  const topDays = leaderboards?.topDays ?? rangeLeaderboards.topDays;
  const topMonths = leaderboards?.topMonths ?? rangeLeaderboards.topMonths;
  const topYears = leaderboards?.topYears ?? rangeLeaderboards.topYears;

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

        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={320} p={4}>
            <CircularProgress />
          </Box>
        ) : (
          <>
        {/* Summary cards */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Revenue (range)"
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
          <Grid item xs={12} sm={6} md={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Practice Revenue (range)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.practiceRevenue)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {series.length} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Online Pharmacy Revenue (range)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.onlinePharmacyRevenue)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {series.length} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Subscription Revenue (range)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.subscriptionRevenue)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {series.length} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Stripe Revenue (range)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.stripeRevenue)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  memberships from Dec 2025 · {series.length} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Total (range)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.total)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  revenue + subscription + Stripe · {series.length} days
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title="Daily Avg (range)"
              />
              <CardContent>
                <Typography variant="h5" fontWeight={700}>
                  {fmtUSD(totals.avg)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  avg total / day
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Daily revenue (defaults to today; change day with arrows) */}
        <Card variant="outlined">
          <CardHeader
            title={isRevenueDayToday ? "Today's Revenue" : 'Revenue'}
            action={
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPaymentsListOpen(true)}
                >
                  All payments
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPaymentsDetailOpen(true)}
                >
                  View payments
                </Button>
              </Stack>
            }
          />
          <CardContent>
            <Stack spacing={0.5}>
              {revenueDayUseLegacyPaymentsRow ? (
                <Box display="flex" justifyContent="space-between" alignItems="baseline">
                  <Typography variant="body2" color="text.secondary">
                    Payments revenue
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {fmtUSD(revenueDayRecordedRevenue)}
                  </Typography>
                </Box>
              ) : (
                <>
                  <Box display="flex" justifyContent="space-between" alignItems="baseline">
                    <Typography variant="body2" color="text.secondary">
                      Practice revenue
                    </Typography>
                    <Typography variant="body1" fontWeight={600}>
                      {fmtUSD(revenueDayPracticeRevenue)}
                    </Typography>
                  </Box>
                  <Box display="flex" justifyContent="space-between" alignItems="baseline">
                    <Typography variant="body2" color="text.secondary">
                      Online pharmacy revenue
                    </Typography>
                    <Typography variant="body1" fontWeight={600}>
                      {fmtUSD(revenueDayOnlinePharmacyRevenue)}
                    </Typography>
                  </Box>
                </>
              )}
              <Box display="flex" justifyContent="space-between" alignItems="baseline">
                <Typography variant="body2" color="text.secondary">
                  Square revenue
                </Typography>
                <Typography variant="body1" fontWeight={600}>
                  {fmtUSD(revenueDaySquareRevenue)}
                </Typography>
              </Box>
              <Box display="flex" justifyContent="space-between" alignItems="baseline">
                <Typography variant="body2" color="text.secondary">
                  Stripe revenue
                </Typography>
                <Typography variant="body1" fontWeight={600}>
                  {stripeLoading ? (
                    <CircularProgress size={14} />
                  ) : (
                    fmtUSD(stripeTotal)
                  )}
                </Typography>
              </Box>
              <Divider sx={{ my: 0.5 }} />
              <Box display="flex" justifyContent="space-between" alignItems="baseline">
                <Typography variant="body2" fontWeight={600} color="text.secondary">
                  Total
                </Typography>
                <Typography variant="h5" fontWeight={800}>
                  {fmtUSD(revenueDayTotalRevenue)}
                </Typography>
              </Box>
            </Stack>
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              gap={0.5}
              sx={{ mt: 1.5 }}
            >
              <IconButton
                aria-label="Previous day"
                size="small"
                onClick={() => setRevenueDay((d) => d.subtract(1, 'day'))}
              >
                <ChevronLeft />
              </IconButton>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 200, textAlign: 'center' }}>
                {revenueDayLabel}
              </Typography>
              <IconButton
                aria-label="Next day"
                size="small"
                disabled={!canAdvanceRevenueDay}
                onClick={() => {
                  if (!canAdvanceRevenueDay) return;
                  setRevenueDay((d) => d.add(1, 'day'));
                }}
              >
                <ChevronRight />
              </IconButton>
            </Box>
          </CardContent>
        </Card>

        {/* Square received (same day as daily revenue card) */}
        <Card variant="outlined">
          <CardHeader
            title={isRevenueDayToday ? 'Square Received Today' : 'Square Received'}
            subheader="Completed payments recorded in Square for this day"
            action={
              <Button
                size="small"
                variant="outlined"
                disabled={!!squareError}
                onClick={() => setSquareReconcileOpen(true)}
              >
                Match credit cards
              </Button>
            }
          />
          <CardContent>
            {squareLoading ? (
              <Box display="flex" justifyContent="center" py={1}>
                <CircularProgress size={24} />
              </Box>
            ) : squareError ? (
              <Alert severity="warning">{squareError}</Alert>
            ) : (
              <Stack spacing={1}>
                <Typography variant="subtitle2" color="text.secondary">
                  Credit card comparison
                </Typography>
                <Box display="flex" justifyContent="space-between" alignItems="baseline">
                  <Typography variant="body2" color="text.secondary">
                    Our system (credit card)
                  </Typography>
                  <Box textAlign="right">
                    <Typography variant="body1" fontWeight={600}>
                      {fmtUSD(oursCardTotal)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {oursCardCount} payment{oursCardCount === 1 ? '' : 's'}
                    </Typography>
                  </Box>
                </Box>
                <Box display="flex" justifyContent="space-between" alignItems="baseline">
                  <Typography variant="body2" color="text.secondary">
                    Square (credit card)
                  </Typography>
                  <Box textAlign="right">
                    <Typography variant="body1" fontWeight={600}>
                      {fmtUSD(squareCardTotal)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {squareCardCount} payment{squareCardCount === 1 ? '' : 's'}
                    </Typography>
                  </Box>
                </Box>

                {creditCardFullyMatch ? (
                  <Alert severity="success" icon={<CheckCircle fontSize="inherit" />} sx={{ py: 0 }}>
                    Credit card totals match for {revenueDayLabel}.
                  </Alert>
                ) : (
                  <Alert severity="warning" icon={<Warning fontSize="inherit" />} sx={{ py: 0 }}>
                    {!creditCardTotalsMatch && (
                      <>
                        Amount difference:{' '}
                        <strong>
                          {creditCardDifference >= 0 ? '+' : ''}
                          {fmtUSD(creditCardDifference)}
                        </strong>
                        {!creditCardCountMatch && ' · '}
                      </>
                    )}
                    {!creditCardCountMatch && (
                      <>
                        Payment count differs ({oursCardCount} ours vs {squareCardCount} Square)
                      </>
                    )}
                  </Alert>
                )}

                <Divider sx={{ my: 0.5 }} />
                <Box display="flex" justifyContent="space-between" alignItems="baseline">
                  <Typography variant="body2" color="text.secondary">
                    All Square received
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {fmtUSD(squareTotal)}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {squareCount.toLocaleString()} completed payment{squareCount === 1 ? '' : 's'}{' '}
                  (all types) · {revenueDayLabel}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Use &ldquo;Match credit cards&rdquo; to see which individual payments matched or
                  did not.
                </Typography>
              </Stack>
            )}
          </CardContent>
        </Card>

        {/* Stripe received (same day as daily revenue card) */}
        <Card variant="outlined">
          <CardHeader
            title={isRevenueDayToday ? 'Stripe Received Today' : 'Stripe Received'}
            subheader="Payments recorded in Stripe for this day"
          />
          <CardContent>
            {stripeLoading ? (
              <Box display="flex" justifyContent="center" py={1}>
                <CircularProgress size={24} />
              </Box>
            ) : stripeError ? (
              <Alert severity="warning">{stripeError}</Alert>
            ) : (
              <Stack spacing={1}>
                <Box display="flex" justifyContent="space-between" alignItems="baseline">
                  <Typography variant="body2" color="text.secondary">
                    All Stripe received
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {fmtUSD(stripeTotal)}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {stripeCount.toLocaleString()} payment{stripeCount === 1 ? '' : 's'} ·{' '}
                  {revenueDayLabel}
                </Typography>
              </Stack>
            )}
          </CardContent>
        </Card>

        {/* Chart */}
        <Card variant="outlined">
          <CardHeader title="Trend" />
          <CardContent>
            <FormGroup row sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={chartLineVisible.practiceRevenue}
                    onChange={() => toggleChartLine('practiceRevenue')}
                  />
                }
                label={<Typography variant="body2">Practice</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={chartLineVisible.onlinePharmacyRevenue}
                    onChange={() => toggleChartLine('onlinePharmacyRevenue')}
                  />
                }
                label={<Typography variant="body2">Pharmacy</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={chartLineVisible.subscriptionRevenue}
                    onChange={() => toggleChartLine('subscriptionRevenue')}
                  />
                }
                label={<Typography variant="body2">Subscription</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={chartLineVisible.totalRevenue}
                    onChange={() => toggleChartLine('totalRevenue')}
                  />
                }
                label={<Typography variant="body2">Total</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={chartLineVisible.trend}
                    onChange={() => toggleChartLine('trend')}
                  />
                }
                label={<Typography variant="body2">Trend</Typography>}
              />
            </FormGroup>
            <Box height={320} minHeight={320}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartDataWithTrend}
                  margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => dayjs(d).format('MM/DD')}
                    minTickGap={24}
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v) => fmtUSD(v)}
                  />
                  <Tooltip
                    formatter={(value: unknown) =>
                      value == null ? '' : fmtUSD(Number(value))
                    }
                    labelFormatter={(l) => dayjs(l).format('ddd, MMM D, YYYY')}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="practiceRevenue"
                    name="Practice revenue"
                    stroke="#1565c0"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                    hide={!chartLineVisible.practiceRevenue}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="onlinePharmacyRevenue"
                    name="Online pharmacy revenue"
                    stroke="#7b1fa2"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                    hide={!chartLineVisible.onlinePharmacyRevenue}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="subscriptionRevenue"
                    name="Subscription revenue"
                    stroke="#2e7d32"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                    hide={!chartLineVisible.subscriptionRevenue}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="totalRevenue"
                    name="Total"
                    stroke="#ed6c02"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive
                    hide={!chartLineVisible.totalRevenue}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="trend"
                    name="Trend"
                    stroke="#607d8b"
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                    dot={false}
                    isAnimationActive
                    hide={!chartLineVisible.trend}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>

        {/* Leaderboards */}
        <Grid container spacing={2}>
          {/* Top 10 Days */}
          <Grid item xs={12} md={4}>
            <Card variant="outlined">
              <CardHeader
                title="Top 10 Days (all-time)"
                subheader="Pulse payments (excl. membership plan) + Square/Stripe from Dec 2025"
                subheaderTypographyProps={{ variant: 'caption' }}
              />
              <CardContent>
                {leaderboardsLoading && !leaderboards ? (
                  <Box display="flex" justifyContent="center" py={3}>
                    <CircularProgress size={28} />
                  </Box>
                ) : (
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Date</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Revenue</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Payments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topDays.map((d) => (
                          <tr key={d.key} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                            <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                              {dayjs(d.key).format('MMM D, YYYY')}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {fmtUSD(d.revenue)}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {d.count.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                        {topDays.length === 0 && (
                          <tr>
                            <td colSpan={3} style={{ padding: '8px' }}>
                              No data
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Top 10 Months */}
          <Grid item xs={12} md={4}>
            <Card variant="outlined">
              <CardHeader
                title="Top 10 Months (all-time)"
                subheader="Same total as daily revenue"
                subheaderTypographyProps={{ variant: 'caption' }}
              />
              <CardContent>
                {leaderboardsLoading && !leaderboards ? (
                  <Box display="flex" justifyContent="center" py={3}>
                    <CircularProgress size={28} />
                  </Box>
                ) : (
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Month</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Revenue</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Payments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topMonths.map((m) => (
                          <tr key={m.key} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                            <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                              {dayjs(m.key + '-01').format('MMM YYYY')}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {fmtUSD(m.revenue)}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {m.count.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                        {topMonths.length === 0 && (
                          <tr>
                            <td colSpan={3} style={{ padding: '8px' }}>
                              No data
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Top 10 Years */}
          <Grid item xs={12} md={4}>
            <Card variant="outlined">
              <CardHeader
                title="Top 10 Years (all-time)"
                subheader="Same total as daily revenue"
                subheaderTypographyProps={{ variant: 'caption' }}
              />
              <CardContent>
                {leaderboardsLoading && !leaderboards ? (
                  <Box display="flex" justifyContent="center" py={3}>
                    <CircularProgress size={28} />
                  </Box>
                ) : (
                  <Box sx={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                          <th style={{ textAlign: 'left', padding: '8px' }}>Year</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Revenue</th>
                          <th style={{ textAlign: 'right', padding: '8px' }}>Payments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topYears.map((y) => (
                          <tr key={y.key} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                            <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{y.key}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {fmtUSD(y.revenue)}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {y.count.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                        {topYears.length === 0 && (
                          <tr>
                            <td colSpan={3} style={{ padding: '8px' }}>
                              No data
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        <DayPaymentsListModal
          open={paymentsListOpen}
          date={revenueDayKey}
          onClose={() => setPaymentsListOpen(false)}
        />

        <TodaysPaymentsDetailModal
          open={paymentsDetailOpen}
          date={revenueDayKey}
          onClose={() => setPaymentsDetailOpen(false)}
        />

        <SquareDayReconciliationModal
          open={squareReconcileOpen}
          date={revenueDayKey}
          onClose={() => setSquareReconcileOpen(false)}
        />

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
          </>
        )}
      </Box>
    </LocalizationProvider>
  );
}
