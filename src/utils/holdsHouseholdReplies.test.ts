import { describe, expect, it } from 'vitest';
import type { HoldListItem } from '../api/holds';
import {
  groupHoldsByClientHousehold,
  holdGroupUnreadReplies,
  sortHoldHouseholdGroupsByAppointmentStart,
} from './holdsHousehold';

function hold(id: number, clientId: number, start: string, extra: Partial<HoldListItem> = {}): HoldListItem {
  return {
    id,
    appointmentStart: start,
    appointmentEnd: start,
    allDay: false,
    holdPlacedAtIso: start,
    appointmentType: { id: 1, name: 'HOLD', prettyName: 'Hold' },
    client: {
      id: clientId,
      firstName: 'C',
      lastName: `L${clientId}`,
      phone1: null,
      email: null,
      secondEmail: null,
      address1: null,
      city: null,
      state: null,
      zipcode: null,
    },
    patient: { id: id * 10, name: `Pet${id}`, pimsId: null },
    primaryProvider: null,
    createdByEmployee: null,
    holdOwner: null,
    holdOwnerAssignedAt: null,
    ownerBucket: 'unassigned',
    effectiveOwnerEmployeeId: null,
    ownerIsCurrentUser: false,
    source: 'manual',
    description: null,
    instructions: null,
    pimsId: null,
    appointmentRequestSubmissionId: null,
    forwardBooking: null,
    ...extra,
  } as HoldListItem;
}

const unread = { count: 2, lastAt: '2026-11-12T12:00:00Z', lastChannel: 'text' as const, lastPreview: 'Friday?' };

describe('Hold tab unread replies (SCH-R10)', () => {
  it('sorts rows with unread replies to the top, then by appointment start', () => {
    const groups = groupHoldsByClientHousehold(
      [
        hold(1, 1, '2026-11-16T14:00:00Z'),
        hold(2, 2, '2026-11-20T14:00:00Z', { unreadReplies: unread }),
        hold(3, 3, '2026-11-17T14:00:00Z'),
      ],
      'America/New_York',
    );
    const order = sortHoldHouseholdGroupsByAppointmentStart(groups).map((g) => g.anchor.id);
    expect(order).toEqual([2, 1, 3]);
  });

  it('is red when nobody or I own the hold, blue when someone else does', () => {
    const [unowned] = groupHoldsByClientHousehold(
      [hold(1, 1, '2026-11-16T14:00:00Z', { unreadReplies: unread })],
      'America/New_York',
    );
    expect(holdGroupUnreadReplies(unowned)).toEqual({ count: 2, holdId: 1, mine: true });
    const [others] = groupHoldsByClientHousehold(
      [hold(2, 2, '2026-11-16T14:00:00Z', { unreadReplies: unread, effectiveOwnerEmployeeId: 9 })],
      'America/New_York',
    );
    expect(holdGroupUnreadReplies(others)?.mine).toBe(false);
    const [read] = groupHoldsByClientHousehold([hold(3, 3, '2026-11-16T14:00:00Z')], 'America/New_York');
    expect(holdGroupUnreadReplies(read)).toBeNull();
  });
});
