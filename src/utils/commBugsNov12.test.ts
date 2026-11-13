import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMergeFields, mergeValuesForPets } from './messageTemplateFields';
import { clientReachPets } from './clientReachContacts';
import { ymdInPracticeZone } from './practiceTimezone';

const QUICK_CHECK_IN =
  "Hi {{client_first_name}}, it's {{clinic_name}}. Checking in on {{patient_name}} — how is {{he_she}} doing? Reply here anytime.";

/** B9-1 (communications training review, Nov 12, 2026): a text template filled from the pets ticked on the text. */
describe('B9-1: text templates use the ticked pets', () => {
  it('one pet with a sex on record: name and pronoun', () => {
    const v = mergeValuesForPets('Maria Rivera', [{ name: 'Maple', sex: 'FemaleSpayed' }]);
    expect(applyMergeFields(QUICK_CHECK_IN, v)).toBe(
      "Hi Maria, it's Vet At Your Door. Checking in on Maple — how is she doing? Reply here anytime.",
    );
  });

  it('one pet with no sex on record: the name, never "how is they"', () => {
    const v = mergeValuesForPets('Maria Rivera', [{ name: 'Maple', sex: null }]);
    expect(applyMergeFields(QUICK_CHECK_IN, v)).toContain('Checking in on Maple — how is Maple doing?');
  });

  it('two or three pets: all their names', () => {
    expect(mergeValuesForPets('Maria Rivera', [{ name: 'Maple' }, { name: 'Juniper' }]).patient_name).toBe('Maple and Juniper');
    expect(mergeValuesForPets('Maria Rivera', [{ name: 'Maple' }, { name: 'Juniper' }, { name: 'Pepper' }]).patient_name).toBe(
      'Maple, Juniper and Pepper',
    );
  });

  it('no pet ticked: the client only, as before', () => {
    expect(mergeValuesForPets('Maria Rivera', []).patient_name).toBe('');
  });

  it("the client's pets carry their sex from the record", () => {
    expect(clientReachPets([{ id: 8578, name: 'Maple', sex: 'FemaleSpayed' }])).toEqual([
      { id: 8578, name: 'Maple', sex: 'FemaleSpayed' },
    ]);
  });
});

/** B5-2: the call window's date is the practice's date, not the UTC date. */
describe('B5-2: call date in the practice time zone', () => {
  afterEach(() => vi.useRealTimers());

  it('an 8 pm New York call on Nov 12 is Nov 12 (UTC is already Nov 13)', () => {
    expect(ymdInPracticeZone('2026-11-13T01:05:00.000Z')).toBe('2026-11-12');
  });

  it('with no call time, today in New York', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T02:30:00.000Z'));
    expect(ymdInPracticeZone()).toBe('2026-11-12');
  });
});
