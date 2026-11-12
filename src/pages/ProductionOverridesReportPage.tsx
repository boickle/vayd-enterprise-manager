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
import {
  listRefillProductionOverrides,
  type RefillProductionOverrideRow,
} from '../api/visitWorkflow';

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

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function errText(e: unknown): string {
  return (
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    (e instanceof Error ? e.message : '') ||
    'Failed to load production overrides.'
  );
}

/** Refills that were given doctor production on purpose, with who did it and why. */
export default function ProductionOverridesReportPage() {
  const [preset, setPreset] = useState('30D');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [rows, setRows] = useState<RefillProductionOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState(ALL);
  const [staffFilter, setStaffFilter] = useState(ALL);

  const startStr = range.from.format('YYYY-MM-DD');
  const endStr = range.to.format('YYYY-MM-DD');
  const isSingleDay = range.from.isSame(range.to, 'day');

  const shiftRange = (direction: -1 | 1) => {
    const days = range.to.startOf('day').diff(range.from.startOf('day'), 'day') + 1;
    const shift = days * direction;
    setPreset('');
    setRange((r) => ({ from: r.from.add(shift, 'day'), to: r.to.add(shift, 'day') }));
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listRefillProductionOverrides(startStr, endStr)
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errText(e));
        setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [startStr, endStr]);

  const byProvider = useMemo(() => {
    const totals = new Map<string, { count: number; amount: number }>();
    for (const row of rows) {
      const key = row.providerName || 'Unknown';
      const t = totals.get(key) ?? { count: 0, amount: 0 };
      t.count += 1;
      t.amount += row.amount;
      totals.set(key, t);
    }
    return [...totals.entries()]
      .map(([providerName, t]) => ({ providerName, ...t }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const staffNames = useMemo(
    () => [...new Set(rows.map((row) => row.overriddenByName || 'Unknown'))].sort(),
    [rows]
  );

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (providerFilter && (row.providerName || 'Unknown') !== providerFilter) return false;
        if (staffFilter && (row.overriddenByName || 'Unknown') !== staffFilter) return false;
        return true;
      }),
    [rows, providerFilter, staffFilter]
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Production overrides
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Refills normally give no one production. These are refill lines where staff gave the
          production to a provider anyway, with the reason they wrote. Dates are when the override
          was made.
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
              <InputLabel id="po-provider">Credited to</InputLabel>
              <Select
                labelId="po-provider"
                label="Credited to"
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
              <InputLabel id="po-staff">Done by</InputLabel>
              <Select
                labelId="po-staff"
                label="Done by"
                value={staffFilter}
                onChange={(e) => setStaffFilter(String(e.target.value))}
              >
                <MenuItem value={ALL}>All staff</MenuItem>
                {staffNames.map((name) => (
                  <MenuItem key={name} value={name}>
                    {name}
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
            <Card sx={{ mb: 3 }}>
              <CardHeader title="By provider credited" />
              <CardContent sx={{ pt: 0 }}>
                {byProvider.length === 0 ? (
                  <Typography color="text.secondary">No overrides in this range.</Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Provider</TableCell>
                        <TableCell align="right">Refills</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {byProvider.map((row) => (
                        <TableRow key={row.providerName}>
                          <TableCell>{row.providerName}</TableCell>
                          <TableCell align="right">{row.count}</TableCell>
                          <TableCell align="right">{money(row.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                title="Overrides"
                subheader={`${filtered.length} of ${rows.length} in ${startStr === endStr ? startStr : `${startStr} → ${endStr}`}`}
              />
              <CardContent sx={{ pt: 0 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>When</TableCell>
                        <TableCell>Invoice</TableCell>
                        <TableCell>Client / patient</TableCell>
                        <TableCell>Refill</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Credited to</TableCell>
                        <TableCell>Reason</TableCell>
                        <TableCell>Done by</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8}>
                            <Typography color="text.secondary">
                              No production overrides in this range.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((row) => (
                          <TableRow key={row.lineId}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {formatWhen(row.overriddenAt)}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {row.invoiceNumber ? `#${row.invoiceNumber}` : '—'}
                              {row.invoiceStatus === 'void' ? ' (void)' : ''}
                            </TableCell>
                            <TableCell>
                              {[row.clientName, row.patientName].filter(Boolean).join(' · ') || '—'}
                            </TableCell>
                            <TableCell>{row.itemName}</TableCell>
                            <TableCell align="right">{money(row.amount)}</TableCell>
                            <TableCell>{row.providerName || 'Unknown'}</TableCell>
                            <TableCell sx={{ minWidth: 200 }}>{row.reason}</TableCell>
                            <TableCell>{row.overriddenByName || 'Unknown'}</TableCell>
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
