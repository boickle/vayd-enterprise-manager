import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import Refresh from '@mui/icons-material/Refresh';
import dayjs from 'dayjs';
import { fetchVeterinarians, type Provider } from '../api/employee';
import {
  fetchAllAppointmentTypes,
  type EmployeeWeeklySchedule,
  type ScheduleOverride,
} from '../api/appointmentSettings';
import { fetchDoctorMonth, type DoctorMonthDay } from '../api/appointments';
import {
  buildAppointmentTypeCatalog,
  type AppointmentTypeCatalog,
} from '../utils/appointmentTypeSettings';
import { monthDayIsTimeOff } from '../utils/doctorTimeOff';
import {
  clearProjectedRevenueFetchCache,
  fetchEmployeeGoalsCached,
  fetchEmployeeWeeklySchedulesCached,
  fetchScheduleOverridesCached,
  PROJECTED_REVENUE_FETCH_CONCURRENCY,
} from '../utils/projectedRevenueFetch';
import { mapPool } from '../utils/asyncTtlCache';
import { useAuth } from '../auth/useAuth';
import { isEmployeeAnalyticsRestricted, normalizeAuthRoles } from '../utils/analyticsAccess';
import {
  actionLabel,
  buildBookingCalendar,
  collectZoneOptions,
  DECISION_LEAD_DAYS,
  doctorsForCapacityCalendar,
  FILL_ON_TRACK_PCT,
  FILL_TRIM_PCT,
  formatFillPct,
  formatGapLabel,
  formatPoints,
  formatZoneChips,
  marketingBannerItems,
  monthsCoveringRange,
  sixWeekWindow,
  summarizeBookingCalendar,
  trimBannerItems,
  WEEKDAY_LABELS,
  type BookingCalendarAction,
  type BookingCalendarDoctorInput,
  type BookingCalendarFillTone,
  type CalendarDayMetrics,
} from '../utils/bookingCalendarMetrics';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function uniqueProviders(list: Provider[]): Provider[] {
  const out: Provider[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    const id = String(p.id ?? '').trim();
    const pims = p.pimsId != null ? String(p.pimsId).trim() : '';
    const keys = [id, pims].filter(Boolean);
    if (!keys.length || keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(p);
  }
  return out;
}

const ALL_DOCTORS = '__all__';
const ALL_ZONES = '__all__';

const TONE_BG: Record<BookingCalendarFillTone, string> = {
  off: 'rgba(0, 0, 0, 0.04)',
  on_track: 'rgba(46, 125, 50, 0.16)',
  watch: 'rgba(237, 108, 2, 0.16)',
  behind: 'rgba(211, 47, 47, 0.16)',
};

const ACTION_COLOR: Record<
  BookingCalendarAction,
  'default' | 'success' | 'warning' | 'error' | 'info'
> = {
  off: 'default',
  on_track: 'success',
  watch: 'warning',
  market: 'info',
  trim: 'error',
};

type DoctorScheduleBase = {
  id: string;
  weeklySchedules: EmployeeWeeklySchedule[];
  scheduleOverridesByDate: Map<string, ScheduleOverride>;
  goalsWorkdayByDate: Map<string, boolean>;
  pointGoalByDate: Map<string, number>;
};

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
        <Typography variant="h5" component="div">
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

function formatShortDate(dateStr: string): string {
  return dayjs(dateStr).format('MMM D');
}

export default function BookingCalendarAnalytics() {
  const range = useMemo(() => sixWeekWindow(dayjs().startOf('day')), []);
  const todayStr = dayjs().startOf('day').format('YYYY-MM-DD');
  const startStr = range.dates[0]!;
  const endStr = range.dates[range.dates.length - 1]!;

  const { role, assignedDoctorIds } = useAuth() as {
    role?: string | string[];
    assignedDoctorIds?: string[];
  };
  const normalizedRoles = normalizeAuthRoles(role);
  const restrictEmployeeAnalytics = isEmployeeAnalyticsRestricted(normalizedRoles);
  const assignedDoctorIdSet = useMemo(
    () => new Set((assignedDoctorIds ?? []).map((x) => String(x).trim()).filter(Boolean)),
    [assignedDoctorIds]
  );

  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersReady, setProvidersReady] = useState(false);
  const [typeCatalog, setTypeCatalog] = useState<AppointmentTypeCatalog | undefined>();
  const [monthDaysByDoctor, setMonthDaysByDoctor] = useState<Record<string, DoctorMonthDay[]>>({});
  const [schedulesBase, setSchedulesBase] = useState<Record<string, DoctorScheduleBase>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doctorFilter, setDoctorFilter] = useState(ALL_DOCTORS);
  const [zoneFilter, setZoneFilter] = useState(ALL_ZONES);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr);
  const [reloadToken, setReloadToken] = useState(0);

  const providersForApi = useMemo(() => {
    if (!restrictEmployeeAnalytics) return providers;
    if (!assignedDoctorIdSet.size) return [];
    return providers.filter((p) => {
      const id = String(p.id ?? '').trim();
      const pims = p.pimsId != null ? String(p.pimsId).trim() : '';
      return (id && assignedDoctorIdSet.has(id)) || (pims && assignedDoctorIdSet.has(pims));
    });
  }, [providers, restrictEmployeeAnalytics, assignedDoctorIdSet]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await fetchVeterinarians();
        if (!alive) return;
        setProviders(uniqueProviders(Array.isArray(result.providers) ? result.providers : []));
      } catch (e) {
        if (!alive) return;
        console.error('fetchVeterinarians failed:', e);
        setError('Failed to load veterinarians');
      } finally {
        if (alive) setProvidersReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false })
      .then((rows) => {
        if (alive) setTypeCatalog(buildAppointmentTypeCatalog(Array.isArray(rows) ? rows : []));
      })
      .catch(() => {
        if (alive) setTypeCatalog(undefined);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!providersReady) return;
    if (!providersForApi.length) {
      setMonthDaysByDoctor({});
      setSchedulesBase({});
      setLoading(false);
      return;
    }

    const doctorIds = providersForApi.map((p) => String(p.id));
    const monthPairs = monthsCoveringRange(startStr, endStr);
    const monthJobs = doctorIds.flatMap((doctorId) =>
      monthPairs.map((pair) => ({ doctorId, ...pair }))
    );

    let alive = true;
    setLoading(true);
    setError(null);
    clearProjectedRevenueFetchCache();

    (async () => {
      try {
        const [pointResults, scheduleResults] = await Promise.all([
          mapPool(
            monthJobs,
            PROJECTED_REVENUE_FETCH_CONCURRENCY,
            async ({ doctorId, year, month }) => {
              const resp = await fetchDoctorMonth(year, month, doctorId);
              return { doctorId, year, month, days: resp?.days ?? [] };
            }
          ),
          mapPool(providersForApi, PROJECTED_REVENUE_FETCH_CONCURRENCY, async (p) => {
            const id = String(p.id);
            const empId = Number(p.id);
            if (!Number.isFinite(empId)) {
              return {
                id,
                weeklySchedules: [] as EmployeeWeeklySchedule[],
                scheduleOverridesByDate: new Map<string, ScheduleOverride>(),
                goalsWorkdayByDate: new Map<string, boolean>(),
                pointGoalByDate: new Map<string, number>(),
              };
            }
            const [weeklySchedules, scheduleOverridesByDate, goals] = await Promise.all([
              fetchEmployeeWeeklySchedulesCached(empId),
              fetchScheduleOverridesCached(empId, range.dates),
              fetchEmployeeGoalsCached(empId, startStr, endStr),
            ]);
            const goalsWorkdayByDate = new Map<string, boolean>();
            const pointGoalByDate = new Map<string, number>();
            for (const item of goals?.dailyGoalBreakdown ?? []) {
              const date = String(item?.date ?? '').slice(0, 10);
              if (!date) continue;
              goalsWorkdayByDate.set(date, Boolean(item.isWorkday));
              pointGoalByDate.set(date, Number(item.dailyPointGoal) || 0);
            }
            return {
              id,
              weeklySchedules,
              scheduleOverridesByDate,
              goalsWorkdayByDate,
              pointGoalByDate,
            };
          }),
        ]);

        if (!alive) return;

        const daysByDoctor: Record<string, DoctorMonthDay[]> = {};
        for (const row of pointResults) {
          if (!daysByDoctor[row.doctorId]) daysByDoctor[row.doctorId] = [];
          daysByDoctor[row.doctorId].push(...(row.days ?? []));
        }
        const schedulesById: Record<string, DoctorScheduleBase> = {};
        for (const s of scheduleResults) {
          schedulesById[s.id] = s;
        }
        setMonthDaysByDoctor(daysByDoctor);
        setSchedulesBase(schedulesById);
      } catch (e) {
        if (!alive) return;
        console.error('Booking calendar fetch failed:', e);
        setError('Failed to load booking calendar data');
        setMonthDaysByDoctor({});
        setSchedulesBase({});
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [providersReady, providersForApi, range.dates, startStr, endStr, reloadToken]);

  const doctorInputs: BookingCalendarDoctorInput[] = useMemo(() => {
    const rows = providersForApi.map((p) => {
      const id = String(p.id);
      const base = schedulesBase[id];
      const monthDaysByDate = new Map<string, DoctorMonthDay>();
      const timeOffDates = new Set<string>();
      for (const day of monthDaysByDoctor[id] ?? []) {
        const date = day?.date?.slice(0, 10);
        if (!date) continue;
        monthDaysByDate.set(date, day);
        if (monthDayIsTimeOff(day)) timeOffDates.add(date);
      }
      return {
        id,
        name: p.name,
        fallbackDailyPointGoal: p.dailyPointGoal,
        weeklySchedules: base?.weeklySchedules ?? [],
        scheduleOverridesByDate: base?.scheduleOverridesByDate ?? new Map(),
        goalsWorkdayByDate: base?.goalsWorkdayByDate ?? new Map(),
        pointGoalByDate: base?.pointGoalByDate ?? new Map(),
        timeOffDates,
        monthDaysByDate,
      };
    });
    return doctorsForCapacityCalendar(rows);
  }, [providersForApi, schedulesBase, monthDaysByDoctor]);

  const zoneOptions = useMemo(() => collectZoneOptions(doctorInputs), [doctorInputs]);

  const days = useMemo(
    () =>
      buildBookingCalendar({
        dates: range.dates,
        today: todayStr,
        doctors: doctorInputs,
        catalog: typeCatalog,
        doctorId: doctorFilter === ALL_DOCTORS ? null : doctorFilter,
        zoneKey: zoneFilter === ALL_ZONES ? null : zoneFilter,
      }),
    [range.dates, todayStr, doctorInputs, typeCatalog, doctorFilter, zoneFilter]
  );

  const daysByDate = useMemo(() => {
    const m = new Map<string, CalendarDayMetrics>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  const kpis = useMemo(() => summarizeBookingCalendar(days), [days]);
  const marketItems = useMemo(() => marketingBannerItems(days), [days]);
  const trimItems = useMemo(() => trimBannerItems(days), [days]);
  const selectedDay = selectedDate ? (daysByDate.get(selectedDate) ?? null) : null;
  const marketingMissingTargets = days.some(
    (d) => d.daysUntil > DECISION_LEAD_DAYS && d.doctorDays > 0 && d.fillPct == null
  );

  useEffect(() => {
    if (
      doctorFilter !== ALL_DOCTORS &&
      !providersForApi.some((p) => String(p.id) === doctorFilter)
    ) {
      setDoctorFilter(ALL_DOCTORS);
    }
  }, [doctorFilter, providersForApi]);

  useEffect(() => {
    if (zoneFilter !== ALL_ZONES && !zoneOptions.some((z) => z.key === zoneFilter)) {
      setZoneFilter(ALL_ZONES);
    }
  }, [zoneFilter, zoneOptions]);

  if (restrictEmployeeAnalytics && !assignedDoctorIdSet.size && providers.length > 0) {
    return (
      <Alert severity="info">
        No providers are assigned to your account, so doctor-day fill is hidden.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6">Booking Calendar</Typography>
        <Typography variant="body2" color="text.secondary">
          Rolling six weeks ({formatShortDate(startStr)}–{formatShortDate(endStr)}). Days 15+ out
          that are under {FILL_ON_TRACK_PCT}% of the 14-day fill target need marketing. Days inside{' '}
          {DECISION_LEAD_DAYS} days under {FILL_TRIM_PCT}% are trim-capacity decisions (decision
          date = visit date minus {DECISION_LEAD_DAYS} days).
        </Typography>
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="booking-cal-doctor">Doctor</InputLabel>
          <Select
            labelId="booking-cal-doctor"
            label="Doctor"
            value={doctorFilter}
            onChange={(e) => setDoctorFilter(String(e.target.value))}
          >
            <MenuItem value={ALL_DOCTORS}>All doctors</MenuItem>
            {providersForApi.map((p) => (
              <MenuItem key={String(p.id)} value={String(p.id)}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="booking-cal-zone">Zone</InputLabel>
          <Select
            labelId="booking-cal-zone"
            label="Zone"
            value={zoneFilter}
            onChange={(e) => setZoneFilter(String(e.target.value))}
          >
            <MenuItem value={ALL_ZONES}>All zones</MenuItem>
            {zoneOptions.map((z) => (
              <MenuItem key={z.key} value={z.key}>
                {z.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tooltip title="Reload appointments from the server">
          <span>
            <IconButton
              aria-label="Reload appointments from the server"
              onClick={() => setReloadToken((n) => n + 1)}
              disabled={loading}
            >
              <Refresh />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {loading ? (
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}
        >
          <CircularProgress size={28} />
          <Typography variant="body2">Loading booking calendar…</Typography>
        </Box>
      ) : (
        <>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                title="Open doctor-days"
                value={kpis.openDoctorDays}
                subtitle="Scheduled workdays in this six-week window"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                title="Appointments booked"
                value={kpis.bookedVisits}
                subtitle={`${formatPoints(kpis.bookedPoints)} pts of ${formatPoints(kpis.targetPoints)} target`}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                title="Marketing-window gap"
                value={`${formatPoints(kpis.marketingWindowGap)} pts`}
                subtitle={`Days ${DECISION_LEAD_DAYS + 1}+ out still below the 14-day target`}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                title="Trim-risk doctor-days"
                value={kpis.trimRiskDoctorDays}
                subtitle={`Next ${DECISION_LEAD_DAYS} days under ${FILL_TRIM_PCT}% fill`}
              />
            </Grid>
          </Grid>

          {marketItems.length > 0 ? (
            <Alert severity="info">
              <Typography variant="subtitle2" gutterBottom>
                Activate marketing
              </Typography>
              <Typography variant="body2" component="div">
                Largest gaps beyond {DECISION_LEAD_DAYS} days:{' '}
                {marketItems
                  .map(
                    (item) =>
                      `${formatShortDate(item.date)} (${formatZoneChips(item.zoneChips) || '—'}, gap ${formatPoints(item.gapPoints)} pts)`
                  )
                  .join('; ')}
                .
              </Typography>
            </Alert>
          ) : marketingMissingTargets ? (
            <Alert severity="info">
              Some days {DECISION_LEAD_DAYS + 1}+ out have open doctor-days but no 14-day point
              target, so a marketing gap cannot be scored yet.
            </Alert>
          ) : (
            <Alert severity="success">
              No marketing push needed — days {DECISION_LEAD_DAYS + 1}+ out are at or above{' '}
              {FILL_ON_TRACK_PCT}% of the 14-day target.
            </Alert>
          )}

          {trimItems.length > 0 ? (
            <Alert severity="warning">
              <Typography variant="subtitle2" gutterBottom>
                Decision date for trimming capacity
              </Typography>
              <Typography variant="body2" component="div">
                {trimItems
                  .map((item) => {
                    const when = item.decisionDatePassed
                      ? 'decision date passed'
                      : `decide by ${formatShortDate(item.decisionDate)}`;
                    return `${item.doctorName} on ${formatShortDate(item.date)} (${formatFillPct(item.fillPct)}, ${when})`;
                  })
                  .join('; ')}
                .
              </Typography>
            </Alert>
          ) : (
            <Alert severity="success">
              No trim decisions in the next {DECISION_LEAD_DAYS} days — doctor-days are at or above{' '}
              {FILL_TRIM_PCT}% fill.
            </Alert>
          )}

          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <LegendSwatch color={TONE_BG.on_track} label={`On track (≥${FILL_ON_TRACK_PCT}%)`} />
            <LegendSwatch
              color={TONE_BG.watch}
              label={`Watch (${FILL_TRIM_PCT}–${FILL_ON_TRACK_PCT - 1}%)`}
            />
            <LegendSwatch color={TONE_BG.behind} label={`Behind (<${FILL_TRIM_PCT}%)`} />
            <LegendSwatch color={TONE_BG.off} label="No doctor-days" />
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 1,
            }}
          >
            {WEEKDAY_LABELS.map((label) => (
              <Typography
                key={label}
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center', fontWeight: 600 }}
              >
                {label}
              </Typography>
            ))}
            {range.weeks.flatMap((week) =>
              week.map((date) => {
                const day = daysByDate.get(date);
                if (!day) return null;
                const selected = selectedDate === date;
                return (
                  <Box
                    key={date}
                    component="button"
                    type="button"
                    aria-label={`${dayjs(date).format('dddd, MMM D')}: ${day.doctorDays} doctor-days, ${day.bookedVisits} booked, ${actionLabel(day.action)}`}
                    aria-pressed={selected}
                    onClick={() => setSelectedDate(date)}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: 0.25,
                      textAlign: 'left',
                      minHeight: 148,
                      p: 1,
                      borderRadius: 1,
                      border: selected ? '2px solid' : '1px solid',
                      borderColor: day.isToday
                        ? 'primary.main'
                        : selected
                          ? 'text.primary'
                          : 'divider',
                      bgcolor: TONE_BG[day.tone],
                      opacity: day.isPast ? 0.72 : 1,
                      cursor: 'pointer',
                      color: 'text.primary',
                      font: 'inherit',
                      '&:hover': { boxShadow: 1 },
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle2" sx={{ lineHeight: 1.2 }}>
                        {dayjs(date).format('D')}
                      </Typography>
                      {day.action !== 'off' ? (
                        <Chip
                          size="small"
                          label={actionLabel(day.action)}
                          color={ACTION_COLOR[day.action]}
                          sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 10 } }}
                        />
                      ) : null}
                    </Stack>
                    {day.doctorDays > 0 ? (
                      <>
                        <Typography variant="caption" sx={{ lineHeight: 1.3 }}>
                          {day.doctorDays} doctor-day{day.doctorDays === 1 ? '' : 's'}
                          {day.zoneChips.length ? ` · ${formatZoneChips(day.zoneChips)}` : ''}
                        </Typography>
                        <Typography variant="caption" sx={{ lineHeight: 1.3 }}>
                          {day.bookedVisits} booked
                        </Typography>
                        <Typography variant="caption" sx={{ lineHeight: 1.3 }}>
                          {formatPoints(day.bookedPoints)} / {formatPoints(day.targetPoints)} pts
                          {day.fillPct != null ? ` (${formatFillPct(day.fillPct)})` : ''}
                        </Typography>
                        <Typography variant="caption" sx={{ lineHeight: 1.3 }}>
                          {formatGapLabel(day.gapPoints)}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {day.bookedVisits > 0 ? `${day.bookedVisits} booked · off` : 'Off'}
                      </Typography>
                    )}
                  </Box>
                );
              })
            )}
          </Box>

          {selectedDay ? (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle1" gutterBottom>
                  {dayjs(selectedDay.date).format('dddd, MMM D')}
                  {selectedDay.isToday ? ' (today)' : ''}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {selectedDay.doctorDays} open doctor-day
                  {selectedDay.doctorDays === 1 ? '' : 's'}
                  {selectedDay.zoneChips.length
                    ? ` · ${formatZoneChips(selectedDay.zoneChips)}`
                    : ''}
                  {' · '}
                  {selectedDay.bookedVisits} appointments booked ·{' '}
                  {formatPoints(selectedDay.bookedPoints)} /{' '}
                  {formatPoints(selectedDay.targetPoints)} pts ({formatFillPct(selectedDay.fillPct)}
                  ){' · '}
                  {formatGapLabel(selectedDay.gapPoints)}
                  {selectedDay.action !== 'off' ? ` · ${actionLabel(selectedDay.action)}` : ''}
                  {selectedDay.doctorDays > 0
                    ? selectedDay.decisionDatePassed
                      ? ' · decision date passed'
                      : ` · decision date ${formatShortDate(selectedDay.decisionDate)}`
                    : ''}
                </Typography>
                {selectedDay.doctors.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No doctors scheduled and nothing booked.
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Doctor</TableCell>
                        <TableCell>Zones</TableCell>
                        <TableCell align="right">Booked</TableCell>
                        <TableCell align="right">Points</TableCell>
                        <TableCell align="right">14-day target</TableCell>
                        <TableCell align="right">Gap</TableCell>
                        <TableCell>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedDay.doctors.map((doc) => (
                        <TableRow key={doc.doctorId}>
                          <TableCell>{doc.doctorName}</TableCell>
                          <TableCell>{formatZoneChips(doc.zones)}</TableCell>
                          <TableCell align="right">{doc.bookedVisits}</TableCell>
                          <TableCell align="right">{formatPoints(doc.bookedPoints)}</TableCell>
                          <TableCell align="right">
                            {doc.working ? formatPoints(doc.targetPoints) : 'Off'}
                          </TableCell>
                          <TableCell align="right">
                            {doc.working ? formatGapLabel(doc.gapPoints) : '—'}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={actionLabel(doc.action)}
                              color={ACTION_COLOR[doc.action]}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </Stack>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box
        sx={{
          width: 14,
          height: 14,
          borderRadius: 0.5,
          bgcolor: color,
          border: '1px solid',
          borderColor: 'divider',
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}
