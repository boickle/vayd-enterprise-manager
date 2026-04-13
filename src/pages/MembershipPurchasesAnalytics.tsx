import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { DateTime } from 'luxon';
import {
  Bar,
  BarChart,
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
  fetchMembershipPurchasesAnalytics,
  MEMBERSHIP_PURCHASES_TIMEZONE,
  type MembershipPurchasesAnalytics,
} from '../api/membershipPurchasesAnalytics';

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

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  '7D': () => ({ from: dayjs().subtract(6, 'day'), to: dayjs() }),
  '30D': () => ({ from: dayjs().subtract(29, 'day'), to: dayjs() }),
  '90D': () => ({ from: dayjs().subtract(89, 'day'), to: dayjs() }),
  YTD: () => ({ from: dayjs().startOf('year'), to: dayjs() }),
};

const CHANNEL_LABELS: Record<string, string> = {
  'room-loader': 'Room Loader',
  'appointment-form': 'Appt Request',
  'client-portal': 'Client Portal',
  unknown: 'Unknown',
};

function formatChannelLabel(key: string): string {
  const k = key.toLowerCase();
  if (CHANNEL_LABELS[k]) return CHANNEL_LABELS[k];
  return key
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Week starting Sunday (America/New_York calendar) containing `isoDate` (YYYY-MM-DD). */
function sundayStartEt(isoDate: string, zone: string): DateTime {
  const dt = DateTime.fromISO(isoDate, { zone });
  if (!dt.isValid) return DateTime.fromISO(isoDate);
  const wd = dt.weekday;
  const daysSinceSunday = wd === 7 ? 0 : wd;
  return dt.minus({ days: daysSinceSunday }).startOf('day');
}

function buildWeeklyRollup(
  purchasesByDay: { date: string; count: number }[],
  zone: string
): { weekStart: string; weekLabel: string; count: number }[] {
  const map = new Map<string, number>();
  for (const row of purchasesByDay) {
    const sun = sundayStartEt(row.date, zone);
    const key = sun.toISODate();
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + row.count);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, count]) => {
      const sun = DateTime.fromISO(weekStart, { zone });
      const sat = sun.plus({ days: 6 });
      return {
        weekStart,
        weekLabel: formatWeekRangeLabel(weekStart, sat.toISODate() ?? weekStart, zone),
        count,
      };
    });
}

/** Human-readable week span using API `weekStart` / `weekEnd` when present. */
function formatWeekRangeLabel(weekStart: string, weekEnd: string, zone: string): string {
  const a = DateTime.fromISO(weekStart, { zone });
  const b = DateTime.fromISO(weekEnd, { zone });
  if (!a.isValid || !b.isValid) return `${weekStart} – ${weekEnd}`;
  if (a.year === b.year && a.month === b.month) {
    return `${a.toFormat('MMM d')} – ${b.toFormat('d, yyyy')}`;
  }
  if (a.year === b.year) {
    return `${a.toFormat('MMM d')} – ${b.toFormat('MMM d, yyyy')}`;
  }
  return `${a.toFormat('MMM d, yyyy')} – ${b.toFormat('MMM d, yyyy')}`;
}

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

