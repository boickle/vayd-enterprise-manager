import { describe, expect, it } from 'vitest';
import { doctorLicenseNumber, type PracticeLicenses } from './employeeLicenses';

const all: PracticeLicenses = {
  practiceState: 'ME',
  licenses: [
    { employeeId: 7, kind: 'veterinary', state: 'ME', number: 'VET1234' },
    { employeeId: 7, kind: 'veterinary', state: 'NH', number: 'NH-55' },
    { employeeId: 9, kind: 'veterinary', state: 'NH', number: 'NH-9' },
  ],
};

describe('doctorLicenseNumber (Doctor license number template field, Nov 12, 2026)', () => {
  it("uses the practice's state by default", () => {
    expect(doctorLicenseNumber(all, 7)).toBe('VET1234');
  });
  it('can read another state', () => {
    expect(doctorLicenseNumber(all, 7, 'nh')).toBe('NH-55');
  });
  it('is blank without a license in that state, or without a doctor', () => {
    expect(doctorLicenseNumber(all, 9)).toBe('');
    expect(doctorLicenseNumber(all, null)).toBe('');
  });
});
