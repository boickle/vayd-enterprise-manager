import { describe, expect, it } from 'vitest';
import { estimateEmailModel, visitInvoiceToEmailModel } from './invoiceEmail';

describe('CAT-01 emailed invoice: charged lines are always shown', () => {
  const base = {
    id: 'inv-1',
    scoutInvoiceNumber: 11,
    created: '2026-10-15T16:50:00.000Z',
    subtotal: 153.61,
    taxTotal: 0,
    total: 153.61,
    amountPaid: 0,
  };
  const exam = { description: 'Exam', qty: 1, amount: 95 };
  const booster = { description: 'DAPP booster', qty: 1, amount: 58.61, hideOnInvoice: true };

  it('CAT-01-5 lists the hidden priced booster and the lines add up to the total', () => {
    const model = visitInvoiceToEmailModel({ ...base, lines: [exam, booster] }, 'Test Client');
    expect(model.lines.map((l) => l.description)).toEqual(['Exam', 'DAPP booster']);
    const sum = model.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round((sum + model.tax) * 100) / 100).toBe(model.total);
  });

  it('hides a $0 hidden line (stock-draw component)', () => {
    const zero = { description: 'Vial draw', qty: 1, amount: 0, hideOnInvoice: true };
    const model = visitInvoiceToEmailModel({ ...base, lines: [exam, booster, zero] }, 'C');
    expect(model.lines.map((l) => l.description)).toEqual(['Exam', 'DAPP booster']);
  });

  it('hides a hidden line that membership covered (amount 0)', () => {
    const covered = { ...booster, amount: 0, isCovered: true };
    const model = visitInvoiceToEmailModel({ ...base, lines: [exam, covered] }, 'C');
    expect(model.lines.map((l) => l.description)).toEqual(['Exam']);
  });

  it('shows the return of a hidden priced item (negative amount)', () => {
    const ret = { description: 'DAPP booster (return)', qty: 1, amount: -58.61, hideOnInvoice: true };
    const model = visitInvoiceToEmailModel({ ...base, lines: [exam, booster, ret] }, 'C');
    expect(model.lines.map((l) => l.description)).toContain('DAPP booster (return)');
  });

  it('still drops deleted lines even when charged', () => {
    const model = visitInvoiceToEmailModel(
      { ...base, lines: [exam, { ...booster, isDeleted: true }] },
      'C',
    );
    expect(model.lines.map((l) => l.description)).toEqual(['Exam']);
  });
});

describe('CAT-01-6 emailed estimate', () => {
  it('lists a hidden $12 line and omits a hidden $0 line', () => {
    const model = estimateEmailModel(
      {
        estimateNumber: 3,
        created: '2026-10-15T16:50:00.000Z',
        subtotal: 12,
        taxTotal: 0,
        total: 12,
        lines: [
          { description: 'Sedative', qty: 1, amount: 12, listUnitPrice: 12, hideOnInvoice: true },
          { description: 'Vial draw', qty: 1, amount: 0, listUnitPrice: 0, hideOnInvoice: true },
        ],
      },
      'Test Client',
    );
    expect(model.lines.map((l) => l.description)).toEqual(['Sedative']);
  });
});
