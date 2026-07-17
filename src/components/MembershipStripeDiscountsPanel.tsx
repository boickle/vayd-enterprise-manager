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
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
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
  createMembershipDiscount,
  createMembershipDiscountLink,
  fetchMembershipDiscounts,
  updateMembershipDiscount,
  type CreateMembershipDiscountRequest,
  type MembershipDiscountDuration,
  type MembershipDiscountRecord,
  type UpdateMembershipDiscountRequest,
} from '../api/payments';
import { buildMembershipSignupPromoUrl } from '../utils/membershipStripeDiscount';

function formatDiscountSummary(row: MembershipDiscountRecord): string {
  if (row.duration === 'once') {
    if (row.percentOff != null && row.percentOff > 0) {
      return row.percentOff >= 100 ? 'First month free' : `${row.percentOff}% off first month`;
    }
    if (row.amountOffCents != null && row.amountOffCents > 0) {
      return `$${(row.amountOffCents / 100).toFixed(2)} off first month`;
    }
    return row.displayLabel || 'First month off';
  }
  if (row.percentOff != null && row.percentOff > 0) return `${row.percentOff}% off`;
  if (row.amountOffCents != null && row.amountOffCents > 0) {
    return `$${(row.amountOffCents / 100).toFixed(2)} off`;
  }
  return row.displayLabel || 'Discount';
}

