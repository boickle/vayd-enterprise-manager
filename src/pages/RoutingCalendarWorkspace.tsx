import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Routing from './Routing';
import Scheduler from './Scheduler';
import './RoutingCalendarWorkspace.css';

const SPLIT_STORAGE_KEY = 'schedule-routing-workspace-split';
const DEFAULT_ROUTING_PCT = 45;
const MIN_ROUTING_PCT = 22;
const MAX_ROUTING_PCT = 78;

function readStoredSplitPct(): number {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    if (raw == null) return DEFAULT_ROUTING_PCT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_ROUTING_PCT;
    return Math.min(MAX_ROUTING_PCT, Math.max(MIN_ROUTING_PCT, n));
  } catch {
    return DEFAULT_ROUTING_PCT;
  }
}

/**
 * Routing + practice calendar side by side. Routing keeps its own React state; the calendar
 * is a separate Scheduler instance from `/schedule/scheduler`. Preview sync uses sessionStorage + a window event.
 */
export default function RoutingCalendarWorkspace() {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [routingPct, setRoutingPct] = useState(readStoredSplitPct);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startPct: number } | null>(null);

  const persistSplit = useCallback((pct: number) => {
    const clamped = Math.min(MAX_ROUTING_PCT, Math.max(MIN_ROUTING_PCT, pct));
    setRoutingPct(clamped);
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(clamped * 10) / 10));
    } catch {
      /* ignore */
    }
  }, []);

  const applySplitFromPointer = useCallback(
    (clientX: number) => {
      const el = workspaceRef.current;
      const drag = dragRef.current;
      if (!el || !drag) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const deltaPct = ((clientX - drag.startX) / rect.width) * 100;
      persistSplit(drag.startPct + deltaPct);
    },
    [persistSplit]
  );

  const onSplitterPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startPct: routingPct };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [routingPct]
  );

  const onSplitterPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      applySplitFromPointer(e.clientX);
    },
    [applySplitFromPointer]
  );

  const endSplitterDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  return (
    <div
      ref={workspaceRef}
      className={[
        'schedule-routing-workspace',
        dragging ? 'schedule-routing-workspace--resizing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--routing-split-pct' as string]: `${routingPct}%` }}
    >
      <div className="schedule-routing-workspace__routing">
        <div className="schedule-routing-workspace__routing-inner">
          <Routing calendarWorkspaceMode />
        </div>
      </div>
      <div
        className="schedule-routing-workspace__splitter"
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={MIN_ROUTING_PCT}
        aria-valuemax={MAX_ROUTING_PCT}
        aria-valuenow={Math.round(routingPct)}
        aria-label="Resize routing and calendar panels"
        tabIndex={0}
        onPointerDown={onSplitterPointerDown}
        onPointerMove={onSplitterPointerMove}
        onPointerUp={endSplitterDrag}
        onPointerCancel={endSplitterDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            persistSplit(routingPct - 2);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            persistSplit(routingPct + 2);
          }
        }}
      />
      <div className="schedule-routing-workspace__calendar">
        <div className="schedule-routing-workspace__calendar-scroll">
          <Scheduler embedInRoutingWorkspace />
        </div>
      </div>
    </div>
  );
}
