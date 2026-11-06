import { useEffect, useState } from 'react';
import { appAlert } from './appDialog';
import {
  forwardBookingWorkspaceIsActive,
  ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT,
} from './routingForwardBookingIntent';

export const FORWARD_BOOKING_ROUTE_PATH = '/schedule/routing';

export const FORWARD_BOOKING_NAVIGATION_BLOCKED_MESSAGE =
  'Forward booking is in progress. Use Exit forward booking to leave this workflow.';

export function hasActiveForwardBookingWorkspaceLock(): boolean {
  return forwardBookingWorkspaceIsActive();
}

export function alertAndBlockForwardBookingWorkspaceLeave(): boolean {
  if (!hasActiveForwardBookingWorkspaceLock()) return false;
  void appAlert({
    title: 'Forward booking in progress',
    message: FORWARD_BOOKING_NAVIGATION_BLOCKED_MESSAGE,
  });
  return true;
}

export function blockForwardBookingWorkspaceNavigation(): boolean {
  return alertAndBlockForwardBookingWorkspaceLeave();
}

export function useForwardBookingWorkspaceLockActive(): boolean {
  const [active, setActive] = useState(() => hasActiveForwardBookingWorkspaceLock());

  useEffect(() => {
    const sync = () => setActive(hasActiveForwardBookingWorkspaceLock());
    sync();
    window.addEventListener(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT, sync);
    return () => window.removeEventListener(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT, sync);
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

function isExternalAppHref(href: string): boolean {
  try {
    return new URL(href, window.location.origin).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function isForwardBookingExitControl(target: Element): boolean {
  return Boolean(
    target.closest('.scheduler-embedded-forward-booking-bar-dismiss') ||
      target.closest('.scheduler-forward-booking-workspace-back')
  );
}

/** Clicks that stay inside the forward-booking workflow (routing pane, preview, book modal). */
export function isAllowedForwardBookingWorkspaceTarget(target: Element): boolean {
  if (isForwardBookingExitControl(target)) return true;
  if (target.closest('[data-forward-booking-workspace-allow]')) return true;
  if (target.closest('[data-schedule-preview-allow]')) return true;
  if (target.closest('.schedule-routing-workspace__routing')) return true;
  if (target.closest('.routing-result-option-card')) return true;
  if (target.closest('[data-routing-calendar-preview-card]')) return true;
  if (target.closest('[data-routing-preview-slot]')) return true;
  if (target.closest('.scheduler-routing-preview-slot')) return true;
  if (target.closest('.scheduler-embedded-preview-bar')) return true;
  if (target.closest('.scheduler-embedded-forward-booking-bar')) return true;
  if (target.closest('.scheduler-modal-backdrop')) return true;
  if (target.closest('.scheduler-modal')) return true;
  if (target.closest('.scheduler-edit-preview-popover-shell')) return true;
  if (target.closest('.scheduler-routing-preview-banner')) return true;
  if (target.closest('.scheduler-calendar-blocked-notice-shell')) return true;
  return false;
}

function isSchedulerCalendarSurface(target: Element): boolean {
  return Boolean(
    target.closest('.schedule-routing-workspace__calendar') ||
      target.closest('.scheduler-calendar-shell') ||
      target.closest('.scheduler-toolbar-calendar-merge')
  );
}

function shouldBlockForwardBookingCalendarClick(target: Element): boolean {
  if (!isSchedulerCalendarSurface(target)) return false;
  if (isAllowedForwardBookingWorkspaceTarget(target)) return false;
  /** Hover-only on visits; actions are blocked in Scheduler handlers. */
  if (target.closest('.scheduler-event')) return false;
  if (target.closest('.scheduler-all-day-span-bar')) return false;
  if (target.closest('.scheduler-day-drive-segment')) return false;
  if (target.closest('.scheduler-tooltip--visit-highlights')) return false;
  return true;
}

/**
 * Captures link clicks and stray calendar-pane clicks while forward booking is locked.
 * Mount under `/schedule` (e.g. ScheduleLayout).
 */
export function useForwardBookingWorkspaceNavigationGuard(lockActive: boolean): void {
  useEffect(() => {
    if (!lockActive) return;

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      if (isForwardBookingExitControl(target)) return;

      if (shouldBlockForwardBookingCalendarClick(target)) {
        e.preventDefault();
        e.stopPropagation();
        alertAndBlockForwardBookingWorkspaceLeave();
        return;
      }

      if (isAllowedForwardBookingWorkspaceTarget(target)) return;

      const anchor = target.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (isExternalAppHref(href)) return;

      const nextPath = hrefToPathname(href);
      if (!nextPath || nextPath === window.location.pathname) return;
      if (nextPath === FORWARD_BOOKING_ROUTE_PATH) return;

      if (alertAndBlockForwardBookingWorkspaceLeave()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [lockActive]);
}
