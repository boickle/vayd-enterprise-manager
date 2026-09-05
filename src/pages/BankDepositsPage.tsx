import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import {
  createDeposit,
  listDeposits,
  listUndepositedTenders,
  voidDeposit,
  type PracticeDeposit,
  type UndepositedTender,
} from '../api/deposits';
import {
  listDepositBankAccounts,
  type DepositBankAccount,
} from '../api/depositBankAccounts';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import DepositSlip from '../components/deposits/DepositSlip';

function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
}

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const msg = e?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return msg ?? e?.message ?? 'Something went wrong.';
}

function toDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

function isCashTender(t: Pick<UndepositedTender, 'method' | 'paymentTypeName'>): boolean {
  const m = (t.method || '').toLowerCase();
  const n = (t.paymentTypeName || '').toLowerCase();
  return m === 'cash' || n === 'cash' || /(^|\s)cash(\s|$)/i.test(n);
}

function isCheckTender(t: Pick<UndepositedTender, 'method' | 'paymentTypeName'>): boolean {
  const m = (t.method || '').toLowerCase();
  const n = (t.paymentTypeName || '').toLowerCase();
  return m === 'check' || n.includes('check') || n.includes('cheque');
}

export default function BankDepositsPage() {
  const [from, setFrom] = useState<Dayjs>(() => dayjs().subtract(13, 'day'));
  const [to, setTo] = useState<Dayjs>(() => dayjs());
  const [providerEmployeeId, setProviderEmployeeId] = useState<number | ''>('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [banks, setBanks] = useState<DepositBankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<number | ''>('');
  const [undeposited, setUndeposited] = useState<UndepositedTender[]>([]);
  const [deposits, setDeposits] = useState<PracticeDeposit[]>([]);
  /** Selected tender ids; check lines keep slip order in `checkOrder`. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checkOrder, setCheckOrder] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [depositedOn, setDepositedOn] = useState<Dayjs>(() => dayjs());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [slipDeposit, setSlipDeposit] = useState<PracticeDeposit | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bankRows, tenderRows, depositRows, providerRows] = await Promise.all([
        listDepositBankAccounts({ activeOnly: true }),
        listUndepositedTenders({
          from: toDateStr(from),
          to: toDateStr(to),
          providerEmployeeId:
            providerEmployeeId === '' ? null : providerEmployeeId,
        }),
        listDeposits({ limit: 40 }),
        fetchPrimaryProviders().catch(() => [] as Provider[]),
      ]);
      setBanks(bankRows);
      setUndeposited(tenderRows);
      setDeposits(depositRows);
      setProviders(providerRows);
      const alive = new Set(tenderRows.map((t) => t.tenderId));
      setSelected((prev) => new Set([...prev].filter((id) => alive.has(id))));
      setCheckOrder((prev) => prev.filter((id) => alive.has(id)));
      setBankAccountId((cur) => {
        if (cur !== '' && bankRows.some((b) => b.id === cur)) return cur;
        return bankRows[0]?.id ?? '';
      });
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setLoading(false);
    }
  }, [from, to, providerEmployeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => {
    const m = new Map<string, UndepositedTender>();
    for (const t of undeposited) m.set(t.tenderId, t);
    return m;
  }, [undeposited]);

  const selectedRows = useMemo(
    () => undeposited.filter((t) => selected.has(t.tenderId)),
    [undeposited, selected],
  );

  const selectedCash = useMemo(
    () => selectedRows.filter(isCashTender),
    [selectedRows],
  );

  const selectedChecks = useMemo(() => {
    const checks = selectedRows.filter(isCheckTender);
    const orderIndex = new Map(checkOrder.map((id, i) => [id, i]));
    return [...checks].sort((a, b) => {
      const ai = orderIndex.has(a.tenderId) ? orderIndex.get(a.tenderId)! : 9999;
      const bi = orderIndex.has(b.tenderId) ? orderIndex.get(b.tenderId)! : 9999;
      return ai - bi;
    });
  }, [selectedRows, checkOrder]);

  const selectedOther = useMemo(
    () => selectedRows.filter((t) => !isCashTender(t) && !isCheckTender(t)),
    [selectedRows],
  );

  const cashTotal = useMemo(
    () => selectedCash.reduce((s, t) => s + (Number(t.amount) || 0), 0),
    [selectedCash],
  );

  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, t) => s + (Number(t.amount) || 0), 0),
    [selectedRows],
  );

  /** Order posted to API / slip: cash, then checks in slip order, then other. */
  const orderedTenderIds = useMemo(() => {
    return [
      ...selectedCash.map((t) => t.tenderId),
      ...selectedChecks.map((t) => t.tenderId),
      ...selectedOther.map((t) => t.tenderId),
    ];
  }, [selectedCash, selectedChecks, selectedOther]);

  const providerOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of providers) {
      const id = Number(p.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      map.set(id, p.name || `Provider #${id}`);
    }
    for (const t of undeposited) {
      if (t.providerEmployeeId == null) continue;
      if (!map.has(t.providerEmployeeId)) {
        map.set(
          t.providerEmployeeId,
          t.providerLabel || `Provider #${t.providerEmployeeId}`,
        );
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [providers, undeposited]);

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelected(new Set());
      setCheckOrder([]);
      return;
    }
    const ids = undeposited.map((t) => t.tenderId);
    setSelected(new Set(ids));
    setCheckOrder(undeposited.filter(isCheckTender).map((t) => t.tenderId));
  }

  function toggleOne(id: string, checked: boolean) {
    const row = byId.get(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    if (row && isCheckTender(row)) {
      setCheckOrder((prev) => {
        if (checked) return prev.includes(id) ? prev : [...prev, id];
        return prev.filter((x) => x !== id);
      });
    }
  }

  function moveCheck(id: string, dir: -1 | 1) {
    setCheckOrder((prev) => {
      const list = selectedChecks.map((t) => t.tenderId);
      const i = list.indexOf(id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item);
      return next;
    });
  }

  function onCheckDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    setCheckOrder((prev) => {
      const list = selectedChecks.map((t) => t.tenderId);
      const from = list.indexOf(dragId);
      const to = list.indexOf(targetId);
      if (from < 0 || to < 0) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setDragId(null);
  }

  async function handleCreateDeposit() {
    if (bankAccountId === '' || selected.size === 0) {
      setError('Select a bank and at least one payment.');
      return;
    }
    if (!depositedOn?.isValid()) {
      setError('Deposited on date is required.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const dep = await createDeposit({
        bankAccountId,
        tenderIds: orderedTenderIds,
        note: note.trim() || null,
        depositedOn: toDateStr(depositedOn),
      });
      setSuccess(
        `Deposit posted to ${dep.bankName} for ${fmtUSD(dep.total)} (${dep.lineCount} payments).`,
      );
      setSelected(new Set());
      setCheckOrder([]);
      setNote('');
      setDepositedOn(dayjs());
      setSlipDeposit(dep);
      await load();
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleVoid(dep: PracticeDeposit) {
    const reason = window.prompt(
      `Void deposit to ${dep.bankName} (${fmtUSD(dep.total)})? Optional reason:`,
      '',
    );
    if (reason === null) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await voidDeposit(dep.id, { reason: reason.trim() || null });
      setSuccess('Deposit voided. Payments returned to the undeposited queue.');
      await load();
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setSaving(false);
    }
  }

  const allSelected = undeposited.length > 0 && selected.size === undeposited.length;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p: 2, maxWidth: 1280, mx: 'auto' }}>
        <Typography variant="h5" sx={{ mb: 1 }}>
          Bank deposits
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Grab undeposited cash and check payments into a posted deposit so they cannot
          disappear untracked.
        </Typography>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {success ? (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '360px 1fr' },
            gap: 2,
            alignItems: 'stretch',
            mb: 3,
            minHeight: { md: 'calc(100vh - 220px)' },
          }}
        >
          <Card
            sx={{
              display: 'flex',
              flexDirection: 'column',
              maxHeight: { md: 'calc(100vh - 220px)' },
              overflow: 'hidden',
            }}
          >
            <CardHeader title="Create deposit" sx={{ flexShrink: 0, pb: 1 }} />
            <CardContent
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                pt: 0,
              }}
            >
              <Stack spacing={2} sx={{ flexShrink: 0 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="deposit-bank-label">Deposit to</InputLabel>
                  <Select
                    labelId="deposit-bank-label"
                    label="Deposit to"
                    value={bankAccountId === '' ? '' : String(bankAccountId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBankAccountId(v === '' ? '' : Number(v));
                    }}
                  >
                    {banks.map((b) => (
                      <MenuItem key={b.id} value={String(b.id)}>
                        {b.name} · {b.accountNumber}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <DatePicker
                  label="Deposited on *"
                  value={depositedOn}
                  onChange={(v) => v && setDepositedOn(v)}
                  slotProps={{
                    textField: {
                      size: 'small',
                      fullWidth: true,
                      required: true,
                    },
                  }}
                />
                <TextField
                  size="small"
                  label="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                />
              </Stack>

              <Box
                sx={{
                  border: '2px solid #111',
                  p: 1.5,
                  bgcolor: '#fff',
                  fontFamily: '"Courier New", Courier, monospace',
                  flex: 1,
                  minHeight: 160,
                }}
              >
                <Typography
                  sx={{
                    textAlign: 'center',
                    fontWeight: 700,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    mb: 1,
                  }}
                >
                  Deposit slip draft
                </Typography>
                <Typography
                  sx={{
                    textAlign: 'center',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    mb: 1.5,
                    color: 'text.secondary',
                  }}
                >
                  {depositedOn?.isValid()
                    ? depositedOn.format('MMM D, YYYY')
                    : 'Pick deposited on date'}
                </Typography>

                <Box
                  sx={{
                    borderBottom: '2px solid #111',
                    pb: 1,
                    mb: 1.5,
                  }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      mb: selectedCash.length ? 0.5 : 0,
                    }}
                  >
                    <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 13 }}>
                      CASH{selectedCash.length > 1 ? ` (${selectedCash.length})` : ''}
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: 'inherit',
                        fontWeight: 700,
                        fontSize: 13,
                        textAlign: 'right',
                      }}
                    >
                      {fmtUSD(cashTotal)}
                    </Typography>
                  </Box>
                  {selectedCash.map((t) => (
                    <Box
                      key={t.tenderId}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 1,
                        fontSize: 12,
                        fontFamily: 'inherit',
                        pl: 0.5,
                        color: 'text.secondary',
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.clientLabel || 'Cash'}
                      </span>
                      <span style={{ whiteSpace: 'nowrap' }}>{fmtUSD(t.amount)}</span>
                    </Box>
                  ))}
                </Box>

                <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 12, mb: 0.75 }}>
                  CHECKS
                  {selectedChecks.length
                    ? ` (${selectedChecks.length}) · drag to reorder`
                    : ''}
                </Typography>
                {selectedChecks.length === 0 ? (
                  <Typography sx={{ fontFamily: 'inherit', fontSize: 12, color: 'text.secondary', mb: 1 }}>
                    None selected
                  </Typography>
                ) : (
                  <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                    {selectedChecks.map((t, idx) => (
                      <Box
                        key={t.tenderId}
                        draggable
                        onDragStart={() => setDragId(t.tenderId)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => onCheckDrop(t.tenderId)}
                        onDragEnd={() => setDragId(null)}
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: '18px 1fr auto',
                          gap: 0.75,
                          alignItems: 'center',
                          border: '1px solid #ccc',
                          borderRadius: 1,
                          px: 0.75,
                          py: 0.5,
                          bgcolor: dragId === t.tenderId ? '#eef3ff' : '#fafafa',
                          cursor: 'grab',
                          fontSize: 12,
                          fontFamily: 'inherit',
                        }}
                      >
                        <Stack spacing={0} sx={{ lineHeight: 1 }}>
                          <Button
                            size="small"
                            disabled={idx === 0}
                            onClick={() => moveCheck(t.tenderId, -1)}
                            sx={{ minWidth: 16, p: 0, fontSize: 10, lineHeight: 1 }}
                          >
                            ▲
                          </Button>
                          <Button
                            size="small"
                            disabled={idx === selectedChecks.length - 1}
                            onClick={() => moveCheck(t.tenderId, 1)}
                            sx={{ minWidth: 16, p: 0, fontSize: 10, lineHeight: 1 }}
                          >
                            ▼
                          </Button>
                        </Stack>
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ fontWeight: 700 }}>
                            #{(t.checkNumber || '—').trim() || '—'}
                          </Box>
                          <Box
                            sx={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'text.secondary',
                            }}
                          >
                            {t.clientLabel || '—'}
                          </Box>
                        </Box>
                        <Box sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {fmtUSD(t.amount)}
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                )}

                {selectedOther.length > 0 ? (
                  <Box sx={{ mb: 1.5 }}>
                    <Typography sx={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 12 }}>
                      Other
                    </Typography>
                    {selectedOther.map((t) => (
                      <Box
                        key={t.tenderId}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 12,
                          fontFamily: 'inherit',
                        }}
                      >
                        <span>{t.paymentTypeName || t.method}</span>
                        <span>{fmtUSD(t.amount)}</span>
                      </Box>
                    ))}
                  </Box>
                ) : null}

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    borderTop: '3px double #111',
                    pt: 1,
                  }}
                >
                  <Typography sx={{ fontFamily: 'inherit', fontWeight: 800, fontSize: 14 }}>
                    TOTAL
                  </Typography>
                  <Typography
                    sx={{ fontFamily: 'inherit', fontWeight: 800, fontSize: 14, textAlign: 'right' }}
                  >
                    {fmtUSD(selectedTotal)}
                  </Typography>
                </Box>
                <Typography
                  sx={{ fontFamily: 'inherit', fontSize: 11, color: 'text.secondary', mt: 0.5 }}
                >
                  {selected.size} payment{selected.size === 1 ? '' : 's'}
                </Typography>
              </Box>

              <Button
                variant="contained"
                fullWidth
                sx={{ flexShrink: 0 }}
                disabled={
                  saving ||
                  selected.size === 0 ||
                  bankAccountId === '' ||
                  !depositedOn?.isValid()
                }
                onClick={() => void handleCreateDeposit()}
              >
                {saving ? 'Creating…' : 'Create deposit'}
              </Button>
              {!banks.length ? (
                <Alert severity="warning">
                  No active deposit bank accounts. Add them under Settings → Payment Types.
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card
            sx={{
              display: 'flex',
              flexDirection: 'column',
              maxHeight: { md: 'calc(100vh - 220px)' },
              overflow: 'hidden',
            }}
          >
            <CardHeader
              title="Undeposited payments"
              subheader="Filter by date and line-item provider, then check payments to include"
              sx={{ flexShrink: 0 }}
            />
            <CardContent sx={{ flex: 1, minHeight: 0, overflow: 'auto', pt: 0 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ sm: 'center' }}
                sx={{ mb: 2 }}
              >
                <DatePicker
                  label="From"
                  value={from}
                  onChange={(v) => v && setFrom(v)}
                  slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
                />
                <DatePicker
                  label="To"
                  value={to}
                  onChange={(v) => v && setTo(v)}
                  slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
                />
                <FormControl size="small" sx={{ minWidth: 200 }}>
                  <InputLabel id="provider-filter-label">Provider</InputLabel>
                  <Select
                    labelId="provider-filter-label"
                    label="Provider"
                    value={providerEmployeeId === '' ? '' : String(providerEmployeeId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setProviderEmployeeId(v === '' ? '' : Number(v));
                    }}
                  >
                    <MenuItem value="">All providers</MenuItem>
                    {providerOptions.map((p) => (
                      <MenuItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button size="small" onClick={() => void load()} disabled={loading}>
                  Refresh
                </Button>
              </Stack>

              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={allSelected}
                            indeterminate={selected.size > 0 && !allSelected}
                            onChange={(e) => toggleAll(e.target.checked)}
                            disabled={!undeposited.length}
                          />
                        </TableCell>
                        <TableCell>Received</TableCell>
                        <TableCell>Client</TableCell>
                        <TableCell>Provider</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Check #</TableCell>
                        <TableCell>Invoice</TableCell>
                        <TableCell align="right">Amount</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {undeposited.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8}>
                            <Typography color="text.secondary">
                              No undeposited payments match these filters.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        undeposited.map((t) => (
                          <TableRow key={t.tenderId} hover>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={selected.has(t.tenderId)}
                                onChange={(e) => toggleOne(t.tenderId, e.target.checked)}
                              />
                            </TableCell>
                            <TableCell>
                              {dayjs(t.receivedAt).format('MMM D, YYYY h:mm A')}
                            </TableCell>
                            <TableCell>
                              {t.clientId != null ? (
                                <Link
                                  to={`/schedule/clients?clientId=${encodeURIComponent(String(t.clientId))}`}
                                  style={{ color: '#1565c0', textDecoration: 'none' }}
                                >
                                  {t.clientLabel ?? `Client #${t.clientId}`}
                                </Link>
                              ) : (
                                (t.clientLabel ?? '—')
                              )}
                            </TableCell>
                            <TableCell>{t.providerLabel ?? '—'}</TableCell>
                            <TableCell>{t.paymentTypeName || t.method}</TableCell>
                            <TableCell>{t.checkNumber || '—'}</TableCell>
                            <TableCell>
                              {t.clientId != null && t.invoiceId ? (
                                <Link
                                  to={`/schedule/clients?clientId=${encodeURIComponent(String(t.clientId))}&tab=financial&invoice=${encodeURIComponent(t.invoiceId)}`}
                                  style={{ color: '#1565c0', textDecoration: 'none' }}
                                >
                                  {t.scoutInvoiceNumber != null
                                    ? `#${t.scoutInvoiceNumber}`
                                    : 'Open invoice'}
                                </Link>
                              ) : t.scoutInvoiceNumber != null ? (
                                `#${t.scoutInvoiceNumber}`
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell align="right">{fmtUSD(t.amount)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Box>

        <Card>
          <CardHeader title="Recent deposits" />
          <CardContent>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={28} />
              </Box>
            ) : deposits.length === 0 ? (
              <Typography color="text.secondary">No deposits yet.</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Bank</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell>Lines</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Created by</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {deposits.map((d) => {
                      const open = expanded.has(d.id);
                      const isVoid = d.status === 'void';
                      return (
                        <React.Fragment key={d.id}>
                          <TableRow
                            hover
                            sx={
                              isVoid
                                ? {
                                    color: 'error.main',
                                    '& td': { color: 'error.main' },
                                  }
                                : undefined
                            }
                          >
                            <TableCell>
                              {dayjs(d.postedAt ?? d.created).format('MMM D, YYYY')}
                            </TableCell>
                            <TableCell>
                              {d.bankName}
                              {d.bankAccountNumber ? ` · ${d.bankAccountNumber}` : ''}
                            </TableCell>
                            <TableCell align="right">{fmtUSD(d.total)}</TableCell>
                            <TableCell>{d.lineCount}</TableCell>
                            <TableCell sx={isVoid ? { fontWeight: 700 } : undefined}>
                              {d.status}
                            </TableCell>
                            <TableCell>
                              {d.createdByLabel ||
                                (d.createdByEmployeeId != null
                                  ? `Employee #${d.createdByEmployeeId}`
                                  : '—')}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="small"
                                onClick={() =>
                                  setExpanded((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(d.id)) next.delete(d.id);
                                    else next.add(d.id);
                                    return next;
                                  })
                                }
                              >
                                {open ? 'Hide' : 'Lines'}
                              </Button>
                              <Button size="small" onClick={() => setSlipDeposit(d)}>
                                Slip
                              </Button>
                              {d.status !== 'void' ? (
                                <Button
                                  size="small"
                                  color="warning"
                                  disabled={saving}
                                  onClick={() => void handleVoid(d)}
                                >
                                  Void
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                          {open
                            ? d.lines.map((l) => (
                                <TableRow key={l.id} sx={{ bgcolor: 'action.hover' }}>
                                  <TableCell colSpan={2} sx={{ pl: 4 }}>
                                    {l.clientLabel ?? '—'} · {l.paymentTypeName || l.method}
                                    {l.checkNumber ? ` · check ${l.checkNumber}` : ''}
                                  </TableCell>
                                  <TableCell align="right">{fmtUSD(l.amount)}</TableCell>
                                  <TableCell colSpan={4}>
                                    {l.receivedAt
                                      ? dayjs(l.receivedAt).format('MMM D, YYYY h:mm A')
                                      : '—'}
                                  </TableCell>
                                </TableRow>
                              ))
                            : null}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </Box>

      <Dialog
        open={slipDeposit != null}
        onClose={() => setSlipDeposit(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#f7f7f5' } }}
      >
        <DialogContent>
          {slipDeposit ? (
            <DepositSlip deposit={slipDeposit} onClose={() => setSlipDeposit(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </LocalizationProvider>
  );
}
