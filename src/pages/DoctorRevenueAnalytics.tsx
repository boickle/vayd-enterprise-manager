// src/pages/DoctorRevenueAnalytics.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Alert,
  Grid,
  Backdrop,
  CircularProgress,
  Chip,
  Stack,
  Checkbox,
  ListItemText,
  Divider,
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';

import { useAuth } from '../auth/useAuth';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchRevenueForDay,
  fetchDoctorRevenueSeries,
  type DoctorRevenueRow,
} from '../api/opsStats';

dayjs.extend(utc);

// ---------- utils ----------
function toISODate(d: Dayjs) {
  return d.utc().format('YYYY-MM-DD');
}
function fmtUSD(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(
    Number(n) || 0
  );
}
function fmtPct(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `${(v * 100).toFixed(0)}%`;
}
function safeNum(n: any) {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}
const ALL_VALUE = '__ALL__';

type Totals = { day: number; wtd: number; mtd: number; btd: number };
const ZERO_TOTALS: Totals = { day: 0, wtd: 0, mtd: 0, btd: 0 };

// Extended Provider with goals (keeps original Provider fields)
type ProviderWithGoals = Provider & {
  dailyRevenueGoal?: number | null;
  bonusRevenueGoal?: number | null;
  dailyPointGoal?: number | null;
  weeklyPointGoal?: number | null;
};

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const normalizeProvider = (p: any): ProviderWithGoals => ({
  id: p?.id ?? p?.pimsId ?? p?.employeeId,
  name:
    [p?.firstName, p?.lastName].filter(Boolean).join(' ').trim() ||
    p?.name ||
    `Provider ${p?.id ?? ''}`,
  email: p?.email ?? '',

  dailyRevenueGoal: toNum(p?.dailyRevenueGoal),
  bonusRevenueGoal: toNum(p?.bonusRevenueGoal),
  dailyPointGoal: toNum(p?.dailyPointGoal),
  weeklyPointGoal: toNum(p?.weeklyPointGoal),
});

// Bonus period helpers: 4/1–9/30 and 10/1–3/31
function startOfBonusPeriod(d: Dayjs) {
  const m = d.month(); // 0=Jan
  const y = d.year();
  if (m >= 3 && m <= 8) return dayjs.utc(`${y}-04-01`);
  if (m >= 9) return dayjs.utc(`${y}-10-01`);
  return dayjs.utc(`${y - 1}-10-01`);
}
function endOfBonusPeriod(d: Dayjs) {
  const m = d.month();
  const y = d.year();
  if (m >= 3 && m <= 8) return dayjs.utc(`${y}-09-30`);
  if (m >= 9) return dayjs.utc(`${y + 1}-03-31`);
  return dayjs.utc(`${y}-03-31`);
}

