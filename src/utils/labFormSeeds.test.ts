import { describe, expect, it } from 'vitest';
import { LAB_FORM_SEEDS } from './labFormSeeds';

/**
 * LAB-12-3 (Labs go-live plan, docs/test-plans/labs.md): the standard forms carry no numeric
 * reference ranges and no numeric pre-fills. Choice rows keep their options and abnormal choice.
 */
describe('LAB-12-3: standard lab form seeds', () => {
  const rows = LAB_FORM_SEEDS.flatMap((form) =>
    (form.elements ?? []).map((el) => ({ form: form.name, el }))
  );

  it('LAB-12-3: every numeric row has no min, no max and no defaultValue', () => {
    const numericRows = rows.filter(({ el }) => el.valueType === 'number');
    expect(numericRows.length).toBeGreaterThan(0);
    for (const { form, el } of numericRows) {
      expect({ form, row: el.name, min: el.min, max: el.max }).toEqual({
        form,
        row: el.name,
        min: null,
        max: null,
      });
      expect({ form, row: el.name, hasDefault: 'defaultValue' in el && el.defaultValue != null }).toEqual({
        form,
        row: el.name,
        hasDefault: false,
      });
    }
  });

  it('LAB-12-3: choice rows keep their options, abnormal choice and default', () => {
    const choiceRows = rows.filter(({ el }) => el.valueType === 'select');
    expect(choiceRows.length).toBeGreaterThan(0);
    for (const { form, el } of choiceRows) {
      expect(el.options, `${form} / ${el.name}`).toEqual(['Negative', 'Positive']);
      expect(el.abnormalOptions, `${form} / ${el.name}`).toEqual(['Positive']);
      expect(el.defaultValue, `${form} / ${el.name}`).toBe('Negative');
    }
  });
});
