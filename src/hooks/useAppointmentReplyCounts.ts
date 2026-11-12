import { useEffect, useState } from 'react';
import { fetchAppointmentRequestUnreadCounts } from '../api/appointmentRequestSubmissions';
import { subscribePracticeCalendar } from '../utils/calendarRealtime';
import { currentPracticeId } from '../utils/practiceIdFromToken';

/** Fired by the Appointments page after it marks replies read or unread. */
export const APPT_REPLIES_CHANGED_EVENT = 'vayd:appt-replies-changed';

export function notifyAppointmentRepliesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPT_REPLIES_CHANGED_EVENT));
}

type Counts = { mine: number; others: number };
const ZERO: Counts = { mine: 0, others: 0 };

/** One fetch loop and one socket shared by every badge on the screen (nav, quick action). */
const shared = {
  counts: ZERO,
  listeners: new Set<(c: Counts) => void>(),
  stop: null as null | (() => void),
};

function startShared(): () => void {
  const practiceId = currentPracticeId();
  let stopped = false;
  const load = async () => {
    try {
      const next = await fetchAppointmentRequestUnreadCounts(practiceId);
      if (stopped) return;
      shared.counts = next;
      shared.listeners.forEach((fn) => fn(next));
    } catch {
      /* keep the last counts */
    }
  };
  void load();
  const onRefresh = () => void load();
  const onVisible = () => {
    if (document.visibilityState === 'visible') void load();
  };
  window.addEventListener('focus', onRefresh);
  window.addEventListener(APPT_REPLIES_CHANGED_EVENT, onRefresh);
  document.addEventListener('visibilitychange', onVisible);
  const unsubscribe = subscribePracticeCalendar({
    practiceId,
    visibleProviderId: '',
    onBatch: () => {},
    onRequestSubmissionBatch: onRefresh,
    onReconnect: onRefresh,
    debounceMs: 1500,
  });
  return () => {
    stopped = true;
    window.removeEventListener('focus', onRefresh);
    window.removeEventListener(APPT_REPLIES_CHANGED_EVENT, onRefresh);
    document.removeEventListener('visibilitychange', onVisible);
    unsubscribe();
  };
}

/**
 * Requests with unread client replies (red mine or unassigned / blue others). Refreshes when a
 * request changes (websocket), when the tab regains focus, and after the page marks replies.
 */
export function useAppointmentReplyCounts(enabled: boolean): Counts {
  const [counts, setCounts] = useState<Counts>(enabled ? shared.counts : ZERO);

  useEffect(() => {
    if (!enabled) {
      setCounts(ZERO);
      return;
    }
    setCounts(shared.counts);
    shared.listeners.add(setCounts);
    if (!shared.stop) shared.stop = startShared();
    return () => {
      shared.listeners.delete(setCounts);
      if (shared.listeners.size === 0 && shared.stop) {
        shared.stop();
        shared.stop = null;
        shared.counts = ZERO;
      }
    };
  }, [enabled]);

  return counts;
}
