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

/**
 * "Open the full calendar in a new tab" books in another tab: the booking reaches the
 * planner (still open in the checkout tab) over this channel.
 */
const FOLLOW_UP_PLANNER_BOOKED_CHANNEL = 'vayd:follow-up-planner-booked';

function bookedChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(FOLLOW_UP_PLANNER_BOOKED_CHANNEL);
  } catch {
    return null;
  }
}

export function notifyFollowUpPlannerBooked(detail: FollowUpPlannerBookedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<FollowUpPlannerBookedDetail>(FOLLOW_UP_PLANNER_BOOKED_EVENT, { detail })
  );
  const ch = bookedChannel();
  if (ch) {
    try {
      ch.postMessage(detail);
    } finally {
      ch.close();
    }
  }
}

/**
 * Bookings for the planner from this tab's calendar or another tab's. Each booking is
 * reported once even when it arrives both ways.
 */
export function subscribeFollowUpPlannerBooked(
  onBooked: (detail: FollowUpPlannerBookedDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const seen = new Set<number>();
  const deliver = (d: FollowUpPlannerBookedDetail | null) => {
    if (!d) return;
    const id = Number(d.appointmentId);
    if (seen.has(id)) return;
    seen.add(id);
    onBooked(d);
  };
  const onEvent = (ev: Event) => deliver(parseFollowUpPlannerBookedEvent(ev));
  window.addEventListener(FOLLOW_UP_PLANNER_BOOKED_EVENT, onEvent);
  const ch = bookedChannel();
  if (ch) {
    ch.onmessage = (msg: MessageEvent<FollowUpPlannerBookedDetail>) =>
      deliver(msg.data && Number.isFinite(Number(msg.data.appointmentId)) ? msg.data : null);
  }
  return () => {
    window.removeEventListener(FOLLOW_UP_PLANNER_BOOKED_EVENT, onEvent);
    ch?.close();
  };
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
