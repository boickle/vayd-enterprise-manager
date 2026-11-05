import { describe, expect, it } from 'vitest';
import * as paymentsApi from './payments';

describe('PAY-A12-1: dead membership discount delete call removed', () => {
  it('does not export deleteMembershipDiscount (the DELETE route does not exist)', () => {
    expect('deleteMembershipDiscount' in paymentsApi).toBe(false);
  });
});
