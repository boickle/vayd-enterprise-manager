/**
 * RL-03 (go-live plan docs/test-plans/room-loader.md): the settings-driven form is back, so the
 * practice's settings document, not hardcoded codes, decides what each pet is offered.
 * RL-03-16 / 16b / 16c / 16d: no birthdate, age boundaries, large animals, blank species.
 */
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { vaydRoomLoaderConfigSeed } from '../../utils/roomLoaderConfigSeed';
import { resolvePetPlan, type ResolvedPetPlan } from '../../utils/roomLoaderOfferEngine';
import { buildPlanContext } from './roomLoaderPlanContext';

const config = vaydRoomLoaderConfigSeed();
const EASTERN = 'America/New_York';

function plan(patient: Record<string, unknown>, asOf: DateTime, formData: Record<string, unknown> = {}) {
  const ctx = buildPlanContext({
    data: { appointments: [] },
    patient: { patientId: 1, ...patient },
    petKey: 'pet0',
    formData,
    history: [],
    asOf,
  });
  return resolvePetPlan(config, ctx);
}

const panelIds = (p: ResolvedPetPlan) => p.panelRules.map((r) => r.id);
const offerNames = (p: ResolvedPetPlan) =>
  [...p.universalOffers, ...p.gatedOffers].map((o) => o.displayName ?? o.item.name);

describe('RL-03-16 no birthdate', () => {
  it('only rules with no age limit apply, and nothing throws', () => {
    const p = plan({ species: 'Canine', dob: null }, DateTime.fromISO('2026-10-02T12:00', { zone: EASTERN }));
    expect(panelIds(p)).toEqual([]); // every panel rule has an age window
    expect(offerNames(p).length).toBeGreaterThan(0); // unbounded add-ons still offered
    expect(p.gatedOffers.every((o) => o.item != null)).toBe(true);
  });
});

describe('RL-03-16b age boundaries (DOB stored at midnight UTC, Eastern evening)', () => {
  // Pet born Apr 2 2026 (stored 2026-04-02T00:00:00Z); six months old on Oct 2.
  const dob = '2026-04-02T00:00:00.000Z';
  const evening = (iso: string) => DateTime.fromISO(`${iso}T20:00`, { zone: EASTERN });

  it('puppy fecal is still offered the evening before the 6-month birthday and gone on it', () => {
    expect(panelIds(plan({ species: 'Canine', dob }, evening('2026-10-01')))).toContain('r_puppy');
    expect(panelIds(plan({ species: 'Canine', dob }, evening('2026-10-02')))).not.toContain('r_puppy');
  });

  it('senior starts at 96 months, not a day early', () => {
    const seniorDob = '2018-10-02T00:00:00.000Z'; // 8 years on 2026-10-02
    expect(panelIds(plan({ species: 'Canine', dob: seniorDob }, evening('2026-10-01')))).not.toContain('rule_senior_dog');
    expect(panelIds(plan({ species: 'Canine', dob: seniorDob }, evening('2026-10-02')))).toContain('rule_senior_dog');
  });

  it('kitten FeLV is offered through month 11 and ends at 12 months', () => {
    const catDob = '2025-10-02T00:00:00.000Z'; // 12 months on 2026-10-02
    const before = plan({ species: 'Feline', dob: catDob }, evening('2026-10-01'), { pet0_outdoorAccess: 'no' });
    const on = plan({ species: 'Feline', dob: catDob }, evening('2026-10-02'), { pet0_outdoorAccess: 'no' });
    const felv = (p: ResolvedPetPlan) => p.gatedOffers.some((o) => /felv|leuk/i.test(o.displayName ?? o.item.name));
    expect(felv(before)).toBe(true);
    expect(felv(on)).toBe(false);
  });
});

describe('RL-03-16c large animals get only species-neutral asks', () => {
  for (const species of ['Equine', 'Caprine']) {
    it(`${species}: no dog or cat vaccines, panels, pedicure, microchip, outdoor or membership-size asks`, () => {
      const p = plan({ species, dob: '2018-05-01T00:00:00.000Z' }, DateTime.fromISO('2026-10-02T12:00', { zone: EASTERN }));
      expect(p.panelRules).toEqual([]);
      expect(p.gatedOffers).toEqual([]);
      expect(p.outdoorPitch).toBeNull();
      expect(p.askOutdoorAccess).toBe(false);
      expect(p.itemQuestions).toEqual([]);
      const names = offerNames(p).join('|');
      expect(names).not.toMatch(/nail|pedicure|microchip|anal gland/i);
    });
  }
});

describe('RL-03-16d unknown species is not treated as a dog', () => {
  it('blank species gets only "any" rules', () => {
    const p = plan({ species: '', dob: '2020-01-01T00:00:00.000Z' }, DateTime.fromISO('2026-10-02T12:00', { zone: EASTERN }));
    expect(p.panelRules).toEqual([]);
    expect(p.gatedOffers).toEqual([]);
    expect(p.itemQuestions).toEqual([]);
    const anyOnly = config.universalOffers.filter((o) => o.enabled && o.species.includes('any')).length;
    expect(p.universalOffers).toHaveLength(anyOnly);
  });
  it('missing species behaves like blank', () => {
    const p = plan({ dob: '2020-01-01T00:00:00.000Z' }, DateTime.fromISO('2026-10-02T12:00', { zone: EASTERN }));
    expect(p.panelRules).toEqual([]);
  });
});
