import { describe, expect, it } from 'vitest';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { buildRoutingAppointmentRequestIntentFromSubmission } from './routingAppointmentRequestIntent';

function item(requestData: Record<string, unknown>): AppointmentRequestSubmissionItem {
  return {
    id: 42,
    practiceId: 1,
    submittedAt: '2026-11-11T12:00:00Z',
    requestData,
    created: '2026-11-11T12:00:00Z',
    updated: '2026-11-11T12:00:00Z',
  };
}

describe('buildRoutingAppointmentRequestIntentFromSubmission — waitlist opt-in', () => {
  it('carries the client’s “join the waitlist if sooner” choice to Book', () => {
    const intent = buildRoutingAppointmentRequestIntentFromSubmission(
      item({ joinWaitlistIfSooner: true }),
    );
    expect(intent.joinWaitlistIfSooner).toBe(true);
  });

  it('leaves it off when the client did not ask', () => {
    const intent = buildRoutingAppointmentRequestIntentFromSubmission(item({}));
    expect(intent.joinWaitlistIfSooner).toBeUndefined();
  });
});
