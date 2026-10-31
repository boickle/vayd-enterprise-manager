import type { SalesTaxReport } from '../api/salesTax';

type Cell = string | number;

export type ReportSection = {
  title: string;
  note?: string;
  columns: string[];
  rows: Cell[][];
  /** Index of rows to bold (e.g. totals). */
  boldRows?: number[];
  /** PDF column widths as fractions of the page width. */
  widths?: number[];
};

const pct = (rate: number) => `${(rate * 100).toFixed(rate * 100 % 1 ? 1 : 0)}%`;

export function periodLabel(report: SalesTaxReport): string {
  return report.start === report.end ? report.start : `${report.start} to ${report.end}`;
}

export function salesTaxSections(report: SalesTaxReport): ReportSection[] {
  const { summary, channels, useTax } = report;
  const rate = pct(report.taxRate);
  const sections: ReportSection[] = [
    {
      title: 'What to file (Maine ST-7)',
      columns: ['Line', 'Description', 'Amount'],
      rows: [
        ['1', 'Gross sales (taxable + exempt, before tax)', summary.grossSales],
        ['2', 'Exempt sales (services, labs, untaxed items, memberships)', summary.exemptSales],
        ['4', 'Taxable sales', summary.taxableSales],
        ['6', `Sales tax at ${rate}`, summary.salesTax],
        ['17', 'Purchases subject to use tax (wasted/expired stock at cost)', useTax.cost],
        ['17A', `Use tax at ${rate}`, useTax.tax],
        ['', 'Total tax due', Math.round((summary.salesTax + useTax.tax) * 100) / 100],
      ],
      boldRows: [6],
      widths: [0.1, 0.65, 0.25],
    },
    {
      title: 'Where sales came from',
      columns: ['Source', 'Invoices', 'Gross sales', 'Exempt', 'Taxable', 'Tax'],
      rows: [
        ['In clinic', channels.clinic.invoices, channels.clinic.gross, channels.clinic.exempt, channels.clinic.taxable, channels.clinic.tax],
        ['Online store (paid with Pharmacy-Online)', channels.onlineStore.invoices, channels.onlineStore.gross, channels.onlineStore.exempt, channels.onlineStore.taxable, channels.onlineStore.tax],
        ['Membership subscriptions (Square + Stripe)', channels.subscriptions.charges, channels.subscriptions.gross, channels.subscriptions.exempt, 0, 0],
        ['Total', summary.invoices, summary.grossSales, summary.exemptSales, summary.taxableSales, summary.salesTax],
      ],
      boldRows: [3],
    },
    {
      title: 'By category',
      columns: ['Category', 'Type', 'Gross sales', 'Exempt', 'Taxable', 'Tax'],
      rows: report.categories.map((c) => [c.label, kindLabel(c.kind), c.gross, c.exempt, c.taxable, c.tax]),
    },
  ];
  if (useTax.events > 0) {
    sections.push({
      title: 'Use tax: wasted and expired stock',
      columns: ['Reason', 'Times', 'Cost', 'Use tax'],
      rows: [
        ...useTax.byReason.map((r) => [r.label, r.events, r.cost, Math.round(r.cost * report.taxRate * 100) / 100]),
        ['Total', useTax.events, useTax.cost, useTax.tax],
      ],
      boldRows: [useTax.byReason.length],
    });
  }
  if (report.storeOrders.orders > 0) {
    const s = report.storeOrders;
    sections.push({
      title: 'Online store orders (for reference)',
      note: 'Already counted above through eVet; shown so you can check the store against eVet.',
      columns: ['Orders', 'Subtotal', 'Discount', 'Shipping', 'Tax', 'Total', 'Auto-ship orders', 'Auto-ship subtotal'],
      rows: [[s.orders, s.subtotal, s.discount, s.shipping, s.tax, s.total, s.autoshipOrders, s.autoshipSubtotal]],
    });
  }
  if ((report.stripeBreakdown ?? []).length > 0) {
    sections.push({
      title: 'Stripe charges by source (for reference)',
      note: 'Only memberships are added to sales; store and Hill\'s to Home charges are already in eVet.',
      columns: ['Source', 'Charges', 'Amount', 'Refunded', 'In sales'],
      rows: report.stripeBreakdown.map((s) => [s.label, s.count, s.amount, s.refunded, s.inSubscriptions ? 'Yes' : 'No']),
    });
  }
  sections.push({
    title: 'Payments received (tie-out)',
    note: 'Payments by the date received. Differences from sales are timing, unpaid balances, and credits.',
    columns: ['Payment type', 'Count', 'Amount', 'Counted as income'],
    rows: [
      ...report.payments.rows.map((p) => [p.type, p.count, p.amount, p.excluded ? 'No' : 'Yes']),
      ['Payments received', '', report.tieOut.received, ''],
      ['Sales + tax (this report)', '', report.tieOut.salesWithTax, ''],
      ['Difference', '', report.tieOut.difference, ''],
    ],
    boldRows: [report.payments.rows.length, report.payments.rows.length + 1, report.payments.rows.length + 2],
  });
  sections.push({
    title: 'Compare with eVet Sales Report',
    note: 'eVet spreads each payment received across the invoice lines. Same method here, without memberships.',
    columns: ['Payments applied', 'Exempt', 'Taxable', 'Tax'],
    rows: [[report.paymentBasis.applied, report.paymentBasis.exempt, report.paymentBasis.taxable, report.paymentBasis.tax]],
  });
  if ((report.warnings ?? []).length > 0) {
    sections.unshift({
      title: 'Warnings: this report is incomplete',
      columns: ['Warning'],
      rows: report.warnings.map((w) => [w]),
    });
  }
  return sections;
}

