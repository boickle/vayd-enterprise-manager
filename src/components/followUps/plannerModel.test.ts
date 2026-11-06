import { DateTime } from 'luxon';
import { applyMergeFields, withClinicDefaults } from '../../utils/messageTemplateFields';
import { SYSTEM_TEMPLATE_SEEDS } from '../../utils/messageTemplateSeeds';
import {
  addToVisitClNote,
  bookingUndoOpen,
  confirmationTextParts,
  tidyMergedText,
  buildFollowUpConfirmationText,
  confirmationSendProvider,
  dispositionModeForOutcomes,
  joinNames,
  plannerIntervalForApi,
  plannerIntervalLabel,
  plannerTargetDate,
  providerTextLabel,
  reminderFit,
  smsSegmentCount,
  type ConfirmationBooking,
} from './plannerModel';

const TZ = 'America/New_York';
const day = (iso: string) => DateTime.fromISO(iso, { zone: TZ });
const TODAY = day('2026-11-03T14:00');

describe('timing', () => {
  it('presets land on calendar dates, including month ends and leap years', () => {
    expect(plannerTargetDate({ kind: 'preset', key: '2w' }, TODAY).toISODate()).toBe('2026-11-17');
    expect(plannerTargetDate({ kind: 'preset', key: '1y' }, TODAY).toISODate()).toBe('2027-11-03');
    expect(plannerTargetDate({ kind: 'preset', key: '1m' }, day('2027-01-31')).toISODate()).toBe(
      '2027-02-28'
    );
    expect(plannerTargetDate({ kind: 'preset', key: '1y' }, day('2028-02-29')).toISODate()).toBe(
      '2029-02-28'
    );
  });

  it('custom amounts and specific dates', () => {
    expect(
      plannerTargetDate({ kind: 'custom', amount: 10, unit: 'weeks' }, TODAY).toISODate()
    ).toBe('2027-01-12');
    expect(plannerTargetDate({ kind: 'date', date: '2027-01-20' }, TODAY).toISODate()).toBe(
      '2027-01-20'
    );
  });

  it('labels', () => {
    expect(plannerIntervalLabel({ kind: 'preset', key: '6m' }, TODAY)).toBe('In 6 months');
    expect(plannerIntervalLabel({ kind: 'custom', amount: 1, unit: 'weeks' }, TODAY)).toBe(
      'In 1 week'
    );
    expect(plannerIntervalLabel({ kind: 'custom', amount: 10, unit: 'days' }, TODAY)).toBe(
      'In 10 days'
    );
    expect(plannerIntervalLabel({ kind: 'date', date: '2027-01-20' }, TODAY)).toBe(
      'On Jan 20, 2027'
    );
  });

  it('API intervals: years become months, a date becomes days until it', () => {
    expect(plannerIntervalForApi({ kind: 'preset', key: '1y' }, TODAY)).toEqual({
      intervalAmount: 12,
      intervalUnit: 'months',
    });
    expect(plannerIntervalForApi({ kind: 'custom', amount: 2, unit: 'years' }, TODAY)).toEqual({
      intervalAmount: 24,
      intervalUnit: 'months',
    });
    expect(plannerIntervalForApi({ kind: 'preset', key: '2w' }, TODAY)).toEqual({
      intervalAmount: 2,
      intervalUnit: 'weeks',
    });
    expect(plannerIntervalForApi({ kind: 'date', date: '2026-11-20' }, TODAY)).toEqual({
      intervalAmount: 17,
      intervalUnit: 'days',
    });
  });
});

describe('reminderFit (30 days before to 45 days after)', () => {
  const visit = day('2026-11-17');
  it('colors against the visit', () => {
    expect(reminderFit(day('2026-12-16'), visit, TODAY)).toBe('fits'); // 29 after
    expect(reminderFit(day('2027-01-01'), visit, TODAY)).toBe('fits'); // 45 after
    expect(reminderFit(day('2027-01-02'), visit, TODAY)).toBe('later'); // 46 after
    expect(reminderFit(day('2026-11-04'), visit, TODAY)).toBe('fits'); // 13 before
    expect(reminderFit(day('2027-11-10'), day('2028-01-01'), TODAY)).toBe('early');
    expect(reminderFit(day('2026-09-12'), visit, TODAY)).toBe('overdue');
  });
  it('without a visit flags anything due within 60 days', () => {
    expect(reminderFit(day('2026-12-20'), null, TODAY)).toBe('soon');
    expect(reminderFit(day('2027-03-08'), null, TODAY)).toBe('later');
  });
  it('reminders an upcoming visit already covers', () => {
    expect(reminderFit(day('2026-12-02'), null, TODAY, { coveredByUpcomingVisit: true })).toBe(
      'booked'
    );
  });
});

