import { useCallback, useEffect, useState } from 'react';
import { fetchUnscheduledReminders } from '../api/careOutreach';
import { fetchForwardBookings } from '../api/forwardBooking';
import { fetchSlotOffers } from '../api/slotOffers';
import { fetchWaitlist } from '../api/waitlist';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  buildAppointmentTypeCatalogFromTypes,
  forwardBookingEntryVisibleOnList,
  forwardBookingListTab,
} from '../utils/forwardBookingListVisibility';
import {
  careOutreachPriorityNavCountFetchRange,
  countCareOutreachPriorityClients,
} from '../utils/careOutreachPriorityFilters';
import {
  filterCareOutreachRemindersForForwardBooking,
  forwardBookingPatientIdsActiveInQueue,
} from '../utils/careOutreachForwardBookingExclude';
import {
  forwardBookingIdsFromRoutingIntent,
  readRoutingForwardBookingIntent,
} from '../utils/routingForwardBookingIntent';
import { forwardBookingOnHoldOver24Hours } from '../utils/forwardBookingOnHold';
import {
  forwardBookingEntryBelongsOnForwardBookingPage,
  forwardBookingOnHoldBelongsInSchedulingTools,
} from '../utils/forwardBookingEntrySource';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import {
  countQueuedScheduleOptimizeItems,
  SCHEDULE_OPTIMIZE_QUEUE_EVENT,
} from '../utils/scheduleOptimizeQueue';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export const SCHEDULING_TOOLS_COUNTS_REFRESH_EVENT = 'vayd:scheduling-tools-counts-refresh';
export const SCHEDULING_TOOLS_PAGE_REFRESH_EVENT = 'vayd:scheduling-tools-page-refresh';

export type SchedulingToolsNavCounts = {
  forwardBookingPending: number;
  booked: number;
  onHold: number;
  onHoldOver24: number;
  careOutreachPriority: number;
  textedOffersActive: number;
  textedOffersNeedsFollowUp: number;
  textedOffersToConfirm: number;
  waitlistWaiting: number;
  scheduleOptimizeQueued: number;
};

const EMPTY_COUNTS: SchedulingToolsNavCounts = {
  forwardBookingPending: 0,
  booked: 0,
  onHold: 0,
  onHoldOver24: 0,
  careOutreachPriority: 0,
  textedOffersActive: 0,
  textedOffersNeedsFollowUp: 0,
  textedOffersToConfirm: 0,
  waitlistWaiting: 0,
  scheduleOptimizeQueued: 0,
};

export function useSchedulingToolsNavCounts(enabled = true) {
  const [counts, setCounts] = useState<SchedulingToolsNavCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const careRange = careOutreachPriorityNavCountFetchRange();
      const [types, forwardBookings, careReminders, activeOffers, toConfirmOffers, waitlistWaiting] = await Promise.all([
        fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false }),
        fetchForwardBookings({ practiceId: PRACTICE_ID, limit: 2000, includeRemoved: true }),
        fetchUnscheduledReminders({
          practiceId: PRACTICE_ID,
          dueDateFrom: careRange.from,
          dueDateTo: careRange.to,
          limit: 2000,
        }),
        fetchSlotOffers({ practiceId: PRACTICE_ID, tab: 'active' }).catch(() => []),
        fetchSlotOffers({ practiceId: PRACTICE_ID, tab: 'to_confirm' }).catch(() => []),
        fetchWaitlist({ practiceId: PRACTICE_ID, status: 'waiting', limit: 2000 }).catch(() => []),
      ]);

      const catalog = buildAppointmentTypeCatalogFromTypes(types);
      const practiceTz = practiceTimeZoneOrDefault(undefined);
      const visible = forwardBookings.filter((r) => forwardBookingEntryVisibleOnList(r));

      let forwardBookingPending = 0;
      let booked = 0;
      let onHold = 0;
      let onHoldOver24 = 0;
      for (const row of visible) {
        const tab = forwardBookingListTab(row, practiceTz, null, catalog);
        if (tab === 'pending' && forwardBookingEntryBelongsOnForwardBookingPage(row)) {
          forwardBookingPending += 1;
        } else if (tab === 'booked') {
          booked += 1;
        } else if (tab === 'onHold') {
          if (!forwardBookingOnHoldBelongsInSchedulingTools(row)) continue;
          onHold += 1;
          if (forwardBookingOnHoldOver24Hours(row, null)) onHoldOver24 += 1;
        }
      }

      const routingIntent = readRoutingForwardBookingIntent();
      const activeRoutingForwardBookingIds =
        routingIntent?.workspaceActive &&
        (routingIntent.origin === 'care_outreach' ||
          routingIntent.origin === 'schedule_loader' ||
          routingIntent.origin === 'waitlist')
          ? new Set(forwardBookingIdsFromRoutingIntent(routingIntent))
          : undefined;
      const blockedPatientIds = forwardBookingPatientIdsActiveInQueue(
        visible,
        practiceTz,
        null,
        catalog,
        { activeRoutingForwardBookingIds },
      );
      const careOutreachForCount = filterCareOutreachRemindersForForwardBooking(
        careReminders,
        blockedPatientIds,
      );

      setCounts({
        forwardBookingPending,
        booked,
        onHold,
        onHoldOver24,
        careOutreachPriority: countCareOutreachPriorityClients(careOutreachForCount),
        textedOffersActive: activeOffers.length,
        textedOffersNeedsFollowUp: activeOffers.filter(
          (row) => row.status === 'manual_review' && row.resolved !== true
        ).length,
        textedOffersToConfirm: toConfirmOffers.length,
        waitlistWaiting: waitlistWaiting.length,
        scheduleOptimizeQueued: countQueuedScheduleOptimizeItems(PRACTICE_ID),
      });
    } catch {
      setCounts({
        ...EMPTY_COUNTS,
        scheduleOptimizeQueued: countQueuedScheduleOptimizeItems(PRACTICE_ID),
      });
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onRefresh = () => {
      void refresh();
    };
    window.addEventListener(SCHEDULING_TOOLS_COUNTS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_COUNTS_REFRESH_EVENT, onRefresh);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onQueue = () => {
      setCounts((prev) => ({
        ...prev,
        scheduleOptimizeQueued: countQueuedScheduleOptimizeItems(PRACTICE_ID),
      }));
    };
    window.addEventListener(SCHEDULE_OPTIMIZE_QUEUE_EVENT, onQueue);
    return () => window.removeEventListener(SCHEDULE_OPTIMIZE_QUEUE_EVENT, onQueue);
  }, [enabled]);

  return { counts, loading, refresh };
}

export function notifySchedulingToolsNavCountsRefresh(): void {
  window.dispatchEvent(new Event(SCHEDULING_TOOLS_COUNTS_REFRESH_EVENT));
}

export function notifySchedulingToolsPageRefresh(): void {
  window.dispatchEvent(new Event(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT));
}
