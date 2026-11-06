/**
 * Batch C2 (AL-03 form side, AL-06, AL-13), vayd-api docs/test-plans/room-loader.md section 4.
 * Same harness as PublicRoomLoaderForm.test.tsx.
 *
 * Original header: Room Loader go-live plan (vayd-api docs/test-plans/room-loader.md), batch B:
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
let resendTrigger: (() => void) | null = null;
vi.mock('../components/MembershipEnrollmentModal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/MembershipEnrollmentModal')>()),
  default: (props: any) => {
    resendTrigger = () => void props.onEnrollmentFlowCompleted?.();
    return null;
  },
}));
vi.mock('jspdf', () => ({ default: vi.fn() }));

import { getPatientTreatmentHistoryPublic } from '../api/treatments';
import PublicRoomLoaderForm, { convertSavedShipStoreItems } from './PublicRoomLoaderForm';


const VISIT_MSG = 'Your visit has started. Please tell your care team about any changes.';

type Inv = { id: number; price: number; taxLevelValue?: number | null };
function pricingResponse(inv: Inv, name: string) {
  return {
    item: { itemType: 'inventory', inventoryItem: inv, price: inv.price, name },
    adjustedPrice: inv.price,
    originalPrice: inv.price,
  };
}
function pricingById(map: Record<number, unknown>) {
  checkItemPricingPublic.mockImplementation(async (req: any) => {
    const id = req?.item?.inventoryItem?.id ?? req?.item?.procedure?.id ?? req?.item?.lab?.id;
    return map[Number(id)] ?? null;
  });
}

const ANSWERS = {
  pet0_eatingDrinkingNormal: 'yes',
  pet0_foodAllergies: 'no',
  pet0_newPatientBehavior: 'Fine',
  pet0_feeding: 'Kibble',
};

function procReminder(id: number, name: string, price: number) {
  return { reminderId: id, quantity: 1, item: { id: 1000 + id, name, price, type: 'procedure', code: `P${id}`, procedure: { id: 1000 + id, price } } };
}

function formPayload(opts: { reminders?: unknown[]; savedForm?: Record<string, unknown>; extra?: Record<string, unknown> }) {
  return {
    roomLoaderId: 77,
    practice: { id: 1 },
    clientId: 9,
    appointments: [{ id: 1, patientId: 1, startTime: '2026-11-10T14:00:00Z' }],
    patients: [
      {
        patientId: 1,
        patientName: 'Rex',
        species: 'Equine',
        reminders: opts.reminders ?? [],
        addedItems: [],
        patient: { id: 1, species: 'Equine' },
      },
    ],
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
  resendTrigger = null;
  httpPost.mockResolvedValue({ data: {} });
  checkItemPricingPublic.mockReset();
});

async function clickSubmit() {
  const submit = await screen.findByRole('button', { name: /submit form/i });
  // Submit is refused while the treatment-history lookup is loading, so wait for it first.
  await waitFor(() => expect(getPatientTreatmentHistoryPublic).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  fireEvent.click(submit);
}

async function submittedSummary() {
  await clickSubmit();
  await waitFor(() => expect(httpPost).toHaveBeenCalled());
  return httpPost.mock.calls[0][1].formData.summaryForPdf as any;
}

const storeRow = (id: number, name: string, price: number) => ({
  id: `L${id}-${id}-visit`,
  name,
  price,
  visitPrice: price,
  fulfillment: 'visit',
  sku: `SKU${id}`,
  listingId: `L${id}`,
  inventoryItemId: id,
  catalogItemType: 'inventory',
  quantity: 1,
});

describe('AL-03 (form) visit started is read-only', () => {
  it('AL-03f-1: visitStarted from the API shows the message, read-only answers, no Submit', async () => {
    mountForm(formPayload({ extra: { visitStarted: true } }));
    expect(await screen.findByText(VISIT_MSG)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit form/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /already submitted/i })).toBeNull();
  });

  it('AL-03f-1: visitStarted with a completed submission still shows the message, not the thank-you page', async () => {
    mountForm(
      formPayload({
        extra: { visitStarted: true, submitStatus: 'completed', responseFromClient: { formData: { ...ANSWERS, summaryForPdf: {} } } },
      })
    );
    expect(await screen.findByText(VISIT_MSG)).toBeInTheDocument();
    expect(screen.queryByText(/thank you/i)).toBeNull();
  });

  it('AL-03f-2: 409 VISIT_STARTED on submit shows the message and switches to read-only', async () => {
    mountForm(formPayload({}));
    httpPost.mockRejectedValue({ response: { status: 409, data: { code: 'VISIT_STARTED', message: 'x' } } });
    await clickSubmit();
    expect(await screen.findByText(VISIT_MSG)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit form/i })).toBeNull();
    expect(screen.queryByText(/failed to submit/i)).toBeNull();
  });

  it('AL-03f-3: any other submit failure keeps the form editable with the usual error', async () => {
    mountForm(formPayload({}));
    httpPost.mockRejectedValue({ response: { status: 500, data: {} } });
    await clickSubmit();
    expect(await screen.findByText(/failed to submit form/i)).toBeInTheDocument();
    expect(screen.queryByText(VISIT_MSG)).toBeNull();
    expect(screen.getByRole('button', { name: /submit form/i })).toBeEnabled();
  });
});

describe('AL-06 store tax follows each item', () => {
  const two = (a: Inv, b?: Inv) => {
    const items = [storeRow(a.id, `Item ${a.id}`, a.price), ...(b ? [storeRow(b.id, `Item ${b.id}`, b.price)] : [])];
    pricingById({
      [a.id]: pricingResponse(a, `Item ${a.id}`),
      ...(b ? { [b.id]: pricingResponse(b, `Item ${b.id}`) } : {}),
    });
    mountForm(formPayload({ savedForm: { currentPage: 4, storeAdditionalItems: items } }));
  };

  it.each([0, null])('AL-06-1: non-taxable item (taxLevelValue %s) gets no tax and the label has no rate', async (lvl) => {
    two({ id: 55, price: 40, taxLevelValue: lvl });
    await waitFor(() => expect(screen.getAllByText('$40.00').length).toBeGreaterThan(0));
    const summary = await submittedSummary();
    expect(summary.additionalItems.tax).toBe(0);
    expect(summary.additionalItems.taxLabel).toBe('Sales tax');
    expect(summary.grandTotal).toBeCloseTo(40, 2);
    expect(screen.queryByText(/5\.5%/)).toBeNull();
  });

  it('AL-06-2: a taxable item is taxed at 5.5% and labelled with the rate', async () => {
    two({ id: 55, price: 40, taxLevelValue: 1 });
    await waitFor(() => expect(screen.getAllByText('$40.00').length).toBeGreaterThan(0));
    const summary = await submittedSummary();
    expect(summary.additionalItems.tax).toBeCloseTo(2.2, 2);
    expect(summary.additionalItems.taxLabel).toBe('Sales tax (5.5%)');
    expect(summary.grandTotal).toBeCloseTo(42.2, 2);
  });

  it('AL-06-3: mixed items tax only the taxable line', async () => {
    two({ id: 55, price: 40, taxLevelValue: 1 }, { id: 56, price: 30, taxLevelValue: 0 });
    await waitFor(() => expect(screen.getAllByText('$30.00').length).toBeGreaterThan(0));
    const summary = await submittedSummary();
    expect(summary.additionalItems.tax).toBeCloseTo(2.2, 2);
    expect(summary.grandTotal).toBeCloseTo(72.2, 2);
  });
});

describe('AL-06 procedure store items', () => {
  it('AL-06-4: a taxable procedure sold in the store is taxed like the invoice does', async () => {
    const row = {
      ...storeRow(77, 'Item 77', 40),
      inventoryItemId: null,
      procedureId: 77,
      catalogItemType: 'procedure',
    };
    checkItemPricingPublic.mockImplementation(async () => ({
      item: { itemType: 'procedure', procedure: { id: 77, price: 40, taxLevelValue: 1 }, price: 40, name: 'Item 77' },
      adjustedPrice: 40,
      originalPrice: 40,
    }));
    mountForm(formPayload({ savedForm: { currentPage: 4, storeAdditionalItems: [row] } }));
    await waitFor(() => expect(screen.getAllByText('$40.00').length).toBeGreaterThan(0));
    const summary = await submittedSummary();
    expect(summary.additionalItems.tax).toBeCloseTo(2.2, 2);
    expect(summary.additionalItems.taxLabel).toBe('Sales tax (5.5%)');
  });
});

describe('AL-13 answers are keyed by a stable item key', () => {
  it('AL-13-1: a resend that reorders the list and adds an item keeps B unchecked and checks the new item', async () => {
    const A = procReminder(1, 'Item Alpha', 10);
    const B = procReminder(2, 'Item Bravo', 20);
    const C = procReminder(3, 'Item Charlie', 30);
    const D = procReminder(4, 'Item Delta', 40);
    pricingById({});
    mountForm(formPayload({ reminders: [A, B, C] }));
    const box = (n: RegExp) => screen.getByLabelText(n) as HTMLInputElement;
    await waitFor(() => expect(box(/Item Bravo/)).toBeChecked());
    fireEvent.click(box(/Item Bravo/));
    expect(box(/Item Bravo/)).not.toBeChecked();
    expect(box(/Item Alpha/)).toBeChecked();

    // Staff re-send: the list is replaced, reordered, with a new item at the front.
    httpGet.mockImplementation(async (url: string) =>
      url.startsWith('/public/room-loader/form')
        ? { data: formPayload({ reminders: [D, C, B, A] }) }
        : { data: {} }
    );
    expect(resendTrigger).not.toBeNull();
    await act(async () => {
      resendTrigger!();
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(box(/Item Delta/)).toBeChecked());
    expect(box(/Item Bravo/)).not.toBeChecked();
    expect(box(/Item Alpha/)).toBeChecked();
    expect(box(/Item Charlie/)).toBeChecked();
  });
});
