/**
 * Owner decision Nov 7, 2026 (Scheduling and Routing training review, SR-03): booking from Get Best
 * Route shows one section per pet. The "No patient" section shows only when the household has no
 * pets to book; with pets, the extra unticked section looked like something a CL had to fill in.
 *
 * SchedulerBookModal needs a dozen APIs to render, so (like SchedulerBookModal.doubleClick.test.tsx)
 * these tests read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(resolve(__dirname, 'SchedulerBookModal.tsx'), 'utf8');

describe('Get Best Route booking: "No patient" only when there are no pets', () => {
  it('adds the No patient section only when there are no pet sections', () => {
    expect(modal).toContain('setRoutingBookVisitEdits(patientRows.length > 0 ? patientRows : [noPatientRow]);');
    expect(modal).not.toContain('setRoutingBookVisitEdits([...patientRows, noPatientRow]);');
  });

  it('the "nothing selected" message mentions No patient only when it is offered', () => {
    expect(modal).toMatch(
      /routingBookVisitEdits\.some\(\(v\) => v\.isNoPatient\)\s*\?\s*'Select at least one patient, or choose No patient\.'\s*:\s*'Select at least one patient\.'/
    );
  });
});
