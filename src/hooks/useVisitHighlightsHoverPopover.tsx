import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Appointment } from '../api/roomLoader';
import {
  computeVisitHighlightsPopoverPosition,
  type HoverAnchorRect,
} from '../utils/hoverPopoverPosition';

const HOVER_DELAY_MS = 750;
const HOVER_DISMISS_MS = 280;

export function useVisitHighlightsHoverPopover(args: {
  enabled?: boolean;
  renderContent: (appt: Appointment) => ReactNode;
  zIndex?: number;
}) {
  const { enabled = true, renderContent, zIndex = 2000 } = args;
  const [hover, setHover] = useState<{
    appt: Appointment;
    x: number;
    y: number;
    el: HTMLElement | EventTarget | null;
  } | null>(null);
  const [layout, setLayout] = useState<{
    pos: ReturnType<typeof computeVisitHighlightsPopoverPosition>;
    ready: boolean;
  } | null>(null);

  const hoverPinnedRef = useRef(false);
  const hoverRevealTimerRef = useRef<number | null>(null);
  const hoverDismissTimerRef = useRef<number | null>(null);
  const hoverRevealPendingRef = useRef<{
    appt: Appointment;
    el: HTMLElement;
    x: number;
    y: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const cancelReveal = useCallback(() => {
    if (hoverRevealTimerRef.current != null) {
      window.clearTimeout(hoverRevealTimerRef.current);
      hoverRevealTimerRef.current = null;
    }
    hoverRevealPendingRef.current = null;
  }, []);

  const cancelDismiss = useCallback(() => {
    if (hoverDismissTimerRef.current != null) {
      window.clearTimeout(hoverDismissTimerRef.current);
      hoverDismissTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    cancelReveal();
    cancelDismiss();
    hoverPinnedRef.current = false;
    setHover(null);
    setLayout(null);
  }, [cancelDismiss, cancelReveal]);

  const scheduleDismiss = useCallback(
    (apptId?: string | number) => {
      cancelDismiss();
      hoverDismissTimerRef.current = window.setTimeout(() => {
        hoverDismissTimerRef.current = null;
        if (hoverPinnedRef.current) return;
        setHover((prev) => {
          if (!prev) return null;
          if (apptId != null && prev.appt.id !== apptId) return prev;
          return null;
        });
        setLayout(null);
      }, HOVER_DISMISS_MS);
    },
    [cancelDismiss]
  );

  const onMouseEnter = useCallback(
    (appt: Appointment, ev: ReactMouseEvent<HTMLElement>) => {
      if (!enabled) return;
      cancelReveal();
      cancelDismiss();
      hoverPinnedRef.current = false;
      const el = ev.currentTarget;
      hoverRevealPendingRef.current = {
        appt,
        el,
        x: ev.clientX,
        y: ev.clientY,
      };
      hoverRevealTimerRef.current = window.setTimeout(() => {
        hoverRevealTimerRef.current = null;
        const pending = hoverRevealPendingRef.current;
        hoverRevealPendingRef.current = null;
        if (!pending) return;
        setHover({
          appt: pending.appt,
          x: pending.x,
          y: pending.y,
          el: pending.el,
        });
      }, HOVER_DELAY_MS);
    },
    [enabled, cancelDismiss, cancelReveal]
  );

  const onMouseMove = useCallback((appt: Appointment, ev: ReactMouseEvent<HTMLElement>) => {
    const p = hoverRevealPendingRef.current;
    if (p && p.appt.id === appt.id) {
      p.x = ev.clientX;
      p.y = ev.clientY;
      p.el = ev.currentTarget;
    }
  }, []);

  const onMouseLeave = useCallback(
    (apptId: string | number) => {
      cancelReveal();
      scheduleDismiss(apptId);
    },
    [cancelReveal, scheduleDismiss]
  );

  const onContextMenuOpen = useCallback(() => {
    cancelReveal();
    dismiss();
  }, [cancelReveal, dismiss]);

  useLayoutEffect(() => {
    if (!hover) {
      setLayout(null);
      return;
    }
    const anchorEl = hover.el instanceof HTMLElement ? hover.el : null;
    setLayout({
      pos: computeVisitHighlightsPopoverPosition({
        anchorEl,
        x: hover.x,
        y: hover.y,
        horizontalOnly: true,
      }),
      ready: false,
    });
  }, [hover?.appt.id, hover?.el]);

  useLayoutEffect(() => {
    if (!hover || !layout || layout.ready) return;
    const anchorEl = hover.el instanceof HTMLElement ? hover.el : null;
    const el = tooltipRef.current;
    const measuredH = el ? Math.max(el.scrollHeight, el.offsetHeight) : 0;
    const anchorRect: HoverAnchorRect | null =
      anchorEl && typeof anchorEl.getBoundingClientRect === 'function'
        ? (() => {
            const r = anchorEl.getBoundingClientRect();
            return {
              top: r.top,
              left: r.left,
              bottom: r.bottom,
              right: r.right,
              width: r.width,
              height: r.height,
            };
          })()
        : null;
    setLayout({
      pos: computeVisitHighlightsPopoverPosition({
        anchorEl,
        anchorRect,
        x: hover.x,
        y: hover.y,
        measuredCardH: measuredH > 0 ? measuredH : undefined,
        horizontalOnly: true,
      }),
      ready: true,
    });
  }, [hover, layout?.ready]);

  useEffect(() => {
    if (!hover) return;
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (tooltipRef.current?.contains(target)) return;
      const anchorEl = hover.el instanceof HTMLElement ? hover.el : null;
      if (anchorEl?.contains(target)) return;
      dismiss();
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [hover, dismiss]);

  useEffect(
    () => () => {
      cancelReveal();
      cancelDismiss();
    },
    [cancelDismiss, cancelReveal]
  );

  const portal =
    hover && layout
      ? createPortal(
          <div
            ref={tooltipRef}
            className="scheduler-tooltip scheduler-tooltip--visit-highlights"
            style={{
              left: layout.pos.left,
              width: layout.pos.width,
              zIndex,
              visibility: layout.ready ? 'visible' : 'hidden',
              pointerEvents: layout.ready ? 'auto' : 'none',
              ...(layout.pos.bottom != null
                ? { top: 'auto', bottom: layout.pos.bottom }
                : { top: layout.pos.top }),
              maxWidth: layout.pos.width,
              maxHeight: layout.pos.maxCardH,
            }}
            onMouseEnter={() => {
              cancelDismiss();
              hoverPinnedRef.current = true;
            }}
            onMouseLeave={() => {
              hoverPinnedRef.current = false;
              scheduleDismiss(hover.appt.id);
            }}
          >
            {renderContent(hover.appt)}
          </div>,
          document.body
        )
      : null;

  return {
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    onContextMenuOpen,
    dismiss,
    portal,
  };
}
