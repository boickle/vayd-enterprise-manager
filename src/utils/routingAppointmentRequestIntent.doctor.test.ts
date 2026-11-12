/** Route on the Appointments list defaults to the preferred doctor, else the pet's primary doctor (owner, Nov 11, 2026). */
import { describe, expect, it } from 'vitest';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { buildRoutingAppointmentRequestIntentFromSubmission } from './routingAppointmentRequestIntent';

function item(requestData: Record<string, unknown>): AppointmentRequestSubmissionItem {
  return {
    id: 7,
    practiceId: 1,
    submittedAt: '2026-11-11T12:00:00Z',
    requestData,
    created: '2026-11-11T12:00:00Z',
    updated: '2026-11-11T12:00:00Z',
  };
}

describe('Route doctor default', () => {
  it('uses the preferred doctor the client picked', () => {
    const intent = buildRoutingAppointmentRequestIntentFromSubmission(
      item({
        preferredDoctorId: '99709',
        preferredDoctor: 'Dr. Hailey Lloyd D.V.M.',
        pets: [{ name: 'Bert', primaryProviderName: 'Brian Quinn' }],
      })
    );
    expect(intent.preferredDoctorId).toBe('99709');
    expect(intent.primaryDoctorName).toBeUndefined();
  });

  it('falls back to the pet’s primary doctor when no doctor was picked', () => {
    const intent = buildRoutingAppointmentRequestIntentFromSubmission(
      item({ pets: [{ name: 'Bert', primaryProviderName: 'Hailey Lloyd' }] })
    );
    expect(intent.preferredDoctorId).toBeUndefined();
    expect(intent.primaryDoctorName).toBe('Hailey Lloyd');
  });

  it('sends no doctor for a new client with no primary', () => {
    const intent = buildRoutingAppointmentRequestIntentFromSubmission(
      item({ pets: [{ name: 'Tata' }] })
    );
    expect(intent.preferredDoctorId).toBeUndefined();
    expect(intent.primaryDoctorName).toBeUndefined();
  });
});
