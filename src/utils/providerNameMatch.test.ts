import { describe, expect, it } from 'vitest';
import { findProviderByDisplayName, normalizeDoctorName } from './providerNameMatch';

const providers = [
  { id: 1, firstName: 'Hailey', lastName: 'Lloyd', name: 'Dr. Hailey Lloyd D.V.M.' },
  { id: 2, firstName: 'Brian', lastName: 'Quinn', name: 'Dr. Brian Quinn' },
];

describe('providerNameMatch', () => {
  it('drops titles and credentials', () => {
    expect(normalizeDoctorName('Dr. Hailey Lloyd D.V.M.')).toBe('hailey lloyd');
    expect(normalizeDoctorName('Hailey Lloyd, DVM')).toBe('hailey lloyd');
  });
  it('finds the primary doctor named on a request', () => {
    expect(findProviderByDisplayName(providers, 'Hailey Lloyd')?.id).toBe(1);
    expect(findProviderByDisplayName(providers, 'Dr. Brian Quinn D.V.M.')?.id).toBe(2);
  });
  it('returns nothing for an unknown or empty name', () => {
    expect(findProviderByDisplayName(providers, 'Julie Greenlaw')).toBeUndefined();
    expect(findProviderByDisplayName(providers, '')).toBeUndefined();
  });
});
