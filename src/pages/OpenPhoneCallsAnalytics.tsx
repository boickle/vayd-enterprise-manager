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
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
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
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchOpenPhoneCallSummary,
  type OpenPhoneCallItem,
  type OpenPhoneCallSummaryByNumber,
  type OpenPhoneCallSummaryResponse,
  type OpenPhoneEmployeeSummary,
} from '../api/openphoneCalls';

function lineChartName(n: OpenPhoneCallSummaryByNumber, maxLen = 28): string {
  const raw = n.label?.trim() || n.phoneNumber || n.phoneNumberId;
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw;
}

function employeesFromSummary(data: OpenPhoneCallSummaryResponse): OpenPhoneEmployeeSummary[] {
  return data.employees ?? data.receptionists ?? [];
}

function sortNumbersByTotalCallsDesc(numbers: OpenPhoneCallSummaryByNumber[]): OpenPhoneCallSummaryByNumber[] {
  return [...numbers].sort((a, b) => {
    const d = b.totalCalls - a.totalCalls;
    if (d !== 0) return d;
    return b.totalMessages - a.totalMessages;
  });
}

function sortEmployeesByTotalCallsDesc(employees: OpenPhoneEmployeeSummary[]): OpenPhoneEmployeeSummary[] {
  return [...employees].sort((a, b) => {
    const d = b.totals.totalCalls - a.totals.totalCalls;
    if (d !== 0) return d;
    return b.totals.totalMessages - a.totals.totalMessages;
  });
}

type EmployeeLineAttribution = {
  employee: OpenPhoneEmployeeSummary;
  line: OpenPhoneCallSummaryByNumber;
};

/** Per-employee stats for one company line (`numbers[]` entry), sorted by inbound then total calls. */
function employeesAttributedOnLine(
  data: OpenPhoneCallSummaryResponse,
  phoneNumberId: string,
): EmployeeLineAttribution[] {
  const out: EmployeeLineAttribution[] = [];
  for (const employee of employeesFromSummary(data)) {
    const line = (employee.numbers ?? []).find((x) => x.phoneNumberId === phoneNumberId);
    if (!line) continue;
    if (line.totalCalls === 0 && line.totalMessages === 0) continue;
    out.push({ employee, line });
  }
  out.sort((a, b) => {
    const byTotal = b.line.totalCalls - a.line.totalCalls;
    if (byTotal !== 0) return byTotal;
    return b.line.incomingCalls - a.line.incomingCalls;
  });
  return out;
}

/** Local day start as ISO 8601 with offset (matches backend guidance). */
function toIsoRangeStart(d: Dayjs): string {
  return d.startOf('day').format('YYYY-MM-DDTHH:mm:ss.SSSZ');
}

/** Range end: end of local day, or now if that end is in the future (today / future “to” date). */
function toIsoRangeEnd(d: Dayjs): string {
  const end = d.endOf('day');
  const now = dayjs();
  const cap = end.isAfter(now) ? now : end;
  return cap.format('YYYY-MM-DDTHH:mm:ss.SSSZ');
}

const MISSED_INBOUND_STATUSES = new Set(['missed', 'no-answer', 'abandoned']);

function normOpenPhoneDirection(d: string | null | undefined): string {
  return (d || '').toLowerCase();
}

function isOpenPhoneCallEvent(item: OpenPhoneCallItem): boolean {
  const k = (item.kind || '').toLowerCase();
  if (k === 'message') return false;
  if (k === 'call') return true;
  const ev = (item.lastEvent || '').toLowerCase();
  return !ev.startsWith('message.');
}

function isOpenPhoneInbound(item: OpenPhoneCallItem): boolean {
  const d = normOpenPhoneDirection(item.direction);
  return d === 'incoming' || d === 'inbound';
}

function isOpenPhoneMissedInboundCall(item: OpenPhoneCallItem): boolean {
  if (!isOpenPhoneCallEvent(item) || !isOpenPhoneInbound(item)) return false;
  const s = (item.status || '').toLowerCase();
  return MISSED_INBOUND_STATUSES.has(s);
}

