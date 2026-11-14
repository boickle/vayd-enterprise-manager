import { describe, expect, it } from 'vitest';
import { chartDocumentName } from './ChartPrintDocumentModal';

describe('chartDocumentName: what a printed document is called on the chart', () => {
  const draft = { rxName: 'Tramadol', rxStrength: '50 mg tablets', patientName: 'Maple' };

  it('leads a prescription with the medication and strength', () => {
    expect(chartDocumentName('rx', draft, 'Prescription print')).toBe(
      'Tramadol 50 mg tablets — Prescription print'
    );
  });

  it('uses the medication alone when there is no strength', () => {
    expect(chartDocumentName('rx', { ...draft, rxStrength: '  ' }, 'Prescription print')).toBe(
      'Tramadol — Prescription print'
    );
  });

  it('falls back to the pet name for a prescription with no medication typed', () => {
    expect(
      chartDocumentName('rx', { ...draft, rxName: '', rxStrength: '' }, 'Prescription print')
    ).toBe('Prescription print — Maple');
  });

  it('keeps "<title> — <pet>" for other documents', () => {
    expect(chartDocumentName('rabies', draft, 'Rabies certificate')).toBe(
      'Rabies certificate — Maple'
    );
    expect(
      chartDocumentName('health', { ...draft, patientName: '' }, 'Health certificate', 'Juniper')
    ).toBe('Health certificate — Juniper');
  });
});
