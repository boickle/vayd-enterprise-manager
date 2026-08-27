import { useCallback, useEffect, useState } from 'react';
import {
  loadScheduleOptimizeQueue,
  subscribeScheduleOptimizeQueue,
  type ScheduleOptimizeQueueItem,
} from '../utils/scheduleOptimizeQueue';

export function useScheduleOptimizeQueue(practiceId: number): ScheduleOptimizeQueueItem[] {
  const [items, setItems] = useState(() => loadScheduleOptimizeQueue(practiceId));

  const reload = useCallback(() => {
    setItems(loadScheduleOptimizeQueue(practiceId));
  }, [practiceId]);

  useEffect(() => {
    reload();
    return subscribeScheduleOptimizeQueue(reload);
  }, [reload]);

  return items;
}
