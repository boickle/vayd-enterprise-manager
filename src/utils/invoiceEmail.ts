import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { formatUsd } from './pimsInvoices';
import type { GmailComposeAttachment } from '../api/gmail';

export type InvoiceEmailLine = {
  description: string;
  pet?: string;
  qty?: number;
  amount: number;
  /** Pre-discount / list total. Shown struck through when higher than `amount`. */
  listAmount?: number | null;
};

export type InvoiceEmailPayment = {
  date?: string;
  method?: string;
  receiptNumber?: string;
  amount: number;
};

export type InvoiceEmailModel = {
  kind: 'invoice' | 'receipt';
  label: string;
  date?: string;
  clientName: string;
  lines: InvoiceEmailLine[];
  payments?: InvoiceEmailPayment[];
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
  payLink?: string | null;
};

function money(n: number): string {
  return formatUsd(Number(n) || 0);
}

function lineAmountHtml(line: InvoiceEmailLine): string {
  const charged = Number(line.amount) || 0;
  const list = line.listAmount != null ? Number(line.listAmount) : null;
  if (list != null && list > charged + 0.009) {
    return `<div style="text-decoration:line-through;color:#dc2626;font-size:12px">${money(list)}</div><div>${money(charged)}</div>`;
  }
  return money(charged);
}

export function payButtonHtml(url: string | null | undefined): string {
  const href = url?.trim();
  if (!href) return '';
  const safe = escapeHtml(href);
  return `<p style="margin:16px 0 10px">Pay by <a href="${safe}">card or Google Pay</a>. To use a gift card, reply to this email.</p>
<p style="margin:8px 0 10px"><a href="${safe}" style="display:inline-block;background:#e67a20;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px">Pay Now</a></p>
<p style="font-size:13px;margin:0 0 16px">If the button isn't working, <a href="${safe}">click here to pay</a>.</p>`;
}

export function invoiceTableHtml(model: InvoiceEmailModel): string {
  const rows = model.lines
    .map(
      (line) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(line.description)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(line.pet ?? '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${line.qty ?? 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${lineAmountHtml(line)}</td>
      </tr>`,
    )
    .join('');
  const pays = (model.payments ?? []).map((p) => {
    const label = [
      p.method ?? 'Payment',
      p.receiptNumber ? `Receipt #${p.receiptNumber}` : null,
      p.date,
    ]
      .filter(Boolean)
      .join(' · ');
    return `<div style="display:flex;justify-content:space-between;gap:12px;color:#15803d;font-size:13px;margin:2px 0">
        <span>${escapeHtml(label)}</span>
        <span style="font-weight:650;white-space:nowrap">${money(p.amount)}</span>
      </div>`;
  });
  const paidColor = model.paid > 0.009 ? '#15803d' : '#111827';
  return `<div style="margin:16px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif;font-size:14px;color:#111827">
    <div style="background:#f3f4f6;padding:10px 12px;font-weight:700">${escapeHtml(model.label)}${model.date ? ` · ${escapeHtml(model.date)}` : ''}</div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="text-align:left;color:#6b7280">
          <th style="padding:8px">Item</th>
          <th style="padding:8px">Pet</th>
          <th style="padding:8px;text-align:right">Qty</th>
          <th style="padding:8px;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="padding:10px 12px;text-align:right;line-height:1.6">
      <div>Subtotal ${money(model.subtotal)}</div>
      ${model.tax > 0.004 ? `<div>Tax ${money(model.tax)}</div>` : ''}
      <div><strong>Total ${money(model.total)}</strong></div>
      ${
        pays.length
          ? `<div style="margin-top:10px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#15803d">Payments</div>
      <div style="text-align:left">${pays.join('')}</div>
      <div style="border-top:1px solid #86efac;margin:6px 0 8px"></div>`
          : ''
      }
      <div style="color:${paidColor}">Paid ${money(model.paid)}</div>
      <div><strong>Due ${money(model.due)}</strong></div>
    </div>
    ${
      model.payLink && model.due > 0.009
        ? `<div style="padding:0 12px 12px;text-align:left">${payButtonHtml(model.payLink)}</div>`
        : ''
    }
  </div>`;
}

