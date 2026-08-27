import { useEffect, useState } from 'react';
import {
  readEditVisitTimePreview,
  EDIT_VISIT_TIME_PREVIEW_UPDATED_EVENT,
} from './editVisitTimePreviewStorage';
import {
  readRoutingCalendarPreview,
  ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT,
} from './routingCalendarPreviewStorage';
import { blockForwardBookingWorkspaceNavigation } from './forwardBookingWorkspaceGuard';

export const ROUTING_CALENDAR_PREVIEW_BLOCKED_MESSAGE =
  'A calendar preview is open. Book or dismiss from the preview slot before using the calendar.';

/** Fired when a click on the calendar pane is blocked during a preview (Scheduler shows a toast). */
export const ROUTING_PREVIEW_CALENDAR_BLOCKED_EVENT = 'vayd:routing-preview-calendar-blocked';

export function notifyRoutingPreviewCalendarBlocked(): void {
  window.dispatchEvent(new Event(ROUTING_PREVIEW_CALENDAR_BLOCKED_EVENT));
}

export const EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE =
  'An appointment preview is on the calendar. Save changes from the highlighted visit, or dismiss (×), before continuing.';

export const RESCHEDULE_CALENDAR_BLOCKED_MESSAGE =
  'Dismiss rescheduling or finish choosing a new slot before using the calendar.';

export const FORWARD_BOOKING_CALENDAR_BLOCKED_MESSAGE =
  'Forward booking is locked to this workflow. Preview a slot from Get Best Route, or use Exit forward booking.';

export const EDIT_VISIT_CALENDAR_BLOCKED_MESSAGE = 'Close Edit visit to use the calendar.';

export function getScheduleCalendarPreviewBlockedMessage(): string {
  if (hasActiveEditVisitTimePreview()) {
    return EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE;
  }
  const preview = readRoutingCalendarPreview();
  if (preview?.previewSource === 'manual-book') {
    return 'Dismiss the manual booking preview before using the calendar.';
  }
  if (preview?.previewSource === 'schedule-loader') {
    return 'Go back to Schedule Loader or dismiss the preview before using the calendar.';
  }
  if (preview?.previewSource === 'waitlist') {
    return 'Go back to Waitlist or dismiss the preview before using the calendar.';
  }
  if (preview?.previewSource === 'schedule-optimize') {
    return 'Book or dismiss this Optimize preview before using the calendar.';
  }
  if (preview) {
    return 'Dismiss the calendar preview before using the calendar.';
  }
  return ROUTING_CALENDAR_PREVIEW_BLOCKED_MESSAGE;
}

export function hasActiveRoutingCalendarPreview(): boolean {
  return readRoutingCalendarPreview() != null;
}

export function hasActiveEditVisitTimePreview(): boolean {
  return readEditVisitTimePreview() != null;
}

export function hasActiveScheduleCalendarPreviewBlock(): boolean {
  return hasActiveRoutingCalendarPreview() || hasActiveEditVisitTimePreview();
}

/** @returns true when the action should be blocked (preview active). Shows an alert. */
export function alertAndBlockRoutingCalendarPreviewLeave(): boolean {
  if (hasActiveEditVisitTimePreview()) {
    window.alert(EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE);
    return true;
  }
  if (hasActiveRoutingCalendarPreview()) {
    window.alert(getScheduleCalendarPreviewBlockedMessage());
    return true;
  }
  return false;
}

/** Use on NavLink / button handlers that navigate away while a preview is active. */
export function blockRoutingCalendarPreviewNavigation(): boolean {
  if (blockForwardBookingWorkspaceNavigation()) return true;
  return alertAndBlockRoutingCalendarPreviewLeave();
}

