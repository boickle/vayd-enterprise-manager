import { describe, expect, it } from 'vitest';
import {
  appointmentLocationLabel,
  appointmentRequestBookingPill,
  appointmentRequestCommunicationPill,
  receivedDateLabel,
  visitDateShortLabel,
  requestDataTown,
  staffInitials,
  staffShortName,
} from './appointmentRequestTableRow';

describe('requestDataTown', () => {
  it('reads the visit address city', () => {
    expect(requestDataTown({ physicalAddress: { city: ' Durham ' } })).toBe('Durham');
  });
  it('is null without an address', () => {
    expect(requestDataTown({})).toBeNull();
  });
});

describe('appointmentLocationLabel', () => {
  it('joins town and zone', () => {
    expect(appointmentLocationLabel('Durham', 'Zone 3')).toBe('Durham · Zone 3');
  });
  it('falls back to whichever is known', () => {
    expect(appointmentLocationLabel('Durham', null)).toBe('Durham');
    expect(appointmentLocationLabel(null, 'Zone 3')).toBe('Zone 3');
    expect(appointmentLocationLabel('', '')).toBeNull();
  });
});

describe('staffShortName', () => {
  const morgan = { id: 1, firstName: 'Morgan', lastName: 'Lee' };
  it('uses the first name', () => {
    expect(staffShortName(morgan, [morgan])).toBe('Morgan');
  });
  it('adds a last initial when two people share a first name', () => {
    const other = { id: 2, firstName: 'morgan', lastName: 'Ray' };
    expect(staffShortName(morgan, [morgan, other])).toBe('Morgan L.');
  });
  it('handles missing people', () => {
    expect(staffShortName(null)).toBe('');
    expect(staffInitials({ firstName: 'Beth', lastName: 'Quinn' })).toBe('BQ');
  });
});

describe('appointmentRequestBookingPill', () => {
  const base = {
    status: 'booked' as const,
    isOnHold: false,
    isBooked: false,
    needsStaffConfirmation: false,
    visitDateLabel: '12/1/26 AM',
  };
  it('never calls a hold Booked', () => {
    expect(appointmentRequestBookingPill({ ...base, isOnHold: true, isBooked: true }).label).toBe(
      'On Hold'
    );
  });
  it('shows Auto-Booked until staff confirm', () => {
    expect(
      appointmentRequestBookingPill({ ...base, needsStaffConfirmation: true, isBooked: true }).label
    ).toBe('Auto-Booked');
  });
  it('shows Booked with the visit date', () => {
    expect(appointmentRequestBookingPill({ ...base, isBooked: true })).toEqual({
      tone: 'booked',
      label: 'Booked',
      detail: '12/1/26 AM',
    });
  });
  it('shows the not-booked reason', () => {
    expect(
      appointmentRequestBookingPill({
        ...base,
        status: 'dismissed',
        notBookedReason: 'Too Expensive',
      })
    ).toEqual({ tone: 'not-booked', label: 'Not Booked', detail: 'Too Expensive' });
  });
  it('is blank for a new request', () => {
    expect(appointmentRequestBookingPill({ ...base, status: 'new' }).tone).toBe('none');
  });
});

describe('appointmentRequestCommunicationPill', () => {
  it('maps triage status', () => {
    expect(appointmentRequestCommunicationPill('new').label).toBe('Not contacted');
    expect(appointmentRequestCommunicationPill('contacted').label).toBe('Contacted');
    expect(appointmentRequestCommunicationPill('booked').label).toBe('Communication complete');
  });
  it('treats an unconfirmed auto-booked request as not contacted', () => {
    expect(
      appointmentRequestCommunicationPill('booked', { needsStaffConfirmation: true }).label
    ).toBe('Not contacted');
  });
});

describe('date labels', () => {
  const tz = 'America/New_York';
  it('formats the visit date with AM/PM in practice time', () => {
    expect(visitDateShortLabel('2026-12-01T14:00:00Z', tz)).toBe('12/1/26 AM');
    expect(visitDateShortLabel('2026-12-01T19:00:00Z', tz)).toBe('12/1/26 PM');
    expect(visitDateShortLabel(null, tz)).toBeNull();
  });
  it('formats the received date in practice time', () => {
    expect(receivedDateLabel('2026-11-10T03:00:00Z', tz)).toBe('11/09/2026');
  });
});

describe('Request column type names', () => {
  it('shows the booking type, not the client-facing reason', async () => {
    const { requestDataTypeNamesLabel } = await import('./appointmentRequestDetailDisplay');
    const rd = {
      appointmentType: 'Wellness visit / check-up',
      pets: [
        { id: '2744437', name: 'Bert' },
        { id: '2991115', name: 'Ernie' },
      ],
      petSpecificData: {
        '2744437': { needsToday: 'Wellness visit / check-up', appointmentTypeId: 1, appointmentTypeName: 'Standard' },
        '2991115': { needsToday: 'Wellness visit / check-up', appointmentTypeId: 1, appointmentTypeName: 'Standard' },
      },
    };
    expect(requestDataTypeNamesLabel(rd)).toBe('Standard');
  });
  it('falls back to the request label when pets have no type', async () => {
    const { requestDataTypeNamesLabel } = await import('./appointmentRequestDetailDisplay');
    expect(requestDataTypeNamesLabel({ appointmentType: 'Euthanasia' })).toBe('Euthanasia');
  });
});
