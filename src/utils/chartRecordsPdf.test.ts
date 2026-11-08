import { describe, expect, it } from 'vitest';
import { labReportBriefText, labReportFromInHouse, withoutHandlingSection } from './chartRecordsPdf';

const summary = `REMINDERS
Overdue:
- Rabies 3 yr — due 03/01/2026

HANDLING
HANDLING ALERT: YES
- Bit a technician 02/2025 during nail trim
- Gabapentin 100 mg 2 h before visits helped

PROBLEMS
- Chronic otitis — improving`;

describe('records sent outside the practice', () => {
  it('drop the HANDLING section and keep the rest', () => {
    const out = withoutHandlingSection(summary);
    expect(out).not.toMatch(/HANDLING|Bit a technician|Gabapentin/);
    expect(out).toContain('Rabies 3 yr');
    expect(out).toContain('PROBLEMS\n- Chronic otitis — improving');
  });

  it('handles markdown-style headings', () => {
    const out = withoutHandlingSection('## HANDLING\n- Muzzle needed\n\n## DIET\n- Wet food');
    expect(out).not.toContain('Muzzle');
    expect(out).toContain('## DIET');
  });

  it('drops a stray HANDLING ALERT line and leaves other notes alone', () => {
    expect(withoutHandlingSection('HANDLING ALERT: NO CONCERNS FOUND\nWeight stable')).toBe(
      'Weight stable'
    );
    expect(withoutHandlingSection('Ear recheck in 2 weeks')).toBe('Ear recheck in 2 weeks');
  });
});

import {
  chartRecordRows,
  detailBlocks,
  labReportFromIdexx,
  labRowFromLine,
  recordDetailText,
  recordProvider,
} from './chartRecordsPdf';
import type { ChartRow } from './patientChartFromMedicalRecord';
import type { IdexxResultDetail } from '../api/idexx';

const row = (over: Partial<ChartRow>): ChartRow => ({
  id: over.id ?? String(Math.random()),
  source: 'treatment',
  typeLabel: 'Inventory Item',
  description: '',
  provider: 'Deirdre Frey, V.M.D.',
  serviceDateIso: '2026-06-30',
  sortTime: Date.parse('2026-06-30'),
  detailText: '',
  ...over,
});

