import { submitRoutingFeedback } from '../api/routingFeedback';
import type { TypeChangeFeedbackHandoff } from '../api/routing';
import {
  readRoutingCalendarPreview,
  type RoutingCalendarPreviewPayloadV1,
} from './routingCalendarPreviewStorage';

export type RoutingBookFeedbackResult = {
  submitted: boolean;
  error?: string;
};

/**
 * After PATCH for in-place type or time change, persist preview score via POST /routing/feedback.
 */
/** @deprecated Use {@link submitEditVisitPreviewAcceptedFeedback} */
export async function submitTypeChangeAcceptedFeedback(
  handoff: TypeChangeFeedbackHandoff
): Promise<RoutingBookFeedbackResult> {
  return submitEditVisitPreviewAcceptedFeedback(handoff);
}

/** After PATCH for in-place type or time change, persist preview score via POST /routing/feedback. */
export async function submitEditVisitPreviewAcceptedFeedback(
  handoff: TypeChangeFeedbackHandoff
): Promise<RoutingBookFeedbackResult> {
  const routingRequestId = handoff.routingRequestId?.trim();
  if (!routingRequestId) {
    return { submitted: false, error: 'Missing routing request id for type-change feedback.' };
  }

  const candidateIndex = handoff.candidateIndex;
  if (candidateIndex == null || !Number.isFinite(Number(candidateIndex))) {
    return { submitted: false, error: 'Missing routing candidate index for type-change feedback.' };
  }

  const apptId = Number(handoff.appointmentId);
  if (!Number.isFinite(apptId) || apptId <= 0) {
    return { submitted: false, error: 'Invalid appointment id for type-change feedback.' };
  }

  try {
    await submitRoutingFeedback({
      routingRequestId,
      appointmentId: apptId,
      candidateIndex: Number(candidateIndex),
      selectionStatus: 'accepted',
    });
    return { submitted: true };
  } catch (e) {
    const msg =
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data
        ?.message ??
      (e as Error)?.message ??
      'Routing feedback request failed.';
    return { submitted: false, error: String(msg) };
  }
}

/**
 * After POST /appointments (or PATCH reschedule), tie the visit to the routing request
 * that produced the previewed slot.
 */
export async function submitRoutingAcceptedFeedbackFromPreview(
  appointmentId: number,
  preview?: RoutingCalendarPreviewPayloadV1 | null
): Promise<RoutingBookFeedbackResult> {
  const p = preview ?? readRoutingCalendarPreview();
  const routingRequestId = p?.routingRequestId?.trim();
  if (!routingRequestId) return { submitted: false };

  const candidateIndex = p?.candidateIndex;
  if (candidateIndex == null || !Number.isFinite(Number(candidateIndex))) {
    return { submitted: false, error: 'Missing routing candidate index on preview.' };
  }

  const apptId = Number(appointmentId);
  if (!Number.isFinite(apptId) || apptId <= 0) {
    return { submitted: false, error: 'Invalid appointment id for routing feedback.' };
  }

  try {
    await submitRoutingFeedback({
      routingRequestId,
      appointmentId: apptId,
      candidateIndex: Number(candidateIndex),
      selectionStatus: 'accepted',
      ...(p?.candidateId?.trim() ? { candidateId: p.candidateId.trim() } : {}),
    });
    return { submitted: true };
  } catch (e) {
    const msg =
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data
        ?.message ??
      (e as Error)?.message ??
      'Routing feedback request failed.';
    return { submitted: false, error: String(msg) };
  }
}
