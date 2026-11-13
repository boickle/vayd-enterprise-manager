import { useState } from 'react';
import { useNavigate } from 'react-router';
import './apptTable.css';
import { ReplyBadges } from './ReplyBadges';
import { readAppointmentTabCounts } from './appointmentTabCounts';
import {
  appointmentRequestsPathForTab,
  type AppointmentRequestListTab,
} from '../../appointments-nav';

/** Request tabs in the order the Appointments page shows them; Hold is last. */
export const APPOINTMENT_REQUEST_TAB_LINKS: { key: AppointmentRequestListTab; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'to_confirm', label: 'Auto-Booked' },
  // Same label as the Appointments page: contacted requests and booked ones still open.
  { key: 'contacted', label: 'In progress' },
  { key: 'booked', label: 'Booked' },
  { key: 'dismissed', label: 'Not Booked' },
];

/** Tab strip shown on the Hold tab (the old Holds board), linking back to the request tabs. */
export function AppointmentsTabStrip() {
  const navigate = useNavigate();
  // Counts as the Appointments list last worked them out (the Hold tab doesn't load requests).
  const [counts] = useState(readAppointmentTabCounts);
  return (
    <div className="appt-request-status-tabs" role="tablist" aria-label="Appointments">
      {APPOINTMENT_REQUEST_TAB_LINKS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={false}
          className="appt-request-status-tab"
          onClick={() => navigate(appointmentRequestsPathForTab(key))}
        >
          <span>{label}</span>
          <ReplyBadges mine={counts[key]?.mine ?? 0} others={counts[key]?.others ?? 0} />
          {counts[key]?.count != null ? (
            <span className="appt-request-status-tab-count" aria-hidden>
              ({counts[key]?.count})
            </span>
          ) : null}
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected
        className="appt-request-status-tab active"
        aria-current="page"
      >
        Hold
      </button>
    </div>
  );
}
