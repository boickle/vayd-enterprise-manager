import type { MailOrder } from '../api/onlineStore';
import type { EmailRegardingPatient } from '../components/ClientEmailComposeModal';
import { brandedClientEmailLogoBlock } from './brandedClientEmailHtml';
import {
  invoiceTableHtml,
  visitInvoiceToEmailModel,
  type InvoiceEmailModel,
  type VisitInvoiceEmailSource,
} from './invoiceEmail';
import { invoicePublicLabel } from './pimsInvoices';

const MUTED = '#6b7280';
const TEXT = '#374151';
const ACCENT = '#0f766e';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Strip internal staff notes from catalog item names (e.g. rebate reminders in ALL CAPS). */
export function mailOrderClientItemName(name: string): string {
  const normalized = name
    .trim()
    .replace(/\s+-\s*(?=[A-Z][A-Z0-9\s,/]*(?:REBATE|PK)\b)/i, ' - ')
    .replace(/([a-z0-9])-\s*(?=ADD\s)/gi, '$1 - ');
  return normalized
    .split(/\s+-\s+/)
    .filter((part, i) => i === 0 || !/^\s*ADD\s/i.test(part))
    .join(' - ')
    .replace(/,\s*\(/g, ' (')
    .replace(/\s+/g, ' ')
    .trim();
}

function orderContentsSummary(order: MailOrder): string {
  const byPet = new Map<string, string[]>();
  for (const line of order.lines || []) {
    const pet = (line.patientName || '').trim();
    const item = mailOrderClientItemName(line.name || '');
    if (!item) continue;
    byPet.set(pet, [...(byPet.get(pet) || []), item]);
  }
  const parts = [...byPet.entries()].map(([pet, items]) =>
    pet ? `${pet}'s ${joinList(items)}` : joinList(items),
  );
  return joinList(parts) || `order #${order.id}`;
}

function carrierDisplayName(carrier?: string | null): string {
  const c = (carrier || '').trim();
  if (/^usps$/i.test(c)) return 'USPS';
  if (/^ups$/i.test(c)) return 'UPS';
  if (/fedex/i.test(c)) return 'FedEx';
  if (/dhl/i.test(c)) return 'DHL';
  return c;
}

function trackingUrl(carrier?: string | null, code?: string | null): string | null {
  const tracking = (code || '').trim();
  if (!tracking) return null;
  const q = encodeURIComponent(tracking);
  switch (carrierDisplayName(carrier)) {
    case 'USPS':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${q}`;
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${q}`;
    case 'FedEx':
      return `https://www.fedex.com/fedextrack/?trknbr=${q}`;
    case 'DHL':
      return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${q}`;
    default:
      return null;
  }
}

function orderHasAutoship(order: MailOrder): boolean {
  return Boolean(order.autoship) || (order.lines || []).some((line) => line.autoshipFrequency);
}

function clientPortalUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin.replace(/\/+$/, '')}/client-portal`;
  }
  return 'https://portal.vetatyourdoor.com/client-portal';
}

function compactRejectedLinesTable(order: MailOrder): string {
  const lines = mailOrderRejectedLines(order);
  if (!lines.length) return '';
  const rows = lines
    .map((line) => {
      const qty = Math.max(1, Number(line.quantity) || 1);
      const name = mailOrderClientItemName(line.name || '');
      const pet = (line.patientName || '').trim();
      const label = pet ? `${pet} — ${name}` : name;
      return `<tr>
  <td style="padding:10px 8px;border-bottom:1px solid #e8efe9;color:#103b2e;font-size:14px;line-height:1.4;">${escapeHtml(label)}</td>
  <td style="padding:10px 8px;border-bottom:1px solid #e8efe9;text-align:center;color:${TEXT};font-size:14px;">${qty}</td>
</tr>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #d7e5df;border-radius:8px;overflow:hidden;margin:0 0 20px;">
  <thead>
    <tr style="background:#fef2f2;">
      <th align="left" style="padding:10px 8px;font-size:12px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.03em;">Not approved</th>
      <th style="padding:10px 8px;font-size:12px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.03em;">Qty</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function compactOrderLinesTable(order: MailOrder): string {
  const lines = order.lines || [];
  if (!lines.length) return '';
  const rows = lines
    .map((line) => {
      const qty = Math.max(1, Number(line.quantity) || 1);
      const name = mailOrderClientItemName(line.name || '');
      const pet = (line.patientName || '').trim();
      const label = pet ? `${pet} — ${name}` : name;
      return `<tr>
  <td style="padding:10px 8px;border-bottom:1px solid #e8efe9;color:#103b2e;font-size:14px;line-height:1.4;">${escapeHtml(label)}</td>
  <td style="padding:10px 8px;border-bottom:1px solid #e8efe9;text-align:center;color:${TEXT};font-size:14px;">${qty}</td>
</tr>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #d7e5df;border-radius:8px;overflow:hidden;margin:0 0 20px;">
  <thead>
    <tr style="background:#f0f9f6;">
      <th align="left" style="padding:10px 8px;font-size:12px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.03em;">Item</th>
      <th style="padding:10px 8px;font-size:12px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.03em;">Qty</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function emailHeading(title: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${ACCENT};">${escapeHtml(title)}</h1>`;
}

function emailGreeting(firstName: string): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Hi ${escapeHtml(firstName)},</p>`;
}

function emailParagraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${TEXT};">${escapeHtml(text)}</p>`;
}

function emailTrackButton(url: string, label: string): string {
  return `<p style="margin:0 0 12px;">
  <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:${ACCENT};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
</p>`;
}

function emailCallout(title: string, body: string): string {
  return `<div style="margin:0 0 20px;padding:14px 16px;background:#f8faf9;border:1px solid #d7e5df;border-radius:8px;">
  <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#103b2e;">${escapeHtml(title)}</p>
  <p style="margin:0;font-size:14px;line-height:1.5;color:${TEXT};white-space:pre-line;">${escapeHtml(body)}</p>
</div>`;
}

function emailHelpFooter(): string {
  return `<p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:#4b5563;">Questions? Reply to this email or call us — we are happy to help.</p>`;
}

function autoshipPortalHtml(): string {
  const url = escapeHtml(clientPortalUrl());
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#374151;">If you want to make any changes, <a href="${url}" style="color:#0f766e;font-weight:700;">sign in to your client portal</a>.</p>`;
}

export const MAIL_ORDER_PAY_INVOICE_WAIT_MS = 60 * 60 * 1000;

export type MailOrderLinkedInvoiceLine = {
  id: string;
  amount: number;
  taxAmount: number;
  tagalongOfLineId?: string | null;
  removed?: boolean;
};

export type MailOrderLinkedInvoice = {
  total: number;
  due: number;
  paid: number;
  created?: string | null;
  appointmentId?: number | null;
  invoice?: VisitInvoiceEmailSource | null;
  lines: MailOrderLinkedInvoiceLine[];
};

function invoiceNoteLineIds(notes: string | null | undefined, token: string): string[] {
  return [...(notes || '').matchAll(new RegExp(`${token}:([0-9a-f-]{36})`, 'gi'))].map((m) => m[1]);
}

/** Price of the lines this mail order took off the visit, not the rest of the invoice. */
export function mailOrderMailedInvoiceAmount(
  order: MailOrder,
  linked?: Pick<MailOrderLinkedInvoice, 'lines'> | null,
): number {
  if (!linked) return 0;
  const ids = new Set([
    ...invoiceNoteLineIds(order.notes, 'invoiceLine'),
    ...invoiceNoteLineIds(order.notes, 'shippingLine'),
  ]);
  if (!ids.size) return 0;
  let sum = 0;
  for (const line of linked.lines) {
    if (line.removed) continue;
    const partOfMailedItem = Boolean(line.tagalongOfLineId && ids.has(line.tagalongOfLineId));
    if (!ids.has(line.id) && !partOfMailedItem) continue;
    sum += line.amount + line.taxAmount;
  }
  return Math.round(sum * 100) / 100;
}

/** Whole visit invoice is still unpaid, or unpaid items besides the mail order remain. */
export function mailOrderPayUsesFullInvoice(
  order: MailOrder,
  linked?: MailOrderLinkedInvoice | null,
): boolean {
  if (!linked || linked.due <= 0.009) return false;
  if (!(Number(order.total) > 0.009) && linked.paid <= 0.009) return true;
  const mailed = mailOrderMailedInvoiceAmount(order, linked);
  return linked.due > mailed + 0.009;
}

export function mailOrderInvoiceIsFresh(iso?: string | null, now = Date.now()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t >= 0 && now - t < MAIL_ORDER_PAY_INVOICE_WAIT_MS;
}

export function mailOrderPayInvoiceNeedsWait(opts: {
  invoiceCreated?: string | null;
  appointmentStart?: string | null;
  appointmentEnd?: string | null;
  now?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  if (mailOrderInvoiceIsFresh(opts.invoiceCreated, now)) return true;
  if (mailOrderInvoiceIsFresh(opts.appointmentStart, now)) return true;
  if (opts.appointmentEnd) {
    const end = new Date(opts.appointmentEnd).getTime();
    if (Number.isFinite(end) && end > now) return true;
  }
  return false;
}

export function mailOrderPayAmount(
  order: MailOrder,
  linked?: MailOrderLinkedInvoice | null,
): number {
  if (Number(order.total) > 0.009) {
    return Math.round((Number(order.total) || 0) * 100) / 100;
  }
  if (linked && mailOrderPayUsesFullInvoice(order, linked)) {
    return Math.round((Number(linked.due) || 0) * 100) / 100;
  }
  const mailed = mailOrderMailedInvoiceAmount(order, linked);
  if (mailed > 0.009) return mailed;
  if (linked?.due != null) return Math.round((Number(linked.due) || 0) * 100) / 100;
  return Math.round((Number(order.total) || 0) * 100) / 100;
}

function mailOrderPayInvoiceLabel(linked?: MailOrderLinkedInvoice | null): string | null {
  if (!linked?.invoice) return null;
  return invoicePublicLabel(linked.invoice);
}

export function mailOrderPaySubject(
  order: MailOrder,
  linked?: MailOrderLinkedInvoice | null,
): string {
  const invoiceNo = mailOrderPayInvoiceLabel(linked);
  if (mailOrderPayUsesFullInvoice(order, linked) && invoiceNo) {
    return `Payment for invoice ${invoiceNo} (includes order #${order.id})`;
  }
  const pets = [
    ...new Set(
      [...(order.lines || []).map((line) => line.patientName), order.patientName]
        .flatMap((name) => (name || '').split(/\s*&\s*/))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  return pets.length
    ? `Payment for ${joinList(pets)}'s order #${order.id}`
    : `Payment for your order #${order.id}`;
}

export function mailOrderPaySmsText(
  order: MailOrder,
  firstName: string,
  amount: number,
  payUrl?: string | null,
  linked?: MailOrderLinkedInvoice | null,
): string {
  const invoiceNo = mailOrderPayInvoiceLabel(linked);
  const ready = `We have ${orderContentsSummary(order)} ready to send (order #${order.id}).`;
  const body = mailOrderPayUsesFullInvoice(order, linked)
    ? `${ready} Invoice${invoiceNo ? ` ${invoiceNo}` : ''} is still unpaid (${formatMailOrderMoney(amount)}) and includes the rest of that visit. Once it's paid we'll get the order on its way.`
    : `${ready} The total is ${formatMailOrderMoney(amount)} — once it's paid we'll get it on its way.`;
  const lines = [`Hi ${firstName},`, '', body];
  if (payUrl?.trim()) {
    lines.push('', `Pay here: ${payUrl.trim()}`);
  }
  lines.push('', 'Questions? Reply or call us — we are happy to help.');
  return lines.join('\n');
}

function mailOrderInvoiceModel(
  order: MailOrder,
  amount: number,
  payUrl?: string | null,
): InvoiceEmailModel {
  const lines = (order.lines || []).map((line) => {
    const qty = Math.max(1, Number(line.quantity) || 1);
    const unit = Number(line.unitPrice) || 0;
    return {
      description: mailOrderClientItemName(line.name || ''),
      pet: (line.patientName || '').trim() || undefined,
      qty,
      amount: unit * qty,
    };
  });
  if (Number(order.shipping) > 0.009) {
    lines.push({
      description: order.shippingChargeName || 'Shipping',
      pet: undefined,
      qty: 1,
      amount: Number(order.shipping) || 0,
    });
  }
  if (Number(order.discount) > 0.009) {
    lines.push({
      description: order.couponCode ? `Discount (${order.couponCode})` : 'Discount',
      pet: undefined,
      qty: 1,
      amount: -Number(order.discount),
    });
  }
  return {
    kind: 'invoice',
    label: `Order #${order.id}`,
    date: order.created
      ? new Date(order.created).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : undefined,
    clientName: order.customerName,
    lines,
    subtotal: Number(order.subtotal) || 0,
    tax: 0,
    total: Number(order.total) || amount,
    paid: 0,
    due: amount,
    payLink: payUrl?.trim() || null,
  };
}

export function mailOrderPayInvoiceModel(
  order: MailOrder,
  amount: number,
  payUrl?: string | null,
  linked?: MailOrderLinkedInvoice | null,
): InvoiceEmailModel {
  if (mailOrderPayUsesFullInvoice(order, linked) && linked?.invoice) {
    const model = visitInvoiceToEmailModel(linked.invoice, order.customerName, payUrl);
    return { ...model, due: amount, payLink: payUrl?.trim() || model.payLink || null };
  }
  return mailOrderInvoiceModel(order, amount, payUrl);
}

export function mailOrderPayBodyHtml(
  order: MailOrder,
  firstName: string,
  amount: number,
  payUrl?: string | null,
  linked?: MailOrderLinkedInvoice | null,
): string {
  const fullInvoice = mailOrderPayUsesFullInvoice(order, linked);
  const invoiceNo = mailOrderPayInvoiceLabel(linked);
  const parts: string[] = [
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#103b2e;max-width:560px;">`,
    brandedClientEmailLogoBlock(),
    emailHeading(fullInvoice ? 'Payment for your invoice' : 'Payment for your order'),
    emailGreeting(firstName),
    emailParagraph(
      `We have ${orderContentsSummary(order)} ready to send (order #${order.id}).`,
    ),
  ];
  if (fullInvoice) {
    parts.push(
      emailParagraph(
        invoiceNo
          ? `Invoice ${invoiceNo} is still unpaid, so this includes the rest of that visit too.`
          : 'The visit invoice is still unpaid, so this includes the rest of that visit too.',
      ),
    );
  }
  parts.push(invoiceTableHtml(mailOrderPayInvoiceModel(order, amount, payUrl, linked)));
  if (orderHasAutoship(order)) parts.push(autoshipPortalHtml());
  parts.push(emailHelpFooter());
  parts.push('</div>');
  return parts.join('\n');
}

export function mailOrderContactSubject(order: MailOrder, pickup: boolean): string {
  const pets = [
    ...new Set(
      [...(order.lines || []).map((line) => line.patientName), order.patientName]
        .flatMap((name) => (name || '').split(/\s*&\s*/))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
  const label = pets.length ? `${joinList(pets)}'s order #${order.id}` : `Your order #${order.id}`;
  return pickup ? `${label} is ready for pickup` : `${label} has shipped`;
}

/** Plain text for SMS or simple previews. */
export function mailOrderContactSmsText(order: MailOrder, pickup: boolean, firstName: string): string {
  const summary = orderContentsSummary(order);
  if (pickup) {
    const where = order.shippingChargeName ? ` at ${order.shippingChargeName}` : '';
    const lines = [
      `Hi ${firstName},`,
      '',
      `Good news — ${summary} is ready for pickup${where} (order #${order.id}).`,
      '',
      'Please bring a photo ID when you pick up.',
    ];
    if (orderHasAutoship(order)) {
      lines.push('', `Client portal: ${clientPortalUrl()}`);
    }
    lines.push('', 'Questions? Reply or call us — we are happy to help.');
    return lines.join('\n');
  }
  const carrier = carrierDisplayName(order.carrier);
  const url = trackingUrl(order.carrier, order.trackingCode);
  const lines = [
    `Hi ${firstName},`,
    '',
    `${summary} has shipped (order #${order.id}).`,
  ];
  if (url) lines.push('', `Track your package: ${url}`);
  else if (order.trackingCode) {
    lines.push('', `${carrier ? `${carrier} tracking` : 'Tracking'}: ${order.trackingCode}`);
  }
  if (orderHasAutoship(order)) lines.push('', `Client portal: ${clientPortalUrl()}`);
  lines.push('', 'Questions? Reply or call us — we are happy to help.');
  return lines.join('\n');
}

/** Rich HTML for the Gmail compose modal (matches system shipped/pickup emails). */
export function mailOrderContactBodyHtml(order: MailOrder, pickup: boolean, firstName: string): string {
  const summary = orderContentsSummary(order);
  const title = pickup ? 'Ready for pickup' : 'Your order has shipped';
  const parts: string[] = [
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#103b2e;max-width:560px;">`,
    brandedClientEmailLogoBlock(),
    emailHeading(title),
    emailGreeting(firstName),
  ];

  if (pickup) {
    const where = order.shippingChargeName ? ` at ${order.shippingChargeName}` : '';
    parts.push(emailParagraph(`Good news — ${summary} is ready for pickup${where} (order #${order.id}).`));
    const location = [
      order.shipName || order.shippingChargeName,
      order.shipLine1,
      order.shipLine2,
      [order.shipCity, order.shipState, order.shipPostal].filter(Boolean).join(', '),
    ]
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    if (location.length) {
      parts.push(emailCallout('Pickup location', location.join('\n')));
    }
    parts.push(emailParagraph('Please bring a photo ID when you arrive. We are happy to help if you have questions.'));
  } else {
    parts.push(emailParagraph(`${summary} is on its way (order #${order.id}).`));
    const carrier = carrierDisplayName(order.carrier);
    const url = trackingUrl(order.carrier, order.trackingCode);
    if (url) {
      const label = carrier ? `Track with ${carrier}` : 'Track your package';
      parts.push(emailTrackButton(url, label));
      if (order.trackingCode) {
        parts.push(
          `<p style="margin:0 0 16px;font-size:13px;color:${MUTED};">Tracking number: ${escapeHtml(order.trackingCode)}</p>`,
        );
      }
    } else if (order.trackingCode) {
      parts.push(
        emailParagraph(
          `${carrier ? `${carrier} tracking` : 'Tracking'} number: ${order.trackingCode}.`,
        ),
      );
    }
  }

  parts.push(compactOrderLinesTable(order));
  if (orderHasAutoship(order)) parts.push(autoshipPortalHtml());
  parts.push(emailHelpFooter());
  parts.push('</div>');
  return parts.join('\n');
}

export function defaultMailOrderRejectSubject(orderId: number): string {
  return `Update on your Vet At Your Door order #${orderId}`;
}

/** Amount staff will refund on reject when the client was charged for this order. */
export function mailOrderRefundAmount(order: MailOrder): number | null {
  if ((order.paymentStatus || 'awaiting_payment') !== 'paid') return null;
  const total = Number(order.total) || 0;
  if (total < 0.009) return null;
  return total;
}

export function formatMailOrderMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function mailOrderRejectMainLine(order: MailOrder): string {
  const refund = mailOrderRefundAmount(order);
  const base = `We were not able to fill order #${order.id}.`;
  if (refund == null) return base;
  return `${base} A refund of ${formatMailOrderMoney(refund)} is on its way to your original payment method.`;
}

export function defaultMailOrderRejectBodyText(firstName: string, order: MailOrder): string {
  const lines = [
    `Hi ${firstName},`,
    '',
    mailOrderRejectMainLine(order),
    '',
    'Questions? Reply to this email or call us — we are happy to help.',
  ];
  return lines.join('\n');
}

export function defaultMailOrderRejectBodyHtml(firstName: string, order: MailOrder): string {
  const parts: string[] = [
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#103b2e;max-width:560px;">`,
    brandedClientEmailLogoBlock(),
    emailHeading('Update on your order'),
    emailGreeting(firstName),
    emailParagraph(mailOrderRejectMainLine(order)),
    compactOrderLinesTable(order),
    emailHelpFooter(),
    `</div>`,
  ];
  return parts.join('\n');
}

export function mailOrderRejectedLines(order: MailOrder) {
  return (order.lines || []).filter((line) => line.lineStatus === 'rejected');
}

export function mailOrderRejectedLineRefundTotal(order: MailOrder): number {
  return mailOrderRejectedLines(order).reduce(
    (sum, line) =>
      sum + (Number(line.unitPrice) || 0) * Math.max(1, Number(line.quantity) || 1),
    0,
  );
}

export function defaultMailOrderPartialRejectBodyText(firstName: string, order: MailOrder): string {
  const rejected = mailOrderRejectedLines(order);
  const items = rejected
    .map((line) => {
      const item = mailOrderClientItemName(line.name || '');
      const pet = (line.patientName || '').trim();
      return pet ? `${pet}'s ${item}` : item;
    })
    .filter(Boolean);
  const itemText =
    items.length <= 1
      ? items[0] || 'an item on your order'
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  const refund = mailOrderRejectedLineRefundTotal(order);
  const paid = (order.paymentStatus || 'awaiting_payment') === 'paid' && refund > 0.009;
  const body = [
    `Hi ${firstName},`,
    '',
    `We could not approve ${itemText} on order #${order.id}.`,
    paid
      ? `A refund of ${formatMailOrderMoney(refund)} is on its way to your original payment method.`
      : null,
    rejected.length < (order.lines || []).length
      ? 'The rest of your order is still moving through our pharmacy.'
      : null,
    '',
    'Questions? Reply to this email or call us — we are happy to help.',
  ].filter((line): line is string => Boolean(line));
  return body.join('\n');
}

function partialRejectItemPhrase(order: MailOrder): string {
  const rejected = mailOrderRejectedLines(order);
  const items = rejected
    .map((line) => {
      const item = mailOrderClientItemName(line.name || '');
      const pet = (line.patientName || '').trim();
      return pet ? `${pet}'s ${item}` : item;
    })
    .filter(Boolean);
  if (items.length <= 1) return items[0] || 'an item on your order';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function defaultMailOrderPartialRejectBodyHtml(firstName: string, order: MailOrder): string {
  const rejected = mailOrderRejectedLines(order);
  const itemText = partialRejectItemPhrase(order);
  const refund = mailOrderRejectedLineRefundTotal(order);
  const paid = (order.paymentStatus || 'awaiting_payment') === 'paid' && refund > 0.009;
  const parts: string[] = [
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#103b2e;max-width:560px;">`,
    brandedClientEmailLogoBlock(),
    emailHeading('Update on your order'),
    emailGreeting(firstName),
    emailParagraph(`We could not approve ${itemText} on order #${order.id}.`),
  ];
  if (paid) {
    parts.push(
      emailParagraph(
        `A refund of ${formatMailOrderMoney(refund)} is on its way to your original payment method.`,
      ),
    );
  }
  if (rejected.length < (order.lines || []).length) {
    parts.push(
      emailParagraph('The rest of your order is still moving through our pharmacy.'),
    );
  }
  parts.push(compactRejectedLinesTable(order));
  parts.push(emailHelpFooter());
  parts.push(`</div>`);
  return parts.join('\n');
}

/** HTML body for the reject / rejected-item Gmail compose modal. */
export function mailOrderRejectEmailBodyHtml(
  order: MailOrder,
  firstName: string,
  outreachOnly: boolean,
): string {
  if (outreachOnly || mailOrderRejectedLines(order).length > 0) {
    return defaultMailOrderPartialRejectBodyHtml(firstName, order);
  }
  return defaultMailOrderRejectBodyHtml(firstName, order);
}

export function mailOrderRegardingPatients(order: MailOrder): EmailRegardingPatient[] {
  const seen = new Map<number, string>();
  for (const line of order.lines || []) {
    if (line.patientId != null && line.patientId > 0 && line.patientName) {
      seen.set(line.patientId, line.patientName);
    }
  }
  if (order.patientId != null && order.patientId > 0 && order.patientName) {
    seen.set(order.patientId, order.patientName);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}
