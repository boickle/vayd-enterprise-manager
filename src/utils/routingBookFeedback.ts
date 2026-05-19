import { submitRoutingFeedback } from '../api/routingFeedback';
import {
  readRoutingCalendarPreview,
  type RoutingCalendarPreviewPayloadV1,
} from './routingCalendarPreviewStorage';

export type RoutingBookFeedbackResult = {
  submitted: boolean;
  error?: string;
};

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
