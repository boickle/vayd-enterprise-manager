/**
 * CL Performance analytics — composes appointment bookings, OpenPhone calls,
 * and fill-day usage into per–Client Liaison points using the CL Points System guide.
 */
import { fetchAppointmentBookingsAnalytics } from './appointmentBookingsAnalytics';
import {
  fetchEmployeeRoles,
  fetchEmployeesByRole,
  type Employee,
  type EmployeeRole,
} from './appointmentSettings';
import { fetchFillDayUsage } from './fillDayUsage';
import {
  fetchOpenPhoneCallSummary,
  type OpenPhoneCallTotals,
  type OpenPhoneEmployeeSummary,
} from './openphoneCalls';
import {
  computeClSeatParForRange,
  fetchClSeatAssignmentsRange,
  fetchClSeatDayOverrides,
  fetchClSeatPar,
  sundayWeekStartLocal,
  type ClSeatDayOverride,
  type ClSeatParSettings,
} from './clSeatAssignments';
import {
  CL_POINT_VALUES,
  CL_SEAT_LABELS,
  normalizedClScore,
  scoreClBooking,
  scoreClCalls,
  sumClCategoryTotals,
  type ClPointsCategoryTotals,
  type ClSeat,
} from '../utils/clPoints';
import { formatEmployeeDisplayName } from '../utils/employeeDisplayName';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type ClPerformanceCategoryTotals = ClPointsCategoryTotals;

export type ClPerformanceLiaison = {
  employeeId: number;
  fullName: string;
  email: string;
  totalPoints: number;
  priorTotalPoints: number | null;
  /** (current − prior) / |prior| when prior exists and ≠ 0. */
  improvementRate: number | null;
  /** Seat for the primary week (majority of days in range after overrides); null if unassigned. */
  seat: ClSeat | null;
  seatLabel: string | null;
  /** Prorated par for the date range (day offs reduce; seat swaps use that day's seat par). */
  par: number | null;
  /** points ÷ par; 1.0 = on target. */
  normalizedScore: number | null;
  /** Number of calendar days in range with a day override (off or seat change). */
  seatOverrideDayCount: number;
  categories: ClPerformanceCategoryTotals;
  counts: {
    bookings: number;
    bookingsWithin7Days: number;
    bookingsWithin14Days: number;
    bookingsBase: number;
    newPatientBookings: number;
    answeredInboundCalls: number;
    outboundCalls: number;
    missedInHoursCalls: number;
    outreachContacts: number;
  };
};

export type ClPerformanceAnalyticsResponse = {
  startDate: string;
  endDate: string;
  priorStartDate: string | null;
  priorEndDate: string | null;
  primaryWeekStart: string;
  weekCount: number;
  seatPar: ClSeatParSettings;
  scoredCategories: string[];
  unscoredNote: string;
  liaisons: ClPerformanceLiaison[];
  teamTotals: {
    totalPoints: number;
    bookings: number;
    calls: number;
    outreach: number;
    penalties: number;
  };
};

function findReceptionistRoleId(roles: EmployeeRole[]): number | null {
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const byName = roles.find((r) => norm(r.name) === 'receptionist');
  if (byName) return byName.id;
  const byValue = roles.find((r) => norm(r.roleValue) === 'receptionist');
  if (byValue) return byValue.id;
  const fuzzy = roles.find((r) => norm(r.name).includes('receptionist'));
  return fuzzy?.id ?? null;
}

async function fetchReceptionistEmployees(): Promise<Employee[]> {
  const roles = await fetchEmployeeRoles();
  const roleId = findReceptionistRoleId(roles);
  if (roleId == null) return [];
  const emps = await fetchEmployeesByRole(roleId);
  return emps
    .filter((e) => e && !e.isDeleted && e.isActive !== false)
    .sort((a, b) => {
      const la = formatEmployeeDisplayName(a).toLowerCase();
      const lb = formatEmployeeDisplayName(b).toLowerCase();
      return la.localeCompare(lb);
    });
}

function normEmail(e: string | null | undefined): string {
  return String(e ?? '')
    .trim()
    .toLowerCase();
}

function emptyCategories(): ClPointsCategoryTotals {
  return {
    bookings: 0,
    newPatientBonus: 0,
    calls: 0,
    outreach: 0,
    penalties: 0,
    other: 0,
  };
}

function emptyCounts(): ClPerformanceLiaison['counts'] {
  return {
    bookings: 0,
    bookingsWithin7Days: 0,
    bookingsWithin14Days: 0,
    bookingsBase: 0,
    newPatientBookings: 0,
    answeredInboundCalls: 0,
    outboundCalls: 0,
    missedInHoursCalls: 0,
    outreachContacts: 0,
  };
}

