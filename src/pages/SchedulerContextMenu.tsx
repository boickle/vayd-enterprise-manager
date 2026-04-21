// Right-click appointment menu on practice scheduler calendar
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Appointment, Client } from '../api/roomLoader';
import './Scheduler.css';

const STATUS_PRESETS = [
  'None',
  'NEW Records Received and Uploaded',
  'Records Not Needed',
  'Records Requested',
] as const;

const CONFIRM_PRESETS = [
  'None',
  'Euth Form Completed by Client',
  'Euth Form Sent',
  'Pre-Appt Email Sent 2x',
  'Client Submitted Pre-Appt form',
  'Pre-Appt Email Sent',
  'Canceled Appointment',
] as const;

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export type SchedulerContextMenuAction =
  | { kind: 'view' }
  | { kind: 'edit' }
  | { kind: 'complete' }
  | { kind: 'remove' }
  | { kind: 'setStatus'; value: string | null }
  | { kind: 'setConfirm'; value: string | null }
  | { kind: 'googleMaps' }
  | { kind: 'sendForm' }
  | { kind: 'enterWeight' }
  | { kind: 'goMr' }
  | { kind: 'goClient' }
  | { kind: 'quickInvoice' }
  | { kind: 'checkout' }
  | { kind: 'contact'; channel: 'phone1' | 'phone2' | 'email1' | 'email2' };

type Props = {
  appt: Appointment;
  client: Client | undefined;
  anchorPoint: { x: number; y: number };
  onClose: () => void;
  onAction: (action: SchedulerContextMenuAction) => void;
};

export function SchedulerAppointmentContextMenu({ appt, client, anchorPoint, onClose, onAction }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const [openSub, setOpenSub] = useState<'status' | 'confirm' | 'contact' | null>(null);

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
      if (rootRef.current && !rootRef.current.contains(t)) onClose();
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
  const email1 = pickStr(client?.email);
  const email2 = pickStr(client?.secondEmail);

  const menu = (
    <div
      ref={rootRef}
      className="scheduler-ctx-menu"
      role="menu"
      style={placed ? { left: placed.left, top: placed.top } : { left: -9999, top: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <CtxRow label="View" onPick={() => onAction({ kind: 'view' })} />
      <CtxRow label="Edit" onPick={() => onAction({ kind: 'edit' })} />
      <CtxRow label="Complete" onPick={() => onAction({ kind: 'complete' })} />
      <CtxRow label="Remove" onPick={() => onAction({ kind: 'remove' })} />
      <CtxParentRow
        label="Status"
        open={openSub === 'status'}
        onOpen={() => setOpenSub('status')}
        onCloseSub={() => setOpenSub(null)}
      >
        {STATUS_PRESETS.map((label) => (
          <CtxSubRow
            key={label}
            label={label}
            onPick={() =>
              onAction({ kind: 'setStatus', value: label === 'None' ? null : label })
            }
          />
        ))}
      </CtxParentRow>
      <CtxParentRow
        label="Confirm"
        open={openSub === 'confirm'}
        onOpen={() => setOpenSub('confirm')}
        onCloseSub={() => setOpenSub(null)}
      >
        {CONFIRM_PRESETS.map((label) => (
          <CtxSubRow
            key={label}
            label={label}
            onPick={() =>
              onAction({ kind: 'setConfirm', value: label === 'None' ? null : label })
            }
          />
        ))}
      </CtxParentRow>

      <div className="scheduler-ctx-sep" />

      <CtxRow label="Google Maps" onPick={() => onAction({ kind: 'googleMaps' })} />
      <CtxRow label="Send Form" onPick={() => onAction({ kind: 'sendForm' })} />
      <CtxRow label="Enter Weight" onPick={() => onAction({ kind: 'enterWeight' })} />
      <CtxRow label="Go To MR" onPick={() => onAction({ kind: 'goMr' })} />
      <CtxRow label="Go to Client" onPick={() => onAction({ kind: 'goClient' })} />
      <CtxRow label="Go to Quick Invoicing" onPick={() => onAction({ kind: 'quickInvoice' })} />
      <CtxRow label="Go to Checkout" onPick={() => onAction({ kind: 'checkout' })} />
      <CtxParentRow
        label="Contact Client"
        open={openSub === 'contact'}
        onOpen={() => setOpenSub('contact')}
        onCloseSub={() => setOpenSub(null)}
        noIcon
      >
        <CtxSubRow
          label={phone1 ? `Call ${phone1}` : 'Call primary (no number)'}
          disabled={!phone1}
          onPick={() => phone1 && onAction({ kind: 'contact', channel: 'phone1' })}
        />
        <CtxSubRow
          label={phone2 ? `Call ${phone2}` : 'Call secondary (no number)'}
          disabled={!phone2}
          onPick={() => phone2 && onAction({ kind: 'contact', channel: 'phone2' })}
        />
        <CtxSubRow
          label={email1 ? `Email ${email1}` : 'Email primary (none)'}
          disabled={!email1}
          onPick={() => email1 && onAction({ kind: 'contact', channel: 'email1' })}
        />
        <CtxSubRow
          label={email2 ? `Email ${email2}` : 'Email secondary (none)'}
          disabled={!email2}
          onPick={() => email2 && onAction({ kind: 'contact', channel: 'email2' })}
        />
      </CtxParentRow>
    </div>
  );

  return createPortal(menu, document.body);
}

function CtxRow({ label, onPick }: { label: string; onPick: () => void }) {
  return (
    <button type="button" className="scheduler-ctx-item" role="menuitem" onClick={onPick}>
      {label}
    </button>
  );
}

function CtxSubRow({
  label,
  onPick,
  disabled,
}: {
  label: string;
  onPick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="scheduler-ctx-subitem" role="menuitem" disabled={disabled} onClick={onPick}>
      {label}
    </button>
  );
}

function CtxParentRow({
  label,
  children,
  open,
  onOpen,
  onCloseSub,
  noIcon,
}: {
  label: string;
  children: React.ReactNode;
  open: boolean;
  onOpen: () => void;
  onCloseSub: () => void;
  noIcon?: boolean;
}) {
  return (
    <div
      className={`scheduler-ctx-parent-wrap${open ? ' scheduler-ctx-parent-wrap--open' : ''}`}
      onMouseEnter={onOpen}
      onMouseLeave={onCloseSub}
    >
      <div className="scheduler-ctx-item scheduler-ctx-item--parent" aria-haspopup="menu" aria-expanded={open}>
        {!noIcon ? <span className="scheduler-ctx-chevron" aria-hidden /> : null}
        <span className="scheduler-ctx-parent-label">{label}</span>
        <span className="scheduler-ctx-arrow" aria-hidden>
          ›
        </span>
      </div>
      {open ? (
        <div className="scheduler-ctx-flyout" onMouseDown={(e) => e.stopPropagation()}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
