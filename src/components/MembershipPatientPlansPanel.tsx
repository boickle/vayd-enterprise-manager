import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
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
  Select,
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
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import CancelIcon from '@mui/icons-material/Cancel';
import {
  createManagedWellnessPlan,
  fetchManagedWellnessPlans,
  fetchMembershipPackages,
  ownershipLabel,
  planStatusLabel,
  updateManagedWellnessPlan,
  type ManagedWellnessPlan,
  type MembershipPackage,
} from '../api/membershipManagement';
import { searchPatientsStaff, type PatientSearchRow } from '../api/patients';

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || e?.message || 'Request failed';
}

function patientLabel(p: PatientSearchRow): string {
  const name =
    p.name ||
    [p.firstName, p.lastName].filter(Boolean).join(' ') ||
    `Patient #${p.id}`;
  const client =
    (p.client as { name?: string; firstName?: string; lastName?: string } | undefined) ||
    undefined;
  const clientName =
    client?.name ||
    [client?.firstName, client?.lastName].filter(Boolean).join(' ') ||
    '';
  const pims = p.pimsId != null ? String(p.pimsId) : '';
  return [name, clientName ? `(${clientName})` : '', pims ? `· eVet ${pims}` : '']
    .filter(Boolean)
    .join(' ');
}

