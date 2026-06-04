import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import {
  createMembershipDiscount,
  createMembershipDiscountLink,
  fetchMembershipDiscounts,
  type CreateMembershipDiscountRequest,
  type MembershipDiscountDuration,
  type MembershipDiscountRecord,
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

type AdminDiscountType = 'percent' | 'fixed' | 'first_month_off';

export default function MembershipStripeDiscountsPanel() {
  const [rows, setRows] = useState<MembershipDiscountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [displayLabel, setDisplayLabel] = useState('');
  const [discountType, setDiscountType] = useState<AdminDiscountType>('percent');
  const [percentOff, setPercentOff] = useState('10');
  const [amountOffDollars, setAmountOffDollars] = useState('25');
  const [duration, setDuration] = useState<MembershipDiscountDuration>('forever');
  const [firstMonthOffKind, setFirstMonthOffKind] = useState<'percent' | 'fixed'>('percent');
  const [durationInMonths, setDurationInMonths] = useState('3');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMembershipDiscounts();
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const effectiveDuration: MembershipDiscountDuration =
        discountType === 'first_month_off' ? 'once' : duration;

      const payload: CreateMembershipDiscountRequest = {
        name: name.trim(),
        displayLabel: displayLabel.trim() || undefined,
        duration: effectiveDuration,
        createLink: true,
      };

      const usePercent =
        discountType === 'percent' ||
        (discountType === 'first_month_off' && firstMonthOffKind === 'percent');

      if (usePercent) {
        const pct = Number(percentOff);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
          setError('Enter a percent between 1 and 100.');
          setCreating(false);
          return;
        }
        payload.percentOff = pct;
      } else {
        const dollars = Number(amountOffDollars);
        if (!Number.isFinite(dollars) || dollars <= 0) {
          setError('Enter a positive dollar amount.');
          setCreating(false);
          return;
        }
        payload.amountOffCents = Math.round(dollars * 100);
      }

      if (discountType === 'first_month_off' && !displayLabel.trim()) {
        if (payload.percentOff != null) {
          payload.displayLabel =
            payload.percentOff >= 100
              ? 'First month free'
              : `${payload.percentOff}% off your first month`;
        } else if (payload.amountOffCents != null) {
          payload.displayLabel = `$${(payload.amountOffCents / 100).toFixed(2)} off your first month`;
        }
      }

      if (effectiveDuration === 'repeating') {
        const months = Number(durationInMonths);
        if (!Number.isFinite(months) || months < 1) {
          setError('Repeating discounts need duration in months (1 or more).');
          setCreating(false);
          return;
        }
        payload.durationInMonths = months;
      }
      if (maxRedemptions.trim()) {
        const max = Number(maxRedemptions);
        if (!Number.isFinite(max) || max < 1) {
          setError('Max redemptions must be a positive number.');
          setCreating(false);
          return;
        }
        payload.maxRedemptions = max;
      }
      if (expiresAt.trim()) payload.expiresAt = expiresAt.trim();

      const created = await createMembershipDiscount(payload);
      setSuccess(
        created.linkToken
          ? 'Discount created. Share link copied below — clients never see the Stripe code.'
          : 'Discount created. Generate a link from the table if needed.',
      );
      setName('');
      setDisplayLabel('');
      await load();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to create discount.';
      setError(typeof msg === 'string' ? msg : 'Failed to create discount.');
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

          <Box
            component="form"
            onSubmit={handleCreate}
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            }}
          >
            <TextField
              label="Internal name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. VIP client — 20% off"
              size="small"
            />
            <TextField
              label="Client-facing label (optional)"
              value={displayLabel}
              onChange={(e) => setDisplayLabel(e.target.value)}
              placeholder="e.g. 20% off your membership"
              size="small"
              helperText="Shown on signup/payment; not the Stripe code"
            />
            <FormControl size="small">
              <InputLabel id="discount-type-label">Discount type</InputLabel>
              <Select
                labelId="discount-type-label"
                label="Discount type"
                value={discountType}
                onChange={(e) => {
                  const next = e.target.value as AdminDiscountType;
                  setDiscountType(next);
                  if (next === 'first_month_off') {
                    setFirstMonthOffKind('percent');
                    setPercentOff('100');
                  }
                }}
              >
                <MenuItem value="percent">Percent off</MenuItem>
                <MenuItem value="fixed">Fixed amount off (USD)</MenuItem>
                <MenuItem value="first_month_off">First month off</MenuItem>
              </Select>
            </FormControl>
            {discountType === 'first_month_off' && (
              <FormControl size="small">
                <InputLabel id="first-month-off-kind-label">First month discount</InputLabel>
                <Select
                  labelId="first-month-off-kind-label"
                  label="First month discount"
                  value={firstMonthOffKind}
                  onChange={(e) => {
                    const kind = e.target.value as 'percent' | 'fixed';
                    setFirstMonthOffKind(kind);
                    if (kind === 'percent') setPercentOff('100');
                  }}
                >
                  <MenuItem value="percent">Percent off first month</MenuItem>
                  <MenuItem value="fixed">Dollar amount off first month</MenuItem>
                </Select>
              </FormControl>
            )}
            {discountType === 'percent' ||
            (discountType === 'first_month_off' && firstMonthOffKind === 'percent') ? (
              <TextField
                label={
                  discountType === 'first_month_off' ? 'Percent off the first month' : 'Percent off'
                }
                type="number"
                inputProps={{ min: 1, max: 100 }}
                value={percentOff}
                onChange={(e) => setPercentOff(e.target.value)}
                size="small"
                helperText={
                  discountType === 'first_month_off'
                    ? '100% = free first month (Stripe applies to the first invoice only)'
                    : undefined
                }
              />
            ) : (
              <TextField
                label={
                  discountType === 'first_month_off'
                    ? 'Amount off the first month (USD)'
                    : 'Amount off (USD)'
                }
                type="number"
                inputProps={{ min: 0.01, step: 0.01 }}
                value={amountOffDollars}
                onChange={(e) => setAmountOffDollars(e.target.value)}
                size="small"
              />
            )}
            {discountType !== 'first_month_off' && (
              <FormControl size="small">
                <InputLabel id="duration-label">Duration</InputLabel>
                <Select
                  labelId="duration-label"
                  label="Duration"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as MembershipDiscountDuration)}
                >
                  <MenuItem value="repeating">Repeating (months)</MenuItem>
                  <MenuItem value="forever">Every invoice</MenuItem>
                </Select>
              </FormControl>
            )}
            {duration === 'repeating' && discountType !== 'first_month_off' && (
              <TextField
                label="Months"
                type="number"
                inputProps={{ min: 1 }}
                value={durationInMonths}
                onChange={(e) => setDurationInMonths(e.target.value)}
                size="small"
              />
            )}
            <TextField
              label="Max redemptions (optional)"
              type="number"
              inputProps={{ min: 1 }}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              size="small"
            />
            <TextField
              label="Expires (optional)"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            <Box sx={{ gridColumn: { md: '1 / -1' } }}>
              <Button type="submit" variant="contained" disabled={creating || !name.trim()}>
                {creating ? 'Creating…' : 'Create discount + link'}
              </Button>
            </Box>
          </Box>

          <Typography variant="subtitle2" color="text.secondary">
            Share links use{' '}
            <code style={{ fontSize: 13 }}>/client-portal/membership-signup?promo=…</code>. For appointment
            flows use{' '}
            <code style={{ fontSize: 13 }}>/client-portal/request-appointment/membership-signup?promo=…</code>.
          </Typography>

          {loading ? (
            <Box display="flex" justifyContent="center" py={2}>
              <CircularProgress size={28} />
            </Box>
          ) : rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No discounts yet.
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Offer</TableCell>
                    <TableCell>Duration</TableCell>
                    <TableCell>Redemptions</TableCell>
                    <TableCell align="right">Link</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.displayLabel || formatDiscountSummary(row)}</TableCell>
                      <TableCell>{formatDiscountDuration(row.duration)}</TableCell>
                      <TableCell>
                        {row.timesRedeemed ?? 0}
                        {row.maxRedemptions != null ? ` / ${row.maxRedemptions}` : ''}
                      </TableCell>
                      <TableCell align="right">
                        {row.linkToken ? (
                          <Button
                            size="small"
                            startIcon={<ContentCopyIcon fontSize="small" />}
                            onClick={() => void copyLinkForToken(row.linkToken!)}
                          >
                            {copiedToken === row.linkToken ? 'Copied' : 'Copy link'}
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            startIcon={<LinkIcon fontSize="small" />}
                            disabled={linkingId === row.id}
                            onClick={() => void handleCreateLink(row.id)}
                          >
                            {linkingId === row.id ? '…' : 'Create link'}
                          </Button>
                        )}
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
    </Card>
  );
}
