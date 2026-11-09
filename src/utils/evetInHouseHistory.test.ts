import { describe, expect, it } from 'vitest';
import type { EvetLabHistoryResult } from '../api/evetLabHistory';
import { labReportFromEvetInHouse } from './chartRecordsPdf';
import { chartRowsFromEvetInHouse } from './patientChartFromMedicalRecord';

const result: EvetLabHistoryResult = {
  id: 7,
  date: '2026-05-01T15:00:00.000Z',
  formPimsId: '6809',
  formName: '4Dx (sample)',
  summary: null,
  values: [
    { elementPimsId: '15879', name: 'Control', units: null, value: 'NEGATIVE', comments: null, mapped: true },
    { elementPimsId: '15880', name: 'Anaplasma', units: null, value: 'POSITIVE', comments: 'faint line', mapped: true },
    { elementPimsId: '55555', name: 'Unnamed eVet field 55555', units: 'mg/dL', value: '12.5', comments: null, mapped: false },
  ],
};

describe('LAB-10-5: eVet in-house history on the chart and in records', () => {
  it('becomes one read-only chart row that keeps every value', () => {
    const [row] = chartRowsFromEvetInHouse([result]);
    expect(row.source).toBe('evetInHouseLab');
    expect(row.description).toBe('4Dx (sample)');
    expect(row.serviceDateIso).toBe(result.date);
    expect(row.detailText).toContain('Anaplasma: POSITIVE (faint line)');
    expect(row.detailText).toContain('Unnamed eVet field 55555: 12.5 mg/dL');
    expect(row.detailText).toContain('Control: NEGATIVE');
    expect(chartRowsFromEvetInHouse(null)).toEqual([]);
  });

  it('prints as a lab table in the records PDF', () => {
    const lab = labReportFromEvetInHouse(result);
    expect(lab.meta).toContain('Imported from eVet');
    expect(lab.sections).toHaveLength(1);
    expect(lab.sections[0].name).toBe('4Dx (sample)');
    expect(lab.sections[0].rows.map((r) => [r.test, r.result, r.units])).toEqual([
      ['Control', 'NEGATIVE', ''],
      ['Anaplasma', 'POSITIVE', ''],
      ['Unnamed eVet field 55555', '12.5', 'mg/dL'],
    ]);
    expect(lab.notes).toContain('Anaplasma: faint line');
  });
});
