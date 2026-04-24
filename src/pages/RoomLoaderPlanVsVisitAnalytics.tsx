import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
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
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchRoomLoaderPlanVsVisitReport,
  type PlanVsVisitAppointmentRow,
  type PlanVsVisitDateBasis,
  type PlanVsVisitPerformedLineItem,
  type PlanVsVisitPetRow,
  type PlanVsVisitPlannedMatchLine,
  type PlanVsVisitPlannedMatchesForAppointment,
  type PlanVsVisitReportRow,
} from '../api/roomLoaderPlanVsVisitReport';

const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_LIMIT = 100;

function toLocalDateStr(d: Dayjs) {
  return d.format('YYYY-MM-DD');
}

const PRESETS: Record<string, () => { from: Dayjs; to: Dayjs }> = {
  '7D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(6, 'day'), to: now };
  },
  '30D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(29, 'day'), to: now };
  },
  '90D': () => {
    const now = dayjs().startOf('day');
    return { from: now.subtract(89, 'day'), to: now };
  },
  MTD: () => {
    const now = dayjs().startOf('day');
    return { from: now.startOf('month'), to: now };
  },
};

/**
 * API `matches[]` entries are often `{ planned: {...}, matchedPerformedTreatmentItemId, matchedBy }`.
 * Flatten to `PlanVsVisitPlannedMatchLine` so display and `isPlannedLineMatched` see one shape.
 */