// ---------- page ----------
export default function DoctorRevenueAnalyticsPage() {
  const auth: any = useAuth() || {};
  const rawRole = auth?.role;
  const myDoctorId = auth?.doctorId != null ? String(auth.doctorId) : '';
  const isAdmin = Array.isArray(rawRole)
    ? rawRole.some((r: string) => ['admin', 'owner'].includes(String(r).toLowerCase()))
    : typeof rawRole === 'string'
      ? ['admin', 'owner'].includes(rawRole.toLowerCase())
      : false;

  // Date (defaults to today)
  const [date, setDate] = useState<Dayjs>(dayjs().startOf('day'));

  // Providers (carry goals)
  const [providers, setProviders] = useState<ProviderWithGoals[]>([]);
  const [providerIds, setProviderIds] = useState<string[]>([]); // selected (admins)
  const [providersLoading, setProvidersLoading] = useState(false);
  const allProviderIds = useMemo(() => providers.map((p) => String(p.id)), [providers]);
  const isAllSelected =
    allProviderIds.length > 0 &&
    providerIds.length === allProviderIds.length &&
    providerIds.every((id) => allProviderIds.includes(id));

  // Day rows (by doctor)
  const [rows, setRows] = useState<DoctorRevenueRow[]>([]);
  const [dayTotal, setDayTotal] = useState(0);

  // Aggregates
  const [selTotals, setSelTotals] = useState<Totals>(ZERO_TOTALS);
  const [companyAvgTotals, setCompanyAvgTotals] = useState<Totals>(ZERO_TOTALS);

  const [loadingAggregates, setLoadingAggregates] = useState(false);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  // The doctor id that actually matches backend productionEmployeeId for series
  const [effectiveDoctorId, setEffectiveDoctorId] = useState<string>('');

  const blocking = providersLoading || rowsLoading || loadingAggregates;

  // ---------- load providers (normalize shapes) ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setProvidersLoading(true);
        const list = await fetchPrimaryProviders();
        if (!alive) return;

        const raw = Array.isArray(list)
          ? list
          : Array.isArray((list as any)?.data)
            ? (list as any).data
            : Array.isArray((list as any)?.items)
              ? (list as any).items
              : [];

        const normalized = (raw as any[]).map(normalizeProvider);

        setProviders(normalized);
        if (isAdmin) {
          setProviderIds(normalized.map((p) => String(p.id))); // default ALL
        }
      } finally {
        if (alive) setProvidersLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  // ---------- fetch per-doctor rows for the selected day ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      setUnauthorized(false);
      setRowsLoading(true);
      try {
        const params: any = { date: toISODate(date) };
        if (isAdmin) {
          if (!isAllSelected && providerIds.length) {
            params.providerIds = providerIds;
          }
        } // non-admin: let server infer

        const resp = await fetchRevenueForDay(params);
        if (!alive) return;

        setDayTotal(Number(resp?.total ?? 0));

        // Name normalization from providers
        const nameById = new Map<string, string>();
        (providers as ProviderWithGoals[]).forEach((p) => nameById.set(String(p.id), p.name));

        const byDoc = Array.isArray(resp?.byDoctor) ? resp.byDoctor : [];
        const normalized = byDoc.map((r: any) => ({
          ...r,
          doctorName:
            r.doctorName ??
            nameById.get(String(r.doctorId ?? '')) ??
            r.doctorName ??
            'Not Specified',
        }));

        const sorted = normalized
          .slice()
          .sort((a, b) => Number(b.totalServiceValue) - Number(a.totalServiceValue));

        setRows(sorted);

        // Establish an effective doctor id for series (prefer what API returned)
        if (!isAdmin) {
          const idFromRows = sorted?.[0]?.doctorId != null ? String(sorted[0].doctorId) : '';
          setEffectiveDoctorId(idFromRows || myDoctorId || '');
        }
      } catch (e) {
        if (!alive) return;
        console.error('fetchRevenueForDay failed:', e);
        setUnauthorized(true);
        setRows([]);
        setDayTotal(0);
        setEffectiveDoctorId('');
      } finally {
        if (alive) setRowsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [date, isAdmin, isAllSelected, JSON.stringify(providerIds), providers, myDoctorId]);

  // ---------- pick selected providers ----------
  const selectedProviders = useMemo(() => {
    if (isAdmin) {
      const ids = isAllSelected ? allProviderIds : providerIds;
      return providers.filter((p) => ids.includes(String(p.id)));
    }
    if (!providers.length) return [];

    // Try id match first
    if (effectiveDoctorId) {
      const byId = providers.find((p) => String(p.id) === effectiveDoctorId);
      if (byId) return [byId];
    }

    // Fall back to name match using the first row
    const dn = rows?.[0]?.doctorName?.trim().toLowerCase();
    if (dn) {
      const byName = providers.find((p) => (p.name || '').trim().toLowerCase() === dn);
      if (byName) return [byName];
    }

    return providers.length === 1 ? [providers[0]] : [];
  }, [isAdmin, providers, providerIds, isAllSelected, allProviderIds, effectiveDoctorId, rows]);

  // ---------- goal sums ----------
  const goalSums = useMemo(() => {
    const bonus = selectedProviders.reduce((s, p) => s + (p.bonusRevenueGoal ?? 0), 0); // 6-month goal
    const daily = selectedProviders.reduce((s, p) => s + (p.dailyRevenueGoal ?? 0), 0);
    const weekly = bonus / 26;
    const monthly = bonus / 6;
    return { daily, weekly, monthly, bonus };
  }, [selectedProviders]);

  // ---------- compute Day/WTD/MTD/BTD via series(start→end) ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingAggregates(true);

        // doctors in scope
        const selIds: string[] = !isAdmin
          ? effectiveDoctorId
            ? [String(effectiveDoctorId)]
            : []
          : isAllSelected
            ? allProviderIds
            : providerIds;

        if (!selIds.length) {
          if (alive) {
            setSelTotals(ZERO_TOTALS);
            setCompanyAvgTotals(ZERO_TOTALS);
          }
          return;
        }

        const bpStart = startOfBonusPeriod(date);
        const today = date;
        const weekStart = date.startOf('week'); // if needed, switch to isoWeek with plugin
        const monthStart = date.startOf('month');

        const sumWithin = (series: { date: string; total: number }[], a: Dayjs, b: Dayjs) => {
          const s = a.startOf('day');
          const e = b.endOf('day');
          return series.reduce((acc, p) => {
            const d = dayjs.utc(String(p.date));
            if (d.isValid() && (d.isAfter(s) || d.isSame(s)) && (d.isBefore(e) || d.isSame(e))) {
              acc += Number(p.total) || 0;
            }
            return acc;
          }, 0);
        };

        const fetchSeriesFor = async (id: string) => {
          const resp = await fetchDoctorRevenueSeries({
            start: bpStart.utc().format('YYYY-MM-DD'),
            end: today.utc().format('YYYY-MM-DD'),
            doctorId: id,
          });
          return Array.isArray((resp as any)?.series) ? (resp as any).series : [];
        };

        const perDoctor = await Promise.all(
          selIds.map(async (id) => ({ id, series: await fetchSeriesFor(id) }))
        );

        if (!alive) return;

        // selection totals
        const daySum = perDoctor.reduce((s, d) => s + sumWithin(d.series, today, today), 0);
        const wtdSum = perDoctor.reduce((s, d) => s + sumWithin(d.series, weekStart, today), 0);
        const mtdSum = perDoctor.reduce((s, d) => s + sumWithin(d.series, monthStart, today), 0);
        const btdSum = perDoctor.reduce((s, d) => s + sumWithin(d.series, bpStart, today), 0);
        setSelTotals({ day: daySum, wtd: wtdSum, mtd: mtdSum, btd: btdSum });

        // company average (admins only): per-doctor average across ALL providers
        if (isAdmin && allProviderIds.length > 0) {
          const idsForAvg = allProviderIds;
          const have = new Set(selIds);
          const missing = idsForAvg.filter((id) => !have.has(id));
          const fetchedMissing = await Promise.all(
            missing.map(async (id) => ({ id, series: await fetchSeriesFor(id) }))
          );

          const full = perDoctor.concat(fetchedMissing);
          const cDay = full.reduce((s, d) => s + sumWithin(d.series, today, today), 0);
          const cW = full.reduce((s, d) => s + sumWithin(d.series, weekStart, today), 0);
          const cM = full.reduce((s, d) => s + sumWithin(d.series, monthStart, today), 0);
          const cB = full.reduce((s, d) => s + sumWithin(d.series, bpStart, today), 0);
          const denom = idsForAvg.length || 1;
          setCompanyAvgTotals({
            day: cDay / denom,
            wtd: cW / denom,
            mtd: cM / denom,
            btd: cB / denom,
          });
        } else {
          setCompanyAvgTotals(ZERO_TOTALS);
        }
      } finally {
        if (alive) setLoadingAggregates(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    date,
    isAdmin,
    effectiveDoctorId,
    isAllSelected,
    JSON.stringify(providerIds),
    allProviderIds.length,
  ]);

  if (unauthorized) {
    return (
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Box p={3}>
          <Alert severity="error">Unauthorized</Alert>
        </Box>
      </LocalizationProvider>
    );
  }

  // ---------- handlers ----------
  const handleMultiSelectChange = (e: any) => {
    const next = e.target.value as string[];
    if (next.includes(ALL_VALUE)) {
      setProviderIds(isAllSelected ? [] : allProviderIds);
      return;
    }
    setProviderIds(next);
  };

  // ---------- UI helpers ----------
  const pctOf = (num: number, den: number) => (den > 0 ? num / den : 0);

  // precompute goal sums once
  const dailyGoal = goalSums.daily;
  const weeklyGoal = goalSums.weekly;
  const monthlyGoal = goalSums.monthly;
  const bonusGoal = goalSums.bonus; // full 6-month goal

  const metrics = [
    { label: 'Daily revenue goal', value: fmtUSD(dailyGoal) },
    {
      label: 'Percent of daily goal',
      value: fmtPct(pctOf(selTotals.day, dailyGoal)),
      sub: `${fmtUSD(selTotals.day)} / ${fmtUSD(dailyGoal)}`,
    },
    {
      label: 'Total revenue this week',
      value: fmtUSD(selTotals.wtd),
      sub: `${fmtUSD(selTotals.wtd)} / ${fmtUSD(weeklyGoal)} (weekly goal)`,
    },
    { label: 'Percent of weekly goal', value: fmtPct(pctOf(selTotals.wtd, weeklyGoal)) },
    {
      label: 'Total revenue this month',
      value: fmtUSD(selTotals.mtd),
      sub: `${fmtUSD(selTotals.mtd)} / ${fmtUSD(monthlyGoal)} (monthly goal)`,
    },
    { label: 'Percent of monthly goal', value: fmtPct(pctOf(selTotals.mtd, monthlyGoal)) },
    {
      label: 'Total revenue this bonus period',
      value: fmtUSD(selTotals.btd),
      sub: `Bonus period: ${startOfBonusPeriod(date).format('M/D')}–${endOfBonusPeriod(date).format(
        'M/D'
      )}`,
    },
    {
      label: 'Percent of bonus-period goal',
      value: fmtPct(pctOf(selTotals.btd, bonusGoal)),
      sub: `${fmtUSD(selTotals.btd)} / ${fmtUSD(bonusGoal)} (6-month goal)`,
    },
  ];

  // Company average goals (per doctor), include bonus too
  const companyAvgGoals = useMemo(() => {
    if (!isAdmin || allProviderIds.length === 0) {
      return { daily: 0, weekly: 0, monthly: 0, bonus: 0 };
    }
    const denom = allProviderIds.length || 1;
    const bonusSum = providers.reduce((s, p) => s + (p.bonusRevenueGoal ?? 0), 0);
    const dailySum = providers.reduce((s, p) => s + (p.dailyRevenueGoal ?? 0), 0);
    return {
      daily: dailySum / denom,
      weekly: bonusSum / 26 / denom,
      monthly: bonusSum / 6 / denom,
      bonus: bonusSum / denom,
    };
  }, [isAdmin, providers, allProviderIds.length]);

  const CompanyAvgRow = isAdmin ? (
    <Box mt={1.5}>
      <Divider sx={{ my: 1 }} />
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Company average (per doctor)
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <Metric label="Avg daily goal" value={fmtUSD(companyAvgGoals.daily)} />
        <Metric
          label="Avg daily % achieved"
          value={fmtPct(pctOf(companyAvgTotals.day, companyAvgGoals.daily))}
          sub={`${fmtUSD(companyAvgTotals.day)} / ${fmtUSD(companyAvgGoals.daily)}`}
        />
        <Metric
          label="Avg WTD vs goal"
          value={`${fmtUSD(companyAvgTotals.wtd)} / ${fmtUSD(companyAvgGoals.weekly)}`}
          sub={fmtPct(pctOf(companyAvgTotals.wtd, companyAvgGoals.weekly))}
        />
        <Metric
          label="Avg MTD vs goal"
          value={`${fmtUSD(companyAvgTotals.mtd)} / ${fmtUSD(companyAvgGoals.monthly)}`}
          sub={fmtPct(pctOf(companyAvgTotals.mtd, companyAvgGoals.monthly))}
        />
        <Metric label="Avg BTD revenue" value={fmtUSD(companyAvgTotals.btd)} />
        <Metric
          label="Avg BTD % achieved"
          value={fmtPct(pctOf(companyAvgTotals.btd, companyAvgGoals.bonus))}
          sub={`${fmtUSD(companyAvgTotals.btd)} / ${fmtUSD(companyAvgGoals.bonus)}`}
        />
      </Box>
    </Box>
  ) : null;

  // ---------- render ----------
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Backdrop open={blocking} sx={{ color: '#fff', zIndex: (t) => t.zIndex.modal + 1 }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress color="inherit" />
          <Typography variant="body2">Loading revenue…</Typography>
        </Stack>
      </Backdrop>

      <Box p={3} display="flex" flexDirection="column" gap={3}>
        {/* Header */}
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={7}>
            <Typography variant="h5" fontWeight={600}>
              Daily Revenue by Doctor
            </Typography>
            <Typography variant="body2" color="text.secondary">
              View primary providers and their revenue for a specific day.
            </Typography>
          </Grid>
          <Grid item xs={12} md={5}>
            <Box
              display="flex"
              justifyContent={{ xs: 'flex-start', md: 'flex-end' }}
              gap={2}
              flexWrap="wrap"
            >
              <DatePicker
                label="Pick a day"
                value={date}
                onChange={(v) => v && setDate(v.startOf('day'))}
                slotProps={{ textField: { size: 'small' } }}
              />
            </Box>
          </Grid>
        </Grid>

        {/* Admin: provider multi-select with Select All */}
        {isAdmin ? (
          <Card variant="outlined">
            <CardHeader
              title="Filter Doctors"
              subheader="Choose one or more doctors. Select All shows totals for all providers."
            />
            <CardContent>
              <FormControl fullWidth size="small">
                <InputLabel id="providers-label">Doctors</InputLabel>
                <Select
                  multiple
                  labelId="providers-label"
                  label="Doctors"
                  value={isAllSelected ? [...allProviderIds] : providerIds}
                  onChange={handleMultiSelectChange}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {isAllSelected ? (
                        <Chip size="small" label="All doctors" />
                      ) : (
                        (selected as string[]).map((id) => {
                          const p = providers.find((pp) => String(pp.id) === String(id));
                          return <Chip key={id} label={p ? p.name : id} size="small" />;
                        })
                      )}
                    </Box>
                  )}
                >
                  <MenuItem value={ALL_VALUE}>
                    <Checkbox checked={isAllSelected} />
                    <ListItemText primary="Select All" />
                  </MenuItem>
                  {providers.map((p) => {
                    const checked = providerIds.includes(String(p.id)) || isAllSelected;
                    return (
                      <MenuItem key={String(p.id)} value={String(p.id)}>
                        <Checkbox checked={checked} />
                        <ListItemText primary={p.name} />
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </CardContent>
          </Card>
        ) : (
          <Alert severity="info">Showing revenue for your provider only.</Alert>
        )}

        {/* Summary with KPIs */}
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Card variant="outlined">
              <CardHeader
                titleTypographyProps={{ variant: 'subtitle2', color: 'text.secondary' }}
                title={`Totals & Goals — ${dayjs(date).format('MMM D, YYYY')}`}
              />
              <CardContent>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.5,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  }}
                >
                  <Metric label="Total revenue (day)" value={fmtUSD(dayTotal)} />
                  {metrics.map((m) => (
                    <Metric key={m.label} label={m.label} value={m.value} sub={m.sub} />
                  ))}
                </Box>

                {/* Company average row (admins only) */}
                {CompanyAvgRow}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Table */}
        <Card variant="outlined">
          <CardHeader
            title={`Revenue by Doctor — ${dayjs(date).format('MMM D, YYYY')}`}
            subheader={
              isAdmin
                ? isAllSelected
                  ? 'All doctors'
                  : `${providerIds.length} selected`
                : 'Your revenue only'
            }
          />
          <CardContent>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--mui-palette-text-secondary)' }}>
                    <th style={{ textAlign: 'left', padding: 8 }}>Doctor</th>
                    <th style={{ textAlign: 'right', padding: 8 }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && !rowsLoading ? (
                    <tr>
                      <td
                        colSpan={2}
                        style={{ padding: 12, color: 'var(--mui-palette-text-secondary)' }}
                      >
                        No revenue data for this day.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, i) => (
                      <tr
                        key={`${r.doctorId ?? 'none'}-${i}`}
                        style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}
                      >
                        <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                          {r.doctorName ?? 'Not Specified'}
                        </td>
                        <td style={{ padding: 8, textAlign: 'right' }}>
                          {fmtUSD(r.totalServiceValue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr style={{ borderTop: '2px solid rgba(0,0,0,0.12)' }}>
                      <td style={{ padding: 8, fontWeight: 700 }}>Total</td>
                      <td style={{ padding: 8, textAlign: 'right', fontWeight: 700 }}>
                        {fmtUSD(dayTotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </LocalizationProvider>
  );
}

/** Small KPI display component */
function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        minHeight: 64,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="subtitle1" fontWeight={700}>
        {value}
      </Typography>
      {sub ? (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      ) : null}
    </Box>
  );
}
