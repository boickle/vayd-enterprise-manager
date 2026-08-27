import { useCallback, useEffect, useState } from 'react';
import {
  loadScheduleOptimizeSavings,
  subscribeScheduleOptimizeSavings,
  type ScheduleOptimizeSavingsEvent,
} from '../utils/scheduleOptimizeSavings';

export function useScheduleOptimizeSavings(practiceId: number): ScheduleOptimizeSavingsEvent[] {
  const [items, setItems] = useState(() => loadScheduleOptimizeSavings(practiceId));

  const reload = useCallback(() => {
    setItems(loadScheduleOptimizeSavings(practiceId));
  }, [practiceId]);

  useEffect(() => {
    reload();
    return subscribeScheduleOptimizeSavings(reload);
  }, [reload]);

  return items;
}
