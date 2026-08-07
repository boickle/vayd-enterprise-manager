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
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  fetchMembershipPackageItems,
  ownershipLabel,
  updateMembershipPackageItem,
  type MembershipPackage,
  type MembershipPackageItem,
} from '../api/membershipManagement';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || e?.message || 'Request failed';
}

function kindLabel(kind: MembershipPackageItem['kind']): string {
  if (kind === 'procedure') return 'Procedure';
  if (kind === 'inventory') return 'Inventory';
  if (kind === 'lab') return 'Lab';
  return 'Other';
}

type DraftRow = {
  id: number;
  price: string;
  quantity: string;
  dirty: boolean;
  managedByScout?: boolean;
};

type Props = {
  open: boolean;
  pkg: MembershipPackage | null;
  onClose: () => void;
  onSaved?: () => void;
};

export default function MembershipPackageItemsDialog({
  open,
  pkg,
  onClose,
  onSaved,
}: Props) {
  const [items, setItems] = useState<MembershipPackageItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, DraftRow>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async (packageId: number) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchMembershipPackageItems(packageId);
      setItems(rows);
      const next: Record<number, DraftRow> = {};
      for (const row of rows) {
        next[row.id] = {
          id: row.id,
          price: row.price != null ? String(row.price) : '',
          quantity: row.quantity != null ? String(row.quantity) : '',
          dirty: false,
          managedByScout: row.managedByScout,
        };
      }
      setDrafts(next);
    } catch (err) {
      setError(extractErr(err));
      setItems([]);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && pkg?.id) {
      void load(pkg.id);
    }
    if (!open) {
      setFilter('');
      setError(null);
    }
  }, [open, pkg?.id, load]);

  const dirtyCount = useMemo(
    () => Object.values(drafts).filter((d) => d.dirty).length,
    [drafts],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        kindLabel(item.kind).toLowerCase().includes(q),
    );
  }, [items, filter]);

  const setDraftField = (id: number, field: 'price' | 'quantity', value: string) => {
    setDrafts((prev) => {
      const current = prev[id];
      if (!current) return prev;
      return {
        ...prev,
        [id]: { ...current, [field]: value, dirty: true },
      };
    });
  };

  const handleSave = async () => {
    if (!pkg) return;
    const dirty = Object.values(drafts).filter((d) => d.dirty);
    if (dirty.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const row of dirty) {
        const price =
          row.price.trim() === '' ? null : Number(row.price);
        const quantity =
          row.quantity.trim() === '' ? null : Number(row.quantity);
        await updateMembershipPackageItem(row.id, {
          price: Number.isFinite(price as number) ? price : null,
          quantity: Number.isFinite(quantity as number) ? quantity : null,
        });
      }
      onSaved?.();
      await load(pkg.id);
      onClose();
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="md">
      <DialogTitle>
        Products in {pkg?.name || 'membership'}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Set the included quantity and membership price for each product. Saving a
          product marks it Scout-managed so eVet will no longer overwrite that line.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {dirtyCount > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {dirtyCount} product{dirtyCount === 1 ? '' : 's'} changed. Saving will take
            Scout ownership of those lines.
          </Alert>
        )}

        <TextField
          size="small"
          placeholder="Filter products…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ mb: 2, maxWidth: 360 }}
        />

        {loading ? (
          <Box py={4} display="flex" justifyContent="center">
            <CircularProgress size={28} />
          </Box>
        ) : filtered.length === 0 ? (
          <Alert severity="info">No products on this membership package.</Alert>
        ) : (
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Product</TableCell>
                <TableCell>Type</TableCell>
                <TableCell width={120}>Qty included</TableCell>
                <TableCell width={140}>Membership price</TableCell>
                <TableCell>Owned by</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((item) => {
                const draft = drafts[item.id];
                return (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {item.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={kindLabel(item.kind)} variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={draft?.quantity ?? ''}
                        onChange={(e) => setDraftField(item.id, 'quantity', e.target.value)}
                        inputProps={{ step: '1', min: '0' }}
                        fullWidth
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={draft?.price ?? ''}
                        onChange={(e) => setDraftField(item.id, 'price', e.target.value)}
                        inputProps={{ step: '0.01', min: '0' }}
                        fullWidth
                        InputProps={{
                          startAdornment: (
                            <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                              $
                            </Typography>
                          ),
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={ownershipLabel({
                          managedByScout: draft?.managedByScout || draft?.dirty,
                          pimsType: item.pimsType,
                        })}
                        color={draft?.managedByScout || draft?.dirty ? 'primary' : 'default'}
                        variant={draft?.managedByScout || draft?.dirty ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Stack direction="row" spacing={1} sx={{ px: 1, pb: 0.5 }}>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={saving || dirtyCount === 0}
          >
            {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'Save'}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
