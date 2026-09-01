import { http } from './http';

/**
 * Scout client writes.
 *
 * `POST /clients` and `POST /clients/upsert` are deliberately not wrapped here — both are
 * eVet-import entry points keyed on (pimsId, practice). Creating a client through them
 * would hand ownership to eVet. Use `createClientScout` instead. Deactivate rather than
 * delete so appointment and billing history survives.
 */

/**
 * Fields accepted by the Scout client write endpoints. Anything not listed here is
 * either eVet-owned or lives on another table (e.g. portal login on `users`).
 */
export type ScoutClientWrite = {
  practiceId?: number;
  namePrefix?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  secondFirstName?: string | null;
  secondLastName?: string | null;
  email?: string | null;
  secondEmail?: string | null;
  phone1?: string | null;
  phone1Type?: string | null;
  phone2?: string | null;
  phone2Type?: string | null;
  primaryProviderId?: number | null;
  referralSource?: string | null;
  referralClientId?: number | null;
  noEmail?: boolean;
  address1?: string | null;
  address2?: string | null;
  address3?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  country?: string | null;
  county?: string | null;
  mailingSameAsService?: boolean;
  mailingAddress1?: string | null;
  mailingAddress2?: string | null;
  mailingCity?: string | null;
  mailingState?: string | null;
  mailingZipcode?: string | null;
  mailingCountry?: string | null;
  extraAddressLabel?: string | null;
  extraAddress1?: string | null;
  extraAddress2?: string | null;
  extraCity?: string | null;
  extraState?: string | null;
  extraZipcode?: string | null;
  extraCountry?: string | null;
  extraLat?: number | null;
  extraLon?: number | null;
  extraLatLonValidated?: boolean;
  username?: string | null;
  alerts?: string | null;
  connectionNotes?: string | null;
  discount?: number | null;
  clientStatusId?: number | null;
  lat?: number | null;
  lon?: number | null;
  latLonValidated?: boolean;
  zoneId?: number | null;
  isActive?: boolean;
  smsOptOut?: boolean;
  doNotEmail?: boolean;
  doNotSms?: boolean;
  preferEmail?: boolean;
  preferSms?: boolean;
  preferPhone?: boolean;
  doNotSendReminders?: boolean;
  phone1SmsEnabled?: boolean;
  phone2SmsEnabled?: boolean;
  patientIds?: number[];
};

/**
 * PATCH /clients/:id — partial update from Scout.
 *
 * Saving marks the client as Scout-edited, which stops the eVet import from overwriting
 * these values until eVet reports a change newer than this edit.
 */
export async function patchClientStaff(
  clientId: string | number,
  body: ScoutClientWrite,
): Promise<unknown> {
  const { data } = await http.patch(`/clients/${encodeURIComponent(String(clientId))}`, body);
  return data;
}

/**
 * POST /clients/scout — create a client that exists only in Scout.
 * The API assigns pimsType VAYD and a UUID pimsId so no eVet import can claim it.
 */
export async function createClientScout(
  body: ScoutClientWrite & { practiceId: number; firstName: string },
): Promise<unknown> {
  const { data } = await http.post('/clients/scout', body);
  return data;
}

/** POST /clients/:id/deactivate — soft deactivate, keeps history and appointments. */
export async function deactivateClient(clientId: string | number): Promise<unknown> {
  const { data } = await http.post(`/clients/${encodeURIComponent(String(clientId))}/deactivate`);
  return data;
}

/** POST /clients/:id/reactivate — undo a deactivation. */
export async function reactivateClient(clientId: string | number): Promise<unknown> {
  const { data } = await http.post(`/clients/${encodeURIComponent(String(clientId))}/reactivate`);
  return data;
}
