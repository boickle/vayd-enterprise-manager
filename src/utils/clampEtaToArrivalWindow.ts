/**
 * Keep routed ETA/ETD from starting before the promised arrival window.
 *
 * `/routing/eta` may omit clamping when households were sent without a window
 * (e.g. doctor-day missing `effectiveWindow` while the UI still shows type ±N).
 * After merge, snap early arrivals to window start and push later stops by the
 * same delay so drive layout / Visit Highlights stay consistent.
 */
import { DateTime } from 'luxon';
import {
  effectiveWindowForScheduledStart,
  type AppointmentTypeWindowSource,
} from './appointmentArrivalWindow';
export type EtaClampHousehold = {
  isPersonalBlock?: boolean;
  startIso?: string | null;
  endIso?: string | null;
  windowStartIso?: string | null;
  windowEndIso?: string | null;
  effectiveWindow?: { startIso?: string; endIso?: string } | null;
  primary?: {
    appointmentStart?: string | null;
    appointmentEnd?: string | null;
    appointmentType?: AppointmentTypeWindowSource | null;
    effectiveWindow?: { startIso?: string; endIso?: string } | null;
  } | null;
};

export type EtaClampTimelineSlot = {
  eta?: string | null;
  etd?: string | null;
  windowStartIso?: string | null;
  windowEndIso?: string | null;
  bufferAfterMinutes?: number;
};

function pickWindowPair(
  start?: string | null,
  end?: string | null
): { startIso: string; endIso: string } | null {
  const s = start?.trim() || null;
  const e = end?.trim() || null;
  if (!s || !e) return null;
  const a = DateTime.fromISO(s);
  const b = DateTime.fromISO(e);
  if (!a.isValid || !b.isValid) return null;
  return { startIso: s, endIso: e };
}

/** Prefer slot → household → primary effectiveWindow → type ±N from scheduled start. */
export function resolveArrivalWindowForEtaClamp(
  h: EtaClampHousehold,
  slot: EtaClampTimelineSlot | null | undefined,
  practiceTz: string
): { startIso: string; endIso: string } | null {
  const fromSlot = pickWindowPair(slot?.windowStartIso, slot?.windowEndIso);
  if (fromSlot) return fromSlot;

  const fromHousehold = pickWindowPair(
    h.windowStartIso ?? h.effectiveWindow?.startIso,
    h.windowEndIso ?? h.effectiveWindow?.endIso
  );
  if (fromHousehold) return fromHousehold;

  const fromPrimary = pickWindowPair(
    h.primary?.effectiveWindow?.startIso,
    h.primary?.effectiveWindow?.endIso
  );
  if (fromPrimary) return fromPrimary;

  const scheduledStart =
    h.primary?.appointmentStart?.trim() || h.startIso?.trim() || null;
  if (!scheduledStart) return null;

  return (
    effectiveWindowForScheduledStart(
      scheduledStart,
      h.primary?.appointmentType ?? undefined,
      practiceTz,
      {
        appointmentEndIso:
          h.primary?.appointmentEnd?.trim() || h.endIso?.trim() || undefined,
      }
    ) ?? null
  );
}

/**
 * Mutates `timeline` in route order: never leave ETA before window start; cascade
 * the delay to later stops so ETD gaps stay coherent.
 */
export function clampTimelineEtasToArrivalWindows(args: {
  households: readonly EtaClampHousehold[];
  timeline: EtaClampTimelineSlot[];
  routingOrderIndices: readonly number[];
  practiceTz: string;
}): void {
  const { households, timeline, routingOrderIndices, practiceTz } = args;
  if (!routingOrderIndices.length) return;

  let cumulativeDelayMs = 0;

  for (const idx of routingOrderIndices) {
    const h = households[idx];
    const slot = timeline[idx];
    if (!h || !slot?.eta?.trim()) continue;

    const eta0 = DateTime.fromISO(slot.eta);
    if (!eta0.isValid) continue;

    let eta = eta0.plus({ milliseconds: cumulativeDelayMs });
    let etd = slot.etd?.trim() ? DateTime.fromISO(slot.etd) : null;
    if (etd && !etd.isValid) etd = null;
    if (etd) etd = etd.plus({ milliseconds: cumulativeDelayMs });

    // Flexible (±N) and zero-width (Fixed / HOLD 0±0): never start service before window open.
    const win = resolveArrivalWindowForEtaClamp(h, slot, practiceTz);
    if (win) {
      const wStart = DateTime.fromISO(win.startIso);
      if (wStart.isValid && eta < wStart) {
        const extraMs = wStart.diff(eta).as('milliseconds');
        if (extraMs > 0) {
          cumulativeDelayMs += extraMs;
          if (etd) etd = etd.plus({ milliseconds: extraMs });
          eta = wStart;
        }
      }
    }

    const etaIso = eta.toUTC().toISO();
    if (!etaIso) continue;
    slot.eta = etaIso;
    if (etd) {
      const etdIso = etd.toUTC().toISO();
      if (etdIso) slot.etd = etdIso;
    }
    if (win) {
      slot.windowStartIso = slot.windowStartIso ?? win.startIso;
      slot.windowEndIso = slot.windowEndIso ?? win.endIso;
    }
  }
}
