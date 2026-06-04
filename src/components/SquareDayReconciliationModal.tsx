import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  Paper,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  fetchPaymentsReconciliation,
  filterCreditCardReconciliationForDay,
  type ReconciliationMatch,
  type ReconciliationPaymentOurs,
} from '../api/payments';

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function clientLabel(c?: ReconciliationPaymentOurs['client']) {
  if (!c) return '—';
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '—';
}

type Props = {
  open: boolean;
  date: string;
  onClose: () => void;
};

export default function SquareDayReconciliationModal({ open, date, onClose }: Props) {
  const [rawData, setRawData] = useState<Awaited<
    ReturnType<typeof fetchPaymentsReconciliation>
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  const dateKey = date.slice(0, 10);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setRawData(null);
    setTab(0);
    (async () => {
      try {
        const res = await fetchPaymentsReconciliation({ start: dateKey, end: dateKey });
        if (!alive) return;
        setRawData(res);
      } catch (err: unknown) {
        if (!alive) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load reconciliation data';
        setError(message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, dateKey]);

  const cc = rawData ? filterCreditCardReconciliationForDay(rawData, dateKey) : null;
  const matchedCount = cc?.matched.length ?? 0;
  const unmatchedOursCount = cc?.unmatchedInOurs.length ?? 0;
  const unmatchedSquareCount = cc?.unmatchedInSquare.length ?? 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Square reconciliation — {date}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Matches credit card payments in our system to completed card transactions in Square for
          this day.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        ) : cc ? (
          <>
            <Box display="flex" gap={2} flexWrap="wrap" mb={2}>
              <Chip color="success" variant="outlined" label={`Matched: ${matchedCount}`} />
              <Chip
                color={unmatchedOursCount ? 'warning' : 'default'}
                variant="outlined"
                label={`Unmatched (ours): ${unmatchedOursCount}`}
              />
              <Chip
                color={unmatchedSquareCount ? 'error' : 'default'}
                variant="outlined"
                label={`Unmatched (Square): ${unmatchedSquareCount}`}
              />
            </Box>

            {(unmatchedOursCount > 0 || unmatchedSquareCount > 0) && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Discrepancies found. Review the unmatched tabs below.
              </Alert>
            )}

            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
              <Tab label={`Matched (${matchedCount})`} />
              <Tab label={`Unmatched in Ours (${unmatchedOursCount})`} />
              <Tab label={`Unmatched in Square (${unmatchedSquareCount})`} />
            </Tabs>

            {tab === 0 && (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Client</TableCell>
                      <TableCell>Payment type</TableCell>
                      <TableCell align="right">Amount (ours)</TableCell>
                      <TableCell align="right">Amount (Square)</TableCell>
                      <TableCell>Match</TableCell>
                      <TableCell>Square ID</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cc.matched.map((m: ReconciliationMatch) => (
                      <TableRow key={`${m.ours.id}-${m.square.id}`}>
                        <TableCell>{clientLabel(m.ours.client)}</TableCell>
                        <TableCell>{m.ours.paymentTypeName ?? '—'}</TableCell>
                        <TableCell align="right">{fmtUSD(m.ours.amount)}</TableCell>
                        <TableCell align="right">{fmtUSD(m.square.amountCents / 100)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={m.matchMethod ?? '—'} variant="outlined" />
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                          {m.square.id}
                        </TableCell>
                      </TableRow>
                    ))}
                    {matchedCount === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 3 }} color="text.secondary">
                          No matched credit card payments for this day
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
                      <TableCell>ID</TableCell>
                      <TableCell>Client</TableCell>
                      <TableCell>Payment type</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell>Date</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cc.unmatchedInOurs.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{p.id}</TableCell>
                        <TableCell>{clientLabel(p.client)}</TableCell>
                        <TableCell>{p.paymentTypeName ?? '—'}</TableCell>
                        <TableCell align="right">{fmtUSD(p.amount)}</TableCell>
                        <TableCell>{p.date}</TableCell>
                      </TableRow>
                    ))}
                    {unmatchedOursCount === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 3 }} color="text.secondary">
                          No unmatched credit card payments in our system
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
                      <TableCell>Square ID</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell>Cardholder</TableCell>
                      <TableCell>Email</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cc.unmatchedInSquare.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                          {p.id}
                        </TableCell>
                        <TableCell align="right">{fmtUSD(p.amountCents / 100)}</TableCell>
                        <TableCell>{p.created_at}</TableCell>
                        <TableCell>{p.cardholderName ?? '—'}</TableCell>
                        <TableCell>{p.buyerEmail ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {unmatchedSquareCount === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} align="center" sx={{ py: 3 }} color="text.secondary">
                          No unmatched Square card payments
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
