/** INV-A14: controlled drugs by doctor, with a flag for doses off another shelf, and a CSV. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import type { ControlledReport } from '../api/inventoryOps';
import InventoryControlledReportPage, { controlledReportCsv } from './InventoryControlledReportPage';

const report: ControlledReport = {
  fromDate: '2026-10-01',
  toDate: '2026-10-29',
  doctors: [
    {
      employeeId: 1,
      name: 'Dr. Avery',
      totals: [
        {
          inventoryItemId: 5,
          itemName: 'Buprenorphine',
          lotNumber: 'B-1',
          dispensedMl: 0.35,
          returnedMl: 0,
          wastedMl: 0.1,
          adjustedMl: 0,
          dispensedGrams: 0.42,
        },
      ],
      lines: [
        {
          movementId: 10,
          at: '2026-10-20T15:00:00Z',
          type: 'dispensed',
          inventoryItemId: 5,
          itemName: 'Buprenorphine',
          lotNumber: 'B-1',
          quantityMl: 0.35,
          grams: 0.42,
          shelfName: 'Truck 2',
          patientName: 'Biscuit, "Bis"',
          invoiceNumber: '1042',
          invoiceId: 'x',
          wasteReason: null,
          fromHomeShelf: false,
        },
        {
          movementId: 11,
          at: '2026-10-20T15:05:00Z',
          type: 'wasted',
          inventoryItemId: 5,
          itemName: 'Buprenorphine',
          lotNumber: 'B-1',
          quantityMl: 0.1,
          grams: null,
          shelfName: 'Truck 1',
          patientName: null,
          invoiceNumber: null,
          invoiceId: null,
          wasteReason: 'Drawn up, not given',
          fromHomeShelf: true,
        },
      ],
    },
  ],
};

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
vi.mock('../api/inventoryOps', () => ({ getControlledReport: vi.fn(async () => report) }));

describe('INV-A14: Controlled drugs report', () => {
  it('shows each doctor with totals in mL and g, and flags a dose off another shelf', async () => {
    render(<InventoryControlledReportPage />);
    const section = await screen.findByRole('region', { name: 'Dr. Avery' });
    expect(within(section).getByText('0.35 mL (0.42 g)')).toBeInTheDocument();
    expect(within(section).getByText('0.1 mL')).toBeInTheDocument();
    expect(within(section).getByText(/1 dose came off a shelf/)).toBeInTheDocument();

    fireEvent.click(within(section).getByRole('button', { name: /Show each dose \(2\)/ }));
    expect(within(section).getByText('Biscuit, "Bis"')).toBeInTheDocument();
    expect(within(section).getByText('1042')).toBeInTheDocument();
    expect(within(section).getByText("Not this doctor's shelf")).toBeInTheDocument();
    expect(within(section).getByText('Drawn up, not given')).toBeInTheDocument();
  });

  it('writes one CSV row per dose under the doctor, quoting commas and quotes', () => {
    const csv = controlledReportCsv(report).replace(/^﻿/, '');
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(
      'Doctor,Date,Type,Item,Lot #,mL,g,Patient,Invoice #,Shelf,Not from doctor’s shelf,Waste reason'
    );
    expect(rows[1]).toContain('Dr. Avery,');
    expect(rows[1]).toContain(',Dispensed,Buprenorphine,B-1,0.35,0.42,"Biscuit, ""Bis""",1042,Truck 2,Yes,');
    expect(rows[2]).toContain(',Wasted,Buprenorphine,B-1,0.1,,,,Truck 1,,Drawn up, not given'.replace('Drawn up, not given', '"Drawn up, not given"'));
  });
});