export function useRoutingCalendarPreviewActive(): boolean {
  const [active, setActive] = useState(() => hasActiveScheduleCalendarPreviewBlock());

  useEffect(() => {
    const sync = () => setActive(hasActiveScheduleCalendarPreviewBlock());
    sync();
    window.addEventListener(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT, sync);
    window.addEventListener(EDIT_VISIT_TIME_PREVIEW_UPDATED_EVENT, sync);
    return () => {
      window.removeEventListener(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT, sync);
      window.removeEventListener(EDIT_VISIT_TIME_PREVIEW_UPDATED_EVENT, sync);
    };
  }, []);

  return active;
}

function hrefToPathname(href: string): string | null {
  try {
    return new URL(href, window.location.origin).pathname;
  } catch {
    return null;
  }
}

/** Google Maps and other off-site links should work during a calendar preview. */
function isExternalAppHref(href: string): boolean {
  try {
    return new URL(href, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function isAllowedPreviewInteractionTarget(target: Element): boolean {
  if (target.closest('[data-schedule-preview-allow]')) return true;
  /** Entire routing pane (form, results, Get Best Route) stays interactive during preview. */
  if (target.closest('.schedule-routing-workspace__routing')) return true;
  /** Switch which Get Best Route option is previewed on the calendar. */
  if (target.closest('.routing-result-option-card')) return true;
  if (target.closest('[data-routing-calendar-preview-card]')) return true;
  if (target.closest('.scheduler-embedded-preview-bar')) return true;
  if (target.closest('.scheduler-routing-preview-banner')) return true;
  if (target.closest('.scheduler-routing-preview-slot')) return true;
  if (target.closest('.scheduler-modal-backdrop--routing-dock')) return true;
  if (target.closest('.scheduler-edit-inline-pane')) return true;
  if (target.closest('.scheduler-edit-placement-sidebar')) return true;
  if (target.closest('.scheduler-calendar-blocked-notice-shell')) return true;
  if (target.closest('.scheduler-edit-preview-popover-shell')) return true;
  if (target.closest('.scheduler-edit-time-preview-slot')) return true;
  return false;
}

function isSchedulerCalendarSurface(target: Element): boolean {
  return Boolean(
    target.closest('.schedule-routing-workspace__calendar') ||
      target.closest('.scheduler-calendar-shell') ||
      target.closest('.scheduler-toolbar-calendar-merge')
  );
}

function shouldBlockCalendarPaneClick(target: Element): boolean {
  if (!isSchedulerCalendarSurface(target)) return false;
  if (isAllowedPreviewInteractionTarget(target)) return false;
  if (target.closest('.scheduler-routing-preview-banner')) return false;
  if (target.closest('.scheduler-embedded-preview-bar')) return false;
  if (target.closest('.scheduler-embedded-reschedule-bar')) return false;
  if (target.closest('.scheduler-embedded-forward-booking-bar')) return false;
  /** Allow hover on visits and drive segments; actions are blocked in event handlers. */
  if (target.closest('.scheduler-event')) return false;
  if (target.closest('.scheduler-all-day-span-bar')) return false;
  if (target.closest('.scheduler-day-drive-segment')) return false;
  if (target.closest('.scheduler-tooltip--visit-highlights')) return false;
  return true;
}

/**
 * Captures link clicks and calendar-pane clicks while a calendar preview is active.
 * Mount under `/schedule` (e.g. ScheduleLayout).
 */
export function useRoutingCalendarPreviewNavigationGuard(previewActive: boolean): void {
  useEffect(() => {
    if (!previewActive) return;

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      if (shouldBlockCalendarPaneClick(target)) {
        e.preventDefault();
        e.stopPropagation();
        if (hasActiveEditVisitTimePreview()) {
          window.alert(EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE);
        } else if (hasActiveRoutingCalendarPreview()) {
          notifyRoutingPreviewCalendarBlocked();
        }
        return;
      }

      const anchor = target.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (isExternalAppHref(href)) return;

      const nextPath = hrefToPathname(href);
      if (!nextPath || nextPath === window.location.pathname) return;

      if (alertAndBlockRoutingCalendarPreviewLeave()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [previewActive]);
}
