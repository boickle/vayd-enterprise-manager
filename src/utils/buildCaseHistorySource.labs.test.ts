import { describe, expect, it } from 'vitest';
import { buildCaseHistorySource } from './buildCaseHistorySource';
import { buildHouseholdSourceText } from './buildHouseholdSource';

const lab = { ref: 'idexx-12', date: '2026-10-20', label: 'IDEXX result: Chem 17', text: 'Chem: out of range: ALT 250 U/L [10 - 125] H.' };

describe('AI summary sources include labs and outside-record PDFs', () => {
  it('case summary lists Scout labs with a citation and previous-record PDF text', () => {
    const src = buildCaseHistorySource({
      patientId: '7',
      patientName: 'Max',
      problems: [],
      meds: [],
      encounters: [],
      medicalRecord: null,
      asOfDate: '2026-11-01',
      labs: [lab],
      pdfExcerpts: [{ name: 'Old clinic records', date: '2024-05-01', text: 'TPLO right stifle 2023. Allergic to cefa drugs.' }],
    });
    expect(src.text).toContain('Lab results in Scout');
    expect(src.text).toContain('[ref:idexx-12] 2026-10-20 IDEXX result: Chem 17');
    expect(src.text).toContain('ALT 250 U/L');
    expect(src.text).toContain('TPLO right stifle 2023');
    expect(src.citations.map((c) => c.ref)).toContain('idexx-12');
  });

  it('household summary lists each pet\'s Scout labs and imported eVet labs', () => {
    const text = buildHouseholdSourceText({
      clientName: 'Ada',
      clientId: 3,
      balance: 0,
      invoices: [],
      pets: [
        {
          id: '7',
          name: 'Max',
          active: true,
          summaryLine: 'Max · dog',
          alerts: null,
          problems: [],
          prescriptions: [],
          labs: [lab],
          medicalRecord: {
            labOrders: [
              { order: { id: 5, labOrderType: 'Fecal', submittedDate: '2025-03-02' }, result: { reportDate: '2025-03-03', comments: 'Giardia positive' } },
            ],
          },
        } as never,
      ],
    } as never);
    expect(text).toContain('Lab results (newest first):');
    expect(text).toContain('IDEXX result: Chem 17');
    expect(text).toContain('Giardia positive');
  });
});
