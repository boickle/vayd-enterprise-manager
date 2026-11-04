import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AddressChangeVisitsWarning, upcomingVisitsFromWrite } from './AddressChangeVisitsWarning';

const visits = [
  {
    id: 11,
    start: '2026-11-10T14:00:00.000Z',
    providerId: 5,
    providerName: 'Ann B.',
    zoneChanged: true,
  },
  {
    id: 12,
    start: '2026-11-12T18:00:00.000Z',
    providerId: 6,
    providerName: 'Cy D.',
    zoneChanged: true,
  },
];

describe('SCH-A11-2 address change warning', () => {
  it('lists each visit with a calendar link, doctor and the route line', () => {
    render(
      <MemoryRouter>
        <AddressChangeVisitsWarning visits={visits} />
      </MemoryRouter>
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toContain('focusAppt=11');
    expect(links[1].getAttribute('href')).toContain('focusAppt=12');
    expect(screen.getByText(/with Ann B\./)).toBeTruthy();
    expect(
      screen.getByText(/Check these visits: the route for those days will change\./)
    ).toBeTruthy();
  });

  it('says so when the address is outside the service area', () => {
    render(
      <MemoryRouter>
        <AddressChangeVisitsWarning visits={[{ ...visits[0], outsideServiceArea: true }]} />
      </MemoryRouter>
    );
    expect(screen.getByText(/outside the service area/)).toBeTruthy();
  });

  it('shows nothing for an empty list, and reads the list off a write response', () => {
    const { container } = render(
      <MemoryRouter>
        <AddressChangeVisitsWarning visits={[]} />
      </MemoryRouter>
    );
    expect(container.textContent).toBe('');
    expect(upcomingVisitsFromWrite({ upcomingVisitsAffected: visits })).toHaveLength(2);
    expect(upcomingVisitsFromWrite({})).toEqual([]);
    expect(upcomingVisitsFromWrite(null)).toEqual([]);
  });
});
