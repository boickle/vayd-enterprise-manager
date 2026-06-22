import { DateTime } from 'luxon';
import { X } from 'lucide-react';
import type { RescheduleOriginalVisitSnapshot } from '../api/routing';
import { formatReschedulePreviewScoreLine } from '../utils/routingRescheduleScoreCompare';
import {
  isManualBookCalendarPreview,
  isScheduleLoaderCalendarPreview,
  type RoutingCalendarPreviewPayloadV1,
} from '../utils/routingCalendarPreviewStorage';
import {
  PreviewPopoverClientContact,
  type PreviewPopoverClientContact as PreviewPopoverClientContactType,
} from './PreviewPopoverClientContact';

export type RoutingPreviewClientContact = PreviewPopoverClientContactType;

type Props = {
  preview: RoutingCalendarPreviewPayloadV1;
  practiceTz: string;
  isReschedule: boolean;
  sourceVisitForCompare?: RescheduleOriginalVisitSnapshot | null;
  originalAppointmentStart?: string | null;
  originalAppointmentEnd?: string | null;
  /** Client phone + visit doctor Quo line for call/text while reviewing a reschedule slot. */
  clientContact?: RoutingPreviewClientContact | null;
  bookDisabled?: boolean;
  /** Override primary action label (e.g. care outreach → "Next"). */
  confirmLabel?: string;
  onBook: () => void;
  onDismiss: () => void;
};

function formatPracticeRange(startIso: string, endIso: string, practiceTz: string): string {
  let start = DateTime.fromISO(startIso, { zone: 'utc' });
  let end = DateTime.fromISO(endIso, { zone: 'utc' });
  if (!start.isValid) start = DateTime.fromISO(startIso, { setZone: true });
  if (!end.isValid) end = DateTime.fromISO(endIso, { setZone: true });
  start = start.setZone(practiceTz);
  end = end.setZone(practiceTz);
  if (!start.isValid || !end.isValid) return '';
  return `${start.toFormat('ccc LLL d · t')} – ${end.toFormat('t')}`;
}

function formatPreviewRange(
  startIso: string,
  serviceMinutes: number,
  practiceTz: string
): string {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return '';
  const end = start.plus({ minutes: Math.max(1, serviceMinutes) });
  return formatPracticeRange(start.toISO()!, end.toISO()!, practiceTz);
}

function resolveOriginalEndIso(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  serviceMinutes: number
): string | null {
  const end = endIso?.trim();
  if (end) return end;
  const start = startIso?.trim();
  if (!start) return null;
  const dt = DateTime.fromISO(start);
  if (!dt.isValid) return null;
  return dt.plus({ minutes: Math.max(1, serviceMinutes) }).toISO({ includeOffset: true }) ?? null;
}

export function RoutingPreviewSlotPopover({
  preview,
  practiceTz,
  isReschedule,
  sourceVisitForCompare,
  originalAppointmentStart,
  originalAppointmentEnd,
  clientContact,
  bookDisabled,
  confirmLabel,
  onBook,
  onDismiss,
}: Props) {
  const opt = preview.option;
  const isScheduleLoader = isScheduleLoaderCalendarPreview(preview);
  const isManualBook = isManualBookCalendarPreview(preview);
  const title = isReschedule
    ? 'Reschedule preview'
    : isManualBook
      ? 'Manual booking preview'
      : isScheduleLoader
        ? 'Schedule loader preview'
        : 'Routing preview';
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
  const originalStartIso =
    originalAppointmentStart?.trim() ||
    compareVisit?.suggestedStartIso?.trim() ||
    null;
  const originalEndIso = resolveOriginalEndIso(
    originalStartIso,
    originalAppointmentEnd,
    preview.serviceMinutes
  );
  const originalRangeLabel =
    isReschedule && originalStartIso && originalEndIso
      ? formatPracticeRange(originalStartIso, originalEndIso, practiceTz)
      : '';
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

      <PreviewPopoverClientContact contact={clientContact} />

      {originalRangeLabel || rangeLabel ? (
        <div className="scheduler-edit-preview-popover-change">
          {originalRangeLabel ? (
            <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--was">
              <span className="scheduler-edit-preview-popover-change-k">Was</span>
              {originalRangeLabel}
            </p>
          ) : null}
          {rangeLabel ? (
            <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--now">
              {isReschedule && originalRangeLabel ? (
                <span className="scheduler-edit-preview-popover-change-k">Now</span>
              ) : null}
              {rangeLabel}
            </p>
          ) : null}
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
            {isManualBook
              ? 'Hover the red slot to see where this visit would land on the routed timeline.'
              : isScheduleLoader
                ? 'Hover the purple slot to see where this client would land.'
                : 'Hover the purple slot or any visit for full details.'}
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
          {confirmLabel ?? (isReschedule ? 'Reschedule' : 'Book')}
        </button>
      </div>
    </div>
  );
}