function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function dateInputToIso(dateOnly: string, endOfDay = false): string {
  const t = dateOnly.trim();
  const suffix = endOfDay ? 'T23:59:59.000Z' : 'T00:00:00.000Z';
  const d = new Date(`${t}${suffix}`);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
  return d.toISOString();
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

function formatMoney(price?: number | null): string {
  if (price == null || Number.isNaN(Number(price))) return '—';
  return `$${Number(price).toFixed(2)}`;
}

type PlanForm = {
  packageId: string;
  startDate: string;
  expirationDate: string;
  price: string;
  wellnessPlanStatusValue: string;
};

function defaultForm(): PlanForm {
  const start = new Date();
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  return {
    packageId: '',
    startDate: start.toISOString().slice(0, 10),
    expirationDate: end.toISOString().slice(0, 10),
    price: '',
    wellnessPlanStatusValue: '1',
  };
}

type Props = {
  practiceId: number;
};

export default function MembershipPatientPlansPanel({ practiceId }: Props) {
  const [patientQuery, setPatientQuery] = useState('');
  const [patientOptions, setPatientOptions] = useState<PatientSearchRow[]>([]);
  const [patientSearching, setPatientSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchRow | null>(null);

  const [packages, setPackages] = useState<MembershipPackage[]>([]);
  const [plans, setPlans] = useState<ManagedWellnessPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedWellnessPlan | null>(null);
  const [form, setForm] = useState<PlanForm>(defaultForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchMembershipPackages({ practiceId, activeOnly: true, includeArchived: false })
      .then(setPackages)
      .catch(() => setPackages([]));
  }, [practiceId]);

  useEffect(() => {
    const q = patientQuery.trim();
    if (q.length < 2) {
      setPatientOptions([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setPatientSearching(true);
      void searchPatientsStaff(q, { practiceId, activeOnly: true })
        .then((rows) => {
          if (!cancelled) setPatientOptions(rows.slice(0, 25));
        })
        .catch(() => {
          if (!cancelled) setPatientOptions([]);
        })
        .finally(() => {
          if (!cancelled) setPatientSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [patientQuery, practiceId]);

  const loadPlans = useCallback(async (patientId: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchManagedWellnessPlans({ patientId, practiceId });
      setPlans(data);
    } catch (err) {
      setError(extractErr(err));
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => {
    if (!selectedPatient?.id) {
      setPlans([]);
      return;
    }
    void loadPlans(Number(selectedPatient.id));
  }, [selectedPatient, loadPlans]);

  const packageOptions = useMemo(() => {
    const available = packages.filter((p) => !p.isArchived);
    // eVet carries every package type; surface membership plans first and fall
    // back to the full list when none are named like memberships.
    const memberships = available.filter(
      (p) => p.managedByScout || p.name.toLowerCase().includes('membership'),
    );
    return memberships.length > 0 ? memberships : available;
  }, [packages]);

  const openAttach = () => {
    setEditing(null);
    const next = defaultForm();
    if (packageOptions[0]) next.packageId = String(packageOptions[0].id);
    setForm(next);
    setDialogOpen(true);
  };

  const openEdit = (plan: ManagedWellnessPlan) => {
    setEditing(plan);
    setForm({
      packageId: plan.package?.id != null ? String(plan.package.id) : '',
      startDate: toDateInput(plan.startDate),
      expirationDate: toDateInput(plan.expirationDate),
      price: plan.price != null ? String(plan.price) : '',
      wellnessPlanStatusValue:
        plan.wellnessPlanStatusValue != null ? String(plan.wellnessPlanStatusValue) : '1',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!selectedPatient?.id) {
      setError('Select a patient first.');
      return;
    }
    if (!form.packageId) {
      setError('Select a membership plan.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const price = form.price.trim() === '' ? null : Number(form.price);
      const status = Number(form.wellnessPlanStatusValue);
      const payload = {
        packageId: Number(form.packageId),
        startDate: dateInputToIso(form.startDate, false),
        expirationDate: dateInputToIso(form.expirationDate, true),
        price: Number.isFinite(price as number) ? price : null,
        wellnessPlanStatusValue: Number.isFinite(status) ? status : 1,
      };

      if (editing) {
        await updateManagedWellnessPlan(editing.id, payload);
      } else {
        await createManagedWellnessPlan({
          practiceId,
          patientId: Number(selectedPatient.id),
          ...payload,
        });
      }
      setDialogOpen(false);
      await loadPlans(Number(selectedPatient.id));
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSaving(false);
    }
  };

  const cancelPlan = async (plan: ManagedWellnessPlan) => {
    if (!selectedPatient?.id) return;
    const ok = window.confirm(
      'Cancel this membership? Scout will take ownership and eVet will stop updating it.',
    );
    if (!ok) return;
    setError(null);
    try {
      await updateManagedWellnessPlan(plan.id, {
        wellnessPlanStatusValue: 0,
        isActive: false,
      });
      await loadPlans(Number(selectedPatient.id));
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
            Patient memberships
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Attach or edit a patient&apos;s wellness membership. Any Scout change stops eVet from
            overwriting that membership.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAttach}
          disabled={!selectedPatient}
        >
          Attach membership
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Autocomplete
        options={patientOptions}
        loading={patientSearching}
        value={selectedPatient}
        onChange={(_e, value) => setSelectedPatient(value)}
        inputValue={patientQuery}
        onInputChange={(_e, value) => setPatientQuery(value)}
        getOptionLabel={(opt) => patientLabel(opt)}
        isOptionEqualToValue={(a, b) => String(a.id) === String(b.id)}
        filterOptions={(x) => x}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Find patient"
            placeholder="Pet name or owner…"
            size="small"
          />
        )}
        sx={{ mb: 2, maxWidth: 480 }}
      />

      {!selectedPatient ? (
        <Alert severity="info">Search for a patient to view and manage their memberships.</Alert>
      ) : loading ? (
        <Box py={4} display="flex" justifyContent="center">
          <CircularProgress size={28} />
        </Box>
      ) : plans.length === 0 ? (
        <Alert severity="info">
          No memberships on {patientLabel(selectedPatient)}. Use &quot;Attach membership&quot; to
          add one.
        </Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Plan</TableCell>
              <TableCell>Dates</TableCell>
              <TableCell>Price</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Owned by</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {plan.package?.name || `Package #${plan.package?.id ?? '—'}`}
                  </Typography>
                </TableCell>
                <TableCell>
                  {formatDate(plan.startDate)} → {formatDate(plan.expirationDate)}
                </TableCell>
                <TableCell>{formatMoney(plan.price)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={planStatusLabel(plan)}
                    color={
                      planStatusLabel(plan) === 'Active'
                        ? 'success'
                        : planStatusLabel(plan) === 'Cancelled'
                          ? 'default'
                          : 'warning'
                    }
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={ownershipLabel(plan)}
                    color={plan.managedByScout ? 'primary' : 'default'}
                    variant={plan.managedByScout ? 'filled' : 'outlined'}
                  />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Edit (takes ownership from eVet)">
                    <Button
                      size="small"
                      startIcon={<EditIcon />}
                      onClick={() => openEdit(plan)}
                    >
                      Edit
                    </Button>
                  </Tooltip>
                  {plan.wellnessPlanStatusValue !== 0 && (
                    <Tooltip title="Cancel membership">
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={<CancelIcon />}
                        onClick={() => void cancelPlan(plan)}
                      >
                        Cancel
                      </Button>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          {editing ? 'Edit patient membership' : 'Attach membership to patient'}
        </DialogTitle>
        <DialogContent>
          {editing && !editing.managedByScout ? (
            <Alert severity="warning" sx={{ mb: 2, mt: 1 }}>
              Saving this edit will mark the membership as Scout-managed. eVet will no longer
              update it.
            </Alert>
          ) : (
            <Box sx={{ mt: 1 }} />
          )}
          <Stack spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="membership-package-label">Membership plan</InputLabel>
              <Select
                labelId="membership-package-label"
                label="Membership plan"
                value={form.packageId}
                onChange={(e) => setForm((f) => ({ ...f, packageId: String(e.target.value) }))}
              >
                {packageOptions.map((pkg) => (
                  <MenuItem key={pkg.id} value={String(pkg.id)}>
                    {pkg.name}
                    {pkg.managedByScout ? ' · Scout' : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Start date"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
                required
              />
              <TextField
                label="Expiration date"
                type="date"
                value={form.expirationDate}
                onChange={(e) => setForm((f) => ({ ...f, expirationDate: e.target.value }))}
                InputLabelProps={{ shrink: true }}
                fullWidth
                required
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Price"
                type="number"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                fullWidth
                inputProps={{ step: '0.01', min: '0' }}
              />
              <FormControl fullWidth>
                <InputLabel id="membership-status-label">Status</InputLabel>
                <Select
                  labelId="membership-status-label"
                  label="Status"
                  value={form.wellnessPlanStatusValue}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, wellnessPlanStatusValue: String(e.target.value) }))
                  }
                >
                  <MenuItem value="1">Active</MenuItem>
                  <MenuItem value="0">Cancelled</MenuItem>
                </Select>
              </FormControl>
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