describe('what goes on a printed record', () => {
  it('leaves out eVet stock lines, billing lines and exact repeats', () => {
    const kept = chartRecordRows([
      row({ id: '1', description: 'Rabies Vaccine - 3 year' }),
      row({ id: '2', description: 'Rabies Inventory' }),
      row({ id: '3', description: 'Gabapentin 300 mg inventory' }),
      row({
        id: '4',
        typeLabel: 'Procedure',
        description: 'Staff Inventory Discount (Cost + 10%)',
      }),
      row({ id: '5', typeLabel: 'Procedure', description: 'PROFESSIONAL COURTESY' }),
      row({
        id: '6',
        source: 'exam',
        typeLabel: 'Exam Form',
        description: 'Exam - General',
        detailText: 'Weight: 42',
      }),
      row({
        id: '7',
        source: 'exam',
        typeLabel: 'Exam Form',
        description: 'Exam - General',
        detailText: 'Weight: 42',
      }),
    ]);
    expect(kept.map((r) => r.id)).toEqual(['1', '6']);
  });

  it('keeps notes that mention inventory', () => {
    const kept = chartRecordRows([
      row({
        id: '1',
        source: 'chartNote',
        typeLabel: 'Note',
        description: 'Checked inventory of meds at home',
      }),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('turns imported HTML into text and drops billing and system lines', () => {
    expect(recordDetailText('Clipped, cleaned.<br><br>Plan: <br>1. Rabies SQ RH')).toBe(
      'Clipped, cleaned.\n\nPlan:\n1. Rabies SQ RH'
    );
    expect(
      recordDetailText(
        '<html><head><meta name="viewport"></head><body><div style="x">hi greta.</div></body></html>'
      )
    ).toBe('hi greta.');
    expect(
      recordDetailText('1 bottle\nMembership covered\nNo directions on file\nPIMS: 8812')
    ).toBe('1 bottle');
  });

  it('hides billing accounts and placeholders as the provider', () => {
    expect(recordProvider('Hospital Account')).toBe('');
    expect(recordProvider('—')).toBe('');
    expect(recordProvider('Deirdre Frey, V.M.D.')).toBe('Deirdre Frey, V.M.D.');
  });
});

describe('lab results print as tables', () => {
  it('reads result lines and flags values outside the range', () => {
    expect(labRowFromLine('GLUCOSE 85 mg/dL (63 - 114)')).toEqual({
      test: 'GLUCOSE',
      result: '85',
      units: 'mg/dL',
      range: '63 - 114',
      flag: '',
    });
    expect(labRowFromLine('TCO2 (BICARBONATE) 21 mmol/L (13 - 27)')?.test).toBe(
      'TCO2 (BICARBONATE)'
    );
    expect(labRowFromLine('L Cortisol 0.5 (2.0 - 6.0) ug/dL')).toBeNull();
    expect(labRowFromLine('Cortisol 0.5 ug/dL (2.0 - 6.0)')?.flag).toBe('L');
    expect(labRowFromLine('BILIRUBIN CONJUGATED <0.1 mg/dL (0.0 - 0.1)')?.flag).toBe('');
  });

  it('makes a table from a run of results and leaves prose alone', () => {
    const blocks = detailBlocks(
      [
        'Accession 4605366864 · Final',
        '',
        'CHEM 25 w/ TRIG SDMA',
        'GLUCOSE 85 mg/dL (63 - 114)',
        'SDMA 14 ug/dL (0 - 14)',
        'SDMA and creatinine are within the reference interval.',
        'CREATININE 0.9 mg/dL (0.5 - 1.5)',
        'IDEXX CBC',
        'WBC 9.8 K/uL (4.9 - 17.6)',
        '',
        'NOTE FROM IDEXX',
        'A urine sample was not received.',
      ].join('\n')
    );
    expect(blocks[0]).toEqual({ kind: 'text', text: 'Accession 4605366864 · Final' });
    const lab = blocks.find((b) => b.kind === 'lab');
    expect(lab && lab.kind === 'lab' && lab.sections.map((s) => [s.name, s.rows.length])).toEqual([
      ['CHEM 25 w/ TRIG SDMA', 3],
      ['IDEXX CBC', 1],
    ]);
    expect(blocks[blocks.length - 1]).toEqual({
      kind: 'text',
      text: 'NOTE FROM IDEXX\nA urine sample was not received.',
    });
  });

  it('a weight line is not a lab table', () => {
    expect(detailBlocks('Weight: 42 1')).toEqual([{ kind: 'text', text: 'Weight: 42 1' }]);
  });

  it('builds IDEXX tables with H and L only', () => {
    const report = labReportFromIdexx({
      accessionId: '123',
      veterinarian: 'Deirdre Frey',
      specimenCollectionDate: '2026-10-28T12:00:00Z',
      notes: null,
      hasCritical: true,
      categories: [
        {
          name: 'Chemistry',
          code: null,
          notes: [],
          tests: [
            {
              name: 'ALT',
              result: '27',
              units: 'U/L',
              referenceRange: '18 - 121',
              outOfRange: false,
              outOfRangeCode: null,
              notes: [],
            },
            {
              name: 'Cortisol',
              result: '0.5',
              units: 'ug/dL',
              referenceRange: '2.0 - 6.0',
              outOfRange: true,
              outOfRangeCode: 'L',
              notes: [],
            },
            {
              name: 'Glucose',
              result: '400',
              units: 'mg/dL',
              referenceRange: '63 - 114',
              outOfRange: true,
              outOfRangeCode: 'HH',
              notes: [],
            },
          ],
        },
      ],
    } as unknown as IdexxResultDetail);
    expect(report.sections[0]!.rows.map((r) => r.flag)).toEqual(['', 'L', 'H']);
    expect(report.meta).toContain('Accession 123');
    expect(JSON.stringify(report)).not.toMatch(/critical/i);
  });
});

describe('in-house lab forms on a printed record', () => {
  const el = (o: Record<string, unknown>) =>
    ({ key: 'k', name: 'Test', valueType: 'number', min: null, max: null, units: null, ...o }) as never;
  const result = (o: Record<string, unknown> = {}) =>
    ({
      id: 1,
      patientId: 7,
      status: 'complete',
      templateName: 'CBC',
      templateMode: 'analytes',
      summary: null,
      resultedAt: '2026-10-20T15:00:00Z',
      serviceDate: '2026-10-20',
      resultedBy: { firstName: 'Abby', lastName: 'Messina' },
      elementsSnapshot: [
        el({ key: 'wbc', name: 'WBC', min: 5.5, max: 16.9, units: 'K/uL' }),
        el({ key: 'hct', name: 'HCT', min: 37, max: 55, units: '%' }),
        el({ key: 'hw', name: 'Heartworm', valueType: 'select', options: ['Negative', 'Positive'], abnormalOptions: ['Positive'] }),
        el({ key: 'blank', name: 'Blank row' }),
      ],
      values: {
        wbc: { value: '22.1', comments: null },
        hct: { value: '30', comments: 'mild hemolysis' },
        hw: { value: 'Positive', comments: null },
      },
      ...o,
    }) as never;

  it('prints each value with its range and flags high, low and abnormal', () => {
    const report = labReportFromInHouse([result()]);
    expect(report.meta).toContain('Resulted by Abby Messina');
    const [sec] = report.sections;
    expect(sec.name).toBe('CBC');
    expect(sec.rows).toEqual([
      { test: 'WBC', result: '22.1', units: 'K/uL', range: '5.5 - 16.9', flag: 'H' },
      { test: 'HCT', result: '30', units: '%', range: '37 - 55', flag: 'L' },
      { test: 'Heartworm', result: 'Positive', units: '', range: 'Negative', flag: 'A' },
    ]);
    expect(sec.notes).toContain('HCT: mild hemolysis');
  });

  it('prints a write-up form as text and marks a pending form', () => {
    const report = labReportFromInHouse([
      result({ templateMode: 'summary', elementsSnapshot: [], values: {}, summary: '<p>Cytology: cocci 3+</p>' }),
      result({ status: 'pending', templateName: 'UA', elementsSnapshot: [], values: {} }),
    ]);
    expect(report.sections[0].notes.join(' ')).toContain('Cytology: cocci 3+');
    expect(report.sections[1].notes).toContain('Results pending.');
  });

  it('gives the AI summaries a short line per panel', () => {
    const text = labReportBriefText(labReportFromInHouse([result()]));
    expect(text).toContain('CBC: WBC 22.1 K/uL [5.5 - 16.9] H; HCT 30 % [37 - 55] L; Heartworm Positive [Negative] A.');
    expect(text).toContain('CBC note: HCT: mild hemolysis');
  });

  it('lists only out-of-range values from a long panel', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      test: `T${i}`, result: '1', units: '', range: '0 - 2', flag: i === 3 ? 'H' : '',
    }));
    const text = labReportBriefText({ meta: '', notes: [], sections: [{ name: 'Chem', rows: rows as never, notes: [] }] });
    expect(text).toBe('Chem: out of range: T3 1 [0 - 2] H; other 9 values within range.');
  });
});

