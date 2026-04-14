import type { DoctorMonthAppt } from '../api/appointments';

/** Appointment with optional doctorId (multi-doctor / multi-pet grouping). */
export type ApptWithDoctor = DoctorMonthAppt & { doctorId?: string };

/** Appointment types to lump into "Other" (case-insensitive match). */
const OTHER_APPT_TYPES = new Set([
  'acupuncture',
  'ash drop off',
  'laser',
  'needs pre-appt meds',
  'ha - exisiting client',
  'ha - existing client',
]);

/** Normalize type for chart: lump "Tech appointment*" into one type; specific types into Other. */
export function normalizeAppointmentType(name: string | undefined): string {
  const s = (name && String(name).trim()) || '';
  if (!s) return 'Other';
  if (s.toLowerCase().startsWith('tech appointment')) return 'Tech appointment';
  if (OTHER_APPT_TYPES.has(s.toLowerCase())) return 'Other';
  return s;
}

/** True if this appointment type should be hidden from time-spent analytics (e.g. Block). */
export function isBlockAppointmentType(name: string | undefined): boolean {
  const s = ((name != null ? String(name).trim() : '') || '').toLowerCase();
  return s === 'block' || s === 'personal block' || s.startsWith('block');
}

/**
 * Multi-pet detection (same as Time Spent analytics):
 * Same client, same day, same start time → divide minutes when durations match; etc.
 */
export function processMultiPet(
  days: { date: string; appts: ApptWithDoctor[] }[]
): { date: string; appts: { appointmentType?: string; serviceMinutes?: number }[] }[] {
  return days.map((day) => {
    const appts = (day.appts ?? []).filter((a) => !isBlockAppointmentType(a.appointmentType));
    const clientKey = (a: ApptWithDoctor) =>
      a.clientId != null ? String(a.clientId) : a.clientPimsId != null ? String(a.clientPimsId) : '';
    const hasClient = (a: ApptWithDoctor) => clientKey(a) !== '';

    const out: { appointmentType?: string; serviceMinutes?: number }[] = [];

    const byClient = new Map<string, ApptWithDoctor[]>();
    for (const a of appts) {
      const k = hasClient(a)
        ? `${a.doctorId ?? ''}|${clientKey(a)}`
        : `${a.doctorId ?? ''}|__no_client__|${a.startIso ?? ''}`;
      if (!byClient.has(k)) byClient.set(k, []);
      byClient.get(k)!.push(a);
    }

    for (const clientGroup of byClient.values()) {
      const n = clientGroup.length;
      const useMultipet = n > 1;
      const isNoClientSlot = n === 1 && clientGroup[0] && !hasClient(clientGroup[0]);

      if (isNoClientSlot) {
        const a = clientGroup[0]!;
        out.push({
          appointmentType: a.appointmentType,
          serviceMinutes: Number.isFinite(a.serviceMinutes) ? a.serviceMinutes : 0,
        });
        continue;
      }

      if (!useMultipet) {
        const a = clientGroup[0]!;
        out.push({
          appointmentType: a.appointmentType,
          serviceMinutes: Number.isFinite(a.serviceMinutes) ? a.serviceMinutes : 0,
        });
        continue;
      }

      const bySlot = new Map<string, ApptWithDoctor[]>();
      for (const a of clientGroup) {
        const slot = a.startIso ?? '';
        if (!bySlot.has(slot)) bySlot.set(slot, []);
        bySlot.get(slot)!.push(a);
      }

      for (const slotGroup of bySlot.values()) {
        const slotN = slotGroup.length;
        const blockMinutes = Number.isFinite(slotGroup[0]?.serviceMinutes) ? slotGroup[0]!.serviceMinutes! : 0;
        const allSameDuration =
          slotN > 0 &&
          slotGroup.every((a) => (Number.isFinite(a.serviceMinutes) ? a.serviceMinutes! : 0) === blockMinutes);

        if (slotN > 1 && allSameDuration) {
          const perPetMinutes = blockMinutes / slotN;
          for (const a of slotGroup) {
            const baseType = normalizeAppointmentType(a.appointmentType);
            out.push({
              appointmentType: `multipet-${baseType}`,
              serviceMinutes: Math.round(perPetMinutes * 10) / 10,
            });
          }
        } else {
          for (const a of slotGroup) {
            const baseType = normalizeAppointmentType(a.appointmentType);
            const mins = Number.isFinite(a.serviceMinutes) ? a.serviceMinutes! : 0;
            out.push({
              appointmentType: `multipet-${baseType}`,
              serviceMinutes: Math.round(mins * 10) / 10,
            });
          }
        }
      }
    }

    return { date: day.date, appts: out };
  });
}

