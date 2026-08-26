import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Appointment } from '../api/roomLoader';
import { NotBookedRemoveVisitGateModal } from './NotBookedRemoveVisitGateModal';

type HighlightRect = {
  id: number;
  top: number;
  left: number;
  width: number;
  height: number;
};

function measureHighlightRects(appointmentIds: readonly number[]): HighlightRect[] {
  const out: HighlightRect[] = [];
  for (const id of appointmentIds) {
    const el = document.querySelector(`[data-appt-id="${CSS.escape(String(id))}"]`);
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    out.push({
      id,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }
  return out;
}

function dialogStyleForVisit(anchorId: number): CSSProperties {
  const el = document.querySelector(`[data-appt-id="${CSS.escape(String(anchorId))}"]`);
  const gap = 16;
  const modalMaxH = 340;
  const width = 'min(480px, calc(100vw - 32px))';
  const base: CSSProperties = {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    width,
    maxWidth: 480,
    zIndex: 1,
    pointerEvents: 'auto',
  };

  if (!(el instanceof HTMLElement)) {
    return { ...base, bottom: gap, top: 'auto' };
  }

  const rect = el.getBoundingClientRect();
  const roomBelow = window.innerHeight - rect.bottom - gap;
  if (roomBelow >= modalMaxH) {
    return {
      ...base,
      top: Math.min(rect.bottom + gap, window.innerHeight - modalMaxH - gap),
      bottom: 'auto',
    };
  }
  const roomAbove = rect.top - gap;
  if (roomAbove >= modalMaxH) {
    return {
      ...base,
      bottom: window.innerHeight - rect.top + gap,
      top: 'auto',
    };
  }
  return { ...base, bottom: gap, top: 'auto' };
}

type Props = {
  appt: Appointment;
  practiceTz: string;
  clientLabel?: string | null;
  appointmentIds: readonly number[];
  showDialog?: boolean;
  onBack: () => void;
  onRemove: () => void;
};

/** Portaled gate UI: highlight ring above dialog, dialog placed away from the visit when possible. */
export function NotBookedRemoveGateOverlay({
  appt,
  practiceTz,
  clientLabel,
  appointmentIds,
  showDialog = true,
  onBack,
  onRemove,
}: Props) {
  const anchorId = appointmentIds[0] ?? Number(appt.id);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [dialogStyle, setDialogStyle] = useState<CSSProperties>(() =>
    Number.isFinite(anchorId) ? dialogStyleForVisit(anchorId) : { bottom: 16 },
  );

  useLayoutEffect(() => {
    const ids = appointmentIds.filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) {
      setHighlightRects([]);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 240;

    const update = () => {
      if (cancelled) return;
      const next = measureHighlightRects(ids);
      if (next.length > 0) {
        setHighlightRects(next);
        if (Number.isFinite(anchorId)) {
          setDialogStyle(dialogStyleForVisit(anchorId));
        }
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(update, 33);
      }
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const intervalId = window.setInterval(update, 400);

    return () => {
      cancelled = true;
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      window.clearInterval(intervalId);
    };
  }, [appointmentIds, anchorId]);

  return createPortal(
    <div className="scheduler-not-booked-gate-layer">
      {showDialog ? (
        <NotBookedRemoveVisitGateModal
          appt={appt}
          practiceTz={practiceTz}
          clientLabel={clientLabel}
          dialogStyle={dialogStyle}
          onBack={onBack}
          onRemove={onRemove}
        />
      ) : null}
      {highlightRects.map((rect) => (
        <div
          key={rect.id}
          className="scheduler-not-booked-gate-highlight-ring"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
          aria-hidden
        />
      ))}
    </div>,
    document.body,
  );
}
