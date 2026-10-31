import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, FileText, RefreshCw, X } from 'lucide-react';
import {
  cancelIdexxOrder,
  idexxErrorMessage,
  syncIdexxResults,
  type IdexxOrder,
  type IdexxSyncResult,
} from '../../api/idexx';
import IdexxChip from './IdexxChip';
import IdexxOrderFrame from './IdexxOrderFrame';
import IdexxResultView, { idexxResultStatusLabel } from './IdexxResultView';
import type { IdexxSyncNote } from './useIdexxInvoice';
import './Idexx.css';

type Props = {
  order: IdexxOrder;
  patientName?: string;
  /** Tests IDEXX added that were or weren't charged, from the last sync. */
  note?: IdexxSyncNote | null;
  readOnly?: boolean;
  onSync: (orderId: number) => Promise<IdexxSyncResult>;
  onChanged: () => void;
};

function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener');
}

/** One IDEXX order on a lab line: finish it in IDEXX, follow it, and read what came back. */
export default function IdexxOrderPanel({
  order,
  patientName,
  note,
  readOnly,
  onSync,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [framed, setFramed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openResultId, setOpenResultId] = useState<number | null>(
    order.results.length === 1 ? order.results[0].id : null
  );

  async function run(key: string, fn: () => Promise<unknown>, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(idexxErrorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  }

  const draft = order.status === 'CREATED';
  return (
    <div className="idexx-order">
      {framed ? (
        <IdexxOrderFrame
          order={order}
          patientName={patientName ?? 'this pet'}
          onSync={onSync}
          onClose={() => {
            setFramed(false);
            onChanged();
          }}
        />
      ) : null}
      <div className="idexx-order__head">
        <div className="idexx-order__title">
          Requisition #{order.idexxOrderId}
          <IdexxChip order={order} />
        </div>
        <div className="idexx-order__actions">
          {draft && order.uiUrl && !readOnly ? (
            <button type="button" className="btn btn-sm" onClick={() => setFramed(true)}>
              <ExternalLink size={13} aria-hidden /> Finish in IDEXX
            </button>
          ) : null}
          {order.pdfUrl ? (
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => openInNewTab(order.pdfUrl!)}
            >
              <FileText size={13} aria-hidden /> Requisition
            </button>
          ) : null}
          {order.status !== 'CANCELLED' ? (
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={busy != null}
              title={
                draft
                  ? 'Check whether it was submitted in IDEXX'
                  : 'Check IDEXX for new results now'
              }
              onClick={() =>
                void run(
                  'sync',
                  async () => {
                    if (!draft) await syncIdexxResults();
                    await onSync(order.id);
                  },
                  'Could not reach IDEXX.'
                )
              }
            >
              <RefreshCw size={13} aria-hidden />{' '}
              {busy === 'sync' ? 'Checking…' : draft ? 'Refresh' : 'Check for results'}
            </button>
          ) : null}
          {draft && !readOnly ? (
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={busy != null}
              onClick={() =>
                void run(
                  'cancel',
                  async () => {
                    await cancelIdexxOrder(order.id);
                    onChanged();
                  },
                  'Could not cancel the order.'
                )
              }
            >
              <X size={13} aria-hidden /> Cancel order
            </button>
          ) : null}
        </div>
      </div>

      {draft ? (
        <p className="idexx-order__note">
          Created in IDEXX but not submitted yet. Click <strong>Finish in IDEXX</strong> to answer
          the specimen questions, submit, and print the requisition to send with the sample.
        </p>
      ) : order.status === 'SUBMITTED' && !order.results.length ? (
        <p className="idexx-order__note">
          Submitted{order.submittedAt ? ` ${new Date(order.submittedAt).toLocaleDateString()}` : ''}
          . Results show up here as IDEXX posts them (checked every 5 minutes).
        </p>
      ) : order.status === 'CANCELLED' ? (
        <p className="idexx-order__note">Cancelled. Nothing was sent to the lab.</p>
      ) : null}

      {note?.added.length ? (
        <p className="idexx-order__note idexx-order__note--ok">
          Added to the bill from IDEXX: {note.added.join(', ')}.
        </p>
      ) : null}
      {note?.uncaptured.length ? (
        <p className="idexx-order__note idexx-order__note--warn">
          Added in IDEXX but not on the bill:{' '}
          {note.uncaptured.map((u) => `${u.name ?? `test ${u.code}`} (${u.reason})`).join('; ')} Add
          the charge by hand.
        </p>
      ) : null}
      {error ? <p className="idexx-order__error">{error}</p> : null}

      {order.results.map((r) => {
        const open = openResultId === r.id;
        return (
          <div key={r.id}>
            <button
              type="button"
              className="idexx-order__result-row"
              aria-expanded={open}
              onClick={() => setOpenResultId(open ? null : r.id)}
            >
              {open ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
              <span className="idexx-order__result-name">{idexxResultStatusLabel(r)}</span>
              <IdexxChip order={{ status: 'SUBMITTED', results: [r] }} />
              {r.reviewedAt ? <span className="idexx-order__meta">Reviewed</span> : null}
            </button>
            {open ? (
              <div style={{ padding: '8px 2px 2px' }}>
                <IdexxResultView resultId={r.id} readOnly={readOnly} onReviewedChange={onChanged} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
