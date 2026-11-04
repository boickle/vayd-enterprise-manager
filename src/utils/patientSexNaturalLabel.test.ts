import { describe, expect, it } from 'vitest';
import { patientSexNaturalLabelFromRecord as f } from './schedulerVisitDisplay';

describe('patientSexNaturalLabelFromRecord', () => {
  it.each([
    [{ sex: 'MaleNeutered', neuterStatus: 'Neutered' }, 'Male neutered'],
    [{ sex: 'MN' }, 'Male neutered'],
    [{ sex: 'Male', neuterStatus: 'Neutered' }, 'Male neutered'],
    [{ sex: 'Male', neuterStatus: true }, 'Male neutered'],
    [{ sex: 'Male', neuterStatus: 'Castrated' }, 'Male neutered'],
    [{ sex: 'FemaleSpayed', neuterStatus: 'Spayed' }, 'Female spayed'],
    [{ sex: 'FS' }, 'Female spayed'],
    [{ sex: 'Female', neuterStatus: 'Spayed' }, 'Female spayed'],
    [{ sex: 'Female', neuterStatus: 'Neutered' }, 'Female spayed'],
    [{ sex: 'Female', altered: true }, 'Female spayed'],
    [{ sex: 'Male', neuterStatus: 'Intact' }, 'Male intact'],
    [{ sex: 'MI' }, 'Male intact'],
    [{ sex: 'Male', neuterStatus: false }, 'Male intact'],
    [{ sex: 'Female', neuterStatus: 'Unaltered' }, 'Female intact'],
    [{ sex: 'FI' }, 'Female intact'],
    [{ sex: 'Unknown' }, 'Unknown'],
    [{ sex: { name: 'Male Neutered' }, neuterStatus: 'Neutered' }, 'Male neutered'],
  ])('%j -> %s', (rec, expected) => {
    expect(f(rec as Record<string, unknown>)).toBe(expected);
  });
  it('is null with no sex data', () => {
    expect(f({ name: 'Rex' })).toBeNull();
  });
});

import { patientSexDisplayFromRecord, patientSexListDisplayFromRecord } from './schedulerVisitDisplay';

describe('patientSexDisplayFromRecord never repeats the neuter status', () => {
  it.each([
    [{ sex: 'MaleNeutered', neuterStatus: 'Neutered' }, 'MaleNeutered'],
    [{ sex: 'Female Spayed', neuterStatus: 'Spayed' }, 'Female Spayed'],
    [{ sex: 'MN', neuterStatus: 'Neutered' }, 'MN'],
    [{ sex: 'FemaleIntact', altered: 'Intact' }, 'FemaleIntact'],
    [{ sex: 'Male', neuterStatus: 'Neutered' }, 'Male Neutered'],
    [{ sex: 'Female', neuterStatus: 'Spayed' }, 'Female Spayed'],
    [{ sex: 'Male' }, 'Male'],
  ])('%j -> %s', (rec, expected) => {
    expect(patientSexDisplayFromRecord(rec as Record<string, unknown>)).toBe(expected);
    expect(patientSexListDisplayFromRecord(rec as Record<string, unknown>)).toBe(expected);
  });
});
