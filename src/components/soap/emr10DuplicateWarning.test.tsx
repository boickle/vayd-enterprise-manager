/**
 * EMR-10-8 (owner decision D4, Nov 2, 2026): the same catalog item for the same pet on the same
 * visit comes back 409 from the API with the entries already there. The SOAP order add, the
 * estimate editor and the checkout add-line show those entries with "Add anyway": it resends the
 * request with `confirmDuplicate: true`. Cancel adds nothing.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppDialogProvider from '../AppDialogProvider';
import PlanOrdersSection from './PlanOrdersSection';
import EstimateWorkspace from '../estimates/EstimateWorkspace';
import { http } from '../../api/http';
import { addCounterInvoiceLine } from '../../api/visitWorkflow';
import { isDuplicateItemSkipped } from '../../utils/duplicateItemWarning';
import { searchItems } from '../../api/roomLoader';
import { listBundles } from '../../api/memberships';

vi.mock('../../permissions/PermissionContext', () => ({ useCan: () => false }));
vi.mock('../ClientEmailComposeModal', () => ({ ClientEmailComposeModal: () => null }));
vi.mock('../../api/roomLoader', async (orig) => ({
  ...(await orig<typeof import('../../api/roomLoader')>()),
  checkItemPricing: vi.fn(),
  searchItems: vi.fn(),
}));
vi.mock('../../api/memberships', async (orig) => ({
  ...(await orig<typeof import('../../api/memberships')>()),
  listBundles: vi.fn(),
}));

const HIT = {
  name: 'Private cremation',
  itemType: 'procedure',
  price: 150,
  procedure: { id: 77, name: 'Private cremation', price: 150 },
} as any;

const DUPLICATES = [
  {
    source: 'estimate_line',
    id: 'est-line-1',
    description: 'Private cremation',
    qty: 1,
    status: null,
    created: '2026-11-03T15:00:00Z',
  },
];

const conflict = () =>
  Object.assign(new Error('Request failed with status code 409'), {
    response: {
      status: 409,
      data: {
        statusCode: 409,
        code: 'duplicate_item',
        message: 'This item is already on this visit for this pet.',
        duplicates: DUPLICATES,
      },
    },
  });

const order = {
  id: 'order-1',
  encounterId: 'enc-1',
  patientId: 7,
  name: 'Private cremation',
  kind: 'treatment',
  catalogItemId: 77,
  catalogItemType: 'procedure',
  qty: 1,
  unitPrice: 150,
  state: 'accepted',
  isCovered: false,
};

const estimate = {
  id: 'e1',
  practiceId: 1,
  appointmentId: 5,
  patientId: 7,
  clientId: 3,
  estimateNumber: 4,
  status: 'sent',
  subtotal: 0,
  taxTotal: 0,
  total: 0,
  membershipAdjustments: 0,
  lines: [],
  created: '2026-11-03T00:00:00Z',
} as any;

let post: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(searchItems).mockResolvedValue([HIT]);
  vi.mocked(listBundles).mockResolvedValue([]);
  post = vi.spyOn(http, 'post');
  vi.spyOn(http, 'get').mockResolvedValue({ data: [] } as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** First POST is the 409; a resend (if any) succeeds with `body`. */
function conflictThen(body: unknown) {
  post.mockImplementation(async (_url: string, data: any) => {
    if (data?.confirmDuplicate === true) return { data: body } as any;
    throw conflict();
  });
}

async function search(placeholder: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: 'cremation' },
  });
  const name = await screen.findByText(
    'Private cremation',
    { selector: '.soap-plan-result-name, .estimate-hit-name' },
    { timeout: 2000 }
  );
  fireEvent.click(name.closest('button')!);
}

async function expectWarningListsEntries() {
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('Already on this visit');
  expect(dialog.textContent).toContain('Estimate: Private cremation');
  return dialog;
}

const sentBodies = () => post.mock.calls.map((c) => c[1] as Record<string, unknown>);

function renderSoap(mode: 'plan' | 'checkout') {
  const onChange = vi.fn();
  render(
    <AppDialogProvider>
      <PlanOrdersSection
        encounterId="enc-1"
        orders={[]}
        practiceId={1}
        onChange={onChange}
        onInvoiceShouldRefresh={() => {}}
        {...(mode === 'checkout'
          ? { showList: false, showSearch: true, className: 'soap-checkout-add', searchPlaceholder: 'Add a charge for Pip' }
          : {})}
      />
    </AppDialogProvider>
  );
  return { onChange, placeholder: mode === 'checkout' ? 'Add a charge for Pip' : 'Type here to add a charge, or a note…' };
}

