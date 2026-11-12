import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
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
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { useAuth } from '../auth/useAuth';
import {
  fetchRoomLoaderDeclineReport,
  type RoomLoaderDeclineRow,
} from '../api/roomLoaderDeclineReport';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  '7D': () => ({ from: dayjs().subtract(6, 'day'), to: dayjs() }),
  '30D': () => ({ from: dayjs().subtract(29, 'day'), to: dayjs() }),
  '90D': () => ({ from: dayjs().subtract(89, 'day'), to: dayjs() }),
  YTD: () => ({ from: dayjs().startOf('year'), to: dayjs() }),
};

const ALL = '';

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.format('MMM D, YYYY h:mm A') : iso;
}

export default function RoomLoaderDeclinesReportPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [preset, setPreset] = useState('30D');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [rows, setRows] = useState<RoomLoaderDeclineRow[]>([]);
  const [byProvider, setByProvider] = useState<{ providerName: string; count: number }[]>([]);
  const [byStaff, setByStaff] = useState<{ staffName: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState(ALL);
  const [staffFilter, setStaffFilter] = useState(ALL);

  const startStr = toLocalDateStr(range.from.startOf('day'));
  const endStr = toLocalDateStr(range.to.startOf('day'));
  const isSingleDay = range.from.isSame(range.to, 'day');

  const shiftRange = (direction: -1 | 1) => {
    const days = range.to.startOf('day').diff(range.from.startOf('day'), 'day') + 1;
    const shift = days * direction;
    setPreset('');
    setRange((r) => ({
      from: r.from.add(shift, 'day'),
      to: r.to.add(shift, 'day'),
    }));
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchRoomLoaderDeclineReport({
      startDate: startStr,
      endDate: endStr,
      practiceId,
      token,
    })
      .then((data) => {
        if (!alive) return;
        setRows(data.rows);
        setByProvider(data.byProvider);
        setByStaff(data.byStaff);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to load Room Loader declines.');
        setRows([]);
        setByProvider([]);
        setByStaff([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [startStr, endStr, practiceId, token]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (providerFilter && (row.providerName || 'Unassigned') !== providerFilter) return false;
        if (staffFilter && (row.declinedByName || 'Unknown') !== staffFilter) return false;
        return true;
      }),
    [rows, providerFilter, staffFilter]
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Room Loader declines
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Staff declines of items the owner already accepted on the pre-visit Room Loader form,
          with the reason they entered. Counts are by the appointment provider and the staff
          member who declined.
        </Typography>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Date range"
            action={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(['7D', '30D', '90D', 'YTD'] as const).map((key) => (
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
              onClick={() => shiftRange(-1)}
              size="small"
            >
              <ChevronLeft />
            </IconButton>
            <DatePicker
              label="From"
              value={range.from}
              onChange={(d) => {
                if (!d) return;
                setPreset('');
                setRange((r) => ({ from: d, to: r.to.isBefore(d) ? d : r.to }));
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="To"
              value={range.to}
              onChange={(d) => {
                if (!d) return;
                setPreset('');
                setRange((r) => ({ from: r.from.isAfter(d) ? d : r.from, to: d }));
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
            <IconButton
              aria-label={isSingleDay ? 'Next day' : 'Next period'}
              onClick={() => shiftRange(1)}
              size="small"
            >
              <ChevronRight />
            </IconButton>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="rl-decline-provider">Appt provider</InputLabel>
              <Select
                labelId="rl-decline-provider"
                label="Appt provider"
                value={providerFilter}
                onChange={(e) => setProviderFilter(String(e.target.value))}
              >
                <MenuItem value={ALL}>All providers</MenuItem>
                {byProvider.map((row) => (
                  <MenuItem key={row.providerName} value={row.providerName}>
                    {row.providerName} ({row.count})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id="rl-decline-staff">Declined by</InputLabel>
              <Select
                labelId="rl-decline-staff"
                label="Declined by"
                value={staffFilter}
                onChange={(e) => setStaffFilter(String(e.target.value))}
              >
                <MenuItem value={ALL}>All staff</MenuItem>
                {byStaff.map((row) => (
                  <MenuItem key={row.staffName} value={row.staffName}>
                    {row.staffName} ({row.count})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </CardContent>
        </Card>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 2,
                mb: 3,
              }}
            >
              <Card>
                <CardHeader title="By appointment provider" />
                <CardContent sx={{ pt: 0 }}>
                  {byProvider.length === 0 ? (
                    <Typography color="text.secondary">No declines in this range.</Typography>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Provider</TableCell>
                          <TableCell align="right">Declines</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {byProvider.map((row) => (
                          <TableRow key={row.providerName}>
                            <TableCell>{row.providerName}</TableCell>
                            <TableCell align="right">{row.count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader title="By staff who declined" />
                <CardContent sx={{ pt: 0 }}>
                  {byStaff.length === 0 ? (
                    <Typography color="text.secondary">No declines in this range.</Typography>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Staff</TableCell>
                          <TableCell align="right">Declines</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {byStaff.map((row) => (
                          <TableRow key={row.staffName}>
                            <TableCell>{row.staffName}</TableCell>
                            <TableCell align="right">{row.count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </Box>

            <Card>
              <CardHeader
                title="Decline reasons"
                subheader={`${filtered.length} of ${rows.length} in ${startStr === endStr ? startStr : `${startStr} → ${endStr}`}`}
              />
              <CardContent sx={{ pt: 0 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Declined</TableCell>
                        <TableCell>Patient</TableCell>
                        <TableCell>Item</TableCell>
                        <TableCell>Reason</TableCell>
                        <TableCell>Appt provider</TableCell>
                        <TableCell>Declined by</TableCell>
                        <TableCell>Appointment</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <Typography color="text.secondary">
                              No Room Loader decline reasons in this range.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((row) => (
                          <TableRow key={row.orderId}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {formatWhen(row.declinedAt)}
                            </TableCell>
                            <TableCell>{row.patientName}</TableCell>
                            <TableCell>{row.itemName}</TableCell>
                            <TableCell sx={{ minWidth: 180 }}>{row.reason}</TableCell>
                            <TableCell>{row.providerName || 'Unassigned'}</TableCell>
                            <TableCell>{row.declinedByName || 'Unknown'}</TableCell>
                            <TableCell>
                              {formatWhen(row.appointmentStart)}
                              {row.appointmentId ? ` · #${row.appointmentId}` : ''}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </>
        )}
      </Box>
    </LocalizationProvider>
  );
}
