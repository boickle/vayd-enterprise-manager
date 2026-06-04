import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Alert,
} from '@mui/material';
import dayjs from 'dayjs';
import { Heart } from 'lucide-react';
import { fetchPaymentsForDay } from '../api/payments';
import { fetchClientRevenueSeries, type ClientRevenueSeriesResponse } from '../api/opsStats';
import {
  buildPaymentDetailRows,
  CLIENT_VSD_LOOKBACK_DAYS,
  type PaymentDetailTableRow,
} from '../utils/paymentsDayVsdMatch';

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    Number(n) || 0
  );
}

function formatTreatmentDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = dayjs(dateStr);
  return d.isValid() ? d.format('MMM D, YYYY') : dateStr;
}

function TreatmentPatientsCell({ patients }: { patients: PaymentDetailTableRow['treatmentPatients'] }) {
  if (!patients.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  }
  return (
    <Box component="span" display="flex" flexDirection="column" gap={0.5}>
      {patients.map((p) => (
        <Box
          key={p.patientName}
          component="span"
          display="inline-flex"
          alignItems="center"
          gap={0.5}
        >
          {p.isMember && (
            <Heart
              size={14}
              fill="#dc2626"
              color="#dc2626"
              strokeWidth={1.5}
              aria-label="Member"
            />
          )}
          <Typography component="span" variant="body2">
            {p.patientName}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

type Props = {
  open: boolean;
  /** Calendar day to show (YYYY-MM-DD, local). Controlled by the page daily revenue card. */
  date: string;
  onClose: () => void;
};

export default function TodaysPaymentsDetailModal({ open, date, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PaymentDetailTableRow[]>([]);

  const dateKey = date.slice(0, 10);
  const dateLabel = dayjs(dateKey).format('dddd, MMM D, YYYY');

  useEffect(() => {
    if (!open || !dateKey) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setRows([]);

    (async () => {
      try {
        const dayKey = dateKey.slice(0, 10);
        const vsdStart = dayjs(dayKey)
          .subtract(CLIENT_VSD_LOOKBACK_DAYS, 'day')
          .format('YYYY-MM-DD');

        const payments = await fetchPaymentsForDay(dayKey);

        const clientIds = [
          ...new Set(
            payments
              .map((p) => p.client?.id)
              .filter((id): id is number => id != null && Number.isFinite(Number(id)))
              .map((id) => Number(id))
          ),
        ];

        const revenueEntries = await Promise.all(
          clientIds.map(async (clientId) => {
            try {
              const response = await fetchClientRevenueSeries({
                clientId,
                start: vsdStart,
                end: dayKey,
              });
              return [clientId, response] as const;
            } catch (e) {
              console.warn(`Client revenue series failed for client ${clientId}:`, e);
              return [clientId, null] as const;
            }
          })
        );

        if (!alive) return;

        const clientRevenueById = new Map<number, ClientRevenueSeriesResponse>();
        for (const [clientId, response] of revenueEntries) {
          if (response) clientRevenueById.set(clientId, response);
        }

        const detailRows = buildPaymentDetailRows(payments, clientRevenueById, dayKey);
        detailRows.sort((a, b) => {
          const ta = a.payment.depositDate ?? a.payment.date ?? '';
          const tb = b.payment.depositDate ?? b.payment.date ?? '';
          return tb.localeCompare(ta);
        });
        setRows(detailRows);
      } catch (e: unknown) {
        if (!alive) return;
        console.error('Today payments detail load failed:', e);
        setError('Failed to load payment details for this day.');
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, dateKey]);

  const totals = useMemo(() => {
    const paymentTotal = rows.reduce((s, r) => s + Number(r.payment.amount ?? 0), 0);
    const vsdTotal = rows.reduce((s, r) => s + (r.vsdAmount ?? 0), 0);
    const matched = rows.filter((r) => r.matchesVsd === true).length;
    const mismatched = rows.filter((r) => r.matchesVsd === false).length;
    return { paymentTotal, vsdTotal, matched, mismatched };
  }, [rows]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      <DialogTitle>Payments for {dateLabel}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          VSD is treatment-item revenue from the client&apos;s most recent treatment day on or before
          this payment date (via client revenue history, last {CLIENT_VSD_LOOKBACK_DAYS} days). Compare
          payment amount to VSD to see whether they align.
        </Typography>

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
            <Box display="flex" flexWrap="wrap" gap={2} mb={2}>
              <Typography variant="body2">
                <strong>{rows.length}</strong> payment{rows.length === 1 ? '' : 's'}
              </Typography>
              <Typography variant="body2">
                Total paid: <strong>{fmtUSD(totals.paymentTotal)}</strong>
              </Typography>
              <Typography variant="body2">
                VSD (matched rows): <strong>{fmtUSD(totals.vsdTotal)}</strong>
              </Typography>
              {totals.matched > 0 && (
                <Chip size="small" color="success" variant="outlined" label={`${totals.matched} match`} />
              )}
              {totals.mismatched > 0 && (
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={`${totals.mismatched} mismatch`}
                />
              )}
            </Box>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <strong>Client</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Patient</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Payment type</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>Payment</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>VSD</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Match</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Latest treatment</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Date</strong>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                      <strong>ID</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.payment.id} hover>
                      <TableCell>{row.clientName}</TableCell>
                      <TableCell>
                        <TreatmentPatientsCell patients={row.treatmentPatients} />
                      </TableCell>
                      <TableCell>{row.payment.paymentTypeName ?? '—'}</TableCell>
                      <TableCell align="right">{fmtUSD(row.payment.amount)}</TableCell>
                      <TableCell align="right">
                        {row.vsdAmount != null ? fmtUSD(row.vsdAmount) : '—'}
                      </TableCell>
                      <TableCell>
                        {row.matchesVsd === true && (
                          <Chip size="small" color="success" label="Match" />
                        )}
                        {row.matchesVsd === false && (
                          <Chip size="small" color="warning" label="Differs" />
                        )}
                        {row.matchesVsd == null && (
                          <Typography variant="caption" color="text.secondary">
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{formatTreatmentDate(row.latestTreatmentDate)}</TableCell>
                      <TableCell>{row.payment.date}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                        {row.payment.id}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && !error && (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 4 }} color="text.secondary">
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
