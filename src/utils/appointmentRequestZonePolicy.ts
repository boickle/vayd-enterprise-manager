/** Existing client is visiting at a newly entered address, not the on-file home. */
export function isUsingAlternateVisitAddress(
  isThisTheAddressWhereWeWillCome?: string | null,
): boolean {
  return isThisTheAddressWhereWeWillCome === 'No';
}

/**
 * Existing clients may still send a request when the on-file home address is
 * outside the service area. They cannot auto-book. A newly entered alternate
 * visit address stays blocked if it is out of area.
 */
export function allowAppointmentRequestWhenOutOfArea(opts: {
  isExistingClient: boolean;
  usingAlternateVisitAddress: boolean;
}): boolean {
  return opts.isExistingClient && !opts.usingAlternateVisitAddress;
}

export const ON_FILE_OUT_OF_AREA_REQUEST_ONLY_MESSAGE =
  "This address is outside our usual service area. You can still request an appointment — we can't book a time online, and our team will follow up.";
