import {
  appointmentAlternateAddressText,
  appointmentHasAlternateLocation,
  type DoctorDayAppt,
} from '../api/appointments';
import { clientAddressOneLine } from './schedulerVisitDisplay';
import type { Client } from '../api/roomLoader';

export type MyDayVisualAlternateAddressInfo = {
  isAlternateStop: boolean;
  /** Stored alternate / routing stop text when present. */
  alternateAddressText: string | null;
  /** Client home from nested `client` when available. */
  clientHomeAddress: string | null;
};

function clientHomeFromDoctorDayRow(a: unknown): string | null {
  if (!a || typeof a !== 'object') return null;
  const client = (a as Record<string, unknown>).client;
  if (!client || typeof client !== 'object') return null;
  return clientAddressOneLine(client as Client);
}

/** Detect alternate routing stop + home address for My Day Visual / PDF. */
export function myDayVisualAlternateAddressInfo(
  appt: DoctorDayAppt | Record<string, unknown> | null | undefined
): MyDayVisualAlternateAddressInfo {
  if (!appt || typeof appt !== 'object') {
    return { isAlternateStop: false, alternateAddressText: null, clientHomeAddress: null };
  }
  const isAlternateStop = appointmentHasAlternateLocation(
    appt as Parameters<typeof appointmentHasAlternateLocation>[0]
  );
  const alternateAddressText = appointmentAlternateAddressText(
    appt as Parameters<typeof appointmentAlternateAddressText>[0]
  );
  const clientHomeAddress = clientHomeFromDoctorDayRow(appt);
  return { isAlternateStop, alternateAddressText, clientHomeAddress };
}

export type MyDayVisualAlternateAddressPdfFields = {
  isAlternateStop?: boolean;
  alternateVisitAddress?: string;
  clientHomeAddress?: string;
};

export function myDayVisualAlternateAddressPdfFields(
  appt: DoctorDayAppt | Record<string, unknown> | null | undefined,
  fallbackVisitAddress: string
): MyDayVisualAlternateAddressPdfFields {
  const alt = myDayVisualAlternateAddressInfo(appt);
  if (!alt.isAlternateStop) {
    return { isAlternateStop: false };
  }
  const visitRaw = (alt.alternateAddressText ?? fallbackVisitAddress).trim();
  const homeRaw = alt.clientHomeAddress?.trim() ?? '';
  return {
    isAlternateStop: true,
    alternateVisitAddress: visitRaw || undefined,
    clientHomeAddress: homeRaw || undefined,
  };
}
