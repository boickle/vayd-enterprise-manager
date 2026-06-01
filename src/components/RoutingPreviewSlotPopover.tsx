import { DateTime } from 'luxon';
import { X } from 'lucide-react';
import type { RescheduleOriginalVisitSnapshot } from '../api/routing';
import { formatReschedulePreviewScoreLine } from '../utils/routingRescheduleScoreCompare';
import type { RoutingCalendarPreviewPayloadV1 } from '../utils/routingCalendarPreviewStorage';

type Props = {
  preview: RoutingCalendarPreviewPayloadV1;
  practiceTz: string;
  isReschedule: boolean;
  sourceVisitForCompare?: RescheduleOriginalVisitSnapshot | null;
  bookDisabled?: boolean;
  onBook: () => void;
  onDismiss: () => void;
};

function formatPreviewRange(
  startIso: string,
  serviceMinutes: number,
  practiceTz: string
): string {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return '';
  const end = start.plus({ minutes: Math.max(1, serviceMinutes) });
  return `${start.toFormat('ccc LLL d · t')} – ${end.toFormat('t')}`;
}

export function RoutingPreviewSlotPopover({
  preview,
  practiceTz,
  isReschedule,
  sourceVisitForCompare,
  bookDisabled,
  onBook,
  onDismiss,
}: Props) {
  const opt = preview.option;
  const title = isReschedule ? 'Reschedule preview' : 'Routing preview';
  const rangeLabel = formatPreviewRange(
    String(opt.suggestedStartIso ?? ''),
    preview.serviceMinutes,
    practiceTz
  );
  const doctorName = String(opt.doctorName ?? 'Provider').trim();
  const score = typeof opt.score === 'number' ? opt.score : null;
  const clientLabel = preview.clientDisplayLabel?.trim();
  const compareVisit =
    sourceVisitForCompare ?? preview.rescheduleSourceVisitSnapshot ?? null;
  const scoreLine =
    score != null && isReschedule
      ? formatReschedulePreviewScoreLine(score, compareVisit)
      : score != null
        ? `Routing score: ${Number.isInteger(score) ? String(score) : score.toFixed(2)}`
        : null;
  const scoreLineIsUnavailable =
    scoreLine === 'No previous routing score available for this visit.';

  return (
    <div className="scheduler-edit-preview-popover" role="dialog" aria-label={title}>
      <div className="scheduler-edit-preview-popover-head">
        <strong className="scheduler-edit-preview-popover-title">{title}</strong>
        <button
          type="button"
          className="scheduler-edit-preview-popover-dismiss"
          aria-label="Dismiss routing preview"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X size={14} strokeWidth={2.5} aria-hidden />
        </button>
      </div>

      <div className="scheduler-edit-preview-popover-meta">
        {doctorName}
        {clientLabel ? ` · ${clientLabel}` : ''}
      </div>

      {rangeLabel ? (
        <div className="scheduler-edit-preview-popover-change">
          <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--now">
            {rangeLabel}
          </p>
        </div>
      ) : null}

      <div className="scheduler-edit-preview-popover-body" role="status" aria-live="polite">
        {scoreLine ? (
          <p
            className={`scheduler-edit-preview-popover-line${
              scoreLineIsUnavailable
                ? ' scheduler-edit-preview-popover-line--warn'
                : isReschedule
                  ? ' scheduler-edit-preview-popover-line--strong'
                  : ' scheduler-edit-preview-popover-line--muted'
            }`}
          >
            {scoreLine}
          </p>
        ) : (
          <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
            Hover the purple slot or any visit for full details.
          </p>
        )}
      </div>

      <div className="scheduler-edit-preview-popover-actions">
        <button
          type="button"
          className="btn scheduler-edit-preview-popover-confirm"
          disabled={bookDisabled}
          onClick={onBook}
        >
          {isReschedule ? 'Reschedule' : 'Book'}
        </button>
      </div>
    </div>
  );
}
