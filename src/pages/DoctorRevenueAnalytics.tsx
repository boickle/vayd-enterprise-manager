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
  type DoctorRevenueSeriesResponse,
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

type Totals = {
  day: number;
  wtd: number;
  mtd: number;
  btd: number; // bonus period to date
};
const ZERO_TOTALS: Totals = { day: 0, wtd: 0, mtd: 0, btd: 0 };

const ALL_VALUE = '__ALL__';

// Bonus period helpers: 4/1–9/30 and 10/1–3/31
function startOfBonusPeriod(d: Dayjs) {
  const m = d.month(); // 0=Jan
  const y = d.year();
  if (m >= 3 && m <= 8) {
    // Apr..Sep
    return dayjs.utc(`${y}-04-01`);
  }
  if (m >= 9) {
    // Oct..Dec
    return dayjs.utc(`${y}-10-01`);
  }
  // Jan..Mar -> Oct 1 of prev year
  return dayjs.utc(`${y - 1}-10-01`);
}
function endOfBonusPeriod(d: Dayjs) {
  const m = d.month();
  const y = d.year();
  if (m >= 3 && m <= 8) {
    return dayjs.utc(`${y}-09-30`);
  }
  if (m >= 9) {
    return dayjs.utc(`${y + 1}-03-31`);
  }
  return dayjs.utc(`${y}-03-31`);
}

// Replace your existing sumSeries with this version
function sumSeries(series: { date: string; total: number }[], start: Dayjs, end: Dayjs) {
  const s = start.startOf('day');
  const e = end.endOf('day');

  return series.reduce((acc, p) => {
    // Be defensive about incoming format; treat value as UTC date
    const d = dayjs.utc(String(p.date));
    if (!d.isValid()) return acc;

    if ((d.isAfter(s) || d.isSame(s)) && (d.isBefore(e) || d.isSame(e))) {
      acc += Number(p.total) || 0;
    }
    return acc;
  }, 0);
}

