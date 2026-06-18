import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dayjs } from 'dayjs';

export type DateRange = { from: Dayjs; to: Dayjs };

function normalizeRange(next: DateRange): DateRange {
  const from = next.from.startOf('day');
  const to = next.to.startOf('day');
  return from.isAfter(to) ? { from: to, to: from } : { from, to };
}

/**
 * Committed `range` drives data fetching. Custom date pickers edit `draftRange` and only
 * commit once both start and end have been chosen in the current edit session.
 */
export function useCommittedDateRange(initial: DateRange) {
  const [range, setRangeState] = useState(() => normalizeRange(initial));
  const [draftRange, setDraftRange] = useState(() => normalizeRange(initial));
  const customTouchedRef = useRef({ from: false, to: false });

  const applyRange = useCallback((next: DateRange) => {
    const normalized = normalizeRange(next);
    customTouchedRef.current = { from: false, to: false };
    setRangeState(normalized);
    setDraftRange(normalized);
  }, []);

  const onCustomFromChange = useCallback((from: Dayjs) => {
    customTouchedRef.current.from = true;
    setDraftRange((d) => ({ from: from.startOf('day'), to: d.to }));
  }, []);

  const onCustomToChange = useCallback((to: Dayjs) => {
    customTouchedRef.current.to = true;
    setDraftRange((d) => ({ from: d.from, to: to.startOf('day') }));
  }, []);

  useEffect(() => {
    if (customTouchedRef.current.from && customTouchedRef.current.to) {
      applyRange(draftRange);
    }
  }, [draftRange, applyRange]);

  return {
    range,
    draftRange,
    applyRange,
    onCustomFromChange,
    onCustomToChange,
  };
}
