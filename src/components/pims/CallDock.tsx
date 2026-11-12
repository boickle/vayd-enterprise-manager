import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, Minus, Phone, X } from 'lucide-react';
import './CallDock.css';

// v2 (Nov 12, 2026): the dock moved from mid-screen to the bottom-right corner; old saved spots are ignored.
const POSITION_KEY = 'vayd-call-dock-position-v2';
const COLLAPSED_KEY = 'vayd-call-dock-collapsed';
const DOCK_WIDTH = 380;

type Point = { x: number; y: number };

function clampToViewport(p: Point): Point {
  const maxX = Math.max(8, window.innerWidth - DOCK_WIDTH - 8);
  const maxY = Math.max(8, window.innerHeight - 160);
  return {
    x: Math.min(Math.max(8, p.x), maxX),
    y: Math.min(Math.max(8, p.y), maxY),
  };
}


function readCollapsed(): boolean {
  try {
    return sessionStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function readStoredPosition(): Point | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Point;
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return null;
    return clampToViewport(p);
  } catch {
    return null;
  }
}

/**
 * True while any modal dialog is open on the page (the call review, a text window, a confirm box).
 * The dock steps aside then, so it never covers the window you are working in.
 */
function useAnyModalOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setOpen(Boolean(document.querySelector('[aria-modal="true"]')));
    };
    check();
    const observer = new MutationObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(check);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return open;
}

export type CallDockTone = 'live' | 'ready' | 'muted';

export type CallDockPeek = {
  key: string;
  who: string;
  tone: CallDockTone;
  label: string;
};

type Props = {
  tone: CallDockTone;
  /** Short uppercase strip text, e.g. "On a call". */
  gripLabel: string;
  /** Who is on the other end. */
  who: string;
  /** The big line — what is happening right now. */
  state: ReactNode;
  /** Small explanatory line under the state. */
  note?: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Labeled dismiss in the action row (and the grip X when onDismiss is set). */
  dismissLabel?: string;
  /**
   * Optional. Clinical summaries should not be waved off from the grip —
   * use Review & file → Don't file instead. Admin / live dials may still dismiss.
   */
  onDismiss?: () => void;
  /** Other calls sitting behind this one, like a bunch of post-its. */
  behind?: CallDockPeek[];
  /** Shown under the stack, e.g. when there are more calls than the dock lists. */
  stackNote?: string;
  onSelectBehind?: (key: string) => void;
  /** Hide the dock entirely (e.g. while its review window is open, so nothing sits on top of it). */
  hidden?: boolean;
  /** A ringing or live call: the dock opens itself even if it was minimized. */
  urgent?: boolean;
};

/**
 * The call, as a thing you cannot miss.
 *
 * Floats over the page rather than sitting in the chart flow, because the call outlives any
 * one screen. Intentionally not a modal — no backdrop, nothing trapped — so the page
 * underneath stays scrollable and clickable. Drag it anywhere; the spot is remembered.
 * Extra calls wait in a short list under it; click one to bring it forward.
 */
