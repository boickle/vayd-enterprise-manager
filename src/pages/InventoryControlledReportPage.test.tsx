/** INV-A14: controlled drugs by doctor, with a flag for doses off another shelf, and a CSV. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import type { ControlledReport, VetSnapPatientExport } from '../api/inventoryOps';
import InventoryControlledReportPage, {
  controlledLogPrintHtml,
  controlledReportCsv,
  typeLabel,
  vetSnapPatientsCsv,
  wasteDetail,
} from './InventoryControlledReportPage';

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
          patientId: 18442,
          patientName: 'Biscuit, "Bis"',
          clientId: 10671,
          clientName: 'Ashley Simmons',
          loggedByName: 'Hailey Lloyd',
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
          patientId: null,
          patientName: null,
          clientId: null,
          clientName: null,
          loggedByName: 'Dr. Avery',
          invoiceNumber: null,
          invoiceId: null,
          wasteReason: 'Drawn up, not given',
          fromHomeShelf: true,
        },
      ],
    },
  ],
};

const scopes = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
const api = vi.hoisted(() => ({
  report: null as unknown as ControlledReport,
  setControlledReconciled: vi.fn(async () => ({ updated: 1 })),
}));
vi.mock('../api/inventoryOps', () => ({
  getControlledReport: vi.fn(async () => api.report),
  getVetSnapPatientExport: vi.fn(),
  setControlledReconciled: (...a: unknown[]) => api.setControlledReconciled(...(a as [])),
}));
vi.mock('../api/employee', () => ({
  fetchVeterinarians: vi.fn(async () => ({
    providers: [
      { id: 1, name: 'Dr. Avery' },
      { id: 7, name: 'Dr. Carter' },
    ],
    clientZoneLabel: null,
  })),
}));
vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({ scopeOf: (key: string) => scopes.value[key] ?? 'none' }),
}));

describe('INV-A14: Controlled drugs report', () => {
  beforeEach(() => {
    api.report = report;
    api.setControlledReconciled.mockClear();
    scopes.value = {
      'inventory.controlled_report.view': 'all',
      'controlled.vetsnap_export': 'all',
    };
  });

  it('shows each doctor with totals, and the log laid out like Vet Snap (owner request, Oct 30, 2026)', async () => {
    render(<InventoryControlledReportPage />);
    const section = await screen.findByRole('region', { name: 'Dr. Avery' });
    expect(within(section).getByText('0.35 mL (0.42 g)')).toBeInTheDocument();
    expect(within(section).getByText(/1 dose came off a shelf/)).toBeInTheDocument();

    // Vet Snap's fields, in its order and wording, on each entry.
    expect(within(section).getByRole('tab', { name: 'To reconcile (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(within(section).getByText('0.35 ml - #B-1')).toBeInTheDocument();
    expect(within(section).getByText('0 ml - #B-1')).toBeInTheDocument(); // a waste entry: 0 quantity…
    expect(within(section).getByText('0.1 ml')).toBeInTheDocument(); // …and the amount under Waste
    expect(within(section).getByText('Biscuit, "Bis" (18442)')).toBeInTheDocument();
    expect(within(section).getByText('Ashley Simmons (10671)')).toBeInTheDocument();
    expect(within(section).getAllByText('Log Created By')).toHaveLength(2);
    expect(within(section).getByText('Hailey Lloyd')).toBeInTheDocument();
    expect(within(section).getByText(/Not this doctor's shelf/)).toBeInTheDocument();
    expect(within(section).getByText('Drawn up, not given')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vet Snap patients (last 14 days)' })).toBeInTheDocument();
  });

  it('marks an entry reconciled, one at a time or all selected', async () => {
    render(<InventoryControlledReportPage />);
    const section = await screen.findByRole('region', { name: 'Dr. Avery' });
    fireEvent.click(within(section).getAllByRole('button', { name: 'Reconciled' })[0]);
    await waitFor(() => expect(api.setControlledReconciled).toHaveBeenCalledWith(1, [10], true));

    fireEvent.click(within(section).getByLabelText(/Select all to reconcile/));
    fireEvent.click(within(section).getByRole('button', { name: 'Mark 2 reconciled' }));
    await waitFor(() => expect(api.setControlledReconciled).toHaveBeenLastCalledWith(1, [10, 11], true));
  });

  it('a reconciled entry moves to its tab, says who and when, and can be undone', async () => {
    api.report = {
      ...report,
      doctors: [
        {
          ...report.doctors[0],
          lines: report.doctors[0].lines.map((l, i) =>
            i === 0 ? { ...l, reconciledAt: '2026-10-30T18:00:00Z', reconciledByName: 'Deirdre Frey' } : l
          ),
        },
      ],
    };
    render(<InventoryControlledReportPage />);
    const section = await screen.findByRole('region', { name: 'Dr. Avery' });
    expect(within(section).getByRole('tab', { name: 'To reconcile (1)' })).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('tab', { name: 'Reconciled (1)' }));
    expect(within(section).getByText(/Reconciled by Deirdre Frey/)).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.setControlledReconciled).toHaveBeenCalledWith(1, [10], false));
  });

  it('labels a dose given at the visit "Administered" and a medication sent home "Dispensed"', () => {
    expect(typeLabel({ type: 'dispensed', isMedication: false })).toBe('Administered');
    expect(typeLabel({ type: 'dispensed', isMedication: true })).toBe('Dispensed');
    expect(typeLabel({ type: 'wasted', isMedication: true })).toBe('Wasted');
  });

  it('shows the doctor filter even with one doctor in range, listing every veterinarian', async () => {
    render(<InventoryControlledReportPage />);
    await screen.findByRole('region', { name: 'Dr. Avery' });
    const select = screen.getByLabelText('Doctor');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Dr. Carter' })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: '7' } });
    expect(screen.queryByRole('region', { name: 'Dr. Avery' })).toBeNull();
    expect(screen.getByText(/No controlled drugs under Dr. Carter in this range/)).toBeInTheDocument();
  });

  it('hides the doctor filter from a doctor who only sees their own', async () => {
    scopes.value = { 'inventory.controlled_report.view': 'own', 'controlled.vetsnap_export': 'own' };
    render(<InventoryControlledReportPage />);
    await screen.findByRole('region', { name: 'Dr. Avery' });
    expect(screen.queryByLabelText('Doctor')).toBeNull();
  });

  it('lets someone who sees every doctor pick one doctor', async () => {
    api.report = {
      ...report,
      doctors: [...report.doctors, { ...report.doctors[0], employeeId: 2, name: 'Dr. Brooks' }],
    };
    render(<InventoryControlledReportPage />);
    await screen.findByRole('region', { name: 'Dr. Brooks' });
    fireEvent.change(screen.getByLabelText('Doctor'), { target: { value: '2' } });
    expect(screen.queryByRole('region', { name: 'Dr. Avery' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Dr. Brooks' })).toBeInTheDocument();
  });

  it("doesn't flag doses for a doctor with no home shelf, and says how to set one", async () => {
    api.report = {
      ...report,
      doctors: [
        {
          ...report.doctors[0],
          hasHomeShelf: false,
          lines: report.doctors[0].lines.map((l) => ({ ...l, fromHomeShelf: true })),
        },
      ],
    };
    render(<InventoryControlledReportPage />);
    const section = await screen.findByRole('region', { name: 'Dr. Avery' });
    expect(within(section).getByText(/No home shelf is set for Dr. Avery/)).toBeInTheDocument();
    expect(within(section).queryByText(/came off a shelf/)).toBeNull();
  });

  it('tells a doctor with own-only access that the report is their doses', async () => {
    scopes.value = {
      'inventory.controlled_report.view': 'own',
      'controlled.vetsnap_export': 'own',
    };
    render(<InventoryControlledReportPage />);
    await screen.findByRole('region', { name: 'Dr. Avery' });
    expect(screen.getByText(/You are seeing the doses recorded under you/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vet Snap patients (last 14 days)' })).toHaveAttribute(
      'title',
      'Your patients given a controlled drug in the last 14 days'
    );
  });

  it('hides the Vet Snap download without that permission', async () => {
    scopes.value = { 'inventory.controlled_report.view': 'all' };
    render(<InventoryControlledReportPage />);
    await screen.findByRole('region', { name: 'Dr. Avery' });
    expect(screen.queryByRole('button', { name: /Vet Snap patients/ })).not.toBeInTheDocument();
  });

  it('writes one CSV row per dose under the doctor, quoting commas and quotes', () => {
    const csv = controlledReportCsv(report).replace(/^﻿/, '');
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(
      'Doctor,Date,Type,Item,Lot #,mL,g,Patient,Patient ID,Client,Client ID,Log created by,Invoice #,Shelf,Not from doctor’s shelf,Waste reason,Disposal,Explanation'
    );
    expect(rows[1]).toContain('Dr. Avery,');
    expect(rows[1]).toContain(
      ',Administered,Buprenorphine,B-1,0.35,0.42,"Biscuit, ""Bis""",18442,Ashley Simmons,10671,Hailey Lloyd,1042,Truck 2,Yes,'
    );
    expect(rows[2]).toContain(',Wasted,Buprenorphine,B-1,0.1,,,,,,Dr. Avery,,Truck 1,,"Drawn up, not given",,');
  });

  it('shows the disposal method and the written explanation on waste (owner decision, Oct 30, 2026)', () => {
    const line = {
      ...report.doctors[0].lines[1],
      wasteReason: 'expired',
      wasteDisposal: 'other',
      wasteExplanation: 'Taken by DEA-registered courier',
    };
    expect(wasteDetail(line)).toBe('expired · Other disposal · “Taken by DEA-registered courier”');
    expect(wasteDetail({ ...line, wasteDisposal: 'reverse_distribution', wasteExplanation: null })).toBe(
      'expired · Reverse distribution'
    );
    const csv = controlledReportCsv({
      ...report,
      doctors: [{ ...report.doctors[0], lines: [line] }],
    });
    expect(csv).toContain(',expired,Other disposal,Taken by DEA-registered courier');
  });

  it('prints one Vet Snap-style card per entry', () => {
    const html = controlledLogPrintHtml(report);
    expect(html.match(/class="card"/g)).toHaveLength(2);
    expect(html).toContain('0.35 mL (0.42 g) - #B-1');
    expect(html).toContain('Biscuit, &quot;Bis&quot; (18442)');
    expect(html).toContain('Ashley Simmons (10671)');
    expect(html).toContain('Log Created By');
    expect(html).toContain('Hailey Lloyd');
  });
});

describe('Vet Snap patient CSV', () => {
  it('writes the 12 Vet Snap columns in order with Scout IDs', () => {
    const data: VetSnapPatientExport = {
      fromDate: '2026-10-23',
      toDate: '2026-10-29',
      rows: [
        {
          patientId: 18442,
          patientName: 'Tucker',
          species: 'Canine',
          breed: 'Labrador, Mix',
          clientId: 10671,
          clientFirstName: 'Ashley',
          clientLastName: 'Simmons',
          clientAddress1: '1 Main St',
          clientAddress2: '',
          clientCity: 'Portland',
          clientState: 'ME',
          clientZipCode: '04101',
        },
      ],
    };
    const rows = vetSnapPatientsCsv(data).trim().split('\r\n');
    expect(rows[0]).toBe(
      'Patient ID,Patient Name,Species,Breed,Client ID,Client First Name,Client Last Name,Client Address 1,Client Address 2,Client City,Client State,Client Zip Code'
    );
    expect(rows[1]).toBe('18442,Tucker,Canine,"Labrador, Mix",10671,Ashley,Simmons,1 Main St,,Portland,ME,04101');
  });
});
