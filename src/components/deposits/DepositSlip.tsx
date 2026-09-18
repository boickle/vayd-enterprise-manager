import { useMemo } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import dayjs from 'dayjs';
import type { PracticeDeposit } from '../../api/deposits';

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function isCashLine(method: string, paymentTypeName: string | null): boolean {
  const m = (method || '').toLowerCase();
  const n = (paymentTypeName || '').toLowerCase();
  return m === 'cash' || n === 'cash' || n.includes('cash');
}

function isCheckLine(method: string, paymentTypeName: string | null): boolean {
  const m = (method || '').toLowerCase();
  const n = (paymentTypeName || '').toLowerCase();
  return m === 'check' || n === 'check' || n.includes('check') || n.includes('cheque');
}

type Props = {
  deposit: PracticeDeposit;
  onClose?: () => void;
};

/**
 * Printable bank deposit slip: cash total first, then each check listed.
 */
export default function DepositSlip({ deposit, onClose }: Props) {
  const { cashTotal, checks, otherTotal, cashCount, checkCount } = useMemo(() => {
    let cashTotal = 0;
    let cashCount = 0;
    let otherTotal = 0;
    const checks: {
      id: string;
      checkNumber: string;
      amount: number;
      clientLabel: string | null;
    }[] = [];
    for (const l of deposit.lines ?? []) {
      const amount = Number(l.amount) || 0;
      if (isCashLine(l.method, l.paymentTypeName)) {
        cashTotal += amount;
        cashCount += 1;
      } else if (isCheckLine(l.method, l.paymentTypeName)) {
        checks.push({
          id: l.id,
          checkNumber: (l.checkNumber || '').trim() || '—',
          amount,
          clientLabel: l.clientLabel,
        });
      } else {
        otherTotal += amount;
      }
    }
    return { cashTotal, checks, otherTotal, cashCount, checkCount: checks.length };
  }, [deposit.lines]);

  const checkTotal = checks.reduce((s, c) => s + c.amount, 0);
  const grandTotal = cashTotal + checkTotal + otherTotal;
  const posted = deposit.postedAt ?? deposit.created;

  function printSlip() {
    window.print();
  }

  return (
    <Box className="deposit-slip-root">
      <Stack
        direction="row"
        spacing={1}
        justifyContent="flex-end"
        className="deposit-slip-no-print"
        sx={{ mb: 2 }}
      >
        <Button variant="contained" onClick={printSlip}>
          Print deposit slip
        </Button>
        {onClose ? (
          <Button variant="outlined" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </Stack>

      <Box
        className="deposit-slip"
        sx={{
          maxWidth: 640,
          mx: 'auto',
          border: '2px solid #111',
          p: 3,
          bgcolor: '#fff',
          color: '#111',
          fontFamily: '"Courier New", Courier, monospace',
        }}
      >
        <Typography
          variant="h5"
          sx={{
            textAlign: 'center',
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            mb: 0.5,
            fontFamily: 'inherit',
          }}
        >
          Deposit slip
        </Typography>
        <Typography sx={{ textAlign: 'center', mb: 2, fontFamily: 'inherit' }}>
          Deposited on {dayjs(posted).format('MMMM D, YYYY')}
        </Typography>

        <Box sx={{ borderBottom: '1px solid #111', pb: 1.5, mb: 2 }}>
          <Typography sx={{ fontFamily: 'inherit' }}>
            <strong>Bank:</strong> {deposit.bankName}
          </Typography>
          <Typography sx={{ fontFamily: 'inherit' }}>
            <strong>Account:</strong> {deposit.bankAccountNumber || '—'}
          </Typography>
          {deposit.note ? (
            <Typography sx={{ fontFamily: 'inherit' }}>
              <strong>Note:</strong> {deposit.note}
            </Typography>
          ) : null}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 0.5,
            borderBottom: '2px solid #111',
            pb: 1.5,
            mb: 2,
          }}
        >
          <Typography sx={{ fontFamily: 'inherit', fontWeight: 700 }}>
            CASH{cashCount > 1 ? ` (${cashCount})` : ''}
          </Typography>
          <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, textAlign: 'right' }}>
            {fmtUSD(cashTotal)}
          </Typography>
        </Box>

        <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, mb: 1 }}>
          CHECKS{checkCount ? ` (${checkCount})` : ''}
        </Typography>
        {checks.length === 0 ? (
          <Typography sx={{ fontFamily: 'inherit', mb: 2, color: '#555' }}>
            None
          </Typography>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr auto',
                gap: 1,
                borderBottom: '1px solid #999',
                pb: 0.5,
                mb: 0.5,
                fontSize: 13,
              }}
            >
              <span>Check #</span>
              <span>Payer</span>
              <span style={{ textAlign: 'right' }}>Amount</span>
            </Box>
            {checks.map((c) => (
              <Box
                key={c.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr auto',
                  gap: 1,
                  py: 0.4,
                  borderBottom: '1px dotted #ccc',
                  fontFamily: 'inherit',
                }}
              >
                <span>{c.checkNumber}</span>
                <span>{c.clientLabel || '—'}</span>
                <span style={{ textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
              </Box>
            ))}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 1,
                pt: 1,
                mt: 0.5,
              }}
            >
              <Typography sx={{ fontFamily: 'inherit', fontWeight: 700 }}>
                Checks subtotal
              </Typography>
              <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, textAlign: 'right' }}>
                {fmtUSD(checkTotal)}
              </Typography>
            </Box>
          </Box>
        )}

        {otherTotal > 0.005 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 0.5,
              mb: 2,
            }}
          >
            <Typography sx={{ fontFamily: 'inherit' }}>Other</Typography>
            <Typography sx={{ fontFamily: 'inherit', textAlign: 'right' }}>
              {fmtUSD(otherTotal)}
            </Typography>
          </Box>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 0.5,
            borderTop: '3px double #111',
            pt: 1.5,
            mt: 1,
          }}
        >
          <Typography sx={{ fontFamily: 'inherit', fontWeight: 800, fontSize: 18 }}>
            TOTAL DEPOSIT
          </Typography>
          <Typography
            sx={{ fontFamily: 'inherit', fontWeight: 800, fontSize: 18, textAlign: 'right' }}
          >
            {fmtUSD(grandTotal)}
          </Typography>
        </Box>
      </Box>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .deposit-slip-root,
          .deposit-slip-root * { visibility: visible !important; }
          .deposit-slip-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            background: #fff !important;
          }
          .deposit-slip-no-print { display: none !important; }
          .deposit-slip {
            border-color: #000 !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </Box>
  );
}