export type AvgMinutesByTypeRow = {
  typeName: string;
  /** Regular (non–multi-pet-slot) appointments: average booked minutes. */
  avgMinutes: number;
  count: number;
  /** Multi-pet slot appointments for this type (`multipet-{type}` after processing); null if none. */
  multipetAvgMinutes: number | null;
  multipetCount: number;
};

const MULTIPET_PREFIX = 'multipet-';

function multipetBaseType(appointmentType: string | undefined): string | null {
  const raw = String(appointmentType ?? '');
  if (!raw.startsWith(MULTIPET_PREFIX)) return null;
  const base = raw.slice(MULTIPET_PREFIX.length).trim();
  return base || 'Other';
}

/**
 * Average scheduled service minutes per appointment type over the given days (YYYY-MM-DD),
 * using the same multi-pet and normalization rules as Time Spent analytics.
 * Splits **regular** vs **multipet-** rows so each `typeName` can show both averages side by side.
 */
export function summarizeAvgMinutesByAppointmentType(
  days: { date: string; appts: DoctorMonthAppt[] }[],
  rangeStart: string,
  rangeEnd: string,
  doctorId: string
): AvgMinutesByTypeRow[] {
  const start = rangeStart.slice(0, 10);
  const end = rangeEnd.slice(0, 10);

  const inRange = days.filter((d) => {
    const date = d?.date?.slice(0, 10);
    return date && date >= start && date <= end;
  });

  const withDoctor: { date: string; appts: ApptWithDoctor[] }[] = inRange.map((day) => ({
    date: day.date.slice(0, 10),
    appts: (day.appts ?? []).map((a) => ({ ...a, doctorId })),
  }));

  const processed = processMultiPet(withDoctor);

  const totalRegular = new Map<string, number>();
  const countRegular = new Map<string, number>();
  const totalMultipet = new Map<string, number>();
  const countMultipet = new Map<string, number>();

  for (const day of processed) {
    for (const a of day.appts ?? []) {
      const mins = Number.isFinite(a.serviceMinutes) ? a.serviceMinutes! : 0;
      const mpBase = multipetBaseType(a.appointmentType);
      if (mpBase != null) {
        totalMultipet.set(mpBase, (totalMultipet.get(mpBase) ?? 0) + mins);
        countMultipet.set(mpBase, (countMultipet.get(mpBase) ?? 0) + 1);
      } else {
        const typeName = normalizeAppointmentType(a.appointmentType);
        totalRegular.set(typeName, (totalRegular.get(typeName) ?? 0) + mins);
        countRegular.set(typeName, (countRegular.get(typeName) ?? 0) + 1);
      }
    }
  }

  const typeNames = new Set<string>([...totalRegular.keys(), ...totalMultipet.keys()]);

  const rows: AvgMinutesByTypeRow[] = [];
  for (const typeName of typeNames) {
    const rc = countRegular.get(typeName) ?? 0;
    const rt = totalRegular.get(typeName) ?? 0;
    const mc = countMultipet.get(typeName) ?? 0;
    const mt = totalMultipet.get(typeName) ?? 0;
    const avgMinutes = rc > 0 ? Math.round((rt / rc) * 10) / 10 : 0;
    const multipetAvgMinutes = mc > 0 ? Math.round((mt / mc) * 10) / 10 : null;
    if (avgMinutes <= 0 && (multipetAvgMinutes == null || multipetAvgMinutes <= 0)) continue;
    rows.push({
      typeName,
      avgMinutes,
      count: rc,
      multipetAvgMinutes,
      multipetCount: mc,
    });
  }

  return rows.sort((a, b) => {
    const totalA = a.count + a.multipetCount;
    const totalB = b.count + b.multipetCount;
    if (totalB !== totalA) return totalB - totalA;
    return a.typeName.localeCompare(b.typeName);
  });
}

/** Unique calendar months needed to cover [start, end] inclusive (YYYY-MM-DD). */
export function monthsCoveringRange(startIsoDate: string, endIsoDate: string): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = Number(startIsoDate.slice(0, 4));
  let m = Number(startIsoDate.slice(5, 7));
  const endY = Number(endIsoDate.slice(0, 4));
  const endM = Number(endIsoDate.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(endY) || !Number.isFinite(endM)) return out;
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
