/**
 * Room Loader invoice order (owner, Nov 13, 2026): the client form, its summary and the
 * submitted summaryForPdf (which feeds the PDF and the pre-visit accepts) follow the staff order.
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
import PublicRoomLoaderForm from './PublicRoomLoaderForm';

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

/** A staff line as the staff Room Loader sends it (`sortOrder` = its place in the invoice order). */
function line(
  id: number,
  name: string,
  type: 'procedure' | 'inventory' | 'lab',
  price: number,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    name,
    type,
    price,
    code: `C${id}`,
    ...(type === 'inventory' ? { inventoryItem: { id, price, code: `C${id}` } } : {}),
    ...(type === 'procedure' ? { procedure: { id, price, code: `C${id}` } } : {}),
    ...(type === 'lab' ? { lab: { id, price, code: `C${id}` } } : {}),
    ...extra,
  };
}

function payloadWith(reminders: unknown[], addedItems: unknown[], config?: unknown) {
  const p: any = formPayload({ reminders, config });
  p.patients[0].addedItems = addedItems;
  return p;
}

function procedurePricing(id: number, name: string, price: number) {
  return {
    item: { itemType: 'procedure', procedure: { id, price }, price, name },
    adjustedPrice: price,
    originalPrice: price,
  };
}
function invPricing(id: number, name: string, price: number, categoryName?: string) {
  return {
    item: { itemType: 'inventory', inventoryItem: { id, price, categoryName }, price, name },
    adjustedPrice: price,
    originalPrice: price,
  };
}

const PRICES = {
  10: invPricing(10, 'DAPP Vaccine - 1 year', 42, 'Vaccines'),
  11: invPricing(11, 'Simparica Trio', 165),
  12: procedurePricing(12, 'Trip Fee', 95),
  13: procedurePricing(13, 'Annual Wellness Visit', 85),
  14: procedurePricing(14, 'Nail Trim', 25),
};

const names = (summary: any) => summary.pets[0].rows.map((r: any) => r.name);