describe('EMR-10-8 duplicate warning dialog', () => {
  for (const mode of ['plan', 'checkout'] as const) {
    const where = mode === 'plan' ? 'SOAP order add' : 'checkout add-line';

    it(`${where}: Add anyway resends with confirmDuplicate`, async () => {
      conflictThen(order);
      const { placeholder } = renderSoap(mode);
      await search(placeholder);
      await expectWarningListsEntries();
      fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));

      await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
      expect(post.mock.calls[0][0]).toBe('/soap-encounters/enc-1/orders');
      expect(sentBodies()[0].confirmDuplicate).toBeUndefined();
      expect(post.mock.calls[1][0]).toBe('/soap-encounters/enc-1/orders');
      expect(sentBodies()[1]).toMatchObject({ name: 'Private cremation', confirmDuplicate: true });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it(`${where}: Cancel adds nothing and shows no error`, async () => {
      conflictThen(order);
      const { onChange, placeholder } = renderSoap(mode);
      await search(placeholder);
      await expectWarningListsEntries();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(post).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByText(/Not added|already on this visit/i)).toBeNull();
    });
  }

  it('estimate editor: Add anyway resends with confirmDuplicate', async () => {
    const withLine = {
      ...estimate,
      lines: [{ id: 'l2', description: 'Private cremation', qty: 1, unitPrice: 150, amount: 150 }],
    };
    conflictThen(withLine);
    const onChange = vi.fn();
    render(
      <AppDialogProvider>
        <EstimateWorkspace estimate={estimate} onChange={onChange} patientId={7} lockPatient />
      </AppDialogProvider>
    );
    await search('Search services, packages, or products…');
    await expectWarningListsEntries();
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(withLine));
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/visit-estimates/e1/lines', '/visit-estimates/e1/lines']);
    expect(sentBodies()[0].confirmDuplicate).toBeUndefined();
    expect(sentBodies()[1]).toMatchObject({ description: 'Private cremation', confirmDuplicate: true });
  });

  it('estimate editor: Cancel adds nothing and shows no error', async () => {
    conflictThen(estimate);
    const onChange = vi.fn();
    render(
      <AppDialogProvider>
        <EstimateWorkspace estimate={estimate} onChange={onChange} patientId={7} lockPatient />
      </AppDialogProvider>
    );
    await search('Search services, packages, or products…');
    await expectWarningListsEntries();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/Not added/i)).toBeNull();
  });

  it('invoice add-line: Add anyway resends with confirmDuplicate; Cancel adds nothing', async () => {
    const invoice = { id: 'inv-1', lines: [] };
    conflictThen(invoice);
    render(<AppDialogProvider>{null}</AppDialogProvider>);
    const line = { description: 'Private cremation', qty: 1, catalogItemId: 77, catalogItemType: 'procedure', miscCharge: true } as any;

    const added = addCounterInvoiceLine('inv-1', line);
    await expectWarningListsEntries();
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    await expect(added).resolves.toEqual(invoice);
    expect(sentBodies()[1]).toMatchObject({ confirmDuplicate: true });

    post.mockClear();
    const cancelled = addCounterInvoiceLine('inv-1', line).catch((e) => e);
    await expectWarningListsEntries();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(isDuplicateItemSkipped(await cancelled)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('automatic paths skip: duplicates "skip" never asks and never resends', async () => {
    conflictThen({ id: 'inv-1' });
    render(<AppDialogProvider>{null}</AppDialogProvider>);
    const result = await addCounterInvoiceLine(
      'inv-1',
      { description: 'Private cremation', qty: 1, catalogItemId: 77, catalogItemType: 'procedure' } as any,
      { duplicates: 'skip' }
    ).catch((e) => e);
    expect(isDuplicateItemSkipped(result)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });
});

/**
 * F14 / F4 (EMR-10-9, EMR-11 Cypress): the catalog result sends the procedure id and its price; only the
 * always-present "Add as note: <typed text>" row sends no catalogItemId and $0. That row also contains the
 * typed name, so a spec must leave it out (`.soap-plan-result:not(.soap-plan-result-note)`).
 */
describe('EMR-10-9 SOAP plan search: catalog result vs the note row', () => {
  const NAME = 'Private cremation EMRTEST-1';
  // Shape of GET /room-loader/items/search for a procedure (ProcedureMapper sets id via BaseMapper).
  const apiHit = {
    name: NAME,
    code: NAME,
    itemType: 'procedure',
    price: 125,
    originalPrice: 125,
    procedure: { id: 872, name: NAME, code: NAME, price: 125, pimsType: 'EMRTEST', isActive: true, isDeleted: false },
  } as any;

  async function typeFullName() {
    vi.mocked(searchItems).mockResolvedValue([apiHit]);
    post.mockResolvedValue({ data: { ...order, name: NAME, catalogItemId: 872, unitPrice: 125 } } as any);
    renderSoap('plan');
    fireEvent.change(screen.getByPlaceholderText('Type here to add a charge, or a note…'), {
      target: { value: NAME },
    });
    await screen.findByText(NAME, { selector: '.soap-plan-result-name' }, { timeout: 2000 });
  }

  it('the spec selector picks the catalog row, which posts catalogItemId and the price', async () => {
    await typeFullName();
    const rows = Array.from(
      document.querySelectorAll('.soap-plan-result:not(.soap-plan-result-note) .soap-plan-result-name'),
    ).filter((el) => el.textContent?.includes(NAME));
    expect(rows).toHaveLength(1);
    fireEvent.click(rows[0].closest('.soap-plan-result')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0]).toMatchObject({ catalogItemId: 872, catalogItemType: 'procedure', unitPrice: 125 });
  });

  it('the note row also contains the name and posts no catalogItemId at $0 (what the specs caught)', async () => {
    await typeFullName();
    const note = document.querySelector('.soap-plan-result-note .soap-plan-result-name')!;
    expect(note.textContent).toContain(NAME);
    fireEvent.click(note.closest('button')!);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(sentBodies()[0].catalogItemId).toBeUndefined();
    expect(sentBodies()[0]).toMatchObject({ kind: 'note', catalogItemType: 'custom', unitPrice: 0 });
  });
});