describe('dispositionModeForOutcomes', () => {
  it('booking beats everything, so Marvin (booked + CLs) reads as booked', () => {
    expect(dispositionModeForOutcomes(['send_to_cls', 'booked'])).toBe('booked_at_appointment');
  });
  it('then CLs, labs, already booked, none', () => {
    expect(dispositionModeForOutcomes(['labs_pending', 'send_to_cls'])).toBe('forward_book_fields');
    expect(dispositionModeForOutcomes(['already_booked', 'labs_pending'])).toBe('labs_pending');
    expect(dispositionModeForOutcomes(['already_booked'])).toBe('already_booked');
    expect(dispositionModeForOutcomes(['none'])).toBe('not_appropriate');
    expect(dispositionModeForOutcomes([])).toBeNull();
  });
});

describe('owner text', () => {
  const patel = { id: 1, name: 'Priya Patel', firstName: 'Priya', lastName: 'Patel' };
  const tech = { id: 9, name: 'Tech Team' };
  const at = (iso: string, hours = 2) => {
    const s = day(iso);
    return { start: s, windowStart: s, windowEnd: s.plus({ hours }) };
  };
  const bookings: ConfirmationBooking[] = [
    { ...at('2027-11-02T09:00'), petNames: ['Angel', 'Marvin'], provider: patel },
    { ...at('2026-11-16T09:00'), petNames: ['Marvin'], provider: tech },
    {
      ...at('2026-12-02T10:00'),
      petNames: ['Pepper'],
      provider: patel,
      joiningPetNames: ['Greta'],
    },
  ];

  it('names providers', () => {
    expect(providerTextLabel(patel)).toBe('Dr. Patel');
    expect(providerTextLabel(tech)).toBe('our tech team');
    expect(providerTextLabel({ id: 2, name: 'Dr. Sam Nguyen' })).toBe('Dr. Nguyen');
  });

  it('lists bookings in date order, the same pet twice, CL and labs mentions', () => {
    const text = buildFollowUpConfirmationText({
      clientFirstName: 'Ada',
      practiceName: 'Vet At Your Door',
      bookings,
      clMentions: [{ petNames: ['Biscuit'], around: day('2026-12-03') }],
      labsPetNames: ['Fluffy'],
    });
    expect(text).toBe(
      [
        "Hi Ada, thanks for having us today! Here's what we booked:",
        '• Marvin: Mon, Nov 16, 2026, arriving between 9:00 AM and 11:00 AM with our tech team',
        '• Pepper: Wed, Dec 2, 2026, arriving between 10:00 AM and 12:00 PM with Dr. Patel (same visit as Greta)',
        '• Angel & Marvin: Tue, Nov 2, 2027, arriving between 9:00 AM and 11:00 AM with Dr. Patel',
        '',
        "We'll reach out around December 2026 to schedule Biscuit. We'll be in touch about Fluffy once lab results are back.",
        '',
        'Reply to this text if anything needs to change. – Vet At Your Door',
      ].join('\n')
    );
  });

  it('leaves out mentions when there are none', () => {
    const text = buildFollowUpConfirmationText({
      clientFirstName: null,
      practiceName: 'VAYD',
      bookings: [bookings[0]],
    });
    expect(text.startsWith('Hi, thanks')).toBe(true);
    expect(text).not.toContain("We'll reach out");
  });

  it('sends from the earliest visit provider; Tech Team falls back to the main line', () => {
    expect(confirmationSendProvider(bookings)).toBeNull();
    expect(confirmationSendProvider([bookings[0], bookings[2]])).toEqual(patel);
  });

  it('joins names and counts texts', () => {
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B & C');
    expect(smsSegmentCount('x'.repeat(160))).toBe(1);
    expect(smsSegmentCount('x'.repeat(161))).toBe(2);
  });
});

