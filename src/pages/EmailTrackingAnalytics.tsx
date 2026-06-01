import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
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
  TextField,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
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
  fetchNotificationAnalytics,
  fetchNotificationRecords,
  formatNotificationKindLabel,
  formatOpenRate,
  NOTIFICATION_ANALYTICS_TIMEZONE,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_STATUS_LABELS,
  type NotificationChannel,
  type NotificationKind,
  type NotificationOutboxAnalyticsResponse,
  type NotificationOutboxRecord,
  type NotificationStatus,
} from '../api/notificationAnalytics';

const RECORDS_PAGE_SIZE = 50;

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

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.format('MMM D, YYYY h:mm A') : iso;
}

function recipientLabel(row: NotificationOutboxRecord): string {
  if (row.channel === 'email') return row.email?.trim() || '—';
  return row.phone?.trim() || '—';
}

export default function EmailTrackingAnalyticsPage() {
  const recordsRef = useRef<HTMLDivElement>(null);
  const [allTime, setAllTime] = useState(false);
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [practiceIdInput, setPracticeIdInput] = useState('');
  const [summary, setSummary] = useState<NotificationOutboxAnalyticsResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [records, setRecords] = useState<NotificationOutboxRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [recordKind, setRecordKind] = useState<NotificationKind | ''>('');
  const [recordChannel, setRecordChannel] = useState<NotificationChannel | ''>('');
  const [recordStatus, setRecordStatus] = useState<NotificationStatus | ''>('');

  const practiceIdParsed = useMemo(() => {
    const t = practiceIdInput.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [practiceIdInput]);

  const fetchParams = useMemo(
    () => ({
      allTime,
      startDate: allTime ? undefined : toLocalDateStr(range.from),
      endDate: allTime ? undefined : toLocalDateStr(range.to),
      timeZone: NOTIFICATION_ANALYTICS_TIMEZONE,
      practiceId: practiceIdParsed,
    }),
    [allTime, range.from, range.to, practiceIdParsed]
  );

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetchNotificationAnalytics(fetchParams);
      setSummary(res);
    } catch (e: unknown) {
      console.error('Notification analytics failed:', e);
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) {
        setSummaryError(
          'You do not have access to email tracking analytics (admin, owner, or superadmin required).'
        );
      } else {
        setSummaryError('Failed to load email tracking analytics.');
      }
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [fetchParams]);

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    setRecordsError(null);
    try {
      const res = await fetchNotificationRecords({
        ...fetchParams,
        page: recordsPage,
        limit: RECORDS_PAGE_SIZE,
        kind: recordKind || undefined,
        channel: recordChannel || undefined,
        status: recordStatus || undefined,
      });
      setRecords(res.records ?? []);
      setRecordsTotal(res.total ?? 0);
    } catch (e: unknown) {
      console.error('Notification records failed:', e);
      setRecordsError('Failed to load notification records.');
      setRecords([]);
      setRecordsTotal(0);
    } finally {
      setRecordsLoading(false);
    }
  }, [fetchParams, recordsPage, recordKind, recordChannel, recordStatus]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const dailyChartData = useMemo(() => {
    if (!summary?.daily) return [];
    if (allTime) {
      return summary.daily.map((d) => ({
        date: d.date,
        label: d.date,
        emailsSent: d.emailsSent,
        smsSent: d.smsSent,
        emailsOpened: d.emailsOpened,
      }));
    }
    const byDate = new Map(summary.daily.map((d) => [d.date, d]));
    const dates = dateRangeInclusive(range.from, range.to);
    return dates.map((date) => {
      const row = byDate.get(date);
      return {
        date,
        label: date,
        emailsSent: row?.emailsSent ?? 0,
        smsSent: row?.smsSent ?? 0,
        emailsOpened: row?.emailsOpened ?? 0,
      };
    });
  }, [summary?.daily, allTime, range.from, range.to]);

  const breakdownRows = useMemo(() => {
    const rows = [...(summary?.byKindAndChannel ?? [])];
    rows.sort((a, b) => b.sent - a.sent);
    return rows;
  }, [summary?.byKindAndChannel]);

  const statusChartData = useMemo(() => {
    return (summary?.byStatus ?? []).map((s) => ({
      status: NOTIFICATION_STATUS_LABELS[s.status] ?? s.status,
      count: s.count,
    }));
  }, [summary?.byStatus]);

  const recordsTotalPages = Math.max(1, Math.ceil(recordsTotal / RECORDS_PAGE_SIZE));

  const applyBreakdownFilter = (kind: NotificationKind, channel: NotificationChannel) => {
    setRecordKind(kind);
    setRecordChannel(channel);
    setRecordStatus('');
    setRecordsPage(1);
    recordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const clearRecordFilters = () => {
    setRecordKind('');
    setRecordChannel('');
    setRecordStatus('');
    setRecordsPage(1);
  };

  const shiftRange = (direction: -1 | 1) => {
    const days = range.to.startOf('day').diff(range.from.startOf('day'), 'day') + 1;
    const shift = days * direction;
    setRange((r) => ({
      from: r.from.add(shift, 'day'),
      to: r.to.add(shift, 'day'),
    }));
    setRecordsPage(1);
  };

  const s = summary?.summary;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ py: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Promotional and reminder emails and SMS from the notification outbox. Open rates apply
          to trackable emails only (image-blocking clients undercount opens). Survey invites are
          not included.
          {allTime ? ' Showing all time.' : ` Dates use ${NOTIFICATION_ANALYTICS_TIMEZONE}.`}
        </Typography>

        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={allTime}
                onChange={(_, c) => {
                  setAllTime(c);
                  setRecordsPage(1);
                }}
                disabled={summaryLoading}
              />
            }
            label="All time"
          />
          {!allTime ? (
            <>
              {Object.keys(PRESETS).map((key) => (
                <Button
                  key={key}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setRange(PRESETS[key]());
                    setRecordsPage(1);
                  }}
                >
                  {key}
                </Button>
              ))}
              <IconButton
                aria-label="Previous range"
                onClick={() => shiftRange(-1)}
                disabled={summaryLoading}
                size="small"
              >
                <ChevronLeft fontSize="small" />
              </IconButton>
              <IconButton
                aria-label="Next range"
                onClick={() => shiftRange(1)}
                disabled={summaryLoading}
                size="small"
              >
                <ChevronRight fontSize="small" />
              </IconButton>
              <DatePicker
                label="From"
                value={range.from}
                onChange={(v) => {
                  if (v) {
                    setRange((r) => ({ ...r, from: v }));
                    setRecordsPage(1);
                  }
                }}
                slotProps={{ textField: { size: 'small' } }}
              />
              <DatePicker
                label="To"
                value={range.to}
                onChange={(v) => {
                  if (v) {
                    setRange((r) => ({ ...r, to: v }));
                    setRecordsPage(1);
                  }
                }}
                slotProps={{ textField: { size: 'small' } }}
              />
            </>
          ) : null}
          <TextField
            size="small"
            label="Practice ID (optional)"
            value={practiceIdInput}
            onChange={(e) => {
              setPracticeIdInput(e.target.value);
              setRecordsPage(1);
            }}
            sx={{ width: 180 }}
            placeholder="All"
          />
          <Button
            variant="contained"
            onClick={() => {
              void loadSummary();
              void loadRecords();
            }}
            disabled={summaryLoading}
          >
            Refresh
          </Button>
        </Stack>

        {summaryError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {summaryError}
          </Alert>
        ) : null}

        {summaryLoading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : summary && s ? (
          <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <KpiCard title="Total notifications" value={s.total} />
              </Grid>
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <KpiCard title="Sent" value={s.sent} />
              </Grid>
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <KpiCard title="Emails sent" value={s.emailsSent} />
              </Grid>
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <KpiCard title="SMS sent" value={s.smsSent} />
              </Grid>
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <KpiCard title="Failed" value={s.failed} />
              </Grid>
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <KpiCard
                  title="Email open rate"
                  value={formatOpenRate(s.emailOpenRate)}
                  subtitle={
                    s.emailsTrackable > 0
                      ? `${s.emailsOpened} opened of ${s.emailsTrackable} trackable`
                      : 'No trackable emails in range'
                  }
                />
              </Grid>
            </Grid>

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Daily volume
              </Typography>
              {dailyChartData.length === 0 ? (
                <Typography color="text.secondary">No daily series for this range.</Typography>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={dailyChartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} width={40} />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="emailsSent"
                      name="Emails sent"
                      stroke="#1976d2"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="smsSent"
                      name="SMS sent"
                      stroke="#2e7d32"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="emailsOpened"
                      name="Emails opened"
                      stroke="#ed6c02"
                      dot={false}
                      strokeDasharray="4 4"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Paper>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={8}>
                <Card variant="outlined">
                  <CardHeader
                    title="By notification type"
                    subheader="Click a row to filter the detail table below"
                  />
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Kind</TableCell>
                          <TableCell>Channel</TableCell>
                          <TableCell align="right">Sent</TableCell>
                          <TableCell align="right">Failed</TableCell>
                          <TableCell align="right">Pending</TableCell>
                          <TableCell align="right">Open rate</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {breakdownRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <Typography color="text.secondary">No data</Typography>
                            </TableCell>
                          </TableRow>
                        ) : (
                          breakdownRows.map((row) => (
                            <TableRow
                              key={`${row.kind}-${row.channel}`}
                              hover
                              sx={{ cursor: 'pointer' }}
                              onClick={() => applyBreakdownFilter(row.kind, row.channel)}
                            >
                              <TableCell>{formatNotificationKindLabel(row.kind)}</TableCell>
                              <TableCell>
                                {NOTIFICATION_CHANNEL_LABELS[row.channel] ?? row.channel}
                              </TableCell>
                              <TableCell align="right">{row.sent}</TableCell>
                              <TableCell align="right">{row.failed}</TableCell>
                              <TableCell align="right">{row.pending + row.processing}</TableCell>
                              <TableCell align="right">
                                {row.channel === 'email' ? formatOpenRate(row.emailOpenRate) : '—'}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardHeader title="By status" />
                  {statusChartData.length === 0 ? (
                    <CardContent>
                      <Typography color="text.secondary">No data</Typography>
                    </CardContent>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={statusChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis type="category" dataKey="status" width={88} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="count" name="Count" fill="#5c6bc0" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </Grid>
            </Grid>

            <Box ref={recordsRef}>
              <Card variant="outlined">
                <CardHeader
                  title="Notification records"
                  action={
                    recordKind || recordChannel || recordStatus ? (
                      <Button size="small" onClick={clearRecordFilters}>
                        Clear filters
                      </Button>
                    ) : null
                  }
                />
                <CardContent sx={{ pt: 0 }}>
                  <Stack direction="row" flexWrap="wrap" gap={2} sx={{ mb: 2 }}>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel>Kind</InputLabel>
                      <Select
                        label="Kind"
                        value={recordKind}
                        onChange={(e) => {
                          setRecordKind(e.target.value as NotificationKind | '');
                          setRecordsPage(1);
                        }}
                      >
                        <MenuItem value="">All</MenuItem>
                        {(Object.keys(NOTIFICATION_KIND_LABELS) as NotificationKind[]).map((k) => (
                          <MenuItem key={k} value={k}>
                            {formatNotificationKindLabel(k)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <InputLabel>Channel</InputLabel>
                      <Select
                        label="Channel"
                        value={recordChannel}
                        onChange={(e) => {
                          setRecordChannel(e.target.value as NotificationChannel | '');
                          setRecordsPage(1);
                        }}
                      >
                        <MenuItem value="">All</MenuItem>
                        <MenuItem value="email">Email</MenuItem>
                        <MenuItem value="sms">SMS</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                      <InputLabel>Status</InputLabel>
                      <Select
                        label="Status"
                        value={recordStatus}
                        onChange={(e) => {
                          setRecordStatus(e.target.value as NotificationStatus | '');
                          setRecordsPage(1);
                        }}
                      >
                        <MenuItem value="">All</MenuItem>
                        {Object.entries(NOTIFICATION_STATUS_LABELS).map(([value, label]) => (
                          <MenuItem key={value} value={value}>
                            {label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>

                  {recordsError ? (
                    <Alert severity="error" sx={{ mb: 2 }}>
                      {recordsError}
                    </Alert>
                  ) : null}

                  {recordsLoading ? (
                    <Box display="flex" justifyContent="center" py={4}>
                      <CircularProgress size={32} />
                    </Box>
                  ) : (
                    <>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Sent / created</TableCell>
                              <TableCell>Kind</TableCell>
                              <TableCell>Channel</TableCell>
                              <TableCell>Status</TableCell>
                              <TableCell>Recipient</TableCell>
                              <TableCell>Opened</TableCell>
                              <TableCell>Error</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {records.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={7}>
                                  <Typography color="text.secondary">No records</Typography>
                                </TableCell>
                              </TableRow>
                            ) : (
                              records.map((row) => (
                                <TableRow key={row.id}>
                                  <TableCell>
                                    {formatDateTime(row.sentAt ?? row.created)}
                                  </TableCell>
                                  <TableCell>{formatNotificationKindLabel(row.kind)}</TableCell>
                                  <TableCell>
                                    {NOTIFICATION_CHANNEL_LABELS[row.channel] ?? row.channel}
                                  </TableCell>
                                  <TableCell>
                                    {NOTIFICATION_STATUS_LABELS[row.status] ?? row.status}
                                  </TableCell>
                                  <TableCell>{recipientLabel(row)}</TableCell>
                                  <TableCell>
                                    {row.channel === 'email' && row.emailOpenedAt
                                      ? formatDateTime(row.emailOpenedAt)
                                      : row.channel === 'email'
                                        ? 'No'
                                        : '—'}
                                  </TableCell>
                                  <TableCell>
                                    <Typography
                                      variant="body2"
                                      color="error"
                                      sx={{ maxWidth: 200 }}
                                      noWrap
                                      title={row.errorMessage ?? undefined}
                                    >
                                      {row.errorMessage ?? '—'}
                                    </Typography>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{ mt: 2 }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {recordsTotal} total · page {recordsPage} of {recordsTotalPages}
                        </Typography>
                        <Stack direction="row" gap={1}>
                          <Button
                            size="small"
                            disabled={recordsPage <= 1 || recordsLoading}
                            onClick={() => setRecordsPage((p) => Math.max(1, p - 1))}
                          >
                            Previous
                          </Button>
                          <Button
                            size="small"
                            disabled={recordsPage >= recordsTotalPages || recordsLoading}
                            onClick={() => setRecordsPage((p) => p + 1)}
                          >
                            Next
                          </Button>
                        </Stack>
                      </Stack>
                    </>
                  )}
                </CardContent>
              </Card>
            </Box>
          </>
        ) : null}
      </Box>
    </LocalizationProvider>
  );
}