export default function CallDock({
  tone,
  gripLabel,
  who,
  state,
  note,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  dismissLabel,
  onDismiss,
  behind = [],
  stackNote,
  onSelectBehind,
  hidden = false,
  urgent = false,
}: Props) {
  const [collapsed, setCollapsedState] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : readCollapsed(),
  );
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      sessionStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => {
    if (urgent) setCollapsed(false);
  }, [urgent, setCollapsed]);
  const modalOpen = useAnyModalOpen();
  // null = not moved yet: pinned to the bottom-right corner (grows upward, so it never runs off the screen).
  const [pos, setPos] = useState<Point | null>(() =>
    typeof window === 'undefined' ? null : readStoredPosition(),
  );
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const box = (e.currentTarget.closest('.call-dock-bunch') as HTMLElement | null)?.getBoundingClientRect();
      const from = pos ?? { x: box?.left ?? 0, y: box?.top ?? 0 };
      drag.current = { dx: e.clientX - from.x, dy: e.clientY - from.y };
    },
    [pos],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos(clampToViewport({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
  }, []);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
    } catch {
      /* private mode */
    }
  }, [pos]);

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampToViewport(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A ringing or live call stays visible even over a dialog; anything else waits until it closes.
  if (typeof document === 'undefined' || hidden || (modalOpen && !urgent)) return null;

  const extra = behind.slice(0, 3);
  const hiddenBehind = behind.length - extra.length;
  const total = behind.length + 1;

  if (collapsed) {
    return createPortal(
      <button
        type="button"
        className={`call-dock-pill${tone === 'ready' ? ' call-dock-pill--ready' : ''}${
          tone === 'muted' ? ' call-dock-pill--muted' : ''
        }`}
        onClick={() => setCollapsed(false)}
        title="Show your calls"
      >
        <Phone size={14} aria-hidden />
        <span>{total === 1 ? `Call · ${gripLabel}` : `Calls · ${total} waiting`}</span>
        <span className="call-dock-pill__show">Show</span>
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="call-dock-bunch"
      style={pos ? { left: pos.x, top: pos.y } : { right: 20, bottom: 20 }}
    >
      <div
        className={`call-dock${tone === 'ready' ? ' call-dock--ready' : ''}${
          tone === 'muted' ? ' call-dock--muted' : ''
        }`}
        role="status"
        aria-live="polite"
      >
        <div
          className="call-dock__grip"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <GripHorizontal size={15} aria-hidden />
          <span className="call-dock__grip-label">
            {gripLabel}
            {total > 1 ? ` · ${total} calls` : ''}
          </span>
          <button
            type="button"
            className="call-dock__grip-btn"
            aria-label="Minimize"
            title="Minimize (a new call opens it again)"
            onClick={() => setCollapsed(true)}
          >
            <Minus size={13} aria-hidden />
          </button>
          {onDismiss ? (
            <button
              type="button"
              className="call-dock__grip-btn"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={onDismiss}
            >
              <X size={13} aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="call-dock__body">
          <p className="call-dock__who">
            <Phone size={11} aria-hidden style={{ verticalAlign: '-1px', marginRight: 5 }} />
            {who}
          </p>
          <p className="call-dock__state">
            <span className="call-dock__dot" aria-hidden />
            <span>{state}</span>
          </p>
          {note ? <p className="call-dock__note">{note}</p> : null}
          {primaryLabel || secondaryLabel || (dismissLabel && onDismiss) ? (
            <div className="call-dock__actions">
              {primaryLabel ? (
                <button type="button" className="call-dock__primary" onClick={onPrimary}>
                  {primaryLabel}
                </button>
              ) : null}
              {secondaryLabel ? (
                <button type="button" className="call-dock__secondary" onClick={onSecondary}>
                  {secondaryLabel}
                </button>
              ) : null}
              {dismissLabel && onDismiss ? (
                <button type="button" className="call-dock__dismiss" onClick={onDismiss}>
                  {dismissLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {extra.length > 0 ? (
        <div className="call-dock-behind" aria-label="Other calls waiting">
          <span className="call-dock__stack-hint">
            {behind.length === 1 ? 'Next call waiting' : `${behind.length} more calls waiting`} · click one to open it
          </span>
          {extra.map((card) => (
            <button
              key={card.key}
              type="button"
              className={`call-dock-peek call-dock-peek--${card.tone}`}
              title={`Show ${card.who}`}
              onClick={() => onSelectBehind?.(card.key)}
            >
              <span className="call-dock-peek__label">{card.label}</span>
              <span className="call-dock-peek__who">{card.who}</span>
            </button>
          ))}
          {hiddenBehind > 0 ? (
            <span className="call-dock__stack-hint">
              + {hiddenBehind} more — they move up as you file these
            </span>
          ) : null}
        </div>
      ) : null}
      {stackNote ? <p className="call-dock__stack-hint">{stackNote}</p> : null}
    </div>,
    document.body,
  );
}
