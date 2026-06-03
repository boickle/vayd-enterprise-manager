import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  fetchAppointmentFormDraft,
  fetchAppointmentFormDraftsPage,
  patchAppointmentFormDraft,
  type AppointmentFormDraftDetail,
  type AppointmentFormDraftFollowUpStatus,
  type AppointmentFormDraftListItem,
} from '../api/appointmentFormDrafts';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  '7D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(6, 'day'), to: now };
  },
  '30D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(29, 'day'), to: now };
  },
};

const FOLLOW_UP_OPTIONS: { value: AppointmentFormDraftFollowUpStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'dismissed', label: 'Dismissed' },
];

function statusChipColor(status: string): 'default' | 'warning' | 'success' | 'info' {
  switch (status) {
    case 'abandoned':
      return 'warning';
    case 'converted':
      return 'success';
    case 'in_progress':
      return 'info';
    default:
      return 'default';
  }
}

function formatDt(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dayjs(iso).format('MMM D, YYYY h:mm A');
}

export default function AppointmentFormDraftsPage() {
  const [preset, setPreset] = useState('7D');
  const [statusFilter, setStatusFilter] = useState('abandoned,in_progress');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<AppointmentFormDraftListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<AppointmentFormDraftDetail | null>(null);
  const [followUpStatus, setFollowUpStatus] = useState<AppointmentFormDraftFollowUpStatus>('pending');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const range = useMemo(() => PRESETS[preset]?.() ?? PRESETS['7D'](), [preset]);
  const from = range.from.format('YYYY-MM-DD');
  const to = range.to.format('YYYY-MM-DD');

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAppointmentFormDraftsPage({
        practiceId: PRACTICE_ID,
        from,
        to,
        status: statusFilter,
        page,
        limit: 50,
      });
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err?.response?.data?.message || err?.message || 'Failed to load drafts');
    } finally {
      setLoading(false);
    }
  }, [from, to, statusFilter, page]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openDetail = async (id: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await fetchAppointmentFormDraft(id, PRACTICE_ID);
      setDetail(d);
      setFollowUpStatus(d.followUpStatus);
      setFollowUpNotes(d.followUpNotes ?? '');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err?.response?.data?.message || err?.message || 'Failed to load draft');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const saveFollowUp = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const updated = await patchAppointmentFormDraft(detail.id, PRACTICE_ID, {
        followUpStatus,
        followUpNotes: followUpNotes.trim() || undefined,
      });
      setDetail(updated);
      setItems((prev) =>
        prev.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                followUpStatus: updated.followUpStatus,
              }
            : row
        )
      );
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err?.response?.data?.message || err?.message || 'Failed to save follow-up');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <Box sx={{ p: 2, maxWidth: 1400 }}>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
        Appointment form drafts
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Incomplete appointment requests and abandon follow-ups (practice {PRACTICE_ID}).
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Range</InputLabel>
          <Select label="Range" value={preset} onChange={(e) => { setPreset(e.target.value); setPage(1); }}>
            <MenuItem value="7D">Last 7 days</MenuItem>
            <MenuItem value="30D">Last 30 days</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <MenuItem value="abandoned,in_progress">Abandoned + in progress</MenuItem>
            <MenuItem value="abandoned">Abandoned only</MenuItem>
            <MenuItem value="in_progress">In progress</MenuItem>
            <MenuItem value="converted">Converted</MenuItem>
            <MenuItem value="dismissed">Dismissed</MenuItem>
          </Select>
        </FormControl>
        <Button variant="outlined" size="small" onClick={() => void loadList()}>
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Updated</TableCell>
                  <TableCell>Client</TableCell>
                  <TableCell>Contact</TableCell>
                  <TableCell>Step</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Notify</TableCell>
                  <TableCell>Follow-up</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                      No drafts in this range.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell>{formatDt(row.abandonedAt ?? row.updatedAt)}</TableCell>
                      <TableCell>
                        {row.clientDisplayName || '—'}
                        <Typography variant="caption" display="block" color="text.secondary">
                          {row.clientType}
                          {row.isLoggedIn ? ' · logged in' : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {row.contactEmail && (
                          <Typography variant="body2">{row.contactEmail}</Typography>
                        )}
                        {row.contactPhone && (
                          <Typography variant="caption" display="block">
                            {row.contactPhone}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.currentStepName || row.currentStep}
                        {row.petSummary && (
                          <Typography variant="caption" display="block" color="text.secondary">
                            {row.petSummary}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={row.status} color={statusChipColor(row.status)} />
                      </TableCell>
                      <TableCell>
                        {row.notificationSentAt ? (
                          <Chip size="small" label="Sent" color="success" variant="outlined" />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>{row.followUpStatus}</TableCell>
                      <TableCell>
                        <Button size="small" onClick={() => void openDetail(row.id)}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {total} total · page {page} of {totalPages}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </Box>
          </Box>
        </>
      )}

      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Draft detail</DialogTitle>
        <DialogContent dividers>
          {detailLoading || !detail ? (
            <CircularProgress size={28} />
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="body2">
                <strong>ID:</strong> {detail.id} · <strong>Session:</strong> {detail.formSessionId}
              </Typography>
              <Typography variant="body2">
                <strong>Step:</strong> {detail.currentStepName || detail.currentStep}
                {detail.abandonReason ? ` · abandon: ${detail.abandonReason}` : ''}
              </Typography>
              <Typography variant="body2">
                <strong>Service area:</strong> {detail.serviceArea || '—'}
              </Typography>
              <Typography variant="body2">
                <strong>Reception notified:</strong>{' '}
                {detail.notificationSentAt ? formatDt(detail.notificationSentAt) : 'No'}
                {detail.receptionistEmail ? ` (${detail.receptionistEmail})` : ''}
              </Typography>
              <FormControl size="small" fullWidth>
                <InputLabel>Follow-up status</InputLabel>
                <Select
                  label="Follow-up status"
                  value={followUpStatus}
                  onChange={(e) =>
                    setFollowUpStatus(e.target.value as AppointmentFormDraftFollowUpStatus)
                  }
                >
                  {FOLLOW_UP_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Follow-up notes"
                multiline
                minRows={3}
                fullWidth
                value={followUpNotes}
                onChange={(e) => setFollowUpNotes(e.target.value)}
              />
              <Box
                component="pre"
                sx={{
                  p: 1.5,
                  bgcolor: 'grey.100',
                  borderRadius: 1,
                  fontSize: 12,
                  overflow: 'auto',
                  maxHeight: 280,
                }}
              >
                {JSON.stringify(detail.draftData, null, 2)}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Close</Button>
          <Button variant="contained" disabled={saving || !detail} onClick={() => void saveFollowUp()}>
            {saving ? 'Saving…' : 'Save follow-up'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
