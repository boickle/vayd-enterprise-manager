// Room loader test plan RL-04 (recent labs), RL-05 (decline windows), RL-06 (outdoor FeLV).
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { resolvePetPlan, selectPanelRules, type EngineContext, type EngineHistoryEntry } from './roomLoaderOfferEngine';
import { vaydRoomLoaderConfigSeed } from './roomLoaderConfigSeed';
import { normalizeRoomLoaderConfig, type RoomLoaderConfig } from './roomLoaderConfigTypes';
import { historyFromTreatments } from '../pages/roomLoader/roomLoaderPlanContext';

const AS_OF = DateTime.fromISO('2026-10-30T00:00:00');
const config: RoomLoaderConfig = vaydRoomLoaderConfigSeed();

const iso = (d: DateTime) => d.toISODate()!;
const monthsAgo = (m: number, days = 0) => iso(AS_OF.minus({ months: m, days }));

function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return {
    species: 'dog',
    ageMonths: 48,
    history: [],
    reminders: [],
    estimateLines: [],
    outdoorAccess: null,
    medicalConcern: false,
    asOf: AS_OF,
    ...over,
  };
}
const lab = (code: string, id: number, date: string, declined = false): EngineHistoryEntry => ({
  itemType: 'lab', itemId: id, code, date, declined,
});
const inv = (code: string, id: number, date: string, declined = false): EngineHistoryEntry => ({
  itemType: 'inventory', itemId: id, code, date, declined,
});
const ruleIds = (c: EngineContext) => selectPanelRules(config, c).map((r) => r.id);

describe('RL-04 recent labs are not offered again', () => {
  const early = (date: string, declined = false) => lab('FIL48719999', 953, date, declined);

  it('RL-04-1 done 3 months ago, labs = no: no Early Detection panel', () => {
    expect(ruleIds(ctx({ history: [early(monthsAgo(3))] }))).not.toContain('r_early_dog');
  });
  it('RL-04-1 control: no history offers it', () => {
    expect(ruleIds(ctx())).toContain('r_early_dog');
  });
  it('RL-04-2 staff labs = yes overrides: medical-concern panels offered', () => {
    const rules = ruleIds(ctx({ history: [early(monthsAgo(3))], medicalConcern: true }));
    expect(rules).toEqual(['rule_senior_dog']);
  });
  it('RL-04-2 staff yes also bypasses the gate on a senior pet panel done last month', () => {
    const c = ctx({ ageMonths: 120, history: [lab('FIL8659999', 128, monthsAgo(1))], medicalConcern: true });
    expect(ruleIds(c)).toEqual(['rule_senior_dog']);
    expect(ruleIds({ ...c, medicalConcern: false })).toEqual([]);
  });
  it('RL-04-3 done exactly 10 months ago is hidden', () => {
    expect(ruleIds(ctx({ history: [early(monthsAgo(10))] }))).not.toContain('r_early_dog');
  });
  it('RL-04-3 exactly 10 months ago is hidden even when "now" is mid-day', () => {
    const c = ctx({ history: [early(monthsAgo(10))], asOf: AS_OF.set({ hour: 15 }) });
    expect(ruleIds(c)).not.toContain('r_early_dog');
  });
  it('RL-04-3 10 months + 1 day is offered', () => {
    expect(ruleIds(ctx({ history: [early(monthsAgo(10, 1))] }))).toContain('r_early_dog');
  });
  it('RL-04-4 panel declined 2 months ago is still offered', () => {
    expect(ruleIds(ctx({ history: [early(monthsAgo(2), true)] }))).toContain('r_early_dog');
  });
  it('RL-04-5 panel on a deleted / inactive invoice line is still offered', () => {
    const treatments: any[] = [
      {
        treatmentItems: [
          { isDeleted: true, serviceDate: monthsAgo(1), lab: { id: 953, code: 'FIL48719999' } },
          { isActive: false, serviceDate: monthsAgo(1), lab: { id: 953, code: 'FIL48719999' } },
          { isDeclined: true, serviceDate: monthsAgo(1), lab: { id: 953, code: 'FIL48719999' } },
        ],
      },
    ];
    const history = historyFromTreatments(treatments);
    expect(history.filter((h) => !h.declined)).toHaveLength(0);
    expect(ruleIds(ctx({ history }))).toContain('r_early_dog');
  });
  it('RL-04-5 control: a live line does hide it', () => {
    const treatments: any[] = [
      { treatmentItems: [{ serviceDate: monthsAgo(1), lab: { id: 953, code: 'FIL48719999' } }] },
    ];
    expect(ruleIds(ctx({ history: historyFromTreatments(treatments) }))).not.toContain('r_early_dog');
  });
  it('RL-04-6 Senior Screen under the other code 2 months ago hides the senior rule (both directions)', () => {
    const senior = ctx({ ageMonths: 120 });
    expect(ruleIds(senior)).toContain('rule_senior_dog');
    expect(ruleIds({ ...senior, history: [lab('FIL25659999', 134, monthsAgo(2))] })).not.toContain('rule_senior_dog');
    expect(ruleIds({ ...senior, history: [lab('FIL8659999', 128, monthsAgo(2))] })).not.toContain('rule_senior_dog');
  });
  it('RL-04-6 an equivalent listed on the rule counts too', () => {
    const cfg = normalizeRoomLoaderConfig({
      ...config,
      panelRules: config.panelRules.map((r) =>
        r.id === 'r_early_dog'
          ? { ...r, equivalentItems: [{ itemType: 'lab', itemId: 999, name: 'Other', code: 'OTHER' }] }
          : r
      ),
    });
    const c = ctx({ history: [lab('OTHER', 999, monthsAgo(2))] });
    expect(selectPanelRules(cfg, c).map((r) => r.id)).not.toContain('r_early_dog');
  });
  it('older stored rules without the field never hide', () => {
    const cfg = normalizeRoomLoaderConfig({
      ...config,
      panelRules: config.panelRules.map((r) => ({ ...r, suppressIfDoneWithinMonths: undefined })),
    });
    expect(selectPanelRules(cfg, ctx({ history: [lab('FIL48719999', 953, monthsAgo(1))] })).map((r) => r.id)).toContain('r_early_dog');
  });
  it('seed uses 10 months on every panel rule', () => {
    expect(config.panelRules.every((r) => r.suppressIfDoneWithinMonths === 10)).toBe(true);
  });
});

