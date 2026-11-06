import { describe, expect, it } from 'vitest';
import { defaultPreMedsAsk, petHasPremedsAlert } from './roomLoaderPremeds';

describe('pre-meds refill question default', () => {
  const data = {
    patients: [{ id: 1, needsPremeds: true }, { id: 2, needsPremeds: false }, { id: 3 }],
    appointments: [{ patient: { id: 3 }, needsPremeds: true }, { patient: { id: 4, needsPremeds: true } }],
  };

  it('a pet with the chart pre-meds alert has the alert', () => {
    expect(petHasPremedsAlert(1, data)).toBe(true);
  });
  it('a pet without it does not', () => {
    expect(petHasPremedsAlert(2, data)).toBe(false);
    expect(petHasPremedsAlert(99, data)).toBe(false);
    expect(petHasPremedsAlert(null, data)).toBe(false);
  });
  it('a visit flagged for pre-meds counts too', () => {
    expect(petHasPremedsAlert(3, data)).toBe(true);
    expect(petHasPremedsAlert(4, data)).toBe(true);
  });
  it('defaults to Yes with the alert and No without, until staff answer', () => {
    expect(defaultPreMedsAsk(undefined, true)).toBe(true);
    expect(defaultPreMedsAsk(undefined, false)).toBe(false);
    expect(defaultPreMedsAsk(null, true)).toBe(true);
  });
  it("keeps staff's own answer, even No on a pet with the alert", () => {
    expect(defaultPreMedsAsk(false, true)).toBe(false);
    expect(defaultPreMedsAsk(true, false)).toBe(true);
  });
});
