import { useCallback, useEffect, useMemo, useState } from 'react';
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
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import {
  createMembershipPackage,
  fetchMembershipPackages,
  ownershipLabel,
  updateMembershipPackage,
  type MembershipPackage,
} from '../api/membershipManagement';
import MembershipPackageItemsDialog from './MembershipPackageItemsDialog';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || e?.message || 'Request failed';
}

function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function dateInputToIso(dateOnly: string): string | null {
  const t = dateOnly.trim();
  if (!t) return null;
  const d = new Date(`${t}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatMoney(price?: number | null): string {
  if (price == null || Number.isNaN(Number(price))) return '—';
  return `$${Number(price).toFixed(2)}`;
}

type PackageForm = {
  name: string;
  description: string;
  price: string;
  isAutoRenew: boolean;
  renewalMonths: string;
  outOfPlanDiscount: string;
  startDate: string;
  endDate: string;
};

const EMPTY_FORM: PackageForm = {
  name: '',
  description: '',
  price: '',
  isAutoRenew: false,
  renewalMonths: '12',
  outOfPlanDiscount: '',
  startDate: '',
  endDate: '',
};

type Props = {
  practiceId: number;
};

export default function MembershipPackagesPanel({ practiceId }: Props) {
  const [rows, setRows] = useState<MembershipPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [membershipsOnly, setMembershipsOnly] = useState(true);
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MembershipPackage | null>(null);
  const [form, setForm] = useState<PackageForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [itemsPkg, setItemsPkg] = useState<MembershipPackage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMembershipPackages({
        practiceId,
        activeOnly: true,
        includeArchived: showArchived,
      });
      setRows(data);
    } catch (err) {
      setError(extractErr(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [practiceId, showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (membershipsOnly && !r.name.toLowerCase().includes('membership')) {
        return false;
      }
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, membershipsOnly]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (row: MembershipPackage) => {
    setEditing(row);
    setForm({
      name: row.name,
      description: row.description || '',
      price: row.price != null ? String(row.price) : '',
      isAutoRenew: !!row.isAutoRenew,
      renewalMonths: row.renewalMonths != null ? String(row.renewalMonths) : '',
      outOfPlanDiscount: row.outOfPlanDiscount != null ? String(row.outOfPlanDiscount) : '',
      startDate: toDateInput(row.startDate),
      endDate: toDateInput(row.endDate),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Package name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const price =
        form.price.trim() === '' ? null : Number(form.price);
      const renewalMonths =
        form.renewalMonths.trim() === '' ? null : Number(form.renewalMonths);
      const outOfPlanDiscount =
        form.outOfPlanDiscount.trim() === ''
          ? null
          : Number(form.outOfPlanDiscount);

      if (editing) {
        await updateMembershipPackage(editing.id, {
          name,
          description: form.description.trim() || null,
          price: Number.isFinite(price as number) ? price : null,
          isAutoRenew: form.isAutoRenew,
          renewalMonths: Number.isFinite(renewalMonths as number) ? renewalMonths : null,
          outOfPlanDiscount: Number.isFinite(outOfPlanDiscount as number)
            ? outOfPlanDiscount
            : null,
          startDate: dateInputToIso(form.startDate),
          endDate: dateInputToIso(form.endDate),
        });
      } else {
        await createMembershipPackage({
          practiceId,
          name,
          description: form.description.trim() || null,
          price: Number.isFinite(price as number) ? price : null,
          isAutoRenew: form.isAutoRenew,
          renewalMonths: Number.isFinite(renewalMonths as number) ? renewalMonths : null,
          outOfPlanDiscount: Number.isFinite(outOfPlanDiscount as number)
            ? outOfPlanDiscount
            : null,
          startDate: dateInputToIso(form.startDate),
          endDate: dateInputToIso(form.endDate),
        });
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async (row: MembershipPackage) => {
    setError(null);
    try {
      await updateMembershipPackage(row.id, { isArchived: !row.isArchived });
      await load();
    } catch (err) {
      setError(extractErr(err));
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={600}>
            Membership plan definitions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Packages define benefits and pricing. Use the products icon to set how much each
            included product costs under that membership. Editing a plan or product in Scout
            stops eVet from overwriting it.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControlLabel
            control={
              <Switch
                checked={membershipsOnly}
                onChange={(e) => setMembershipsOnly(e.target.checked)}
                size="small"
              />
            }
            label="Memberships only"
          />
          <FormControlLabel
            control={
              <Switch
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                size="small"
              />
            }
            label="Show archived"
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            New plan
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TextField
        size="small"
        placeholder="Search plans…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ mb: 2, maxWidth: 360 }}
      />

      {loading ? (
        <Box py={4} display="flex" justifyContent="center">
          <CircularProgress size={28} />
        </Box>
      ) : filtered.length === 0 ? (
        <Alert severity="info">
          {rows.length > 0
            ? 'No plans match the current filters. Try turning off "Memberships only" or clearing the search.'
            : 'No plans found for this practice. Archived plans are hidden — turn on "Show archived" to include them.'}
        </Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Price</TableCell>
              <TableCell>Renewal</TableCell>
              <TableCell>Owned by</TableCell>
              <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.name}
                    </Typography>
                    {row.description ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.description}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatMoney(row.price)}</TableCell>
                  <TableCell>
                    {row.isAutoRenew
                      ? `${row.renewalMonths ?? '—'} mo`
                      : 'Manual'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={ownershipLabel(row)}
                      color={row.managedByScout ? 'primary' : 'default'}
                      variant={row.managedByScout ? 'filled' : 'outlined'}
                    />
                  </TableCell>
                  <TableCell>
                    {row.isArchived ? (
                      <Chip size="small" label="Archived" color="warning" />
                    ) : (
                      <Chip size="small" label="Active" color="success" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit product pricing">
                      <IconButton size="small" onClick={() => setItemsPkg(row)}>
                        <Inventory2OutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit plan (takes ownership from eVet)">
                      <IconButton size="small" onClick={() => openEdit(row)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={row.isArchived ? 'Unarchive' : 'Archive'}>
                      <IconButton size="small" onClick={() => void toggleArchive(row)}>
                        {row.isArchived ? (
                          <UnarchiveIcon fontSize="small" />
                        ) : (
                          <ArchiveIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

      <MembershipPackageItemsDialog
        open={!!itemsPkg}
        pkg={itemsPkg}
        onClose={() => setItemsPkg(null)}
        onSaved={() => void load()}
      />

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit membership plan' : 'New membership plan'}</DialogTitle>
        <DialogContent>
          {editing && !editing.managedByScout ? (
            <Alert severity="warning" sx={{ mb: 2, mt: 1 }}>
              Saving this edit will mark the plan as Scout-managed. eVet will no longer update it.
            </Alert>
          ) : (
            <Box sx={{ mt: 1 }} />
          )}
          <Stack spacing={2}>
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              fullWidth
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
              multiline
              minRows={2}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Price"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                fullWidth
                type="number"
                inputProps={{ step: '0.01', min: '0' }}
              />
              <TextField
                label="Out-of-plan discount %"
                value={form.outOfPlanDiscount}
                onChange={(e) => setForm((f) => ({ ...f, outOfPlanDiscount: e.target.value }))}
                fullWidth
                type="number"
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isAutoRenew}
                    onChange={(e) => setForm((f) => ({ ...f, isAutoRenew: e.target.checked }))}
                  />
                }
                label="Auto-renew"
              />
              <TextField
                label="Renewal months"
                value={form.renewalMonths}
                onChange={(e) => setForm((f) => ({ ...f, renewalMonths: e.target.value }))}
                type="number"
                size="small"
                disabled={!form.isAutoRenew}
                sx={{ maxWidth: 160 }}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Available from"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
              <TextField
                label="Available until"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
