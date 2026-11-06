/**
 * "Add other medications or products": the product modal picks an option with chips
 * (strength, then weight pack) like the online store product page, instead of listing
 * every variant as its own row. Same harness as PublicRoomLoaderFormC2.test.tsx.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpGet = vi.fn();
const httpPost = vi.fn();
const checkItemPricingPublic = vi.fn();
const publicStoreProducts = vi.fn();

vi.mock('../api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/http')>()),
  apiBaseUrl: 'http://api.test',
  http: { get: (...a: unknown[]) => httpGet(...a), post: (...a: unknown[]) => httpPost(...a) },
}));
vi.mock('../api/roomLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/roomLoader')>()),
  checkItemPricingPublic: (...a: unknown[]) => checkItemPricingPublic(...a),
  clearCheckItemPricingPublicCache: vi.fn(),
  searchItemsPublic: vi.fn().mockResolvedValue([]),
  simulateBillWithMembershipPublic: vi.fn().mockResolvedValue(null),
}));
vi.mock('../api/treatments', () => ({
  getPatientTreatmentHistoryPublic: vi.fn().mockResolvedValue([]),
}));
vi.mock('../api/onlineStore', () => ({ publicStoreProducts: (...a: unknown[]) => publicStoreProducts(...a) }));
vi.mock('../api/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/payments')>()),
  fetchFormattedSubscriptionPlans: vi.fn().mockResolvedValue([]),
  fetchSubscriptionPlanCatalog: vi.fn().mockResolvedValue(null),
}));
vi.mock('../api/membershipSavings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/membershipSavings')>()),
  useMembershipSavings: () => null,
}));
vi.mock('../components/MembershipEnrollmentModal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/MembershipEnrollmentModal')>()),
  default: () => null,
}));
vi.mock('jspdf', () => ({ default: vi.fn() }));

import { getPatientTreatmentHistoryPublic } from '../api/treatments';
import PublicRoomLoaderForm from './PublicRoomLoaderForm';

const PACKS = ['4.4–9.9 lbs', '10–22 lbs', '22.1–44 lbs', '44.1–88 lbs'];
const ONE_MONTH = [29.96, 34.5, 39.25, 44.75];
const THREE_MONTH = [80.1, 90.2, 100.3, 110.4];

const bravecto = {
  listingId: 'L-brav',
  name: 'Bravecto Chews',
  storeCategory: 'Preventatives',
  description: null,
  imageInventoryItemId: 500,
  hasImage: false,
  approvalTag: 'approved',
  recommendedFrequency: null,
  priceFrom: 29.96,
  variants: [
    ...PACKS.map((pack, i) => ({
      inventoryItemId: 500 + i, name: 'Bravecto', code: `B1-${i}`, onlineStorePrice: ONE_MONTH[i],
      strength: '1-month', pack, taxLevelValue: 1,
    })),
    ...PACKS.map((pack, i) => ({
      inventoryItemId: 600 + i, name: 'Bravecto', code: `B3-${i}`, onlineStorePrice: THREE_MONTH[i],
      strength: '3-month', pack, taxLevelValue: 1,
    })),
  ],
};
const toothpaste = {
  listingId: 'L-tooth',
  name: 'Enzymatic Toothpaste',
  storeCategory: 'Dental',
  description: null,
  imageInventoryItemId: 700,
  hasImage: false,
  approvalTag: 'approved',
  recommendedFrequency: null,
  priceFrom: 12.5,
  variants: [
    { inventoryItemId: 700, name: 'Enzymatic Toothpaste', code: 'TP', onlineStorePrice: 12.5, strength: null, pack: '' },
  ],
};

function pet(id: number, name: string, weight: number) {
  return { patientId: id, patientName: name, species: 'Canine', reminders: [], addedItems: [], weight, patient: { id, species: 'Canine' } };
}
function formPayload(patients: unknown[]) {
  return {
    roomLoaderId: 77,
    practice: { id: 1 },
    clientId: 9,
    appointments: (patients as any[]).map((p) => ({ id: p.patientId, patientId: p.patientId, startTime: '2026-11-10T14:00:00Z' })),
    patients,
    savedForm: {
      currentPage: 3 * patients.length + 1,
      pet0_eatingDrinkingNormal: 'yes', pet0_foodAllergies: 'no', pet0_newPatientBehavior: 'Fine', pet0_feeding: 'Kibble',
      pet1_eatingDrinkingNormal: 'yes', pet1_foodAllergies: 'no', pet1_newPatientBehavior: 'Fine', pet1_feeding: 'Kibble',
    },
  };
}
function mountForm(patients: unknown[] = [pet(1, 'Nala', 28.12)]) {
  httpGet.mockImplementation(async (url: string) =>
    url.startsWith('/public/room-loader/form') ? { data: formPayload(patients) } : { data: {} }
  );
  return render(
    <MemoryRouter initialEntries={['/room-loader?token=tok']}>
      <PublicRoomLoaderForm />
    </MemoryRouter>
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  httpPost.mockResolvedValue({ data: {} });
  checkItemPricingPublic.mockReset();
  checkItemPricingPublic.mockResolvedValue(null);
  publicStoreProducts.mockResolvedValue([bravecto, toothpaste]);
});

async function openModal(query: string, productName: string) {
  const input = await screen.findByPlaceholderText(/type to search products/i);
  await waitFor(() => expect(publicStoreProducts).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  fireEvent.change(input, { target: { value: query } });
  const row = await screen.findByText(productName, undefined, { timeout: 3000 });
  fireEvent.click(row);
  return await screen.findByRole('dialog', { name: productName });
}

const chip = (dialog: HTMLElement, name: string | RegExp) => within(dialog).getByRole('button', { name });

async function submittedSummary() {
  const submit = await screen.findByRole('button', { name: /submit form/i });
  await waitFor(() => expect(getPatientTreatmentHistoryPublic).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  fireEvent.click(submit);
  await waitFor(() => expect(httpPost).toHaveBeenCalled());
  return httpPost.mock.calls[0][1].formData.summaryForPdf as any;
}

describe('Room Loader store modal: choose like the online store', () => {
  it('shows chip groups (not one row per variant) and no per-option clinic price text', async () => {
    mountForm();
    const dialog = await openModal('Bravecto', 'Bravecto Chews');
    expect(within(dialog).getByText(/we'll bring this to your visit/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Duration')).toBeInTheDocument();
    expect(within(dialog).getByText('Weight')).toBeInTheDocument();
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(dialog).queryAllByText(/clinic price/i)).toHaveLength(0);
    expect(within(dialog).queryAllByRole('button', { name: /^Add$/ })).toHaveLength(0);
    expect(within(dialog).getAllByRole('button', { name: /add to visit/i })).toHaveLength(1);
    // two strengths + four packs, not 8 rows
    expect(chip(dialog, '1-month')).toBeInTheDocument();
    expect(chip(dialog, '3-month')).toBeInTheDocument();
    PACKS.forEach((p) => expect(chip(dialog, p)).toBeInTheDocument());
  });

  it('pre-selects the pack that fits the pet weight and says so', async () => {
    mountForm();
    const dialog = await openModal('Bravecto', 'Bravecto Chews');
    expect(chip(dialog, '22.1–44 lbs')).toHaveClass('is-on');
    expect(within(dialog).getByText(/fits nala \(28\.1 lbs\)/i)).toBeInTheDocument();
    expect(within(dialog).getByText('$39.25')).toBeInTheDocument();
  });

  it('switching to 3-month updates the price', async () => {
    mountForm();
    const dialog = await openModal('Bravecto', 'Bravecto Chews');
    fireEvent.click(chip(dialog, '3-month'));
    expect(chip(dialog, '22.1–44 lbs')).toHaveClass('is-on');
    expect(within(dialog).getByText('$100.30')).toBeInTheDocument();
    expect(within(dialog).queryByText('$39.25')).toBeNull();
  });

  it('with several pets the client picks the pet first (default first pet) and the pack follows', async () => {
    mountForm([pet(1, 'Nala', 28.12), pet(2, 'Tiny', 6)]);
    const dialog = await openModal('Bravecto', 'Bravecto Chews');
    expect(chip(dialog, /Nala/)).toHaveClass('is-on');
    expect(chip(dialog, '22.1–44 lbs')).toHaveClass('is-on');
    fireEvent.click(chip(dialog, /Tiny/));
    expect(chip(dialog, '4.4–9.9 lbs')).toHaveClass('is-on');
    expect(within(dialog).getByText(/fits tiny \(6 lbs\)/i)).toBeInTheDocument();
  });

  it('quantity 2 adds a row with quantity 2, the catalog id, and the option name', async () => {
    mountForm();
    const dialog = await openModal('Bravecto', 'Bravecto Chews');
    fireEvent.click(chip(dialog, '3-month'));
    fireEvent.click(within(dialog).getByRole('button', { name: /increase quantity/i }));
    expect(within(dialog).getByRole('spinbutton')).toHaveValue(2);
    fireEvent.click(within(dialog).getByRole('button', { name: /add to visit/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const summary = await submittedSummary();
    const row = summary.additionalItems.items[0];
    expect(row.name).toMatch(/Bravecto Chews.*3-month · 22\.1–44 lbs/);
    expect(row.quantity).toBe(2);
    expect(row.inventoryItemId).toBe(602 + 0);
    expect(row.catalogItemType).toBe('inventory');
    expect(row.lineTotal).toBeCloseTo(200.6, 2);
  });

  it('a single-variant product shows no chips, one price, and Add to visit', async () => {
    mountForm();
    const dialog = await openModal('Toothpaste', 'Enzymatic Toothpaste');
    expect(within(dialog).queryByText('Duration')).toBeNull();
    expect(within(dialog).queryByText('Weight')).toBeNull();
    expect(dialog.querySelectorAll('.vayd-store__chip')).toHaveLength(0);
    expect(within(dialog).getByText('$12.50')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /add to visit/i })).toBeInTheDocument();
  });

  it('links to the online store page in a new tab', async () => {
    mountForm();
    const dialog = await openModal('Bravecto', 'Bravecto Chews');
    const link = within(dialog).getByRole('link', { name: /order via our online store/i });
    expect(link).toHaveAttribute('href', '/store/L-brav');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
  });
});
