/**
 * Owner decision Nov 4, 2026: charges never write into the SOAP's Plan narrative. The plan is
 * written by the doctor by hand or by AI Scribe. Adding or removing a medication or a vaccine
 * (an order / invoice line) puts it on the bill only: planNotes is never saved and no
 * "Added … to the plan" toast shows.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppDialogProvider from '../AppDialogProvider';
import PlanOrdersSection from './PlanOrdersSection';
import { http } from '../../api/http';
import { searchItems } from '../../api/roomLoader';
import { listBundles } from '../../api/memberships';
import type { EncounterOrder } from '../../api/visitWorkflow';

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

const MED = {
  name: 'Gabapentin 100mg capsule',
  itemType: 'inventory',
  price: 1.2,
  inventoryItem: { id: 501, name: 'Gabapentin 100mg capsule', price: 1.2 },
} as any;
const VACCINE = {
  name: 'Rabies 3yr vaccine',
  itemType: 'inventory',
  price: 32,
  inventoryItem: {
    id: 502,
    name: 'Rabies 3yr vaccine',
    price: 32,
    isVaccine: true,
    itemCategory: 'Vaccine',
  },
} as any;

function orderFor(item: any, id: string): EncounterOrder {
  return {
    id,
    encounterId: 'enc-1',
    patientId: 7,
    name: item.name,
    kind: 'med',
    catalogItemId: item.inventoryItem.id,
    catalogItemType: 'inventory',
    qty: 1,
    unitPrice: item.price,
    state: 'accepted',
    isCovered: false,
  } as unknown as EncounterOrder;
}

let post: ReturnType<typeof vi.spyOn>;
let patch: ReturnType<typeof vi.spyOn>;
let put: ReturnType<typeof vi.spyOn>;
let del: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(listBundles).mockResolvedValue([]);
  post = vi.spyOn(http, 'post');
  patch = vi.spyOn(http, 'patch').mockResolvedValue({ data: {} } as any);
  put = vi.spyOn(http, 'put').mockResolvedValue({ data: {} } as any);
  del = vi.spyOn(http, 'delete').mockResolvedValue({ data: {} } as any);
  vi.spyOn(http, 'get').mockResolvedValue({ data: [] } as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** No request ever saves the encounter's planNotes. */
function expectPlanNotesUntouched() {
  for (const spy of [post, patch, put]) {
    for (const [url, body] of spy.mock.calls as Array<[string, any]>) {
      expect(
        body && typeof body === 'object' ? 'planNotes' in body : false,
        `${url} sent planNotes`
      ).toBe(false);
    }
  }
  expect(patch.mock.calls.some(([url]) => /^\/soap-encounters\/[^/]+$/.test(String(url)))).toBe(
    false
  );
  expect(screen.queryByText(/to the plan/i)).toBeNull();
}

describe('charges never write the Plan narrative', () => {
  for (const item of [MED, VACCINE]) {
    const what = item === VACCINE ? 'a vaccine' : 'a medication';

    it(`adding ${what} from the SOAP charge search leaves planNotes unchanged`, async () => {
      vi.mocked(searchItems).mockResolvedValue([item]);
      post.mockResolvedValue({ data: orderFor(item, 'o-new') } as any);
      const onChange = vi.fn();
      render(
        <AppDialogProvider>
          <PlanOrdersSection
            encounterId="enc-1"
            orders={[]}
            practiceId={1}
            onChange={onChange}
            onInvoiceShouldRefresh={() => {}}
          />
        </AppDialogProvider>
      );
      fireEvent.change(screen.getByPlaceholderText('Type here to add a charge, or a note…'), {
        target: { value: item.name.slice(0, 8) },
      });
      const hit = await screen.findByText(
        item.name,
        { selector: '.soap-plan-result-name' },
        { timeout: 2000 }
      );
      fireEvent.click(hit.closest('button')!);
      await waitFor(() =>
        expect(post.mock.calls.some(([url]) => url === '/soap-encounters/enc-1/orders')).toBe(true)
      );
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expectPlanNotesUntouched();
    });

    it(`removing ${what} leaves planNotes unchanged`, async () => {
      const onChange = vi.fn();
      render(
        <AppDialogProvider>
          <PlanOrdersSection
            encounterId="enc-1"
            orders={[orderFor(item, 'o-1')]}
            practiceId={1}
            onChange={onChange}
            onInvoiceShouldRefresh={() => {}}
          />
        </AppDialogProvider>
      );
      fireEvent.click(screen.getByTitle('Remove'));
      await waitFor(() => expect(del).toHaveBeenCalled());
      expect(String(del.mock.calls[0][0])).toBe('/soap-encounters/enc-1/orders/o-1');
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expectPlanNotesUntouched();
    });
  }

  it('no screen wires charges into the Plan narrative any more', () => {
    const root = resolve(__dirname, '../..');
    expect(existsSync(resolve(root, 'utils/planNotesSections.ts'))).toBe(false);
    for (const file of [
      'pages/SoapEncounterPage.tsx',
      'components/soap/PlanOrdersSection.tsx',
      'components/soap/VisitCheckoutPanel.tsx',
      'components/soap/ScribeSuggestedPlanItems.tsx',
    ]) {
      const src = readFileSync(resolve(root, file), 'utf8');
      expect(src, file).not.toMatch(
        /appendTreatmentPlanMedicationBullet|removeTreatmentPlanMedicationBullet/
      );
      expect(src, file).not.toMatch(
        /onInventoryItemAdded|onInventoryItemRemoved|skipPlanNarrative/
      );
      expect(src, file).not.toMatch(/to the plan`/);
    }
  });
});
