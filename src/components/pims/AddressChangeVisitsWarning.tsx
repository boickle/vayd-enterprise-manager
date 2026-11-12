import { Link } from 'react-router';
import { DateTime } from 'luxon';
import { buildSchedulerFocusAppointmentUrl } from '../../utils/schedulerFocusAppointment';

/** One upcoming visit that follows the client's address (from PATCH /clients/:id). */
export type UpcomingVisitAffected = {
  id: number;
  start: string;
  providerId?: number | null;
  providerName?: string | null;
  zoneChanged?: boolean;
  oldZone?: { id: number; name?: string | null } | null;
  newZone?: { id: number; name?: string | null } | null;
  outsideServiceArea?: boolean;
};

const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

/** Reads `upcomingVisitsAffected` off a client write response; anything else gives []. */
export function upcomingVisitsFromWrite(result: unknown): UpcomingVisitAffected[] {
  const raw = (result as { upcomingVisitsAffected?: unknown } | null)?.upcomingVisitsAffected;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is UpcomingVisitAffected =>
      v != null && typeof v === 'object' && Number.isFinite(Number((v as { id?: unknown }).id))
  );
}

export function AddressChangeVisitsWarning({
  visits,
  onDismiss,
}: {
  visits: UpcomingVisitAffected[];
  onDismiss?: () => void;
}) {
  if (!visits.length) return null;
  const routeChanges = visits.some((v) => v.zoneChanged || v.outsideServiceArea);
  const outside = visits.some((v) => v.outsideServiceArea);
  return (
    <div
      className="pims-detail__banner-error"
      role="alert"
      data-testid="address-change-visits-warning"
    >
      <strong>
        This client has {visits.length} upcoming visit{visits.length === 1 ? '' : 's'} at this
        address.
      </strong>
      {routeChanges ? (
        <p>
          {outside
            ? 'The new address is outside the service area. '
            : 'The new address is in a different zone. '}
          Check these visits: the route for those days will change.
        </p>
      ) : (
        <p>Check these visits: the route for those days may change.</p>
      )}
      <ul>
        {visits.map((v) => {
          const dt = DateTime.fromISO(v.start, { zone: PRACTICE_TZ });
          return (
            <li key={v.id}>
              <Link
                to={buildSchedulerFocusAppointmentUrl(v.id, {
                  date: dt.isValid ? dt.toISODate() : null,
                  providerId: v.providerId != null ? String(v.providerId) : null,
                })}
              >
                {dt.isValid ? dt.toFormat('ccc LLL d, h:mm a') : v.start}
              </Link>
              {v.providerName ? ` with ${v.providerName}` : ''}
            </li>
          );
        })}
      </ul>
      {onDismiss ? (
        <button type="button" className="pims-detail__btn-secondary" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