describe('RL-05 decline windows (D2: 10 months from the latest decline)', () => {
  const plan = (history: EngineHistoryEntry[]) => resolvePetPlan(config, ctx({ history }));
  const offered = (history: EngineHistoryEntry[], id: string) => plan(history).gatedOffers.some((o) => o.id === id);
  const lepto = (m: number, declined = false, code = 'LEPTOINIT', id = 62) => inv(code, id, monthsAgo(m), declined);

  it('RL-05-1 declined 3 months ago, never given: not offered', () => {
    expect(offered([lepto(3, true)], 'vax_lepto')).toBe(false);
  });
  it('RL-05-2 declined 11 months ago: offered', () => {
    expect(offered([lepto(11, true)], 'vax_lepto')).toBe(true);
  });
  it('RL-05-2 boundary: declined exactly 10 months ago is offered, 9 months is not', () => {
    expect(offered([lepto(10, true)], 'vax_lepto')).toBe(true);
    expect(offered([lepto(9, true)], 'vax_lepto')).toBe(false);
  });
  it('RL-05-3 declined 14 and 4 months ago: not offered (latest counts)', () => {
    expect(offered([lepto(14, true), lepto(4, true)], 'vax_lepto')).toBe(false);
  });
  it('RL-05-4 LEPTOANNUAL 5 months ago: not offered', () => {
    expect(offered([lepto(5, false, 'LEPTOANNUAL', 64)], 'vax_lepto')).toBe(false);
  });
  it('RL-05-5 given 16 months ago: offered', () => {
    expect(offered([lepto(16, false, 'LEPTOANNUAL', 64)], 'vax_lepto')).toBe(true);
  });
  it('RL-05-6 Lyme/Lepto combo 6 months ago: neither offered', () => {
    const combo = [inv('LYME/LEPTOANNUAL', 445, monthsAgo(6))];
    expect(offered(combo, 'vax_lepto')).toBe(false);
    expect(offered(combo, 'vax_lyme')).toBe(false);
  });
  it('RL-05-6 control: no history offers both', () => {
    expect(offered([], 'vax_lepto')).toBe(true);
    expect(offered([], 'vax_lyme')).toBe(true);
  });
  const cat = (history: EngineHistoryEntry[]) =>
    resolvePetPlan(config, ctx({ species: 'cat', ageMonths: 48, outdoorAccess: true, history })).outdoorPitch;
  it('RL-05-7 outdoor FeLV declined 11 months ago: pitched', () => {
    expect(cat([inv('FELV1', 76, monthsAgo(11), true)])).not.toBeNull();
  });
  it('RL-05-7 outdoor FeLV declined 3 months ago: not pitched', () => {
    expect(cat([inv('FELV1', 76, monthsAgo(3), true)])).toBeNull();
  });
  it('RL-05 seed: every gated offer, outdoor and panel sub-ask uses a 10 month decline window', () => {
    const gates = [
      ...config.gatedOffers.map((o) => [o.id, o.history] as const),
      ['outdoor', config.outdoor.history] as const,
      ...config.panelRules.flatMap((r) =>
        r.options.flatMap((o) => o.subAsks.map((s) => [s.id, s.history] as const))
      ),
    ];
    expect(gates.length).toBeGreaterThan(8);
    for (const [id, g] of gates) {
      expect([id, g.showEvenIfPreviouslyDeclined, g.reofferDeclinedAfterMonths]).toEqual([id, true, 10]);
    }
  });
});

