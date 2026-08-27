import { useCallback, useEffect, useState } from 'react';
import {
  loadScheduleOptimizeMoveMeta,
  subscribeScheduleOptimizeMoveMeta,
  type ScheduleOptimizeMoveMeta,
} from '../utils/scheduleOptimizeMoveMeta';

export function useScheduleOptimizeMoveMeta(practiceId: number): ScheduleOptimizeMoveMeta[] {
  const [items, setItems] = useState(() => loadScheduleOptimizeMoveMeta(practiceId));

  const reload = useCallback(() => {
    setItems(loadScheduleOptimizeMoveMeta(practiceId));
  }, [practiceId]);

  useEffect(() => {
    reload();
    return subscribeScheduleOptimizeMoveMeta(reload);
  }, [reload]);

  return items;
}
