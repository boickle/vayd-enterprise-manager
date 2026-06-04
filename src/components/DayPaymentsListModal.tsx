import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
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
import dayjs from 'dayjs';
import {
  fetchPaymentsReconciliation,
  flattenPaymentsByType,
  type PaymentDayRow,
  type ReconciliationClient,
} from '../api/payments';

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    Number(n) || 0
  );
}

function clientLabel(c?: ReconciliationClient) {
  if (!c) return '—';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '—';
}

type PaymentTypeSummary = {
  typeName: string;
  count: number;
  total: number;
};

type Props = {
  open: boolean;
  date: string;
  onClose: () => void;
};

export default function DayPaymentsListModal({ open, date, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentDayRow[]>([]);
  const [typeSummaries, setTypeSummaries] = useState<PaymentTypeSummary[]>([]);

  const dateKey = date.slice(0, 10);
  const dateLabel = dayjs(dateKey).format('dddd, MMM D, YYYY');

  useEffect(() => {
    if (!open || !dateKey) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setPayments([]);
    setTypeSummaries([]);

    (async () => {
      try {
        const res = await fetchPaymentsReconciliation({ start: dateKey, end: dateKey });
        if (!alive) return;

        const summaries: PaymentTypeSummary[] = Object.entries(res.byPaymentType ?? {}).map(
          ([typeName, list]) => {
            const rows = list ?? [];
            return {
              typeName,
              count: rows.length,
              total: rows.reduce((sum, p) => sum + Number(p.amount ?? 0), 0),
            };
          }
        );
        summaries.sort((a, b) => b.total - a.total || a.typeName.localeCompare(b.typeName));
        setTypeSummaries(summaries);

        const all = flattenPaymentsByType(res.byPaymentType).filter(
          (p) => String(p.date).slice(0, 10) === dateKey
        );
        all.sort((a, b) => {
          const ta = a.depositDate ?? a.date ?? '';
          const tb = b.depositDate ?? b.date ?? '';
          return tb.localeCompare(ta);
        });
        setPayments(all);
      } catch (e: unknown) {
        if (!alive) return;
        console.error('Day payments list load failed:', e);
        setError('Failed to load payments for this day.');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, dateKey]);

  const grandTotal = useMemo(
    () => typeSummaries.reduce((sum, s) => sum + s.total, 0),
    [typeSummaries]
  );
  const paymentCount = useMemo(
    () => typeSummaries.reduce((sum, s) => sum + s.count, 0),
    [typeSummaries]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      <DialogTitle>All payments — {dateLabel}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Box mb={2}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Totals by payment type
              </Typography>
              {typeSummaries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No payments recorded for this day.
                </Typography>
              ) : (
                <Grid container spacing={1.5}>
                  {typeSummaries.map((s) => (
                    <Grid item xs={12} sm={6} md={4} key={s.typeName}>
                      <Paper variant="outlined" sx={{ p: 1.5 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {s.typeName}
                        </Typography>
                        <Typography variant="h6" fontWeight={700}>
                          {fmtUSD(s.total)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {s.count} payment{s.count === 1 ? '' : 's'}
                        </Typography>
                      </Paper>
                    </Grid>
                  ))}
                  <Grid item xs={12}>
                    <Divider sx={{ my: 0.5 }} />
                    <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                      <Typography variant="body2">
                        <strong>{paymentCount}</strong> payment{paymentCount === 1 ? '' : 's'}{' '}
                        total
                      </Typography>
                      <Typography variant="body2">
                        Grand total: <strong>{fmtUSD(grandTotal)}</strong>
                      </Typography>
                    </Stack>
                  </Grid>
                </Grid>
              )}
            </Box>

            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Payment list
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <strong>Client</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Payment type</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>Amount</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Date</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Deposit</strong>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                      <strong>ID</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id} hover>
                      <TableCell>{clientLabel(p.client)}</TableCell>
                      <TableCell>{p.paymentTypeName ?? '—'}</TableCell>
                      <TableCell align="right">{fmtUSD(p.amount)}</TableCell>
                      <TableCell>{p.date}</TableCell>
                      <TableCell>{p.depositDate ?? '—'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                        {p.id}
                      </TableCell>
                    </TableRow>
                  ))}
                  {payments.length === 0 && !error && (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 4 }} color="text.secondary">
                        No payments recorded for this day
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
