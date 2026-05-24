// Right-click appointment menu on practice scheduler calendar
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Appointment, Client } from '../api/roomLoader';
import './Scheduler.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export type SchedulerContextMenuAction =
  | { kind: 'addPet' }
  | { kind: 'reschedule' }
  | { kind: 'view' }
  | { kind: 'edit' }
  | { kind: 'visitTimes' }
  | { kind: 'complete' }
  | { kind: 'addCharges' }
  | { kind: 'remove' }
  | { kind: 'viewChart' }
  | { kind: 'writeMedicalNote' }
  | { kind: 'call'; phone: 'phone1' | 'phone2' }
  | { kind: 'text'; phone: 'phone1' | 'phone2' }
  | { kind: 'viewClientInfo' }
  | { kind: 'roomLoader' }
  | { kind: 'checkout' };

type OpenGroup = 'scheduling' | 'visit' | 'patient' | 'client';

type Props = {
  appt: Appointment;
  client: Client | undefined;
  anchorPoint: { x: number; y: number };
  onClose: () => void;
  onAction: (action: SchedulerContextMenuAction) => void;
  showAddPet?: boolean;
  addPetDisabled?: boolean;
  addPetTitle?: string;
  rescheduleDisabled?: boolean;
  rescheduleDisabledTitle?: string;
  removeDisabled?: boolean;
  removeTitle?: string;
  roomLoaderMenuLabel: string;
  /** Admins/superadmins only — shows "Edit Appointment" under Scheduling */
  showEditAppointment?: boolean;
  visitTimesDisabled?: boolean;
  visitTimesDisabledTitle?: string;
  completeDisabled?: boolean;
  completeDisabledTitle?: string;
};

