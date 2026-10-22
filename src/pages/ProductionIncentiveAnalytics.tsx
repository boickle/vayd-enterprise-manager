import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Radio,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import dayjs, { type Dayjs } from 'dayjs';
import {
  GOAL_PERIOD_LABELS,
  describePayoutSchedule,
  fetchProductionIncentiveReport,
  fetchProductionIncentiveSettings,
  sendProductionIncentiveReport,
  type ProductionIncentiveEvaluation,
  type ProductionIncentiveGranularity,
  type ProductionIncentiveReport,
  type ProductionIncentiveSettings,
} from '../api/productionIncentive';

const TREND_PERIODS = 6;
/** Keeps the payout-period trend to about two years of data. */
const PAYOUT_TREND_MONTHS = 24;

const GRANULARITIES: { value: ProductionIncentiveGranularity; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'payout', label: 'Payout period' },
];

function shiftAnchor(
  d: Dayjs,
  g: ProductionIncentiveGranularity,
  n: number,
  payoutMonths: number
): Dayjs {
  if (g === 'week') return d.add(n * 7, 'day');
  if (g === 'month') return d.add(n, 'month');
  if (g === 'payout') return d.add(n * payoutMonths, 'month');
  return d.add(n * 3, 'month');
}

function trendPeriods(g: ProductionIncentiveGranularity, payoutMonths: number): number {
  if (g !== 'payout') return TREND_PERIODS;
  return Math.max(2, Math.min(TREND_PERIODS, Math.floor(PAYOUT_TREND_MONTHS / payoutMonths)));
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function fmtPct(n: number | null) {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}

function extractErr(err: unknown): string {
  const e = err as {
    response?: { status?: number; data?: { message?: string | string[] } };
    message?: string;
  };
  if (e?.response?.status === 403) return 'Only admins can view the production incentive report.';
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('; ');
  return msg ?? e?.message ?? 'Request failed';
}

/** Green once 100% is reached, darker as higher tiers are hit; amber when close; red otherwise. */
function toneFor(ev: ProductionIncentiveEvaluation): { bg: string; fg: string } {
  const pct = ev.percentOfGoal ?? 0;
  if (ev.highestTierAchieved != null && ev.highestTierAchieved > 100)
    return { bg: '#c8e6c9', fg: '#1b5e20' };
  if (ev.highestTierAchieved === 100) return { bg: '#e8f5e9', fg: '#2e7d32' };
  if (pct >= 90) return { bg: '#fff8e1', fg: '#8d6e00' };
  return { bg: '#ffebee', fg: '#b71c1c' };
}

export default function ProductionIncentiveAnalyticsPage() {
  const [granularity, setGranularity] = useState<ProductionIncentiveGranularity>('month');
  const [anchor, setAnchor] = useState<Dayjs>(() => dayjs().startOf('day'));
  const [report, setReport] = useState<ProductionIncentiveReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [settings, setSettings] = useState<ProductionIncentiveSettings | null>(null);
  const payoutMonths = settings?.payoutMonths ?? 3;

  const start = shiftAnchor(
    anchor,
    granularity,
    -(trendPeriods(granularity, payoutMonths) - 1),
    payoutMonths
  ).format('YYYY-MM-DD');
  const end = anchor.format('YYYY-MM-DD');

  useEffect(() => {
    let alive = true;
    fetchProductionIncentiveSettings()
      .then((s) => alive && setSettings(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const settingsReady = granularity !== 'payout' || !!settings;

  useEffect(() => {
    if (!settingsReady) return;
    let alive = true;
    setLoading(true);
    setError(null);
    fetchProductionIncentiveReport({ granularity, start, end })
      .then((data) => alive && setReport(data))
      .catch((e) => {
        if (!alive) return;
        setError(extractErr(e));
        setReport(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [granularity, start, end, settingsReady]);

  const selectedPeriod = report?.periods[report.periods.length - 1] ?? null;
  const selectedIdx = (report?.periods.length ?? 1) - 1;
  const canGoForward = selectedPeriod?.status === 'complete';
  const payoutPeriod = report?.payoutPeriod ?? null;
  const isPayoutView =
    !!selectedPeriod &&
    !!payoutPeriod &&
    selectedPeriod.start === payoutPeriod.start &&
    selectedPeriod.end === payoutPeriod.end;

  const totals = useMemo(() => {
    if (!report) return null;
    let actual = 0;
    let goal = 0;
    let projected = 0;
    let dvmBonus = 0;
    let techBonus = 0;
    for (const d of report.doctors) {
      const ev = d.periods[selectedIdx];
      actual += ev.actual;
      goal += ev.goal;
      projected += ev.projected ?? ev.actual;
      dvmBonus += d.payout.bonus?.dvm ?? 0;
      techBonus += d.payout.bonus?.tech ?? 0;
    }
    return {
      actual,
      goal,
      projected,
      dvmBonus,
      techBonus,
      pct: goal > 0 ? (actual / goal) * 100 : null,
    };
  }, [report, selectedIdx]);

  return (
    <Box sx={{ pb: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Production Incentive
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Each doctor&apos;s VSD against their incentive plan goal (100%) and stretch tiers. Goals are
        prorated from the period they are set in (52 weeks / 12 months / 4 quarters per year).
        Bonuses are earned over the payout period
        {settings ? ` (${describePayoutSchedule(settings).toLowerCase()})` : ''}: a doctor has to
        reach a tier for the whole payout period to be paid. Manage goals and the payout schedule in{' '}
        <RouterLink to="/settings?tab=production-incentive">
          Settings → Production Incentive
        </RouterLink>
        .
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <ButtonGroup size="small">
            {GRANULARITIES.map((g) => (
              <Button
                key={g.value}
                variant={granularity === g.value ? 'contained' : 'outlined'}
                onClick={() => setGranularity(g.value)}
              >
                {g.label}
              </Button>
            ))}
          </ButtonGroup>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton
              size="small"
              onClick={() => setAnchor((a) => shiftAnchor(a, granularity, -1, payoutMonths))}
            >
              <ChevronLeft />
            </IconButton>
            <Typography sx={{ minWidth: 170, textAlign: 'center', fontWeight: 600 }}>
              {selectedPeriod?.label ?? '…'}
            </Typography>
            <IconButton
              size="small"
              disabled={!canGoForward}
              onClick={() => setAnchor((a) => shiftAnchor(a, granularity, 1, payoutMonths))}
            >
              <ChevronRight />
            </IconButton>
            <Button size="small" onClick={() => setAnchor(dayjs().startOf('day'))}>
              Current
            </Button>
          </Box>
          {selectedPeriod?.status === 'in_progress' && (
            <Chip
              size="small"
              label={`In progress · day ${selectedPeriod.elapsedDays} of ${selectedPeriod.totalDays}`}
            />
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            disabled={!report?.doctors.length || !selectedPeriod}
            onClick={() => setSendOpen(true)}
          >
            Send report
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box
          sx={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <CircularProgress />
        </Box>
      ) : report && !report.doctors.length ? (
        <Alert severity="info">
          No doctors have a production incentive goal yet. Add goals in{' '}
          <RouterLink to="/settings?tab=production-incentive">
            Settings → Production Incentive
          </RouterLink>
          .
        </Alert>
      ) : report && selectedPeriod && payoutPeriod && totals ? (
        <>
          <Card sx={{ mb: 3 }}>
            <CardHeader
              title={`${selectedPeriod.label} (${selectedPeriod.start} to ${selectedPeriod.end})`}
              subheader={`All plan doctors: ${fmtUSD(totals.actual)} of ${fmtUSD(totals.goal)} (${fmtPct(totals.pct)})${
                selectedPeriod.status === 'in_progress'
                  ? ` · on pace for ${fmtUSD(totals.projected)}`
                  : ''
              } · Bonuses for ${isPayoutView ? 'this payout period' : `payout period ${payoutPeriod.label}`}: DVM ${fmtUSD(totals.dvmBonus)}, tech ${fmtUSD(totals.techBonus)}${
                payoutPeriod.status === 'in_progress' ? ' (earned so far)' : ''
              }`}
            />
            <CardContent sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Doctor</TableCell>
                    <TableCell align="right">VSD</TableCell>
                    <TableCell align="right">100% goal</TableCell>
                    <TableCell sx={{ minWidth: 160 }}>% of goal</TableCell>
                    {selectedPeriod.status === 'in_progress' && (
                      <TableCell align="right">On pace for</TableCell>
                    )}
                    <TableCell>Tiers</TableCell>
                    {!isPayoutView && (
                      <TableCell sx={{ minWidth: 170 }}>
                        Payout period
                        <Typography variant="caption" color="text.secondary" display="block">
                          {payoutPeriod.label}
                          {payoutPeriod.status === 'in_progress' ? ' (in progress)' : ''}
                        </Typography>
                      </TableCell>
                    )}
                    <TableCell align="right">DVM bonus</TableCell>
                    <TableCell align="right">Tech bonus</TableCell>
                    <TableCell>Next tier</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.doctors.map((d) => {
                    const ev = d.periods[selectedIdx];
                    const pct = ev.percentOfGoal ?? 0;
                    return (
                      <TableRow key={d.employeeId}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {d.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {fmtUSD(d.goal.baseGoal)}{' '}
                            {GOAL_PERIOD_LABELS[d.goal.goalPeriod].toLowerCase()}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">{fmtUSD(ev.actual)}</TableCell>
                        <TableCell align="right">{fmtUSD(ev.goal)}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(100, pct)}
                              color={pct >= 100 ? 'success' : pct >= 90 ? 'warning' : 'error'}
                              sx={{ flex: 1, height: 8, borderRadius: 4 }}
                            />
                            <Typography variant="body2" sx={{ minWidth: 52, textAlign: 'right' }}>
                              {fmtPct(ev.percentOfGoal)}
                            </Typography>
                          </Box>
                        </TableCell>
                        {selectedPeriod.status === 'in_progress' && (
                          <TableCell align="right">
                            {ev.projected != null
                              ? `${fmtUSD(ev.projected)} (${fmtPct(ev.projectedPercentOfGoal)})`
                              : '—'}
                          </TableCell>
                        )}
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                            {ev.tiers.map((t) => (
                              <Tooltip
                                key={t.percent}
                                title={`${
                                  t.achieved
                                    ? `Reached ${fmtUSD(t.goal)}`
                                    : `${fmtUSD(t.remaining)} to reach ${fmtUSD(t.goal)}`
                                }${t.pool > 0 ? ` · pays ${fmtUSD(t.pool)} (${t.marginShare}% of margin)` : ''}`}
                              >
                                <Chip
                                  size="small"
                                  label={`${t.percent}%`}
                                  color={t.achieved ? 'success' : 'default'}
                                  variant={t.achieved ? 'filled' : 'outlined'}
                                />
                              </Tooltip>
                            ))}
                          </Box>
                        </TableCell>
                        {!isPayoutView && (
                          <TableCell>
                            {fmtUSD(d.payout.actual)} of {fmtUSD(d.payout.goal)} (
                            {fmtPct(d.payout.percentOfGoal)})
                            <Typography variant="caption" color="text.secondary" display="block">
                              {d.payout.nextTier
                                ? `${d.payout.nextTier.percent}%: ${fmtUSD(d.payout.nextTier.remaining)} to go${
                                    d.payout.nextTier.pool > 0
                                      ? ` · pays ${fmtUSD(d.payout.nextTier.pool)}`
                                      : ''
                                  }`
                                : 'All tiers reached'}
                            </Typography>
                          </TableCell>
                        )}
                        <TableCell align="right">
                          {d.payout.bonus ? fmtUSD(d.payout.bonus.dvm) : '—'}
                          <Typography variant="caption" color="text.secondary" display="block">
                            {d.payout.dvmSharePercent}%
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {d.payout.bonus ? fmtUSD(d.payout.bonus.tech) : '—'}
                          <Typography variant="caption" color="text.secondary" display="block">
                            {100 - d.payout.dvmSharePercent}%
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {ev.nextTier ? (
                            <>
                              {ev.nextTier.percent}%: {fmtUSD(ev.nextTier.remaining)} to go
                              {ev.nextTier.pool > 0 && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  display="block"
                                >
                                  pays {fmtUSD(ev.nextTier.pool)} pool
                                </Typography>
                              )}
                            </>
                          ) : (
                            'All tiers reached'
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title={`Last ${report.periods.length} ${GRANULARITIES.find((g) => g.value === granularity)?.label.toLowerCase()}s`}
              subheader="VSD and percent of the 100% goal. Darker green = a stretch tier was reached."
            />
            <CardContent sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Doctor</TableCell>
                    {report.periods.map((p) => (
                      <TableCell key={p.key} align="center">
                        {p.label}
                        {p.status === 'in_progress' ? ' *' : ''}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.doctors.map((d) => (
                    <TableRow key={d.employeeId}>
                      <TableCell>{d.name}</TableCell>
                      {d.periods.map((ev, i) => {
                        const period = report.periods[i];
                        if (period.status === 'future') {
                          return (
                            <TableCell key={ev.key} align="center">
                              —
                            </TableCell>
                          );
                        }
                        const tone = toneFor(ev);
                        return (
                          <TableCell
                            key={ev.key}
                            align="center"
                            sx={{ bgcolor: tone.bg, color: tone.fg }}
                          >
                            <div>{fmtUSD(ev.actual)}</div>
                            <Typography variant="caption">
                              {fmtPct(ev.percentOfGoal)}
                              {ev.highestTierAchieved && ev.highestTierAchieved > 100
                                ? ` · ${ev.highestTierAchieved}% tier`
                                : ''}
                            </Typography>
                            {ev.bonus && (
                              <Typography variant="caption" display="block">
                                Bonus {fmtUSD(ev.bonus.pool)}
                              </Typography>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {report.periods.some((p) => p.status === 'in_progress') && (
                <Typography variant="caption" color="text.secondary">
                  * In progress
                </Typography>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {sendOpen && report && selectedPeriod && (
        <SendReportDialog
          report={report}
          granularity={granularity}
          periodLabel={selectedPeriod.label}
          periodDate={selectedPeriod.start}
          onClose={() => setSendOpen(false)}
        />
      )}
    </Box>
  );
}

function SendReportDialog({
  report,
  granularity,
  periodLabel,
  periodDate,
  onClose,
}: {
  report: ProductionIncentiveReport;
  granularity: ProductionIncentiveGranularity;
  periodLabel: string;
  periodDate: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(report.doctors.map((d) => d.employeeId))
  );
  const [mode, setMode] = useState<'individual' | 'combined'>('individual');
  const [recipientsRaw, setRecipientsRaw] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const additionalRecipients = useMemo(
    () =>
      recipientsRaw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [recipientsRaw]
  );
  const invalidEmails = additionalRecipients.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const missingEmail = report.doctors.filter((d) => selected.has(d.employeeId) && !d.email);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canSend =
    selected.size > 0 &&
    invalidEmails.length === 0 &&
    (mode === 'individual' || additionalRecipients.length > 0) &&
    !sending;

  const handleSend = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const res = await sendProductionIncentiveReport({
        granularity,
        date: periodDate,
        employeeIds: [...selected],
        mode,
        additionalRecipients,
        notes: notes.trim() || undefined,
      });
      const parts = [`Sent ${res.sent.length} email${res.sent.length === 1 ? '' : 's'}.`];
      if (res.skipped.length) parts.push(`Skipped (no email on file): ${res.skipped.join(', ')}.`);
      setResult(parts.join(' '));
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setSending(false);
    }
  }, [additionalRecipients, granularity, mode, notes, periodDate, selected]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Send production incentive report – {periodLabel}</DialogTitle>
      <DialogContent dividers>
        {result ? (
          <Alert severity="success">{result}</Alert>
        ) : (
          <>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Doctors
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', mb: 2 }}>
              {report.doctors.map((d) => (
                <FormControlLabel
                  key={d.employeeId}
                  control={
                    <Checkbox
                      size="small"
                      checked={selected.has(d.employeeId)}
                      onChange={() => toggle(d.employeeId)}
                    />
                  }
                  label={
                    <span>
                      {d.name}{' '}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {d.email ?? 'no email on file'}
                      </Typography>
                    </span>
                  }
                />
              ))}
            </Box>

            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Delivery
            </Typography>
            <RadioGroup
              value={mode}
              onChange={(e) => setMode(e.target.value as 'individual' | 'combined')}
              sx={{ mb: 2 }}
            >
              <FormControlLabel
                value="individual"
                control={<Radio size="small" />}
                label="One email per doctor with only their results (sent to the doctor and anyone listed below)"
              />
              <FormControlLabel
                value="combined"
                control={<Radio size="small" />}
                label="One email with all selected doctors (sent only to the recipients below)"
              />
            </RadioGroup>

            <TextField
              label={mode === 'combined' ? 'Recipients' : 'Additional recipients (optional)'}
              placeholder="team@vetatyourdoor.com, manager@vetatyourdoor.com"
              fullWidth
              size="small"
              value={recipientsRaw}
              onChange={(e) => setRecipientsRaw(e.target.value)}
              error={invalidEmails.length > 0}
              helperText={
                invalidEmails.length
                  ? `Invalid: ${invalidEmails.join(', ')}`
                  : 'Separate multiple addresses with commas.'
              }
              sx={{ mb: 2 }}
            />
            <TextField
              label="Notes"
              placeholder="Great month, team! Here's where we landed…"
              fullWidth
              multiline
              minRows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              inputProps={{ maxLength: 5000 }}
            />

            {mode === 'individual' &&
              missingEmail.length > 0 &&
              additionalRecipients.length === 0 && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  No email on file for {missingEmail.map((d) => d.name).join(', ')}; they will be
                  skipped unless you add recipients.
                </Alert>
              )}
            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
        {!result && (
          <Button variant="contained" disabled={!canSend} onClick={() => void handleSend()}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
