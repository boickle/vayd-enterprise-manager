import { useEffect, useState } from 'react';
import {
  readEditVisitTimePreview,
  EDIT_VISIT_TIME_PREVIEW_UPDATED_EVENT,
} from './editVisitTimePreviewStorage';
import {
  readRoutingCalendarPreview,
  ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT,
} from './routingCalendarPreviewStorage';

export const ROUTING_CALENDAR_PREVIEW_BLOCKED_MESSAGE =
  'An appointment slot is previewed on the calendar. Book it from the proposed slot, or click Dismiss on the preview bar, before continuing.';

export const EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE =
  'An appointment preview is on the calendar. Save changes from the highlighted visit, or dismiss (×), before continuing.';

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
    window.alert(ROUTING_CALENDAR_PREVIEW_BLOCKED_MESSAGE);
    return true;
  }
  return false;
}

/** Use on NavLink / button handlers that navigate away while a preview is active. */
export function blockRoutingCalendarPreviewNavigation(): boolean {
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
  /** Switch which Get Best Route option is previewed on the calendar. */
  if (target.closest('.routing-result-option-card')) return true;
  if (target.closest('[data-routing-calendar-preview-card]')) return true;
  if (target.closest('.schedule-routing-workspace__calendar')) return true;
  if (target.closest('.scheduler-page')) return true;
  if (target.closest('.scheduler-modal-backdrop--routing-dock')) return true;
  if (target.closest('.scheduler-edit-inline-pane')) return true;
  if (target.closest('.scheduler-edit-placement-sidebar')) return true;
  return false;
}

function shouldBlockRoutingPaneClick(target: Element): boolean {
  if (isAllowedPreviewInteractionTarget(target)) return false;
  return Boolean(target.closest('.schedule-routing-workspace__routing'));
}

/**
 * Captures link clicks and routing form submits while a calendar preview is active.
 * Mount under `/schedule` (e.g. ScheduleLayout).
 */
export function useRoutingCalendarPreviewNavigationGuard(previewActive: boolean): void {
  useEffect(() => {
    if (!previewActive) return;

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      if (shouldBlockRoutingPaneClick(target)) {
        if (alertAndBlockRoutingCalendarPreviewLeave()) {
          e.preventDefault();
          e.stopPropagation();
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

    const onSubmitCapture = (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.classList.contains('routing-route-form-stack')) return;
      if (alertAndBlockRoutingCalendarPreviewLeave()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('submit', onSubmitCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('submit', onSubmitCapture, true);
    };
  }, [previewActive]);
}