export function SchedulerAppointmentContextMenu({
  appt,
  client,
  anchorPoint,
  onClose,
  onAction,
  showAddPet,
  addPetDisabled,
  addPetTitle,
  rescheduleDisabled,
  rescheduleDisabledTitle,
  removeDisabled,
  removeTitle,
  roomLoaderMenuLabel,
  showEditAppointment,
  visitTimesDisabled,
  visitTimesDisabledTitle,
  completeDisabled: completeDisabledProp,
  completeDisabledTitle: completeDisabledTitleProp,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const [openGroup, setOpenGroup] = useState<OpenGroup | null>(null);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = anchorPoint.x;
    let top = anchorPoint.y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPlaced({ left, top });
  }, [anchorPoint.x, anchorPoint.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest('.scheduler-ctx-flyout')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);

  const phone1 = pickStr(client?.phone1);
  const phone2 = pickStr(client?.phone2);

  const completeDisabled = completeDisabledProp ?? appt.isComplete;
  const completeTitle =
    completeDisabledTitleProp ??
    (appt.isComplete ? 'This visit is already complete.' : undefined);

  const closeScheduling = () => setOpenGroup(null);

  const menu = (
    <div
      ref={rootRef}
      className="scheduler-ctx-menu scheduler-ctx-menu--grouped"
      role="menu"
      style={placed ? { left: placed.left, top: placed.top } : { left: -9999, top: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CtxParentRow
        label="Scheduling"
        menuRootRef={rootRef}
        open={openGroup === 'scheduling'}
        onOpen={() => setOpenGroup('scheduling')}
        onCloseSub={closeScheduling}
      >
        {showAddPet ? (
          <CtxSubRow
            label="Add Pet"
            disabled={addPetDisabled}
            onPick={() => onAction({ kind: 'addPet' })}
            title={addPetTitle}
          />
        ) : null}
        <CtxSubRow
          label="Reschedule"
          disabled={Boolean(rescheduleDisabled)}
          title={rescheduleDisabled ? rescheduleDisabledTitle : undefined}
          onPick={() => onAction({ kind: 'reschedule' })}
        />
        <CtxSubRow label="View appointment" onPick={() => onAction({ kind: 'view' })} />
        {showEditAppointment ? (
          <CtxSubRow label="Edit Appointment" onPick={() => onAction({ kind: 'edit' })} />
        ) : null}
        <CtxSubRow
          label="Remove"
          disabled={Boolean(removeDisabled)}
          title={removeDisabled ? removeTitle : undefined}
          onPick={() => onAction({ kind: 'remove' })}
        />
      </CtxParentRow>

      <CtxParentRow
        label="On Visit Day"
        menuRootRef={rootRef}
        open={openGroup === 'visit'}
        onOpen={() => setOpenGroup('visit')}
        onCloseSub={() => setOpenGroup(null)}
      >
        <CtxSubRow
          label="Start / End Visit"
          disabled={Boolean(visitTimesDisabled)}
          title={visitTimesDisabled ? visitTimesDisabledTitle : undefined}
          onPick={() => onAction({ kind: 'visitTimes' })}
        />
        <CtxSubRow
          label="Complete"
          disabled={completeDisabled}
          title={completeTitle}
          onPick={() => onAction({ kind: 'complete' })}
        />
        <CtxSubRow label="Add Charges" onPick={() => onAction({ kind: 'addCharges' })} />
      </CtxParentRow>

      <CtxParentRow
        label="Patient"
        menuRootRef={rootRef}
        open={openGroup === 'patient'}
        onOpen={() => setOpenGroup('patient')}
        onCloseSub={() => setOpenGroup(null)}
      >
        <CtxSubRow label="View Chart" onPick={() => onAction({ kind: 'viewChart' })} />
        <CtxSubRow label="Write Medical Note" onPick={() => onAction({ kind: 'writeMedicalNote' })} />
      </CtxParentRow>

      <CtxParentRow
        label="Client"
        menuRootRef={rootRef}
        open={openGroup === 'client'}
        onOpen={() => setOpenGroup('client')}
        onCloseSub={() => setOpenGroup(null)}
      >
        <CtxSubRow
          label={phone1 ? `Call ${phone1}` : 'Call (no number)'}
          disabled={!phone1}
          onPick={() => phone1 && onAction({ kind: 'call', phone: 'phone1' })}
        />
        {phone2 ? (
          <CtxSubRow label={`Call ${phone2}`} onPick={() => onAction({ kind: 'call', phone: 'phone2' })} />
        ) : null}
        <CtxSubRow
          label={phone1 ? `Text ${phone1}` : 'Text (no number)'}
          disabled={!phone1}
          onPick={() => phone1 && onAction({ kind: 'text', phone: 'phone1' })}
        />
        {phone2 ? (
          <CtxSubRow label={`Text ${phone2}`} onPick={() => onAction({ kind: 'text', phone: 'phone2' })} />
        ) : null}
        <CtxSubRow label="View Client Info" onPick={() => onAction({ kind: 'viewClientInfo' })} />
        <CtxSubRow label={roomLoaderMenuLabel} onPick={() => onAction({ kind: 'roomLoader' })} />
        <CtxSubRow label="Checkout" onPick={() => onAction({ kind: 'checkout' })} />
      </CtxParentRow>
    </div>
  );

  return createPortal(menu, document.body);
}

function CtxSubRow({
  label,
  onPick,
  disabled,
  title,
}: {
  label: string;
  onPick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="scheduler-ctx-subitem"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={() => {
        if (!disabled) onPick();
      }}
    >
      {label}
    </button>
  );
}

type CtxFlyoutPlacement = {
  side: 'left' | 'right';
  left: number;
  top: number;
  maxHeight: number;
};

const CTX_FLYOUT_PAD = 8;
const CTX_FLYOUT_GAP = 2;
/** Slight overlap with the parent row so the pointer can reach the portaled flyout without a dead zone. */
const CTX_FLYOUT_OVERLAP = 14;
const CTX_FLYOUT_CLOSE_MS = 280;
const CTX_FLYOUT_Z = 10051;
const CTX_FLYOUT_EST_WIDTH = 240;

function ctxFlyoutPlacementEqual(a: CtxFlyoutPlacement, b: CtxFlyoutPlacement): boolean {
  return (
    a.side === b.side &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.maxHeight - b.maxHeight) < 1
  );
}

function isNodeInMenuOrFlyout(node: Node | null, menuRoot: HTMLElement | null): boolean {
  if (!node) return false;
  if (menuRoot?.contains(node)) return true;
  return node instanceof Element && Boolean(node.closest('.scheduler-ctx-flyout'));
}

function horizontalFlyoutLeft(
  side: 'left' | 'right',
  wrapRect: DOMRect,
  flyW: number,
  vpW: number
): { side: 'left' | 'right'; left: number } {
  let resolvedSide = side;
  let left =
    resolvedSide === 'right'
      ? wrapRect.right - CTX_FLYOUT_OVERLAP
      : wrapRect.left - flyW + CTX_FLYOUT_OVERLAP;

  if (resolvedSide === 'right' && left + flyW > vpW - CTX_FLYOUT_PAD) {
    resolvedSide = 'left';
    left = wrapRect.left - flyW + CTX_FLYOUT_OVERLAP;
  }
  if (resolvedSide === 'left' && left < CTX_FLYOUT_PAD) {
    resolvedSide = 'right';
    left = wrapRect.right - CTX_FLYOUT_OVERLAP;
  }

  left = Math.min(Math.max(left, CTX_FLYOUT_PAD), vpW - CTX_FLYOUT_PAD - flyW);
  return { side: resolvedSide, left };
}

function verticalFlyoutTop(wrapRect: DOMRect, flyH: number, vpH: number): number {
  let top = wrapRect.top;
  if (top + flyH > vpH - CTX_FLYOUT_PAD) {
    top = wrapRect.bottom - flyH;
  }
  if (top + flyH > vpH - CTX_FLYOUT_PAD) {
    top = vpH - CTX_FLYOUT_PAD - flyH;
  }
  return Math.max(CTX_FLYOUT_PAD, top);
}

/** Estimate position before the flyout has been measured (avoids visibility:hidden flash). */
function estimateCtxFlyoutPlacement(
  wrapEl: HTMLElement,
  opts: { nested?: boolean }
): CtxFlyoutPlacement {
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const wrapRect = wrapEl.getBoundingClientRect();
  const flyW = CTX_FLYOUT_EST_WIDTH;
  const flyH = 120;
  const parentFlyout = opts.nested ? wrapEl.closest('.scheduler-ctx-flyout') : null;
  const parentFlyoutOpensLeft = parentFlyout
    ? parentFlyout.getBoundingClientRect().right <= wrapRect.left + 2
    : false;

  const { side, left } = horizontalFlyoutLeft(
    parentFlyoutOpensLeft ? 'left' : 'right',
    wrapRect,
    flyW,
    vpW
  );
  const top = verticalFlyoutTop(wrapRect, flyH, vpH);
  return { side, left, top, maxHeight: Math.max(120, vpH - top - CTX_FLYOUT_PAD) };
}

/** Viewport-fixed submenu position so flyouts are not clipped by the root menu box. */
function measureCtxFlyoutPlacement(
  wrapEl: HTMLElement,
  flyoutEl: HTMLElement,
  opts: { nested?: boolean }
): CtxFlyoutPlacement {
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const wrapRect = wrapEl.getBoundingClientRect();
  const flyW = flyoutEl.offsetWidth || CTX_FLYOUT_EST_WIDTH;
  const flyH = flyoutEl.offsetHeight || 120;
  const parentFlyout = opts.nested ? wrapEl.closest('.scheduler-ctx-flyout') : null;
  const parentFlyoutOpensLeft = parentFlyout
    ? parentFlyout.getBoundingClientRect().right <= wrapRect.left + 2
    : false;

  const { side, left } = horizontalFlyoutLeft(
    parentFlyoutOpensLeft ? 'left' : 'right',
    wrapRect,
    flyW,
    vpW
  );
  const top = verticalFlyoutTop(wrapRect, flyH, vpH);
  const maxHeight = Math.max(120, vpH - top - CTX_FLYOUT_PAD);

  return { side, left, top, maxHeight };
}

function CtxParentRow({
  label,
  children,
  open,
  onOpen,
  onCloseSub,
  nested,
  menuRootRef,
}: {
  label: string;
  children: ReactNode;
  open: boolean;
  onOpen: () => void;
  onCloseSub: () => void;
  /** Nested parent row inside a flyout (e.g. View/Edit under Scheduling). */
  nested?: boolean;
  menuRootRef: React.RefObject<HTMLElement | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [placement, setPlacement] = useState<CtxFlyoutPlacement | null>(null);

  const cancelCloseTimer = () => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const isHoverTargetActive = (node: Node | null): boolean => {
    if (isNodeInMenuOrFlyout(node, menuRootRef.current)) return true;
    if (flyoutRef.current && node && flyoutRef.current.contains(node)) return true;
    return false;
  };

  const scheduleClose = (e?: ReactMouseEvent) => {
    const related = (e?.relatedTarget instanceof Node ? e.relatedTarget : null) as Node | null;
    if (isHoverTargetActive(related)) return;

    const { x, y } = pointerRef.current;
    if (isHoverTargetActive(document.elementFromPoint(x, y))) return;

    cancelCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      if (isHoverTargetActive(document.elementFromPoint(x, y))) return;
      onCloseSub();
    }, CTX_FLYOUT_CLOSE_MS);
  };

  useEffect(() => {
    if (open) cancelCloseTimer();
    return () => cancelCloseTimer();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    if (wrapRef.current) {
      const estimate = estimateCtxFlyoutPlacement(wrapRef.current, { nested });
      setPlacement((prev) => (prev && ctxFlyoutPlacementEqual(prev, estimate) ? prev : estimate));
    }
  }, [open, nested]);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;

    const remeasure = () => {
      if (!wrapRef.current || !flyoutRef.current) return;
      const next = measureCtxFlyoutPlacement(wrapRef.current, flyoutRef.current, { nested });
      setPlacement((prev) => (prev && ctxFlyoutPlacementEqual(prev, next) ? prev : next));
    };

    remeasure();
    if (!flyoutRef.current) {
      requestAnimationFrame(remeasure);
    }
    window.addEventListener('resize', remeasure);
    return () => window.removeEventListener('resize', remeasure);
  }, [open, nested]);

  return (
    <div
      ref={wrapRef}
      className={`scheduler-ctx-parent-wrap${open ? ' scheduler-ctx-parent-wrap--open' : ''}${nested ? ' scheduler-ctx-parent-wrap--nested' : ''}`}
      onMouseEnter={(e) => {
        pointerRef.current = { x: e.clientX, y: e.clientY };
        cancelCloseTimer();
        onOpen();
      }}
      onMouseMove={(e) => {
        pointerRef.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseLeave={(e) => scheduleClose(e)}
    >
      <div
        className={
          nested
            ? 'scheduler-ctx-subitem scheduler-ctx-subitem--parent'
            : 'scheduler-ctx-item scheduler-ctx-item--parent'
        }
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {!nested ? <span className="scheduler-ctx-chevron" aria-hidden /> : null}
        <span className="scheduler-ctx-parent-label">{label}</span>
        <span className="scheduler-ctx-arrow" aria-hidden>
          {open && placement?.side === 'left' ? '‹' : '›'}
        </span>
      </div>
      {open && placement
        ? createPortal(
            <div
              ref={flyoutRef}
              className={`scheduler-ctx-flyout scheduler-ctx-flyout--${placement.side}`}
              role="menu"
              style={{
                position: 'fixed',
                left: placement.left,
                top: placement.top,
                maxHeight: placement.maxHeight,
                zIndex: CTX_FLYOUT_Z,
              }}
              onMouseEnter={(e) => {
                pointerRef.current = { x: e.clientX, y: e.clientY };
                cancelCloseTimer();
              }}
              onMouseMove={(e) => {
                pointerRef.current = { x: e.clientX, y: e.clientY };
              }}
              onMouseLeave={(e) => scheduleClose(e)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
