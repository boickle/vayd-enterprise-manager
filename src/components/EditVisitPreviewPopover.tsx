import { DateTime } from 'luxon';
import { X } from 'lucide-react';
import type { EditVisitTimePreview } from '../utils/editVisitTimePreview';
import type { EditVisitPreviewScoreCompare } from '../utils/editVisitTypeScoreCompare';
import { EDIT_VISIT_PREVIEW_UNAVAILABLE_LINE } from '../utils/editVisitPreviewApi';
import { EditVisitOverflowTag } from './EditVisitOverflowTag';
import {
  PreviewPopoverClientContact,
  type PreviewPopoverClientContact as PreviewPopoverClientContactType,
} from './PreviewPopoverClientContact';

type EditVisitPreviewPopoverProps = {
  preview: EditVisitTimePreview;
  practiceTz: string;
  typeLabel?: string | null;
  originalAppointmentStart?: string | null;
  originalAppointmentEnd?: string | null;
  originalTypeLabel?: string | null;
  clientContact?: PreviewPopoverClientContactType | null;
  scoreCompare: EditVisitPreviewScoreCompare | null;
  scoreLoading: boolean;
  scoreError: string | null;
  confirmLabel: string;
  confirming?: boolean;
  onConfirm: () => void | Promise<void>;
  onDismiss: () => void;
};

function formatPracticeRange(
  startIso: string,
  endIso: string,
  practiceTz: string
): string {
  let start = DateTime.fromISO(startIso, { zone: 'utc' });
  let end = DateTime.fromISO(endIso, { zone: 'utc' });
  if (!start.isValid) start = DateTime.fromISO(startIso, { setZone: true });
  if (!end.isValid) end = DateTime.fromISO(endIso, { setZone: true });
  start = start.setZone(practiceTz);
  end = end.setZone(practiceTz);
  if (!start.isValid || !end.isValid) return '';
  return `${start.toFormat('ccc LLL d · t')} – ${end.toFormat('t')}`;
}

function formatPreviewRange(preview: EditVisitTimePreview, practiceTz: string): string {
  return formatPracticeRange(preview.appointmentStart, preview.appointmentEnd, practiceTz);
}

export function EditVisitPreviewPopover({
  preview,
  practiceTz,
  typeLabel,
  originalAppointmentStart,
  originalAppointmentEnd,
  originalTypeLabel,
  clientContact,
  scoreCompare,
  scoreLoading,
  scoreError,
  confirmLabel,
  confirming = false,
  onConfirm,
  onDismiss,
}: EditVisitPreviewPopoverProps) {
  const title =
    preview.kind === 'type' ? 'Appointment type preview' : 'Time adjustment preview';
  const newRangeLabel = formatPreviewRange(preview, practiceTz);
  const origStart =
    preview.originalAppointmentStart?.trim() || originalAppointmentStart?.trim() || '';
  const origEnd = preview.originalAppointmentEnd?.trim() || originalAppointmentEnd?.trim() || '';
  const originalRangeLabel =
    origStart && origEnd ? formatPracticeRange(origStart, origEnd, practiceTz) : '';
  const timeChanged =
    Boolean(originalRangeLabel && newRangeLabel) &&
    (origStart !== preview.appointmentStart || origEnd !== preview.appointmentEnd);
  const originalType =
    preview.originalAppointmentTypeName?.trim() || originalTypeLabel?.trim() || null;
  const newType = preview.kind === 'type' ? typeLabel?.trim() || null : null;
  const typeChanged = Boolean(originalType && newType && originalType !== newType);
  const showWasNowTime = preview.kind === 'time' || timeChanged;

  return (
    <div className="scheduler-edit-preview-popover" role="dialog" aria-label={title}>
      <div className="scheduler-edit-preview-popover-head">
        <strong className="scheduler-edit-preview-popover-title">{title}</strong>
        <button
          type="button"
          className="scheduler-edit-preview-popover-dismiss"
          aria-label="Dismiss placement preview"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X size={14} strokeWidth={2.5} aria-hidden />
        </button>
      </div>

      <PreviewPopoverClientContact contact={clientContact} />

      <div className="scheduler-edit-preview-popover-change">
        {typeChanged ? (
          <p className="scheduler-edit-preview-popover-change-row">
            <span className="scheduler-edit-preview-popover-change-k">Type</span>
            <span className="scheduler-edit-preview-popover-change-was">{originalType}</span>
            <span className="scheduler-edit-preview-popover-change-arrow" aria-hidden>
              →
            </span>
            <span className="scheduler-edit-preview-popover-change-now">{newType}</span>
          </p>
        ) : null}
        {showWasNowTime ? (
          <>
            {originalRangeLabel ? (
              <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--was">
                <span className="scheduler-edit-preview-popover-change-k">Was</span>
                {originalRangeLabel}
              </p>
            ) : null}
            {newRangeLabel ? (
              <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--now">
                <span className="scheduler-edit-preview-popover-change-k">Now</span>
                {newRangeLabel}
              </p>
            ) : null}
          </>
        ) : newRangeLabel ? (
          <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--now">
            {newRangeLabel}
          </p>
        ) : null}
      </div>

      <div className="scheduler-edit-preview-popover-body" role="status" aria-live="polite">
        {scoreLoading ? (
          <p className="scheduler-edit-preview-popover-line">Comparing routing scores…</p>
        ) : scoreError ? (
          <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--error">
            {scoreError}
          </p>
        ) : (
          <>
            {scoreCompare?.summaryLine ? (
              <p
                className={`scheduler-edit-preview-popover-line${
                  scoreCompare.summaryLine === EDIT_VISIT_PREVIEW_UNAVAILABLE_LINE
                    ? ' scheduler-edit-preview-popover-line--warn'
                    : ' scheduler-edit-preview-popover-line--strong'
                }`}
              >
                {scoreCompare.summaryLine}
              </p>
            ) : null}
            {scoreCompare?.originalScoreLine &&
            scoreCompare.originalScoreLine !== scoreCompare.summaryLine ? (
              <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
                {scoreCompare.originalScoreLine}
              </p>
            ) : null}
            {scoreCompare?.newTypeUnavailableLine ? (
              <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--warn">
                {scoreCompare.newTypeUnavailableLine}
              </p>
            ) : null}
            {scoreCompare?.overflowOverrunSeconds != null ? (
              <EditVisitOverflowTag overrunSeconds={scoreCompare.overflowOverrunSeconds} />
            ) : null}
            {preview.kind === 'type' && scoreCompare?.windowLine ? (
              <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
                {scoreCompare.windowLine}
                {scoreCompare.windowWarningMayChange
                  ? ' — window warnings on the calendar may change.'
                  : null}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="scheduler-edit-preview-popover-actions">
        <button
          type="button"
          className="btn scheduler-edit-preview-popover-confirm"
          onClick={() => void onConfirm()}
          disabled={confirming || scoreLoading}
        >
          {confirming ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}
