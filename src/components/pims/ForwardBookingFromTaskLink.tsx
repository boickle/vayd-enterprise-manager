import { Link } from 'react-router';
import {
  buildCreateForwardBookingUrl,
  buildTaskForwardBookingReturnPath,
  getForwardBookingPrefillFromTaskLinks,
} from '../../utils/forwardBookingCreateLink';

export function ForwardBookingFromTaskLink({
  links,
  taskId,
}: {
  links: ReadonlyArray<{ entityType: string; entityId: number }> | undefined;
  taskId?: number;
}) {
  const prefill = getForwardBookingPrefillFromTaskLinks(links);
  if (!prefill) return null;
  return (
    <Link
      className="pims-task-body__link"
      to={buildCreateForwardBookingUrl({
        ...prefill,
        returnTo: taskId != null ? buildTaskForwardBookingReturnPath(taskId) : undefined,
      })}
    >
      Add forward booking
    </Link>
  );
}
