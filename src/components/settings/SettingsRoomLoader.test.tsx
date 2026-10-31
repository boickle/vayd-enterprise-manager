// RL-06-5: an outdoor FeLV equivalent added in Settings is saved, reloaded and used.
// Also RL-04: the panel "done within N months" setting is editable.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { vaydRoomLoaderConfigSeed } from '../../utils/roomLoaderConfigSeed';
import { resolvePetPlan } from '../../utils/roomLoaderOfferEngine';
import type { RoomLoaderConfig } from '../../utils/roomLoaderConfigTypes';

let stored: RoomLoaderConfig;
const saveMock = vi.fn(async (c: RoomLoaderConfig) => {
  stored = JSON.parse(JSON.stringify(c));
  return stored;
});

vi.mock('../../api/roomLoaderConfig', async (orig) => {
  const actual = await orig<typeof import('../../api/roomLoaderConfig')>();
  return {
    ...actual,
    ensureRoomLoaderConfigSeeded: vi.fn(async () => JSON.parse(JSON.stringify(stored))),
    saveRoomLoaderConfig: (c: RoomLoaderConfig) => saveMock(c),
  };
});
vi.mock('../../api/memberships', () => ({
  listBundles: vi.fn(async () => []),
  getBundle: vi.fn(async () => null),
}));
vi.mock('../pims/detail/SpeciesBreedFields', () => ({ useSpeciesCatalog: () => [] }));
vi.mock('../catalog/CatalogItemPicker', () => ({
  default: ({ value, onChange }: any) => (
    <div data-testid="picker">
      {value ? <span>{value.code}</span> : null}
      <button
        type="button"
        onClick={() =>
          onChange({ itemType: 'inventory', catalogItemId: 4444, name: 'FeLV Test Equivalent', code: 'FELVTEST', price: null })
        }
      >
        pick-test-item
      </button>
    </div>
  ),
}));
vi.mock('../../pages/roomLoader/LabPanelsSection', () => ({ default: () => null }));

import SettingsRoomLoader from './SettingsRoomLoader';

beforeEach(() => {
  stored = JSON.parse(JSON.stringify(vaydRoomLoaderConfigSeed()));
  stored.outdoor.equivalentItems = [];
  saveMock.mockClear();
});

async function openOutdoor() {
  render(<SettingsRoomLoader practiceId={1} />);
  const heading = await screen.findByText('Outdoor question');
  fireEvent.click(heading);
  return heading.closest('section')!;
}

describe('SettingsRoomLoader outdoor equivalents (RL-06-5)', () => {
  it('adds an equivalent, saves it, keeps it after reload, and the engine uses it', async () => {
    const section = await openOutdoor();
    const scope = within(section as HTMLElement);
    fireEvent.click(scope.getByRole('button', { name: /add an item/i }));
    const rows = (section as HTMLElement).querySelectorAll('.rl-cfg__item-row');
    fireEvent.click(within(rows[rows.length - 1] as HTMLElement).getByText('pick-test-item'));
    fireEvent.click(screen.getByRole('button', { name: /save room loader settings/i }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0][0].outdoor.equivalentItems?.map((i) => i.code)).toEqual(['FELVTEST']);

    // Reload: a fresh mount reads the saved document.
    document.body.innerHTML = '';
    const again = await openOutdoor();
    expect(within(again as HTMLElement).getByText('FELVTEST')).toBeTruthy();

    const asOf = DateTime.fromISO('2026-10-30T00:00:00');
    const plan = resolvePetPlan(stored, {
      species: 'cat', ageMonths: 48, outdoorAccess: true, medicalConcern: false, asOf,
      reminders: [], estimateLines: [],
      history: [{ itemType: 'inventory', itemId: 4444, code: 'FELVTEST', date: '2026-08-01' }],
    });
    expect(plan.outdoorPitch).toBeNull();
  });

  it('shows and edits the panel "done within N months" setting', async () => {
    render(<SettingsRoomLoader practiceId={1} />);
    fireEvent.click(await screen.findByText('Adult dog early detection'));
    const inputs = await screen.findAllByLabelText(/this panel was done in the last/i);
    expect(inputs.length).toBeGreaterThan(0);
    const input = inputs[0] as HTMLInputElement;
    expect(input.value).toBe('10');
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /save room loader settings/i }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const saved = saveMock.mock.calls[0][0].panelRules.find((r) => r.id === 'r_early_dog');
    expect(saved?.suppressIfDoneWithinMonths).toBe(8);
  });
});