function scoreBookingsForEmail(
  userEmail: string,
  bookingsUsers: Awaited<ReturnType<typeof fetchAppointmentBookingsAnalytics>>['users']
): { categories: ClPointsCategoryTotals; counts: Pick<
  ClPerformanceLiaison['counts'],
  | 'bookings'
  | 'bookingsWithin7Days'
  | 'bookingsWithin14Days'
  | 'bookingsBase'
  | 'newPatientBookings'
> } {
  const categories = emptyCategories();
  const counts = {
    bookings: 0,
    bookingsWithin7Days: 0,
    bookingsWithin14Days: 0,
    bookingsBase: 0,
    newPatientBookings: 0,
  };
  const email = normEmail(userEmail);
  const user = bookingsUsers.find((u) => normEmail(u.userEmail) === email);
  if (!user) return { categories, counts };

  for (const day of user.bookingsByDay ?? []) {
    const details = day.bookings ?? [];
    if (details.length > 0) {
      for (const b of details) {
        const scored = scoreClBooking({
          bookedAt: b.bookedAt,
          appointmentStart: b.appointmentStart,
          newPatient: b.newPatient,
        });
        categories.bookings += scored.bookingPoints;
        categories.newPatientBonus += scored.newPatientBonusPoints;
        counts.bookings += 1;
        if (scored.tier === 'within7') counts.bookingsWithin7Days += 1;
        else if (scored.tier === 'within14') counts.bookingsWithin14Days += 1;
        else counts.bookingsBase += 1;
        if (b.newPatient) counts.newPatientBookings += 1;
      }
    } else {
      // Fallback when API omits booking details: base + new-patient bonus only.
      const existing = day.existingPatientBooked ?? 0;
      const neu = day.newPatientBooked ?? 0;
      categories.bookings += (existing + neu) * CL_POINT_VALUES.bookingBase;
      categories.newPatientBonus += neu * CL_POINT_VALUES.newPatientBonus;
      counts.bookings += existing + neu;
      counts.bookingsBase += existing + neu;
      counts.newPatientBookings += neu;
    }
  }
  return { categories, counts };
}

function scoreCallsForEmployee(
  employeeId: number,
  employees: OpenPhoneEmployeeSummary[]
): {
  categories: Pick<ClPointsCategoryTotals, 'calls' | 'penalties'>;
  counts: Pick<
    ClPerformanceLiaison['counts'],
    'answeredInboundCalls' | 'outboundCalls' | 'missedInHoursCalls'
  >;
} {
  const emp = employees.find((e) => e.employeeId === employeeId);
  const totals: OpenPhoneCallTotals = emp?.totals ?? {
    incomingCalls: 0,
    missedIncomingCallsTotal: 0,
    missedIncomingDuringBusinessHours: 0,
    missedIncomingOutsideBusinessHours: 0,
    outgoingCalls: 0,
    totalCalls: 0,
    incomingMessages: 0,
    outgoingMessages: 0,
    totalMessages: 0,
  };
  const scored = scoreClCalls(totals);
  return {
    categories: {
      calls: scored.inboundAnsweredPoints + scored.outboundCallPoints,
      penalties: scored.missedInHoursPenalty,
    },
    counts: {
      answeredInboundCalls: scored.answeredInboundCount,
      outboundCalls: totals.outgoingCalls ?? 0,
      missedInHoursCalls: totals.missedIncomingDuringBusinessHours ?? 0,
    },
  };
}

function scoreOutreachForEmail(
  userEmail: string,
  fillDayUsers: Awaited<ReturnType<typeof fetchFillDayUsage>>['users']
): { outreachPoints: number; outreachContacts: number } {
  const email = normEmail(userEmail);
  const user = fillDayUsers.find((u) => normEmail(u.userEmail) === email);
  const outreachContacts = user?.totalRequests ?? 0;
  return {
    outreachPoints: outreachContacts * CL_POINT_VALUES.outreachContactWorked,
    outreachContacts,
  };
}

