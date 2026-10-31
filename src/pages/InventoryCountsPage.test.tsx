/**
 * Viewing Scout as someone is read-only, so the count page shows their open sheet as it is
 * instead of starting one (which view-as blocks, leaving the page blank).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import InventoryCountsPage from './InventoryCountsPage';

const startCountSession = vi.fn();
const getOpenCountSession = vi.fn();
const viewingAs = vi.hoisted(() => ({ value: false }));
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
  patchCountLine: vi.fn(),
  submitCountLine: vi.fn(),
  submitCountSession: vi.fn(),
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
