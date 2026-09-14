/**
 * Appointment-type gate for Get Best Route doctor-fallback results.
 *
 * Locked "Doctor X only" searches may auto-widen when X has no slots. That widen
 * must still honor Settings → employee appointment types — the same check the
 * ASAP / Best fit picker uses — so a Follow-Up search does not surface a doctor
 * who does not see follow-ups.
 */

import {
  isSingleDoctorRoutingSearch,
  slotIsFallbackDoctor,
  type DoctorFallbackMeta,
} from './routingDoctorFallback';

export type AppointmentTypeFilterSlot = {
  doctorId?: string | null;
  doctorPimsId?: string | null;
  isFallbackDoctor?: boolean | null;
};

export type AppointmentTypeFilterResult<TSlot extends AppointmentTypeFilterSlot = AppointmentTypeFilterSlot> = {
  winner?: TSlot | null;
  alternates?: TSlot[] | null;
  doctors?: Array<{
    pimsId: string;
    name?: string;
    top?: TSlot[] | null;
  }>;
  doctorFallback?: DoctorFallbackMeta;
};

export function routingSlotDoctorId(slot: AppointmentTypeFilterSlot | null | undefined): string {
  return String(slot?.doctorPimsId ?? slot?.doctorId ?? '').trim();
}

export function collectRoutingResultDoctorIds(
  result: AppointmentTypeFilterResult | null | undefined
): string[] {
  if (!result) return [];
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    const t = String(id ?? '').trim();
    if (t) ids.add(t);
  };
  add(routingSlotDoctorId(result.winner));
  for (const row of result.alternates ?? []) add(routingSlotDoctorId(row));
  for (const doc of result.doctors ?? []) {
    add(doc.pimsId);
    for (const row of doc.top ?? []) add(routingSlotDoctorId(row));
  }
  for (const id of result.doctorFallback?.fallbackDoctorIds ?? []) add(id);
  return [...ids];
}

export function shouldKeepRoutingSlotForAppointmentType(opts: {
  slot: AppointmentTypeFilterSlot | null | undefined;
  requestedDoctorId?: string | null;
  asapAllDoctorSearch?: boolean;
  multiDoctor?: boolean;
  appointmentTypeId?: number | null;
  doctorsAcceptingType: ReadonlySet<string>;
}): boolean {
  const {
    slot,
    requestedDoctorId,
    asapAllDoctorSearch,
    multiDoctor,
    appointmentTypeId,
    doctorsAcceptingType,
  } = opts;

  if (!slot) return false;
  const typeId = Number(appointmentTypeId);
  if (!Number.isFinite(typeId) || typeId <= 0) return true;
  if (asapAllDoctorSearch || multiDoctor) return true;

  const requested = String(requestedDoctorId ?? '').trim();
  const slotId = routingSlotDoctorId(slot);
  if (requested && slotId === requested) return true;

  const isFallback = slotIsFallbackDoctor(slot, requestedDoctorId, {
    asapAllDoctorSearch,
    multiDoctor,
  });
  if (!isFallback) return true;

  if (!slotId) return false;
  return doctorsAcceptingType.has(slotId);
}

/**
 * Drop auto-widened slots whose doctors are not assigned the selected type.
 * Requested-doctor slots and ASAP / Best fit results are left intact.
 */
export function filterRoutingResultByAppointmentType<T extends AppointmentTypeFilterResult>(
  result: T,
  opts: {
    requestedDoctorId?: string | null;
    asapAllDoctorSearch?: boolean;
    multiDoctor?: boolean;
    appointmentTypeId?: number | null;
    doctorsAcceptingType: ReadonlySet<string>;
  }
): T {
  const typeId = Number(opts.appointmentTypeId);
  if (!Number.isFinite(typeId) || typeId <= 0) return result;
  if (
    !isSingleDoctorRoutingSearch({
      asapAllDoctorSearch: opts.asapAllDoctorSearch,
      multiDoctor: opts.multiDoctor,
      requestedDoctorId: opts.requestedDoctorId,
    })
  ) {
    return result;
  }

  const keep = (slot: AppointmentTypeFilterSlot | null | undefined) =>
    shouldKeepRoutingSlotForAppointmentType({
      slot,
      requestedDoctorId: opts.requestedDoctorId,
      asapAllDoctorSearch: opts.asapAllDoctorSearch,
      multiDoctor: opts.multiDoctor,
      appointmentTypeId: opts.appointmentTypeId,
      doctorsAcceptingType: opts.doctorsAcceptingType,
    });

  const keptAlternates = (result.alternates ?? []).filter((row) => keep(row));
  let winner = result.winner && keep(result.winner) ? result.winner : undefined;
  let alternates = keptAlternates;
  if (!winner && alternates.length > 0) {
    winner = alternates[0];
    alternates = alternates.slice(1);
  }

  const doctors = Array.isArray(result.doctors)
    ? result.doctors
        .map((d) => ({
          ...d,
          top: (d.top ?? []).filter((row) => keep(row)),
        }))
        .filter((d) => (d.top?.length ?? 0) > 0)
    : result.doctors;

  const fallbackIds = result.doctorFallback?.fallbackDoctorIds;
  const doctorFallback =
    result.doctorFallback && Array.isArray(fallbackIds)
      ? {
          ...result.doctorFallback,
          fallbackDoctorIds: fallbackIds.filter((id) =>
            opts.doctorsAcceptingType.has(String(id ?? '').trim())
          ),
        }
      : result.doctorFallback;

  return {
    ...result,
    winner,
    alternates,
    doctors,
    doctorFallback,
  };
}