export type LedgerEmailRow = {
  date: string;
  label: string;
  status: string;
  total: number;
  paid: number;
  due: number;
};

export function ledgerTableHtml(opts: {
  clientName: string;
  rows: LedgerEmailRow[];
  balance: number;
  payLink?: string | null;
}): string {
  const rows = opts.rows
    .map(
      (row) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.date)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.label)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.status)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${money(row.total)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${money(row.paid)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${money(row.due)}</td>
      </tr>`,
    )
    .join('');
  const owed = opts.balance > 0.005;
  const credit = opts.balance < -0.005;
  const balLabel = owed ? 'Balance due' : credit ? 'Credit' : 'Balance';
  const balColor = owed ? '#b91c1c' : credit ? '#15803d' : '#111827';
  return `<div style="margin:16px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif;font-size:14px;color:#111827">
    <div style="background:#f3f4f6;padding:10px 12px;font-weight:700">Account ledger · ${escapeHtml(opts.clientName)}</div>
    <div style="padding:10px 12px 6px;font-size:15px">
      <span style="color:#6b7280;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase">${balLabel}</span>
      <div style="font-weight:750;color:${balColor};font-size:22px">${money(Math.abs(opts.balance))}</div>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="text-align:left;color:#6b7280">
          <th style="padding:8px">Date</th>
          <th style="padding:8px">Invoice</th>
          <th style="padding:8px">Status</th>
          <th style="padding:8px;text-align:right">Total</th>
          <th style="padding:8px;text-align:right">Paid</th>
          <th style="padding:8px;text-align:right">Due</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="6" style="padding:12px 8px;color:#6b7280">No invoices on this statement.</td></tr>`}</tbody>
    </table>
    ${
      opts.payLink && opts.balance > 0.009
        ? `<div style="padding:0 12px 12px;text-align:left">${payButtonHtml(opts.payLink)}</div>`
        : '<div style="height:8px"></div>'
    }
  </div>`;
}

export async function ledgerPdfAttachment(opts: {
  clientName: string;
  rows: LedgerEmailRow[];
  balance: number;
}): Promise<GmailComposeAttachment> {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:760px;background:#fff;padding:28px;font-family:Arial,sans-serif;color:#111827';
  host.innerHTML = `
    <h1 style="margin:0 0 4px;font-size:22px">Vet At Your Door</h1>
    <p style="margin:0 0 16px;color:#6b7280">Account ledger for ${escapeHtml(opts.clientName)}</p>
    ${ledgerTableHtml(opts)}
  `;
  document.body.appendChild(host);
  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });
    const imgWidth = 8.5;
    const pageHeight = 11;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const pdf = new jsPDF('portrait', 'in', 'letter');
    let heightLeft = imgHeight;
    let position = 0;
    const img = canvas.toDataURL('image/png');
    pdf.addImage(img, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(img, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    const dataUrl = pdf.output('datauristring');
    return {
      filename: 'Account-ledger.pdf',
      mimeType: 'application/pdf',
      contentBase64: dataUrl.split(',')[1] || '',
    };
  } finally {
    host.remove();
  }
}

export async function invoicePdfAttachment(
  model: InvoiceEmailModel,
): Promise<GmailComposeAttachment> {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:760px;background:#fff;padding:28px;font-family:Arial,sans-serif;color:#111827';
  host.innerHTML = `
    <h1 style="margin:0 0 4px;font-size:22px">Vet At Your Door</h1>
    <p style="margin:0 0 16px;color:#6b7280">${model.kind === 'receipt' ? 'Receipt' : 'Invoice'} for ${escapeHtml(model.clientName)}</p>
    ${invoiceTableHtml(model)}
  `;
  document.body.appendChild(host);
  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });
    const imgWidth = 8.5;
    const pageHeight = 11;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const pdf = new jsPDF('portrait', 'in', 'letter');
    let heightLeft = imgHeight;
    let position = 0;
    const img = canvas.toDataURL('image/png');
    pdf.addImage(img, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(img, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    const dataUrl = pdf.output('datauristring');
    const contentBase64 = dataUrl.split(',')[1] || '';
    const safe = model.label.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'Invoice';
    return {
      filename: `${safe}.pdf`,
      mimeType: 'application/pdf',
      contentBase64,
    };
  } finally {
    host.remove();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
