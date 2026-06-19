import { useCallback, useEffect, useState } from 'react';
import { fetchUnscheduledReminders } from '../api/careOutreach';
import { fetchForwardBookings } from '../api/forwardBooking';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  buildAppointmentTypeCatalogFromTypes,
  buildBookedAppointmentMetaMap,
  forwardBookingEntryVisibleOnList,
  forwardBookingListTab,
} from '../utils/forwardBookingListVisibility';
import {
  careOutreachPriorityNavCountFetchRange,
  countCareOutreachPriorityClients,
} from '../utils/careOutreachPriorityFilters';
import { forwardBookingOnHoldOver24Hours } from '../utils/forwardBookingOnHold';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export const SCHEDULING_TOOLS_COUNTS_REFRESH_EVENT = 'vayd:scheduling-tools-counts-refresh';

export type SchedulingToolsNavCounts = {
  forwardBookingPending: number;
  onHold: number;
  onHoldOver24: number;
  careOutreachPriority: number;
};

const EMPTY_COUNTS: SchedulingToolsNavCounts = {
  forwardBookingPending: 0,
  onHold: 0,
  onHoldOver24: 0,
  careOutreachPriority: 0,
};

export function useSchedulingToolsNavCounts(enabled = true, refreshKey?: string) {
  const [counts, setCounts] = useState<SchedulingToolsNavCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const careRange = careOutreachPriorityNavCountFetchRange();
      const [types, forwardBookings, careReminders] = await Promise.all([
        fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false }),
        fetchForwardBookings({ practiceId: PRACTICE_ID, limit: 2000, includeRemoved: true }),
        fetchUnscheduledReminders({
          practiceId: PRACTICE_ID,
          dueDateFrom: careRange.from,
          dueDateTo: careRange.to,
          limit: 2000,
        }),
      ]);

      const catalog = buildAppointmentTypeCatalogFromTypes(types);
      const practiceTz = practiceTimeZoneOrDefault(undefined);
      const visible = forwardBookings.filter((r) => forwardBookingEntryVisibleOnList(r));
      const metaMap = await buildBookedAppointmentMetaMap(visible, PRACTICE_ID, catalog);

      let forwardBookingPending = 0;
      let onHold = 0;
      let onHoldOver24 = 0;
      for (const row of visible) {
        const tab = forwardBookingListTab(row, practiceTz, metaMap, catalog);
        if (tab === 'pending') forwardBookingPending += 1;
        else if (tab === 'onHold') {
          onHold += 1;
          if (forwardBookingOnHoldOver24Hours(row, metaMap)) onHoldOver24 += 1;
        }
      }

      setCounts({
        forwardBookingPending,
        onHold,
        onHoldOver24,
        careOutreachPriority: countCareOutreachPriorityClients(careReminders),
      });
    } catch {
      setCounts(EMPTY_COUNTS);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (!enabled) return;
    const onRefresh = () => {
      void refresh();
    };
    window.addEventListener(SCHEDULING_TOOLS_COUNTS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_COUNTS_REFRESH_EVENT, onRefresh);
  }, [enabled, refresh]);

  return { counts, loading, refresh };
}

export function notifySchedulingToolsNavCountsRefresh(): void {
  window.dispatchEvent(new Event(SCHEDULING_TOOLS_COUNTS_REFRESH_EVENT));
}
