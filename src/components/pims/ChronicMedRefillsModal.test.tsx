/**
 * Owner (Nov 10, 2026): chronic meds on the SOAP and the top of the EMR show their refills, and a small window
 * changes them (more: a licensed vet only) and links a free-text med to a catalog item for portal reorders.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ keys: new Set<string>() }));
const api = vi.hoisted(() => ({ update: vi.fn(), search: vi.fn() }));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: (key: string) => state.keys.has(key),
  usePermissions: () => ({ effective: {}, can: (key: string) => state.keys.has(key) }),
}));
vi.mock('../../api/visitWorkflow', () => ({ updatePatientPrescription: api.update }));
vi.mock('../../api/roomLoader', () => ({ searchItems: api.search }));

import ChronicMedRefillsModal, { chronicRefillLabel } from './ChronicMedRefillsModal';
import type { PatientPrescription } from '../../api/visitWorkflow';

const rx = (over: Partial<PatientPrescription> = {}): PatientPrescription => ({
  id: 41,
  name: 'Joint chews',
  strength: null,
  instructions: null,
  refill: 0,
  refillExpiration: null,
  startDate: null,
  acuity: 'chronic' as PatientPrescription['acuity'],
  discontinuedAt: null,
  inventoryItemId: null,
  encounterOrderId: null,
  patientId: 9,
  rxNumber: 100,
  ...over,
});

beforeEach(() => {
  state.keys = new Set();
  api.update.mockReset();
  api.search.mockReset();
});

describe('chronicRefillLabel', () => {
  it('counts refills left', () => {
    expect(chronicRefillLabel({ refill: 3, refillExpiration: null })).toBe('3 refills left');
    expect(chronicRefillLabel({ refill: 1, refillExpiration: null })).toBe('1 refill left');
  });
  it('says No refills for none and for unknown', () => {
    expect(chronicRefillLabel({ refill: 0, refillExpiration: null })).toBe('No refills');
    expect(chronicRefillLabel({ refill: null, refillExpiration: null })).toBe('No refills');
  });
  it('says Refills expired when the date has passed', () => {
    expect(chronicRefillLabel({ refill: 2, refillExpiration: '2026-01-01' }, Date.parse('2026-11-10'))).toBe('Refills expired');
  });
});

describe('ChronicMedRefillsModal', () => {
  it('a vet adds refills from the window', async () => {
    state.keys = new Set(['rx.sig.draft', 'rx.sig.enter']);
    api.update.mockResolvedValue({ refill: 5 });
    const onChanged = vi.fn();
    render(<ChronicMedRefillsModal rx={rx()} practiceId={1} patientId={9} onClose={() => {}} onChanged={onChanged} />);
    expect(screen.getByTestId('chronic-rx-refills').textContent).toContain('No refills');
    fireEvent.change(screen.getByLabelText('Refills left'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save refills' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ refill: 5 }));
    expect(api.update).toHaveBeenCalledWith(41, { refill: 5, patientId: 9 });
  });

  it('a technician cannot add refills', () => {
    state.keys = new Set(['rx.sig.draft']);
    render(<ChronicMedRefillsModal rx={rx({ refill: 1 })} practiceId={1} patientId={9} onClose={() => {}} onChanged={() => {}} />);
    fireEvent.change(screen.getByLabelText('Refills left'), { target: { value: '4' } });
    expect((screen.getByRole('button', { name: 'Save refills' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Only a licensed veterinarian can add refills.')).toBeTruthy();
  });

  it('links a free-text med to an inventory item', async () => {
    state.keys = new Set(['rx.sig.draft']);
    api.search.mockResolvedValue([{ itemType: 'inventory', name: 'Joint support chews (60 ct)', inventoryItem: { id: 812 } }]);
    api.update.mockResolvedValue({ inventoryItemId: 812 });
    const onChanged = vi.fn();
    render(<ChronicMedRefillsModal rx={rx()} practiceId={1} patientId={9} onClose={() => {}} onChanged={onChanged} />);
    expect(screen.getByTestId('chronic-rx-unlinked')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search inventory to link…'), { target: { value: 'joint' } });
    fireEvent.click(await screen.findByRole('button', { name: /Joint support chews \(60 ct\)/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ inventoryItemId: 812 }));
    expect(api.update).toHaveBeenCalledWith(41, { inventoryItemId: 812, patientId: 9 });
    expect(screen.getByTestId('chronic-rx-linked')).toBeTruthy();
  });

  it('a linked med offers no search', () => {
    state.keys = new Set(['rx.sig.draft']);
    render(<ChronicMedRefillsModal rx={rx({ inventoryItemId: 5 })} practiceId={1} patientId={9} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByTestId('chronic-rx-linked')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Search inventory to link…')).toBeNull();
  });
});

describe('PRN (owner, Nov 11, 2026)', () => {
  it('labels an item that needs no prescription PRN', () => {
    expect(chronicRefillLabel({ refill: 0, refillExpiration: null, prn: true })).toBe('PRN');
  });
  it('the window shows PRN and no refill controls', () => {
    state.keys = new Set(['rx.sig.draft', 'rx.sig.enter']);
    render(<ChronicMedRefillsModal rx={rx({ prn: true, inventoryItemId: 5 })} practiceId={1} patientId={9} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByTestId('chronic-rx-refills').textContent).toContain('PRN');
    expect(screen.queryByLabelText('Refills left')).toBeNull();
  });
});
