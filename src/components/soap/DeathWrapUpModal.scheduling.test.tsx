/**
 * SCH-08 (D5): the inactivation wrap-up lists the pet's pending follow-ups, open text offers and
 * waitlist rows next to its other groups.
 */
import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../utils/deathWrapUp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/deathWrapUp')>();
  return {
    ...actual,
    acceptDeathWrapUpHousehold: vi.fn().mockResolvedValue({ errors: [] }),
  };
});

import DeathWrapUpModal from './DeathWrapUpModal';
import { deathWrapUpHasWork, type DeathWrapUpPreview } from '../../utils/deathWrapUp';

const base = {
  patientId: 7,
  patientName: 'Rex',
  memberships: [],
  autoships: [],
  reminders: [],
  futureAppointments: [],
  prescriptions: [],
  mailOrders: [],
  followUps: [],
  textOffers: [],
  waitlist: [],
  moneyOnVisitMembershipIds: [],
  visitMoneyCheckFailed: false,
} as unknown as DeathWrapUpPreview;

function section(heading: string): HTMLElement {
  return screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement;
}

describe('DeathWrapUpModal — SCH-08 scheduling groups', () => {
  it('lists one follow-up, one text offer and one waitlist row with their counts', () => {
    const preview = {
      ...base,
      followUps: [
        { id: 11, appointmentTypeName: 'Recheck', targetDueDate: '2026-11-20T15:00:00.000Z' },
      ],
      textOffers: [
        {
          id: 'offer-1',
          offeredSlotDatetime: '2026-11-12T15:00:00.000Z',
          appointmentTypeName: 'Medical Visit',
          otherPetNames: [],
          action: 'expire',
        },
      ],
      waitlist: [{ id: 21, appointmentTypeName: 'Wellness', otherPetNames: [], action: 'remove' }],
    } as unknown as DeathWrapUpPreview;

    render(
      <DeathWrapUpModal
        previews={[preview]}
        kind="inactivate"
        onClose={() => {}}
        onAccepted={() => {}}
      />
    );

    expect(within(section('Removing 1 follow-up')).getByText('Recheck')).toBeInTheDocument();
    const offers = section('Expiring 1 text offer');
    expect(within(offers).getByText(/Medical Visit/)).toBeInTheDocument();
    expect(within(offers).getByText('The link stops working')).toBeInTheDocument();
    const waitlist = section('Removing 1 waitlist entry');
    expect(within(waitlist).getByText('Wellness')).toBeInTheDocument();
    expect(deathWrapUpHasWork(preview)).toBe(true);
  });

  it('says a shared offer and waitlist row stay open for the housemate', () => {
    const preview = {
      ...base,
      textOffers: [
        {
          id: 'offer-2',
          offeredSlotDatetime: '2026-11-12T15:00:00.000Z',
          appointmentTypeName: 'Wellness',
          otherPetNames: ['Birch'],
          action: 'remove_pet',
        },
      ],
      waitlist: [
        { id: 22, appointmentTypeName: 'Wellness', otherPetNames: ['Birch'], action: 'remove_pet' },
      ],
    } as unknown as DeathWrapUpPreview;

    render(
      <DeathWrapUpModal
        previews={[preview]}
        kind="inactivate"
        onClose={() => {}}
        onAccepted={() => {}}
      />
    );

    expect(
      within(section('Taking Rex off 1 shared text offer')).getByText('Stays open for Birch')
    ).toBeInTheDocument();
    expect(
      within(section('Taking Rex off 1 shared waitlist entry')).getByText(
        'Stays on the waitlist for Birch'
      )
    ).toBeInTheDocument();
  });

  it('shows the empty groups and counts no work when there is nothing to close', () => {
    render(
      <DeathWrapUpModal
        previews={[base]}
        kind="inactivate"
        onClose={() => {}}
        onAccepted={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Follow-ups' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Text offers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waitlist entries' })).toBeInTheDocument();
    expect(deathWrapUpHasWork(base)).toBe(false);
  });
});
