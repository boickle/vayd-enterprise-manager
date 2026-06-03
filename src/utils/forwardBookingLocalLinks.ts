import type { ForwardBookingEntry } from '../api/forwardBooking';
import { mergeForwardBookingLinkedVisit } from './forwardBookingLinkedVisit';

const STORAGE_KEY = 'vayd:forward-booking-local-links-v1';

export type ForwardBookingLocalLink = {
  bookedAppointmentId: number;
  bookedAppointmentStart: string;
  bookedAppointmentEnd?: string | null;
};

type Stored = {
  v: 1;
  links: Record<string, ForwardBookingLocalLink>;
};

function readStored(): Stored {
  if (typeof sessionStorage === 'undefined') return { v: 1, links: {} };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { v: 1, links: {} };
    const o = JSON.parse(raw) as Stored;
    if (o?.v !== 1 || !o.links || typeof o.links !== 'object') return { v: 1, links: {} };
    return o;
  } catch {
    return { v: 1, links: {} };
  }
}

function writeStored(stored: Stored): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
}

export function readForwardBookingLocalLink(entryId: number): ForwardBookingLocalLink | null {
  const link = readStored().links[String(entryId)];
  if (!link?.bookedAppointmentStart?.trim() || link.bookedAppointmentId == null) return null;
  return link;
}

export function writeForwardBookingLocalLink(
  entryId: number,
  link: ForwardBookingLocalLink
): void {
  const stored = readStored();
  stored.links[String(entryId)] = link;
  writeStored(stored);
}

export function clearForwardBookingLocalLink(entryId: number): void {
  const stored = readStored();
  delete stored.links[String(entryId)];
  writeStored(stored);
}

export function mergeForwardBookingsWithLocalLinks(
  entries: ForwardBookingEntry[]
): ForwardBookingEntry[] {
  const stored = readStored();
  if (Object.keys(stored.links).length === 0) return entries;
  return entries.map((entry) => {
    const link = stored.links[String(entry.id)];
    if (!link) return entry;
    return mergeForwardBookingLinkedVisit(entry, {
      bookedAppointmentId: link.bookedAppointmentId,
      bookedAppointmentStart: link.bookedAppointmentStart,
      bookedAppointmentEnd: link.bookedAppointmentEnd ?? null,
    });
  });
}
