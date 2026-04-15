import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  appointmentMatchesAssignedDoctorIds,
  isEmployeeAnalyticsRestricted,
  normalizeAuthRoles,
} from '../utils/analyticsAccess';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
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
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchAppointmentCancellationsAnalytics,
  type CancelledAppointmentAnalyticsRow,
} from '../api/appointmentCancellationsAnalytics';

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

function dateRange(start: Dayjs, end: Dayjs): string[] {
  const out: string[] = [];
  let d = start.startOf('day');
  const e = end.startOf('day');
  while (!d.isAfter(e)) {
    out.push(toLocalDateStr(d));
    d = d.add(1, 'day');
  }
  return out;
}

/** Linear regression trend for daily cancelled counts (same approach as routing usage charts). */
function addCancelledLinearTrend<T extends { cancelled: number }>(data: T[]): (T & { trend: number })[] {
  if (!data.length) return [];
  const n = data.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = Number(data[i]?.cancelled ?? 0);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = sumY / n - slope * (sumX / n);
  return data.map((row, i) => ({ ...row, trend: Math.max(0, intercept + slope * i) }));
}

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  '1D': () => {
    const now = dayjs().startOf('day');
    return { from: now, to: now };
  },
  '7D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(6, 'day'), to: now };
  },
  '30D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(29, 'day'), to: now };
  },
  '90D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(89, 'day'), to: now };
  },
  YTD: () => {
    const now = dayjs().startOf('day');
    return { from: now.startOf('year'), to: now };
  },
};

const ALL_PROVIDERS = '';

function isCancelledStatus(name: unknown): boolean {
  const n = typeof name === 'string' ? name.trim() : '';
  return n === 'Canceled Appointment' || n === 'Canceled';
}