/** 24 local clock-hour buckets (0–23); aggregates all inbound calls in the range by time-of-day. */
function buildIncomingCallTimeOfDayTimeline(
  items: OpenPhoneCallItem[],
  filterOpenPhoneUserId: string | null,
): { bucketKey: string; label: string; receivedIncoming: number; missedIncoming: number }[] {
  const counts = new Map<number, { received: number; missed: number }>();
  for (let h = 0; h < 24; h++) {
    counts.set(h, { received: 0, missed: 0 });
  }

  for (const it of items) {
    if (filterOpenPhoneUserId) {
      if (!it.staffOpenPhoneUserId || it.staffOpenPhoneUserId !== filterOpenPhoneUserId) continue;
    }
    if (!isOpenPhoneCallEvent(it) || !isOpenPhoneInbound(it)) continue;
    const t = dayjs(it.createdAt);
    if (!t.isValid()) continue;
    const h = t.hour();
    const cell = counts.get(h);
    if (!cell) continue;
    if (isOpenPhoneMissedInboundCall(it)) cell.missed += 1;
    else cell.received += 1;
  }

  const ref = dayjs().startOf('day');
  return Array.from({ length: 24 }, (_, h) => {
    const v = counts.get(h)!;
    return {
      bucketKey: String(h),
      label: ref.hour(h).format('h:mm A'),
      receivedIncoming: v.received,
      missedIncoming: v.missed,
    };
  });
}

/** Monday = 0 … Sunday = 6 (local calendar day of the event). */
function mondayBasedDayIndex(t: Dayjs): number {
  const d = t.day();
  return d === 0 ? 6 : d - 1;
}

const DOW_LONG_MON_FIRST = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const DOW_SHORT_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Seven buckets Mon–Sun (local time); sums all inbound calls in the range by weekday. */
function buildIncomingCallDayOfWeekTimeline(
  items: OpenPhoneCallItem[],
  filterOpenPhoneUserId: string | null,
): { bucketKey: string; label: string; receivedIncoming: number; missedIncoming: number }[] {
  const counts = new Map<number, { received: number; missed: number }>();
  for (let i = 0; i < 7; i++) {
    counts.set(i, { received: 0, missed: 0 });
  }

  for (const it of items) {
    if (filterOpenPhoneUserId) {
      if (!it.staffOpenPhoneUserId || it.staffOpenPhoneUserId !== filterOpenPhoneUserId) continue;
    }
    if (!isOpenPhoneCallEvent(it) || !isOpenPhoneInbound(it)) continue;
    const t = dayjs(it.createdAt);
    if (!t.isValid()) continue;
    const idx = mondayBasedDayIndex(t);
    const cell = counts.get(idx);
    if (!cell) continue;
    if (isOpenPhoneMissedInboundCall(it)) cell.missed += 1;
    else cell.received += 1;
  }

  return Array.from({ length: 7 }, (_, i) => {
    const v = counts.get(i)!;
    return {
      bucketKey: String(i),
      label: DOW_LONG_MON_FIRST[i],
      receivedIncoming: v.received,
      missedIncoming: v.missed,
    };
  });
}

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  Today: () => {
    const n = dayjs();
    return { from: n, to: n };
  },
  '7D': () => ({ from: dayjs().subtract(6, 'day'), to: dayjs() }),
  '30D': () => ({ from: dayjs().subtract(29, 'day'), to: dayjs() }),
  '90D': () => ({ from: dayjs().subtract(89, 'day'), to: dayjs() }),
  YTD: () => ({ from: dayjs().startOf('year'), to: dayjs() }),
};

