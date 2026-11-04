import { useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowLeft, Pencil, RefreshCw } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CampaignRecipient,
  CampaignReport,
  errorMessage,
  getEmailCampaignRecipients,
  getEmailCampaignReport,
  GOAL_LABELS,
  PET_LOSS_REASONS,
  SKIP_REASON_LABELS,
} from '../../api/emailCampaigns';
import { formatDateTime, percent, StatusChip } from './campaignFormat';
import { MARKETING_BASE_PATH } from './EmailCampaignsPage';

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h4" fontWeight={700} sx={{ my: 0.5 }}>
        {value}
      </Typography>
      {sub ? (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      ) : null}
    </Paper>
  );
}

const RECIPIENT_STATUS_LABELS: Record<CampaignRecipient['status'], string> = {
  pending: 'Waiting',
  sending: 'Sending',
  sent: 'Sent',
  skipped: 'Skipped',
  failed: 'Failed',
};

export default function EmailCampaignReportPage() {
  const { id = '' } = useParams();
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [recipients, setRecipients] = useState<{ total: number; rows: CampaignRecipient[] } | null>(
    null
  );

  const load = async () => {
    setLoading(true);
    try {
      setReport(await getEmailCampaignReport(id));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the report.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (report?.campaign.status !== 'sending') return;
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.campaign.status]);

  useEffect(() => {
    let alive = true;
    getEmailCampaignRecipients(id, { status: statusFilter || undefined, page: page + 1, pageSize })
      .then((r) => alive && setRecipients(r))
      .catch(() => alive && setRecipients({ total: 0, rows: [] }));
    return () => {
      alive = false;
    };
  }, [id, statusFilter, page, pageSize, report]);

  if (error && !report) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }
  if (!report) {
    return (
      <Box sx={{ p: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  const { campaign, delivery, engagement, conversions } = report;
  const petLossSkipped = delivery.skippedByReason
    .filter((s) => PET_LOSS_REASONS.includes(s.reason as never))
    .reduce((n, s) => n + s.count, 0);
  const timeline = report.timeline.map((t) => ({ ...t, label: `Day ${t.day + 1}` }));

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1280, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <Button
          component={RouterLink}
          to={MARKETING_BASE_PATH}
          startIcon={<ArrowLeft size={16} />}
          size="small"
        >
          Campaigns
        </Button>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h5" fontWeight={700}>
            {campaign.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {campaign.subject} · started {formatDateTime(campaign.sendStartedAt)}
            {campaign.sentAt ? ` · finished ${formatDateTime(campaign.sentAt)}` : ''}
          </Typography>
        </Box>
        <StatusChip status={campaign.status} />
        <Button
          size="small"
          startIcon={<Pencil size={16} />}
          component={RouterLink}
          to={`${MARKETING_BASE_PATH}/${campaign.id}`}
        >
          View email
        </Button>
        <Button
          size="small"
          startIcon={loading ? <CircularProgress size={14} /> : <RefreshCw size={16} />}
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {delivery.pending > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Still sending: {delivery.pending.toLocaleString()} emails to go.
        </Alert>
      ) : null}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={2.4}>
          <Kpi
            label="Delivered"
            value={delivery.sent.toLocaleString()}
            sub={`${delivery.skipped.toLocaleString()} skipped · ${delivery.failed.toLocaleString()} failed`}
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Kpi
            label="Opened"
            value={percent(engagement.opened, delivery.sent)}
            sub={`${engagement.opened.toLocaleString()} people`}
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Kpi
            label="Clicked"
            value={percent(engagement.clicked, delivery.sent)}
            sub={`${engagement.clicked.toLocaleString()} people · ${percent(engagement.clicked, engagement.opened)} of openers`}
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <Kpi
            label={
              conversions.tracked
                ? `Converted: ${GOAL_LABELS[campaign.goal.type].toLowerCase()}`
                : 'Converted'
            }
            value={conversions.tracked ? percent(conversions.converted, delivery.sent) : '—'}
            sub={
              conversions.tracked
                ? `${conversions.converted.toLocaleString()} people within ${campaign.goal.windowDays} days`
                : 'No goal was set'
            }
          />
        </Grid>
        <Grid item xs={12} md={2.4}>
          <Kpi
            label="Unsubscribed"
            value={engagement.unsubscribed.toLocaleString()}
            sub={`${engagement.bounced} bounced · ${engagement.complained} spam reports`}
          />
        </Grid>
      </Grid>

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Opens are counted when the recipient’s mail app loads images. Some apps load images
        automatically (raising opens) and some block them (lowering opens), so clicks and
        conversions are the more reliable measures.
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              First opens and clicks, by day after sending
            </Typography>
            <Box sx={{ height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="opens"
                    name="Opens"
                    stroke="#0f766e"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="clicks"
                    name="Clicks"
                    stroke="#b45309"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={4}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Conversions
            </Typography>
            {conversions.tracked ? (
              <>
                <Row label="Converted" value={conversions.converted} />
                <Row label="…who opened the email" value={conversions.fromOpeners} />
                <Row
                  label="…who didn’t open it (or blocked images)"
                  value={conversions.fromNonOpeners}
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Counted when the goal happened within {campaign.goal.windowDays} days after the
                  email went out. People who would have booked anyway are included, so compare with
                  similar campaigns.
                </Typography>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Set a goal on the campaign to measure conversions. Duplicated campaigns keep their
                goal.
              </Typography>
            )}
            <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2 }}>
              Not sent
            </Typography>
            {delivery.skippedByReason.length ? (
              delivery.skippedByReason.map((s) => (
                <Row
                  key={s.reason}
                  label={SKIP_REASON_LABELS[s.reason] ?? s.reason}
                  value={s.count}
                />
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                Nobody was skipped.
              </Typography>
            )}
            {petLossSkipped ? (
              <Chip
                size="small"
                color="info"
                sx={{ mt: 1 }}
                label={`${petLossSkipped.toLocaleString()} protected after a pet loss`}
              />
            ) : null}
          </Paper>
        </Grid>

        {report.links.length ? (
          <Grid item xs={12}>
            <TableContainer component={Paper} variant="outlined">
              <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pt: 2 }}>
                Links
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Link</TableCell>
                    <TableCell align="right">People</TableCell>
                    <TableCell align="right">Total clicks</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.links.map((l) => (
                    <TableRow key={l.index}>
                      <TableCell
                        sx={{
                          maxWidth: 640,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <a href={l.url} target="_blank" rel="noreferrer">
                          {l.url}
                        </a>
                      </TableCell>
                      <TableCell align="right">{l.uniqueClicks.toLocaleString()}</TableCell>
                      <TableCell align="right">{l.clicks.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
        ) : null}

        {conversions.tracked && conversions.rows.length ? (
          <Grid item xs={12}>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pt: 2 }}>
                Who converted
              </Typography>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Client</TableCell>
                    <TableCell>What</TableCell>
                    <TableCell>When</TableCell>
                    <TableCell>Engagement</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {conversions.rows.map((c) => (
                    <TableRow key={`${c.clientId}-${c.convertedAt}`}>
                      <TableCell>
                        <Typography variant="body2">
                          {c.name ||
                            (c.clientId ? `Client #${c.clientId}` : c.email || 'External contact')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {c.email}
                        </Typography>
                      </TableCell>
                      <TableCell>{c.detail}</TableCell>
                      <TableCell>{formatDateTime(c.convertedAt)}</TableCell>
                      <TableCell>
                        {c.clicked ? 'Clicked' : c.opened ? 'Opened' : 'No open recorded'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Grid>
        ) : null}

        <Grid item xs={12}>
          <Paper variant="outlined">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, pt: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
                Recipients
              </Typography>
              <TextField
                select
                size="small"
                label="Status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(0);
                }}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="">All</MenuItem>
                {Object.entries(RECIPIENT_STATUS_LABELS).map(([v, label]) => (
                  <MenuItem key={v} value={v}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Client</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Sent</TableCell>
                    <TableCell>Opened</TableCell>
                    <TableCell>Clicked</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(recipients?.rows ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Typography variant="body2">
                          {r.name ||
                            (r.clientId ? `Client #${r.clientId}` : r.email || 'External contact')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {r.email}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {RECIPIENT_STATUS_LABELS[r.status]}
                        {r.skipReason ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {SKIP_REASON_LABELS[r.skipReason] ?? r.skipReason}
                          </Typography>
                        ) : null}
                        {r.errorMessage ? (
                          <Typography variant="caption" color="error" display="block">
                            {r.errorMessage}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{formatDateTime(r.sentAt)}</TableCell>
                      <TableCell>
                        {r.firstOpenedAt
                          ? `${formatDateTime(r.firstOpenedAt)}${r.openCount > 1 ? ` (${r.openCount}×)` : ''}`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {r.firstClickedAt
                          ? `${formatDateTime(r.firstClickedAt)}${r.clickCount > 1 ? ` (${r.clickCount}×)` : ''}`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={recipients?.total ?? 0}
              page={page}
              onPageChange={(_e, p) => setPage(p)}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100, 200]}
            />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
      <Typography variant="body2">{label}</Typography>
      <Typography variant="body2" fontWeight={600}>
        {value.toLocaleString()}
      </Typography>
    </Box>
  );
}
