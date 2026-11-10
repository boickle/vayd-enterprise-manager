import { afterEach, describe, expect, it, vi } from 'vitest';
import { SMS_OUTSIDE_PRODUCTION_NOTE, smsAllowsProductionOverride } from './smsEnvironment';

describe('smsEnvironment (COM-A13)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('hides the actual-client option in production', () => {
    vi.stubEnv('VITE_IS_PROD', 'true');
    expect(smsAllowsProductionOverride()).toBe(false);
  });

  it('shows it outside production, with a note that texts go to the test number unless allow-listed', () => {
    vi.stubEnv('VITE_IS_PROD', 'false');
    expect(smsAllowsProductionOverride()).toBe(true);
    expect(SMS_OUTSIDE_PRODUCTION_NOTE).toMatch(/test number/);
    expect(SMS_OUTSIDE_PRODUCTION_NOTE).toMatch(/NOTIFY_ALLOW_PHONES/);
  });
});
