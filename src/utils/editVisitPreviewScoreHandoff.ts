import type { TypeChangeFeedbackHandoff, TypeChangePreviewScoreSnapshot } from '../api/routing';

/** Seconds past depot when preview used fitInWithOverflow scoring. */
export function inPlacePreviewOverflowOverrunSeconds(
  snapshot: Pick<
    TypeChangePreviewScoreSnapshot,
    'scoredWithOverflowAllowed' | 'overrunSeconds'
  > | null | undefined
): number | null {
  if (!snapshot?.scoredWithOverflowAllowed) return null;
  const sec = snapshot.overrunSeconds;
  if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) return sec;
  return 0;
}

/** Parse POST /routing/feedback handoff from type- or time-change preview responses. */
export function feedbackHandoffFromPreviewResult(args: {
  feedbackHandoff?: TypeChangeFeedbackHandoff | null;
  withNew: TypeChangePreviewScoreSnapshot;
  apptId: number;
}): TypeChangeFeedbackHandoff | null {
  const raw = args.feedbackHandoff;
  if (raw?.routingRequestId?.trim() && Number.isFinite(Number(raw.appointmentId))) {
    const candidateIndex = raw.candidateIndex ?? 0;
    if (!Number.isFinite(Number(candidateIndex))) return null;
    return {
      routingRequestId: raw.routingRequestId.trim(),
      candidateIndex: Number(candidateIndex),
      appointmentId: Number(raw.appointmentId),
    };
  }

  const wt = args.withNew;
  if (wt.feasible === false || !wt.found || !wt.routingRequestId?.trim()) {
    return null;
  }

  const candidateIndex = wt.candidateIndex ?? 0;
  if (!Number.isFinite(Number(candidateIndex))) return null;

  return {
    routingRequestId: wt.routingRequestId.trim(),
    candidateIndex: Number(candidateIndex),
    appointmentId: args.apptId,
  };
}
