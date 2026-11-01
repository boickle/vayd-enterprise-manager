/**
 * Viewing Scout as someone is read-only, so the count page shows their open sheet as it is
 * instead of starting one (which view-as blocks, leaving the page blank).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import InventoryCountsPage from './InventoryCountsPage';

const startCountSession = vi.fn();
const getOpenCountSession = vi.fn();
const addWeeklyCountItems = vi.fn();
const viewingAs = vi.hoisted(() => ({ value: false }));
const perms = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: (key: string) => perms.keys.includes(key) }),
}));
vi.mock('../api/roomLoader', () => ({ searchItems: async () => [] }));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ resolvePracticeIdFromToken: () => 1 }));
vi.mock('../auth/impersonationSession', () => ({
  readImpersonation: () => (viewingAs.value ? { target: { name: 'Hailey' } } : null),
}));
vi.mock('../api/branchInventory', () => ({
  listPracticeBranches: async () => [{ id: 4, name: 'Deirdre Home', isActive: true, isDefault: true }],
}));
vi.mock('../api/inventoryCounts', () => ({
  startCountSession: (...a: unknown[]) => startCountSession(...a),
  getOpenCountSession: (...a: unknown[]) => getOpenCountSession(...a),
  getWeeklyCountOffices: async () => 'all' as const,
  patchCountLine: vi.fn(),
  submitCountLine: vi.fn(),
  submitCountSession: vi.fn(),
  addWeeklyCountItems: (...a: unknown[]) => addWeeklyCountItems(...a),
}));

const sheet = {
  id: 9,
  branchId: 4,
  kind: 'weekly',
  status: 'open',
  created: '2026-10-26T11:00:00Z',
  submittedAt: null,
  locations: [{ id: 41, name: 'Main', code: 'MAIN', isDefault: true }],
  lines: [],
};

beforeEach(() => {
  startCountSession.mockReset().mockResolvedValue(sheet);
  getOpenCountSession.mockReset().mockResolvedValue(sheet);
  addWeeklyCountItems.mockReset();
  perms.keys = [];
  viewingAs.value = false;
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <InventoryCountsPage />
    </MemoryRouter>
  );

it('starts or continues the sheet normally', async () => {
  viewingAs.value = false;
  renderPage();
  await waitFor(() => expect(startCountSession).toHaveBeenCalledWith(1, 4, 'weekly'));
  expect(getOpenCountSession).not.toHaveBeenCalled();
});

it('only reads the open sheet while viewing as someone', async () => {
  viewingAs.value = true;
  renderPage();
  await waitFor(() => expect(getOpenCountSession).toHaveBeenCalledWith(1, 4, 'weekly'));
  expect(startCountSession).not.toHaveBeenCalled();
});

it('says when no sheet has started yet, while viewing as someone', async () => {
  viewingAs.value = true;
  getOpenCountSession.mockResolvedValue(null);
  renderPage();
  expect(await screen.findByText(/No weekly count sheet is open for this office yet/)).toBeInTheDocument();
});

describe('+ Add to Weekly Count', () => {
  it('is hidden without the permission', async () => {
    renderPage();
    await waitFor(() => expect(startCountSession).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '+ Add to Weekly Count' })).not.toBeInTheDocument();
  });

  it('is hidden while viewing as someone, even with the permission', async () => {
    perms.keys = ['inventory.count.add_weekly'];
    viewingAs.value = true;
    renderPage();
    await waitFor(() => expect(getOpenCountSession).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '+ Add to Weekly Count' })).not.toBeInTheDocument();
  });

  it('adds the next 10 due and shows who added them', async () => {
    perms.keys = ['inventory.count.add_weekly'];
    addWeeklyCountItems.mockResolvedValue({
      ...sheet,
      weeklyCap: 40,
      lines: [
        {
          id: 1,
          inventoryItemId: 77,
          name: 'Cerenia 24 mg',
          code: 'CER24',
          effectiveAbc: 'A',
          submitted: false,
          addedManually: true,
          addedByName: 'Pat Manager',
          actualTotal: null,
          locations: [
            { id: 0, branchLocationId: 41, name: 'Main', actualQty: null, counted: false },
          ],
        },
      ],
      added: 1,
      alreadyOnSheet: 0,
      notCountable: 0,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '+ Add to Weekly Count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add next 10 due' }));
    await waitFor(() => expect(addWeeklyCountItems).toHaveBeenCalledWith(1, 4, { nextDue: 10 }));
    expect(await screen.findByText('Added 1 item to the weekly count')).toBeInTheDocument();
    expect(screen.getByText('Added by Pat Manager')).toBeInTheDocument();
    expect(screen.getByText(/up to 40 a week, plus any a manager adds/)).toBeInTheDocument();
  });
});
