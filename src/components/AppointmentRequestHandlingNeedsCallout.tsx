/** Top highlight when an auto-booked owner expects confirmation after handling-needs review. */
export function AppointmentRequestHandlingNeedsCallout({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      className={[
        'appt-request-handling-needs-callout',
        compact ? 'appt-request-handling-needs-callout--compact' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="note"
      aria-label="Handling needs pending confirmation"
    >
      <div className="appt-request-handling-needs-callout-head">
        <span className="appt-request-handling-needs-badge">Handling review</span>
        <span className="appt-request-handling-needs-callout-title">
          Owner expects confirmation
        </span>
      </div>
      <p className="appt-request-handling-needs-callout-lead">
        The owner was told we held this appointment and will confirm after reviewing records for
        handling needs (calming meds, muzzle, and/or extra handling) they noted on the form.
      </p>
    </div>
  );
}
