import { useNavigate } from 'react-router';
import './apptTable.css';
import {
  appointmentRequestsPathForTab,
  type AppointmentRequestListTab,
} from '../../appointments-nav';

/** Request tabs in the order the Appointments page shows them; Hold is last. */
export const APPOINTMENT_REQUEST_TAB_LINKS: { key: AppointmentRequestListTab; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'to_confirm', label: 'Auto-Booked' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'booked', label: 'Booked' },
  { key: 'dismissed', label: 'Not Booked' },
];

/** Tab strip shown on the Hold tab (the old Holds board), linking back to the request tabs. */
export function AppointmentsTabStrip() {
  const navigate = useNavigate();
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
          {label}
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
