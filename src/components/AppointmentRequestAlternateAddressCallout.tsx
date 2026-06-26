/** Prominent alternate visit address — client answered "No" to home-address confirmation. */
export function AppointmentRequestAlternateAddressCallout({
  address,
  compact = false,
}: {
  address: string;
  compact?: boolean;
}) {
  return (
    <div
      className={[
        'appt-request-alt-address-callout',
        compact ? 'appt-request-alt-address-callout--compact' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="note"
      aria-label="Alternate visit address"
    >
      <div className="appt-request-alt-address-callout-head">
        <span className="appt-request-alt-address-badge">Alt address</span>
        <span className="appt-request-alt-address-callout-title">Alternate visit location</span>
      </div>
      <p className="appt-request-alt-address-callout-lead">
        Client said this is <strong>not</strong> their home address — route and book to this location
        only.
      </p>
      <p className="appt-request-alt-address-callout-address">{address}</p>
    </div>
  );
}
