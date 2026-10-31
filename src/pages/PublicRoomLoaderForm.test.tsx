/**
 * Room Loader go-live plan (vayd-api docs/test-plans/room-loader.md), batch B:
 * RL-02b (quantity-aware price), RL-03 (settings-driven form restored),
 * RL-11 (no "Ship to me", D4) and RL-13-4 (summary rows carry catalog ids).
 * The public form is mounted on its summary page with the API modules mocked.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpGet = vi.fn();
const httpPost = vi.fn();
const checkItemPricingPublic = vi.fn();

vi.mock('../api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/http')>()),
  apiBaseUrl: 'http://api.test',
  http: {
    get: (...a: unknown[]) => httpGet(...a),
    post: (...a: unknown[]) => httpPost(...a),
  },
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
vi.mock('../api/onlineStore', () => ({ publicStoreProducts: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/payments')>()),
  fetchFormattedSubscriptionPlans: vi.fn().mockResolvedValue([]),
  fetchSubscriptionPlanCatalog: vi.fn().mockResolvedValue(null),
}));
let membershipSavings: unknown = null;
vi.mock('../api/membershipSavings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/membershipSavings')>()),
  useMembershipSavings: () => membershipSavings,
}));
vi.mock('jspdf', () => ({ default: vi.fn() }));

import { getPatientTreatmentHistoryPublic } from '../api/treatments';
import PublicRoomLoaderForm, { convertSavedShipStoreItems } from './PublicRoomLoaderForm';

const INTERCEPTOR_BREAKS = [
  { lowQuantity: '6', highQuantity: '11', price: '13.19', markup: '', isActive: true },
  { lowQuantity: '12', highQuantity: '100', price: '12.48', markup: '', isActive: true },
];

type Inv = { id: number; price: number; serviceFee?: number; minimumPrice?: number; isMedication?: boolean };
function pricingResponse(inv: Inv, name: string, breaks?: typeof INTERCEPTOR_BREAKS) {
  const list = inv.price + (inv.serviceFee ?? 0);
  const unit = inv.minimumPrice ? Math.max(inv.minimumPrice, list) : list;
  return {
    item: { itemType: 'inventory', inventoryItem: inv, price: inv.price, name },
    adjustedPrice: unit,
    originalPrice: unit,
    ...(breaks ? { tieredPricing: { hasTieredPricing: true, priceBreaks: breaks } } : {}),
  };
}

function medReminder(id: number, name: string, price: number, quantity: number) {
  return {
    reminderId: id,
    quantity,
    item: {
      id,
      name,
      price,
      type: 'inventory',
      code: `C${id}`,
      inventoryItem: { id, price, isMedication: true, code: `C${id}` },
    },
  };
}

/** Required check-in answers, so submit is not sent back to page 1. */
const ANSWERS = {
  pet0_eatingDrinkingNormal: 'yes',
  pet0_foodAllergies: 'no',
  pet0_newPatientBehavior: 'Fine',
  pet0_feeding: 'Kibble',
};

function formPayload(opts: {
  reminders?: unknown[];
  species?: string;
  savedForm?: Record<string, unknown>;
  config?: unknown;
  extra?: Record<string, unknown>;
}) {
  return {
    roomLoaderId: 77,
    practice: { id: 1 },
    clientId: 9,
    appointments: [{ id: 1, patientId: 1, startTime: '2026-11-10T14:00:00Z' }],
    patients: [
      {
        patientId: 1,
        patientName: 'Rex',
        species: opts.species ?? 'Equine',
        reminders: opts.reminders ?? [],
        addedItems: [],
        patient: { id: 1, species: opts.species ?? 'Equine' },
      },
    ],
    config: opts.config,
    ...(opts.extra ?? {}),
    savedForm: { ...ANSWERS, ...(opts.savedForm ?? { currentPage: 4 }) },
  };
}

