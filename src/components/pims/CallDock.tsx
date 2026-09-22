import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, Phone, X } from 'lucide-react';
import './CallDock.css';

const POSITION_KEY = 'vayd-call-dock-position';
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

/** Centred horizontally, high enough to read without covering the page header. */
function defaultPosition(): Point {
  return clampToViewport({
    x: Math.round((window.innerWidth - DOCK_WIDTH) / 2),
    y: Math.round(window.innerHeight * 0.18),
  });
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
  onSelectBehind?: (key: string) => void;
};

/**
 * The call, as a thing you cannot miss.
 *
 * Floats over the page rather than sitting in the chart flow, because the call outlives any
 * one screen. Intentionally not a modal — no backdrop, nothing trapped — so the page
 * underneath stays scrollable and clickable. Drag it anywhere; the spot is remembered.
 * Extra calls stack behind it like post-its; click one to bring it forward.
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
  onSelectBehind,
}: Props) {
  const [pos, setPos] = useState<Point>(() =>
    typeof window === 'undefined' ? { x: 0, y: 0 } : (readStoredPosition() ?? defaultPosition()),
  );
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
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
    const onResize = () => setPos((p) => clampToViewport(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (typeof document === 'undefined') return null;

  const extra = behind.slice(0, 4);
  const stackDepth = extra.length;

  return createPortal(
    <div
      className={`call-dock-bunch${stackDepth > 0 ? ' call-dock-bunch--stacked' : ''}`}
      style={{ left: pos.x, top: pos.y }}
    >
      {extra.map((card, i) => {
        // Stick out past the front card so the stack reads as a bunch of post-its.
        const step = i + 1;
        return (
          <button
            key={card.key}
            type="button"
            className={`call-dock-peek call-dock-peek--${card.tone}`}
            style={{
              transform: `translate(${14 + step * 12}px, ${14 + step * 14}px) rotate(${step * 1.4}deg)`,
              zIndex: stackDepth - i,
            }}
            title={`Show ${card.who}`}
            onClick={() => onSelectBehind?.(card.key)}
          >
            <span className="call-dock-peek__label">{card.label}</span>
            <span className="call-dock-peek__who">{card.who}</span>
          </button>
        );
      })}

      <div
        className={`call-dock${tone === 'ready' ? ' call-dock--ready' : ''}${
          tone === 'muted' ? ' call-dock--muted' : ''
        }`}
        style={{ zIndex: stackDepth + 1 }}
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
            {stackDepth > 0 ? ` · ${stackDepth + 1}` : ''}
          </span>
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
          {stackDepth > 0 ? (
            <p className="call-dock__stack-hint">
              {stackDepth === 1
                ? '1 more call behind this one — click the peek to switch.'
                : `${stackDepth} more calls behind this one — click a peek to switch.`}
            </p>
          ) : null}

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
    </div>,
    document.body,
  );
}
