/**
 * Client Liaison points system — scoring rules from the CL Points System Team Guide.
 * Normalized score = points ÷ seat par (1.0 = on target).
 */

export type ClSeat = 'phones' | 'outreach' | 'email';

/** Positive and negative point values for each tracked outcome. */
export const CL_POINT_VALUES = {
  /** Appointment booked — any future date (base; replaced by sooner tiers). */
  bookingBase: 10,
  /** Booked within 14 days — replaces base. */
  bookingWithin14Days: 15,
  /** Booked within 7 days / same-day backfill — replaces base. */
  bookingWithin7Days: 20,
  /** Stacks on any booking tier. */
  newPatientBonus: 5,
  annualMembership: 50,
  monthlyMembership: 15,
  directBookingReviewed: 3,
  directBookingErrorCaught: 8,
  /** Per contact worked (not per list load). */
  outreachContactWorked: 1,
  inboundCallAnswered: 1,
  voicemailReturnedSameDay: 2,
  outboundCall: 1,
  textEmailThreadResolved: 1,
  /** Stacks on outbound. */
  missedCallRecoveryBonus: 1,
  /** Stacks — speed drives conversion. */
  responseWithin5MinBonus: 1,
  missedInHoursCall: -5,
  missedOutOfHoursCall: 0,
  voicemailAging: -10,
  requestUnworked: -10,
  directBookingUnreviewed: -5,
  bookingError: -5,
  doubleBook: -5,
  holdOver48h: -5,
  complaint: -10,
} as const;

/**
 * Default weekly par (target points) by rotating seat.
 * Tune via product once rotation tracking is live; used for normalized score when a seat is known.
 */
export const CL_DEFAULT_SEAT_PAR: Record<ClSeat, number> = {
  phones: 80,
  outreach: 140,
  email: 100,
};

export const CL_SEAT_LABELS: Record<ClSeat, string> = {
  phones: 'Phones',
  outreach: 'Outreach',
  email: 'Email',
};

export type ClBookingForScore = {
  bookedAt?: string | null;
  appointmentStart?: string | null;
  newPatient?: boolean;
};

export type ClBookingPointsBreakdown = {
  bookingPoints: number;
  newPatientBonusPoints: number;
  tier: 'base' | 'within14' | 'within7';
  leadTimeDays: number | null;
};

/** Lead time in days from bookedAt → appointmentStart (null if either timestamp missing). */
export function bookingLeadTimeDays(
  bookedAt: string | null | undefined,
  appointmentStart: string | null | undefined
): number | null {
  if (!bookedAt || !appointmentStart) return null;
  const a = Date.parse(bookedAt);
  const b = Date.parse(appointmentStart);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / (1000 * 60 * 60 * 24);
}

/** Score one booking per the guide (tier replaces base; new-patient stacks). */
export function scoreClBooking(booking: ClBookingForScore): ClBookingPointsBreakdown {
  const lead = bookingLeadTimeDays(booking.bookedAt, booking.appointmentStart);
  let tier: ClBookingPointsBreakdown['tier'] = 'base';
  let bookingPoints: number = CL_POINT_VALUES.bookingBase;
  if (lead != null && lead <= 7) {
    tier = 'within7';
    bookingPoints = CL_POINT_VALUES.bookingWithin7Days;
  } else if (lead != null && lead <= 14) {
    tier = 'within14';
    bookingPoints = CL_POINT_VALUES.bookingWithin14Days;
  }
  const newPatientBonusPoints = booking.newPatient ? CL_POINT_VALUES.newPatientBonus : 0;
  return { bookingPoints, newPatientBonusPoints, tier, leadTimeDays: lead };
}

export type ClCallCounts = {
  incomingCalls: number;
  missedIncomingCallsTotal: number;
  missedIncomingDuringBusinessHours: number;
  missedIncomingOutsideBusinessHours: number;
  outgoingCalls: number;
};

export type ClCallPointsBreakdown = {
  inboundAnsweredPoints: number;
  outboundCallPoints: number;
  missedInHoursPenalty: number;
  answeredInboundCount: number;
};

/** Score OpenPhone-style call totals (answered inbound ≈ incoming − missed). */
export function scoreClCalls(counts: ClCallCounts): ClCallPointsBreakdown {
  const answeredInboundCount = Math.max(
    0,
    (counts.incomingCalls ?? 0) - (counts.missedIncomingCallsTotal ?? 0)
  );
  const inboundAnsweredPoints = answeredInboundCount * CL_POINT_VALUES.inboundCallAnswered;
  const outboundCallPoints = (counts.outgoingCalls ?? 0) * CL_POINT_VALUES.outboundCall;
  const missedInHoursPenalty =
    (counts.missedIncomingDuringBusinessHours ?? 0) * CL_POINT_VALUES.missedInHoursCall;
  return {
    inboundAnsweredPoints,
    outboundCallPoints,
    missedInHoursPenalty,
    answeredInboundCount,
  };
}

export type ClPointsCategoryTotals = {
  bookings: number;
  newPatientBonus: number;
  calls: number;
  outreach: number;
  penalties: number;
  other: number;
};

export function sumClCategoryTotals(c: ClPointsCategoryTotals): number {
  return c.bookings + c.newPatientBonus + c.calls + c.outreach + c.penalties + c.other;
}

export function normalizedClScore(points: number, par: number): number | null {
  if (!Number.isFinite(par) || par <= 0) return null;
  return points / par;
}

/** Reference rows for the in-app points guide. */
export const CL_POINTS_EARN_GUIDE: { action: string; points: string; note?: string }[] = [
  { action: 'Appointment booked', points: '10', note: 'Base value, any future date' },
  { action: '→ booked within 14 days', points: '15', note: 'Replaces base, not added' },
  { action: '→ booked within 7 days / same-day backfill', points: '20', note: 'Replaces base — highest tier' },
  { action: 'New-patient bonus', points: '+5', note: 'Stacks on any booking tier' },
  { action: 'Annual membership conversion', points: '50', note: 'The prize' },
  { action: 'Monthly membership conversion', points: '15' },
  { action: 'Direct booking reviewed & confirmed', points: '3' },
  { action: 'Direct booking error caught & corrected', points: '8' },
  { action: 'Outreach contact actually worked', points: '1', note: 'Per contact, not per list load' },
  { action: 'Inbound call answered', points: '1' },
  { action: 'Voicemail returned same business day', points: '2' },
  { action: 'Outbound call', points: '1' },
  { action: 'Text/email thread resolved', points: '1', note: 'Per thread/client' },
  { action: 'Missed-call recovery (same-day callback)', points: '+1', note: 'Stacks on outbound' },
  { action: 'Response to text/email within 5 minutes', points: '+1', note: 'Stacks' },
];

export const CL_POINTS_COST_GUIDE: { event: string; points: string; note?: string }[] = [
  { event: 'Missed in-hours call', points: '−5', note: 'Lands on the phones team that week' },
  { event: 'Missed out-of-hours call', points: '0', note: 'Largely uncontrollable' },
  { event: 'Voicemail aging > 4 hours (business day)', points: '−10' },
  { event: 'Request left unworked, no follow-up', points: '−10' },
  { event: 'Direct booking unreviewed > 4 hours', points: '−5' },
  { event: 'Booking error (wrong provider/type)', points: '−5' },
  { event: 'Double-book / scheduling conflict', points: '−5' },
  { event: 'Hold left > 48 business hours', points: '−5' },
  { event: 'Substantiated client/field complaint', points: '−10' },
  { event: 'Booking churn (book-then-cancel)', points: 'claw back', note: 'Points removed and flagged' },
];
