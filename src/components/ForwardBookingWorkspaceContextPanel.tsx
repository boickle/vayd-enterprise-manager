import type { RoutingForwardBookingIntentV1 } from '../utils/routingForwardBookingIntent';
import { buildForwardBookingWorkspaceContext } from '../utils/forwardBookingRoutingContext';
import './ForwardBookingWorkspaceContextPanel.css';

type Props = {
  intent: RoutingForwardBookingIntentV1;
  practiceTz: string;
};

export function ForwardBookingWorkspaceContextPanel({ intent, practiceTz }: Props) {
  const ctx = buildForwardBookingWorkspaceContext(intent, practiceTz);
  if (!ctx) return null;

  const petsLabel =
    ctx.patientNames.length === 0
      ? null
      : ctx.patientNames.length === 1
        ? ctx.patientNames[0]
        : ctx.patientNames.join(', ');

  return (
    <div className="forward-booking-workspace-context" role="status" aria-live="polite">
      <div className="forward-booking-workspace-context__headline">
        {petsLabel ? (
          <>
            <span className="forward-booking-workspace-context__client">{ctx.clientLabel}</span>
            <span aria-hidden> · </span>
            <span>{petsLabel}</span>
          </>
        ) : (
          <span className="forward-booking-workspace-context__client">{ctx.clientLabel}</span>
        )}
      </div>
      <div className="forward-booking-workspace-context__visit">{ctx.visitLine}</div>
      <div className="forward-booking-workspace-context__meta">
        {ctx.originalVisitLabel ? (
          <>
            <span>Original visit: {ctx.originalVisitLabel}</span>
            <span aria-hidden> · </span>
          </>
        ) : null}
        {ctx.targetDateLabel ? (
          <>
            <span>
              Target: <strong>{ctx.targetDateLabel}</strong>
            </span>
            <span aria-hidden> · </span>
          </>
        ) : null}
        {ctx.providerLabel ? <span>Provider: {ctx.providerLabel}</span> : null}
      </div>
      {ctx.bookingNote ? (
        <div className="forward-booking-workspace-context__note">
          <span className="forward-booking-workspace-context__note-label">Forward booking note:</span>{' '}
          {ctx.bookingNote}
        </div>
      ) : null}
    </div>
  );
}
