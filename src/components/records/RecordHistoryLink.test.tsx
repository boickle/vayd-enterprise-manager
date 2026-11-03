/**
 * EMR-07b (owner decision Nov 3, 2026): a staff-only "History" link on a prescription lists every
 * logged step: directions entered or changed (who, for which vet, old → new), approved for
 * dispensing, label printed. Generic on record type + id so vaccine doses (EMR-A2) can reuse it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordHistoryLink, { historyTime } from './RecordHistoryLink';

const getRecordHistory = vi.fn();
vi.mock('../../api/recordHistory', () => ({
  getRecordHistory: (...args: unknown[]) => getRecordHistory(...args),
}));

let effective: { employeeId: number | null; isPlatformAdmin: boolean } | null = null;
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({ effective }),
}));

const AT = '2026-11-03T15:42:00.000Z';
const ENTRIES = [
  {
    id: 'e1',
    at: AT,
    kind: 'directions_entered',
    actorName: 'Sam Fernsby',
    actorRole: 'tech',
    forName: 'Dr. Odile Oakhollow',
    rxNumber: 12345,
    before: null,
    after: { instructions: '1 tab PO q12h', qty: 30, refill: 2, refillExpiration: null },
    text: "Directions entered by Sam Fernsby (tech) for Dr. Odile Oakhollow: '1 tab PO q12h', qty 30, 2 refills",
  },
  {
    id: 'e2',
    at: AT,
    kind: 'directions_changed',
    actorName: 'Odile Oakhollow',
    actorRole: 'vet',
    forName: 'Dr. Odile Oakhollow',
    rxNumber: 12345,
    before: { instructions: '1 tab PO q12h', qty: 30, refill: 2, refillExpiration: null },
    after: { instructions: '1 tab PO q8h', qty: 30, refill: 2, refillExpiration: null },
    text: "Directions changed by Odile Oakhollow (vet) for Dr. Odile Oakhollow: '1 tab PO q12h', qty 30, 2 refills → '1 tab PO q8h', qty 30, 2 refills",
  },
  {
    id: 'e3',
    at: AT,
    kind: 'approved_for_dispensing',
    actorName: 'Sam Fernsby',
    actorRole: 'tech',
    forName: 'Dr. Odile Oakhollow',
    rxNumber: 12345,
    before: null,
    after: null,
    text: 'Approved for dispensing by Sam Fernsby (tech), Rx #12345',
  },
  {
    id: 'e4',
    at: AT,
    kind: 'label_printed',
    actorName: 'Sam Fernsby',
    actorRole: 'tech',
    forName: 'Dr. Odile Oakhollow',
    rxNumber: 12345,
    before: null,
    after: null,
    text: 'Label printed by Sam Fernsby (tech), Rx #12345',
  },
];

beforeEach(() => {
  getRecordHistory.mockReset();
  effective = { employeeId: 7, isPlatformAdmin: false };
});

describe('EMR-07b: RecordHistoryLink', () => {
  it('lists every step, oldest first, with the time and the line the API wrote', async () => {
    getRecordHistory.mockResolvedValue(ENTRIES);
    render(<RecordHistoryLink entityType="prescription" entityId={41} />);
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(getRecordHistory).toHaveBeenCalledWith('prescription', 41);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent(
      `${historyTime(AT)} — Directions entered by Sam Fernsby (tech) for Dr. Odile Oakhollow: '1 tab PO q12h', qty 30, 2 refills`
    );
    expect(items[1]).toHaveTextContent("'1 tab PO q12h', qty 30, 2 refills → '1 tab PO q8h'");
    expect(items[2]).toHaveTextContent('Approved for dispensing by Sam Fernsby (tech), Rx #12345');
    expect(items[3]).toHaveTextContent('Label printed by Sam Fernsby (tech), Rx #12345');
  });

  it('is generic: any record type and id goes to the API as given (SOAP order, invoice line)', async () => {
    getRecordHistory.mockResolvedValue([]);
    const { rerender } = render(
      <RecordHistoryLink entityType="encounter_order" entityId="ord-1" />
    );
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(getRecordHistory).toHaveBeenLastCalledWith('encounter_order', 'ord-1');
    expect(await screen.findByText('Nothing logged yet.')).toBeInTheDocument();
    rerender(<RecordHistoryLink entityType="invoice_line" entityId="line-9" label="Rx history" />);
    fireEvent.click(screen.getByRole('button', { name: /Rx history/ })); // close
    fireEvent.click(screen.getByRole('button', { name: /Rx history/ })); // reopen
    await waitFor(() =>
      expect(getRecordHistory).toHaveBeenLastCalledWith('invoice_line', 'line-9')
    );
  });

  it('toggles closed on a second click', async () => {
    getRecordHistory.mockResolvedValue(ENTRIES);
    render(<RecordHistoryLink entityType="prescription" entityId={41} />);
    const button = screen.getByRole('button', { name: /History/ });
    fireEvent.click(button);
    await screen.findAllByRole('listitem');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(screen.queryByRole('region', { name: 'Record history' })).toBeNull();
  });

  it('shows the error when the history cannot load', async () => {
    getRecordHistory.mockRejectedValue(new Error('Staff only'));
    render(<RecordHistoryLink entityType="prescription" entityId={41} />);
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(await screen.findByText('Staff only')).toBeInTheDocument();
  });

  it('renders nothing for a client login or before permissions load (staff only)', () => {
    effective = { employeeId: null, isPlatformAdmin: false };
    const { container, rerender } = render(
      <RecordHistoryLink entityType="prescription" entityId={41} />
    );
    expect(container).toBeEmptyDOMElement();
    effective = null;
    rerender(<RecordHistoryLink entityType="prescription" entityId={41} />);
    expect(container).toBeEmptyDOMElement();
    expect(getRecordHistory).not.toHaveBeenCalled();
  });

  it('renders nothing without a record id', () => {
    const { container } = render(<RecordHistoryLink entityType="prescription" entityId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
