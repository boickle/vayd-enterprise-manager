import { describe, expect, it } from 'vitest';
import { depositRowInfo, depositStatusText } from './ClientFinancialWorkspace';
import type { VisitInvoice } from '../../api/visitWorkflow';

const bill = (over: Partial<VisitInvoice>): VisitInvoice =>
  ({ id: 'd1', total: 0, amountPaid: 0, depositForAppointmentId: 9, depositAmount: 100, tenders: [], ...over }) as VisitInvoice;

describe('PAY-A19: deposit bill in the ledger', () => {
  it('is not a deposit row for an ordinary bill', () => {
    expect(depositRowInfo(bill({ depositForAppointmentId: null }))).toBeNull();
  });

  it('asked, not paid', () => {
    const d = depositRowInfo(bill({}))!;
    expect(d).toEqual({ asked: 100, paid: 0, creditLeft: 0 });
    expect(depositStatusText(d)).toBe('Not paid');
  });

  it('paid and still on the account as credit', () => {
    const d = depositRowInfo(
      bill({ amountPaid: 100, tenders: [{ id: 't', method: 'card', amount: 100 } as never] }),
    )!;
    expect(d).toEqual({ asked: 100, paid: 100, creditLeft: 100 });
    expect(depositStatusText(d)).toBe('Paid');
  });

  it('paid, then used at checkout (spending lowers amount paid)', () => {
    const d = depositRowInfo(
      bill({ amountPaid: 0, tenders: [{ id: 't', method: 'card', amount: 100 } as never] }),
    )!;
    expect(d).toEqual({ asked: 100, paid: 100, creditLeft: 0 });
  });

  it('part paid; a voided payment does not count', () => {
    const d = depositRowInfo(
      bill({
        amountPaid: 40,
        tenders: [
          { id: 'a', method: 'cash', amount: 40 } as never,
          { id: 'b', method: 'card', amount: 60, voidedAt: '2026-11-13' } as never,
        ],
      }),
    )!;
    expect(depositStatusText(d)).toBe('Part paid');
    expect(d.creditLeft).toBe(40);
  });
});
