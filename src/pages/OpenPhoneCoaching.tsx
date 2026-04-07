import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import dayjs from 'dayjs';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  fetchEmployeeRoles,
  fetchEmployeesByRole,
  type Employee,
  type EmployeeRole,
} from '../api/appointmentSettings';
import {
  getEmployeeCsrCoachingBatch,
  postEmployeeCsrCoachingBatch,
  type EmployeeCsrCoachingBatchReport,
  type EmployeeCsrCoachingBatchResponse,
} from '../api/openphoneCsrCoaching';

/** Receptionist rows for the coaching dropdown (from GET /employees/by-role for the Receptionist role). */
type ReceptionistOption = {
  id: number;
  firstName: string;
  lastName: string;
  openPhoneUserId?: string | null;
};

function dateInputDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function dateInputDefaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Local day start as ISO 8601 with offset (aligned with OpenPhone analytics). */
function toIsoRangeStart(dateYmd: string): string {
  return dayjs(dateYmd).startOf('day').format('YYYY-MM-DDTHH:mm:ss.SSSZ');
}

/** Range end: end of local day, capped at now. */
function toIsoRangeEnd(dateYmd: string): string {
  const end = dayjs(dateYmd).endOf('day');
  const now = dayjs();
  const cap = end.isAfter(now) ? now : end;
  return cap.format('YYYY-MM-DDTHH:mm:ss.SSSZ');
}

function formatIsoDisplay(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { message?: string | string[] } | undefined;
    if (typeof d?.message === 'string') return d.message;
    if (Array.isArray(d?.message)) return d.message.join(', ');
    if (err.response?.status === 404) {
      return 'No data found for this employee and date range.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

function sortReceptionists(a: ReceptionistOption, b: ReceptionistOption): number {
  const ln = a.lastName.localeCompare(b.lastName);
  if (ln !== 0) return ln;
  return a.firstName.localeCompare(b.firstName);
}

function normRoleToken(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Match the EVet “Receptionist” role: exact name (case-insensitive), then roleValue, then name contains “receptionist”.
 */
function findReceptionistRoleId(roles: EmployeeRole[]): number | null {
  const byName = roles.find((r) => normRoleToken(r.name) === 'receptionist');
  if (byName) return byName.id;
  const byValue = roles.find((r) => normRoleToken(r.roleValue) === 'receptionist');
  if (byValue) return byValue.id;
  const fuzzy = roles.find((r) => normRoleToken(r.name).includes('receptionist'));
  return fuzzy?.id ?? null;
}

function receptionistOptionsFromEmployees(emps: Employee[]): ReceptionistOption[] {
  return emps.map((e) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    openPhoneUserId: e.openPhoneUserId ?? null,
  }));
}

function StringList({ items, dense }: { items: string[]; dense?: boolean }) {
  if (!items?.length) return <Typography color="text.secondary">—</Typography>;
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5, ...(dense ? { '& li': { mb: 0.5 } } : {}) }}>
      {items.map((t, i) => (
        <li key={i}>
          <Typography variant="body2" component="span">
            {t}
          </Typography>
        </li>
      ))}
    </Box>
  );
}

