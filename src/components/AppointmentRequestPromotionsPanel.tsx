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
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import {
  buildAppointmentRequestPromoUrl,
  createAppointmentRequestPromotion,
  deleteAppointmentRequestPromotion,
  fetchAppointmentRequestPromotions,
  updateAppointmentRequestPromotion,
  type AppointmentRequestPromotion,
  type CreateAppointmentRequestPromotionRequest,
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

type CodeOption = 'none' | 'generate' | 'custom';

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
  const [rows, setRows] = useState<AppointmentRequestPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [form, setForm] = useState(DEFAULT_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAppointmentRequestPromotions();
      setRows(data.filter((r) => !r.isDeleted));
    } catch {
      setError('Could not load promotions. Make sure the API is deployed and you have admin access.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setField =
    (field: keyof typeof DEFAULT_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setSuccess(null);

    const dollars = Number(form.amountOffDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter a positive dollar amount for the discount.');
      setCreating(false);
      return;
    }

    const payload: CreateAppointmentRequestPromotionRequest = {
      companyName: form.companyName.trim(),
      name: form.name.trim(),
      amountOffCents: Math.round(dollars * 100),
      currency: form.currency.trim() || 'USD',
    };

    if (form.description.trim()) payload.description = form.description.trim();
    if (form.maxRedemptions.trim()) {
      const max = Number(form.maxRedemptions);
      if (!Number.isFinite(max) || max < 1) {
        setError('Max redemptions must be a positive number.');
        setCreating(false);
        return;
      }
      payload.maxRedemptions = max;
    }
    if (form.expiresAt.trim()) payload.expiresAt = new Date(form.expiresAt).toISOString();

    if (form.codeOption === 'generate') {
      payload.generateCode = true;
    } else if (form.codeOption === 'custom') {
      const c = form.customCode.trim().toUpperCase();
      if (c.length < 3 || c.length > 64) {
        setError('Custom code must be between 3 and 64 characters.');
        setCreating(false);
        return;
      }
      payload.code = c;
    }

    try {
      const created = await createAppointmentRequestPromotion(payload);
      const hasCode = !!created.code;
      setSuccess(
        hasCode
          ? `Promotion created. Copy the code "${created.code}" or the link from the table to share.`
          : 'Promotion created. Copy the link from the table to share with the employer.',
      );
      setForm(DEFAULT_FORM);
      setDialogOpen(false);
      await load();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to create promotion.';
      setError(typeof msg === 'string' ? msg : 'Failed to create promotion.');
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

  async function handleDelete(row: AppointmentRequestPromotion) {
    if (
      !window.confirm(
        `Delete promotion "${row.name}" for ${row.companyName}? This cannot be undone.`,
      )
    )
      return;
    setDeletingId(row.id);
    setError(null);
    try {
      await deleteAppointmentRequestPromotion(row.id);
      setSuccess('Promotion deleted.');
      await load();
    } catch {
      setError('Failed to delete promotion.');
    } finally {
      setDeletingId(null);
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

          <Box display="flex" justifyContent="flex-end">
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setForm(DEFAULT_FORM);
                setDialogOpen(true);
              }}
            >
              New promotion
            </Button>
          </Box>

          <Typography variant="body2" color="text.secondary">
            Share via link (
            <code style={{ fontSize: 13 }}>/client-portal/request-appointment?promo=…</code>) or
            give clients a short code to enter on the form. Both attach the promotion to the
            submitted request.
          </Typography>

          {loading ? (
            <Box display="flex" justifyContent="center" py={2}>
              <CircularProgress size={28} />
            </Box>
          ) : rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No promotions yet. Create one above.
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Company</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Discount</TableCell>
                    <TableCell>Redemptions</TableCell>
                    <TableCell>Expires</TableCell>
                    <TableCell>Code</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} sx={{ opacity: row.isActive ? 1 : 0.55 }}>
                      <TableCell sx={{ fontWeight: 500 }}>{row.companyName}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{formatDiscount(row)}</TableCell>
                      <TableCell>
                        {row.timesRedeemed}
                        {row.maxRedemptions != null ? ` / ${row.maxRedemptions}` : ''}
                      </TableCell>
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
                          <Tooltip title="Delete">
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => void handleDelete(row)}
                                disabled={deletingId === row.id}
                                color="error"
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
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

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create appointment request promotion</DialogTitle>
        <Box component="form" onSubmit={handleCreate}>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Company name"
                required
                value={form.companyName}
                onChange={setField('companyName')}
                placeholder="e.g. Acme Corporation"
                size="small"
                helperText="Displayed to the client on the appointment form"
              />
              <TextField
                label="Promotion name"
                required
                value={form.name}
                onChange={setField('name')}
                placeholder="e.g. Acme Employee Discount"
                size="small"
                helperText="Internal reference name"
              />
              <TextField
                label="Description (optional)"
                value={form.description}
                onChange={setField('description')}
                placeholder="e.g. Acme employees get $50 off their first visit!"
                size="small"
                multiline
                minRows={2}
                helperText="Shown to the client on the form"
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
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={
                creating ||
                !form.companyName.trim() ||
                !form.name.trim() ||
                (form.codeOption === 'custom' && form.customCode.trim().length < 3)
              }
            >
              {creating ? 'Creating…' : 'Create promotion'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Card>
  );
}
