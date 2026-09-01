import {
  htmlToPlainText,
  looksLikeHtmlFragment,
  sanitizeCommunicationHtml,
} from './sanitizeCommunicationHtml';

export function splitLoggedCommunicationMessage(raw: string): {
  subject: string | null;
  body: string;
} {
  const text = (raw ?? '').trim();
  const m = text.match(/^Subject:\s*(.*?)\r?\n\r?\n([\s\S]*)$/i);
  if (m) return { subject: m[1].trim() || null, body: m[2] };
  return { subject: null, body: text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rebuild a stacked Item/Pet/Qty/Amount dump (old plain-text logs) into a table. */
export function invoicePlainTextToHtml(body: string): string | null {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const headerAt = lines.findIndex(
    (l, i) =>
      /^item$/i.test(l) &&
      /^pet$/i.test(lines[i + 1] ?? '') &&
      /^qty$/i.test(lines[i + 2] ?? '') &&
      /^amount$/i.test(lines[i + 3] ?? ''),
  );
  if (headerAt < 0) return null;

  const intro = lines.slice(0, headerAt);
  const title =
    intro.find((l) => /^(receipt|invoice)\s*#/i.test(l)) ??
    intro[intro.length - 1] ??
    '';
  const lead = intro.filter((l) => l !== title);
  const after = lines.slice(headerAt + 4);
  const payAt = after.findIndex((l) => /^payments?$/i.test(l));
  const itemLines = payAt >= 0 ? after.slice(0, payAt) : after;
  const payLines = payAt >= 0 ? after.slice(payAt + 1) : [];

  const items: string[][] = [];
  for (let i = 0; i + 3 < itemLines.length; i += 4) {
    items.push(itemLines.slice(i, i + 4));
  }
  if (!items.length) return null;

  const introHtml = lead
    .map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`)
    .join('');
  const rows = items
    .map(
      (cols) =>
        `<tr>${cols
          .map(
            (c, idx) =>
              `<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;${
                idx > 1 ? 'text-align:right' : ''
              }">${escapeHtml(c)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');

  let pays = '';
  if (payLines.length) {
    const payRows: string[] = [];
    let i = 0;
    while (i < payLines.length) {
      const a = payLines[i] ?? '';
      const b = payLines[i + 1] ?? '';
      const looksMoney = /\$[\d,]+\.\d{2}/.test(a) || /\$[\d,]+\.\d{2}/.test(b);
      if (looksMoney && b && !/^subtotal|^tax|^total|^paid|^due/i.test(a)) {
        payRows.push(
          `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(
            a.replace(/(AM|PM)(Receipt)/i, '$1 · $2'),
          )}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(b)}</td></tr>`,
        );
        i += 2;
      } else {
        payRows.push(
          `<tr><td colspan="2" style="padding:6px 8px;text-align:right">${escapeHtml(a)}</td></tr>`,
        );
        i += 1;
      }
    }
    pays = `<div style="padding:8px 12px 0;font-weight:700;color:#374151">Payments</div>
      <table style="width:100%;border-collapse:collapse">${payRows.join('')}</table>`;
  }

  return `${introHtml}<div style="margin:16px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:Arial,sans-serif;font-size:14px;color:#111827">
    ${title ? `<div style="background:#f3f4f6;padding:10px 12px;font-weight:700">${escapeHtml(title)}</div>` : ''}
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
    ${pays}
  </div>`;
}

export function communicationBodyForDisplay(raw: string): {
  subject: string | null;
  html?: string;
  text: string;
} {
  const { subject, body } = splitLoggedCommunicationMessage(raw);
  if (looksLikeHtmlFragment(body)) {
    return {
      subject,
      html: sanitizeCommunicationHtml(body),
      text: htmlToPlainText(body),
    };
  }
  const rebuilt = invoicePlainTextToHtml(body);
  if (rebuilt) {
    return {
      subject,
      html: sanitizeCommunicationHtml(rebuilt),
      text: htmlToPlainText(rebuilt),
    };
  }
  return { subject, text: body };
}
