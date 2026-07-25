import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Collapse,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchClPerformanceAnalytics,
  type ClPerformanceAnalyticsResponse,
  type ClPerformanceLiaison,
} from '../api/clPerformanceAnalytics';
import {
  CL_POINTS_COST_GUIDE,
  CL_POINTS_EARN_GUIDE,
  CL_SEAT_LABELS,
} from '../utils/clPoints';

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

/** Current calendar week Sunday–Saturday (local). */
function currentWeekRange(): { from: Dayjs; to: Dayjs } {
  const today = dayjs().startOf('day');
  const sunday = today.subtract(today.day(), 'day');
  return { from: sunday, to: sunday.add(6, 'day') };
}

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  'This week': currentWeekRange,
  'Last week': () => {
    const { from } = currentWeekRange();
    return { from: from.subtract(7, 'day'), to: from.subtract(1, 'day') };
  },
  '7D': () => ({ from: dayjs().subtract(6, 'day'), to: dayjs() }),
  '30D': () => ({ from: dayjs().subtract(29, 'day'), to: dayjs() }),
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

function formatPoints(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatImprovement(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const pct = rate * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

function formatNormalized(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return '—';
  return `${score.toFixed(2)}×`;
}

function LiaisonDetailRow({ row }: { row: ClPerformanceLiaison }) {
  return (
    <TableRow>
      <TableCell colSpan={10} sx={{ bgcolor: 'action.hover', py: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom>
              Points breakdown
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Seat</TableCell>
                  <TableCell align="right">{row.seatLabel ?? 'Unassigned'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Par (for range)</TableCell>
                  <TableCell align="right">
                    {row.par == null ? '—' : formatPoints(row.par)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Normalized score</TableCell>
                  <TableCell align="right">{formatNormalized(row.normalizedScore)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Bookings (tier)</TableCell>
                  <TableCell align="right">{formatPoints(row.categories.bookings)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>New-patient bonus</TableCell>
                  <TableCell align="right">{formatPoints(row.categories.newPatientBonus)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Calls (answered + outbound)</TableCell>
                  <TableCell align="right">{formatPoints(row.categories.calls)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Outreach contacts (Fill Day)</TableCell>
                  <TableCell align="right">{formatPoints(row.categories.outreach)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Penalties (missed in-hours)</TableCell>
                  <TableCell align="right">{formatPoints(row.categories.penalties)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" gutterBottom>
              Activity counts
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Bookings (≤7d / ≤14d / base)</TableCell>
                  <TableCell align="right">
                    {row.counts.bookingsWithin7Days} / {row.counts.bookingsWithin14Days} /{' '}
                    {row.counts.bookingsBase}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>New-patient bookings</TableCell>
                  <TableCell align="right">{row.counts.newPatientBookings}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Inbound answered</TableCell>
                  <TableCell align="right">{row.counts.answeredInboundCalls}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Outbound calls</TableCell>
                  <TableCell align="right">{row.counts.outboundCalls}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Missed in-hours</TableCell>
                  <TableCell align="right">{row.counts.missedInHoursCalls}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Outreach contacts</TableCell>
                  <TableCell align="right">{row.counts.outreachContacts}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Prior period points</TableCell>
                  <TableCell align="right">
                    {row.priorTotalPoints == null ? '—' : formatPoints(row.priorTotalPoints)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Grid>
        </Grid>
      </TableCell>
    </TableRow>
  );
}

export default function CLPerformanceAnalyticsPage() {
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => currentWeekRange());
  const [data, setData] = useState<ClPerformanceAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchClPerformanceAnalytics({
        startDate: toLocalDateStr(range.from),
        endDate: toLocalDateStr(range.to),
      });
      setData(res);
    } catch (e: unknown) {
      console.error('CL performance analytics failed:', e);
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        setError('You do not have access to CL performance analytics.');
      } else {
        setError('Failed to load CL performance analytics.');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftRange = (direction: -1 | 1) => {
    const days = range.to.startOf('day').diff(range.from.startOf('day'), 'day') + 1;
    const shift = days * direction;
    setRange((r) => ({
      from: r.from.add(shift, 'day'),
      to: r.to.add(shift, 'day'),
    }));
  };

  const topPerformer = data?.liaisons[0] ?? null;
  const mostImproved = useMemo(() => {
    if (!data?.liaisons.length) return null;
    const withRate = data.liaisons.filter((l) => l.improvementRate != null);
    if (!withRate.length) return null;
    return [...withRate].sort((a, b) => (b.improvementRate ?? 0) - (a.improvementRate ?? 0))[0];
  }, [data?.liaisons]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.liaisons.slice(0, 12).map((l) => ({
      name: l.fullName.split(' ')[0] || l.fullName,
      fullName: l.fullName,
      points: l.totalPoints,
    }));
  }, [data]);

  const chartColors = ['#1B4D3E', '#2D6A4F', '#40916C', '#52B788', '#74C69D', '#95D5B2'];

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ py: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Client Liaison points vs the rotating-seat guide: bookings (lead-time tiers), OpenPhone
          calls, Fill Day contacts, and missed in-hours penalties. Normalized score uses seat
          assignment and par from Settings → CL Seat Assignment (1.0× = on target); day offs and
          one-day seat swaps prorate par. Scores are also compared to the prior equal-length period
          for improvement.
        </Typography>

        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" sx={{ mb: 2 }}>
          {Object.keys(PRESETS).map((key) => (
            <Button key={key} size="small" variant="outlined" onClick={() => setRange(PRESETS[key]())}>
              {key}
            </Button>
          ))}
          <IconButton
            aria-label="Previous range"
            onClick={() => shiftRange(-1)}
            disabled={loading}
            size="small"
          >
            <ChevronLeft fontSize="small" />
          </IconButton>
          <IconButton
            aria-label="Next range"
            onClick={() => shiftRange(1)}
            disabled={loading}
            size="small"
          >
            <ChevronRight fontSize="small" />
          </IconButton>
          <DatePicker
            label="From"
            value={range.from}
            onChange={(v) => v && setRange((r) => ({ ...r, from: v }))}
            slotProps={{ textField: { size: 'small' } }}
          />
          <DatePicker
            label="To"
            value={range.to}
            onChange={(v) => v && setRange((r) => ({ ...r, to: v }))}
            slotProps={{ textField: { size: 'small' } }}
          />
          <Button variant="contained" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
          <Button size="small" variant="text" onClick={() => setShowGuide((g) => !g)}>
            {showGuide ? 'Hide' : 'Show'} points guide
          </Button>
        </Stack>

        <Collapse in={showGuide}>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardHeader title="What earns points" subheader="From the CL Points System guide" />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Action</TableCell>
                        <TableCell align="right">Points</TableCell>
                        <TableCell>Note</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {CL_POINTS_EARN_GUIDE.map((row) => (
                        <TableRow key={row.action}>
                          <TableCell>{row.action}</TableCell>
                          <TableCell align="right">{row.points}</TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {row.note ?? ''}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardHeader title="What costs points" />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Event</TableCell>
                        <TableCell align="right">Points</TableCell>
                        <TableCell>Note</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {CL_POINTS_COST_GUIDE.map((row) => (
                        <TableRow key={row.event}>
                          <TableCell>{row.event}</TableCell>
                          <TableCell align="right">{row.points}</TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {row.note ?? ''}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <CardContent sx={{ pt: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    Seat focus — {CL_SEAT_LABELS.phones}: calls & recovery; {CL_SEAT_LABELS.outreach}:
                    forward/recall volume & schedule loader; {CL_SEAT_LABELS.email}: requests →
                    bookings & direct-booking review. Normalized score = points ÷ seat par (1.0 = on
                    target) once weekly seat assignment is tracked.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Collapse>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : data ? (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" component="div">
                <strong>Scored now:</strong> {data.scoredCategories.join('; ')}.
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                {data.unscoredNote}
              </Typography>
              {data.priorStartDate && data.priorEndDate ? (
                <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                  Improvement vs prior {data.priorStartDate} → {data.priorEndDate}. Seat week:{' '}
                  {data.primaryWeekStart}
                  {data.weekCount > 1 ? ` (${data.weekCount} weeks × seat par)` : ''}. Pars — Phones{' '}
                  {data.seatPar.phones}, Outreach {data.seatPar.outreach}, Email {data.seatPar.email}.
                </Typography>
              ) : null}
            </Alert>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <KpiCard
                  title="Team points"
                  value={formatPoints(data.teamTotals.totalPoints)}
                  subtitle={`${data.liaisons.length} client liaison${data.liaisons.length === 1 ? '' : 's'}`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <KpiCard
                  title="Top normalized"
                  value={
                    topPerformer?.normalizedScore != null
                      ? formatNormalized(topPerformer.normalizedScore)
                      : topPerformer
                        ? formatPoints(topPerformer.totalPoints)
                        : '—'
                  }
                  subtitle={
                    topPerformer
                      ? `${topPerformer.fullName}${topPerformer.seatLabel ? ` · ${topPerformer.seatLabel}` : ''}`
                      : undefined
                  }
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <KpiCard
                  title="Most improved"
                  value={mostImproved ? formatImprovement(mostImproved.improvementRate) : '—'}
                  subtitle={mostImproved?.fullName}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <KpiCard
                  title="Booking points"
                  value={formatPoints(data.teamTotals.bookings)}
                  subtitle={`Calls ${formatPoints(data.teamTotals.calls)} · Outreach ${formatPoints(data.teamTotals.outreach)}`}
                />
              </Grid>
            </Grid>

            {chartData.length > 0 ? (
              <Card variant="outlined" sx={{ mb: 2 }}>
                <CardHeader title="Points by CL" subheader="Top 12 by total points" />
                <CardContent sx={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value) => [formatPoints(Number(value)), 'Points']}
                        labelFormatter={(_, payload) =>
                          (payload?.[0]?.payload as { fullName?: string })?.fullName ?? ''
                        }
                      />
                      <Bar dataKey="points" radius={[4, 4, 0, 0]}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={chartColors[i % chartColors.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}

            <Card variant="outlined">
              <CardHeader title="CL leaderboard" />
              <TableContainer component={Paper} variant="outlined" sx={{ border: 0 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell width={40} />
                      <TableCell>Rank</TableCell>
                      <TableCell>Client liaison</TableCell>
                      <TableCell>Seat</TableCell>
                      <TableCell align="right">Score</TableCell>
                      <TableCell align="right">Points</TableCell>
                      <TableCell align="right">Bookings</TableCell>
                      <TableCell align="right">Calls</TableCell>
                      <TableCell align="right">Outreach</TableCell>
                      <TableCell align="right">vs prior</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.liaisons.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10}>
                          <Typography color="text.secondary">
                            No Receptionist-role employees found.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.liaisons.map((row, idx) => {
                        const open = expandedId === row.employeeId;
                        return (
                          <React.Fragment key={row.employeeId}>
                            <TableRow hover selected={open}>
                              <TableCell>
                                <IconButton
                                  size="small"
                                  aria-label={open ? 'Collapse' : 'Expand'}
                                  onClick={() =>
                                    setExpandedId(open ? null : row.employeeId)
                                  }
                                >
                                  <ExpandMore
                                    fontSize="small"
                                    sx={{
                                      transform: open ? 'rotate(180deg)' : 'none',
                                      transition: 'transform 0.15s',
                                    }}
                                  />
                                </IconButton>
                              </TableCell>
                              <TableCell>{idx + 1}</TableCell>
                              <TableCell>
                                <Typography variant="body2">{row.fullName}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {row.email}
                                </Typography>
                              </TableCell>
                              <TableCell>{row.seatLabel ?? '—'}</TableCell>
                              <TableCell align="right">
                                <Typography
                                  fontWeight={600}
                                  color={
                                    row.normalizedScore == null
                                      ? 'text.secondary'
                                      : row.normalizedScore >= 1
                                        ? 'success.main'
                                        : 'text.primary'
                                  }
                                >
                                  {formatNormalized(row.normalizedScore)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                {formatPoints(row.totalPoints)}
                              </TableCell>
                              <TableCell align="right">
                                {formatPoints(
                                  row.categories.bookings + row.categories.newPatientBonus
                                )}
                              </TableCell>
                              <TableCell align="right">
                                {formatPoints(row.categories.calls + row.categories.penalties)}
                              </TableCell>
                              <TableCell align="right">
                                {formatPoints(row.categories.outreach)}
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  color:
                                    (row.improvementRate ?? 0) > 0
                                      ? 'success.main'
                                      : (row.improvementRate ?? 0) < 0
                                        ? 'error.main'
                                        : 'text.secondary',
                                }}
                              >
                                {formatImprovement(row.improvementRate)}
                              </TableCell>
                            </TableRow>
                            {open ? <LiaisonDetailRow row={row} /> : null}
                          </React.Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Card>
          </>
        ) : null}
      </Box>
    </LocalizationProvider>
  );
}