function toIsoRangeStart(dateStr: string): string {
  // Local calendar day start with offset (matches OpenPhone analytics).
  const d = new Date(`${dateStr}T00:00:00`);
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${dateStr}T00:00:00.000${sign}${oh}${om}`;
}

function toIsoRangeEnd(dateStr: string): string {
  const endOfDay = new Date(`${dateStr}T23:59:59.999`);
  const now = new Date();
  const cap = endOfDay.getTime() > now.getTime() ? now : endOfDay;
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = cap.getFullYear();
  const m = pad(cap.getMonth() + 1);
  const day = pad(cap.getDate());
  const h = pad(cap.getHours());
  const min = pad(cap.getMinutes());
  const s = pad(cap.getSeconds());
  const ms = String(cap.getMilliseconds()).padStart(3, '0');
  const off = -cap.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${y}-${m}-${day}T${h}:${min}:${s}.${ms}${sign}${oh}${om}`;
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function inclusiveDayCount(startDate: string, endDate: string): number {
  const a = new Date(`${startDate}T12:00:00`).getTime();
  const b = new Date(`${endDate}T12:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1);
}

function priorRange(
  startDate: string,
  endDate: string
): { priorStartDate: string; priorEndDate: string } {
  const days = inclusiveDayCount(startDate, endDate);
  const priorEndDate = addDaysIso(startDate, -1);
  const priorStartDate = addDaysIso(priorEndDate, -(days - 1));
  return { priorStartDate, priorEndDate };
}

type PeriodInputs = {
  bookingsUsers: Awaited<ReturnType<typeof fetchAppointmentBookingsAnalytics>>['users'];
  openPhoneEmployees: OpenPhoneEmployeeSummary[];
  fillDayUsers: Awaited<ReturnType<typeof fetchFillDayUsage>>['users'];
};

function scoreLiaisonPeriod(emp: Employee, inputs: PeriodInputs): {
  categories: ClPointsCategoryTotals;
  counts: ClPerformanceLiaison['counts'];
  totalPoints: number;
} {
  const email = emp.email ?? '';
  const book = scoreBookingsForEmail(email, inputs.bookingsUsers);
  const calls = scoreCallsForEmployee(emp.id, inputs.openPhoneEmployees);
  const outreach = scoreOutreachForEmail(email, inputs.fillDayUsers);

  const categories: ClPointsCategoryTotals = {
    bookings: book.categories.bookings,
    newPatientBonus: book.categories.newPatientBonus,
    calls: calls.categories.calls,
    outreach: outreach.outreachPoints,
    penalties: calls.categories.penalties,
    other: 0,
  };
  const counts: ClPerformanceLiaison['counts'] = {
    ...emptyCounts(),
    ...book.counts,
    ...calls.counts,
    outreachContacts: outreach.outreachContacts,
  };
  return {
    categories,
    counts,
    totalPoints: sumClCategoryTotals(categories),
  };
}

async function loadPeriodInputs(startDate: string, endDate: string): Promise<PeriodInputs> {
  const [bookings, openPhone, fillDay] = await Promise.all([
    fetchAppointmentBookingsAnalytics({ startDate, endDate }),
    fetchOpenPhoneCallSummary({
      from: toIsoRangeStart(startDate),
      to: toIsoRangeEnd(endDate),
    }),
    fetchFillDayUsage({ startDate, endDate }),
  ]);
  return {
    bookingsUsers: bookings.users ?? [],
    openPhoneEmployees: openPhone.employees ?? openPhone.receptionists ?? [],
    fillDayUsers: fillDay.users ?? [],
  };
}

/**
 * Build CL Performance leaderboard for [startDate, endDate] (inclusive YYYY-MM-DD).
 * Also loads the immediately preceding equal-length window for improvement %.
 * Seat + normalized score use Settings → CL Seat Assignment for weeks in range.
 */
export async function fetchClPerformanceAnalytics(params: {
  startDate: string;
  endDate: string;
  practiceId?: number;
}): Promise<ClPerformanceAnalyticsResponse> {
  const { startDate, endDate } = params;
  const practiceId = params.practiceId ?? DEFAULT_PRACTICE_ID;
  const { priorStartDate, priorEndDate } = priorRange(startDate, endDate);
  const primaryWeekStart = sundayWeekStartLocal(startDate);
  const endWeekStart = sundayWeekStartLocal(endDate);
  const weekCount = Math.max(
    1,
    Math.round(
      (new Date(`${endWeekStart}T12:00:00`).getTime() -
        new Date(`${primaryWeekStart}T12:00:00`).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    ) + 1
  );

  const [receptionists, current, prior, seatPar, seatAssignments, dayOverrides] =
    await Promise.all([
      fetchReceptionistEmployees(),
      loadPeriodInputs(startDate, endDate),
      loadPeriodInputs(priorStartDate, priorEndDate).catch(() => null),
      fetchClSeatPar(practiceId).catch(() => null),
      fetchClSeatAssignmentsRange(practiceId, primaryWeekStart, endWeekStart).catch(
        () => null
      ),
      fetchClSeatDayOverrides(practiceId).catch(() => [] as ClSeatDayOverride[]),
    ]);

  const parMap = seatPar ?? {
    phones: 80,
    outreach: 140,
    email: 100,
  };

  /** employeeId → weekStart → seat */
  const weeklySeatByEmployee = new Map<number, Map<string, ClSeat>>();
  for (const row of seatAssignments?.assignments ?? []) {
    let byWeek = weeklySeatByEmployee.get(row.employeeId);
    if (!byWeek) {
      byWeek = new Map();
      weeklySeatByEmployee.set(row.employeeId, byWeek);
    }
    byWeek.set(sundayWeekStartLocal(row.weekStart), row.seat);
  }

  /** employeeId → date → override */
  const overridesByEmployee = new Map<number, Map<string, ClSeatDayOverride>>();
  for (const o of dayOverrides ?? []) {
    if (o.date < startDate || o.date > endDate) continue;
    let byDate = overridesByEmployee.get(o.employeeId);
    if (!byDate) {
      byDate = new Map();
      overridesByEmployee.set(o.employeeId, byDate);
    }
    byDate.set(o.date, o);
  }

  const liaisons: ClPerformanceLiaison[] = receptionists.map((emp) => {
    const cur = scoreLiaisonPeriod(emp, current);
    const prev = prior ? scoreLiaisonPeriod(emp, prior) : null;
    const priorTotalPoints = prev?.totalPoints ?? null;
    let improvementRate: number | null = null;
    if (priorTotalPoints != null && priorTotalPoints !== 0) {
      improvementRate = (cur.totalPoints - priorTotalPoints) / Math.abs(priorTotalPoints);
    } else if (priorTotalPoints === 0 && cur.totalPoints > 0) {
      improvementRate = 1;
    }

    const weeklyMap: Map<string, ClSeat | null> = new Map(
      [...(weeklySeatByEmployee.get(emp.id) ?? new Map()).entries()]
    );
    const {
      par,
      primarySeat: seat,
      overrideDayCount,
    } = computeClSeatParForRange({
      startDate,
      endDate,
      weeklySeatByWeekStart: weeklyMap,
      overridesByDate: overridesByEmployee.get(emp.id) ?? new Map(),
      seatPar: parMap,
    });
    const score = par != null ? normalizedClScore(cur.totalPoints, par) : null;

    return {
      employeeId: emp.id,
      fullName: formatEmployeeDisplayName(emp) || emp.email || `Employee #${emp.id}`,
      email: emp.email ?? '',
      totalPoints: cur.totalPoints,
      priorTotalPoints,
      improvementRate,
      seat,
      seatLabel: seat ? CL_SEAT_LABELS[seat] : null,
      par,
      normalizedScore: score,
      seatOverrideDayCount: overrideDayCount,
      categories: cur.categories,
      counts: cur.counts,
    };
  });

  liaisons.sort((a, b) => {
    const aScore = a.normalizedScore;
    const bScore = b.normalizedScore;
    if (aScore != null && bScore != null) {
      const d = bScore - aScore;
      if (d !== 0) return d;
    } else if (aScore != null) return -1;
    else if (bScore != null) return 1;
    const dPts = b.totalPoints - a.totalPoints;
    if (dPts !== 0) return dPts;
    return a.fullName.localeCompare(b.fullName);
  });

  const teamTotals = liaisons.reduce(
    (acc, l) => {
      acc.totalPoints += l.totalPoints;
      acc.bookings += l.categories.bookings + l.categories.newPatientBonus;
      acc.calls += l.categories.calls;
      acc.outreach += l.categories.outreach;
      acc.penalties += l.categories.penalties;
      return acc;
    },
    { totalPoints: 0, bookings: 0, calls: 0, outreach: 0, penalties: 0 }
  );

  return {
    startDate,
    endDate,
    priorStartDate: prior ? priorStartDate : null,
    priorEndDate: prior ? priorEndDate : null,
    primaryWeekStart,
    weekCount,
    seatPar: parMap,
    scoredCategories: [
      'Appointment bookings (lead-time tiers + new-patient bonus)',
      'Inbound calls answered & outbound calls (OpenPhone)',
      'Missed in-hours call penalties (OpenPhone)',
      'Fill Day / schedule-loader contacts worked',
      'Seat assignment + par normalization (Settings → CL Seat Assignment)',
    ],
    unscoredNote:
      'Not yet scored automatically: memberships, direct-booking review, voicemail timing, text/email thread resolution, holds aging, and complaints. Assign seats under Settings → CL Seat Assignment to unlock normalized scores.',
    liaisons,
    teamTotals,
  };
}
