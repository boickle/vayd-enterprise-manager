import { DateTime } from 'luxon';
import type { DayData } from '../../pages/MyWeek';
import { resolveArrivalWindowIsos } from '../../utils/appointmentRoutedArrivalWindow';
import { buildEditVisitTimePreview } from '../../utils/editVisitTimePreview';
import { fetchSchedulerDriveContextForDate } from '../../utils/schedulerDriveEta';
import { schedulerHouseholdIsClientFixedTime } from '../../utils/schedulerWindowWarning';
import { computeDriveTimeWindowWarning } from '../../utils/windowWarning';
import type { UpcomingVisit } from './plannerData';

export type StopImpact = {
  key: string;
  client: string;
  windowStart: DateTime | null;
  windowEnd: DateTime | null;
  etaBefore: DateTime | null;
  etaAfter: DateTime | null;
  /** Arrives past (or too close to the end of) its window once the pet is added. */
  warns: boolean;
  /** Minutes after the window end; 0 when inside it. */
  minutesPastWindow: number;
};

export type AddPetImpact = {
  newEnd: DateTime;
  /** Stops after the visit on that provider's day, in route order. */
  laterStops: StopImpact[];
};

type Stop = {
  key: string;
  client: string;
  apptIds: Set<string>;
  eta: DateTime | null;
  windowStart: DateTime | null;
  windowEnd: DateTime | null;
  warns: boolean;
};

function dt(iso: string | null | undefined, tz: string): DateTime | null {
  if (!iso) return null;
  const d = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
  return d.isValid ? d : null;
}

/** Each routed stop on a day, with ETA, arrival window and the calendar's own warning rule. */
export function stopsFromDay(day: DayData, tz: string): Stop[] {
  const n = day.households.length;
  const order =
    Array.isArray(day.routingOrderIndices) && day.routingOrderIndices.length === n
      ? day.routingOrderIndices
      : Array.from({ length: n }, (_, i) => i);
  const out: Stop[] = [];
  for (const idx of order) {
    const h = day.households[idx];
    if (!h || h.isPersonalBlock) continue;
    const slot = day.timeline[idx];
    const primary = h.primary as unknown as {
      appointmentStart?: string;
      appointmentEnd?: string;
      effectiveWindow?: { startIso?: string; endIso?: string } | null;
      appointmentType?: {
        name?: string;
        prettyName?: string | null;
        windowBeforeMinutes?: number | null;
        windowAfterMinutes?: number | null;
      };
    };
    const win = resolveArrivalWindowIsos({
      apptEffectiveWindow: primary?.effectiveWindow ?? h.effectiveWindow ?? null,
      household: h,
      slot,
      scheduledStartIso: h.startIso ?? primary?.appointmentStart ?? null,
      appointmentType: primary?.appointmentType
        ? {
            name: primary.appointmentType.name ?? '',
            prettyName: primary.appointmentType.prettyName,
            windowBeforeMinutes: primary.appointmentType.windowBeforeMinutes,
            windowAfterMinutes: primary.appointmentType.windowAfterMinutes,
          }
        : undefined,
      appointmentEndIso: h.endIso ?? primary?.appointmentEnd ?? null,
      practiceTz: tz,
    });
    const etaIso = slot?.eta ?? null;
    out.push({
      key: h.key,
      client: h.client,
      apptIds: new Set((h.sourceAppointmentIds ?? [h.primary?.id]).map((x) => String(x))),
      eta: dt(etaIso, tz),
      windowStart: dt(win?.startIso, tz),
      windowEnd: dt(win?.endIso, tz),
      warns: computeDriveTimeWindowWarning({
        etaIso,
        windowEndIso: win?.endIso ?? null,
        windowStartIso: win?.startIso ?? null,
        isClientFixedTime: schedulerHouseholdIsClientFixedTime(h),
        scheduledStartIso: h.startIso,
      }),
    });
  }
  return out;
}

/**
 * What adding pets to a household visit does to the rest of that provider's day: the
 * same doctor-day + /routing/eta data the calendar uses, loaded once as is and once with
 * the visit lengthened (the calendar's edit-visit time preview).
 */
export async function loadAddPetImpact(args: {
  visit: UpcomingVisit;
  /** History-based extra time for the added pets (plannerTiming.estimateAddedMinutes). */
  addedMinutes: number;
  tz: string;
}): Promise<AddPetImpact | null> {
  const { visit, tz } = args;
  if (!visit.provider) return null;
  const doctorId = String(visit.provider.id);
  const date = visit.start.toISODate()!;
  const newEnd = visit.end.plus({ minutes: args.addedMinutes });
  const anchor = visit.appointments[0];
  const preview = buildEditVisitTimePreview(
    Number(anchor.id),
    visit.start.toUTC().toISO()!,
    newEnd.toUTC().toISO()!,
    tz,
    {
      kind: 'time',
      originalAppointmentStart: anchor.appointmentStart,
      originalAppointmentEnd: anchor.appointmentEnd,
    }
  );
  const [before, after] = await Promise.all([
    fetchSchedulerDriveContextForDate(date, doctorId),
    fetchSchedulerDriveContextForDate(date, doctorId, { editTimePreview: preview }),
  ]);
  if (!after) return null;
  const visitIds = new Set(visit.appointments.map((a) => String(a.id)));
  const afterStops = stopsFromDay(after.dayData, tz);
  const beforeByKey = new Map(
    (before ? stopsFromDay(before.dayData, tz) : []).map((s) => [s.key, s])
  );
  const visitPos = afterStops.findIndex((s) => [...s.apptIds].some((id) => visitIds.has(id)));
  const later = visitPos >= 0 ? afterStops.slice(visitPos + 1) : [];
  return {
    newEnd,
    laterStops: later.map((s) => {
      const past =
        s.eta && s.windowEnd
          ? Math.max(0, Math.round(s.eta.diff(s.windowEnd, 'minutes').minutes))
          : 0;
      return {
        key: s.key,
        client: s.client,
        windowStart: s.windowStart,
        windowEnd: s.windowEnd,
        etaBefore: beforeByKey.get(s.key)?.eta ?? null,
        etaAfter: s.eta,
        warns: s.warns,
        minutesPastWindow: past,
      };
    }),
  };
}
