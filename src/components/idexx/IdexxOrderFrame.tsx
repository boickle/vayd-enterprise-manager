import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import {
  idexxErrorMessage,
  syncIdexxOrder,
  type IdexxOrder,
  type IdexxSyncResult,
} from '../../api/idexx';
import '../../pages/Settings.css';
import './Idexx.css';

/** How often Scout asks IDEXX whether the order was submitted while the frame is open. */
const CHECK_EVERY_MS = 10_000;

type Props = {
  order: IdexxOrder;
  patientName: string;
  /** The order was just created, so its link is fresh; otherwise get a new one first. */
  fresh?: boolean;
  /** Re-reads the order from IDEXX (and charges tests added there). */
  onSync?: (orderId: number) => Promise<IdexxSyncResult>;
  onClose: () => void;
};

/**
 * VetConnect PLUS inside Scout: specimen questions, add-ons, Order and the requisition
 * print all happen in IDEXX's own page, framed here so nobody leaves the bill.
 *
 * The window closes once the order is submitted. IDEXX's page then blanks itself (it
 * posts `ui/done?orderId=…` to the page framing it and navigates to an empty page), so any
 * of those signals, or the next check seeing SUBMITTED, closes it. The requisition PDF
 * stays on the order in Scout.
 */
export default function IdexxOrderFrame({
  order: initial,
  patientName,
  fresh,
  onSync = syncIdexxOrder,
  onClose,
}: Props) {
  const [order, setOrder] = useState(initial);
  const [url, setUrl] = useState<string | null>(fresh ? initial.uiUrl : null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const syncRef = useRef(onSync);
  syncRef.current = onSync;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const closing = useRef(false);

  /** Re-read the order, then close if IDEXX has it (or `always`, for IDEXX's Done/Cancel). */
  const finish = useCallback(
    (always: boolean) => {
      if (closing.current) return;
      void syncRef
        .current(initial.id)
        .then((res) => {
          setOrder(res.order);
          return res.order.status !== 'CREATED';
        })
        .catch(() => false)
        .then((done) => {
          if ((done || always) && !closing.current) {
            closing.current = true;
            closeRef.current();
          }
        });
    },
    [initial.id]
  );

  // An older link may have expired: reading the order from IDEXX hands back a new one.
  useEffect(() => {
    if (fresh) return;
    let canceled = false;
    void syncRef
      .current(initial.id)
      .then((res) => {
        if (canceled) return;
        setOrder(res.order);
        setUrl(res.order.uiUrl ?? initial.uiUrl);
      })
      .catch((e) => {
        if (canceled) return;
        setUrl(initial.uiUrl);
        setError(idexxErrorMessage(e, 'Could not refresh the IDEXX link.'));
      });
    return () => {
      canceled = true;
    };
  }, [fresh, initial.id, initial.uiUrl]);

  const submitted = order.status === 'SUBMITTED';
  useEffect(() => {
    if (submitted && !closing.current) {
      closing.current = true;
      closeRef.current();
    }
  }, [submitted]);

  useEffect(() => {
    if (submitted || !url) return;
    const timer = window.setInterval(() => {
      void syncRef
        .current(initial.id)
        .then((res) => {
          setOrder(res.order);
          if (res.added.length) setAdded((prev) => [...new Set([...prev, ...res.added])]);
        })
        .catch(() => undefined);
    }, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [submitted, url, initial.id]);

  useEffect(() => {
    if (!url) return;
    let idexxOrigin: string;
    try {
      idexxOrigin = new URL(url).origin;
    } catch {
      return;
    }
    const onMessage = (e: MessageEvent) => {
      const fromFrame =
        e.origin === idexxOrigin ||
        (frameRef.current != null && e.source === frameRef.current.contentWindow);
      if (!fromFrame || typeof e.data !== 'string') return;
      if (e.data.startsWith('ui/done')) {
        finish(true);
      } else if (e.data.startsWith('ui/error')) {
        const detail = e.data.includes('?') ? e.data.slice(e.data.indexOf('?') + 1) : '';
        setError(
          `IDEXX reported a problem with this order${
            detail ? ` (${decodeURIComponent(detail)})` : ''
          }. Try Open in new tab, or close and try again.`
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url, finish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="settings-modal-overlay idexx-frame-overlay" role="presentation">
      <div
        className="idexx-frame"
        role="dialog"
        aria-modal="true"
        aria-label={`IDEXX order for ${patientName}`}
      >
        <div className="idexx-frame__head">
          <div className="idexx-frame__title">
            <strong>IDEXX · {patientName}</strong>
            <span className="idexx-order__meta">Requisition #{order.idexxOrderId}</span>
            {submitted ? (
              <span className="idexx-result__reviewed">
                <CheckCircle2 size={13} aria-hidden /> Submitted. Closing…
              </span>
            ) : (
              <span className="idexx-order__meta">
                Answer the specimen questions, add any add-ons, and click Order.
              </span>
            )}
            {added.length ? (
              <span className="idexx-order__note--ok">Added to the bill: {added.join(', ')}</span>
            ) : null}
          </div>
          <div className="idexx-result__actions">
            {url ? (
              <a className="btn secondary btn-sm" href={url} target="_blank" rel="noreferrer">
                <ExternalLink size={13} aria-hidden /> Open in new tab
              </a>
            ) : null}
            <button type="button" className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {error ? <p className="idexx-order__error">{error}</p> : null}
        {url ? (
          <iframe
            ref={frameRef}
            className="idexx-frame__body"
            src={url}
            title="IDEXX VetConnect PLUS order"
            // After the first page, a new page load means IDEXX moved on (usually to its blank
            // page after Order): check the order and close if it went through.
            onLoad={() => {
              loads.current += 1;
              if (loads.current > 1) finish(false);
            }}
          />
        ) : (
          <div className="idexx-frame__loading">
            <Loader2 size={18} className="pims-task-detail__spinner" aria-hidden /> Opening IDEXX…
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
