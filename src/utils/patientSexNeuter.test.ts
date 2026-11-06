import { describe, expect, it } from 'vitest';
import { sexWordOf } from './patientSexNeuter';

describe('sexWordOf', () => {
  it.each([
    ['MaleNeutered', 'Male'],
    ['FemaleSpayed', 'Female'],
    ['Female Spayed', 'Female'],
    ['Male', 'Male'],
    ['Gelding', 'Gelding'],
    ['Unknown', null],
    [null, null],
    ['', null],
  ])('%s → %s', (sex, word) => {
    expect(sexWordOf(sex)).toBe(word);
  });
});