function formatDiscountDuration(duration: MembershipDiscountDuration): string {
  if (duration === 'once') return 'First month off';
  if (duration === 'repeating') return 'Repeating';
  return 'Every invoice';
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function toDateInputValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function optionalExpiresIso(dateOnly: string): string | undefined {
  const t = dateOnly.trim();
  if (!t) return undefined;
  const d = new Date(`${t}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

type AdminDiscountType = 'percent' | 'fixed' | 'first_month_off';
type CodeOption = 'generate' | 'custom' | 'none';
type ListView = 'active' | 'archived';

function discountTypeFromRow(row: MembershipDiscountRecord): AdminDiscountType {
  if (row.duration === 'once') return 'first_month_off';
  if (row.percentOff != null) return 'percent';
  return 'fixed';
}

const DEFAULT_FORM = {
  name: '',
  displayLabel: '',
  discountType: 'percent' as AdminDiscountType,
  percentOff: '10',
  amountOffDollars: '25',
  duration: 'forever' as MembershipDiscountDuration,
  firstMonthOffKind: 'percent' as 'percent' | 'fixed',
  durationInMonths: '3',
  maxRedemptions: '',
  expiresAt: '',
  codeOption: 'generate' as CodeOption,
  customCode: '',
};

export default function MembershipStripeDiscountsPanel() {
  const [listView, setListView] = useState<ListView>('active');
  const [rows, setRows] = useState<MembershipDiscountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<MembershipDiscountRecord | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<MembershipDiscountRecord | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const [form, setForm] = useState(DEFAULT_FORM);

  /** Amount/duration edits replace the coupon; only code-based promotions can keep their identifier
   * (a link token always regenerates), so link-only rows are limited to metadata edits. */
  const canEditEconomics = !editingRow || Boolean(editingRow.code);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMembershipDiscounts({
        archived: listView === 'archived',
      });
      setRows(data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setError(
          'Membership discount API is not available yet. Deploy the backend endpoints under /stripe/payment-processing/membership-discounts (see backend notes in the team doc or PR description).',
        );
      } else {
        setError('Could not load membership discounts. Check that you are on Stripe and have admin access.');
      }
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
    setDialogOpen(true);
  }

  function openEditDialog(row: MembershipDiscountRecord) {
    const discountType = discountTypeFromRow(row);
    setEditingRow(row);
    setForm({
      ...DEFAULT_FORM,
      name: row.name ?? '',
      displayLabel: row.displayLabel ?? '',
      discountType,
      percentOff: row.percentOff != null ? String(row.percentOff) : '10',
      amountOffDollars:
        row.amountOffCents != null ? (row.amountOffCents / 100).toFixed(2) : '25',
      duration: row.duration === 'once' ? 'forever' : row.duration,
      firstMonthOffKind: row.percentOff != null ? 'percent' : 'fixed',
      durationInMonths: row.durationInMonths != null ? String(row.durationInMonths) : '3',
      maxRedemptions: row.maxRedemptions != null ? String(row.maxRedemptions) : '',
      expiresAt: toDateInputValue(row.expiresAt),
      codeOption: row.code ? 'custom' : 'none',
      customCode: row.code ?? '',
    });
    setError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    if (creating) return;
    setDialogOpen(false);
    setEditingRow(null);
    setForm(DEFAULT_FORM);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setSuccess(null);

    const expiresIso = optionalExpiresIso(form.expiresAt);
    if (form.expiresAt.trim() && !expiresIso) {
      setError('Enter a valid expiration date, or leave it blank for no expiry.');
      setCreating(false);
      return;
    }

    let maxRedemptions: number | null | undefined;
    if (form.maxRedemptions.trim()) {
      const max = Number(form.maxRedemptions);
      if (!Number.isFinite(max) || max < 1) {
        setError('Max redemptions must be a positive number.');
        setCreating(false);
        return;
      }
      maxRedemptions = max;
    } else if (editingRow) {
      maxRedemptions = null;
    }

    const effectiveDuration: MembershipDiscountDuration =
      form.discountType === 'first_month_off' ? 'once' : form.duration;
    const payload: CreateMembershipDiscountRequest = {
      name: form.name.trim(),
      displayLabel: form.displayLabel.trim() || undefined,
      duration: effectiveDuration,
      createLink: true,
    };
    const usePercent =
      form.discountType === 'percent' ||
      (form.discountType === 'first_month_off' && form.firstMonthOffKind === 'percent');

    if (usePercent) {
      const pct = Number(form.percentOff);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        setError('Enter a percent between 1 and 100.');
        setCreating(false);
        return;
      }
      payload.percentOff = pct;
    } else {
      const dollars = Number(form.amountOffDollars);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setError('Enter a positive dollar amount.');
        setCreating(false);
        return;
      }
      payload.amountOffCents = Math.round(dollars * 100);
    }

    if (form.discountType === 'first_month_off' && !form.displayLabel.trim()) {
      payload.displayLabel =
        payload.percentOff != null
          ? payload.percentOff >= 100
            ? 'First month free'
            : `${payload.percentOff}% off your first month`
          : `$${((payload.amountOffCents ?? 0) / 100).toFixed(2)} off your first month`;
    }
    if (effectiveDuration === 'repeating') {
      const months = Number(form.durationInMonths);
      if (!Number.isFinite(months) || months < 1) {
        setError('Repeating discounts need duration in months (1 or more).');
        setCreating(false);
        return;
      }
      payload.durationInMonths = months;
    }
    if (maxRedemptions != null) payload.maxRedemptions = maxRedemptions;
    if (expiresIso) payload.expiresAt = expiresIso;

    let replacementStarted = false;
    let replacementCreated = false;
    try {
      if (editingRow) {
        // Link-only promotions can't keep their shared identifier through a replacement, so their
        // economics are locked and only metadata is updated.
        const economicsChanged =
          canEditEconomics &&
          (editingRow.duration !== payload.duration ||
            (editingRow.percentOff ?? null) !== (payload.percentOff ?? null) ||
            (editingRow.amountOffCents ?? null) !== (payload.amountOffCents ?? null) ||
            (editingRow.durationInMonths ?? null) !== (payload.durationInMonths ?? null));

        if (!economicsChanged) {
          const update: UpdateMembershipDiscountRequest = {
            name: payload.name,
            displayLabel: payload.displayLabel ?? '',
            expiresAt: expiresIso ?? null,
            maxRedemptions,
          };
          await updateMembershipDiscount(editingRow.id, update);
          setSuccess(`Promotion "${form.name.trim()}" updated.`);
        } else {
          // Stripe coupon economics are immutable. Retire the old promotion and create its
          // replacement; clearing the old code first lets the replacement retain that code.
          replacementStarted = true;
          await updateMembershipDiscount(editingRow.id, {
            active: false,
            ...(editingRow.code ? { code: '' } : {}),
          });
          if (editingRow.code) payload.code = editingRow.code;
          const created = await createMembershipDiscount(payload);
          replacementCreated = true;
          await updateMembershipDiscount(editingRow.id, { archived: true, active: false });
          setSuccess(
            created.code
              ? `Promotion replaced with the corrected offer. Code ${created.code} was kept; copy the new signup link.`
              : 'Promotion replaced with the corrected offer. Copy the new signup link.',
          );
        }
      } else {
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

        const created = await createMembershipDiscount(payload);
        setSuccess(
          created.code
            ? `Discount created. Copy the code "${created.code}" or the link from the table to share.`
            : created.linkToken
              ? 'Discount created. Copy the link from the table to share with clients.'
              : 'Discount created.',
        );
      }
      setForm(DEFAULT_FORM);
      setEditingRow(null);
      setDialogOpen(false);
      await load();
    } catch (err: unknown) {
      if (editingRow && replacementStarted && !replacementCreated) {
        try {
          await updateMembershipDiscount(editingRow.id, {
            active: editingRow.active,
            ...(editingRow.code ? { code: editingRow.code } : {}),
          });
        } catch {
          // Preserve the original API error below; reload exposes any partial state.
        }
      }
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ??
        (editingRow ? 'Failed to update promotion.' : 'Failed to create discount.');
      setError(Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : 'Request failed.');
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateLink(discountId: string) {
    setLinkingId(discountId);
    setError(null);
    setSuccess(null);
    try {
      const { token } = await createMembershipDiscountLink({ discountId });
      const url = buildMembershipSignupPromoUrl(token);
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setSuccess('Signup link copied to clipboard (discount applied automatically).');
      await load();
    } catch {
      setError('Failed to create or copy link.');
    } finally {
      setLinkingId(null);
    }
  }

  async function copyLinkForToken(token: string) {
    const url = buildMembershipSignupPromoUrl(token);
    await navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setSuccess('Link copied to clipboard.');
    setTimeout(() => setCopiedToken(null), 3000);
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setSuccess(`Code ${code} copied to clipboard.`);
    setTimeout(() => setCopiedCode(null), 3000);
  }

  async function handleToggleActive(row: MembershipDiscountRecord) {
    setTogglingId(row.id);
    setError(null);
    try {
      await updateMembershipDiscount(row.id, { active: !row.active });
      setSuccess(`Promotion ${row.active ? 'deactivated' : 'reactivated'}.`);
      await load();
    } catch {
      setError('Failed to update promotion status.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleArchive(row: MembershipDiscountRecord) {
    setArchivingId(row.id);
    setError(null);
    try {
      await updateMembershipDiscount(row.id, { archived: true, active: false });
      setSuccess(`"${row.name}" archived.`);
      setArchiveConfirm(null);
      await load();
    } catch {
      setError('Failed to archive promotion.');
    } finally {
      setArchivingId(null);
    }
  }

  async function handleRestore(row: MembershipDiscountRecord) {
    setArchivingId(row.id);
    setError(null);
    try {
      await updateMembershipDiscount(row.id, { archived: false });
      setSuccess(`"${row.name}" restored to the active list.`);
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
              aria-label="Membership promotion list"
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
              Archived promotions are hidden from the active list and cannot be used for new signups.
              Restore a promotion here to make it available again.
            </Typography>
          ) : null}

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
                    <TableCell>Duration</TableCell>
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
                      sx={{ opacity: listView === 'archived' || row.active ? 1 : 0.55 }}
                    >
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.displayLabel || formatDiscountSummary(row)}</TableCell>
                      <TableCell>{formatDiscountDuration(row.duration)}</TableCell>
                      <TableCell>
                        {row.timesRedeemed ?? 0}
                        {row.maxRedemptions != null ? ` / ${row.maxRedemptions}` : ''}
                      </TableCell>
                      <TableCell>{formatDate(row.createdAt)}</TableCell>
                      <TableCell>{formatDate(row.expiresAt)}</TableCell>
                      <TableCell>
                        {row.code ? (
                          <Tooltip title={copiedCode === row.code ? 'Copied!' : 'Copy code'}>
                            <Button
                              size="small"
                              startIcon={<ContentCopyIcon fontSize="small" />}
                              onClick={() => void copyCode(row.code!)}
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
                          label={row.active ? 'Active' : 'Inactive'}
                          color={row.active ? 'success' : 'default'}
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
                              {row.linkToken ? (
                                <Tooltip title={copiedToken === row.linkToken ? 'Copied!' : 'Copy signup link'}>
                                  <span>
                                    <IconButton
                                      size="small"
                                      onClick={() => void copyLinkForToken(row.linkToken!)}
                                      disabled={!row.active}
                                      color={copiedToken === row.linkToken ? 'success' : 'default'}
                                    >
                                      <LinkIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              ) : (
                                <Tooltip title="Create signup link">
                                  <span>
                                    <IconButton
                                      size="small"
                                      onClick={() => void handleCreateLink(row.id)}
                                      disabled={!row.active || linkingId === row.id}
                                      color="default"
                                    >
                                      <LinkIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )}
                              <Tooltip title={row.active ? 'Deactivate' : 'Reactivate'}>
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() => void handleToggleActive(row)}
                                    disabled={togglingId === row.id}
                                    color={row.active ? 'warning' : 'success'}
                                  >
                                    {row.active ? (
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

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingRow ? 'Edit membership promotion' : 'Create membership promotion'}
        </DialogTitle>
        <Box component="form" onSubmit={handleSubmit} noValidate>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Internal name"
                required
                value={form.name}
                onChange={setField('name')}
                placeholder="e.g. LL Bean — first month free"
                size="small"
                helperText="For your team — not shown to clients"
              />
              <TextField
                label="Public Name"
                value={form.displayLabel}
                onChange={setField('displayLabel')}
                placeholder="e.g. First month free on membership"
                size="small"
                helperText="Shown on signup/payment"
              />
              {editingRow ? (
                canEditEconomics ? (
                  <Alert severity="info">
                    Changing the amount or duration creates a corrected replacement because Stripe
                    coupons cannot be edited in place. The old promotion will be archived and its
                    code <strong>{editingRow.code}</strong> reused on the new offer. Any signup link
                    you shared will change — re-share the new link if you sent one.
                    <Box component="div" sx={{ mt: 1, fontWeight: 600 }}>
                      Current: {formatDiscountSummary(editingRow)} ·{' '}
                      {formatDiscountDuration(editingRow.duration)} · code {editingRow.code}
                    </Box>
                  </Alert>
                ) : (
                  <Alert severity="warning">
                    This promotion is shared by link only, so its amount and duration can’t be
                    changed here — a replacement would generate a new link and silently break the one
                    you already shared. To change the offer, create a new promotion instead. You can
                    still update the name, label, max redemptions, and expiration below.
                    <Box component="div" sx={{ mt: 1, fontWeight: 600 }}>
                      Current: {formatDiscountSummary(editingRow)} ·{' '}
                      {formatDiscountDuration(editingRow.duration)}
                    </Box>
                  </Alert>
                )
              ) : null}
              {canEditEconomics && (
                <>
              <FormControl size="small">
                <InputLabel id="discount-type-label">Discount type</InputLabel>
                <Select
                  labelId="discount-type-label"
                  label="Discount type"
                  value={form.discountType}
                  onChange={(e) => {
                    const next = e.target.value as AdminDiscountType;
                    setForm((prev) => ({
                      ...prev,
                      discountType: next,
                      ...(next === 'first_month_off'
                        ? { firstMonthOffKind: 'percent' as const, percentOff: '100' }
                        : {}),
                    }));
                  }}
                >
                  <MenuItem value="percent">Percent off</MenuItem>
                  <MenuItem value="fixed">Fixed amount off (USD)</MenuItem>
                  <MenuItem value="first_month_off">First month off</MenuItem>
                </Select>
              </FormControl>
              {form.discountType === 'first_month_off' && (
                <FormControl size="small">
                  <InputLabel id="first-month-off-kind-label">First month discount</InputLabel>
                  <Select
                    labelId="first-month-off-kind-label"
                    label="First month discount"
                    value={form.firstMonthOffKind}
                    onChange={(e) => {
                      const kind = e.target.value as 'percent' | 'fixed';
                      setForm((prev) => ({
                        ...prev,
                        firstMonthOffKind: kind,
                        ...(kind === 'percent' ? { percentOff: '100' } : {}),
                      }));
                    }}
                  >
                    <MenuItem value="percent">Percent off first month</MenuItem>
                    <MenuItem value="fixed">Dollar amount off first month</MenuItem>
                  </Select>
                </FormControl>
              )}
              {form.discountType === 'percent' ||
              (form.discountType === 'first_month_off' && form.firstMonthOffKind === 'percent') ? (
                <TextField
                  label={
                    form.discountType === 'first_month_off' ? 'Percent off the first month' : 'Percent off'
                  }
                  type="number"
                  inputProps={{ min: 1, max: 100 }}
                  value={form.percentOff}
                  onChange={setField('percentOff')}
                  size="small"
                  helperText={
                    form.discountType === 'first_month_off'
                      ? '100% = free first month (Stripe applies to the first invoice only)'
                      : undefined
                  }
                />
              ) : (
                <TextField
                  label={
                    form.discountType === 'first_month_off'
                      ? 'Amount off the first month (USD)'
                      : 'Amount off (USD)'
                  }
                  type="number"
                  inputProps={{ min: 0.01, step: 0.01 }}
                  value={form.amountOffDollars}
                  onChange={setField('amountOffDollars')}
                  size="small"
                />
              )}
              {form.discountType !== 'first_month_off' && (
                <FormControl size="small">
                  <InputLabel id="duration-label">Duration</InputLabel>
                  <Select
                    labelId="duration-label"
                    label="Duration"
                    value={form.duration}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        duration: e.target.value as MembershipDiscountDuration,
                      }))
                    }
                  >
                    <MenuItem value="repeating">Repeating (months)</MenuItem>
                    <MenuItem value="forever">Every invoice</MenuItem>
                  </Select>
                </FormControl>
              )}
              {form.duration === 'repeating' && form.discountType !== 'first_month_off' && (
                <TextField
                  label="Months"
                  type="number"
                  inputProps={{ min: 1 }}
                  value={form.durationInMonths}
                  onChange={setField('durationInMonths')}
                  size="small"
                />
              )}
                </>
              )}
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

              {!editingRow ? (
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
                    placeholder="e.g. LLBEAN2026"
                    size="small"
                    sx={{ mt: 1 }}
                    inputProps={{ style: { fontFamily: 'monospace', fontWeight: 700 } }}
                    helperText="Letters, digits, and dashes. 3–64 characters."
                    fullWidth
                  />
                )}
              </Box>
              ) : null}
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
                !form.name.trim() ||
                (!editingRow &&
                  form.codeOption === 'custom' &&
                  form.customCode.trim().length < 3)
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
            Archive <strong>{archiveConfirm?.name}</strong>? It will be hidden from the active list and
            deactivated. You can restore it from the Archived tab.
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