export default function MembershipPurchasesAnalyticsPage() {
  const [allTime, setAllTime] = useState(false);
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [practiceIdInput, setPracticeIdInput] = useState('');
  const [chartGranularity, setChartGranularity] = useState<'day' | 'week'>('day');
  const [data, setData] = useState<MembershipPurchasesAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const practiceIdParsed = useMemo(() => {
    const t = practiceIdInput.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }, [practiceIdInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMembershipPurchasesAnalytics({
        allTime,
        startDate: allTime ? undefined : toLocalDateStr(range.from),
        endDate: allTime ? undefined : toLocalDateStr(range.to),
        timeZone: MEMBERSHIP_PURCHASES_TIMEZONE,
        practiceId: practiceIdParsed,
      });
      setData(res);
    } catch (e: unknown) {
      console.error('Membership purchases analytics failed:', e);
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        setError('You do not have access to membership analytics (admin, owner, or superadmin required).');
      } else {
        setError('Failed to load membership analytics.');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [allTime, range.from, range.to, practiceIdParsed]);

  useEffect(() => {
    void load();
  }, [load]);

  const dailyChartData = useMemo(() => {
    if (!data?.purchasesByDay) return [];
    if (allTime) {
      return data.purchasesByDay.map((d) => ({
        date: d.date,
        label: d.date,
        memberships: d.count,
      }));
    }
    const byDate = new Map(data.purchasesByDay.map((d) => [d.date, d.count]));
    const dates = dateRangeInclusive(range.from, range.to);
    return dates.map((date) => ({
      date,
      label: date,
      memberships: byDate.get(date) ?? 0,
    }));
  }, [data?.purchasesByDay, allTime, range.from, range.to]);

  const weeklyChartData = useMemo(() => {
    const apiWeekly = data?.weekly ?? [];
    if (apiWeekly.length > 0) {
      return apiWeekly.map((w) => ({
        weekStart: w.weekStart,
        weekLabel: formatWeekRangeLabel(w.weekStart, w.weekEnd, MEMBERSHIP_PURCHASES_TIMEZONE),
        count: w.count,
      }));
    }
    const source = allTime
      ? data?.purchasesByDay ?? []
      : dailyChartData.map((d) => ({ date: d.date, count: d.memberships }));
    return buildWeeklyRollup(source, MEMBERSHIP_PURCHASES_TIMEZONE);
  }, [allTime, data?.purchasesByDay, data?.weekly, dailyChartData]);

  const typeRows = useMemo(() => {
    const entries = Object.entries(data?.membershipsByType ?? {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  }, [data?.membershipsByType]);

  const channelRows = useMemo(() => {
    const entries = Object.entries(data?.heardAboutUs ?? {});
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  }, [data?.heardAboutUs]);

  const shiftRange = (direction: -1 | 1) => {
    const days = range.to.startOf('day').diff(range.from.startOf('day'), 'day') + 1;
    const shift = days * direction;
    setRange((r) => ({
      from: r.from.add(shift, 'day'),
      to: r.to.add(shift, 'day'),
    }));
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ py: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Totals use Eastern time ({MEMBERSHIP_PURCHASES_TIMEZONE}
          {allTime ? ', all-time' : ''}). Optional practice filters the API to one location.
        </Typography>

        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={allTime}
                onChange={(_, c) => setAllTime(c)}
                disabled={loading}
              />
            }
            label="All time"
          />
          {!allTime ? (
            <>
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
            </>
          ) : null}
          <TextField
            size="small"
            label="Practice ID (optional)"
            value={practiceIdInput}
            onChange={(e) => setPracticeIdInput(e.target.value)}
            sx={{ width: 180 }}
            placeholder="All"
          />
          <Button variant="contained" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </Stack>

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
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={4}>
                <KpiCard title="Total memberships" value={data.totalMemberships} />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <KpiCard
                  title="Client households with a member"
                  value={data.householdsWithMember ?? '—'}
                  subtitle={
                    data.householdsWithMember == null
                      ? 'Not provided for this response'
                      : undefined
                  }
                />
              </Grid>
              <Grid item xs={12} sm={6} md={4}>
                <KpiCard
                  title="Membership types (distinct)"
                  value={typeRows.length}
                />
              </Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardHeader title="Memberships by type" />
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Type</TableCell>
                          <TableCell align="right">Count</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {typeRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2}>
                              <Typography color="text.secondary">No data</Typography>
                            </TableCell>
                          </TableRow>
                        ) : (
                          typeRows.map(([name, count]) => (
                            <TableRow key={name}>
                              <TableCell>{name}</TableCell>
                              <TableCell align="right">{count}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardHeader title="Heard about us (channel)" />
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Channel</TableCell>
                          <TableCell align="right">Memberships</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {channelRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={2}>
                              <Typography color="text.secondary">No data</Typography>
                            </TableCell>
                          </TableRow>
                        ) : (
                          channelRows.map(([key, count]) => (
                            <TableRow key={key}>
                              <TableCell>{formatChannelLabel(key)}</TableCell>
                              <TableCell align="right">{count}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Grid>
            </Grid>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                flexWrap="wrap"
                gap={1}
                sx={{ mb: 2 }}
              >
                <Typography variant="h6">Memberships over time</Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={chartGranularity}
                  onChange={(_, v) => v && setChartGranularity(v)}
                >
                  <ToggleButton value="day">By day</ToggleButton>
                  <ToggleButton value="week">By week (Sun–Sat, Eastern)</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              {chartGranularity === 'day' ? (
                dailyChartData.length === 0 ? (
                  <Typography color="text.secondary">No daily series for this range.</Typography>
                ) : (
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart data={dailyChartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} width={40} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="memberships" name="Memberships" stroke="#1976d2" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )
              ) : weeklyChartData.length === 0 ? (
                <Typography color="text.secondary">No weekly aggregates for this range.</Typography>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={weeklyChartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={72} />
                    <YAxis allowDecimals={false} width={40} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="count" name="Memberships" fill="#2e7d32" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Paper>
          </>
        ) : null}
      </Box>
    </LocalizationProvider>
  );
}
