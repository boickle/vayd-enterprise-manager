/**
 * CP-07 Frontend component tests — H2 harness (Vitest + Testing Library)
 *
 * Covers:
 *   CP-07-13  Hide control in the card: click Hide, confirm → pet leaves, "Show hidden pets" appears
 *   CP-07-14  All pets hidden → card shows "Show hidden pets" but no grid rows
 *   CP-07-15  API returns [] and no hidden pets → component returns null
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, type Mock } from 'vitest';

// Mock the clientPortal API so no real HTTP calls are made.
vi.mock('../../api/clientPortal', () => ({
  togglePetLove: vi.fn(),
  hideRememberedPet: vi.fn().mockResolvedValue(undefined),
  showRememberedPet: vi.fn().mockResolvedValue(undefined),
}));

import RememberedPetsCard from './RememberedPetsCard';
import { hideRememberedPet, showRememberedPet } from '../../api/clientPortal';
import type { RememberedPet } from '../../api/clientPortal';

function makePet(overrides: Partial<RememberedPet> = {}): RememberedPet {
  return {
    id: 1,
    name: 'Bella',
    nickname: null,
    species: 'Canine',
    breed: 'Labrador',
    sex: 'F',
    dob: '2015-03-01T00:00:00.000Z',
    inactiveAt: '2026-09-15T00:00:00.000Z',
    status: 'Euthanized',
    primaryProviderName: null,
    profile: {
      nickname: null,
      favoriteThing: null,
      superpower: null,
      nemesis: null,
      funFact: null,
      keyToMyHeart: null,
      socialMediaConsent: false,
      socialMediaConsentAt: null,
      portalProfileUpdatedAt: null,
      color: null,
      weight: null,
      microchip: null,
    },
    photos: [],
    loves: { count: 0, mine: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CP-07-15  Empty list + no hidden → null render
// ---------------------------------------------------------------------------
describe('RememberedPetsCard — CP-07-15', () => {
  it('renders nothing when the API returns an empty array and nothing is hidden', () => {
    const { container } = render(
      <RememberedPetsCard
        pets={[]}
        onLoves={() => {}}
        onToast={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CP-07-13  Hide control in the card
// ---------------------------------------------------------------------------
describe('RememberedPetsCard — CP-07-13', () => {
  it('shows a Hide button on each pet card', () => {
    render(
      <RememberedPetsCard
        pets={[makePet({ id: 1, name: 'Bella' }), makePet({ id: 2, name: 'Max' })]}
        onLoves={() => {}}
        onToast={() => {}}
      />,
    );
    const hideButtons = screen.getAllByRole('button', { name: /hide/i });
    // One per pet in the grid (aria-label "Hide Bella…" etc.)
    expect(hideButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('opens a confirmation dialog with a gentle message when Hide is clicked', () => {
    render(
      <RememberedPetsCard
        pets={[makePet({ id: 1, name: 'Bella' })]}
        onLoves={() => {}}
        onToast={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /hide bella/i }));
    expect(screen.getByText(/you can bring it back any time/i)).toBeInTheDocument();
  });

  it('removes the pet from the grid after confirming hide', async () => {
    render(
      <RememberedPetsCard
        pets={[makePet({ id: 1, name: 'Bella' }), makePet({ id: 2, name: 'Max' })]}
        onLoves={() => {}}
        onToast={() => {}}
      />,
    );

    // Click Hide on Bella
    fireEvent.click(screen.getByRole('button', { name: /hide bella/i }));
    // Confirm
    fireEvent.click(screen.getByRole('button', { name: /yes, hide it/i }));

    await waitFor(() => {
      expect(screen.queryByText('Bella')).not.toBeInTheDocument();
    });

    // Max still visible
    expect(screen.getByText('Max')).toBeInTheDocument();
    // API called
    expect(hideRememberedPet as Mock).toHaveBeenCalledWith(1);
  });

  it('shows "Show hidden pets" link after a pet is hidden', async () => {
    render(
      <RememberedPetsCard
        pets={[makePet({ id: 1, name: 'Bella' }), makePet({ id: 2, name: 'Max' })]}
        onLoves={() => {}}
        onToast={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /hide bella/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, hide it/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /show hidden pets/i })).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// CP-07-14  All pets hidden
// ---------------------------------------------------------------------------
describe('RememberedPetsCard — CP-07-14', () => {
  it('shows "Show hidden pets" and hides the grid when the only pet is hidden', async () => {
    render(
      <RememberedPetsCard
        pets={[makePet({ id: 1, name: 'Bella' })]}
        onLoves={() => {}}
        onToast={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /hide bella/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, hide it/i }));

    await waitFor(() => {
      expect(screen.queryByText('Bella')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /show hidden pets/i })).toBeInTheDocument();
    });

    // The section is still rendered (so the owner can bring it back), not null.
    expect(screen.getByRole('region', { name: /pets we remember/i })).toBeInTheDocument();
  });

  it('after a reload, pets hidden on the server stay hidden (initialHiddenIds)', () => {
    render(
      <RememberedPetsCard
        pets={[makePet({ id: 1, name: 'Bella' }), makePet({ id: 2, name: 'Max' })]}
        initialHiddenIds={[1]}
        onLoves={() => {}}
        onToast={() => {}}
      />,
    );
    expect(screen.queryByText('Bella')).not.toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show hidden pets/i })).toBeInTheDocument();
  });

  it('shows the pet again when "Show again" is clicked', async () => {
    render(
      <RememberedPetsCard
        pets={[makePet({ id: 1, name: 'Bella' })]}
        onLoves={() => {}}
        onToast={() => {}}
      />,
    );

    // Hide Bella
    fireEvent.click(screen.getByRole('button', { name: /hide bella/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, hide it/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /show hidden pets/i })).toBeInTheDocument();
    });

    // Expand the hidden list
    fireEvent.click(screen.getByRole('button', { name: /show hidden pets/i }));
    expect(screen.getByText('Bella')).toBeInTheDocument();

    // Click "Show again"
    fireEvent.click(screen.getByRole('button', { name: /show again/i }));
    expect(showRememberedPet as Mock).toHaveBeenCalledWith(1);

    await waitFor(() => {
      // Bella is back in the grid
      expect(screen.getAllByText('Bella').length).toBeGreaterThanOrEqual(1);
    });
  });
});