describe('RL-06 outdoor FeLV counts every FeLV code', () => {
  const pitch = (history: EngineHistoryEntry[], outdoorAccess: boolean | null = true, cfg = config) =>
    resolvePetPlan(cfg, ctx({ species: 'cat', ageMonths: 48, outdoorAccess, history })).outdoorPitch;

  it('RL-06-1 FELV1 8 months ago: no pitch', () => {
    expect(pitch([inv('FELV1', 76, monthsAgo(8))])).toBeNull();
  });
  it('RL-06-2 FELV2 20 months ago: no pitch', () => {
    expect(pitch([inv('FELV2', 233, monthsAgo(20))])).toBeNull();
  });
  it('RL-06-2 clinic and initial codes count', () => {
    expect(pitch([inv('WC-VXCLINICFELV2', 3928, monthsAgo(6))])).toBeNull();
    expect(pitch([inv('FELVINIT', 74, monthsAgo(6))])).toBeNull();
  });
  it('RL-06-3 FELV1 25 months ago: pitched', () => {
    expect(pitch([inv('FELV1', 76, monthsAgo(25))])).not.toBeNull();
  });
  it('RL-06-4 never vaccinated: pitched on yes, not on no', () => {
    expect(pitch([], true)).not.toBeNull();
    expect(pitch([], false)).toBeNull();
  });
  it('RL-06 FeLV already on the estimate under an equivalent code: no pitch', () => {
    const c = ctx({ species: 'cat', outdoorAccess: true, estimateLines: [{ itemType: 'inventory', itemId: 233, code: 'FELV2' }] });
    expect(resolvePetPlan(config, c).outdoorPitch).toBeNull();
  });
  it('RL-06 seed carries the FeLV codes and normalize keeps/adds the list', () => {
    const codes = (config.outdoor.equivalentItems ?? []).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['FELV1', 'FELV2', 'WC-VXCLINICFELV1', 'WC-VXCLINICFELV2', 'WC-VXCLINICFELVINT']));
    const stripped = normalizeRoomLoaderConfig({ ...config, outdoor: { ...config.outdoor, equivalentItems: undefined } });
    expect(stripped.outdoor.equivalentItems).toEqual([]);
  });
  it('RL-06 without equivalents only the pitch item counts', () => {
    const bare = { ...config, outdoor: { ...config.outdoor, equivalentItems: [] } };
    expect(pitch([inv('FELV2', 233, monthsAgo(8))], true, bare)).not.toBeNull();
  });
});