function getAppointmentStartIso(appt: CancelledAppointmentAnalyticsRow): string | null {
  const v =
    appt.appointmentStart ??
    appt.startIso ??
    appt.scheduledStartIso ??
    appt.appointmentStartIso;
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/** When the cancellation was recorded; used for list ordering (newest first). */
function getCancellationSortTimeIso(appt: CancelledAppointmentAnalyticsRow): string | null {
  const keys = [
    'lastTouchedAt',
    'externalUpdated',
    'cancelledAt',
    'canceledAt',
    'cancellationDate',
    'cancellationTime',
    'cancelDate',
    'cancelTime',
    'statusChangedAt',
    'confirmStatusChangedAt',
    'modifiedAt',
    'updated',
  ] as const;
  for (const k of keys) {
    const v = appt[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function parseToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = dayjs(iso);
  return d.isValid() ? d.valueOf() : null;
}

function appointmentLocalDate(appt: CancelledAppointmentAnalyticsRow): string | null {
  const iso = getAppointmentStartIso(appt);
  if (!iso) return null;
  const d = dayjs(iso);
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

function primaryProviderLabel(appt: CancelledAppointmentAnalyticsRow): string {
  const pp = appt.primaryProvider;
  if (pp && typeof pp === 'object') {
    const o = pp as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const fn = typeof o.firstName === 'string' ? o.firstName.trim() : '';
    const ln = typeof o.lastName === 'string' ? o.lastName.trim() : '';
    const full = typeof o.fullName === 'string' ? o.fullName.trim() : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const joined = [title, fn, ln].filter(Boolean).join(' ').trim();
    if (joined) return joined;
    if (full) return full;
    if (name) return name;
  }
  const fallback =
    (typeof appt.primaryProviderName === 'string' && appt.primaryProviderName.trim()) ||
    (typeof appt.primaryProviderFullName === 'string' && appt.primaryProviderFullName.trim());
  return fallback || '—';
}

function primaryProviderIdSet(appt: CancelledAppointmentAnalyticsRow): Set<string> {
  const s = new Set<string>();
  const pp = appt.primaryProvider;
  if (pp && typeof pp === 'object') {
    const o = pp as Record<string, unknown>;
    for (const k of ['id', 'pimsId', 'employeeId'] as const) {
      const v = o[k];
      if (v != null && String(v).trim() !== '') s.add(String(v));
    }
  }
  const flatId = appt.primaryProviderId;
  if (flatId != null && String(flatId).trim() !== '') s.add(String(flatId));
  return s;
}

function primaryProviderLabelForViewer(
  appt: CancelledAppointmentAnalyticsRow,
  opts: {
    restrict: boolean;
    assignedDoctorIds: string[];
    selectedProviderId: string;
  }
): string {
  const { restrict, assignedDoctorIds, selectedProviderId } = opts;
  if (
    restrict &&
    assignedDoctorIds.length > 0 &&
    selectedProviderId === ALL_PROVIDERS &&
    !appointmentMatchesAssignedDoctorIds(assignedDoctorIds, primaryProviderIdSet(appt))
  ) {
    return '—';
  }
  return primaryProviderLabel(appt);
}

function matchesProviderFilter(
  appt: CancelledAppointmentAnalyticsRow,
  selected: string,
  providers: Provider[]
): boolean {
  if (!selected) return true;
  const p = providers.find((x) => String(x.id) === selected);
  const allowed = new Set<string>([selected]);
  if (p) {
    allowed.add(String(p.id));
    if (p.pimsId != null && String(p.pimsId).trim() !== '') allowed.add(String(p.pimsId));
  }
  const apptKeys = primaryProviderIdSet(appt);
  for (const k of apptKeys) {
    if (allowed.has(k)) return true;
  }
  return false;
}

function patientLabel(appt: CancelledAppointmentAnalyticsRow): string {
  const p = appt.patient;
  if (p && typeof p === 'object') {
    const name = (p as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  const n = appt.patientName;
  if (typeof n === 'string' && n.trim()) return n.trim();
  return '—';
}

function clientLabel(appt: CancelledAppointmentAnalyticsRow): string {
  const c = appt.client;
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    const fn = typeof o.firstName === 'string' ? o.firstName.trim() : '';
    const ln = typeof o.lastName === 'string' ? o.lastName.trim() : '';
    const joined = `${fn} ${ln}`.trim();
    if (joined) return joined;
  }
  const n = appt.clientName;
  if (typeof n === 'string' && n.trim()) return n.trim();
  return '—';
}

function formatModalValue(value: unknown, depth: number): React.ReactNode {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    if (depth >= 4) return JSON.stringify(value);
    const str = JSON.stringify(value, null, 2);
    return (
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          bgcolor: 'action.hover',
          borderRadius: 1,
          fontSize: 12,
          maxHeight: 240,
          overflow: 'auto',
        }}
      >
        {str}
      </Box>
    );
  }
  return String(value);
}

function ModalFieldTable({ row }: { row: CancelledAppointmentAnalyticsRow }) {
  const keys = useMemo(() => Object.keys(row).sort((a, b) => a.localeCompare(b)), [row]);
  return (
    <TableContainer>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Field</TableCell>
            <TableCell>Value</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {keys.map((k) => (
            <TableRow key={k}>
              <TableCell sx={{ verticalAlign: 'top', fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</TableCell>
              <TableCell sx={{ verticalAlign: 'top', wordBreak: 'break-word' }}>
                {formatModalValue(row[k], 0)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function CancellationsAnalytics() {
  const [preset, setPreset] = useState<string>('30D');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [rows, setRows] = useState<CancelledAppointmentAnalyticsRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(ALL_PROVIDERS);
  const [detailRow, setDetailRow] = useState<CancelledAppointmentAnalyticsRow | null>(null);

  const { role, assignedDoctorIds } = useAuth() as {
    role?: string[];
    assignedDoctorIds?: string[];
  };
  const normalizedRoles = normalizeAuthRoles(role);
  const restrictEmployeeAnalytics = isEmployeeAnalyticsRestricted(normalizedRoles);
  const assignedDoctorIdSet = useMemo(
    () => new Set((assignedDoctorIds ?? []).map((x) => String(x).trim()).filter(Boolean)),
    [assignedDoctorIds]
  );
  const start = range.from.startOf('day');
  const end = range.to.startOf('day');
  const startStr = toLocalDateStr(start);
  const endStr = toLocalDateStr(end);
  const isSingleDay = start.isSame(end, 'day');
  const dates = useMemo(() => dateRange(start, end), [start, end]);

  const shiftRange = (direction: -1 | 1) => {
    const days = end.diff(start, 'day') + 1;
    const shift = days * direction;
    setRange((r) => ({
      from: r.from.add(shift, 'day'),
      to: r.to.add(shift, 'day'),
    }));
  };

  useEffect(() => {
    let alive = true;
    fetchPrimaryProviders()
      .then((list) => {
        if (!alive) return;
        setProviders(list ?? []);
        setProvidersError(null);
      })
      .catch((e) => {
        if (!alive) return;
        console.error('fetchPrimaryProviders failed:', e);
        setProvidersError('Could not load provider list for filtering.');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let alive = true;
    fetchAppointmentCancellationsAnalytics({ startDate: startStr, endDate: endStr })
      .then((list) => {
        if (!alive) return;
        setRows(list);
      })
      .catch((e) => {
        if (!alive) return;
        console.error('Appointment cancellations fetch failed:', e);
        setError('Failed to load cancellation data. Ensure the server exposes GET /analytics/appointment-cancellations.');
        setRows(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [startStr, endStr]);

  const cancelledInRange = useMemo(() => {
    const raw = rows ?? [];
    const from = startStr;
    const to = endStr;
    return raw.filter((appt) => {
      if (!isCancelledStatus(appt.confirmStatusName)) return false;
      const d = appointmentLocalDate(appt);
      if (!d) return false;
      return d >= from && d <= to;
    });
  }, [rows, startStr, endStr]);

  const filtered = useMemo(
    () => cancelledInRange.filter((a) => matchesProviderFilter(a, selectedProviderId, providers)),
    [cancelledInRange, selectedProviderId, providers]
  );

  const chartData = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const d of dates) byDate.set(d, 0);
    for (const appt of filtered) {
      const d = appointmentLocalDate(appt);
      if (!d || !byDate.has(d)) continue;
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
    return dates.map((date) => ({
      date,
      cancelled: byDate.get(date) ?? 0,
    }));
  }, [dates, filtered]);

  const chartDataWithTrend = useMemo(() => addCancelledLinearTrend(chartData), [chartData]);

  const sortedList = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const ca = parseToMs(getCancellationSortTimeIso(a)) ?? -1;
      const cb = parseToMs(getCancellationSortTimeIso(b)) ?? -1;
      if (cb !== ca) return cb - ca;
      const sa = parseToMs(getAppointmentStartIso(a)) ?? 0;
      const sb = parseToMs(getAppointmentStartIso(b)) ?? 0;
      return sb - sa;
    });
  }, [filtered]);

  const providerOptions = useMemo(() => {
    const allLabel = restrictEmployeeAnalytics ? 'Entire practice' : 'All primary providers';
    const opts = [{ value: ALL_PROVIDERS, label: allLabel }];
    if (!restrictEmployeeAnalytics) {
      for (const p of providers) {
        opts.push({ value: String(p.id), label: p.name || String(p.id) });
      }
      return opts;
    }
    if (!assignedDoctorIdSet.size) return opts;
    for (const p of providers) {
      if (
        assignedDoctorIdSet.has(String(p.id)) ||
        (p.pimsId != null && assignedDoctorIdSet.has(String(p.pimsId)))
      ) {
        opts.push({ value: String(p.id), label: p.name || String(p.id) });
      }
    }
    return opts;
  }, [providers, restrictEmployeeAnalytics, assignedDoctorIdSet]);

  useEffect(() => {
    const allowed = new Set(providerOptions.map((o) => o.value));
    if (!allowed.has(selectedProviderId)) setSelectedProviderId(ALL_PROVIDERS);
  }, [providerOptions, selectedProviderId]);

  const listKey = (appt: CancelledAppointmentAnalyticsRow, index: number) => {
    const id = appt.id ?? appt.pimsId ?? appt.appointmentId;
    if (id != null) return `${String(id)}-${index}`;
    return `idx-${index}`;
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Cancellations
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Counts include appointments whose scheduled start falls in the range below, with{' '}
          <code>confirmStatusName</code> of &quot;Canceled Appointment&quot; or &quot;Canceled&quot;.
        </Typography>

        {providersError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {providersError}
          </Alert>
        )}

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Date range"
            action={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(['1D', '7D', '30D', '90D', 'YTD'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setPreset(key);
                      setRange(PRESETS[key]());
                    }}
                    style={{
                      padding: '6px 12px',
                      border: preset === key ? '2px solid #1976d2' : '1px solid #ccc',
                      borderRadius: 4,
                      background: preset === key ? '#e3f2fd' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {key}
                  </button>
                ))}
              </Box>
            }
          />
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <IconButton
              aria-label={isSingleDay ? 'Previous day' : 'Previous period'}
              onClick={() =>
                isSingleDay
                  ? setRange((r) => ({ from: r.from.subtract(1, 'day'), to: r.from.subtract(1, 'day') }))
                  : shiftRange(-1)
              }
              size="small"
            >
              <ChevronLeft />
            </IconButton>
            <Typography variant="body2" sx={{ minWidth: 200 }}>
              {startStr === endStr ? startStr : `${startStr} → ${endStr}`}
            </Typography>
            <IconButton
              aria-label={isSingleDay ? 'Next day' : 'Next period'}
              onClick={() =>
                isSingleDay
                  ? setRange((r) => ({ from: r.from.add(1, 'day'), to: r.from.add(1, 'day') }))
                  : shiftRange(1)
              }
              size="small"
            >
              <ChevronRight />
            </IconButton>

            <FormControl size="small" sx={{ minWidth: 220, ml: { xs: 0, sm: 2 } }}>
              <InputLabel id="cancellations-provider-label">Primary provider</InputLabel>
              <Select
                labelId="cancellations-provider-label"
                label="Primary provider"
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(String(e.target.value))}
              >
                {providerOptions.map((o) => (
                  <MenuItem key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </CardContent>
        </Card>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Card sx={{ mb: 3 }}>
              <CardHeader title="Cancelled appointments over time" />
              <CardContent sx={{ height: 360 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartDataWithTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => {
                        const num = Number(value ?? 0);
                        const nm = String(name ?? '').toLowerCase();
                        const isTrend = nm === 'trend';
                        return [isTrend ? num.toFixed(1) : String(Math.round(num)), isTrend ? 'Trend' : 'Cancelled'];
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="cancelled"
                      name="Cancelled"
                      stroke="#1565c0"
                      dot={false}
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="trend"
                      name="Trend"
                      stroke="#1565c0"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                title="Appointments in range"
                subheader={`${sortedList.length} cancelled appointment${sortedList.length === 1 ? '' : 's'}`}
              />
              <CardContent sx={{ pt: 0 }}>
                {sortedList.length === 0 ? (
                  <Typography color="text.secondary">No matching cancellations in this range.</Typography>
                ) : (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Scheduled start</TableCell>
                          <TableCell>Patient</TableCell>
                          <TableCell>Client</TableCell>
                          <TableCell>Primary provider</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {sortedList.map((appt, index) => {
                          const startIso = getAppointmentStartIso(appt);
                          const status =
                            typeof appt.confirmStatusName === 'string'
                              ? appt.confirmStatusName
                              : '—';
                          return (
                            <TableRow
                              key={listKey(appt, index)}
                              hover
                              sx={{ cursor: 'pointer' }}
                              onClick={() => setDetailRow(appt)}
                            >
                              <TableCell>
                                {startIso
                                  ? dayjs(startIso).isValid()
                                    ? dayjs(startIso).format('YYYY-MM-DD h:mm A')
                                    : startIso
                                  : '—'}
                              </TableCell>
                              <TableCell>{patientLabel(appt)}</TableCell>
                              <TableCell>{clientLabel(appt)}</TableCell>
                              <TableCell>
                                {primaryProviderLabelForViewer(appt, {
                                  restrict: restrictEmployeeAnalytics,
                                  assignedDoctorIds: Array.from(assignedDoctorIdSet),
                                  selectedProviderId,
                                })}
                              </TableCell>
                              <TableCell>{status}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Dialog open={!!detailRow} onClose={() => setDetailRow(null)} maxWidth="md" fullWidth scroll="paper">
          <DialogTitle>Appointment details</DialogTitle>
          <DialogContent dividers>
            {detailRow && <ModalFieldTable row={detailRow} />}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDetailRow(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </LocalizationProvider>
  );
}
