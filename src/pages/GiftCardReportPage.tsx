import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
import {
  GIFT_CARD_CHANNEL_LABELS,
  GIFT_CARD_TXN_LABELS,
  downloadGiftCardReportCsv,
  fetchGiftCardReport,
  type GiftCardReport,
} from '../api/giftCards';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  'This month': () => ({ from: dayjs().startOf('month'), to: dayjs() }),
  'Last month': () => {
    const last = dayjs().subtract(1, 'month');
    return { from: last.startOf('month'), to: last.endOf('month') };
  },
  'Year to date': () => ({ from: dayjs().startOf('year'), to: dayjs() }),
};

function money(n: number): string {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.format('MMM D, YYYY h:mm A') : iso;
}

type RollRow = {
  label: string;
  face: number;
  paid: number;
  sign: '' | '+' | '−' | '±';
  bold?: boolean;
  note?: string;
};

/** Gift card liability for bookkeeping: what was owed at the start, what changed, and what is owed now. */
export default function GiftCardReportPage() {
  const [preset, setPreset] = useState('This month');
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['This month']());
  const [report, setReport] = useState<GiftCardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const startStr = range.from.format('YYYY-MM-DD');
  const endStr = range.to.format('YYYY-MM-DD');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchGiftCardReport(currentPracticeId(), startStr, endStr)
      .then((data) => {
        if (alive) setReport(data);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to load the gift card report.');
        setReport(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [startStr, endStr]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadGiftCardReportCsv(currentPracticeId(), startStr, endStr);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download the CSV.');
    } finally {
      setDownloading(false);
    }
  };

  const s = report?.summary;
  const rollForward: RollRow[] = s
    ? [
        {
          label: `Outstanding on ${range.from.format('MMM D, YYYY')}`,
          face: s.opening.face,
          paid: s.opening.paid,
          sign: '',
          bold: true,
        },
        {
          label: `Sold (${s.sold.count})`,
          face: s.sold.face,
          paid: s.sold.paid,
          sign: '+',
          note: s.sold.discount > 0.009 ? `${money(s.sold.discount)} sale discount` : undefined,
        },
        {
          label: `Issued by staff (${s.staffIssued.count})`,
          face: s.staffIssued.face,
          paid: s.staffIssued.paid,
          sign: '+',
        },
        { label: 'Redeemed', face: s.redeemed.face, paid: s.redeemed.paid, sign: '−' },
        {
          label: `Voided (${s.voided.count})`,
          face: s.voided.face,
          paid: s.voided.paid,
          sign: '−',
        },
        {
          label: `Refunded (${s.refunded.count})`,
          face: s.refunded.face,
          paid: s.refunded.paid,
          sign: '−',
        },
        { label: 'Adjustments', face: s.adjusted.face, paid: s.adjusted.paid, sign: '±' },
        {
          label: `Outstanding on ${range.to.format('MMM D, YYYY')}`,
          face: s.closing.face,
          paid: s.closing.paid,
          sign: '',
          bold: true,
        },
      ]
    : [];
  const outOfBalance = s
    ? Math.abs(s.difference.face) > 0.009 || Math.abs(s.difference.paid) > 0.009
    : false;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Card>
          <CardHeader
            title="Gift cards"
            subheader="Outstanding gift cards are money owed to clients. Face value is what cards can buy; paid value is what was collected for them."
          />
          <CardContent sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            {Object.keys(PRESETS).map((key) => (
              <Button
                key={key}
                size="small"
                variant={preset === key ? 'contained' : 'outlined'}
                onClick={() => {
                  setPreset(key);
                  setRange(PRESETS[key]());
                }}
              >
                {key}
              </Button>
            ))}
            <DatePicker
              label="From"
              value={range.from}
              onChange={(v) => {
                if (!v) return;
                setPreset('');
                setRange((r) => ({ ...r, from: v }));
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="To"
              value={range.to}
              onChange={(v) => {
                if (!v) return;
                setPreset('');
                setRange((r) => ({ ...r, to: v }));
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
            <Button
              variant="outlined"
              size="small"
              disabled={downloading}
              onClick={() => void download()}
            >
              {downloading ? 'Downloading…' : 'Download CSV'}
            </Button>
          </CardContent>
        </Card>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : s ? (
          <>
            {outOfBalance ? (
              <Alert severity="warning">
                The ledger is off by {money(s.difference.face)} face / {money(s.difference.paid)}{' '}
                paid for this period. Card balances don’t match their history; please let support
                know.
              </Alert>
            ) : null}
            <Box
              sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' } }}
            >
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Liability roll-forward</TableCell>
                      <TableCell align="right">Face value</TableCell>
                      <TableCell align="right">Paid value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rollForward.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell sx={{ fontWeight: row.bold ? 600 : undefined }}>
                          {row.sign ? `${row.sign} ` : ''}
                          {row.label}
                          {row.note ? (
                            <Typography component="span" variant="caption" color="text.secondary">
                              {' '}
                              · {row.note}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: row.bold ? 600 : undefined }}>
                          {money(row.face)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: row.bold ? 600 : undefined }}>
                          {money(row.paid)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Box sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
                <TableContainer component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Redeemed at</TableCell>
                        <TableCell align="right">Face</TableCell>
                        <TableCell align="right">Paid</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {s.redeemed.byChannel.length ? (
                        s.redeemed.byChannel.map((row) => (
                          <TableRow key={row.channel}>
                            <TableCell>
                              {GIFT_CARD_CHANNEL_LABELS[row.channel] ?? row.channel}
                            </TableCell>
                            <TableCell align="right">{money(row.face)}</TableCell>
                            <TableCell align="right">{money(row.paid)}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={3}>None</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TableContainer component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Staff-issued reason</TableCell>
                        <TableCell align="right">Cards</TableCell>
                        <TableCell align="right">Face</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {s.staffIssued.byReason.length ? (
                        s.staffIssued.byReason.map((row) => (
                          <TableRow key={row.reason}>
                            <TableCell>{row.reason}</TableCell>
                            <TableCell align="right">{row.count}</TableCell>
                            <TableCell align="right">{money(row.face)}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={3}>None</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Box>

            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>Card</TableCell>
                    <TableCell>What</TableCell>
                    <TableCell>Where</TableCell>
                    <TableCell align="right">Face</TableCell>
                    <TableCell align="right">Paid value</TableCell>
                    <TableCell align="right">Balance</TableCell>
                    <TableCell>Client / buyer</TableCell>
                    <TableCell>Invoice</TableCell>
                    <TableCell>Staff</TableCell>
                    <TableCell>Note</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report!.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatWhen(row.created)}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>••••{row.codeLast4}</TableCell>
                      <TableCell>{GIFT_CARD_TXN_LABELS[row.type] ?? row.type}</TableCell>
                      <TableCell>{GIFT_CARD_CHANNEL_LABELS[row.channel] ?? row.channel}</TableCell>
                      <TableCell align="right">{money(row.faceAmount)}</TableCell>
                      <TableCell align="right">{money(row.paidValueAmount)}</TableCell>
                      <TableCell align="right">{money(row.balanceAfter)}</TableCell>
                      <TableCell>
                        {row.clientName || row.purchaserName || row.purchaserEmail || '—'}
                      </TableCell>
                      <TableCell>
                        {row.invoiceNumber != null
                          ? `#${row.invoiceNumber}`
                          : row.mailOrderId != null
                            ? `Order ${row.mailOrderId}`
                            : '—'}
                      </TableCell>
                      <TableCell>{row.employeeName || '—'}</TableCell>
                      <TableCell>{row.note || row.issueReason || ''}</TableCell>
                    </TableRow>
                  ))}
                  {!report!.rows.length ? (
                    <TableRow>
                      <TableCell colSpan={11}>No gift card activity in this period.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        ) : null}
      </Box>
    </LocalizationProvider>
  );
}
