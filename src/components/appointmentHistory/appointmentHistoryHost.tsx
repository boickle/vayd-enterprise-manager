import { useEffect, useState } from 'react';
import AppointmentHistoryModal, { type AppointmentHistoryExtras } from './AppointmentHistoryModal';

const EVENT = 'scout:open-appointment-history';

type Detail = {
  appointmentId: number | string;
  title?: string | null;
  extras?: AppointmentHistoryExtras;
};

let historyOpen = false;

/** True while an appointment's History window is showing (Visit Highlights stays put). */
export function isAppointmentHistoryOpen(): boolean {
  return historyOpen;
}

/**
 * Open an appointment's History from anywhere (Visit Highlights, the appointment window).
 * The window lives in AppointmentHistoryHost, so it stays open when the hover card closes.
 */
export function openAppointmentHistory(
  appointmentId: number | string,
  title?: string | null,
  extras?: AppointmentHistoryExtras
): void {
  window.dispatchEvent(
    new CustomEvent<Detail>(EVENT, { detail: { appointmentId, title, extras } })
  );
}

/** Mount once on a page that shows appointments. */
export function AppointmentHistoryHost() {
  const [open, setOpen] = useState<Detail | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<Detail>).detail);
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);
  useEffect(() => {
    historyOpen = open != null;
    return () => {
      historyOpen = false;
    };
  }, [open]);
  if (!open) return null;
  return (
    <AppointmentHistoryModal
      appointmentId={open.appointmentId}
      title={open.title}
      extras={open.extras}
      onClose={() => setOpen(null)}
    />
  );
}
