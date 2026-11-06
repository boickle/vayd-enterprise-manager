/**
 * PAY-05-2 / PAY-05-3 — the production build payment check (scripts/check-prod-payment-env.sh).
 * Runs the script in a temp directory only. It never builds, deploys or uploads.
 * Run: npx vitest run src/config/prodPaymentEnvCheck.test.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../scripts/check-prod-payment-env.sh');
const LIVE_KEY = 'pk_live_' + 'x'.repeat(24);
const TEST_KEY = 'pk_test_' + 'x'.repeat(24);
const PROD_ERROR = 'Production build needs a live Stripe key (pk_live_)';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pay05-env-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the check in the temp dir with a clean environment, so the developer's shell VITE_ values cannot leak in. */
function runCheck(mode: string) {
  const result = spawnSync('bash', [SCRIPT, mode], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function writeEnvFile(name: string, lines: Record<string, string>) {
  writeFileSync(
    join(dir, name),
    Object.entries(lines)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n'
  );
}

describe('PAY-05-2 / PAY-05-3: production build payment check', () => {
  it('PAY-05-2: production build with a test key exits non-zero with the clear message', () => {
    writeEnvFile('.env', {
      VITE_PAYMENT_PROVIDER: 'stripe',
      VITE_STRIPE_PUBLISHABLE_KEY: TEST_KEY,
    });
    const { status, output } = runCheck('production');
    expect(status).not.toBe(0);
    expect(output).toContain(PROD_ERROR);
  });

  it('PAY-05-2: production build with the provider unset exits non-zero', () => {
    writeEnvFile('.env', { VITE_STRIPE_PUBLISHABLE_KEY: LIVE_KEY });
    const { status, output } = runCheck('production');
    expect(status).not.toBe(0);
    expect(output).toContain('VITE_PAYMENT_PROVIDER=stripe');
    expect(output).not.toContain(PROD_ERROR);
  });

  it('PAY-05-2: a test key in the shell beats a live key in the env file (Vite order)', () => {
    writeEnvFile('.env.production.local', {
      VITE_PAYMENT_PROVIDER: 'stripe',
      VITE_STRIPE_PUBLISHABLE_KEY: LIVE_KEY,
    });
    const result = spawnSync('bash', [SCRIPT, 'production'], {
      cwd: dir,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        VITE_STRIPE_PUBLISHABLE_KEY: TEST_KEY,
        VITE_PAYMENT_PROVIDER: 'stripe',
      },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(PROD_ERROR);
  });

  it('PAY-05-3: production build with pk_live_ and provider stripe passes', () => {
    writeEnvFile('.env', {
      VITE_PAYMENT_PROVIDER: 'stripe',
      VITE_STRIPE_PUBLISHABLE_KEY: LIVE_KEY,
    });
    const { status, output } = runCheck('production');
    expect(status).toBe(0);
    expect(output).not.toContain('ERROR');
  });

  it('PAY-05-3: .env.production.local overrides a test key in .env', () => {
    writeEnvFile('.env', {
      VITE_PAYMENT_PROVIDER: 'stripe',
      VITE_STRIPE_PUBLISHABLE_KEY: TEST_KEY,
    });
    writeEnvFile('.env.production.local', { VITE_STRIPE_PUBLISHABLE_KEY: LIVE_KEY });
    const { status } = runCheck('production');
    expect(status).toBe(0);
  });

  it('PAY-05-3: QA builds are not checked', () => {
    writeEnvFile('.env', { VITE_STRIPE_PUBLISHABLE_KEY: TEST_KEY });
    const { status } = runCheck('qa');
    expect(status).toBe(0);
  });
});
