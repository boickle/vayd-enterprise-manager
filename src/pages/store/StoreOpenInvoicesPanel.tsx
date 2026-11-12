import type { StoreOpenInvoice } from '../../api/onlineStore';
import {
  invoiceTableHtml,
  storeOpenInvoiceToEmailModel,
} from '../../utils/invoiceEmail';

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function greetingName(clientName: string): string {
  const trimmed = clientName.trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0] || trimmed;
}

export default function StoreOpenInvoicesPanel({ invoices }: { invoices: StoreOpenInvoice[] }) {
  if (!invoices.length) return null;

  return (
    <div className="vayd-store__open-invoices-panel">
      {invoices.map((inv) => {
        const clientName = inv.clientName?.trim() || 'Client';
        const due = Number(inv.due) || 0;
        const model = storeOpenInvoiceToEmailModel(inv);

        return (
          <article key={inv.id} className="vayd-store__open-invoice-email">
            <p className="vayd-store__open-invoice-intro">
              Hi {greetingName(clientName)}, here is your invoice from Vet At Your Door. The balance
              due is <strong>{money(due)}</strong>.
            </p>
            <p className="vayd-store__open-invoice-for">
              Invoice for <strong>{clientName}</strong>
            </p>
            <div
              className="vayd-store__open-invoice-email-table"
              dangerouslySetInnerHTML={{ __html: invoiceTableHtml(model) }}
            />
          </article>
        );
      })}
    </div>
  );
}