describe('undo window', () => {
  it('is open for 10 seconds', () => {
    expect(bookingUndoOpen(0, 9_999)).toBe(true);
    expect(bookingUndoOpen(0, 10_000)).toBe(false);
  });
});

describe('Settings template for the confirmation text', () => {
  const seed = SYSTEM_TEMPLATE_SEEDS.find(
    (t) => t.systemKey === 'follow_up_booked_confirmation_sms'
  )!;
  const booking: ConfirmationBooking = {
    start: day('2026-11-16T09:00'),
    windowStart: day('2026-11-16T09:00'),
    windowEnd: day('2026-11-16T11:00'),
    petNames: ['Marvin'],
    provider: { id: 1, name: 'Priya Patel', lastName: 'Patel' },
  };
  const render = (args: Parameters<typeof buildFollowUpConfirmationText>[0]) => {
    const parts = confirmationTextParts(args);
    return tidyMergedText(
      applyMergeFields(
        seed.body,
        withClinicDefaults({
          client_first_name: args.clientFirstName ?? '',
          booked_visits: parts.bookedVisits,
          other_follow_ups: parts.otherFollowUps,
          clinic_name: args.practiceName,
        })
      )
    );
  };

  it('the seed wording matches the built-in text, with and without CL/labs lines', () => {
    const base = { clientFirstName: 'Ada', practiceName: 'Vet At Your Door', bookings: [booking] };
    expect(render(base)).toBe(buildFollowUpConfirmationText(base));
    const withMore = { ...base, labsPetNames: ['Biscuit'] };
    expect(render(withMore)).toBe(buildFollowUpConfirmationText(withMore));
    const noName = { ...base, clientFirstName: null };
    expect(render(noName)).toBe(buildFollowUpConfirmationText(noName));
  });
});

describe('addToVisitClNote', () => {
  const at = (iso: string) => DateTime.fromISO(iso, { zone: 'America/New_York' });
  const base = {
    petName: 'Maple',
    otherPetNames: [],
    householdName: 'Rivera',
    visitStart: at('2026-11-25T09:00'),
    windowStart: at('2026-11-25T09:00'),
    windowEnd: at('2026-11-25T11:00'),
    provider: { id: 3, name: 'Dana Demo', firstName: 'Dana', lastName: 'Demo' },
    appointmentId: 2010445,
    needs: 'Annual Wellness Visit',
    addedMinutes: 30,
    lateStops: [{ client: 'Smith', minutesPastWindow: 15 }],
  };

  it('says who suggested it, which visit, why it was not added, and asks the CL to look into it', () => {
    expect(addToVisitClNote({ ...base, suggestedBy: 'Dr. Dana Demo', visitPetNames: ['Juno'] })).toBe(
      "Dr. Dana Demo suggested adding Maple to Juno's visit (Rivera) on Wed Nov 25, 9:00–11:00 AM " +
        "arrival, with Dr. Dana Demo (appt #2010445), but didn't add Maple because a later stop " +
        'could run late: Smith may arrive 15 min past their window. Can you look into this and ' +
        'add Maple if it can work? Maple needs: Annual Wellness Visit. Adds about 30 min.'
    );
  });

  it('adds the other pets, the pre-meds window change and the doctor note', () => {
    expect(
      addToVisitClNote({
        ...base,
        otherPetNames: ['Pepper'],
        needsPremeds: true,
        petNote: 'Bring muzzle.',
        premedsWindow: { start: at('2026-11-25T09:00'), end: at('2026-11-25T10:00') },
        lateStops: [
          { client: 'Smith', minutesPastWindow: 15 },
          { client: 'Lee', minutesPastWindow: 0 },
        ],
      })
    ).toBe(
      'A staff member suggested adding Maple and Pepper to the Rivera visit on Wed Nov 25, ' +
        "9:00–11:00 AM arrival, with Dr. Dana Demo (appt #2010445), but didn't add them because " +
        'a later stop could run late: Smith may arrive 15 min past their window; Lee may arrive ' +
        'at the edge of their window. Can you look into this and add them if it can work? ' +
        'Maple needs: Annual Wellness Visit (needs pre-meds). Note: Bring muzzle. ' +
        'Adds about 30 min for both pets. Arrival window narrows to 9:00–10:00 AM for every pet (pre-meds).'
    );
  });
});
