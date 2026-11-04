import { beforeEach, describe, expect, it } from 'vitest';
import {
  readRoutingCalendarPreview,
  type RoutingCalendarPreviewPayloadV1,
} from './routingCalendarPreviewStorage';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import {
  buildRoutingForwardBookingIntentFromEntries,
  claimRoutingCalendarHandoff,
  claimRoutingForwardBookingIntentHandoff,
  clearRoutingForwardBookingIntent,
  readRoutingForwardBookingIntent,
  stashRoutingCalendarHandoffForNewTab,
  stashRoutingForwardBookingIntentForNewTab,
  writeRoutingForwardBookingIntent,
} from './routingForwardBookingIntent';

const row = (id: number, patientId: number, typeId: number, premeds: boolean) =>
  ({
    id,
    trackingToken: `t${id}`,
    patientId,
    patient: { name: `Pet ${patientId}` },
    client: { id: 50, firstName: 'Ada', lastName: 'Okafor' },
    intervalAmount: 12,
    intervalUnit: 'months',
    appointmentTypeId: typeId,
    appointmentTypeName: `Type ${typeId}`,
    needsPremeds: premeds,
    serviceMinutes: 40,
  }) as unknown as ForwardBookingEntry;

/** Write a two-pet household intent from the given origin and read it back. */
function roundTrip(origin: 'follow_up_planner' | 'care_outreach') {
  const rows = [row(1, 11, 4, false), row(2, 12, 6, true)];
  const intent = buildRoutingForwardBookingIntentFromEntries(rows[0], rows)!;
  writeRoutingForwardBookingIntent({ ...intent, origin, householdScope: 'household_same_target' });
  return readRoutingForwardBookingIntent()!.householdEntries!;
}

describe('routing forward-booking intent: household entries', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps each pet’s type and pre-meds for Schedule follow-ups', () => {
    const entries = roundTrip('follow_up_planner');
    expect(entries.map((e) => [e.patientId, e.appointmentTypeId, e.needsPremeds === true])).toEqual(
      [
        ['11', 4, false],
        ['12', 6, true],
      ]
    );
  });

  it('drops the row type for other lists but keeps pre-meds per pet', () => {
    const entries = roundTrip('care_outreach');
    expect(entries.map((e) => [e.appointmentTypeId, e.needsPremeds === true])).toEqual([
      [undefined, false],
      [undefined, true],
    ]);
  });
});

describe('forward booking handoff to a new tab', () => {
  it('the new tab takes over the intent once', () => {
    writeRoutingForwardBookingIntent({
      forwardBookingId: 500,
      trackingToken: 't500',
      clientId: '50',
      patientId: '3',
      origin: 'follow_up_planner',
      workspaceActive: true,
    });
    const key = stashRoutingForwardBookingIntentForNewTab();
    expect(key).toBeTruthy();
    // The new tab starts with its own empty session.
    clearRoutingForwardBookingIntent();
    expect(readRoutingForwardBookingIntent()).toBeNull();
    expect(claimRoutingForwardBookingIntentHandoff(`?fbHandoff=${key}`)).toBe(true);
    expect(readRoutingForwardBookingIntent()).toMatchObject({
      forwardBookingId: 500,
      origin: 'follow_up_planner',
      workspaceActive: true,
    });
    // Used up: a reload of that tab does not claim it again.
    clearRoutingForwardBookingIntent();
    expect(claimRoutingForwardBookingIntentHandoff(`?fbHandoff=${key}`)).toBe(false);
    expect(claimRoutingForwardBookingIntentHandoff('')).toBe(false);
  });
});

describe('calendar handoff to a new tab: a slot or a visit to show', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('carries a slot preview into the new tab before its calendar mounts', () => {
    const preview = {
      version: 1,
      option: {
        date: '2027-11-02',
        suggestedStartIso: '2027-11-02T14:00:00Z',
        doctorPimsId: '7',
        doctorName: 'Priya Patel',
        insertionIndex: 1,
      },
      serviceMinutes: 30,
      newApptMeta: { clientId: '50' },
      appointmentTypeId: 1,
    } as RoutingCalendarPreviewPayloadV1;
    const key = stashRoutingCalendarHandoffForNewTab({ calendarPreview: preview });
    expect(key).toBeTruthy();
    expect(claimRoutingCalendarHandoff(`?fbHandoff=${key}`)).toEqual({
      intent: false,
      preview: true,
      focusVisit: null,
    });
    expect(readRoutingCalendarPreview()).toMatchObject({ option: { date: '2027-11-02' } });
  });

  it('a visit to focus goes without this tab\'s forward booking', () => {
    writeRoutingForwardBookingIntent({
      forwardBookingId: 500,
      trackingToken: 't500',
      clientId: '50',
      patientId: '3',
      intervalAmount: 1,
      intervalUnit: 'months',
      serviceMinutes: 30,
    });
    const focusVisit = {
      appointmentId: 900,
      startIso: '2026-12-02T15:00:00.000Z',
      practiceDateKey: '2026-12-02',
      providerId: 7,
      label: 'Wed, Dec 2',
    };
    const key = stashRoutingCalendarHandoffForNewTab({ intent: false, focusVisit });
    clearRoutingForwardBookingIntent();
    expect(claimRoutingCalendarHandoff(`?fbHandoff=${key}`)).toEqual({
      intent: false,
      preview: false,
      focusVisit,
    });
    expect(readRoutingForwardBookingIntent()).toBeNull();
    // Nothing to hand off: no key.
    expect(stashRoutingCalendarHandoffForNewTab({ intent: false })).toBeNull();
  });
});
