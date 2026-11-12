import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { User } from 'lucide-react';
import { clientHref, patientHref } from '../../utils/recentRecordsStore';
import './SoapHeaderRecords.css';

// Loaded on first open, so the SOAP page itself stays fast.
const PimsPatientDetailView = lazy(() => import('../pims/PimsPatientDetailView'));
const PimsClientDetailView = lazy(() => import('../pims/PimsClientDetailView'));

export type SoapRecordRef = { kind: 'patient' | 'client'; id: string; name: string };

/** Plain left-clicks open the pop-up; Cmd/Ctrl/Shift/middle clicks keep the browser's new-tab behaviour. */
function plainClick(e: MouseEvent): boolean {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

/**
 * The pet's chart or the client's record in a large pop-up over the SOAP (owner request Nov 4,
 * 2026). The SOAP stays mounted underneath. Esc or Close closes it; links that would leave the
 * page open in a new tab (embedded mode), and a client's pet links open that pet here.
 */
export function SoapRecordModal({
  record,
  onClose,
  hint = 'Your SOAP stays open underneath. Links that leave this record open in a new tab ↗',
}: {
  record: SoapRecordRef;
  onClose: () => void;
  /** Line under the title (the page behind it differs by caller). */
  hint?: string;
}) {
  const [stack, setStack] = useState<SoapRecordRef[]>([record]);
  const shown = stack[stack.length - 1];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    document.body.classList.add('soap-record-modal-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Esc inside one of the chart's own pop-ups closes that one, not the whole record.
      const target = e.target instanceof Element ? e.target : null;
      const inOurs =
        !target ||
        target === document.body ||
        target.closest('[role="dialog"]') === dialogRef.current;
      if (!inOurs) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('soap-record-modal-open');
    };
  }, []);

  const title = shown.kind === 'patient' ? `${shown.name} — medical record` : `${shown.name} — client record`;
  const fullHref = shown.kind === 'patient' ? patientHref(shown.id) : clientHref(shown.id);

  return createPortal(
    <div className="soap-record-modal" data-testid="soap-record-modal">
      <div className="soap-record-modal__backdrop" aria-hidden onClick={onClose} />
      <div
        ref={dialogRef}
        className="soap-record-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soap-record-modal-title"
      >
        <div className="soap-record-modal__bar">
          {stack.length > 1 ? (
            <button
              type="button"
              className="soap-record-modal__back"
              onClick={() => setStack((s) => s.slice(0, -1))}
            >
              ← Back to {stack[stack.length - 2].name}
            </button>
          ) : null}
          <h2 id="soap-record-modal-title" className="soap-record-modal__title">
            {title}
          </h2>
          <span className="soap-record-modal__hint">{hint}</span>
          <a
            className="soap-record-modal__full"
            href={fullHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open full page in new tab ↗
          </a>
          <button
            ref={closeRef}
            type="button"
            className="soap-record-modal__close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="soap-record-modal__body">
          <Suspense fallback={<div className="soap-record-modal__loading">Loading…</div>}>
            {shown.kind === 'patient' ? (
              <PimsPatientDetailView
                key={`p-${shown.id}`}
                patientId={shown.id}
                onBack={onClose}
                embedded
              />
            ) : (
              <PimsClientDetailView
                key={`c-${shown.id}`}
                clientId={shown.id}
                onBack={onClose}
                embedded
                onOpenPatient={(pid, petName) =>
                  setStack((s) => [...s, { kind: 'patient', id: pid, name: petName || `Pet #${pid}` }])
                }
              />
            )}
          </Suspense>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Props = {
  /** The pet whose tab is active (the SOAP's current pet). */
  patientId: number | string;
  patientName: string;
  clientId: number | string | null;
  clientName: string;
  /** Rendered between the pet name and the client (the membership badge). */
  between?: ReactNode;
  /** Called after a record pop-up closes, so the SOAP can reload what may have changed there. */
  onRecordClosed?: () => void;
};

/**
 * SOAP header "Biscuit · View details · 👤 Ana Rivera": the pet name and View details open the
 * active pet's chart in a pop-up; the client name opens the client record in a pop-up.
 */
export default function SoapHeaderRecords({
  patientId,
  patientName,
  clientId,
  clientName,
  between,
  onRecordClosed,
}: Props) {
  const [open, setOpen] = useState<SoapRecordRef | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const petLabel = patientName || `Patient #${patientId}`;
  const client = clientName.trim();

  const openRecord = (e: MouseEvent<HTMLElement>, rec: SoapRecordRef, viaLink: boolean) => {
    if (viaLink && !plainClick(e)) return;
    e.preventDefault();
    openerRef.current = e.currentTarget;
    setOpen(rec);
  };

  const close = useCallback(() => {
    setOpen(null);
    const opener = openerRef.current;
    if (opener && opener.isConnected) window.setTimeout(() => opener.focus(), 0);
    onRecordClosed?.();
  }, [onRecordClosed]);

  const petRec: SoapRecordRef = { kind: 'patient', id: String(patientId), name: petLabel };

  return (
    <>
      <a
        className="soap-header-patient-link"
        href={patientHref(patientId)}
        title="Open the medical record in a pop-up (the SOAP stays open)"
        aria-haspopup="dialog"
        onClick={(e) => openRecord(e, petRec, true)}
      >
        {petLabel}
      </a>
      <button
        type="button"
        className="soap-header-view-details"
        aria-haspopup="dialog"
        aria-label={`View details for ${petLabel}`}
        onClick={(e) => openRecord(e, petRec, false)}
      >
        View details
      </button>
      {between}
      {client ? (
        <>
          <span className="soap-header-client-sep" aria-hidden>
            ·
          </span>
          {clientId != null && String(clientId) !== '' ? (
            <a
              className="soap-header-client"
              href={clientHref(clientId)}
              title="Open the client record in a pop-up (the SOAP stays open)"
              aria-haspopup="dialog"
              onClick={(e) =>
                openRecord(e, { kind: 'client', id: String(clientId), name: client }, true)
              }
            >
              <User size={14} aria-hidden />
              {client}
            </a>
          ) : (
            <span className="soap-header-client">
              <User size={14} aria-hidden />
              {client}
            </span>
          )}
        </>
      ) : null}
      {open ? <SoapRecordModal key={`${open.kind}-${open.id}`} record={open} onClose={close} /> : null}
    </>
  );
}
