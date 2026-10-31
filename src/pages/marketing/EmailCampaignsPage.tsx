import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { BarChart3, Copy, MoreVertical, Plus } from 'lucide-react';
import {
  archiveEmailCampaign,
  createEmailCampaign,
  deleteEmailCampaign,
  duplicateEmailCampaign,
  EmailCampaignListItem,
  errorMessage,
  GOAL_LABELS,
  listEmailCampaigns,
} from '../../api/emailCampaigns';
import { formatDateTime, percent, StatusChip } from './campaignFormat';

export const MARKETING_BASE_PATH = '/schedule/marketing';

export default function EmailCampaignsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EmailCampaignListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; row: EmailCampaignListItem } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await listEmailCampaigns(showArchived));
    } catch (err) {
      setError(errorMessage(err, 'Could not load campaigns.'));
      setRows([]);
    }
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!rows?.some((r) => r.status === 'sending' || r.status === 'scheduled')) return;
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [rows, load]);

  const create = async () => {
    setCreating(true);
    try {
      const campaign = await createEmailCampaign({ name: 'Untitled campaign' });
      navigate(`${MARKETING_BASE_PATH}/${campaign.id}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the campaign.'));
    } finally {
      setCreating(false);
    }
  };

  const runAction = async (action: () => Promise<unknown>) => {
    setMenu(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const open = (row: EmailCampaignListItem) => {
    const sent =
      row.status === 'sending' ||
      row.status === 'sent' ||
      (row.status === 'canceled' && row.sendStartedAt);
    navigate(`${MARKETING_BASE_PATH}/${row.id}${sent ? '/report' : ''}`);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1280, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h5" fontWeight={700}>
            Email campaigns
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Marketing emails to clients. Households that recently lost a pet, or have no living
            pets, are always left out.
          </Typography>
        </Box>
        <FormControlLabel
          control={
            <Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          }
          label="Show archived"
        />
        <Button
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={create}
          disabled={creating}
        >
          New campaign
        </Button>
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Campaign</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Send time</TableCell>
              <TableCell align="right">Sent</TableCell>
              <TableCell align="right">Opened</TableCell>
              <TableCell align="right">Clicked</TableCell>
              <TableCell align="right">Converted</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows === null ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                  <Typography color="text.secondary">
                    No campaigns yet. Create one to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const s = row.stats;
                const sent = s?.sent ?? 0;
                return (
                  <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => open(row)}>
                    <TableCell>
                      <Typography fontWeight={600}>{row.name}</Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        noWrap
                        sx={{ maxWidth: 360 }}
                      >
                        {row.subject || 'No subject yet'}
                      </Typography>
                      {row.goal?.type && row.goal.type !== 'none' ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Goal: ${GOAL_LABELS[row.goal.type]}`}
                          sx={{ mt: 0.5 }}
                        />
                      ) : null}
                      {row.lastError ? (
                        <Typography variant="caption" color="error" display="block">
                          {row.lastError}
                        </Typography>
                      ) : null}
                      {row.archivedAt ? (
                        <Chip size="small" label="Archived" sx={{ mt: 0.5, ml: 0.5 }} />
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={row.status} />
                    </TableCell>
                    <TableCell>{formatDateTime(row.sendStartedAt ?? row.scheduledAt)}</TableCell>
                    <TableCell align="right">
                      {s ? (
                        <Tooltip
                          title={`${s.skipped} skipped, ${s.failed} failed${s.pending ? `, ${s.pending} still to send` : ''}`}
                        >
                          <span>{sent.toLocaleString()}</span>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell align="right">{s && sent ? percent(s.opened, sent) : '—'}</TableCell>
                    <TableCell align="right">
                      {s && sent ? percent(s.clicked, sent) : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {row.conversions != null && sent
                        ? `${row.conversions} (${percent(row.conversions, sent)})`
                        : '—'}
                    </TableCell>
                    <TableCell
                      align="right"
                      onClick={(e) => e.stopPropagation()}
                      sx={{ whiteSpace: 'nowrap' }}
                    >
                      {row.sendStartedAt ? (
                        <Tooltip title="Report">
                          <IconButton
                            size="small"
                            onClick={() => navigate(`${MARKETING_BASE_PATH}/${row.id}/report`)}
                          >
                            <BarChart3 size={18} />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      <Tooltip title="Duplicate">
                        <IconButton
                          size="small"
                          onClick={() =>
                            void runAction(async () => {
                              const copy = await duplicateEmailCampaign(row.id);
                              navigate(`${MARKETING_BASE_PATH}/${copy.id}`);
                            })
                          }
                        >
                          <Copy size={18} />
                        </IconButton>
                      </Tooltip>
                      <IconButton
                        size="small"
                        onClick={(e) => setMenu({ anchor: e.currentTarget, row })}
                      >
                        <MoreVertical size={18} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => menu && navigate(`${MARKETING_BASE_PATH}/${menu.row.id}`)}>
          Open
        </MenuItem>
        {menu && !['scheduled', 'sending'].includes(menu.row.status) ? (
          <MenuItem
            onClick={() =>
              menu && void runAction(() => archiveEmailCampaign(menu.row.id, !menu.row.archivedAt))
            }
          >
            {menu.row.archivedAt ? 'Unarchive' : 'Archive'}
          </MenuItem>
        ) : null}
        {menu && menu.row.status === 'draft' && !menu.row.sendStartedAt ? (
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={() => {
              if (!menu) return;
              if (!window.confirm(`Delete "${menu.row.name}"? This cannot be undone.`)) return;
              void runAction(() => deleteEmailCampaign(menu.row.id));
            }}
          >
            Delete
          </MenuItem>
        ) : null}
      </Menu>
    </Box>
  );
}