function mountForm(payload: unknown) {
  httpGet.mockImplementation(async (url: string) => {
    if (url.startsWith('/public/room-loader/form')) return { data: payload };
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={['/room-loader?token=tok']}>
      <PublicRoomLoaderForm />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  membershipSavings = null;
  httpPost.mockResolvedValue({ data: {} });
  checkItemPricingPublic.mockReset();
});

/** Pricing mock keyed by catalog item id, so each test declares only the items it uses. */
function pricingById(map: Record<number, unknown>) {
  checkItemPricingPublic.mockImplementation(async (req: any) => {
    const id = req?.item?.inventoryItem?.id ?? req?.item?.procedure?.id ?? req?.item?.lab?.id;
    return map[Number(id)] ?? null;
  });
}

async function submittedSummary() {
  const submit = await screen.findByRole('button', { name: /submit form/i });
  // Submit is refused while the treatment-history lookup is still loading (by design), so wait
  // for the lookup to be requested and its result applied before tapping Submit.
  await waitFor(() => expect(getPatientTreatmentHistoryPublic).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  fireEvent.click(submit);
  await waitFor(() => expect(httpPost).toHaveBeenCalled());
  const body = httpPost.mock.calls[0][1];
  const fd = body.formData;
  return fd.summaryForPdf as any;
}

const storeRow = (over: Record<string, unknown> = {}) => ({
  id: 'L1-55-visit',
  name: 'Bravecto - 1 chew',
  price: 40,
  visitPrice: 40,
  fulfillment: 'visit',
  sku: 'BRAV1',
  listingId: 'L1',
  inventoryItemId: 55,
  catalogItemType: 'inventory',
  quantity: 1,
  ...over,
});

describe('RL-02b quantity-aware price on the form', () => {
  it('RL-02b-1: changing qty 5 to 6 hits the price break and the line total follows', async () => {
    const inv = { id: 900, price: 14.26, isMedication: true };
    pricingById({ 900: pricingResponse(inv, 'Interceptor Yellow', INTERCEPTOR_BREAKS) });
    mountForm(formPayload({ reminders: [medReminder(900, 'Interceptor Yellow', 14.26, 5)] }));
    const qty = await screen.findByRole('spinbutton');
    await waitFor(() => expect(screen.getAllByText('$71.30').length).toBeGreaterThan(0));
    fireEvent.change(qty, { target: { value: '6' } });
    await waitFor(() => expect(screen.getAllByText('$79.14').length).toBeGreaterThan(0));
    expect(screen.queryByText('$71.30')).toBeNull();
  });

  it('RL-02b-1: the grand total follows the line and summaryForPdf carries unit price and line total', async () => {
    const inv = { id: 900, price: 14.26, isMedication: true };
    pricingById({ 900: pricingResponse(inv, 'Interceptor Yellow', INTERCEPTOR_BREAKS) });
    mountForm(formPayload({ reminders: [medReminder(900, 'Interceptor Yellow', 14.26, 6)] }));
    await waitFor(() => expect(screen.getAllByText('$79.14').length).toBeGreaterThan(0));
    const summary = await submittedSummary();
    const row = summary.pets[0].rows.find((r: any) => r.name === 'Interceptor Yellow');
    expect(row.quantity).toBe(6);
    expect(row.lineTotal).toBeCloseTo(79.14, 2);
    expect(row.price).toBeCloseTo(13.19, 2);
    expect(summary.pets[0].subtotal).toBeCloseTo(79.14, 2);
  });

  it('RL-02b-2: the service fee is charged once per line, not once per unit', async () => {
    const inv = { id: 901, price: 1.5, serviceFee: 12, isMedication: true };
    pricingById({ 901: pricingResponse(inv, 'Prednisone 5mg', undefined) });
    mountForm(formPayload({ reminders: [medReminder(901, 'Prednisone 5mg', 13.5, 30)] }));
    await waitFor(() => expect(screen.getAllByText('$57.00').length).toBeGreaterThan(0));
    expect(screen.queryByText('$405.00')).toBeNull();
    const summary = await submittedSummary();
    const row = summary.pets[0].rows.find((r: any) => r.name === 'Prednisone 5mg');
    expect(row.lineTotal).toBeCloseTo(57, 2);
    expect(row.price).toBeCloseTo(1.9, 2);
  });

  it('RL-02b-2: the minimum price applies to the whole line', async () => {
    const inv = { id: 902, price: 0.5, minimumPrice: 25, isMedication: true };
    pricingById({ 902: pricingResponse(inv, 'Gauze', undefined) });
    mountForm(formPayload({ reminders: [medReminder(902, 'Gauze', 25, 10)] }));
    await waitFor(() => expect(screen.getAllByText('$25.00').length).toBeGreaterThan(0));
    const summary = await submittedSummary();
    const row = summary.pets[0].rows.find((r: any) => r.name === 'Gauze');
    expect(row.lineTotal).toBeCloseTo(25, 2);
  });

  it('RL-02b-3: a store product at qty 3 uses the break; the row has qty, unit price and line total', async () => {
    const inv = { id: 55, price: 40 };
    const breaks = [{ lowQuantity: '3', highQuantity: '10', price: '35', markup: '', isActive: true }];
    pricingById({ 55: pricingResponse(inv, 'Bravecto', breaks as any) });
    mountForm(formPayload({ savedForm: { currentPage: 4, storeAdditionalItems: [storeRow({ quantity: 1 })] } }));
    const inc = await screen.findByRole('button', { name: /increase quantity of bravecto/i });
    fireEvent.click(inc);
    fireEvent.click(inc);
    await waitFor(() => expect(screen.getAllByText('$105.00').length).toBeGreaterThan(0));
    const summary = await submittedSummary();
    const item = summary.additionalItems.items[0];
    expect(item.quantity).toBe(3);
    expect(item.price).toBeCloseTo(35, 2);
    expect(item.lineTotal).toBeCloseTo(105, 2);
    expect(summary.additionalItems.subtotal).toBeCloseTo(105, 2);
  });

  it('RL-02b-4: client quantity is clamped to 1 and 999', async () => {
    const inv = { id: 900, price: 14.26, isMedication: true };
    pricingById({ 900: pricingResponse(inv, 'Interceptor Yellow', INTERCEPTOR_BREAKS) });
    mountForm(formPayload({ reminders: [medReminder(900, 'Interceptor Yellow', 14.26, 3)] }));
    const qty = (await screen.findByRole('spinbutton')) as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '0' } });
    await waitFor(() => expect(qty.value).toBe('1'));
    fireEvent.change(qty, { target: { value: '1000' } });
    await waitFor(() => expect(qty.value).toBe('999'));
  });
});

