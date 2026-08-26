import type { Appointment } from '../api/roomLoader';
import { appointmentAlternateAddressText } from '../api/appointments';
import type { ClientSearchRow } from '../api/clientsStaff';
import {
  addressMatchAllowsLink,
  clientAddressFromRecord,
  compareVisitAddressToClientHome,
  type VisitAddressMatchQuality,
} from './addressMatchCore';

export {
  addressMatchAllowsLink,
  addressSearchQueriesFromVisit,
  clientAddressFromRecord,
  compareVisitAddressToClientHome,
  normalizeAddressForMatch,
  type VisitAddressMatchQuality,
} from './addressMatchCore';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function clientSearchRowHomeAddress(c: ClientSearchRow): string | null {
  return clientAddressFromRecord(c as Record<string, unknown>);
}

export function visitAddressFromPlainRow(appt: Appointment): string | null {
  const o = appt as Record<string, unknown>;
  const zip = pickStr(o.zip) ?? pickStr(o.zipcode);
  const parts = [
    pickStr(o.address1),
    [pickStr(o.city), pickStr(o.state)].filter(Boolean).join(', '),
    zip,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function visitAddressForLinkMatching(appt: Appointment): string | null {
  return appointmentAlternateAddressText(appt) ?? visitAddressFromPlainRow(appt);
}

export function appointmentResolvedClientId(appt: Appointment): string | null {
  const fromClient = appt.client?.id;
  if (fromClient != null && String(fromClient).trim()) return String(fromClient).trim();
  const raw = (appt as { clientId?: unknown }).clientId;
  if (raw != null && String(raw).trim()) return String(raw).trim();
  return null;
}

/** Client home address from the appointment's linked client, when present. */
export function appointmentClientHomeAddress(
  appt: Pick<Appointment, 'client'> & Record<string, unknown>,
): string | null {
  const client = appt.client;
  if (!client || typeof client !== 'object') return null;
  return clientAddressFromRecord(client as Record<string, unknown>);
}

/** True when stored ALT text matches the linked client's home (exact/strong). */
export function appointmentAlternateMatchesClientHome(
  appt: Pick<Appointment, 'client' | 'alternateAddress'> & Record<string, unknown>,
): boolean {
  const alt = appointmentAlternateAddressText(appt);
  const home = appointmentClientHomeAddress(appt);
  if (!alt?.trim() || !home?.trim()) return false;
  return addressMatchAllowsLink(compareVisitAddressToClientHome(alt, home));
}

/** Linking this client on save will clear the alternate routing address. */
export function editVisitLinkClearsAlternateAddress(
  appt: Appointment,
  linkSelection:
    | {
        clientId?: string | null;
        clientHomeAddress?: string | null;
        keepAlternateAddress?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!linkSelection?.clientId?.trim() || linkSelection.keepAlternateAddress === true) return false;
  const visitAddress = visitAddressForLinkMatching(appt);
  if (!visitAddress?.trim()) return false;
  return addressMatchAllowsLink(
    compareVisitAddressToClientHome(visitAddress, linkSelection.clientHomeAddress),
  );
}

export function visitAddressMatchLabel(quality: VisitAddressMatchQuality): string | null {
  switch (quality) {
    case 'exact':
      return 'Address match';
    case 'strong':
      return 'Likely match';
    case 'weak':
      return 'Possible match';
    default:
      return null;
  }
}
