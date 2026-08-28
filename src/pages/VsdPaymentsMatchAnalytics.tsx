import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchVsdPaymentsMatch, type VsdPaymentsMatchReport } from '../api/opsStats';
import { useCommittedDateRange } from '../hooks/useCommittedDateRange';

/** Rolling ranges end yesterday so today is only included when Today is selected. */
function completeDaysEndingYesterday(days: number) {
  const yesterday = dayjs().startOf('day').subtract(1, 'day');
  return { from: yesterday.subtract(days - 1, 'day'), to: yesterday };
}

const PRESETS: Record<string, () => { from: dayjs.Dayjs; to: dayjs.Dayjs }> = {
  Today: () => {
    const today = dayjs().startOf('day');
    return { from: today, to: today };
  },
  '7D': () => completeDaysEndingYesterday(7),
  '30D': () => completeDaysEndingYesterday(30),
  '90D': () => completeDaysEndingYesterday(90),
  YTD: () => {
    const yesterday = dayjs().startOf('day').subtract(1, 'day');
    const yearStart = dayjs().startOf('year');
    return {
      from: yearStart,
      to: yesterday.isBefore(yearStart) ? yearStart : yesterday,
    };
  },
};

function toLocalDateStr(d: dayjs.Dayjs) {
  return d.format('YYYY-MM-DD');
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function fmtDay(iso: string) {
  const d = dayjs(iso);
  return d.isValid() ? d.format('ddd M/D') : iso;
}

export default function VsdPaymentsMatchAnalyticsPage() {
  const { range, draftRange, applyRange, onCustomFromChange, onCustomToChange } =
    useCommittedDateRange(PRESETS['7D']());
  const [preset, setPreset] = useState('7D');
  const [report, setReport] = useState<VsdPaymentsMatchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startStr = toLocalDateStr(range.from);
  const endStr = toLocalDateStr(range.to);
  const isSingleDay = range.from.isSame(range.to, 'day');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void fetchVsdPaymentsMatch({ start: startStr, end: endStr })
      .then((data) => {
        if (!alive) return;
        setReport(data);
      })
      .catch((e) => {
        if (!alive) return;
        console.error('VSD vs payments report failed:', e);
        const status = e?.response?.status;
        setError(
          status === 403
            ? 'Only admins can view this report.'
            : 'Failed to load VSD vs payments report'
        );
        setReport(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [startStr, endStr]);

  const chartData = useMemo(
    () =>
      (report?.daily ?? []).map((d) => ({
        ...d,
        label: fmtDay(d.date),
      })),
    [report]
  );

  const stillOpen =
    report != null
      ? report.totals.openToCollect ||
        report.doctors.reduce((s, d) => s + d.openToCollect, 0)
      : 0;
  const remainingGap = stillOpen;
  const gapPct =
    report && report.totals.vsd > 0 ? (100 * remainingGap) / report.totals.vsd : 0;
  const vsdMinusPayments = report?.totals.gap ?? 0;
  const membershipAndOpen =
    report != null ? report.totals.membershipDiscount + remainingGap : 0;
  const membershipShareOfDiff =
    membershipAndOpen > 0 && report
      ? (100 * report.totals.membershipDiscount) / membershipAndOpen
      : 0;
  const remainingShareOfDiff =
    membershipAndOpen > 0 ? (100 * remainingGap) / membershipAndOpen : 0;
  const gapBreakdown = report
    ? [
        { name: 'Membership discounts', value: report.totals.membershipDiscount, color: '#7b6bb0' },
        { name: 'Still open', value: remainingGap, color: '#c47b3a' },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ pb: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          VSD vs Payments
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          VSD is treatment value on the visit date. Practice payments are cash deposited
          that day (excluding membership plan and online pharmacy). The gap is still-open
          billed work — the same total as Still open by doctor. Member write-downs are
          excluded; amounts a member still owes are included. Open invoices with a future
          appointment on the books are omitted (euthanasia is often prepaid and left open
          until that visit is over).
        </Typography>

        <Card sx={{ mb: 3 }}>
          <CardHeader
            title="Date range"
            action={
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {Object.keys(PRESETS).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setPreset(key);
                      applyRange(PRESETS[key]());
                    }}
                    style={{
                      padding: '6px 12px',
                      border: preset === key ? '2px solid #1976d2' : '1px solid #ccc',
                      borderRadius: 4,
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
          <CardContent sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <DatePicker
              label="From"
              value={draftRange.from}
              onChange={(d) => {
                if (d) {
                  setPreset('');
                  onCustomFromChange(d);
                }
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="To"
              value={draftRange.to}
              onChange={(d) => {
                if (d) {
                  setPreset('');
                  onCustomToChange(d);
                }
              }}
              slotProps={{ textField: { size: 'small' } }}
            />
          </CardContent>
        </Card>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading && (
          <Box sx={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && report && (
          <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardHeader
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="VSD"
                  />
                  <CardContent>
                    <Typography variant="h5" fontWeight={700}>
                      {fmtUSD(report.totals.vsd)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardHeader
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="Practice payments"
                  />
                  <CardContent>
                    <Typography variant="h5" fontWeight={700}>
                      {fmtUSD(report.totals.practicePayments)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardHeader
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="Gap"
                  />
                  <CardContent>
                    <Typography variant="h5" fontWeight={700} color="warning.main">
                      {fmtUSD(remainingGap)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Still open billed work · same as doctor total
                      {report.totals.vsd > 0 ? ` · ${gapPct.toFixed(1)}% of VSD` : ''}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardHeader
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="VSD collected"
                  />
                  <CardContent>
                    <Typography variant="h5" fontWeight={700} color="success.main">
                      {fmtUSD(report.totals.paidVsd)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Open {fmtUSD(report.totals.openVsd)} · closed under-collected{' '}
                      {fmtUSD(report.totals.closedVsd)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <Card variant="outlined">
                  <CardHeader
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="Membership discounts"
                  />
                  <CardContent>
                    <Typography variant="h5" fontWeight={700}>
                      {fmtUSD(report.totals.membershipDiscount)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Production not billed on member lines
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={9}>
                <Card variant="outlined">
                  <CardHeader
                    titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                    title="What’s in production not collected"
                  />
                  <CardContent>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                      {gapBreakdown.length > 0 && (
                        <Box sx={{ width: 140, height: 140, flexShrink: 0 }}>
                          <ResponsiveContainer>
                            <PieChart>
                              <Pie
                                data={gapBreakdown}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={38}
                                outerRadius={60}
                                paddingAngle={2}
                              >
                                {gapBreakdown.map((d) => (
                                  <Cell key={d.name} fill={d.color} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(value) => fmtUSD(Number(value ?? 0))} />
                            </PieChart>
                          </ResponsiveContainer>
                        </Box>
                      )}
                      <Box sx={{ flex: 1, minWidth: 240 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Piece</TableCell>
                              <TableCell align="right">Amount</TableCell>
                              <TableCell align="right">Share</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            <TableRow>
                              <TableCell>Membership discounts (never billed)</TableCell>
                              <TableCell align="right">
                                {fmtUSD(report.totals.membershipDiscount)}
                              </TableCell>
                              <TableCell align="right">
                                {membershipAndOpen > 0
                                  ? `${membershipShareOfDiff.toFixed(1)}%`
                                  : '—'}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>
                                <strong>Gap (still open billed work)</strong>
                              </TableCell>
                              <TableCell align="right">
                                <strong>{fmtUSD(remainingGap)}</strong>
                              </TableCell>
                              <TableCell align="right">
                                {membershipAndOpen > 0
                                  ? `${remainingShareOfDiff.toFixed(1)}%`
                                  : '—'}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell>VSD − practice payments</TableCell>
                              <TableCell align="right">
                                {fmtUSD(vsdMinusPayments)}
                              </TableCell>
                              <TableCell align="right">—</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          Member VSD {fmtUSD(report.totals.memberVsd)} was billed at{' '}
                          {fmtUSD(report.totals.memberBilled)}. {fmtUSD(report.totals.membershipCoveredVsd)}{' '}
                          of member production was billed at $0. VSD still counts that production;
                          it will not become a practice payment.
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Alert severity="info" sx={{ mb: 3 }}>
              Paid-visit VSD ({fmtUSD(report.totals.paidVsd)}) should be close to practice cash
              ({fmtUSD(report.totals.practicePayments)}). Membership plan cash ({fmtUSD(report.totals.membershipPayments)})
              and online pharmacy ({fmtUSD(report.totals.pharmacyPayments)}) are excluded from the compare.
              Membership discounts ({fmtUSD(report.totals.membershipDiscount)}) are production that was never billed.
              {report.totals.pendingFutureVisit.invoices > 0
                ? ` ${report.totals.pendingFutureVisit.invoices} open invoice${
                    report.totals.pendingFutureVisit.invoices === 1 ? '' : 's'
                  } with a future appointment (${fmtUSD(report.totals.pendingFutureVisit.remaining)} remaining) are excluded until that visit is over.`
                : ''}
            </Alert>

            <Card sx={{ mb: 3 }}>
              <CardHeader
                title={isSingleDay ? `VSD vs payments for ${range.from.format('MMMM D, YYYY')}` : 'Daily VSD vs practice payments'}
                subheader="VSD by service date · payments by deposit date · America/New_York"
              />
              <CardContent>
                <Box sx={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`} />
                      <Tooltip formatter={(value) => fmtUSD(Number(value ?? 0))} />
                      <Legend />
                      <Bar dataKey="vsd" name="VSD" fill="#4c7fb5" />
                      <Bar dataKey="practicePayments" name="Practice payments" fill="#3d8a5a" />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardHeader
                title="Open VSD by doctor"
                subheader="Membership production is member write-downs (free or discounted). Still open is cash still owed on open invoices with no future appointment, including unpaid member charges."
              />
              <CardContent sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Doctor</TableCell>
                      <TableCell align="right">VSD</TableCell>
                      <TableCell align="right">Collected</TableCell>
                      <TableCell align="right">Membership production</TableCell>
                      <TableCell align="right">Still open</TableCell>
                      <TableCell align="right">Open invoices</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.doctors.map((d) => (
                      <TableRow key={d.doctor}>
                        <TableCell>{d.doctor}</TableCell>
                        <TableCell align="right">{fmtUSD(d.vsd)}</TableCell>
                        <TableCell align="right">{fmtUSD(d.paidVsd)}</TableCell>
                        <TableCell align="right">{fmtUSD(d.membershipDiscount)}</TableCell>
                        <TableCell align="right">{fmtUSD(d.openToCollect)}</TableCell>
                        <TableCell align="right">{d.openInvoices}</TableCell>
                      </TableRow>
                    ))}
                    {report.doctors.length > 0 && (
                      <TableRow>
                        <TableCell>
                          <strong>Total</strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>
                            {fmtUSD(report.doctors.reduce((s, d) => s + d.vsd, 0))}
                          </strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>
                            {fmtUSD(report.doctors.reduce((s, d) => s + d.paidVsd, 0))}
                          </strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>
                            {fmtUSD(
                              report.doctors.reduce((s, d) => s + d.membershipDiscount, 0)
                            )}
                          </strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>
                            {fmtUSD(report.doctors.reduce((s, d) => s + d.openToCollect, 0))}
                          </strong>
                        </TableCell>
                        <TableCell align="right">
                          <strong>
                            {report.doctors.reduce((s, d) => s + d.openInvoices, 0)}
                          </strong>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardHeader
                title="Who created the unpaid invoices"
                subheader="Invoice created-by employee · remaining balance on open invoices with no future appointment"
              />
              <CardContent sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Billed by</TableCell>
                      <TableCell>Role</TableCell>
                      <TableCell align="right">Open invoices</TableCell>
                      <TableCell align="right">Balance due</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.billers.map((b) => (
                      <TableRow key={`${b.name}-${b.role}`}>
                        <TableCell>{b.name}</TableCell>
                        <TableCell>{b.role}</TableCell>
                        <TableCell align="right">{b.invoices}</TableCell>
                        <TableCell align="right">{fmtUSD(b.remaining)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardHeader
                title="Open invoices with a balance"
                subheader={`${report.openInvoices.length} invoices · no future appointment on the books · open invoices have no payment posted, so payment type is the client’s usual (or last) practice method`}
              />
              <CardContent sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Invoice</TableCell>
                      <TableCell>Service</TableCell>
                      <TableCell>Client</TableCell>
                      <TableCell align="right">Balance</TableCell>
                      <TableCell>Payment type</TableCell>
                      <TableCell>Doctor</TableCell>
                      <TableCell>Billed by</TableCell>
                      <TableCell>Age</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.openInvoices.map((r) => (
                      <TableRow key={r.invoiceNumber}>
                        <TableCell>{r.invoiceNumber}</TableCell>
                        <TableCell>{r.serviceDate}</TableCell>
                        <TableCell>{r.client}</TableCell>
                        <TableCell align="right">{fmtUSD(r.remaining)}</TableCell>
                        <TableCell>{r.paymentType}</TableCell>
                        <TableCell>{r.doctor}</TableCell>
                        <TableCell>
                          {r.billedBy}
                          {r.billedRole !== '—' ? ` (${r.billedRole})` : ''}
                        </TableCell>
                        <TableCell>{r.age}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {report.closedInvoices.length > 0 && (
              <Card sx={{ mb: 3 }}>
                <CardHeader
                  title="Closed invoices that were not fully collected"
                  subheader="Payment type is the method actually applied"
                />
                <CardContent sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Invoice</TableCell>
                        <TableCell>Service</TableCell>
                        <TableCell>Client</TableCell>
                        <TableCell align="right">Still owed</TableCell>
                        <TableCell>Payment type</TableCell>
                        <TableCell>Doctor</TableCell>
                        <TableCell>Billed by</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.closedInvoices.map((r) => (
                        <TableRow key={r.invoiceNumber}>
                          <TableCell>{r.invoiceNumber}</TableCell>
                          <TableCell>{r.serviceDate}</TableCell>
                          <TableCell>{r.client}</TableCell>
                          <TableCell align="right">{fmtUSD(r.remaining)}</TableCell>
                          <TableCell>{r.paymentType}</TableCell>
                          <TableCell>{r.doctor}</TableCell>
                          <TableCell>{r.billedBy}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader
                title="Cash received, by payment type"
                subheader="Membership and pharmacy are excluded from the practice-payments comparison"
              />
              <CardContent sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Payment type</TableCell>
                      <TableCell align="right">Count</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell>In practice compare?</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.paymentTypes.map((p) => (
                      <TableRow key={p.type}>
                        <TableCell>{p.type}</TableCell>
                        <TableCell align="right">{p.count}</TableCell>
                        <TableCell align="right">{fmtUSD(p.total)}</TableCell>
                        <TableCell>{p.inPracticeCompare ? 'Yes' : 'No — tracked separately'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              VSD line value is quantity × price + service fee, minus the line percentage discount.
              The VSD tab also applies wellness and client-status discounts, so that total can be
              slightly lower. Invoice ownership and payment timing do not depend on that difference.
            </Typography>
          </>
        )}
      </Box>
    </LocalizationProvider>
  );
}
