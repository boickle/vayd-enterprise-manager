// Room loader test plan AL-02 (universal add-ons honour history) and AL-07 (reminder gate
// counts from the visit date).
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { resolvePetPlan, universalOffersFor, type EngineContext, type EngineHistoryEntry } from './roomLoaderOfferEngine';
import { vaydRoomLoaderConfigSeed } from './roomLoaderConfigSeed';
import { emptyHistoryGate, normalizeRoomLoaderConfig, type RoomLoaderConfig } from './roomLoaderConfigTypes';
import { buildPlanContext } from '../pages/roomLoader/roomLoaderPlanContext';

const AS_OF = DateTime.fromISO('2026-10-30T00:00:00');
const iso = (d: DateTime) => d.toISODate()!;
const config: RoomLoaderConfig = vaydRoomLoaderConfigSeed();

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return {
    species: 'dog', ageMonths: 48, history: [], reminders: [], estimateLines: [],
    outdoorAccess: null, medicalConcern: false, asOf: AS_OF, ...over,
  };
}
const proc = (code: string, id: number, date: string, declined = false): EngineHistoryEntry => ({
  itemType: 'procedure', itemId: id, code, date, declined,
});
const offeredIds = (c: RoomLoaderConfig, x: EngineContext) => universalOffersFor(c, x).map((o) => o.id);

describe('AL-02 universal add-ons honour history', () => {
  it('AL-02-1 chipped pet is not offered a microchip; pedicure still is', () => {
    const ids = offeredIds(config, ctx({ history: [proc('MICROCHIP', 96, iso(AS_OF.minus({ years: 3 })))] }));
    expect(ids).not.toContain('u_chip');
    expect(ids).toContain('u_ped');
  });
  it('AL-02-2 never chipped is offered a microchip', () => {
    expect(offeredIds(config, ctx())).toContain('u_chip');
  });
  it('AL-02-3 a declined microchip is not "done"', () => {
    const ids = offeredIds(config, ctx({ history: [proc('MICROCHIP', 96, iso(AS_OF.minus({ years: 1 })), true)] }));
    expect(ids).toContain('u_chip');
  });
  it('AL-02-4 grooming add-ons recur every visit', () => {
    const last = iso(AS_OF.minus({ months: 1 }));
    const ids = offeredIds(config, ctx({
      history: [proc('K9NT', 55, last), proc('EAR1', 45, last), proc('XAG', 59, last)],
    }));
    expect(ids).toEqual(expect.arrayContaining(['u_ped', 'uni_mur5oynyb0kdn1', 'uni_mur5phmgsfhzaw']));
  });
  it('AL-02-5 an offer with no gate keeps the old behaviour', () => {
    const c = normalizeRoomLoaderConfig(JSON.parse(JSON.stringify(config)));
    for (const o of c.universalOffers) delete (o as any).history;
    expect(offeredIds(c, ctx({ history: [proc('MICROCHIP', 96, iso(AS_OF.minus({ years: 3 })))] }))).toContain('u_chip');
  });
  it('AL-02-6 older stored settings without a gate normalize cleanly', () => {
    const raw = JSON.parse(JSON.stringify(config));
    for (const o of raw.universalOffers) delete o.history;
    const c = normalizeRoomLoaderConfig(raw);
    expect(c.universalOffers.length).toBe(config.universalOffers.length);
    expect(c.universalOffers.every((o) => o.history == null || typeof o.history === 'object')).toBe(true);
  });
  it('seed gates only the microchip', () => {
    const gated = config.universalOffers.filter((o) => o.history?.neverOfferAgainOnceDone).map((o) => o.id);
    expect(gated).toEqual(['u_chip']);
  });
  it('normalize fills the gate defaults when a stored gate is partial', () => {
    const raw = JSON.parse(JSON.stringify(config));
    raw.universalOffers[1].history = { neverOfferAgainOnceDone: true };
    const g = normalizeRoomLoaderConfig(raw).universalOffers[1].history!;
    expect(g).toEqual({ ...emptyHistoryGate(), neverOfferAgainOnceDone: true });
  });
});

describe('AL-07 reminder gate counts from the visit date', () => {
  const visit = AS_OF.plus({ weeks: 3 });
  const gateCfg = (): RoomLoaderConfig => {
    const c: RoomLoaderConfig = JSON.parse(JSON.stringify(config));
    c.gatedOffers = c.gatedOffers.filter((o) => o.id === 'vax_lepto');
    c.gatedOffers[0].history = { ...emptyHistoryGate(), suppressIfReminderDueBeyondMonths: 0 };
    return c;
  };
  const lepto = (c: RoomLoaderConfig, x: EngineContext) => resolvePetPlan(c, x).gatedOffers.map((o) => o.id);

  it('AL-07-1 reminder due before the visit is still offered', () => {
    const c = gateCfg();
    const ref = c.gatedOffers[0].item!;
    const r = [{ itemType: ref.itemType, itemId: ref.itemId, code: ref.code, dueDate: iso(AS_OF.plus({ weeks: 2 })) }];
    expect(lepto(c, ctx({ reminders: r, visitDate: visit }))).toContain('vax_lepto');
  });
  it('AL-07-2 reminder due 2 months after the visit is suppressed', () => {
    const c = gateCfg();
    const ref = c.gatedOffers[0].item!;
    const r = [{ itemType: ref.itemType, itemId: ref.itemId, code: ref.code, dueDate: iso(visit.plus({ months: 2 })) }];
    expect(lepto(c, ctx({ reminders: r, visitDate: visit }))).not.toContain('vax_lepto');
  });
  it('AL-07-3 no visit date falls back to today', () => {
    const c = gateCfg();
    const ref = c.gatedOffers[0].item!;
    const r = [{ itemType: ref.itemType, itemId: ref.itemId, code: ref.code, dueDate: iso(AS_OF.plus({ weeks: 2 })) }];
    // Due 2 weeks from today with gate 0 months: beyond today, so suppressed as before.
    expect(lepto(c, ctx({ reminders: r }))).not.toContain('vax_lepto');
  });
  it('AL-07-4 buildPlanContext takes the visit date from the pet appointment start', () => {
    const data = { appointments: [{ appointmentStart: '2026-11-20T14:00:00.000Z', patient: { id: 7, species: 'dog' } }] };
    const c = buildPlanContext({ data, patient: { patientId: 7 }, petKey: 'pet0', formData: {}, history: [], asOf: AS_OF });
    expect(c.visitDate?.toISODate()).toBe('2026-11-20');
    const none = buildPlanContext({ data: { appointments: [] }, patient: { patientId: 7 }, petKey: 'pet0', formData: {}, history: [], asOf: AS_OF });
    expect(none.visitDate).toBeUndefined();
  });
});