describe('LAB-06-3 printed range comes from the result snapshot', () => {
  it('prints the range the result was taken with, not the form as it is now', () => {
    // The builder only receives the saved result; the live form is never passed in, so the
    // range printed here is whatever the snapshot stored. A later form edit cannot change it.
    const snapshotRow = {
      key: 'glu', name: 'Blood glucose', valueType: 'number', min: 0, max: 500, units: 'mg/dl',
    };
    const report = labReportFromInHouse([
      {
        id: 9,
        patientId: 7,
        status: 'complete',
        templateName: 'Glucose',
        templateMode: 'analytes',
        summary: null,
        resultedAt: '2026-11-01T15:00:00Z',
        serviceDate: '2026-11-01',
        elementsSnapshot: [snapshotRow],
        values: { glu: { value: '550', comments: null } },
      } as never,
    ]);
    expect(report.sections[0].rows).toEqual([
      { test: 'Blood glucose', result: '550', units: 'mg/dl', range: '0 - 500', flag: 'H' },
    ]);
  });

  it('prints no range for a row whose snapshot has no min or max', () => {
    const report = labReportFromInHouse([
      {
        id: 10,
        patientId: 7,
        status: 'complete',
        templateName: 'Glucose',
        templateMode: 'analytes',
        summary: null,
        resultedAt: '2026-11-01T15:00:00Z',
        serviceDate: '2026-11-01',
        elementsSnapshot: [{ key: 'glu', name: 'Blood glucose', valueType: 'number', min: null, max: null, units: 'mg/dl' }],
        values: { glu: { value: '450', comments: null } },
      } as never,
    ]);
    expect(report.sections[0].rows[0]).toMatchObject({ range: '', flag: '' });
  });
});
