import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { listCreditsAndDiscounts, type CreditDiscountRow } from '../api/visitWorkflow';

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  Today: () => ({ from: dayjs(), to: dayjs() }),
  'Last 7 days': () => ({ from: dayjs().subtract(6, 'day'), to: dayjs() }),
  'Last 30 days': () => ({ from: dayjs().subtract(29, 'day'), to: dayjs() }),
};

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
    'Failed to load credits and discounts.'
  );
}

function who(row: CreditDiscountRow): string {
  return row.staffName || (row.source === 'evet' ? 'eVet' : 'Unknown');
}

/** Credits given and discounts taken, by staff, for a date range. */
export default function CreditsDiscountsReportPage() {
  const [preset, setPreset] = useState('Last 7 days');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['Last 7 days']());
  const [rows, setRows] = useState<CreditDiscountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startStr = range.from.format('YYYY-MM-DD');
  const endStr = range.to.format('YYYY-MM-DD');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listCreditsAndDiscounts(startStr, endStr)
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

  const byStaff = useMemo(() => {
    const totals = new Map<string, { credits: number; discounts: number }>();
    for (const row of rows) {
      const key = who(row);
      const t = totals.get(key) ?? { credits: 0, discounts: 0 };
      if (row.kind === 'credit') t.credits += row.amount;
      else t.discounts += row.amount;
      totals.set(key, t);
    }
    return [...totals.entries()]
      .map(([staffName, t]) => ({
        staffName,
        credits: Math.round(t.credits * 100) / 100,
        discounts: Math.round(t.discounts * 100) / 100,
      }))
      .sort((a, b) => b.credits + b.discounts - (a.credits + a.discounts));
  }, [rows]);

  const creditTotal = byStaff.reduce((sum, row) => sum + row.credits, 0);
  const discountTotal = byStaff.reduce((sum, row) => sum + row.discounts, 0);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Credits and discounts
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Account credits and discounts given by staff, and who they were for. Membership plan
          discounts are not included. A credit&apos;s reason is what was written when it was
          given; eVet credits with nothing written show as Misc Credit - eVet.
        </Typography>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Date range"
            action={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(['Today', 'Last 7 days', 'Last 30 days'] as const).map((key) => (
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
                      borderRadius: 16,
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
              <CardHeader
                title="By staff member"
                subheader={`Credits ${money(creditTotal)} · Discounts ${money(discountTotal)}`}
              />
              <CardContent sx={{ pt: 0 }}>
                {byStaff.length === 0 ? (
                  <Typography color="text.secondary">Nothing in this range.</Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Staff</TableCell>
                        <TableCell align="right">Credits</TableCell>
                        <TableCell align="right">Discounts</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {byStaff.map((row) => (
                        <TableRow key={row.staffName}>
                          <TableCell>{row.staffName}</TableCell>
                          <TableCell align="right">{money(row.credits)}</TableCell>
                          <TableCell align="right">{money(row.discounts)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Detail" subheader={`${rows.length} in this range`} />
              <CardContent sx={{ pt: 0 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>When</TableCell>
                        <TableCell>Kind</TableCell>
                        <TableCell>For</TableCell>
                        <TableCell>What</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Given by</TableCell>
                        <TableCell>Reason</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <Typography color="text.secondary">
                              No credits or discounts in this range.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatWhen(row.at)}</TableCell>
                            <TableCell>{row.kind === 'credit' ? 'Credit' : 'Discount'}</TableCell>
                            <TableCell>
                              {[row.clientName, row.patientName].filter(Boolean).join(' · ') || '—'}
                              {row.invoiceNumber ? (
                                <div style={{ color: '#667', fontSize: 12 }}>#{row.invoiceNumber}</div>
                              ) : null}
                            </TableCell>
                            <TableCell>{row.detail || '—'}</TableCell>
                            <TableCell align="right">{money(row.amount)}</TableCell>
                            <TableCell>{who(row)}</TableCell>
                            <TableCell sx={{ minWidth: 180 }}>{row.reason || '—'}</TableCell>
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
