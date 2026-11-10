import { describe, expect, it } from 'vitest';
import { isClientLogin } from './MembershipPayment';

// P-06: the payment page pre-fills the cardholder and address only for a client's own login.
// useAuth gives `role` as a list, so a plain `role !== 'client'` check never matched.
describe('isClientLogin', () => {
  it('is true for the list a client login carries', () => {
    expect(isClientLogin(['client'])).toBe(true);
    expect(isClientLogin(['Client'])).toBe(true);
  });
  it('accepts a single role string', () => {
    expect(isClientLogin('client')).toBe(true);
  });
  it('is false for staff logins and when no role is known', () => {
    expect(isClientLogin(['employee', 'admin'])).toBe(false);
    expect(isClientLogin('employee')).toBe(false);
    expect(isClientLogin(undefined)).toBe(false);
    expect(isClientLogin([])).toBe(false);
  });
});
