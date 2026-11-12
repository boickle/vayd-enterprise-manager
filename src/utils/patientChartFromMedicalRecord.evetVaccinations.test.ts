import { describe, expect, it } from 'vitest';
import { buildChartRowsFromMedicalRecord } from './patientChartFromMedicalRecord';

/** An imported eVet dose as the medical record returns it: the vaccine is only on the treatment item. */
const evetDose = (i: number, name: string) => ({
  id: 9000 + i,
  vaccineName: null,
  lotNumber: `LOT-${i}`,
  tagNumber: i % 4 === 0 ? `TAG-${i}` : null,
  dateVaccinated: new Date(Date.UTC(2025, 11, 1) - i * 90 * 86400000).toISOString(),
  employee: { id: 12, firstName: 'Odile', lastName: 'Brackenridge' },
  pimsType: 'EVET',
  pimsId: `evet-vax-${i}`,
  treatmentItem: { id: 7000 + i, inventoryItem: { name } },
});

describe('EMR-A12-3: eVet vaccination history on the chart', () => {
  it('shows all 20 doses with the vaccine name, lot and vet, newest first', () => {
    const names = ['Rabies 3yr Vaccine', 'DA2PP Vaccine', 'Bordetella Vaccine', 'Leptospirosis Vaccine'];
    const doses = Array.from({ length: 20 }, (_, i) => evetDose(i, names[i % 4]));
    const rows = buildChartRowsFromMedicalRecord({ vaccinationLogs: doses } as never).filter(
      (r) => r.source === 'vaccination',
    );
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => names.includes(r.description))).toBe(true);
    expect(rows[0].description).toBe('Rabies 3yr Vaccine');
    expect(rows[0].detailText).toContain('Lot: LOT-0');
    expect(rows[0].detailText).toContain('Tag: TAG-0');
    expect(rows.every((r) => /Brackenridge/.test(r.provider ?? ''))).toBe(true);
    const times = rows.map((r) => r.sortTime);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  // The pet chart staff use builds its rows with emrOnly = true; vaccination rows were dropped there.
  it('the EMR chart (emrOnly) shows every imported dose too, newest first, with lot and vet', () => {
    const names = ['Rabies 3yr Vaccine', 'DA2PP Vaccine', 'Bordetella Vaccine', 'Leptospirosis Vaccine'];
    const doses = Array.from({ length: 20 }, (_, i) => evetDose(i, names[i % 4]));
    const rows = buildChartRowsFromMedicalRecord(
      { vaccinationLogs: doses } as never,
      [],
      [],
      [],
      true,
    ).filter((r) => r.id.startsWith('vaccination:'));
    expect(rows).toHaveLength(20);
    expect(rows[0].description).toBe('Rabies 3yr Vaccine');
    expect(rows[0].detailText).toContain('Lot: LOT-0');
    expect(rows.every((r) => /Brackenridge/.test(r.provider ?? ''))).toBe(true);
    const times = rows.map((r) => r.sortTime);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('the EMR chart shows a dose once: the eVet treatment line it was recorded on gives way to the dose row', () => {
    const dose = evetDose(0, 'Rabies 3yr Vaccine');
    const other = { id: 7100, serviceDate: dose.dateVaccinated, inventoryItem: { name: 'Exam' }, quantity: 1 };
    const treatments = [
      {
        id: 1,
        created: dose.dateVaccinated,
        treatmentItems: [
          { id: 7000, serviceDate: dose.dateVaccinated, inventoryItem: { name: 'Rabies 3yr Vaccine' }, quantity: 1 },
          other,
        ],
      },
    ];
    const rows = buildChartRowsFromMedicalRecord(
      { vaccinationLogs: [dose] } as never,
      [],
      [],
      treatments as never,
      true,
    );
    const rabies = rows.filter((r) => /Rabies/.test(r.description));
    expect(rabies.map((r) => r.id)).toEqual(['vaccination:9000']);
    expect(rows.some((r) => r.id === 'treatment:7100')).toBe(true);
  });

  it('a Scout dose (no pimsId) stays on its visit-charge row, not a second vaccination row', () => {
    const scout = { ...evetDose(1, 'DA2PP Vaccine'), pimsId: null, pimsType: null, encounterOrderId: 'o-1' };
    const rows = buildChartRowsFromMedicalRecord({ vaccinationLogs: [scout] } as never, [], [], [], true);
    expect(rows.filter((r) => r.source === 'vaccination')).toEqual([]);
  });
});