// ---------- page ----------
export default function DoctorRevenueAnalyticsPage() {
  const { role, doctorId: myDoctorId } = (useAuth() as any) || {};
  const isAdmin = Array.isArray(role) ? role.includes('admin') || role.includes('owner') : false;

  // Date (defaults to today)
  const [date, setDate] = useState<Dayjs>(dayjs().startOf('day'));

  // Providers (admins only)
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerIds, setProviderIds] = useState<string[]>([]); // selected
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

  const blocking = providersLoading || rowsLoading || loadingAggregates;

  // ---------- load providers for admins ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isAdmin) return;
      try {
        setProvidersLoading(true);
        const list = await fetchPrimaryProviders();
        if (!alive) return;
        const arr = Array.isArray(list)
          ? list
          : Array.isArray((list as any)?.data)
            ? (list as any).data
            : Array.isArray((list as any)?.items)
              ? (list as any).items
              : [];
        setProviders(arr as Provider[]);
        setProviderIds((arr as Provider[]).map((p) => String(p.id))); // default ALL
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
        // Build provider scope
        let providerScope: string[] | undefined;
        if (isAdmin) {
          providerScope = isAllSelected ? undefined : providerIds;
        } else if (myDoctorId) {
          providerScope = [String(myDoctorId)];
        }

        const resp = await fetchRevenueForDay({
          date: toISODate(date),
          providerIds: providerScope,
        });

        if (!alive) return;
        setDayTotal(Number(resp?.total ?? 0));
        const byDoc = Array.isArray(resp?.byDoctor) ? resp.byDoctor : [];
        setRows(
          byDoc.slice().sort((a, b) => Number(b.totalServiceValue) - Number(a.totalServiceValue))
        );
      } catch (e) {
        if (!alive) return;
        console.error('fetchRevenueForDay failed:', e);
        setUnauthorized(true);
        setRows([]);
        setDayTotal(0);
      } finally {
        if (alive) setRowsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [date, isAdmin, myDoctorId, isAllSelected, JSON.stringify(providerIds)]);

  // ---------- derive selected providers + goal sums ----------
  const selectedProviders = useMemo(() => {
    if (!isAdmin) {
      return providers.filter((p) => String(p.id) === String(myDoctorId));
    }
    const ids = isAllSelected ? allProviderIds : providerIds;
    return providers.filter((p) => ids.includes(String(p.id)));
  }, [isAdmin, providers, providerIds, isAllSelected, allProviderIds, myDoctorId]);

  // ---------- derive selected providers + goal sums ----------
  const goalSums = useMemo(() => {
    const bonus = selectedProviders.reduce(
      (s, p: any) => s + safeNum((p as any).bonusRevenueGoal), // full 6-month goal
      0
    );
    const daily = selectedProviders.reduce(
      (s, p: any) => s + safeNum((p as any).dailyRevenueGoal),
      0
    );
    const weekly = bonus / 26; // derived weekly goal
    const monthly = bonus / 6; // derived monthly goal
    return { daily, weekly, monthly, bonus };
  }, [selectedProviders]);

  // ---------- compute Day/WTD/MTD/BTD via one series per doctor ----------
  // ---------- compute Day/WTD/MTD/BTD using series(start→end) ----------
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoadingAggregates(true);

        // doctor IDs in scope
        const selIds: string[] = !isAdmin
          ? myDoctorId
            ? [String(myDoctorId)]
            : []
          : isAllSelected
            ? allProviderIds
            : providerIds;

        if (!selIds.length) {
          if (alive) {
            setSelTotals({ day: 0, wtd: 0, mtd: 0, btd: 0 });
            setCompanyAvgTotals({ day: 0, wtd: 0, mtd: 0, btd: 0 });
          }
          return;
        }

        const bpStart = startOfBonusPeriod(date);
        const today = date;
        const weekStart = date.startOf('week'); // use .startOf('isoWeek') if you prefer ISO weeks
        const monthStart = date.startOf('month');

        // helper to sum within a date window from a series
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

        // one request per doctor with explicit start & end
        const perDoctor = await Promise.all(
          selIds.map(async (id) => {
            const resp = await fetchDoctorRevenueSeries({
              start: bpStart.utc().format('YYYY-MM-DD'),
              end: today.utc().format('YYYY-MM-DD'),
              doctorId: id,
            });
            return { id, series: Array.isArray(resp?.series) ? resp.series : [] };
          })
        );

        if (!alive) return;

        // aggregate across selection
        let daySum = 0,
          wtdSum = 0,
          mtdSum = 0,
          btdSum = 0;
        for (const { series } of perDoctor) {
          daySum += sumWithin(series, today, today);
          wtdSum += sumWithin(series, weekStart, today);
          mtdSum += sumWithin(series, monthStart, today);
          btdSum += sumWithin(series, bpStart, today); // full bonus window
        }
        setSelTotals({ day: daySum, wtd: wtdSum, mtd: mtdSum, btd: btdSum });

        // company average (admins only): per-doctor average across ALL providers
        if (isAdmin && allProviderIds.length > 0) {
          const idsForAvg = allProviderIds;
          // fetch series for any doctors not in the selection (to avoid re-calling)
          const have = new Set(selIds);
          const missing = idsForAvg.filter((id) => !have.has(id));
          const fetchedMissing = await Promise.all(
            missing.map(async (id) => {
              const resp = await fetchDoctorRevenueSeries({
                start: bpStart.utc().format('YYYY-MM-DD'),
                end: today.utc().format('YYYY-MM-DD'),
                doctorId: id,
              });
              return { id, series: Array.isArray(resp?.series) ? resp.series : [] };
            })
          );

          const full = perDoctor.concat(fetchedMissing);
          let cDay = 0,
            cW = 0,
            cM = 0,
            cB = 0;
          for (const { series } of full) {
            cDay += sumWithin(series, today, today);
            cW += sumWithin(series, weekStart, today);
            cM += sumWithin(series, monthStart, today);
            cB += sumWithin(series, bpStart, today);
          }
          const denom = idsForAvg.length || 1;
          setCompanyAvgTotals({
            day: cDay / denom,
            wtd: cW / denom,
            mtd: cM / denom,
            btd: cB / denom,
          });
        } else {
          setCompanyAvgTotals({ day: 0, wtd: 0, mtd: 0, btd: 0 });
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
    myDoctorId,
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

  const metrics = [
    { label: 'Daily revenue goal', value: fmtUSD(goalSums.daily) },
    {
      label: 'Percent of daily goal',
      value: fmtPct(pctOf(selTotals.day, goalSums.daily)),
      sub: `${fmtUSD(selTotals.day)} / ${fmtUSD(goalSums.daily)}`,
    },
    {
      label: 'Total revenue this week',
      value: fmtUSD(selTotals.wtd),
      sub: `${fmtUSD(selTotals.wtd)} / ${fmtUSD(goalSums.weekly)} (weekly goal)`,
    },
    {
      label: 'Percent of weekly goal',
      value: fmtPct(pctOf(selTotals.wtd, goalSums.weekly)),
    },
    {
      label: 'Total revenue this month',
      value: fmtUSD(selTotals.mtd),
      sub: `${fmtUSD(selTotals.mtd)} / ${fmtUSD(goalSums.monthly)} (monthly goal)`,
    },
    {
      label: 'Percent of monthly goal',
      value: fmtPct(pctOf(selTotals.mtd, goalSums.monthly)),
    },
    {
      label: 'Total revenue this bonus period',
      value: fmtUSD(selTotals.btd),
      sub: `Bonus period: ${startOfBonusPeriod(date).format('M/D')}–${endOfBonusPeriod(date).format('M/D')}`,
    },
    {
      label: 'Percent of bonus-period goal',
      value: fmtPct(pctOf(selTotals.btd, goalSums.bonus)),
      sub: `${fmtUSD(selTotals.btd)} / ${fmtUSD(goalSums.bonus)} (6-month goal)`,
    },
  ];

  // Company average goals (per doctor)
  const companyAvgGoals = useMemo(() => {
    if (!isAdmin || allProviderIds.length === 0) {
      return { daily: 0, weekly: 0, monthly: 0 };
    }
    const denom = allProviderIds.length;
    const sums = (providers as any[]).reduce(
      (acc, p) => {
        acc.daily += safeNum(p.dailyRevenueGoal);
        acc.weekly += safeNum(p.bonusRevenueGoal) / 26;
        acc.monthly += safeNum(p.bonusRevenueGoal) / 6;
        return acc;
      },
      { daily: 0, weekly: 0, monthly: 0 }
    );
    return {
      daily: sums.daily / denom,
      weekly: sums.weekly / denom,
      monthly: sums.monthly / denom,
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
          <Alert severity="info">Showing revenue for your production only.</Alert>
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
