import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
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
import { fetchSalesTaxReport, type SalesTaxReport } from '../api/salesTax';
import {
  downloadSalesTaxExcel,
  downloadSalesTaxPdf,
  kindLabel,
} from '../utils/salesTaxExport';

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  'Last month': () => {
    const m = dayjs().subtract(1, 'month');
    return { from: m.startOf('month'), to: m.endOf('month') };
  },
  'This month': () => ({ from: dayjs().startOf('month'), to: dayjs() }),
  'Last quarter': () => {
    const q = Math.floor(dayjs().month() / 3);
    const start = dayjs().month(q * 3).startOf('month').subtract(3, 'month');
    return { from: start, to: start.add(2, 'month').endOf('month') };
  },
  'Last year': () => {
    const y = dayjs().subtract(1, 'year');
    return { from: y.startOf('year'), to: y.endOf('year') };
  },
};

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function errText(e: unknown): string {
  return (
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    (e instanceof Error ? e.message : '') ||
    'Failed to load the sales report.'
  );
}

const pill = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  border: active ? '2px solid #1976d2' : '1px solid #ccc',
  borderRadius: 16,
  background: active ? '#e3f2fd' : '#fff',
  cursor: 'pointer',
});

/** Sales, exempt sales, and sales tax for filing, by invoice date. */
export default function SalesTaxReportPage() {
  const [initial] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const start = params.get('start') ?? '';
    const end = params.get('end') ?? '';
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(start) || !iso.test(end)) return null;
    const from = dayjs(start);
    const to = dayjs(end);
    return from.isValid() && to.isValid() && !to.isBefore(from) ? { from, to } : null;
  });
  const [preset, setPreset] = useState(initial ? '' : 'Last month');
  const [range, setRange] = useState(() => initial ?? PRESETS['Last month']());
  const [report, setReport] = useState<SalesTaxReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);

  const startStr = range.from.format('YYYY-MM-DD');
  const endStr = range.to.format('YYYY-MM-DD');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchSalesTaxReport(startStr, endStr)
      .then((data) => {
        if (alive) setReport(data);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errText(e));
        setReport(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [startStr, endStr]);

  const runExport = async (kind: 'pdf' | 'xlsx') => {
    if (!report) return;
    setExporting(kind);
    try {
      if (kind === 'pdf') await downloadSalesTaxPdf(report);
      else await downloadSalesTaxExcel(report);
    } catch (e) {
      setError(errText(e));
    } finally {
      setExporting(null);
    }
  };

  const ratePct = report ? `${+(report.taxRate * 100).toFixed(2)}%` : '';

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Sales &amp; Tax
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Everything sold in the period by invoice date, split into taxable and exempt, with the
          tax to file. Items are taxable when their catalog tax setting charges sales tax; services,
          labs, and untaxed items are exempt. Membership subscriptions come from Square and Stripe,
          and online store sales are the eVet invoices paid with Pharmacy-Online.
        </Typography>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Period"
            action={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {Object.keys(PRESETS).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setPreset(key);
                      setRange(PRESETS[key]());
                    }}
                    style={pill(preset === key)}
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
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              disabled={!report || exporting != null}
              onClick={() => void runExport('pdf')}
            >
              {exporting === 'pdf' ? 'Saving…' : 'Download PDF'}
            </Button>
            <Button
              variant="outlined"
              disabled={!report || exporting != null}
              onClick={() => void runExport('xlsx')}
            >
              {exporting === 'xlsx' ? 'Saving…' : 'Download Excel'}
            </Button>
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
        ) : report ? (
          <>
            {(report.warnings ?? []).map((w) => (
              <Alert key={w} severity="warning" sx={{ mb: 2 }}>
                {w}
              </Alert>
            ))}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
                gap: 2,
                mb: 3,
              }}
            >
              <Stat label="Gross sales" value={report.summary.grossSales} />
              <Stat label="Exempt sales" value={report.summary.exemptSales} />
              <Stat label="Taxable sales" value={report.summary.taxableSales} />
              <Stat
                label={`Tax due (${ratePct})`}
                value={report.summary.salesTax + report.useTax.tax}
                accent
                hint={
                  report.useTax.tax > 0
                    ? `${money(report.summary.salesTax)} sales + ${money(report.useTax.tax)} use`
                    : undefined
                }
              />
            </Box>

            <Card sx={{ mb: 3 }}>
              <CardHeader
                title="What to file"
                subheader="Lines from the Maine Sales, Use & Service Provider Tax Return (ST-7)."
              />
              <CardContent sx={{ pt: 0 }}>
                <Table size="small" sx={{ maxWidth: 720 }}>
                  <TableBody>
                    <FileRow line="1" label="Gross sales (before tax)" value={report.summary.grossSales} />
                    <FileRow
                      line="2"
                      label="Exempt sales: services, labs, untaxed items, memberships"
                      value={report.summary.exemptSales}
                    />
                    <FileRow line="4" label="Taxable sales" value={report.summary.taxableSales} />
                    <FileRow line="6" label={`Sales tax at ${ratePct}`} value={report.summary.salesTax} />
                    <FileRow
                      line="17"
                      label="Purchases subject to use tax: wasted and expired stock, at cost"
                      value={report.useTax.cost}
                    />
                    <FileRow line="17A" label={`Use tax at ${ratePct}`} value={report.useTax.tax} />
                    <FileRow
                      line=""
                      label="Total tax due"
                      value={report.summary.salesTax + report.useTax.tax}
                      bold
                    />
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardHeader title="Where sales came from" />
              <CardContent sx={{ pt: 0 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Source</TableCell>
                        <TableCell align="right">Invoices</TableCell>
                        <TableCell align="right">Gross sales</TableCell>
                        <TableCell align="right">Exempt</TableCell>
                        <TableCell align="right">Taxable</TableCell>
                        <TableCell align="right">Tax</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <BucketRow label="In clinic" count={report.channels.clinic.invoices} b={report.channels.clinic} />
                      <BucketRow
                        label="Online store"
                        sub="eVet invoices paid with Pharmacy-Online"
                        count={report.channels.onlineStore.invoices}
                        b={report.channels.onlineStore}
                      />
                      <BucketRow
                        label="Membership subscriptions"
                        sub={
                          report.channels.subscriptions.included
                            ? `Square ${money(report.channels.subscriptions.square)} · Stripe ${money(report.channels.subscriptions.stripe)}`
                            : `Tracked from ${report.memberships.providerStart}`
                        }
                        count={report.channels.subscriptions.charges}
                        countLabel="charges"
                        b={report.channels.subscriptions}
                      />
                      <TableRow sx={{ '& td': { fontWeight: 700 } }}>
                        <TableCell>Total</TableCell>
                        <TableCell align="right">{report.summary.invoices}</TableCell>
                        <TableCell align="right">{money(report.summary.grossSales)}</TableCell>
                        <TableCell align="right">{money(report.summary.exemptSales)}</TableCell>
                        <TableCell align="right">{money(report.summary.taxableSales)}</TableCell>
                        <TableCell align="right">{money(report.summary.salesTax)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
                {report.memberships.excludedPackageSales > 0 ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    Left out: {money(report.memberships.excludedPackageSales)} of membership plans on{' '}
                    {report.memberships.excludedPackageInvoices} eVet invoices. eVet records the
                    whole plan up front, so the report uses what Square and Stripe actually collected
                    instead.
                  </Typography>
                ) : null}
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardHeader
                title="By category"
                subheader="Taxable categories first. Products use their inventory category."
              />
              <CardContent sx={{ pt: 0 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Category</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell align="right">Gross sales</TableCell>
                        <TableCell align="right">Exempt</TableCell>
                        <TableCell align="right">Taxable</TableCell>
                        <TableCell align="right">Tax</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.categories.map((c) => (
                        <TableRow key={c.key}>
                          <TableCell>{c.label}</TableCell>
                          <TableCell>
                            <Chip size="small" label={kindLabel(c.kind)} variant="outlined" />
                          </TableCell>
                          <TableCell align="right">{money(c.gross)}</TableCell>
                          <TableCell align="right">{money(c.exempt)}</TableCell>
                          <TableCell align="right">{money(c.taxable)}</TableCell>
                          <TableCell align="right">{money(c.tax)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 3,
                mb: 3,
              }}
            >
              <Card>
                <CardHeader
                  title="Use tax"
                  subheader="Stock wasted or expired in the period, at cost. Items used at visits are already taxed when bought."
                />
                <CardContent sx={{ pt: 0 }}>
                  {report.useTax.events === 0 ? (
                    <Typography color="text.secondary">No wasted or expired stock recorded.</Typography>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Reason</TableCell>
                          <TableCell align="right">Times</TableCell>
                          <TableCell align="right">Cost</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {report.useTax.byReason.map((r) => (
                          <TableRow key={r.code}>
                            <TableCell>{r.label}</TableCell>
                            <TableCell align="right">{r.events}</TableCell>
                            <TableCell align="right">{money(r.cost)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow sx={{ '& td': { fontWeight: 700 } }}>
                          <TableCell>Use tax ({ratePct})</TableCell>
                          <TableCell />
                          <TableCell align="right">{money(report.useTax.tax)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader
                  title="Compare with eVet"
                  subheader="eVet's Sales Report spreads each payment across the invoice lines. Same method, without memberships."
                />
                <CardContent sx={{ pt: 0 }}>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell>Payments applied to invoices</TableCell>
                        <TableCell align="right">{money(report.paymentBasis.applied)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Nontaxable</TableCell>
                        <TableCell align="right">{money(report.paymentBasis.exempt)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Taxable (before tax)</TableCell>
                        <TableCell align="right">{money(report.paymentBasis.taxable)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Tax</TableCell>
                        <TableCell align="right">{money(report.paymentBasis.tax)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </Box>

            {report.storeOrders.orders > 0 ? (
              <Card sx={{ mb: 3 }}>
                <CardHeader
                  title="Online store orders"
                  subheader="For reference. These sales are entered into eVet, so they're already counted above."
                />
                <CardContent sx={{ pt: 0, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <Mini label="Orders" value={String(report.storeOrders.orders)} />
                  <Mini label="Subtotal" value={money(report.storeOrders.subtotal)} />
                  <Mini label="Shipping" value={money(report.storeOrders.shipping)} />
                  <Mini label="Tax charged" value={money(report.storeOrders.tax)} />
                  <Mini label="Total" value={money(report.storeOrders.total)} />
                  <Mini
                    label="Auto-ship"
                    value={`${report.storeOrders.autoshipOrders} · ${money(report.storeOrders.autoshipSubtotal)}`}
                  />
                </CardContent>
              </Card>
            ) : null}

            {(report.stripeBreakdown ?? []).length > 0 ? (
              <Card sx={{ mb: 3 }}>
                <CardHeader
                  title="Stripe charges by source"
                  subheader="Read from Stripe. Only memberships are added to sales here; store and Hill's to Home charges are already in eVet."
                />
                <CardContent sx={{ pt: 0 }}>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Source</TableCell>
                          <TableCell align="right">Charges</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell align="right">Refunded</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {report.stripeBreakdown.map((s) => (
                          <TableRow key={s.kind}>
                            <TableCell>
                              {s.label}
                              {s.inSubscriptions ? (
                                <Chip size="small" label="In sales" variant="outlined" sx={{ ml: 1 }} />
                              ) : null}
                            </TableCell>
                            <TableCell align="right">{s.count}</TableCell>
                            <TableCell align="right">{money(s.amount)}</TableCell>
                            <TableCell align="right">{s.refunded ? money(s.refunded) : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader
                title="Payments received"
                subheader="By the date received. The difference from sales is timing, unpaid balances, and credits."
              />
              <CardContent sx={{ pt: 0 }}>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Payment type</TableCell>
                        <TableCell align="right">Count</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.payments.rows.map((p) => (
                        <TableRow
                          key={`${p.source}:${p.type}:${p.excluded}`}
                          sx={p.excluded ? { '& td': { color: 'text.disabled' } } : undefined}
                        >
                          <TableCell>
                            {p.type}
                            {p.excluded ? ' (not income)' : ''}
                          </TableCell>
                          <TableCell align="right">{p.count}</TableCell>
                          <TableCell align="right">{money(p.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ '& td': { fontWeight: 700 } }}>
                        <TableCell>Payments received</TableCell>
                        <TableCell />
                        <TableCell align="right">{money(report.tieOut.received)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Sales + tax (this report)</TableCell>
                        <TableCell />
                        <TableCell align="right">{money(report.tieOut.salesWithTax)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Difference</TableCell>
                        <TableCell />
                        <TableCell align="right">{money(report.tieOut.difference)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </>
        ) : null}
      </Box>
    </LocalizationProvider>
  );
}

function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <Card variant="outlined" sx={accent ? { borderColor: 'primary.main', bgcolor: '#f3f8fe' } : undefined}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {money(value)}
        </Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FileRow({
  line,
  label,
  value,
  bold,
}: {
  line: string;
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <TableRow sx={bold ? { '& td': { fontWeight: 700 } } : undefined}>
      <TableCell sx={{ width: 56, color: 'text.secondary' }}>{line}</TableCell>
      <TableCell>{label}</TableCell>
      <TableCell align="right">{money(value)}</TableCell>
    </TableRow>
  );
}

function BucketRow({
  label,
  sub,
  count,
  countLabel,
  b,
}: {
  label: string;
  sub?: string;
  count: number;
  countLabel?: string;
  b: { gross: number; exempt: number; taxable: number; tax: number };
}) {
  return (
    <TableRow>
      <TableCell>
        {label}
        {sub ? <div style={{ color: '#667', fontSize: 12 }}>{sub}</div> : null}
      </TableCell>
      <TableCell align="right">
        {count}
        {countLabel ? <span style={{ color: '#667', fontSize: 12 }}> {countLabel}</span> : null}
      </TableCell>
      <TableCell align="right">{money(b.gross)}</TableCell>
      <TableCell align="right">{money(b.exempt)}</TableCell>
      <TableCell align="right">{money(b.taxable)}</TableCell>
      <TableCell align="right">{money(b.tax)}</TableCell>
    </TableRow>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}
