import { describe, expect, it } from 'vitest';
import {
  COUNT_SHEET_HEADER,
  countTabCandidates,
  excelCellText,
  parseCsv,
  rowsFromTable,
} from './countSheetFile';

describe('count sheet file', () => {
  it('has no weight columns', () => {
    expect(COUNT_SHEET_HEADER.join(',')).not.toMatch(/weigh|bottle/i);
  });

  it('reads the Count sheet tab first and never the Directions tab', () => {
    expect(countTabCandidates(['Directions', 'Count sheet'])).toEqual(['Count sheet']);
    expect(countTabCandidates(['Directions', 'Sheet1'])).toEqual(['Sheet1']);
    expect(countTabCandidates(['Directions'])).toEqual([]);
  });

  it('reads "Lot #", not "Lot # required", and keeps one row per lot', () => {
    const header = [...COUNT_SHEET_HEADER];
    const { rows, error } = rowsFromTable([
      header,
      ['HC-KETAMINE', 'Ketamine', 'mL', 'Anesthesia', 'Yes', 'Yes', '8', 'A1234', '3/2027', ''],
      [
        'HC-KETAMINE',
        'Ketamine',
        'mL',
        'Anesthesia',
        'Yes',
        'Yes',
        '10',
        'B5678',
        '9/2027',
        'open',
      ],
      ['', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      code: 'HC-KETAMINE',
      quantity: '8',
      lotNumber: 'A1234',
      expirationDate: '3/2027',
    });
    expect(rows[1]).toMatchObject({
      quantity: '10',
      lotNumber: 'B5678',
      note: 'open',
      rowNumber: 3,
    });
  });

  it('still reads the older CSV with weight columns', () => {
    const csv =
      'Code,Item,Unit,Category,Controlled,Count,Weight,Weigh in,Bottles,Lot #,Expiration,Notes\r\n' +
      'AM-TELAZOL,Telazol,mL,Anesthesia,Yes,5,,,,L1,4/2027,\r\n';
    const { rows, error } = rowsFromTable(parseCsv(csv));
    expect(error).toBeNull();
    expect(rows[0]).toMatchObject({
      code: 'AM-TELAZOL',
      quantity: '5',
      weight: null,
      lotNumber: 'L1',
    });
  });

  it('turns Excel cells into text', () => {
    expect(excelCellText(new Date(Date.UTC(2027, 2, 31)))).toBe('2027-03-31');
    expect(excelCellText(24)).toBe('24');
    expect(excelCellText(null)).toBe('');
  });
});
