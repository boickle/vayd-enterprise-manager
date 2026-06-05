import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  formatUsd,
  pickStr,
  toNum,
  yn,
  type NormalizedInvoice,
} from '../../utils/pimsInvoices';
import './PimsClientDetailView.css';

function strFromScalar(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return pickStr(v);
}

export default function ClientInvoiceDetailModal({
  inv,
  balance,
  onClose,
}: {
  inv: NormalizedInvoice;
  balance: number | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const raw = inv.raw;
  const payments = Array.isArray(raw.invoicePayments)
    ? (raw.invoicePayments as Record<string, unknown>[])
    : [];

  const metaRows: { label: string; value: ReactNode }[] = [
    { label: 'Invoice #', value: inv.number },
    { label: 'Invoiced', value: inv.date },
    { label: 'Status', value: inv.status },
    { label: 'Total', value: formatUsd(inv.total) },
    { label: 'Amount paid', value: formatUsd(inv.paid) },
    { label: 'Amount due', value: formatUsd(inv.due) },
    { label: 'Discount', value: toNum(raw.discount) != null ? formatUsd(toNum(raw.discount)!) : '—' },
    { label: 'Client balance (from header)', value: balance != null ? formatUsd(balance) : '—' },
    { label: 'PIMS id', value: strFromScalar(raw.pimsId) ?? '—' },
    { label: 'PIMS type', value: pickStr(raw.pimsType) ?? '—' },
    { label: 'Invoice key', value: pickStr(raw.invoiceKey) ?? '—' },
    { label: 'Post-close complete', value: yn(raw.postCloseProcessComplete) },
    { label: 'Transferred', value: yn(raw.isTransferred) },
    { label: 'Created by', value: inv.createdBy },
  ];

  const modal = (
    <div
      className="pims-client-detail__inv-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pims-client-detail__inv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pims-inv-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="pims-inv-modal-title" className="pims-client-detail__inv-modal-title">
          Invoice #{inv.number}
        </h2>
        <dl className="pims-client-detail__inv-modal-meta">
          {metaRows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>

        <h3 className="pims-client-detail__inv-modal-subhead">Line items</h3>
        <div className="pims-client-detail__inv-modal-table-wrap">
          <table className="pims-client-detail__inv-modal-table">
            <thead>
              <tr>
                <th>Done</th>
                <th>Service date</th>
                <th>Description</th>
                <th>Patient</th>
                <th>Provider</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Svc fee</th>
                <th>Subtotal</th>
                <th>Tax</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.length === 0 ? (
                <tr>
                  <td colSpan={11} className="pims-client-detail__inv-modal-empty">
                    No line items on this invoice.
                  </td>
                </tr>
              ) : (
                inv.lines.map((line) => (
                  <tr key={line.key}>
                    <td>{line.complete ? '✓' : ''}</td>
                    <td>{line.date}</td>
                    <td>{line.description}</td>
                    <td>{line.patient}</td>
                    <td>
                      <div>{line.provider}</div>
                      {line.productionEmployee !== '—' &&
                      line.productionEmployee.trim().toLowerCase() !==
                        line.provider.trim().toLowerCase() ? (
                        <div className="pims-client-detail__inv-modal-cell-sub">
                          {line.productionEmployee}
                        </div>
                      ) : null}
                    </td>
                    <td>{line.qty}</td>
                    <td>{formatUsd(line.unitPrice)}</td>
                    <td>{formatUsd(line.serviceFee)}</td>
                    <td>{formatUsd(line.subtotal)}</td>
                    <td>{formatUsd(line.tax)}</td>
                    <td>{formatUsd(line.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="pims-client-detail__inv-modal-total-row">
                <td colSpan={10} className="pims-client-detail__inv-modal-total-label">
                  Invoice total
                </td>
                <td className="pims-client-detail__inv-modal-total-value">{formatUsd(inv.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {payments.length > 0 ? (
          <>
            <h3 className="pims-client-detail__inv-modal-subhead">Payments</h3>
            <div className="pims-client-detail__inv-modal-table-wrap">
              <table className="pims-client-detail__inv-modal-table">
                <thead>
                  <tr>
                    <th>Amount paid</th>
                    <th>Credit used</th>
                    <th>Payment history PIMS id</th>
                    <th>Payment PIMS id</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={strFromScalar(p.id) ?? `pay-${i}`}>
                      <td>{formatUsd(toNum(p.amountPaid) ?? 0)}</td>
                      <td>{formatUsd(toNum(p.creditUsed) ?? 0)}</td>
                      <td>{pickStr(p.paymentHistoryPimsId) ?? '—'}</td>
                      <td>{pickStr(p.paymentPimsId) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <div className="pims-client-detail__inv-modal-actions">
          <button type="button" className="pims-client-detail__inv-modal-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
