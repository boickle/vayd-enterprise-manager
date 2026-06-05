import { http } from './http';

export type RoutingFeedbackSelectionStatus = 'accepted' | 'rejected';

export type RoutingFeedbackPayload = {
  routingRequestId: string;
  selectionStatus: RoutingFeedbackSelectionStatus;
  appointmentId?: number;
  candidateIndex?: number;
  candidateId?: string;
};

/** POST /routing/feedback — link a booked appointment (or rejection) to a routing request. */
export async function submitRoutingFeedback(payload: RoutingFeedbackPayload): Promise<void> {
  await http.post('/routing/feedback', payload);
}