function ReportSections({ report }: { report: EmployeeCsrCoachingBatchReport }) {
  const { employeeSummary, performanceScorecard } = report;

  return (
    <Stack spacing={3} sx={{ mt: 2 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Employee summary
          </Typography>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>
            Themes
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1 }}>
            {(employeeSummary.themes ?? []).map((t, i) => (
              <Chip key={i} size="small" label={t} variant="outlined" />
            ))}
          </Stack>
          <Typography variant="subtitle2" color="text.secondary">
            Wins
          </Typography>
          <StringList items={employeeSummary.wins ?? []} />
          <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>
            Growth areas
          </Typography>
          <StringList items={employeeSummary.growthAreas ?? []} />
        </CardContent>
      </Card>

      {report.openingNote ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Opening note
            </Typography>
            <Typography variant="body2" whiteSpace="pre-wrap">
              {report.openingNote}
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      {(report.callSummaryTable ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Call summary
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Dimension</TableCell>
                    <TableCell>Notes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.callSummaryTable.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ verticalAlign: 'top', fontWeight: 600 }}>
                        {row.dimension}
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>
                        {row.notes}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : null}

      {(report.csrStrengths ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              CSR strengths
            </Typography>
            <StringList items={report.csrStrengths} />
          </CardContent>
        </Card>
      ) : null}

      {(performanceScorecard?.dimensions ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Performance scorecard
            </Typography>
            <Stack spacing={2}>
              {performanceScorecard.dimensions.map((dim, i) => {
                const max = dim.maxScore > 0 ? dim.maxScore : 1;
                const pct = Math.min(100, Math.max(0, (dim.score / max) * 100));
                return (
                  <Box key={i}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="baseline"
                      sx={{ mb: 0.5 }}
                    >
                      <Typography variant="subtitle2">{dim.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {dim.score} / {dim.maxScore}
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={pct}
                      sx={{ height: 8, borderRadius: 1, mb: 0.5 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {dim.comment}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      {(report.fiveStepCallFramework ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Five-step call framework
            </Typography>
            <Stack spacing={1.5}>
              {report.fiveStepCallFramework.map((row, i) => (
                <Box key={i}>
                  <Typography variant="subtitle2">{row.step}</Typography>
                  <Typography variant="body2" color="text.secondary" whiteSpace="pre-wrap">
                    {row.guidance}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      {(report.closingScripts ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Closing scripts
            </Typography>
            <StringList items={report.closingScripts} />
          </CardContent>
        </Card>
      ) : null}

      {(report.pricingScripts ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Pricing scripts
            </Typography>
            <StringList items={report.pricingScripts} />
          </CardContent>
        </Card>
      ) : null}

      {report.referralHandling ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Referral handling
            </Typography>
            <Typography variant="body2" whiteSpace="pre-wrap">
              {report.referralHandling}
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      {(report.callReviews ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Call reviews
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Observation</TableCell>
                    <TableCell>Suggestion</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.callReviews.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>
                        {row.observation}
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>
                        {row.suggestion}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : null}

      {(report.insights ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Insights
            </Typography>
            <StringList items={report.insights} />
          </CardContent>
        </Card>
      ) : null}

      {(report.actionPlan ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Action plan
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Step</TableCell>
                    <TableCell>Detail</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.actionPlan.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell
                        sx={{ verticalAlign: 'top', fontWeight: 600, whiteSpace: 'pre-wrap' }}
                      >
                        {row.step}
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top', whiteSpace: 'pre-wrap' }}>
                        {row.detail}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : null}

      {(report.perCall ?? []).length > 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Per-call coaching
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Use <code>callId</code> to open the call in OpenPhone or your call detail view.
            </Typography>
            {report.perCall.map((pc, i) => (
              <Accordion
                key={`${pc.callId}-${i}`}
                disableGutters
                sx={{ '&:before': { display: 'none' } }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    sx={{ pr: 1 }}
                  >
                    <Typography variant="subtitle2" fontFamily="monospace" fontSize="0.8rem">
                      {pc.callId}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {pc.reason || '—'}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.5} divider={<Divider flexItem />}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Caller / pet
                      </Typography>
                      <Typography variant="body2">
                        {pc.callerType} · {pc.pet}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Outcome
                      </Typography>
                      <Typography variant="body2" whiteSpace="pre-wrap">
                        {pc.outcome || '—'}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Strengths
                      </Typography>
                      <StringList items={pc.strengths ?? []} dense />
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Missed booking opportunities
                      </Typography>
                      <StringList items={pc.missedBookingOpportunities ?? []} dense />
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        Coaching tip
                      </Typography>
                      <Typography variant="body2" whiteSpace="pre-wrap">
                        {pc.coachingTip || '—'}
                      </Typography>
                    </Box>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}

export default function OpenPhoneCoaching() {
  const [receptionists, setReceptionists] = useState<ReceptionistOption[]>([]);
  const [receptionistsError, setReceptionistsError] = useState<string | null>(null);
  const [staffLoading, setStaffLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState<number | ''>('');
  const [fromDate, setFromDate] = useState(dateInputDefaultFrom);
  const [toDate, setToDate] = useState(dateInputDefaultTo);
  const [batch, setBatch] = useState<EmployeeCsrCoachingBatchResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fromIso = useMemo(() => toIsoRangeStart(fromDate), [fromDate]);
  const toIso = useMemo(() => toIsoRangeEnd(toDate), [toDate]);

  useEffect(() => {
    let alive = true;
    setReceptionistsError(null);
    setStaffLoading(true);
    (async () => {
      try {
        const roles = await fetchEmployeeRoles();
        if (!alive) return;
        const roleId = findReceptionistRoleId(roles);
        if (roleId == null) {
          setReceptionists([]);
          setReceptionistsError(
            'No employee role named “Receptionist” was found. Add or activate that role in your practice configuration.'
          );
          return;
        }
        const emps = await fetchEmployeesByRole(roleId);
        if (!alive) return;
        setReceptionists(receptionistOptionsFromEmployees(emps).sort(sortReceptionists));
      } catch (e) {
        if (alive) setReceptionistsError(apiErrorMessage(e));
      } finally {
        if (alive) setStaffLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selectedReceptionist = useMemo(
    () =>
      typeof employeeId === 'number'
        ? (receptionists.find((e) => e.id === employeeId) ?? null)
        : null,
    [employeeId, receptionists]
  );

  const pollBatch = useCallback(async () => {
    if (typeof employeeId !== 'number') return;
    try {
      const next = await getEmployeeCsrCoachingBatch(employeeId, { from: fromIso, to: toIso });
      setBatch(next);
      if (next.status !== 'pending') setActionError(null);
    } catch (e) {
      setActionError(apiErrorMessage(e));
    }
  }, [employeeId, fromIso, toIso]);

  useEffect(() => {
    if (batch?.status !== 'pending' || typeof employeeId !== 'number') return;
    const t = window.setInterval(() => {
      void pollBatch();
    }, 2500);
    return () => window.clearInterval(t);
  }, [batch?.status, employeeId, pollBatch]);

  const runPost = async (refresh: boolean) => {
    if (typeof employeeId !== 'number') return;
    setActionError(null);
    setBusy(true);
    try {
      const res = await postEmployeeCsrCoachingBatch(employeeId, {
        from: fromIso,
        to: toIso,
        refresh,
      });
      setBatch(res);
    } catch (e) {
      setBatch(null);
      setActionError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runGet = async () => {
    if (typeof employeeId !== 'number') return;
    setActionError(null);
    setBusy(true);
    try {
      const res = await getEmployeeCsrCoachingBatch(employeeId, { from: fromIso, to: toIso });
      setBatch(res);
    } catch (e) {
      setBatch(null);
      setActionError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const formLocked = busy || batch?.status === 'pending';

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Open Phone Coaching</h2>
      <p className="settings-section-description">
        Batch CSR coaching from transcribed OpenPhone voice calls for one receptionist over a date
        range. The dropdown lists everyone assigned the Receptionist employee role (from{' '}
        <code>GET /employees/roles</code> and <code>GET /employees/by-role</code>). Generating a new
        report calls OpenAI and may take up to a minute. Loading cached results does not re-run the
        model.
      </p>

      {receptionistsError ? (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.light' }}>
          <Typography color="error.dark">
            Could not load receptionists: {receptionistsError}
          </Typography>
        </Paper>
      ) : null}

      {!receptionistsError && !staffLoading && receptionists.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          No employees are assigned the Receptionist role, or the role has no members in your
          practice.
        </Alert>
      ) : null}

      {staffLoading && !receptionistsError ? (
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Loading receptionists…
          </Typography>
        </Stack>
      ) : null}

      <Stack spacing={2} sx={{ mb: 2, maxWidth: 720 }}>
        <FormControl fullWidth size="small">
          <InputLabel id="openphone-coaching-employee-label">Receptionist</InputLabel>
          <Select
            labelId="openphone-coaching-employee-label"
            label="Receptionist"
            value={employeeId === '' ? '' : String(employeeId)}
            onChange={(e) => {
              const v = e.target.value;
              setEmployeeId(v === '' ? '' : Number(v));
              setBatch(null);
              setActionError(null);
            }}
            disabled={formLocked || staffLoading}
          >
            <MenuItem value="">
              <em>Select a receptionist</em>
            </MenuItem>
            {receptionists.map((e) => (
              <MenuItem key={e.id} value={String(e.id)}>
                {e.lastName}, {e.firstName}
                {e.openPhoneUserId ? '' : ' (no OpenPhone user id)'}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {selectedReceptionist && !selectedReceptionist.openPhoneUserId ? (
          <Alert severity="warning">
            This receptionist has no <code>openPhoneUserId</code>. Sync OpenPhone on the backend
            before coaching can run.
          </Alert>
        ) : null}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl fullWidth size="small">
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
              From (local start of day)
            </Typography>
            <input
              type="date"
              className="settings-input"
              value={fromDate}
              onChange={(ev) => {
                setFromDate(ev.target.value);
                setBatch(null);
                setActionError(null);
              }}
              disabled={formLocked}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
              }}
            />
          </FormControl>
          <FormControl fullWidth size="small">
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
              To (local end of day, capped at now)
            </Typography>
            <input
              type="date"
              className="settings-input"
              value={toDate}
              onChange={(ev) => {
                setToDate(ev.target.value);
                setBatch(null);
                setActionError(null);
              }}
              disabled={formLocked}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
              }}
            />
          </FormControl>
        </Stack>

        <Stack direction="row" flexWrap="wrap" gap={1}>
          <Button
            variant="contained"
            disabled={typeof employeeId !== 'number' || formLocked}
            onClick={() => void runPost(false)}
          >
            Generate / load report
          </Button>
          <Button
            variant="outlined"
            disabled={typeof employeeId !== 'number' || formLocked}
            onClick={() => void runGet()}
          >
            Load cached only
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            disabled={typeof employeeId !== 'number' || formLocked}
            onClick={() => void runPost(true)}
          >
            Regenerate (OpenAI)
          </Button>
        </Stack>
      </Stack>

      {actionError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      ) : null}

      {busy && !batch ? (
        <Stack direction="row" alignItems="center" gap={1} sx={{ py: 2 }}>
          <CircularProgress size={22} />
          <Typography variant="body2">Working…</Typography>
        </Stack>
      ) : null}

      {batch ? (
        <Box sx={{ mt: 1 }}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack spacing={1}>
              <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                <Typography variant="subtitle1">Status: {batch.status}</Typography>
                {batch.status === 'pending' ? <CircularProgress size={18} /> : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Range: {formatIsoDisplay(batch.rangeFrom)} — {formatIsoDisplay(batch.rangeTo)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                OpenPhone user: {batch.openPhoneUserId ?? '—'}
              </Typography>
              {batch.openaiModel ? (
                <Typography variant="body2" color="text.secondary">
                  Model: {batch.openaiModel}
                  {batch.promptTokens != null && batch.completionTokens != null
                    ? ` · tokens ${batch.promptTokens} + ${batch.completionTokens}`
                    : ''}
                  {typeof batch.retryCount === 'number' ? ` · retries ${batch.retryCount}` : ''}
                </Typography>
              ) : null}
              {batch.includedCallIds?.length ? (
                <Typography variant="body2" color="text.secondary">
                  Calls included ({batch.includedCallIds.length}):{' '}
                  <Box
                    component="span"
                    sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}
                  >
                    {batch.includedCallIds.join(', ')}
                  </Box>
                </Typography>
              ) : null}
            </Stack>
          </Paper>

          {batch.status === 'failed' && batch.errorMessage ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {batch.errorMessage}
            </Alert>
          ) : null}

          {batch.status === 'pending' ? (
            <Alert severity="info">
              Report is generating. This page will refresh every few seconds until it completes or
              fails.
            </Alert>
          ) : null}

          {batch.status === 'completed' && batch.report ? (
            <ReportSections report={batch.report} />
          ) : null}
        </Box>
      ) : null}
    </div>
  );
}
