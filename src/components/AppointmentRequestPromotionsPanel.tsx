import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import EditIcon from '@mui/icons-material/Edit';
import {
  buildAppointmentRequestPromoUrl,
  createAppointmentRequestPromotion,
  fetchAppointmentRequestPromotions,
  updateAppointmentRequestPromotion,
  type AppointmentRequestPromotion,
  type CreateAppointmentRequestPromotionRequest,
  type UpdateAppointmentRequestPromotionRequest,
} from '../api/appointmentRequestPromotions';

function formatDiscount(row: AppointmentRequestPromotion): string {
  if (row.discountType === 'fixed_amount' && row.amountOffCents != null) {
    return `$${(row.amountOffCents / 100).toFixed(2)} off`;
  }
  if (row.discountType === 'percentage' && row.percentOff != null) {
    return `${row.percentOff}% off`;
  }
  return '—';
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

/** `YYYY-MM-DD` for `<input type="date">` from an ISO timestamp. */
function toDateInputValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** Noon UTC on the given calendar day — avoids timezone day-shift; undefined when blank. */
function optionalExpiresIso(dateOnly: string): string | undefined {
  const t = dateOnly.trim();
  if (!t) return undefined;
  const d = new Date(`${t}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

type CodeOption = 'none' | 'generate' | 'custom';
type ListView = 'active' | 'archived';

const DEFAULT_FORM = {
  companyName: '',
  name: '',
  description: '',
  amountOffDollars: '',
  currency: 'USD',
  maxRedemptions: '',
  expiresAt: '',
  codeOption: 'generate' as CodeOption,
  customCode: '',
};

export default function AppointmentRequestPromotionsPanel() {
  const [listView, setListView] = useState<ListView>('active');
  const [rows, setRows] = useState<AppointmentRequestPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  /** When set, the dialog edits this promotion; otherwise it creates. */
  const [editingRow, setEditingRow] = useState<AppointmentRequestPromotion | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<AppointmentRequestPromotion | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);

  const [form, setForm] = useState(DEFAULT_FORM);
  /** Errors from create/edit stay inside the dialog; page-level alerts are for load/toggle/etc. */
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAppointmentRequestPromotions({
        isDeleted: listView === 'archived',
      });
      setRows(data);
    } catch {
      setError('Could not load promotions. Make sure the API is deployed and you have admin access.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [listView]);

  useEffect(() => {
    void load();
  }, [load]);

  const setField =
    (field: keyof typeof DEFAULT_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  function openCreateDialog() {
    setEditingRow(null);
    setForm(DEFAULT_FORM);
    setError(null);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEditDialog(row: AppointmentRequestPromotion) {
    setEditingRow(row);
    setForm({
      companyName: row.companyName ?? '',
      name: row.name ?? '',
      description: row.description ?? '',
      amountOffDollars:
        row.amountOffCents != null ? (row.amountOffCents / 100).toFixed(2) : '',
      currency: row.currency || 'USD',
      maxRedemptions: row.maxRedemptions != null ? String(row.maxRedemptions) : '',
      expiresAt: toDateInputValue(row.expiresAt),
      codeOption: row.code ? 'custom' : 'none',
      customCode: row.code ?? '',
    });
    setError(null);
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (creating) return;
    setDialogOpen(false);
    setEditingRow(null);
    setForm(DEFAULT_FORM);
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    setSuccess(null);

    const dollars = Number(form.amountOffDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setFormError('Enter a positive dollar amount for the discount.');
      setCreating(false);
      return;
    }

    let maxRedemptions: number | null | undefined;
    if (form.maxRedemptions.trim()) {
      const max = Number(form.maxRedemptions);
      if (!Number.isFinite(max) || max < 1) {
        setFormError('Max redemptions must be a positive number.');
        setCreating(false);
        return;
      }
      maxRedemptions = max;
    } else if (editingRow) {
      maxRedemptions = null;
    }

    const expiresIso = optionalExpiresIso(form.expiresAt);
    if (form.expiresAt.trim() && !expiresIso) {
      setFormError('Enter a valid expiration date, or leave it blank for no expiry.');
      setCreating(false);
      return;
    }

    try {
      if (editingRow) {
        const payload: UpdateAppointmentRequestPromotionRequest = {
          companyName: form.companyName.trim(),
          name: form.name.trim(),
          description: form.description.trim() || null,
          amountOffCents: Math.round(dollars * 100),
          currency: form.currency.trim() || 'USD',
          maxRedemptions,
          expiresAt: expiresIso ?? null,
        };
        if (form.codeOption === 'generate') {
          payload.generateCode = true;
        } else if (form.codeOption === 'custom') {
          const c = form.customCode.trim().toUpperCase();
          if (c.length < 3 || c.length > 64) {
            setFormError('Custom code must be between 3 and 64 characters.');
            setCreating(false);
            return;
          }
          payload.code = c;
        } else if (editingRow.code) {
          // Clear existing code → link-only. Skip when already link-only.
          payload.code = '';
        }
        await updateAppointmentRequestPromotion(editingRow.id, payload);
        setSuccess(`Promotion "${form.name.trim()}" updated.`);
      } else {
        const payload: CreateAppointmentRequestPromotionRequest = {
          companyName: form.companyName.trim(),
          name: form.name.trim(),
          amountOffCents: Math.round(dollars * 100),
          currency: form.currency.trim() || 'USD',
        };
        if (form.description.trim()) payload.description = form.description.trim();
        if (maxRedemptions != null) payload.maxRedemptions = maxRedemptions;
        if (expiresIso) payload.expiresAt = expiresIso;

        if (form.codeOption === 'generate') {
          payload.generateCode = true;
        } else if (form.codeOption === 'custom') {
          const c = form.customCode.trim().toUpperCase();
          if (c.length < 3 || c.length > 64) {
            setFormError('Custom code must be between 3 and 64 characters.');
            setCreating(false);
            return;
          }
          payload.code = c;
        }

        const created = await createAppointmentRequestPromotion(payload);
        const hasCode = !!created.code;
        setSuccess(
          hasCode
            ? `Promotion created. Copy the code "${created.code}" or the link from the table to share.`
            : 'Promotion created. Copy the link from the table to share with the employer.',
        );
      }
      setForm(DEFAULT_FORM);
      setEditingRow(null);
      setFormError(null);
      setDialogOpen(false);
      await load();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ??
        (editingRow ? 'Failed to update promotion.' : 'Failed to create promotion.');
      setFormError(
        Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : 'Request failed.',
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyLink(row: AppointmentRequestPromotion) {
    const url = buildAppointmentRequestPromoUrl(row.token);
    await navigator.clipboard.writeText(url);
    setCopiedLinkId(row.id);
    setSuccess(`Link for ${row.companyName} copied to clipboard.`);
    setTimeout(() => setCopiedLinkId(null), 3000);
  }

  async function handleCopyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setSuccess(`Code ${code} copied to clipboard.`);
    setTimeout(() => setCopiedCode(null), 3000);
  }

  async function handleToggleActive(row: AppointmentRequestPromotion) {
    setTogglingId(row.id);
    setError(null);
    try {
      await updateAppointmentRequestPromotion(row.id, { isActive: !row.isActive });
      setSuccess(`Promotion ${row.isActive ? 'deactivated' : 'reactivated'}.`);
      await load();
    } catch {
      setError('Failed to update promotion status.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleArchive(row: AppointmentRequestPromotion) {
    setArchivingId(row.id);
    setError(null);
    try {
      await updateAppointmentRequestPromotion(row.id, { isDeleted: true, isActive: false });
      setSuccess(`"${row.companyName}" archived.`);
      setArchiveConfirm(null);
      await load();
    } catch {
      setError('Failed to archive promotion.');
    } finally {
      setArchivingId(null);
    }
  }

  async function handleRestore(row: AppointmentRequestPromotion) {
    setArchivingId(row.id);
    setError(null);
    try {
      await updateAppointmentRequestPromotion(row.id, { isDeleted: false });
      setSuccess(`"${row.companyName}" restored to the active list.`);
      await load();
    } catch {
      setError('Failed to restore promotion.');
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ pt: 2 }}>
        <Stack spacing={3}>
          {error && (
            <Alert severity="warning" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}

          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <Tabs
              value={listView}
              onChange={(_, value: ListView) => setListView(value)}
              aria-label="Promotion list"
            >
              <Tab value="active" label="Active" />
              <Tab value="archived" label="Archived" />
            </Tabs>
            {listView === 'active' ? (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={openCreateDialog}
              >
                New promotion
              </Button>
            ) : null}
          </Box>

          {listView === 'archived' ? (
            <Typography variant="body2" color="text.secondary">
              Archived promotions are hidden from the active list and cannot be used for new requests.
              Restore a promotion here to make it available again.
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Share via link (
              <code style={{ fontSize: 13 }}>/client-portal/request-appointment?promo=…</code>) or
              give clients a short code to enter on the form. Both attach the promotion to the
              submitted request.
            </Typography>
          )}

          {loading ? (
            <Box display="flex" justifyContent="center" py={2}>
              <CircularProgress size={28} />
            </Box>
          ) : rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {listView === 'active'
                ? 'No active promotions yet. Create one above.'
                : 'No archived promotions.'}
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Internal name</TableCell>
                    <TableCell>Public Name</TableCell>
                    <TableCell>Discount</TableCell>
                    <TableCell>Redemptions</TableCell>
                    <TableCell>Started</TableCell>
                    <TableCell>Expires</TableCell>
                    <TableCell>Code</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      sx={{ opacity: listView === 'archived' || row.isActive ? 1 : 0.55 }}
                    >
                      <TableCell sx={{ fontWeight: 500 }}>{row.companyName}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{formatDiscount(row)}</TableCell>
                      <TableCell>
                        {row.timesRedeemed}
                        {row.maxRedemptions != null ? ` / ${row.maxRedemptions}` : ''}
                      </TableCell>
                      <TableCell>{formatDate(row.created)}</TableCell>
                      <TableCell>{formatDate(row.expiresAt)}</TableCell>
                      <TableCell>
                        {row.code ? (
                          <Tooltip title={copiedCode === row.code ? 'Copied!' : 'Copy code'}>
                            <Button
                              size="small"
                              startIcon={<ContentCopyIcon fontSize="small" />}
                              onClick={() => void handleCopyCode(row.code!)}
                              sx={{
                                fontFamily: 'monospace',
                                fontWeight: 700,
                                letterSpacing: 1,
                                minWidth: 0,
                                px: 1,
                              }}
                            >
                              {row.code}
                            </Button>
                          </Tooltip>
                        ) : (
                          <Typography variant="body2" color="text.disabled" sx={{ fontSize: 12 }}>
                            Link only
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={row.isActive ? 'Active' : 'Inactive'}
                          color={row.isActive ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                          {listView === 'active' ? (
                            <>
                              <Tooltip title="Edit">
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() => openEditDialog(row)}
                                    color="primary"
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title={copiedLinkId === row.id ? 'Copied!' : 'Copy employer link'}>
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() => void handleCopyLink(row)}
                                    disabled={!row.isActive}
                                    color={copiedLinkId === row.id ? 'success' : 'default'}
                                  >
                                    <LinkIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title={row.isActive ? 'Deactivate' : 'Reactivate'}>
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() => void handleToggleActive(row)}
                                    disabled={togglingId === row.id}
                                    color={row.isActive ? 'warning' : 'success'}
                                  >
                                    {row.isActive ? (
                                      <PauseCircleIcon fontSize="small" />
                                    ) : (
                                      <PlayCircleIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title="Archive">
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() => setArchiveConfirm(row)}
                                    disabled={archivingId === row.id}
                                    color="default"
                                  >
                                    <ArchiveIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </>
                          ) : (
                            <Tooltip title="Restore to active list">
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => void handleRestore(row)}
                                  disabled={archivingId === row.id}
                                  color="success"
                                >
                                  <UnarchiveIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}

          <Button variant="text" size="small" onClick={() => void load()} disabled={loading}>
            Refresh list
          </Button>
        </Stack>
      </CardContent>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingRow ? 'Edit appointment request promotion' : 'Create appointment request promotion'}
        </DialogTitle>
        <Box component="form" onSubmit={handleSubmit} noValidate>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {formError ? (
                <Alert severity="warning" onClose={() => setFormError(null)}>
                  {formError}
                </Alert>
              ) : null}
              <TextField
                label="Internal name"
                required
                value={form.companyName}
                onChange={setField('companyName')}
                placeholder="e.g. Moody's — $50 off"
                size="small"
                helperText="For your team — not shown to clients"
              />
              <TextField
                label="Public Name"
                required
                value={form.name}
                onChange={setField('name')}
                placeholder="e.g. $50 Off Your VAYD Visit!"
                size="small"
                helperText="Title shown to the client when they open the promo link"
              />
              <TextField
                label="Description (optional)"
                value={form.description}
                onChange={setField('description')}
                placeholder="e.g. Acme employees get $50 off their first or next visit!"
                size="small"
                multiline
                minRows={2}
                helperText="Optional extra copy for staff — not used as the banner title"
              />
              <TextField
                label="Discount amount (USD)"
                required
                type="number"
                inputProps={{ min: 0.01, step: 0.01 }}
                value={form.amountOffDollars}
                onChange={setField('amountOffDollars')}
                size="small"
                helperText="Fixed dollar amount off — e.g. 50 for $50 off"
              />
              <TextField
                label="Max redemptions (optional)"
                type="number"
                inputProps={{ min: 1 }}
                value={form.maxRedemptions}
                onChange={setField('maxRedemptions')}
                size="small"
              />
              <TextField
                label="Expires (optional)"
                type="date"
                value={form.expiresAt}
                onChange={setField('expiresAt')}
                size="small"
                InputLabelProps={{ shrink: true }}
                helperText="Leave blank for no expiration date."
              />

              {/* Code options */}
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  Promo code
                </Typography>
                <RadioGroup
                  value={form.codeOption}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      codeOption: e.target.value as CodeOption,
                      customCode: '',
                    }))
                  }
                >
                  <FormControlLabel
                    value="generate"
                    control={<Radio size="small" />}
                    label={
                      <Typography variant="body2">
                        Auto-generate a code{' '}
                        <span style={{ color: '#6b7280', fontSize: 12 }}>(e.g. VAYDH7K2MQ)</span>
                      </Typography>
                    }
                  />
                  <FormControlLabel
                    value="custom"
                    control={<Radio size="small" />}
                    label={<Typography variant="body2">Use a custom code</Typography>}
                  />
                  <FormControlLabel
                    value="none"
                    control={<Radio size="small" />}
                    label={<Typography variant="body2">Link only — no code</Typography>}
                  />
                </RadioGroup>
                {form.codeOption === 'custom' && (
                  <TextField
                    label="Custom code"
                    value={form.customCode}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        customCode: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
                      }))
                    }
                    placeholder="e.g. ACME2026"
                    size="small"
                    sx={{ mt: 1 }}
                    inputProps={{ style: { fontFamily: 'monospace', fontWeight: 700 } }}
                    helperText="Letters, digits, and dashes. 3–64 characters."
                    fullWidth
                  />
                )}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={closeDialog} disabled={creating}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={
                creating ||
                !form.companyName.trim() ||
                !form.name.trim() ||
                !form.amountOffDollars.trim() ||
                (form.codeOption === 'custom' && form.customCode.trim().length < 3)
              }
            >
              {creating
                ? editingRow
                  ? 'Saving…'
                  : 'Creating…'
                : editingRow
                  ? 'Save changes'
                  : 'Create promotion'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={!!archiveConfirm} onClose={() => setArchiveConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Archive promotion?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Archive <strong>{archiveConfirm?.companyName}</strong>? It will be hidden from the active
            list and deactivated. You can restore it from the Archived tab.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setArchiveConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={!archiveConfirm || archivingId === archiveConfirm.id}
            onClick={() => archiveConfirm && void handleArchive(archiveConfirm)}
          >
            Archive
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