function normalizeMatchEntry(entry: unknown): PlanVsVisitPlannedMatchLine | null {
  if (entry == null || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const planned = e.planned;
  if (planned != null && typeof planned === 'object') {
    const p = planned as Record<string, unknown>;
    return {
      patientId: (p.patientId ?? p.patient_id) as number | null | undefined,
      itemId: (p.itemId ?? p.item_id) as number | null | undefined,
      plannedItemId: (p.plannedItemId ?? p.planned_item_id) as number | null | undefined,
      catalogItemId: (p.catalogItemId ?? p.catalog_id ?? p.catalogId) as number | null | undefined,
      itemType: (p.itemType ?? p.item_type) as string | null | undefined,
      code: p.code != null ? String(p.code) : null,
      name: p.name != null ? String(p.name) : null,
      category: p.category != null ? String(p.category) : null,
      quantity: typeof p.quantity === 'number' ? p.quantity : null,
      matchedPerformedTreatmentItemId:
        (e.matchedPerformedTreatmentItemId ?? e.matched_performed_treatment_item_id) as
          | number
          | string
          | null
          | undefined,
      matchedPerformedItemId: (e.matchedPerformedItemId ?? e.matched_performed_item_id) as
        | number
        | string
        | null
        | undefined,
    };
  }
  return entry as PlanVsVisitPlannedMatchLine;
}

/** New API uses `pets[]`; legacy responses keep flat arrays on the row. */
function getPetsForRow(row: PlanVsVisitReportRow): PlanVsVisitPetRow[] {
  if (Array.isArray(row.pets) && row.pets.length > 0) return row.pets;
  return [
    {
      plannedLineItems: row.plannedLineItems,
      offeredReminders: row.offeredReminders,
      offeredAddedItems: row.offeredAddedItems,
      structuredForm: row.structuredForm,
      appointments: row.appointments,
      plannedMatchesByAppointment: row.plannedMatchesByAppointment,
    },
  ];
}

function rowUsesPerPetModel(row: PlanVsVisitReportRow): boolean {
  return Array.isArray(row.pets) && row.pets.length > 0;
}

function countSummaryLinesForRow(row: PlanVsVisitReportRow): number {
  let n = (row.plannedLineItemsWithoutPatient ?? []).length;
  for (const pet of getPetsForRow(row)) n += pet.plannedLineItems?.length ?? 0;
  return n;
}

function countMatchStatsForRow(row: PlanVsVisitReportRow): { matchLines: number; matched: number } {
  let matchLines = 0;
  let matched = 0;
  for (const pet of getPetsForRow(row)) {
    for (const b of pet.plannedMatchesByAppointment ?? []) {
      const lines = getMatchLinesFromAppointmentBlock(b);
      matchLines += lines.length;
      matched += lines.filter(isPlannedLineMatched).length;
    }
  }
  return { matchLines, matched };
}

function getMatchLinesFromAppointmentBlock(
  block: PlanVsVisitPlannedMatchesForAppointment
): PlanVsVisitPlannedMatchLine[] {
  /** API returns `matches` on plan-vs-visit report. */
  const raw = block.matches ?? block.plannedLines ?? block.lines ?? block.plannedLineMatches ?? [];
  if (!Array.isArray(raw)) return [];
  const out: PlanVsVisitPlannedMatchLine[] = [];
  for (const item of raw) {
    const line = normalizeMatchEntry(item);
    if (line != null) out.push(line);
  }
  return out;
}

function findAppointmentForMatchBlock(
  appointments: PlanVsVisitAppointmentRow[] | undefined,
  block: PlanVsVisitPlannedMatchesForAppointment,
  blockIndex: number
): PlanVsVisitAppointmentRow | undefined {
  const list = appointments ?? [];
  const want = block.appointmentId ?? block.id;
  if (want != null) {
    const hit = list.find((a) => (a.appointmentId ?? a.id) === want);
    if (hit) return hit;
  }
  return list[blockIndex];
}

function asLooseRecord(obj: unknown): Record<string, unknown> {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
}

function pickStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function getNested(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Pull name/code/type from whatever shape the plan-vs-visit API uses on each match row. */
function displayFromMatchLineRecord(r: Record<string, unknown>): {
  name: string | null;
  code: string | null;
  type: string | null;
  category: string | null;
} {
  const name = pickStr(
    r.name,
    r.itemName,
    r.plannedName,
    r.displayName,
    r.description,
    r.title,
    r.label,
    getNested(r, ['item', 'name']),
    getNested(r, ['plannedItem', 'name']),
    getNested(r, ['catalogItem', 'name']),
    getNested(r, ['inventoryItem', 'name']),
    getNested(r, ['lab', 'name']),
    getNested(r, ['procedure', 'name']),
    getNested(r, ['planned_line', 'name']),
    getNested(r, ['plannedLine', 'name'])
  );
  const code = pickStr(
    r.code,
    r.itemCode,
    r.plannedCode,
    r.sku,
    getNested(r, ['item', 'code']),
    getNested(r, ['plannedItem', 'code']),
    getNested(r, ['inventoryItem', 'code']),
    getNested(r, ['lab', 'code']),
    getNested(r, ['procedure', 'code'])
  );
  const type = pickStr(
    r.itemType,
    r.type,
    r.item_type,
    getNested(r, ['item', 'itemType']),
    getNested(r, ['item', 'type']),
    getNested(r, ['plannedItem', 'itemType'])
  );
  const category = pickStr(
    r.category,
    r.itemCategory,
    getNested(r, ['item', 'category']),
    getNested(r, ['inventoryItem', 'categoryName'])
  );
  return { name, code, type, category };
}

function buildPlannedLineItemLookup(row: PlanVsVisitReportRow): Map<string, { name: string; code: string; type: string }> {
  const m = new Map<string, { name: string; code: string; type: string }>();
  const add = (p: { patientId?: number | null; itemId?: number | null; itemType?: string | null; code?: string | null; name?: string | null; category?: string | null }) => {
    if (p.itemId == null) return;
    const key = `${p.patientId ?? ''}:${p.itemId}`;
    m.set(key, {
      name: pickStr(p.name) ?? '—',
      code: pickStr(p.code) ?? '—',
      type: pickStr(p.itemType, p.category) ?? '—',
    });
  };
  for (const pet of getPetsForRow(row)) {
    for (const p of pet.plannedLineItems ?? []) add(p);
  }
  for (const p of row.plannedLineItemsWithoutPatient ?? []) add(p);
  return m;
}

function buildPerformedLineLookup(
  appt: PlanVsVisitAppointmentRow | undefined
): Map<number, PlanVsVisitPerformedLineItem> {
  const m = new Map<number, PlanVsVisitPerformedLineItem>();
  for (const pl of appt?.performedLineItems ?? []) {
    const rec = asLooseRecord(pl);
    const id = Number(
      pl.id ??
        rec.treatmentItemId ??
        rec.treatment_item_id ??
        rec.invoiceItemId ??
        rec.invoice_item_id
    );
    if (!Number.isFinite(id)) continue;
    m.set(id, pl);
  }
  return m;
}

function performedLineDisplayType(p: PlanVsVisitPerformedLineItem): string {
  const rec = asLooseRecord(p);
  const t = pickStr(p.itemType, rec.itemType, rec.type, rec.category);
  if (t) return t;
  if (p.inventoryItemId || rec.inventory_item_id) return 'inventory';
  if (p.labId || rec.lab_id) return 'lab';
  if (p.procedureId || rec.procedure_id) return 'procedure';
  return '—';
}

function getMatchLineDisplay(
  line: PlanVsVisitPlannedMatchLine,
  ctx: {
    plannedByPatientItem: Map<string, { name: string; code: string; type: string }>;
    performedById: Map<number, PlanVsVisitPerformedLineItem>;
  }
): { name: string; code: string; type: string; category: string | null } {
  const r = asLooseRecord(line);
  const base = displayFromMatchLineRecord(r);
  let { name, code, type } = base;
  const { category } = base;

  const pid = r.patientId ?? r.patient_id;
  const itemId = r.itemId ?? r.plannedItemId ?? r.catalogItemId ?? r.item_id ?? r.planned_item_id;
  if (itemId != null) {
    const key = `${pid ?? ''}:${itemId}`;
    const hit = ctx.plannedByPatientItem.get(key);
    if (hit) {
      if (!name && hit.name !== '—') name = hit.name;
      if (!code && hit.code !== '—') code = hit.code;
      if (!type && hit.type !== '—') type = hit.type;
    }
  }

  const matchRaw =
    r.matchedPerformedTreatmentItemId ??
    r.matchedPerformedItemId ??
    r.matched_performed_treatment_item_id;
  const matchId = typeof matchRaw === 'number' ? matchRaw : Number(matchRaw);
  if (Number.isFinite(matchId)) {
    const perf = ctx.performedById.get(matchId);
    if (perf) {
      if (!name) name = pickStr(perf.name);
      if (!code) code = pickStr(perf.code);
      if (!type || type === '—') type = performedLineDisplayType(perf);
    }
  }

  return {
    name: name ?? '—',
    code: code ?? '—',
    type: type ?? '—',
    category,
  };
}

function isPlannedLineMatched(line: PlanVsVisitPlannedMatchLine): boolean {
  const v = line.matchedPerformedTreatmentItemId ?? line.matchedPerformedItemId;
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.trim() !== '' && v.trim() !== '0';
  return Boolean(v);
}

function inferPlanLineKind(
  line: Pick<PlanVsVisitPlannedMatchLine, 'category' | 'name' | 'itemType' | 'code'>
): 'lab' | 'vaccine' | 'other' {
  const parts = [
    (line.category ?? '').toLowerCase(),
    (line.name ?? '').toLowerCase(),
    (line.itemType ?? '').toLowerCase(),
    (line.code ?? '').toLowerCase(),
  ].join(' ');
  if (parts.includes('vaccine') || parts.includes('injection')) return 'vaccine';
  if (
    parts.includes('lab') ||
    parts.includes('fecal') ||
    parts.includes('fil') ||
    parts.includes('4dx') ||
    parts.includes('cbc') ||
    parts.includes('chem') ||
    parts.includes('heartworm') ||
    parts.includes('fiv') ||
    parts.includes('felv') ||
    parts.includes('hw ')
  ) {
    return 'lab';
  }
  return 'other';
}

function aggregateRows(rows: PlanVsVisitReportRow[]) {
  let totalPlanned = 0;
  let totalMatched = 0;
  const byKind = {
    lab: { planned: 0, matched: 0 },
    vaccine: { planned: 0, matched: 0 },
    other: { planned: 0, matched: 0 },
  };
  let rowsWithMatches = 0;

  for (const row of rows) {
    const plannedByPatientItem = buildPlannedLineItemLookup(row);
    let rowHasMatchBlocks = false;
    for (const pet of getPetsForRow(row)) {
      const blocks = pet.plannedMatchesByAppointment ?? [];
      if (blocks.length) rowHasMatchBlocks = true;
      blocks.forEach((block, bi) => {
        const appt = findAppointmentForMatchBlock(pet.appointments, block, bi);
        const performedById = buildPerformedLineLookup(appt);
        const lines = getMatchLinesFromAppointmentBlock(block);
        for (const line of lines) {
          totalPlanned += 1;
          const matched = isPlannedLineMatched(line);
          if (matched) totalMatched += 1;
          const disp = getMatchLineDisplay(line, { plannedByPatientItem, performedById });
          const kind = inferPlanLineKind({
            category: disp.category ?? undefined,
            name: disp.name,
            itemType: disp.type,
            code: disp.code,
          });
          byKind[kind].planned += 1;
          if (matched) byKind[kind].matched += 1;
        }
      });
    }
    if (rowHasMatchBlocks) rowsWithMatches += 1;
  }

  const matchRatePct =
    totalPlanned > 0 ? Math.round((1000 * totalMatched) / totalPlanned) / 10 : null;

  return {
    totalPlanned,
    totalMatched,
    matchRatePct,
    byKind,
    rowsWithMatches,
  };
}

function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography color="text.secondary" variant="body2" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h4" component="div">
          {value}
        </Typography>
        {subtitle ? (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function RoomLoaderPlanVsVisitAnalyticsPage() {
  const [range, setRange] = useState<{ from: Dayjs; to: Dayjs }>(() => PRESETS['30D']());
  const [practiceIdInput, setPracticeIdInput] = useState('1');
  const [timezoneInput, setTimezoneInput] = useState(DEFAULT_TIMEZONE);
  const [dateBasis, setDateBasis] = useState<PlanVsVisitDateBasis>('created');
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchRoomLoaderPlanVsVisitReport>
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  /** Keeps UI pagination in sync with the last successful request. */
  const [activeOffset, setActiveOffset] = useState(0);

  const startStr = toLocalDateStr(range.from.startOf('day'));
  const endStr = toLocalDateStr(range.to.startOf('day'));

  const practiceIdParsed = useMemo(() => {
    const n = Number(practiceIdInput.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [practiceIdInput]);

  const timezoneParam = useMemo(() => {
    const z = timezoneInput.trim();
    if (!z || z === DEFAULT_TIMEZONE) return undefined;
    return z;
  }, [timezoneInput]);

  const fetchPage = useCallback(
    async (pageOffset: number) => {
      if (practiceIdParsed == null) {
        setError('Enter a valid practice ID (positive integer).');
        return;
      }
      const lim = Math.min(500, Math.max(1, limit));
      const off = Math.max(0, pageOffset);
      setLoading(true);
      setError(null);
      try {
        const res = await fetchRoomLoaderPlanVsVisitReport({
          practiceId: practiceIdParsed,
          startDate: startStr,
          endDate: endStr,
          timezone: timezoneParam,
          dateBasis,
          limit: lim,
          offset: off,
        });
        setData(res);
        setActiveOffset(res.meta?.offset ?? off);
      } catch (e: unknown) {
        console.error('Plan vs visit report failed:', e);
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Failed to load report.';
        setError(`${msg} Ensure GET /room-loader/report/plan-vs-visit is deployed.`);
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [practiceIdParsed, startStr, endStr, timezoneParam, dateBasis, limit]
  );

  const agg = useMemo(() => aggregateRows(data?.rows ?? []), [data?.rows]);

  const barChartData = useMemo(
    () => [
      {
        name: 'Labs',
        Matched: agg.byKind.lab.matched,
        Unmatched: Math.max(0, agg.byKind.lab.planned - agg.byKind.lab.matched),
      },
      {
        name: 'Vaccines / inj.',
        Matched: agg.byKind.vaccine.matched,
        Unmatched: Math.max(0, agg.byKind.vaccine.planned - agg.byKind.vaccine.matched),
      },
      {
        name: 'Other',
        Matched: agg.byKind.other.matched,
        Unmatched: Math.max(0, agg.byKind.other.planned - agg.byKind.other.matched),
      },
    ],
    [agg.byKind]
  );

  const totalInRange = data?.meta?.totalInRange ?? 0;
  const pageLen = data?.rows?.length ?? 0;
  const canPrev = activeOffset > 0;
  const canNext = activeOffset + pageLen < totalInRange;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ py: 2, pb: 4 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Room loader plan vs. visit
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Compare items the client had on their room-loader summary to what was actually performed
          on the linked treatment. Filters use the same date semantics as the API (
          <strong>created</strong>, <strong>updated</strong>, or <strong>appointment_start</strong>
          ). Match rates below are computed from the <em>current page</em> of rows; use pagination
          to scan more room loaders.
        </Typography>

        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack spacing={2}>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {Object.keys(PRESETS).map((k) => (
                <Button
                  key={k}
                  size="small"
                  variant="outlined"
                  onClick={() => setRange(PRESETS[k]())}
                >
                  {k}
                </Button>
              ))}
            </Stack>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Practice ID"
                  value={practiceIdInput}
                  onChange={(e) => setPracticeIdInput(e.target.value)}
                  fullWidth
                  size="small"
                  required
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <DatePicker
                  label="Start date"
                  value={range.from}
                  onChange={(v) => v && setRange((r) => ({ ...r, from: v.startOf('day') }))}
                  slotProps={{ textField: { size: 'small', fullWidth: true } }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <DatePicker
                  label="End date"
                  value={range.to}
                  onChange={(v) => v && setRange((r) => ({ ...r, to: v.startOf('day') }))}
                  slotProps={{ textField: { size: 'small', fullWidth: true } }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Timezone (IANA)"
                  value={timezoneInput}
                  onChange={(e) => setTimezoneInput(e.target.value)}
                  fullWidth
                  size="small"
                  placeholder={DEFAULT_TIMEZONE}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel id="rl-pvv-date-basis">Date basis</InputLabel>
                  <Select
                    labelId="rl-pvv-date-basis"
                    label="Date basis"
                    value={dateBasis}
                    onChange={(e) => setDateBasis(e.target.value as PlanVsVisitDateBasis)}
                  >
                    <MenuItem value="created">created</MenuItem>
                    <MenuItem value="updated">updated</MenuItem>
                    <MenuItem value="appointment_start">appointment_start</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Page size (max 500)"
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value) || DEFAULT_LIMIT)}
                  fullWidth
                  size="small"
                  inputProps={{ min: 1, max: 500 }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={6} display="flex" alignItems="center" gap={1}>
                <Button
                  variant="contained"
                  onClick={() => void fetchPage(0)}
                  disabled={loading || practiceIdParsed == null}
                >
                  {loading ? <CircularProgress size={22} color="inherit" /> : 'Load report'}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {startStr} → {endStr}
                </Typography>
              </Grid>
            </Grid>
          </Stack>
        </Paper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {data != null && (
          <>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <KpiCard
                  title="Room loaders in range"
                  value={totalInRange}
                  subtitle="API total (all pages)"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <KpiCard
                  title="Loaded on this page"
                  value={pageLen}
                  subtitle={`offset ${data.meta?.offset ?? activeOffset}, limit ${data.meta?.limit ?? limit}`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <KpiCard
                  title="Planned lines (matches block)"
                  value={agg.totalPlanned}
                  subtitle={`${agg.rowsWithMatches} RL rows had match data`}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <KpiCard
                  title="Performed match rate"
                  value={agg.matchRatePct != null ? `${agg.matchRatePct}%` : '—'}
                  subtitle={
                    agg.totalPlanned
                      ? `${agg.totalMatched} matched / ${agg.totalPlanned - agg.totalMatched} unmatched`
                      : 'No planned match lines on this page'
                  }
                />
              </Grid>
            </Grid>

            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Heuristic categories (lab vs vaccine) use name, code, category, and item type text.
            </Typography>
            <Box sx={{ width: '100%', height: 320, mb: 3 }}>
              <ResponsiveContainer>
                <BarChart data={barChartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Matched" stackId="a" fill="#2e7d32" name="Matched" />
                  <Bar dataKey="Unmatched" stackId="a" fill="#c62828" name="Unmatched" />
                </BarChart>
              </ResponsiveContainer>
            </Box>

            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle1">Room loaders</Typography>
              <Stack direction="row" alignItems="center" spacing={1}>
                <IconButton
                  size="small"
                  aria-label="Previous page"
                  disabled={!canPrev || loading}
                  onClick={() => void fetchPage(Math.max(0, activeOffset - limit))}
                >
                  <ChevronLeft />
                </IconButton>
                <Typography variant="body2" color="text.secondary">
                  {pageLen === 0 ? 0 : activeOffset + 1}–{activeOffset + pageLen} of {totalInRange}
                </Typography>
                <IconButton
                  size="small"
                  aria-label="Next page"
                  disabled={!canNext || loading}
                  onClick={() => void fetchPage(activeOffset + limit)}
                >
                  <ChevronRight />
                </IconButton>
              </Stack>
            </Stack>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell width={48} />
                    <TableCell>RL ID</TableCell>
                    <TableCell>PIMS ID</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Summary lines</TableCell>
                    <TableCell align="right">Match lines</TableCell>
                    <TableCell align="right">Matched</TableCell>
                    <TableCell>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(data.rows ?? []).map((row) => {
                    const { matchLines, matched } = countMatchStatsForRow(row);
                    const summaryCount = countSummaryLinesForRow(row);
                    const isOpen = expandedId === row.roomLoaderId;
                    const perPet = rowUsesPerPetModel(row);
                    return (
                      <React.Fragment key={row.roomLoaderId}>
                        <TableRow hover>
                          <TableCell>
                            <IconButton
                              size="small"
                              aria-expanded={isOpen}
                              onClick={() => setExpandedId(isOpen ? null : row.roomLoaderId)}
                            >
                              {isOpen ? <ExpandLess /> : <ExpandMore />}
                            </IconButton>
                          </TableCell>
                          <TableCell>{row.roomLoaderId}</TableCell>
                          <TableCell>{row.roomLoaderPimsId ?? '—'}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                              <Chip size="small" label={row.sentStatus ?? '—'} variant="outlined" />
                              {row.hasResponseFromClient ? (
                                <Chip
                                  size="small"
                                  label="client"
                                  color="success"
                                  variant="outlined"
                                />
                              ) : null}
                              {row.hasSavedForm ? (
                                <Chip size="small" label="saved" variant="outlined" />
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell align="right">{summaryCount}</TableCell>
                          <TableCell align="right">{matchLines}</TableCell>
                          <TableCell align="right">
                            {matchLines
                              ? `${matched} (${Math.round((1000 * matched) / matchLines) / 10}%)`
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {row.created ? dayjs(row.created).format('MMM D, YYYY h:mm a') : '—'}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            sx={{ py: 0, borderBottom: isOpen ? undefined : 'none' }}
                          >
                            <Collapse in={isOpen} timeout="auto" unmountOnExit>
                              <Box sx={{ py: 2, px: 1 }}>
                                <Typography variant="subtitle2" gutterBottom>
                                  Planned summary items ({summaryCount})
                                  {perPet ? ' · grouped by pet' : null}
                                </Typography>

                                {(() => {
                                  const plannedByPatientItem = buildPlannedLineItemLookup(row);
                                  return getPetsForRow(row).map((pet, pi) => {
                                    const planned = pet.plannedLineItems ?? [];
                                    const blocks = pet.plannedMatchesByAppointment ?? [];
                                    return (
                                      <Box
                                        key={`${row.roomLoaderId}-pet-${pi}`}
                                        sx={{ mb: 2, pl: perPet ? 1 : 0, borderLeft: perPet ? 2 : 0, borderColor: 'divider', borderLeftStyle: 'solid' }}
                                      >
                                        {perPet ? (
                                          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                                            {pickStr(pet.patientName)
                                              ? `${pickStr(pet.patientName)} (#${pet.patientId ?? '?'})`
                                              : `Patient #${pet.patientId ?? '?'}`}
                                          </Typography>
                                        ) : null}

                                        {planned.length === 0 ? (
                                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                            No planned line items for this bucket
                                          </Typography>
                                        ) : (
                                          <Table size="small" sx={{ mb: 2 }}>
                                            <TableHead>
                                              <TableRow>
                                                <TableCell>Name</TableCell>
                                                <TableCell>Code</TableCell>
                                                <TableCell>Type</TableCell>
                                                <TableCell>Qty</TableCell>
                                                <TableCell>Source</TableCell>
                                              </TableRow>
                                            </TableHead>
                                            <TableBody>
                                              {planned.map((p, i) => (
                                                <TableRow key={`${row.roomLoaderId}-pet-${pi}-p-${i}`}>
                                                  <TableCell>{p.name ?? '—'}</TableCell>
                                                  <TableCell>{p.code ?? '—'}</TableCell>
                                                  <TableCell>{p.itemType ?? '—'}</TableCell>
                                                  <TableCell>{p.quantity ?? '—'}</TableCell>
                                                  <TableCell>{p.source ?? '—'}</TableCell>
                                                </TableRow>
                                              ))}
                                            </TableBody>
                                          </Table>
                                        )}

                                        <Typography variant="subtitle2" gutterBottom>
                                          Planned ↔ performed (by appointment)
                                        </Typography>
                                        {blocks.length === 0 ? (
                                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                            No plannedMatchesByAppointment entries
                                          </Typography>
                                        ) : (
                                          blocks.map((block, bi) => {
                                            const lines = getMatchLinesFromAppointmentBlock(block);
                                            const appt = findAppointmentForMatchBlock(
                                              pet.appointments,
                                              block,
                                              bi
                                            );
                                            const performedById = buildPerformedLineLookup(appt);
                                            const apptId =
                                              block.appointmentId ??
                                              block.id ??
                                              appt?.appointmentId ??
                                              appt?.id ??
                                              '—';
                                            const performedN = appt?.performedLineItems?.length ?? 0;
                                            const apptWhen = appt?.appointmentStart ?? appt?.start;
                                            return (
                                              <Box key={`${row.roomLoaderId}-pet-${pi}-b-${bi}`} sx={{ mb: 2 }}>
                                                <Typography variant="body2" sx={{ mb: 0.5 }}>
                                                  Appointment <strong>{String(apptId)}</strong>
                                                  {appt?.patientName ? (
                                                    <>
                                                      {' '}
                                                      · <strong>{appt.patientName}</strong>
                                                    </>
                                                  ) : null}
                                                  {apptWhen ? (
                                                    <> · {dayjs(apptWhen).format('MMM D, YYYY h:mm a')}</>
                                                  ) : null}
                                                  {' — '}
                                                  {lines.length} planned line(s), {performedN}{' '}
                                                  performed line(s)
                                                  {appt?.isComplete === false ? ' · visit not complete' : ''}
                                                </Typography>
                                                <Table size="small">
                                                  <TableHead>
                                                    <TableRow>
                                                      <TableCell>Matched</TableCell>
                                                      <TableCell>Name</TableCell>
                                                      <TableCell>Code</TableCell>
                                                      <TableCell>Type</TableCell>
                                                      <TableCell>Match id</TableCell>
                                                    </TableRow>
                                                  </TableHead>
                                                  <TableBody>
                                                    {lines.map((line, li) => {
                                                      const disp = getMatchLineDisplay(line, {
                                                        plannedByPatientItem,
                                                        performedById,
                                                      });
                                                      return (
                                                        <TableRow
                                                          key={`${row.roomLoaderId}-pet-${pi}-b-${bi}-l-${li}`}
                                                        >
                                                          <TableCell>
                                                            {isPlannedLineMatched(line) ? (
                                                              <Chip
                                                                label="Yes"
                                                                size="small"
                                                                color="success"
                                                              />
                                                            ) : (
                                                              <Chip
                                                                label="No"
                                                                size="small"
                                                                variant="outlined"
                                                              />
                                                            )}
                                                          </TableCell>
                                                          <TableCell>{disp.name}</TableCell>
                                                          <TableCell>{disp.code}</TableCell>
                                                          <TableCell>{disp.type}</TableCell>
                                                          <TableCell>
                                                            {String(
                                                              line.matchedPerformedTreatmentItemId ??
                                                                line.matchedPerformedItemId ??
                                                                '—'
                                                            )}
                                                          </TableCell>
                                                        </TableRow>
                                                      );
                                                    })}
                                                  </TableBody>
                                                </Table>
                                              </Box>
                                            );
                                          })
                                        )}

                                        <Typography variant="subtitle2" sx={{ mt: 1 }} gutterBottom>
                                          Staff offered (reminders / add-ons)
                                        </Typography>
                                        <Typography
                                          variant="caption"
                                          color="text.secondary"
                                          display="block"
                                          sx={{ mb: 0.5 }}
                                        >
                                          Reminders: {(pet.offeredReminders ?? []).length} · Added items:{' '}
                                          {(pet.offeredAddedItems ?? []).length}
                                        </Typography>

                                        {pet.structuredForm &&
                                        Object.keys(pet.structuredForm).length > 0 ? (
                                          <>
                                            <Typography variant="subtitle2" sx={{ mt: 1 }} gutterBottom>
                                              Structured form (labSelections / optedInVaccineItems)
                                            </Typography>
                                            <Box
                                              component="pre"
                                              sx={{
                                                m: 0,
                                                p: 1,
                                                bgcolor: 'action.hover',
                                                borderRadius: 1,
                                                fontSize: 11,
                                                maxHeight: 200,
                                                overflow: 'auto',
                                              }}
                                            >
                                              {JSON.stringify(pet.structuredForm, null, 2)}
                                            </Box>
                                          </>
                                        ) : null}
                                      </Box>
                                    );
                                  });
                                })()}

                                {(row.plannedLineItemsWithoutPatient ?? []).length > 0 ||
                                (row.offeredRemindersWithoutPatient ?? []).length > 0 ||
                                (row.offeredAddedItemsWithoutPatient ?? []).length > 0 ? (
                                  <Box sx={{ mt: 2 }}>
                                    <Typography variant="subtitle2" gutterBottom>
                                      No patient (room-level items)
                                    </Typography>
                                    {(row.plannedLineItemsWithoutPatient ?? []).length > 0 ? (
                                      <Table size="small" sx={{ mb: 1 }}>
                                        <TableHead>
                                          <TableRow>
                                            <TableCell>Name</TableCell>
                                            <TableCell>Code</TableCell>
                                            <TableCell>Type</TableCell>
                                            <TableCell>Qty</TableCell>
                                          </TableRow>
                                        </TableHead>
                                        <TableBody>
                                          {(row.plannedLineItemsWithoutPatient ?? []).map((p, i) => (
                                            <TableRow key={`${row.roomLoaderId}-wo-${i}`}>
                                              <TableCell>{p.name ?? '—'}</TableCell>
                                              <TableCell>{p.code ?? '—'}</TableCell>
                                              <TableCell>{p.itemType ?? '—'}</TableCell>
                                              <TableCell>{p.quantity ?? '—'}</TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    ) : null}
                                    <Typography variant="caption" color="text.secondary" display="block">
                                      Reminders (no patient):{' '}
                                      {(row.offeredRemindersWithoutPatient ?? []).length} · Added (no patient):{' '}
                                      {(row.offeredAddedItemsWithoutPatient ?? []).length}
                                    </Typography>
                                  </Box>
                                ) : null}
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        {!data && !loading && !error && (
          <Typography variant="body2" color="text.secondary">
            Set filters and click <strong>Load report</strong>.
          </Typography>
        )}
      </Box>
    </LocalizationProvider>
  );
}