describe('RL-11 no "Ship to me" (D4)', () => {
  const listing = {
    listingId: 'L1',
    name: 'Bravecto',
    storeCategory: 'Parasite',
    description: null,
    imageInventoryItemId: 55,
    hasImage: false,
    approvalTag: 'approved',
    recommendedFrequency: null,
    priceFrom: 38,
    variants: [
      { inventoryItemId: 55, name: 'Bravecto 1 chew', code: 'BRAV1', onlineStorePrice: 38, strength: null, pack: '', optionLabel: '1 chew' },
    ],
  };

  it('RL-11-1: the store option modal offers only "Bring to the visit (clinic price)"', async () => {
    const { publicStoreProducts } = await import('../api/onlineStore');
    (publicStoreProducts as any).mockResolvedValue([listing]);
    pricingById({});
    mountForm(formPayload({}));
    fireEvent.change(await screen.findByPlaceholderText('Type to search products...'), { target: { value: 'brav' } });
    fireEvent.click(await screen.findByText('Bravecto'));
    expect(await screen.findByText(/Bring to the visit \(clinic price\)/)).toBeInTheDocument();
    expect(screen.queryByText(/ship to me/i)).toBeNull();
    expect(screen.queryByText(/ship uses/i)).toBeNull();
  });

  it('RL-11-2: a saved ship row loads at the visit price with a notice, and submits as a visit row', async () => {
    pricingById({ 55: pricingResponse({ id: 55, price: 52 }, 'Bravecto') });
    const ship = storeRow({ id: 'L1-55-ship', fulfillment: 'ship', price: 38, visitPrice: 52, shipPrice: 38 });
    mountForm(formPayload({ savedForm: { currentPage: 4, storeAdditionalItems: [ship] } }));
    expect(await screen.findByText(/no longer ship store items/i)).toBeInTheDocument();
    expect(screen.queryByText(/ship to me/i)).toBeNull();
    const summary = await submittedSummary();
    const item = summary.additionalItems.items[0];
    expect(item.price).toBeCloseTo(52, 2);
    expect(JSON.stringify(summary)).not.toMatch(/ship/i);
  });

  it('RL-11-2: a ship row and the same visit row merge into one line', () => {
    const { items, convertedNames } = convertSavedShipStoreItems([
      storeRow({ quantity: 1 }),
      storeRow({ id: 'L1-55-ship', fulfillment: 'ship', price: 38, quantity: 2 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
    expect(items[0].fulfillment).toBe('visit');
    expect(convertedNames).toEqual(['Bravecto - 1 chew']);
  });
});

describe('RL-13-4 summary carries catalog ids', () => {
  it('inventory and procedure store rows carry inventoryItemId / procedureId and catalogItemType', async () => {
    pricingById({
      55: pricingResponse({ id: 55, price: 40 }, 'Bravecto'),
    });
    mountForm(
      formPayload({
        savedForm: {
          currentPage: 4,
          storeAdditionalItems: [
            storeRow(),
            storeRow({ id: 'L2-77-visit', name: 'Nail trim kit', listingId: 'L2', inventoryItemId: null, procedureId: 77, catalogItemType: 'procedure', sku: 'NAIL' }),
          ],
        },
      })
    );
    const summary = await submittedSummary();
    const [inv, proc] = summary.additionalItems.items;
    expect(inv).toMatchObject({ name: 'Bravecto - 1 chew', quantity: 1, price: 40, code: 'BRAV1', inventoryItemId: 55, catalogItemType: 'inventory' });
    expect(inv.procedureId ?? null).toBeNull();
    expect(proc).toMatchObject({ code: 'NAIL', procedureId: 77, catalogItemType: 'procedure' });
    expect(proc.inventoryItemId ?? null).toBeNull();
  });
});

describe('RL-03 settings-driven form restored', () => {
  const practicePlans = [
    { id: 1, name: 'Comfort Care', minAgeMonths: null, maxAgeMonths: null },
    { id: 2, name: 'Canine Foundations', minAgeMonths: null, maxAgeMonths: null },
    { id: 3, name: 'Canine Golden', minAgeMonths: 96, maxAgeMonths: null },
  ];

  it('RL-03-2: Comfort Care is never offered to a non-member pet', async () => {
    pricingById({});
    const payload = formPayload({
      species: 'Canine',
      extra: { membershipAges: { plans: practicePlans } },
      config: { membership: { enabled: true, startExpanded: true } },
    });
    mountForm(payload);
    await screen.findByRole('button', { name: /submit form/i });
    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    // The pitch itself is on screen (so the absence below means something).
    await screen.findByText(/membership could change/i);
    expect(document.body.textContent).not.toMatch(/comfort care/i);
  });

  it('RL-03-3: the thank-you page quotes the plan percentages (25%), never a hardcoded 50%', async () => {
    membershipSavings = {
      plans: [],
      examPercentOff: { min: 25, max: 25 },
      storePercentOff: { min: 10, max: 10 },
    };
    mountForm({
      ...formPayload({}),
      submitStatus: 'completed',
      responseFromClient: { formData: { summaryForPdf: { pets: [], additionalItems: { items: [] } } } },
    });
    await screen.findByText(/Your Pre-Visit Check-In has been submitted/i);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/save 25% on additional exams/i);
    expect(text).not.toMatch(/50%/);
  });

  it('RL-03-3: with no plan savings known, no percentage claim is made at all', async () => {
    mountForm({
      ...formPayload({}),
      submitStatus: 'completed',
      responseFromClient: { formData: { summaryForPdf: { pets: [], additionalItems: { items: [] } } } },
    });
    await screen.findByText(/Your Pre-Visit Check-In has been submitted/i);
    expect(document.body.textContent).not.toMatch(/\d+% on additional exams/i);
  });

  it('RL-03-4 (form half): the current-medications answer is on the page and in the submitted answers', async () => {
    pricingById({});
    mountForm(formPayload({ savedForm: { currentPage: 4, pet0_currentMedications: 'Apoquel 16mg daily' } }));
    const summary = await submittedSummary();
    expect(summary).toBeTruthy();
    const body = httpPost.mock.calls[0][1].formData;
    const answers = JSON.stringify(body.formAnswersForPdf);
    expect(answers).toContain('What medications is Rex on currently');
    expect(answers).toContain('Apoquel 16mg daily');
    expect(body.pet0_currentMedications).toBe('Apoquel 16mg daily');
  });
});

describe('RL-10-5 one submit request while sending', () => {
  it('a second tap on a slow submit sends no second request; the button is disabled while sending', async () => {
    let release: (v: unknown) => void = () => {};
    httpPost.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );
    pricingById({ 900: pricingResponse({ id: 900, price: 14.26, isMedication: true }, 'Interceptor Yellow') });
    mountForm(formPayload({ reminders: [medReminder(900, 'Interceptor Yellow', 14.26, 1)] }));
    // page position can carry over between tests; walk forward to the summary page
    await screen.findByRole('button', { name: /submit form|^next:/i });
    for (let i = 0; i < 6 && !screen.queryByRole('button', { name: /submit form/i }); i++) {
      const next = await screen.findByRole('button', { name: /^next:/i });
      fireEvent.click(next);
    }
    const button = await screen.findByRole('button', { name: /submit form/i });
    const submitCalls = () => httpPost.mock.calls.filter((c) => c[0] === '/public/room-loader/submit');
    fireEvent.click(button);
    await waitFor(() => expect(submitCalls()).toHaveLength(1), { timeout: 4000 });
    fireEvent.click(button);
    fireEvent.click(button);
    expect((await screen.findByRole('button', { name: /submitting/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(submitCalls()).toHaveLength(1);
    release({ data: {} });
    await waitFor(() => expect(httpPost).toHaveBeenCalled());
    expect(submitCalls()).toHaveLength(1);
  });
});
