import type { AppointmentType } from '../api/appointmentSettings';
import { normalizeAppointmentType } from '../analytics/appointmentTypeTimeStats';

/** Match Routing → Calculate Time dropdown value to a configured appointment type. */
export function appointmentTypeForRoutingStatsKey(
  typeKey: string,
  types: readonly AppointmentType[]
): AppointmentType | undefined {
  const key = typeKey.trim();
  if (!key) return undefined;
  const norm = normalizeAppointmentType(key);
  const lower = key.toLowerCase();
  return types.find((t) => {
    const name = String(t.name ?? '').trim();
    const pretty = String(t.prettyName ?? '').trim();
    return (
      normalizeAppointmentType(name) === norm ||
      normalizeAppointmentType(pretty) === norm ||
      name.toLowerCase() === lower ||
      pretty.toLowerCase() === lower
    );
  });
}

export function appointmentTypeLabelFromRow(
  type: AppointmentType | undefined
): string | null {
  if (!type) return null;
  const label = String(type.name ?? type.prettyName ?? '').trim();
  return label || null;
}

/** First type in a sorted picker list (`formListOrder` #1 when configured). */
export function defaultAppointmentTypeIdFromSortedPicker(
  types: readonly { id?: number | null | string }[]
): number | undefined {
  const first = types[0];
  if (first?.id == null) return undefined;
  const id = Number(first.id);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

/**
 * Book-modal default: Calculate Time type from Get Best Route when set,
 * otherwise the first type in the sorted picker (`formListOrder` #1).
 */
export function resolveBookModalDefaultAppointmentTypeId(opts: {
  sortedPickerTypes: readonly AppointmentType[];
  allTypes: readonly AppointmentType[];
  routingStatsTypeKey?: string | null;
  /** Co-visit and similar flows that pin the visit type. */
  pinnedAppointmentTypeId?: number | null;
}): number | undefined {
  const statsKey = opts.routingStatsTypeKey?.trim() ?? '';
  if (statsKey) {
    const matched = appointmentTypeForRoutingStatsKey(statsKey, opts.allTypes);
    if (matched?.id != null && Number.isFinite(Number(matched.id))) {
      return Number(matched.id);
    }
  }
  const pinned = opts.pinnedAppointmentTypeId;
  if (pinned != null && Number.isFinite(Number(pinned)) && Number(pinned) > 0) {
    return Number(pinned);
  }
  return defaultAppointmentTypeIdFromSortedPicker(opts.sortedPickerTypes);
}

/** Resolve the appointment type chosen in Routing → Calculate Time for book / preview. */
export function resolveRoutingChosenAppointmentTypeId(opts: {
  statsTypeKey?: string | null;
  scheduleBookTypeId?: number | null;
  types: readonly AppointmentType[];
  previewTypeId?: number;
  previewTypeChosenInRouting?: boolean;
}): number | undefined {
  const statsKey = opts.statsTypeKey?.trim() ?? '';
  if (statsKey && opts.types.length > 0) {
    const matched = appointmentTypeForRoutingStatsKey(statsKey, opts.types);
    if (matched?.id != null && Number.isFinite(Number(matched.id))) {
      return Number(matched.id);
    }
  }
  if (
    opts.previewTypeChosenInRouting &&
    opts.previewTypeId != null &&
    Number.isFinite(Number(opts.previewTypeId)) &&
    Number(opts.previewTypeId) > 0
  ) {
    return Number(opts.previewTypeId);
  }
  if (
    opts.scheduleBookTypeId != null &&
    Number.isFinite(Number(opts.scheduleBookTypeId)) &&
    Number(opts.scheduleBookTypeId) > 0
  ) {
    return Number(opts.scheduleBookTypeId);
  }
  return undefined;
}
