import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * On a household visit the pet tabs are the visit's navigation and sit right under the
 * header; the patient alert belongs to the selected pet and renders below the tabs.
 */
describe('SOAP page: patient alert renders below the household pet tabs', () => {
  const src = readFileSync(resolve(__dirname, 'SoapEncounterPage.tsx'), 'utf8');

  it('places <SoapPatientAlerts> after the pet tab list', () => {
    const tabs = src.indexOf('aria-label="Pets at this visit"');
    const alert = src.indexOf('<SoapPatientAlerts ');
    expect(tabs).toBeGreaterThan(0);
    expect(alert).toBeGreaterThan(tabs);
  });
});
