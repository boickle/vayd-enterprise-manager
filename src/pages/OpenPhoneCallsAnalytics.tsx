import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Collapse,
  FormControl,
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
  Typography,
} from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchOpenPhoneCallSummary,
  type OpenPhoneCallSummaryResponse,
  type OpenPhoneReceptionistSummary,
} from '../api/openphoneCalls';

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
  value: number;
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

export default function OpenPhoneCallsAnalyticsPage() {
  const [preset, setPreset] = useState<string>('7D');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['7D']());
  const [data, setData] = useState<OpenPhoneCallSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
      } catch (err: unknown) {
        if (!alive) return;
        const msg = err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : 'Failed to load call summary';
        setError(msg);
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fromIso, toIso]);

  const chartRows = useMemo(() => {
    const rows = data?.receptionists ?? [];
    return rows.map((r) => ({
      name: r.fullName?.trim() || `${r.firstName} ${r.lastName}`.trim() || `Employee ${r.employeeId}`,
      totalCalls: r.totals.totalCalls,
      totalMessages: r.totals.totalMessages,
      incoming: r.totals.incomingCalls,
      missed: r.totals.missedIncomingCalls,
      outgoing: r.totals.outgoingCalls,
    }));
  }, [data]);

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        <Typography variant="body2" color="text.secondary">
          Calls and SMS messages from OpenPhone webhooks, attributed to active Receptionist employees by phone number.
          Range uses your local timezone for day boundaries.
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
                <KpiCard title="Missed (incoming)" value={data.totals.missedIncomingCalls} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <KpiCard title="Outgoing" value={data.totals.outgoingCalls} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <KpiCard title="Total calls" value={data.totals.totalCalls} />
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

            {chartRows.length > 0 ? (
              <Card variant="outlined">
                <CardHeader title="Calls and messages by receptionist" />
                <CardContent sx={{ height: Math.min(120 + chartRows.length * 36, 480) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRows} layout="vertical" margin={{ left: 8, right: 24 }}>
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
              <CardHeader title="Receptionists" />
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
                      {data.receptionists.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10}>
                            <Typography color="text.secondary" sx={{ py: 2 }}>
                              No receptionist rows in this range. Ensure Receptionist users have phone1/phone2 set and
                              webhooks are reaching the API.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.receptionists.map((r: OpenPhoneReceptionistSummary) => (
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
                                {r.warning ? (
                                  <Typography variant="caption" color="warning.main" display="block">
                                    {r.warning}
                                  </Typography>
                                ) : null}
                              </TableCell>
                              <TableCell>{r.phoneNumber}</TableCell>
                              <TableCell align="right">{r.totals.incomingCalls}</TableCell>
                              <TableCell align="right">{r.totals.missedIncomingCalls}</TableCell>
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
                                        {(r.numbers ?? []).map((n) => (
                                          <TableRow key={n.phoneNumberId}>
                                            <TableCell>{n.label ?? '—'}</TableCell>
                                            <TableCell>{n.phoneNumber}</TableCell>
                                            <TableCell align="right">{n.incomingCalls}</TableCell>
                                            <TableCell align="right">{n.missedIncomingCalls}</TableCell>
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
    </LocalizationProvider>
  );
}
