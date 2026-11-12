import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './DateWheelPicker.css';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const ITEM_H = 36;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseIso(value: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

type WheelProps<T extends string | number> = {
  items: T[];
  value: T;
  label: (item: T) => string;
  onChange: (item: T) => void;
  ariaLabel: string;
};

/** Rows visible above and below the selected one. */
const VISIBLE_EACH_SIDE = 2;

/**
 * Drag-driven wheel. Does not use a scroll container: Safari will not touch-scroll a
 * list under a mask/fade layer, and momentum makes snapping unreliable. We move the
 * list with a transform from pointer events instead — works with finger, mouse, and
 * scroll wheel on every browser.
 */
function Wheel<T extends string | number>({ items, value, label, onChange, ariaLabel }: WheelProps<T>) {
  const index = Math.max(0, items.indexOf(value));
  const maxIndex = items.length - 1;

  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startIndex: number;
    moved: boolean;
    samples: { t: number; y: number }[];
  } | null>(null);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<number | null>(null);

  const clamp = (i: number) => Math.min(maxIndex, Math.max(0, i));

  // Position of the list so that `index` sits in the highlight row.
  const restingY = -index * ITEM_H;
  const translateY = dragOffset != null ? dragOffset : restingY;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startIndex: index,
      moved: false,
      samples: [{ t: performance.now(), y: e.clientY }],
    };
    setDragOffset(restingY);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const delta = e.clientY - d.startY;
    if (Math.abs(delta) > 4) d.moved = true;
    d.samples.push({ t: performance.now(), y: e.clientY });
    if (d.samples.length > 6) d.samples.shift();
    let next = -d.startIndex * ITEM_H + delta;
    // Rubber-band past the ends.
    const minY = -maxIndex * ITEM_H;
    if (next > 0) next = next * 0.35;
    else if (next < minY) next = minY + (next - minY) * 0.35;
    setDragOffset(next);
  }

  function finishDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const delta = e.clientY - d.startY;
    if (!d.moved) {
      // Tap: pick the row under the finger.
      const rect = e.currentTarget.getBoundingClientRect();
      const row = Math.floor((e.clientY - rect.top) / ITEM_H) - VISIBLE_EACH_SIDE;
      const target = clamp(d.startIndex + row);
      setDragOffset(null);
      if (items[target] !== value) onChange(items[target]);
      return;
    }
    // Flick: carry the motion a little further based on release velocity.
    let velocity = 0;
    if (d.samples.length >= 2) {
      const a = d.samples[0];
      const b = d.samples[d.samples.length - 1];
      const dt = Math.max(1, b.t - a.t);
      velocity = (b.y - a.y) / dt; // px per ms
    }
    const projected = -d.startIndex * ITEM_H + delta + velocity * 120;
    const target = clamp(Math.round(-projected / ITEM_H));
    setDragOffset(null);
    if (items[target] !== value) onChange(items[target]);
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    wheelAccum.current += e.deltaY;
    if (wheelTimer.current != null) return;
    wheelTimer.current = window.setTimeout(() => {
      wheelTimer.current = null;
      const steps = Math.round(wheelAccum.current / 40);
      wheelAccum.current = 0;
      if (steps === 0) return;
      const target = clamp(index + steps);
      if (items[target] !== value) onChange(items[target]);
    }, 60);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let target: number | null = null;
    if (e.key === 'ArrowUp') target = clamp(index - 1);
    else if (e.key === 'ArrowDown') target = clamp(index + 1);
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = maxIndex;
    if (target == null) return;
    e.preventDefault();
    if (items[target] !== value) onChange(items[target]);
  }

  return (
    <div
      className={`date-wheel__col${dragOffset != null ? ' is-dragging' : ''}`}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={`${ariaLabel}-${String(value)}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      <div
        className="date-wheel__track"
        style={{ transform: `translateY(${VISIBLE_EACH_SIDE * ITEM_H + translateY}px)` }}
      >
        {items.map((item) => (
          <div
            key={String(item)}
            id={`${ariaLabel}-${String(item)}`}
            role="option"
            aria-selected={item === value}
            className={`date-wheel__item${item === value ? ' is-on' : ''}`}
          >
            {label(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

export type DateWheelPickerProps = {
  /** ISO YYYY-MM-DD or empty. */
  value: string | null | undefined;
  onChange: (iso: string) => void;
  onClose: () => void;
  onClear?: () => void;
  /** Inclusive year range shown on the year wheel. */
  minYear?: number;
  maxYear?: number;
  title?: string;
};

export default function DateWheelPicker({
  value,
  onChange,
  onClose,
  onClear,
  minYear,
  maxYear,
  title = 'Pick a date',
}: DateWheelPickerProps) {
  const today = new Date();
  const parsed = parseIso(value);
  const yMin = minYear ?? today.getFullYear() - 2;
  const yMax = maxYear ?? today.getFullYear() + 15;

  const [y, setY] = useState(parsed?.y ?? today.getFullYear());
  const [m, setM] = useState(parsed?.m ?? today.getMonth() + 1);
  const [d, setD] = useState(parsed?.d ?? today.getDate());

  const years = useMemo(() => {
    const lo = Math.min(yMin, y);
    const hi = Math.max(yMax, y);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [yMin, yMax, y]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const days = useMemo(
    () => Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1),
    [y, m]
  );

  // Follow typed changes from the field while open.
  useEffect(() => {
    if (!parsed) return;
    setY(parsed.y);
    setM(parsed.m);
    setD(parsed.d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(ny: number, nm: number, nd: number) {
    const maxD = daysInMonth(ny, nm);
    const day = Math.min(nd, maxD);
    setY(ny);
    setM(nm);
    setD(day);
    onChange(`${ny}-${pad(nm)}-${pad(day)}`);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const sheet = (
    <div className="date-wheel" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
      <div className="date-wheel__head">
        <span className="date-wheel__title">{title}</span>
        <span className="date-wheel__preview">
          {MONTH_NAMES[m - 1]} {d}, {y}
        </span>
      </div>
      <div className="date-wheel__labels" aria-hidden>
        <span>Month</span>
        <span>Day</span>
        <span>Year</span>
      </div>
      <div className="date-wheel__cols">
        <div className="date-wheel__highlight" aria-hidden />
        <Wheel
          items={months}
          value={m}
          label={(mm) => MONTH_NAMES[mm - 1]}
          onChange={(mm) => commit(y, mm, d)}
          ariaLabel="Month"
        />
        <Wheel
          items={days}
          value={Math.min(d, days.length)}
          label={(dd) => String(dd)}
          onChange={(dd) => commit(y, m, dd)}
          ariaLabel="Day"
        />
        <Wheel
          items={years}
          value={y}
          label={(yy) => String(yy)}
          onChange={(yy) => commit(yy, m, d)}
          ariaLabel="Year"
        />
      </div>
      <div className="date-wheel__foot">
        {onClear ? (
          <button
            type="button"
            className="date-wheel__btn date-wheel__btn--ghost"
            onClick={() => {
              onClear();
              onClose();
            }}
          >
            Clear
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="date-wheel__btn date-wheel__btn--primary"
          onClick={() => {
            if (!parsed) commit(y, m, d);
            onClose();
          }}
        >
          Done
        </button>
      </div>
    </div>
  );

  return createPortal(
    <div className="date-wheel-layer">
      <div className="date-wheel-backdrop" onClick={onClose} />
      <div className="date-wheel-anchor">{sheet}</div>
    </div>,
    document.body
  );
}