function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: number | null | undefined;
  subtitle?: string;
}) {
  const display = value != null ? String(value) : '—';
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography color="text.secondary" variant="body2" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h4" component="div">
          {display}
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

export default function OpenPhoneCallsAnalyticsPage() {
  const [preset, setPreset] = useState<string>('7D');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['7D']());
  const [data, setData] = useState<OpenPhoneCallSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [lineDialogLine, setLineDialogLine] = useState<OpenPhoneCallSummaryByNumber | null>(null);
  const [callItems, setCallItems] = useState<OpenPhoneCallItem[]>([]);
  const [timelineFilterUserId, setTimelineFilterUserId] = useState<string>('');
  const [incomingChartByDayOfWeek, setIncomingChartByDayOfWeek] = useState(false);

  const lineDialogRows = useMemo(() => {
    if (!data || !lineDialogLine) return [];
    return employeesAttributedOnLine(data, lineDialogLine.phoneNumberId);
  }, [data, lineDialogLine]);

  const fromIso = useMemo(() => toIsoRangeStart(range.from), [range.from]);
  const toIso = useMemo(() => toIsoRangeEnd(range.to), [range.to]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetchOpenPhoneCallSummary({ from: fromIso, to: toIso });
        if (!alive) return;
        setData(res);
        const events = Array.isArray(res.events) ? res.events : [];
        setCallItems(events);
      } catch (err: unknown) {
        if (!alive) return;
        const msg = err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'Failed to load call summary';
        setError(msg);
        setData(null);
        setCallItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fromIso, toIso]);

  const sortedCompanyLines = useMemo(
    () => (data?.numbers ? sortNumbersByTotalCallsDesc(data.numbers) : []),
    [data],
  );

  const sortedEmployees = useMemo(
    () => (data ? sortEmployeesByTotalCallsDesc(employeesFromSummary(data)) : []),
    [data],
  );

  const companyLineChartRows = useMemo(() => {
    return sortedCompanyLines.map((n) => ({
      name: lineChartName(n),
      totalCalls: n.totalCalls,
      totalMessages: n.totalMessages,
      missedIncoming: n.missedIncomingCallsTotal,
      incomingCalls: n.incomingCalls,
      outgoingCalls: n.outgoingCalls,
    }));
  }, [sortedCompanyLines]);

  const employeeChartRows = useMemo(() => {
    return sortedEmployees.map((r) => ({
      name: r.fullName?.trim() || `${r.firstName} ${r.lastName}`.trim() || `Employee ${r.employeeId}`,
      totalCalls: r.totals.totalCalls,
      totalMessages: r.totals.totalMessages,
      incoming: r.totals.incomingCalls,
      missed: r.totals.missedIncomingCallsTotal,
      outgoing: r.totals.outgoingCalls,
    }));
  }, [sortedEmployees]);

  const incomingCallTimelineRows = useMemo(() => {
    const uid = timelineFilterUserId.trim() ? timelineFilterUserId.trim() : null;
    return incomingChartByDayOfWeek
      ? buildIncomingCallDayOfWeekTimeline(callItems, uid)
      : buildIncomingCallTimeOfDayTimeline(callItems, uid);
  }, [callItems, timelineFilterUserId, incomingChartByDayOfWeek]);

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const todayStart = dayjs().startOf('day');
  const selectedDayStart = range.from.startOf('day');
  const canStepTodayForward = selectedDayStart.isBefore(todayStart, 'day');

  const shiftTodayByDays = (delta: number) => {
    setRange((r) => {
      const d = r.from.startOf('day').add(delta, 'day');
      return { from: d, to: d };
    });
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        <Typography variant="body2" color="text.secondary">
          Company-wide totals and per-line metrics use every webhook event once per company-owned OpenPhone number.
          Employee rows attribute handled calls and SMS when OpenPhone user id or work mobile matches; missed inbound
          calls are not attributed to individuals but still appear under totals and each line. Range uses your local
          timezone for day boundaries.
        </Typography>

        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm="auto">
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="openphone-preset-label">Range</InputLabel>
              <Select
                labelId="openphone-preset-label"
                label="Range"
                value={preset}
                onChange={(e) => {
                  const key = String(e.target.value);
                  setPreset(key);
                  if (PRESETS[key]) setRange(PRESETS[key]());
                }}
              >
                {Object.keys(PRESETS).map((k) => (
                  <MenuItem key={k} value={k}>
                    {k}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          {preset === 'Today' ? (
            <Grid item xs={12} sm="auto">
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <IconButton
                  size="small"
                  aria-label="Previous day"
                  onClick={() => shiftTodayByDays(-1)}
                >
                  <ChevronLeft />
                </IconButton>
                <Typography variant="body2" sx={{ minWidth: '9.5rem', textAlign: 'center' }}>
                  {selectedDayStart.format('ddd, MMM D, YYYY')}
                </Typography>
                <IconButton
                  size="small"
                  aria-label="Next day"
                  onClick={() => shiftTodayByDays(1)}
                  disabled={!canStepTodayForward}
                >
                  <ChevronRight />
                </IconButton>
              </Stack>
            </Grid>
          ) : null}
          <Grid item xs={12} sm="auto">
            <DatePicker
              label="From"
              value={range.from}
              onChange={(v) => {
                if (!v) return;
                setPreset('');
                setRange((r) => ({ ...r, from: v }));
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
          </Grid>
          <Grid item xs={12} sm="auto">
            <DatePicker
              label="To"
              value={range.to}
              onChange={(v) => {
                if (!v) return;
                setPreset('');
                setRange((r) => ({ ...r, to: v }));
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
          </Grid>
          <Grid item xs={12} sm="auto">
            <Button
              size="small"
              onClick={() => {
                setPreset('7D');
                setRange(PRESETS['7D']());
              }}
            >
              Reset to last 7 days
            </Button>
          </Grid>
        </Grid>

        {data ? (
          <Typography variant="caption" color="text.secondary" display="block">
            Server range: {data.from} — {data.to}
          </Typography>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}

        {data?.warnings?.length ? (
          <Stack spacing={1}>
            {data.warnings.map((w) => (
              <Alert key={w} severity="warning">
                {w}
              </Alert>
            ))}
          </Stack>
        ) : null}

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : data ? (
          <>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 0.5 }}>
              Calls
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <KpiCard title="Incoming" value={data.totals.incomingCalls} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <KpiCard title="Missed (incoming)" value={data.totals.missedIncomingCallsTotal} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <KpiCard title="Outgoing" value={data.totals.outgoingCalls} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <KpiCard title="Total calls" value={data.totals.totalCalls} />
              </Grid>
            </Grid>

            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1.5 }}>
              Missed calls
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              During vs outside use hoursOfOperation per weekday in PRACTICE_TIMEZONE (closed / null days count as
              outside).
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <KpiCard title="Total missed" value={data.totals.missedIncomingCallsTotal} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <KpiCard
                  title="During business hours"
                  value={data.totals.missedIncomingDuringBusinessHours}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <KpiCard
                  title="Outside business hours"
                  value={data.totals.missedIncomingOutsideBusinessHours}
                />
              </Grid>
            </Grid>

            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>
              SMS messages
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}>
                <KpiCard title="Incoming" value={data.totals.incomingMessages} />
              </Grid>
              <Grid item xs={6} sm={4}>
                <KpiCard title="Outgoing" value={data.totals.outgoingMessages} />
              </Grid>
              <Grid item xs={6} sm={4}>
                <KpiCard title="Total messages" value={data.totals.totalMessages} />
              </Grid>
            </Grid>

            <Card variant="outlined">
              <CardHeader
                title={incomingChartByDayOfWeek ? 'Incoming calls by day of week' : 'Incoming calls by time of day'}
                subheader={
                  incomingChartByDayOfWeek
                    ? 'Each point is a weekday (Mon–Sun, local time) for the selected range: all calls on that weekday are summed. Same received / missed rules as below. Messages excluded.'
                    : 'Each point is a clock hour (local time) for the selected date range: all calls at that hour are summed so you can see busy periods and when misses cluster. Received = inbound not counted as missed; missed = missed / no-answer / abandoned. Messages excluded.'
                }
                action={
                  <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={incomingChartByDayOfWeek}
                          onChange={(e) => setIncomingChartByDayOfWeek(e.target.checked)}
                          size="small"
                        />
                      }
                      label="Day of week"
                    />
                    <FormControl size="small" sx={{ minWidth: 240, maxWidth: 320 }}>
                      <InputLabel id="openphone-timeline-user-label">Scope</InputLabel>
                      <Select
                        labelId="openphone-timeline-user-label"
                        label="Scope"
                        value={timelineFilterUserId}
                        onChange={(e) => setTimelineFilterUserId(String(e.target.value))}
                      >
                        <MenuItem value="">Entire company</MenuItem>
                        {sortedEmployees.map((e) => {
                          const uid = e.openPhoneUserId?.trim() ?? '';
                          const name =
                            e.fullName?.trim() || `${e.firstName} ${e.lastName}`.trim() || `Employee ${e.employeeId}`;
                          const optionValue = uid || `__no_openphone_user_${e.employeeId}`;
                          return (
                            <MenuItem key={e.employeeId} value={optionValue} disabled={!uid}>
                              {name}
                              {!uid ? ' (no OpenPhone user id)' : ''}
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                  </Stack>
                }
              />
              <CardContent>
                {callItems.length === 0 ? (
                  <Typography color="text.secondary" variant="body2">
                    No timeline events in this date range.
                  </Typography>
                ) : (
                  <Box height={320} minHeight={320}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={incomingCallTimelineRows}
                        margin={{
                          left: 8,
                          right: 16,
                          top: 8,
                          bottom: incomingChartByDayOfWeek ? 32 : 56,
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="bucketKey"
                          type="category"
                          tickFormatter={(k) =>
                            incomingChartByDayOfWeek
                              ? DOW_SHORT_MON_FIRST[Number(k)] ?? k
                              : dayjs().startOf('day').hour(Number(k)).format('ha')
                          }
                          {...(incomingChartByDayOfWeek
                            ? { ticks: ['0', '1', '2', '3', '4', '5', '6'], interval: 0 as const }
                            : {
                                ticks: ['0', '3', '6', '9', '12', '15', '18', '21'],
                                interval: 0 as const,
                                angle: -35,
                                textAnchor: 'end' as const,
                                height: 56,
                              })}
                        />
                        <YAxis allowDecimals={false} />
                        <Tooltip
                          formatter={(v: unknown) => (v == null ? '' : Number(v).toLocaleString())}
                          labelFormatter={(label, payload) => {
                            const row = payload?.[0]?.payload as { label?: string } | undefined;
                            return row?.label ?? String(label ?? '');
                          }}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="receivedIncoming"
                          name="Received inbound"
                          stroke="#2e7d32"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="missedIncoming"
                          name="Missed inbound"
                          stroke="#ed6c02"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </Box>
                )}
              </CardContent>
            </Card>

            {companyLineChartRows.length > 0 ? (
              <Card variant="outlined">
                <CardHeader title="Volume by company line" subheader="Calls, missed inbound, and messages per line." />
                <CardContent sx={{ height: Math.min(120 + companyLineChartRows.length * 40, 520) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={companyLineChartRows}
                      layout="vertical"
                      margin={{ left: 8, right: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={168} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="totalCalls" name="Total calls" fill="#1976d2" />
                      <Bar dataKey="missedIncoming" name="Missed inbound" fill="#ed6c02" />
                      <Bar dataKey="totalMessages" name="Total messages" fill="#2e7d32" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}

            <Card variant="outlined">
              <CardHeader
                title="Company lines"
                subheader="Per OpenPhone number (PN…): org-wide counts and missed calls on each main/office line. Sorted by total calls (highest first). Click a number to see which staff have attributed traffic on that line."
              />
              <CardContent sx={{ p: 0 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Label</TableCell>
                        <TableCell>Number</TableCell>
                        <TableCell align="right">Call in</TableCell>
                        <TableCell align="right">Missed</TableCell>
                        <TableCell align="right">Missed (business hrs)</TableCell>
                        <TableCell align="right">Missed (outside)</TableCell>
                        <TableCell align="right">Call out</TableCell>
                        <TableCell align="right">Calls</TableCell>
                        <TableCell align="right">Msg in</TableCell>
                        <TableCell align="right">Msg out</TableCell>
                        <TableCell align="right">Msgs</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedCompanyLines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={11}>
                            <Typography color="text.secondary" sx={{ py: 2 }}>
                              No company line rows in this range. Confirm OpenPhone webhooks are posted to
                              /webhooks/openphone/call and that lines appear in the directory.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedCompanyLines.map((n) => (
                          <TableRow key={n.phoneNumberId} hover>
                            <TableCell>{n.label ?? '—'}</TableCell>
                            <TableCell>
                              <Link
                                component="button"
                                type="button"
                                variant="body2"
                                onClick={() => setLineDialogLine(n)}
                                sx={{
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  fontWeight: 500,
                                  verticalAlign: 'baseline',
                                }}
                                aria-label={`Attributed staff for ${n.phoneNumber}`}
                              >
                                {n.phoneNumber}
                              </Link>
                            </TableCell>
                            <TableCell align="right">{n.incomingCalls}</TableCell>
                            <TableCell align="right">{n.missedIncomingCallsTotal}</TableCell>
                            <TableCell align="right">{n.missedIncomingDuringBusinessHours}</TableCell>
                            <TableCell align="right">{n.missedIncomingOutsideBusinessHours}</TableCell>
                            <TableCell align="right">{n.outgoingCalls}</TableCell>
                            <TableCell align="right">{n.totalCalls}</TableCell>
                            <TableCell align="right">{n.incomingMessages}</TableCell>
                            <TableCell align="right">{n.outgoingMessages}</TableCell>
                            <TableCell align="right">{n.totalMessages}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            {employeeChartRows.length > 0 ? (
              <Card variant="outlined">
                <CardHeader
                  title="Calls and messages by employee"
                  subheader="Attributed traffic only; missed inbound is not assigned to people."
                />
                <CardContent sx={{ height: Math.min(120 + employeeChartRows.length * 36, 480) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={employeeChartRows} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="totalCalls" name="Calls" fill="#1976d2" />
                      <Bar dataKey="totalMessages" name="Messages" fill="#2e7d32" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : null}

            <Card variant="outlined">
              <CardHeader
                title="Employees"
                subheader="Active staff with phone1/phone2 or OpenPhone user id; sorted by total calls (highest first). Expand for attributed traffic per line (lines also sorted by calls)."
              />
              <CardContent sx={{ p: 0 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell width={48} />
                        <TableCell>Name</TableCell>
                        <TableCell>Phone</TableCell>
                        <TableCell align="right">Call in</TableCell>
                        <TableCell align="right">Missed</TableCell>
                        <TableCell align="right">Call out</TableCell>
                        <TableCell align="right">Calls</TableCell>
                        <TableCell align="right">Msg in</TableCell>
                        <TableCell align="right">Msg out</TableCell>
                        <TableCell align="right">Msgs</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedEmployees.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10}>
                            <Typography color="text.secondary" sx={{ py: 2 }}>
                              No employee rows in this range. Employees need phone1/phone2 (E.164) or openPhoneUserId
                              from directory sync, and webhooks must reach the API.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedEmployees.map((r: OpenPhoneEmployeeSummary) => (
                          <React.Fragment key={r.employeeId}>
                            <TableRow hover>
                              <TableCell padding="checkbox">
                                <IconButton
                                  size="small"
                                  aria-label="expand row"
                                  disabled={!r.numbers?.length}
                                  onClick={() => toggleExpand(r.employeeId)}
                                >
                                  <ExpandMore
                                    sx={{
                                      transform:
                                        expandedId === r.employeeId ? 'rotate(180deg)' : 'rotate(0deg)',
                                      transition: 'transform 0.2s',
                                    }}
                                  />
                                </IconButton>
                              </TableCell>
                              <TableCell>
                                {r.fullName?.trim() || `${r.firstName} ${r.lastName}`.trim()}
                              </TableCell>
                              <TableCell>{r.phoneNumber}</TableCell>
                              <TableCell align="right">{r.totals.incomingCalls}</TableCell>
                              <TableCell align="right">{r.totals.missedIncomingCallsTotal}</TableCell>
                              <TableCell align="right">{r.totals.outgoingCalls}</TableCell>
                              <TableCell align="right">{r.totals.totalCalls}</TableCell>
                              <TableCell align="right">{r.totals.incomingMessages}</TableCell>
                              <TableCell align="right">{r.totals.outgoingMessages}</TableCell>
                              <TableCell align="right">{r.totals.totalMessages}</TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell colSpan={10} sx={{ py: 0, borderBottom: 0 }}>
                                <Collapse in={expandedId === r.employeeId} timeout="auto" unmountOnExit>
                                  <Box sx={{ py: 2, px: 2, bgcolor: 'action.hover' }}>
                                    <Typography variant="subtitle2" gutterBottom>
                                      By OpenPhone line
                                    </Typography>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow>
                                          <TableCell>Label</TableCell>
                                          <TableCell>Number</TableCell>
                                          <TableCell align="right">Call in</TableCell>
                                          <TableCell align="right">Missed</TableCell>
                                          <TableCell align="right">Call out</TableCell>
                                          <TableCell align="right">Calls</TableCell>
                                          <TableCell align="right">Msg in</TableCell>
                                          <TableCell align="right">Msg out</TableCell>
                                          <TableCell align="right">Msgs</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {sortNumbersByTotalCallsDesc(r.numbers ?? []).map((n) => (
                                          <TableRow key={n.phoneNumberId}>
                                            <TableCell>{n.label ?? '—'}</TableCell>
                                            <TableCell>{n.phoneNumber}</TableCell>
                                            <TableCell align="right">{n.incomingCalls}</TableCell>
                                            <TableCell align="right">{n.missedIncomingCallsTotal}</TableCell>
                                            <TableCell align="right">{n.outgoingCalls}</TableCell>
                                            <TableCell align="right">{n.totalCalls}</TableCell>
                                            <TableCell align="right">{n.incomingMessages}</TableCell>
                                            <TableCell align="right">{n.outgoingMessages}</TableCell>
                                            <TableCell align="right">{n.totalMessages}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </Box>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          </React.Fragment>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </>
        ) : !loading && !error ? (
          <Alert severity="info">No data loaded.</Alert>
        ) : null}
      </Box>

      <Dialog
        open={!!lineDialogLine}
        onClose={() => setLineDialogLine(null)}
        maxWidth="md"
        fullWidth
        aria-labelledby="openphone-line-dialog-title"
      >
        <DialogTitle id="openphone-line-dialog-title">
          {lineDialogLine
            ? lineDialogLine.label?.trim()
              ? `${lineDialogLine.label.trim()} · ${lineDialogLine.phoneNumber}`
              : lineDialogLine.phoneNumber
            : ''}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Counts are attributed by the API (OpenPhone user id or work mobile on the event).{' '}
            <strong>Inbound calls</strong> are the best indicator of who handled incoming traffic on this line; company-wide
            missed calls are not assigned to individuals. Outbound counts are calls this person placed from this line.
          </Typography>
          {lineDialogLine && lineDialogRows.length === 0 ? (
            <Typography color="text.secondary">
              No attributed calls or messages on this line in the selected range.
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Employee</TableCell>
                    <TableCell align="right">Inbound calls</TableCell>
                    <TableCell align="right">Outbound calls</TableCell>
                    <TableCell align="right">Total calls</TableCell>
                    <TableCell align="right">Msgs in</TableCell>
                    <TableCell align="right">Msgs out</TableCell>
                    <TableCell align="right">Total msgs</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lineDialogRows.map(({ employee, line }) => (
                    <TableRow key={employee.employeeId} hover>
                      <TableCell>
                        {employee.fullName?.trim() ||
                          `${employee.firstName} ${employee.lastName}`.trim() ||
                          `Employee ${employee.employeeId}`}
                      </TableCell>
                      <TableCell align="right">{line.incomingCalls}</TableCell>
                      <TableCell align="right">{line.outgoingCalls}</TableCell>
                      <TableCell align="right">{line.totalCalls}</TableCell>
                      <TableCell align="right">{line.incomingMessages}</TableCell>
                      <TableCell align="right">{line.outgoingMessages}</TableCell>
                      <TableCell align="right">{line.totalMessages}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLineDialogLine(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </LocalizationProvider>
  );
}
