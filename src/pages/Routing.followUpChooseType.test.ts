/**
 * Owner decision Nov 9, 2026 (Scheduling and Routing training, SR-10 and SR-12): Book on a Forward booking card,
 * Route in Care outreach, and the other follow-up lists opened Get Best Route with the first type in the picker
 * (Euthanasia in the test practice) instead of the follow-up's type. Follow-ups now start with no type and Get
 * Best Route asks the CL to choose one. Schedule follow-ups from the visit (the planner) still bring their type.
 *
 * Routing needs dozens of APIs to render, so these tests read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routing = readFileSync(resolve(__dirname, 'Routing.tsx'), 'utf8');
const intentBlock = routing.slice(
  routing.indexOf('const typeName = (() => {'),
  routing.indexOf('})();', routing.indexOf('const typeName = (() => {'))
);

describe('Get Best Route from a follow-up: the CL chooses the visit type', () => {
  it('keeps the planner follow-up type', () => {
    expect(intentBlock).toContain("intent.origin === 'follow_up_planner'");
  });

  it('starts other follow-ups with no type instead of a default', () => {
    expect(intentBlock).not.toContain('defaultRoutingAppointmentTypeSelection');
    expect(intentBlock).toContain("setRoutingApptStatsTypeKey('')");
    expect(routing).not.toContain('default Calculate Time if still empty');
  });

  it('will not search a follow-up until a type is chosen', () => {
    expect(routing).toMatch(
      /hasActiveForwardBookingWorkspace && !routingApptStatsTypeKey\.trim\(\)\) \{\s*return \{ valid: false, error: 'Choose an appointment type for this follow-up\.' \};/
    );
  });
});
