import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Dialog, DialogContent, Typography } from '@mui/material';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import ClientInvoiceDetailModal from './pims/ClientInvoiceDetailModal';
import {
  accountBalanceFromClient,
  findInvoiceForPayment,
  type NormalizedInvoice,
} from '../utils/pimsInvoices';

export type PaymentInvoiceTarget = {
  clientId: number;
  paymentId: number;
  amount?: number;
  date?: string;
};

type Props = {
  target: PaymentInvoiceTarget | null;
  onClose: () => void;
};

export default function PaymentInvoiceModal({ target, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<NormalizedInvoice | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!target) {
      setLoading(false);
      setError(null);
      setInvoice(null);
      setBalance(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);
    setInvoice(null);
    setBalance(null);

    (async () => {
      try {
        const data = await fetchClientByIdStaff(target.clientId);
        if (!alive) return;
        if (!data || typeof data !== 'object') {
          setError('Could not load client billing.');
          return;
        }
        const client = data as Record<string, unknown>;
        const match = findInvoiceForPayment(client, {
          paymentId: target.paymentId,
          amount: target.amount,
          date: target.date,
        });
        if (!match) {
          setError('No invoice found for this payment.');
          return;
        }
        setBalance(accountBalanceFromClient(client));
        setInvoice(match);
      } catch (e: unknown) {
        if (!alive) return;
        console.error('Payment invoice load failed:', e);
        setError('Failed to load invoice for this payment.');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [target?.clientId, target?.paymentId, target?.amount, target?.date]);

  if (!target) return null;

  if (invoice) {
    return <ClientInvoiceDetailModal inv={invoice} balance={balance} onClose={onClose} />;
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth sx={{ zIndex: 1400 }}>
      <DialogContent>
        {loading ? (
          <Box display="flex" flexDirection="column" alignItems="center" py={4} gap={2}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">
              Loading invoice…
            </Typography>
          </Box>
        ) : error ? (
          <Alert severity="warning" onClose={onClose}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
