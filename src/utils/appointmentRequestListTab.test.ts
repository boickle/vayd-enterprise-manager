import { describe, expect, it } from 'vitest';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import { appointmentRequestListTabForSubmission } from './appointmentRequestDisplay';

function booked(extra: Partial<AppointmentRequestSubmissionItem>): AppointmentRequestSubmissionItem {
  return {
    id: 1,
    practiceId: 1,
    submittedAt: '2026-11-01T14:00:00Z',
    requestData: {},
    created: '2026-11-01T14:00:00Z',
    updated: '2026-11-01T14:00:00Z',
    status: 'booked',
    bookedAppointmentId: 99,
    linkedVisitIsHold: false,
    ...extra,
  };
}

describe('appointmentRequestListTabForSubmission (booked requests)', () => {
  it('is Booked only when communication is complete and records are done', () => {
    expect(
      appointmentRequestListTabForSubmission(
        booked({ communicationStatus: 'complete', records: null })
      )
    ).toBe('booked');
  });

  it('stays In progress while communication is open', () => {
    expect(
      appointmentRequestListTabForSubmission(booked({ communicationStatus: 'contacted' }))
    ).toBe('contacted');
  });

  it('stays In progress while records are still out', () => {
    expect(
      appointmentRequestListTabForSubmission(
        booked({
          communicationStatus: 'complete',
          records: {
            state: 'requested',
            finished: false,
            choice: null,
            total: 1,
            pending: 1,
            toSummarize: 0,
            patientId: 5,
          },
        })
      )
    ).toBe('contacted');
  });

  it('SCH-R9: a booked request whose visit was cancelled is back In progress', () => {
    const meta = new Map([[99, { appointmentCancelled: true } as never]]);
    expect(
      appointmentRequestListTabForSubmission(booked({ communicationStatus: 'complete', records: null }), meta)
    ).toBe('contacted');
  });

  it('a hold is On hold whatever the other columns say', () => {
    expect(
      appointmentRequestListTabForSubmission(
        booked({ linkedVisitIsHold: true, communicationStatus: 'complete' })
      )
    ).toBe('on_hold');
  });
});
