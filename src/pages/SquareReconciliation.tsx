// Square Reconciliation – compare our payments vs Square, superadmin only
import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Typography,
  Alert,
  CircularProgress,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Tabs,
  Tab,
  Chip,
  Stack,
} from '@mui/material';
import { CheckCircle, Warning, Error } from '@mui/icons-material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  fetchPaymentsReconciliation,
  type PaymentsReconciliationResponse,
  type ReconciliationMatch,
  type ReconciliationPaymentOurs,
  type ReconciliationPaymentSquare,
} from '../api/payments';

dayjs.extend(utc);

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}
function toISODate(d: Dayjs) {
  return d.utc().format('YYYY-MM-DD');
}

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  '7D': () => ({ from: dayjs().subtract(6, 'day'), to: dayjs() }),
  '30D': () => ({ from: dayjs().subtract(29, 'day'), to: dayjs() }),
  '90D': () => ({ from: dayjs().subtract(89, 'day'), to: dayjs() }),
  YTD: () => ({ from: dayjs().startOf('year'), to: dayjs() }),
};

function clientLabel(c?: ReconciliationPaymentOurs['client']) {
  if (!c) return '—';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '—';
}

export default function SquareReconciliationPage() {
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(PRESETS['7D']());
  const [data, setData] = useState<PaymentsReconciliationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetchPaymentsReconciliation({
          start: toISODate(range.from),
          end: toISODate(range.to),
        });
        if (!alive) return;
        setData(res);
      } catch (err: any) {
        if (!alive) return;
        setError(err?.message ?? 'Failed to load reconciliation data');
        setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [range.from, range.to]);

  const cc = data?.creditCardReconciliation ?? null;
  const matchedCount = cc?.matched.length ?? 0;
  const unmatchedOursCount = cc?.unmatchedInOurs.length ?? 0;
  const unmatchedSquareCount = cc?.unmatchedInSquare.length ?? 0;
  const matchedTotal = cc?.matched.reduce((sum, m) => sum + m.ours.amount, 0) ?? 0;
  const unmatchedOursTotal = cc?.unmatchedInOurs.reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const unmatchedSquareTotal = cc?.unmatchedInSquare.reduce((sum, p) => sum + p.amountCents / 100, 0) ?? 0;
  const hasDiscrepancies = unmatchedOursCount > 0 || unmatchedSquareCount > 0;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box p={3} display="flex" flexDirection="column" gap={3}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <Typography variant="h5" fontWeight={600}>
              Square Reconciliation
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Compare our payments vs Square to find discrepancies.
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {Object.entries(PRESETS).map(([k, fn]) => (
                <Chip
                  key={k}
                  label={k}
                  onClick={() => setRange(fn())}
                  variant={range.from.isSame(fn().from, 'day') ? 'filled' : 'outlined'}
                  size="small"
                />
              ))}
              <DatePicker
                label="Start"
                value={range.from}
                onChange={(d) => d && setRange((r) => ({ ...r, from: d }))}
                slotProps={{ textField: { size: 'small', sx: { minWidth: 130 } } }}
              />
              <DatePicker
                label="End"
                value={range.to}
                onChange={(d) => d && setRange((r) => ({ ...r, to: d }))}
                slotProps={{ textField: { size: 'small', sx: { minWidth: 130 } } }}
              />
            </Stack>
          </Grid>
        </Grid>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
            <CircularProgress />
          </Box>
        ) : data ? (
          <>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <Card variant="outlined" sx={{ borderColor: 'success.main' }}>
                  <CardHeader
                    avatar={<CheckCircle color="success" />}
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="Matched"
                  />
                  <CardContent>
                    <Typography variant="h5" fontWeight={700}>
                      {matchedCount}
                    </Typography>
                    <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ mt: 0.5 }}>
                      {fmtUSD(matchedTotal)}
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                      Payments in both systems
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Card variant="outlined" sx={{ borderColor: unmatchedOursCount ? 'warning.main' : undefined }}>
                  <CardHeader
                    avatar={<Warning color={unmatchedOursCount ? 'warning' : 'action'} />}
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="Unmatched (Ours)"
                  />
                  <CardContent>
                    <Typography variant="h5" fontWeight={700} color={unmatchedOursCount ? 'warning.main' : undefined}>
                      {unmatchedOursCount}
                    </Typography>
                    <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ mt: 0.5 }}>
                      {fmtUSD(unmatchedOursTotal)}
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                      In our system only
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={4}>
                <Card variant="outlined" sx={{ borderColor: unmatchedSquareCount ? 'error.main' : undefined }}>
                  <CardHeader
                    avatar={<Error color={unmatchedSquareCount ? 'error' : 'action'} />}
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="Unmatched (Square)"
                  />
                  <CardContent>
                    <Typography variant="h5" fontWeight={700} color={unmatchedSquareCount ? 'error.main' : undefined}>
                      {unmatchedSquareCount}
                    </Typography>
                    <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ mt: 0.5 }}>
                      {fmtUSD(unmatchedSquareTotal)}
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                      In Square only
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {hasDiscrepancies && (
              <Alert severity="warning">
                Discrepancies found. Review the Unmatched tabs below.
              </Alert>
            )}

            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label={`Matched (${matchedCount})`} />
              <Tab label={`Unmatched in Ours (${unmatchedOursCount})`} />
              <Tab label={`Unmatched in Square (${unmatchedSquareCount})`} />
            </Tabs>

            {tab === 0 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Client</strong></TableCell>
                      <TableCell><strong>Payment Type</strong></TableCell>
                      <TableCell align="right"><strong>Amount (Ours)</strong></TableCell>
                      <TableCell align="right"><strong>Matched Amount (Square)</strong></TableCell>
                      <TableCell><strong>Date</strong></TableCell>
                      <TableCell><strong>Match</strong></TableCell>
                      <TableCell><strong>Square ID</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cc?.matched.map((m: ReconciliationMatch) => (
                      <TableRow key={`${m.ours.id}-${m.square.id}`}>
                        <TableCell>{clientLabel(m.ours.client)}</TableCell>
                        <TableCell>{m.ours.paymentTypeName ?? '—'}</TableCell>
                        <TableCell align="right">{fmtUSD(m.ours.amount)}</TableCell>
                        <TableCell align="right">{fmtUSD(m.square.amountCents / 100)}</TableCell>
                        <TableCell>{m.ours.date}</TableCell>
                        <TableCell>
                          <Chip size="small" label={m.matchMethod ?? '—'} variant="outlined" />
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{m.square.id}</TableCell>
                      </TableRow>
                    ))}
                    {matchedCount === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 4 }} color="text.secondary">
                          No matched payments in this range
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {tab === 1 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>ID</strong></TableCell>
                      <TableCell><strong>Client</strong></TableCell>
                      <TableCell><strong>Payment Type</strong></TableCell>
                      <TableCell align="right"><strong>Amount</strong></TableCell>
                      <TableCell><strong>Date</strong></TableCell>
                      <TableCell><strong>Deposit</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cc?.unmatchedInOurs.map((p: ReconciliationPaymentOurs) => (
                      <TableRow key={p.id}>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{p.id}</TableCell>
                        <TableCell>{clientLabel(p.client)}</TableCell>
                        <TableCell>{p.paymentTypeName ?? '—'}</TableCell>
                        <TableCell align="right">{fmtUSD(p.amount)}</TableCell>
                        <TableCell>{p.date}</TableCell>
                        <TableCell>{p.depositDate ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {unmatchedOursCount === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 4 }} color="text.secondary">
                          No unmatched payments in our system
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {tab === 2 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Square ID</strong></TableCell>
                      <TableCell align="right"><strong>Amount</strong></TableCell>
                      <TableCell><strong>Created</strong></TableCell>
                      <TableCell><strong>Cardholder</strong></TableCell>
                      <TableCell><strong>Email</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cc?.unmatchedInSquare.map((p: ReconciliationPaymentSquare) => (
                      <TableRow key={p.id}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>{p.id}</TableCell>
                        <TableCell align="right">{fmtUSD(p.amountCents / 100)}</TableCell>
                        <TableCell>{p.created_at}</TableCell>
                        <TableCell>{p.cardholderName ?? '—'}</TableCell>
                        <TableCell>{p.buyerEmail ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {unmatchedSquareCount === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 4 }} color="text.secondary">
                          No unmatched payments in Square
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        ) : null}
      </Box>
    </LocalizationProvider>
  );
}
