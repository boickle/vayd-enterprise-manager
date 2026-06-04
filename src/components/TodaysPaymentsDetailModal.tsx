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
  buildConsolidatedClientPaymentRows,
  CLIENT_VSD_LOOKBACK_DAYS,
  isMembershipPlanPaymentType,
  type ConsolidatedClientPaymentRow,
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
  const [rows, setRows] = useState<ConsolidatedClientPaymentRow[]>([]);

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

        const detailRows = buildConsolidatedClientPaymentRows(payments, clientRevenueById, dayKey);
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
    const paymentCount = rows.reduce((s, r) => s + r.payments.length, 0);
    const paymentTotal = rows.reduce((s, r) => s + r.paymentTotal, 0);
    const vsdCompareTotal = rows.reduce((s, r) => s + r.vsdCompareTotal, 0);
    const vsdTotal = rows.reduce((s, r) => s + (r.vsdAmount ?? 0), 0);
    const matched = rows.filter((r) => r.matchesVsd === true).length;
    const mismatched = rows.filter((r) => r.matchesVsd === false).length;
    return { paymentCount, paymentTotal, vsdCompareTotal, vsdTotal, matched, mismatched };
  }, [rows]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      <DialogTitle>Payments for {dateLabel}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Clients with multiple payments are consolidated into one row. Payment amounts are summed;
          VSD is shown once per client (not summed across split payments). Membership plan payments
          are excluded from the VSD comparison. VSD is treatment-item revenue from the client&apos;s
          most recent treatment day on or before this payment date (via client revenue history, last{' '}
          {CLIENT_VSD_LOOKBACK_DAYS} days).
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
                <strong>{rows.length}</strong> client{rows.length === 1 ? '' : 's'}
              </Typography>
              <Typography variant="body2">
                <strong>{totals.paymentCount}</strong> payment{totals.paymentCount === 1 ? '' : 's'}
              </Typography>
              <Typography variant="body2">
                Total paid: <strong>{fmtUSD(totals.paymentTotal)}</strong>
              </Typography>
              <Typography variant="body2">
                Paid (excl. membership): <strong>{fmtUSD(totals.vsdCompareTotal)}</strong>
              </Typography>
              <Typography variant="body2">
                VSD (per client): <strong>{fmtUSD(totals.vsdTotal)}</strong>
              </Typography>
              {totals.matched > 0 && (
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label={`${totals.matched} client match${totals.matched === 1 ? '' : 'es'}`}
                />
              )}
              {totals.mismatched > 0 && (
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={`${totals.mismatched} client mismatch${totals.mismatched === 1 ? '' : 'es'}`}
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
                      <strong>Payment (vs VSD)</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>VSD</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Match</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Payments</strong>
                    </TableCell>
                    <TableCell>
                      <strong>Latest treatment</strong>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.clientId ?? row.clientName} hover>
                      <TableCell>{row.clientName}</TableCell>
                      <TableCell>
                        <TreatmentPatientsCell patients={row.treatmentPatients} />
                      </TableCell>
                      <TableCell>
                        {row.paymentTypeNames.length ? row.paymentTypeNames.join(', ') : '—'}
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={600}>
                          {fmtUSD(row.vsdCompareTotal)}
                        </Typography>
                        {row.membershipPaymentTotal > 0 ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            + {fmtUSD(row.membershipPaymentTotal)} membership (excluded)
                          </Typography>
                        ) : null}
                        {row.payments.length > 1 ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {row.payments.length} payments
                          </Typography>
                        ) : null}
                      </TableCell>
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
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {row.payments.map((p) => (
                            <Box
                              key={p.id}
                              component="span"
                              display="block"
                              sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}
                            >
                              #{p.id} · {fmtUSD(p.amount)}
                              {p.paymentTypeName ? ` · ${p.paymentTypeName}` : ''}
                              {p.paymentTypeName && isMembershipPlanPaymentType(p.paymentTypeName)
                                ? ' (excluded from VSD)'
                                : ''}
                            </Box>
                          ))}
                        </Typography>
                      </TableCell>
                      <TableCell>{formatTreatmentDate(row.latestTreatmentDate)}</TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && !error && (
                    <TableRow>
                      <TableCell colSpan={8} align="center" sx={{ py: 4 }} color="text.secondary">
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
