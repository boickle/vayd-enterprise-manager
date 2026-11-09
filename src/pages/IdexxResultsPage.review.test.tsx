/**
 * Owner follow-ups, Nov 8, 2026 (docs/training/labs.md):
 * - Unmatched shows a count in the tab bar, like To review.
 * - To review leaves out results with no pet; once matched they move to To review.
 * - "Which pet is this?" names the owner, so two pets called Bella can be told apart.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listIdexxResults = vi.fn();
vi.mock('../permissions/PermissionContext', () => ({
  usePermissions: () => ({ effective: {}, can: () => true, hasRole: () => false, isLicensed: true, licenseType: 'veterinarian' }),
  useCan: () => true,
}));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ role: 'employee' }) }));
vi.mock('../api/idexx', async () => {
  const actual = await vi.importActual<typeof import('../api/idexx')>('../api/idexx');
  return {
    ...actual,
    listIdexxResults: (q: Record<string, unknown>) => listIdexxResults(q),
    listIdexxOrdersAwaitingLab: vi.fn(async () => []),
    syncIdexxResults: vi.fn(async () => ({})),
  };
});
vi.mock('../api/employee', () => ({ fetchPrimaryProviders: vi.fn(async () => []) }));
vi.mock('../api/patients', () => ({ searchPatientsStaff: vi.fn(async () => []) }));
vi.mock('../components/idexx/IdexxResultView', () => ({ default: () => null, idexxResultStatusLabel: () => '' }));
vi.mock('../components/idexx/IdexxOrderFrame', () => ({ default: () => null }));

import IdexxResultsPage, { petLabel } from './IdexxResultsPage';

describe('IDEXX results tabs', () => {
  beforeEach(() => {
    listIdexxResults.mockReset();
    listIdexxResults.mockImplementation(async (q: Record<string, unknown>) =>
      q.unmatched === true ? { items: [], total: 2 } : { items: [], total: 1 },
    );
  });

  it('shows how many results are unmatched, and To review leaves unmatched results out', async () => {
    render(
      <MemoryRouter>
        <IdexxResultsPage />
      </MemoryRouter>,
    );
    const unmatchedTab = await screen.findByRole('tab', { name: /Unmatched/ });
    await waitFor(() => expect(unmatchedTab.textContent).toMatch(/Unmatched\s*2/));
    const reviewQueries = listIdexxResults.mock.calls
      .map(([q]) => q as Record<string, unknown>)
      .filter((q) => q.unreviewed === true);
    expect(reviewQueries.length).toBeGreaterThan(0);
    for (const q of reviewQueries) expect(q.unmatched).toBe(false);
  });
});

describe('Which pet is this? labels', () => {
  it('names the owner from the search row', () => {
    expect(petLabel({ id: 1, name: 'Bella', clients: [{ firstName: 'Maria', lastName: 'Rivera' }] } as never)).toBe(
      'Bella (Maria Rivera)',
    );
    expect(petLabel({ id: 2, name: 'Bella', clientFirstName: 'Tom', clientLastName: 'Chen' } as never)).toBe('Bella (Tom Chen)');
    expect(petLabel({ id: 3, name: 'Bella' } as never)).toBe('Bella');
  });
});