export function kindLabel(kind: string): string {
  if (kind === 'product') return 'Product';
  if (kind === 'service') return 'Service';
  if (kind === 'package') return 'Package';
  return 'Other';
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function isMoneyColumn(name: string): boolean {
  return !/^(line|count|times|invoices|orders|auto-ship orders|type|category|source|reason|description|payment type|counted as income|charges|in sales|warning)$/i.test(name);
}

export async function downloadSalesTaxPdf(report: SalesTaxReport): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const usable = pageW - margin * 2;
  let y = margin;

  const ensure = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Sales & Tax Report', margin, y + 4);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`${periodLabel(report)} · by invoice date · ${report.taxRateName} tax ${pct(report.taxRate)}`, margin, y);
  y += 22;

  for (const section of salesTaxSections(report)) {
    ensure(48);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(section.title, margin, y);
    y += 6;
    if (section.note) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(section.note, usable);
      doc.text(lines, margin, y + 10);
      y += 10 * lines.length;
    }
    y += 8;

    const n = section.columns.length;
    const firstW = n <= 3 ? usable * 0.6 : n >= 7 ? usable / n : usable * 0.34;
    const restW = (usable - firstW) / Math.max(1, n - 1);
    const widths = section.widths
      ? section.widths.map((f) => f * usable)
      : section.columns.map((_, i) => (i === 0 ? firstW : restW));
    const numericColumn = section.columns.map((_, i) =>
      section.rows.some((row) => typeof row[i] === 'number'),
    );

    const drawRow = (cells: Cell[], header: boolean, bold: boolean) => {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', header || bold ? 'bold' : 'normal');
      const wrapped = cells.map((c, i) => {
        const text =
          typeof c === 'number' && isMoneyColumn(section.columns[i]) && !header ? money(c) : String(c);
        return doc.splitTextToSize(text, widths[i] - 6) as string[];
      });
      const h = Math.max(...wrapped.map((w) => w.length)) * 10 + 6;
      ensure(h);
      if (header) {
        doc.setFillColor(238, 242, 247);
        doc.rect(margin, y, usable, h, 'F');
      }
      let x = margin;
      wrapped.forEach((lines, i) => {
        const right = header ? numericColumn[i] : typeof cells[i] === 'number';
        const tx = right ? x + widths[i] - 3 : x + 3;
        doc.text(lines, tx, y + 11, { align: right ? 'right' : 'left' });
        x += widths[i];
      });
      doc.setDrawColor(225, 228, 232);
      doc.line(margin, y + h, margin + usable, y + h);
      y += h;
    };

    drawRow(section.columns, true, false);
    section.rows.forEach((row, i) => drawRow(row, false, section.boldRows?.includes(i) ?? false));
    y += 18;
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  ensure(20);
  doc.text(`Generated ${new Date(report.generatedAt).toLocaleString()}`, margin, y);
  doc.save(`sales-tax-${report.start}-to-${report.end}.pdf`);
}

export async function downloadSalesTaxExcel(report: SalesTaxReport): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const sections = salesTaxSections(report);
  const toSheet = (section: ReportSection) => {
    const data = [
      [{ value: section.title, fontWeight: 'bold' as const }],
      ...(section.note ? [[{ value: section.note, fontStyle: 'italic' as const }]] : []),
      [],
      section.columns.map((c) => ({ value: c, fontWeight: 'bold' as const, backgroundColor: '#EEF2F7' })),
      ...section.rows.map((row, i) =>
        row.map((c, j) => {
          const bold = section.boldRows?.includes(i) ? ('bold' as const) : undefined;
          if (typeof c === 'number') {
            return {
              value: c,
              type: Number,
              format: isMoneyColumn(section.columns[j]) ? '$#,##0.00' : '0',
              fontWeight: bold,
            };
          }
          return { value: c, fontWeight: bold };
        }),
      ),
    ];
    return data;
  };
  const sheetNames = ['ST-7', 'Sources', 'Categories', 'Use tax', 'Store orders', 'Payments', 'eVet compare'];
  const names = sections.map((s) => {
    if (s.title.startsWith('What to file')) return sheetNames[0];
    if (s.title.startsWith('Where')) return sheetNames[1];
    if (s.title.startsWith('By category')) return sheetNames[2];
    if (s.title.startsWith('Use tax')) return sheetNames[3];
    if (s.title.startsWith('Online store')) return sheetNames[4];
    if (s.title.startsWith('Payments')) return sheetNames[5];
    if (s.title.startsWith('Stripe')) return 'Stripe';
    if (s.title.startsWith('Warnings')) return 'Warnings';
    return sheetNames[6];
  });
  await writeXlsxFile(sections.map(toSheet), {
    sheets: names,
    columns: sections.map((s) => s.columns.map((_, i) => ({ width: i === 0 ? 44 : 16 }))),
    fileName: `sales-tax-${report.start}-to-${report.end}.xlsx`,
  });
}