describe('RLO-05 client form follows the Room Loader invoice order', () => {
  it('staff sortOrder sets the summary order, on screen and in summaryForPdf', async () => {
    pricingById(PRICES);
    mountForm(
      payloadWith(
        [
          {
            reminderId: 1,
            quantity: 1,
            sortOrder: 2,
            item: line(10, 'DAPP Vaccine - 1 year', 'inventory', 42, { categoryName: 'Vaccines' }),
          },
          {
            reminderId: 2,
            quantity: 1,
            sortOrder: 4,
            item: line(11, 'Simparica Trio', 'inventory', 165),
          },
        ],
        [
          { ...line(12, 'Trip Fee', 'procedure', 95), quantity: 1, sortOrder: 0, rowKey: 'k1' },
          {
            ...line(13, 'Annual Wellness Visit', 'procedure', 85),
            quantity: 1,
            sortOrder: 1,
            rowKey: 'k2',
          },
          { ...line(14, 'Nail Trim', 'procedure', 25), quantity: 1, sortOrder: 3, rowKey: 'k3' },
        ]
      )
    );
    await screen.findByText('Review Your Care Plan & Estimate');
    await waitFor(() => expect(screen.getAllByText('Simparica Trio').length).toBeGreaterThan(0));
    const page = document.body.textContent ?? '';
    const onScreen = [
      'Trip Fee',
      'Annual Wellness Visit',
      'DAPP Vaccine - 1 year',
      'Nail Trim',
      'Simparica Trio',
    ].map((n) => page.indexOf(n));
    expect(onScreen.every((pos, i) => i === 0 || pos > onScreen[i - 1])).toBe(true);

    const summary = await submittedSummary();
    expect(names(summary)).toEqual([
      'Trip Fee',
      'Annual Wellness Visit',
      'DAPP Vaccine - 1 year',
      'Nail Trim',
      'Simparica Trio',
    ]);
  });

  it('a custom staff order (meds moved to the top) is kept', async () => {
    pricingById(PRICES);
    mountForm(
      payloadWith(
        [
          {
            reminderId: 1,
            quantity: 1,
            sortOrder: 3,
            item: line(10, 'DAPP Vaccine - 1 year', 'inventory', 42, { categoryName: 'Vaccines' }),
          },
          {
            reminderId: 2,
            quantity: 1,
            sortOrder: 0,
            item: line(11, 'Simparica Trio', 'inventory', 165),
          },
        ],
        [
          { ...line(12, 'Trip Fee', 'procedure', 95), quantity: 1, sortOrder: 1, rowKey: 'k1' },
          {
            ...line(13, 'Annual Wellness Visit', 'procedure', 85),
            quantity: 1,
            sortOrder: 2,
            rowKey: 'k2',
          },
        ]
      )
    );
    await screen.findByText('Review Your Care Plan & Estimate');
    const summary = await submittedSummary();
    expect(names(summary)).toEqual([
      'Simparica Trio',
      'Trip Fee',
      'Annual Wellness Visit',
      'DAPP Vaccine - 1 year',
    ]);
  });

  it('a form sent before invoice order (no sortOrder) is shown in the standard order', async () => {
    pricingById(PRICES);
    mountForm(
      payloadWith(
        [
          {
            reminderId: 1,
            quantity: 1,
            item: line(10, 'DAPP Vaccine - 1 year', 'inventory', 42, { categoryName: 'Vaccines' }),
          },
          { reminderId: 2, quantity: 1, item: line(11, 'Simparica Trio', 'inventory', 165) },
        ],
        [
          { ...line(14, 'Nail Trim', 'procedure', 25), quantity: 1 },
          { ...line(12, 'Trip Fee', 'procedure', 95), quantity: 1 },
          { ...line(13, 'Annual Wellness Visit', 'procedure', 85), quantity: 1 },
        ]
      )
    );
    await screen.findByText('Review Your Care Plan & Estimate');
    const summary = await submittedSummary();
    expect(names(summary)).toEqual([
      'Trip Fee',
      'Annual Wellness Visit',
      'DAPP Vaccine - 1 year',
      'Nail Trim',
      'Simparica Trio',
    ]);
  });

  it('the practice order from Settings is used (exam before trip fee)', async () => {
    pricingById(PRICES);
    mountForm(
      payloadWith(
        [
          {
            reminderId: 1,
            quantity: 1,
            item: line(10, 'DAPP Vaccine - 1 year', 'inventory', 42, { categoryName: 'Vaccines' }),
          },
        ],
        [
          { ...line(12, 'Trip Fee', 'procedure', 95), quantity: 1 },
          { ...line(13, 'Annual Wellness Visit', 'procedure', 85), quantity: 1 },
        ],
        {
          // A saved (configured) document; an empty one falls back to the starter settings.
          productGuide: { enabled: true, summaryLabel: 'Guide', tables: [] },
          invoiceOrder: {
            categories: ['exam', 'trip', 'vaccine', 'lab', 'procedure', 'med', 'store'],
          },
        }
      )
    );
    await screen.findByText('Review Your Care Plan & Estimate');
    const summary = await submittedSummary();
    expect(names(summary)).toEqual(['Annual Wellness Visit', 'Trip Fee', 'DAPP Vaccine - 1 year']);
  });

  it('an unchecked line keeps its place (crossed out) and its checkbox answer', async () => {
    pricingById(PRICES);
    const p = payloadWith(
      [
        {
          reminderId: 2,
          quantity: 1,
          sortOrder: 2,
          item: line(11, 'Simparica Trio', 'inventory', 165),
        },
      ],
      [
        { ...line(12, 'Trip Fee', 'procedure', 95), quantity: 1, sortOrder: 0, rowKey: 'k1' },
        { ...line(14, 'Nail Trim', 'procedure', 25), quantity: 1, sortOrder: 1, rowKey: 'k3' },
      ]
    );
    p.savedForm = { ...p.savedForm, pet0_rec_a14: false };
    mountForm(p);
    await screen.findByText('Review Your Care Plan & Estimate');
    const summary = await submittedSummary();
    expect(names(summary)).toEqual(['Trip Fee', 'Nail Trim', 'Simparica Trio']);
    const nails = summary.pets[0].rows.find((r: any) => r.name === 'Nail Trim');
    expect(nails.checked).toBe(false);
    expect(nails.lineTotal).toBe(0);
  });
});
