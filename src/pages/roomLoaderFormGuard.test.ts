// Guards the client Room Loader form against being replaced by the old hardcoded version.
// Merge 6895bcd (Oct 26, 2026) resolved a conflict by taking main's whole file, which
// silently dropped the Settings → Room Loader rebuild. A comment in the form itself can't
// survive that, so this test fails instead. If it fails after a merge, restore the
// settings-driven form; don't edit these expectations.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, 'PublicRoomLoaderForm.tsx'), 'utf8');

describe('PublicRoomLoaderForm stays settings-driven', () => {
  it('builds each pet plan from the practice settings engine', () => {
    expect(source).toMatch(/from '\.\.\/utils\/roomLoaderOfferEngine'/);
    expect(source).toMatch(/from '\.\.\/api\/roomLoaderConfig'/);
    expect(source).toMatch(/buildPlanContext/);
    expect(source).toMatch(/RoomLoaderLabsPage/);
  });

  it('does not bring back the hardcoded offers and claims', () => {
    expect(source).not.toMatch(/'comfort-care'/);
    expect(source).not.toMatch(/50% off exams/);
    expect(source).not.toMatch(/VACCINE_SEARCH_QUERIES/);
    expect(source).not.toMatch(/getEcwidProducts/);
  });

  it('stays the split, component-based form rather than the 12k-line one', () => {
    expect(source.split('\n').length).toBeLessThan(8000);
  });
});
