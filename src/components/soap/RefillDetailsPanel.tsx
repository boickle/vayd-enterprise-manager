import { estimateRefillSchedule, formatDuration, formatScheduleDate } from '../../utils/prescriptionRefillDetails';

type Props = {
  instructions: string;
  quantity: number;
  startDate: string;
  refillCount: number;
  refillExpiration?: string;
};

export default function RefillDetailsPanel({
  instructions,
  quantity,
  startDate,
  refillCount,
  refillExpiration,
}: Props) {
  const schedule = estimateRefillSchedule({
    instructions,
    quantity,
    startDate,
    refillCount,
    refillExpiration,
  });
  const refills = Math.max(0, Math.floor(Number(refillCount) || 0));

  if (!schedule) {
    return (
      <div className="soap-refill-details" role="region" aria-label="Refill details">
        <p>
          Could not tell how often this is given from the directions. Add a frequency such as “once
          daily” or “every 1 month” to estimate the next due date and how long a refill lasts.
        </p>
        {refillExpiration ? <p>Refills expire {formatScheduleDate(refillExpiration)}.</p> : null}
      </div>
    );
  }

  const fillLasts = formatDuration(schedule.daysPerFill);
  const nextDue = formatScheduleDate(schedule.nextDueDate);

  return (
    <div className="soap-refill-details" role="region" aria-label="Refill details">
      <p>
        This fill lasts {fillLasts} ({schedule.frequencyLabel}, qty {quantity}).
        {nextDue ? ` Next due ${nextDue}.` : ''}
      </p>
      {refills === 0 ? (
        <p>No refills on this prescription.</p>
      ) : (
        <p>
          {refills} refill{refills === 1 ? '' : 's'} last {formatDuration(schedule.refillDays ?? 0)}
          {schedule.refillThroughDate
            ? `, through ${formatScheduleDate(schedule.refillThroughDate)}`
            : ''}
          .
          {schedule.refillExpiration
            ? ` They must be filled by ${formatScheduleDate(schedule.refillExpiration)}.`
            : ''}
        </p>
      )}
    </div>
  );
}
