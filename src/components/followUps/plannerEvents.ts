/**
 * The Schedule follow-ups planner runs the Routing + calendar workspace inside the
 * checkout page. When that calendar books a visit whose intent came from the planner
 * (`origin: 'follow_up_planner'`), it fires this event and stays put instead of
 * navigating to the forward booking list.
 */
export const FOLLOW_UP_PLANNER_BOOKED_EVENT = 'vayd:follow-up-planner-booked';

export type FollowUpPlannerBookedDetail = {
  /** First appointment the book created (one per pet; the planner reloads the rest). */
  appointmentId: number;
  startIso: string | null;
  endIso: string | null;
  primaryProviderId: number | null;
};

export function notifyFollowUpPlannerBooked(detail: FollowUpPlannerBookedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<FollowUpPlannerBookedDetail>(FOLLOW_UP_PLANNER_BOOKED_EVENT, { detail })
  );
}

export function parseFollowUpPlannerBookedEvent(event: Event): FollowUpPlannerBookedDetail | null {
  const d = (event as CustomEvent<FollowUpPlannerBookedDetail>).detail;
  if (!d || typeof d !== 'object' || !Number.isFinite(Number(d.appointmentId))) return null;
  return d;
}

/**
 * View in calendar for "add a pet to this visit": the embedded calendar shows the visit
 * with its longer end time as its usual dashed edit-visit preview, view-only (no Adjust
 * time popover). Cleared when the planner closes the calendar.
 */
export const FOLLOW_UP_PLANNER_PREVIEW_EVENT = 'vayd:follow-up-planner-preview';
export const FOLLOW_UP_PLANNER_PREVIEW_CLEAR_EVENT = 'vayd:follow-up-planner-preview-clear';

export type FollowUpPlannerPreviewDetail = {
  appointmentId: number;
  startIso: string;
  endIso: string;
  originalStartIso: string;
  originalEndIso: string;
};

export function showFollowUpPlannerPreview(detail: FollowUpPlannerPreviewDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<FollowUpPlannerPreviewDetail>(FOLLOW_UP_PLANNER_PREVIEW_EVENT, { detail })
  );
}

export function clearFollowUpPlannerPreview(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(FOLLOW_UP_PLANNER_PREVIEW_CLEAR_EVENT));
}

export function parseFollowUpPlannerPreviewEvent(
  event: Event
): FollowUpPlannerPreviewDetail | null {
  const d = (event as CustomEvent<FollowUpPlannerPreviewDetail>).detail;
  if (!d || !Number.isFinite(Number(d.appointmentId)) || !d.startIso || !d.endIso) return null;
  return d;
}
