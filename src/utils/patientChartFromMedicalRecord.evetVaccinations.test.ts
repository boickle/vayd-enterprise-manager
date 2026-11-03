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
  treatmentItem: { inventoryItem: { name } },
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
});
