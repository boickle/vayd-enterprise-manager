/**
 * Wave 9B bug 4: an estimate prices a catalog item the way the invoice does. The search hit's
 * `price` is the full price (the member price is in `adjustedPrice` and in check-item-pricing),
 * so the estimate must not quote the full price for a member pet.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EstimateWorkspace from './EstimateWorkspace';
import { addEstimateLine } from '../../api/visitEstimates';
import { checkItemPricing, searchItems } from '../../api/roomLoader';

vi.mock('../../permissions/PermissionContext', () => ({ useCan: () => false }));
vi.mock('../ClientEmailComposeModal', () => ({ ClientEmailComposeModal: () => null }));
vi.mock('../../api/roomLoader', () => ({
  checkItemPricing: vi.fn(),
  searchItems: vi.fn(),
}));
vi.mock('../../api/visitEstimates', async (orig) => ({
  ...(await orig<typeof import('../../api/visitEstimates')>()),
  addEstimateLine: vi.fn(),
  updateEstimateLine: vi.fn(),
  removeEstimateLine: vi.fn(),
}));
vi.mock('../../api/memberships', async (orig) => ({
  ...(await orig<typeof import('../../api/memberships')>()),
  listBundles: vi.fn(async () => []),
}));

const estimate = { id: 'e1', practiceId: 1, status: 'draft', subtotal: 0, taxTotal: 0, total: 0, lines: [] } as any;
const procedure = { id: 9, name: 'Dental X-rays', price: 180 };

const memberHit = {
  itemType: 'procedure',
  name: 'Dental X-rays',
  procedure,
  price: 180,
  adjustedPrice: 162,
  wellnessPlanPricing: { hasCoverage: false, adjustedPrice: 162, originalPrice: 180, isWithinLimit: false, outOfPlanDiscountApplied: true },
};
const plainHit = { itemType: 'procedure', name: 'Dental X-rays', procedure, price: 180, adjustedPrice: 180 };

async function pickHit(listPrice: string) {
  render(<EstimateWorkspace estimate={estimate} onChange={() => {}} patientId={7} clientId={3} pets={[{ id: 7, name: 'Maple' }]} />);
  fireEvent.change(screen.getByPlaceholderText(/search services/i), { target: { value: 'dental' } });
  const btn = await screen.findByText('Dental X-rays', {}, { timeout: 2000 });
  expect(btn.closest('button')!.textContent).toContain(listPrice);
  fireEvent.click(btn.closest('button')!);
}

beforeEach(() => {
  vi.mocked(addEstimateLine).mockReset().mockResolvedValue(estimate);
  vi.mocked(checkItemPricing).mockReset();
});

describe('estimate add item pricing', () => {
  it('W9B-4a a member pet gets the member price on the estimate (and in the list)', async () => {
    vi.mocked(searchItems).mockResolvedValue([memberHit] as any);
    vi.mocked(checkItemPricing).mockResolvedValue({
      adjustedPrice: 162,
      originalPrice: 180,
      wellnessPlanPricing: memberHit.wellnessPlanPricing,
      item: { procedure },
    } as any);
    await pickHit('$162.00');
    await waitFor(() => expect(addEstimateLine).toHaveBeenCalled());
    const dto = vi.mocked(addEstimateLine).mock.calls[0][1] as any;
    expect(dto.unitPrice).toBe(162);
    expect(dto.listUnitPrice).toBe(180);
  });

  it('W9B-4c a non-member stays at full price', async () => {
    vi.mocked(searchItems).mockResolvedValue([plainHit] as any);
    vi.mocked(checkItemPricing).mockResolvedValue({ adjustedPrice: 180, originalPrice: 180, item: { procedure } } as any);
    await pickHit('$180.00');
    await waitFor(() => expect(addEstimateLine).toHaveBeenCalled());
    const dto = vi.mocked(addEstimateLine).mock.calls[0][1] as any;
    expect(dto.unitPrice).toBe(180);
    expect(dto.listUnitPrice).toBeNull();
  });
});
