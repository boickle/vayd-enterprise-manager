import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Routing from './Routing';
import Scheduler from './Scheduler';
import { hasActiveForwardBookingWorkspaceLock } from '../utils/forwardBookingWorkspaceGuard';
import { hasActiveRoutingCalendarPreview } from '../utils/routingCalendarPreviewGuard';
import { ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT } from '../utils/routingCalendarPreviewStorage';
import {
  appointmentRequestWorkspaceIsActive,
  ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT,
} from '../utils/routingAppointmentRequestIntent';
import { ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT } from '../utils/routingForwardBookingIntent';
import {
  rescheduleIntentIsActive,
  ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT,
} from '../utils/routingRescheduleIntent';
import './RoutingCalendarWorkspace.css';

const SPLIT_STORAGE_KEY = 'schedule-routing-workspace-split';
const DEFAULT_ROUTING_PCT = 45;
const MIN_ROUTING_PCT = 22;
const MAX_ROUTING_PCT = 78;
const MOBILE_MQ = '(max-width: 900px)';

function isMobileRoutingViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches;
}

function mobileRoutingNeedsEmbeddedCalendar(): boolean {
  return (
    hasActiveRoutingCalendarPreview() ||
    rescheduleIntentIsActive() ||
    hasActiveForwardBookingWorkspaceLock() ||
    appointmentRequestWorkspaceIsActive()
  );
}

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
  const calendarPaneRef = useRef<HTMLDivElement>(null);
  const [routingPct, setRoutingPct] = useState(readStoredSplitPct);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startPct: number } | null>(null);
  const [mobileViewport, setMobileViewport] = useState(isMobileRoutingViewport);
  const [showEmbeddedCalendar, setShowEmbeddedCalendar] = useState(
    () => !isMobileRoutingViewport() || mobileRoutingNeedsEmbeddedCalendar()
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onMq = () => setMobileViewport(mq.matches);
    onMq();
    mq.addEventListener('change', onMq);
    return () => mq.removeEventListener('change', onMq);
  }, []);

  useEffect(() => {
    const syncCalendar = () => {
      setShowEmbeddedCalendar(!mobileViewport || mobileRoutingNeedsEmbeddedCalendar());
    };
    syncCalendar();
    const events = [
      ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT,
      ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT,
      ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT,
      ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT,
    ] as const;
    for (const name of events) {
      window.addEventListener(name, syncCalendar);
    }
    return () => {
      for (const name of events) {
        window.removeEventListener(name, syncCalendar);
      }
    };
  }, [mobileViewport]);

  useEffect(() => {
    if (!mobileViewport) return;
    const outlet = document.querySelector('.schedule-app__outlet--routing-split');
    outlet?.scrollTo({ top: 0, behavior: 'auto' });
  }, [mobileViewport]);

  useEffect(() => {
    if (!mobileViewport || !showEmbeddedCalendar) return;
    calendarPaneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [mobileViewport, showEmbeddedCalendar]);

  const mobileRoutingOnly = mobileViewport && !showEmbeddedCalendar;

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
        mobileRoutingOnly ? 'schedule-routing-workspace--mobile-routing-only' : '',
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
      <div
        ref={calendarPaneRef}
        className={[
          'schedule-routing-workspace__calendar',
          showEmbeddedCalendar ? '' : 'schedule-routing-workspace__calendar--mobile-hidden',
        ]
          .filter(Boolean)
          .join(' ')}
        hidden={!showEmbeddedCalendar}
        aria-hidden={!showEmbeddedCalendar}
      >
        <div className="schedule-routing-workspace__calendar-scroll">
          <Scheduler embedInRoutingWorkspace />
        </div>
      </div>
    </div>
  );
}
