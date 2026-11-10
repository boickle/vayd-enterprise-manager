import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// "Owner paid — refund visit" is for a family that signed up online after paying a visit (MEM-05). A membership
// staff enrolled at the visit (fee on the invoice, Nov 10, 2026) priced that visit as a member already, so the
// offer must not appear: following it would refund a correctly priced visit.

let membership: Record<string, unknown> = {};
const now = new Date();

vi.mock('../../api/memberships', async (orig) => ({
  ...(await orig<typeof import('../../api/memberships')>()),
  getPatientMembership: vi.fn(async () => membership),
  listPatientMemberships: vi.fn(async () => [membership]),
  getPatientMembershipAudit: vi.fn(async () => []),
  listBundles: vi.fn(async () => []),
}));
vi.mock('../../api/visitWorkflow', () => ({
  getClientCardOnFile: vi.fn(async () => null),
  listClientVisitInvoices: vi.fn(async () => [
    { id: 'inv-1', status: 'paid', amountPaid: 91.02, patientId: 9, paidAt: new Date(now.getTime() - 10 * 60_000).toISOString(), lines: [] },
  ]),
}));
vi.mock('../../api/practiceSettings', async (orig) => ({
  ...(await orig<typeof import('../../api/practiceSettings')>()),
  getPracticeSettings: vi.fn(async () => ({})),
}));
vi.mock('../../api/chatHoursOfOperation', () => ({ fetchChatHoursOfOperation: vi.fn(async () => null) }));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ token: null, role: ['employee'] }) }));
vi.mock('../../permissions/PermissionContext', () => ({ useCan: () => true }));
vi.mock('../../utils/staffUiPrefs', async (orig) => ({
  ...(await orig<typeof import('../../utils/staffUiPrefs')>()),
  readStaffPatientLayout: () => ({ membership: true }),
}));
vi.mock('./MembershipAgreementRequests', () => ({ default: () => null }));
vi.mock('../MembershipCardUpdate', () => ({ default: () => <div>BILLING CARD BOX</div> }));

import PatientMembershipPanel from './PatientMembershipPanel';

function member(createdByEmployeeId: number | null, extra: Record<string, unknown> = {}) {
  return {
    id: 41, practiceId: 1, patientId: 9, patientName: 'Juniper', packageId: 10,
    planName: 'Membership - Feline Foundations - Monthly', planTier: null, status: 'active',
    startDate: new Date(now.getTime() - 30 * 60_000).toISOString(),
    expirationDate: '2027-11-10T15:00:00.000Z', billingInterval: 'monthly', price: 59,
    outOfPlanDiscount: null, onlineStoreDiscount: null, stripeSubscriptionId: 'sub_1', notes: null,
    createdByEmployeeId, isScoutManaged: true, membershipFeePaid: true, benefitsPaused: null,
    awaitingPayment: null, ownerChange: null, groups: [], usage: [], ...extra,
  };
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <PatientMembershipPanel patientId={9} practiceId={1} clientId={3} patientName="Juniper" />
    </MemoryRouter>,
  );
}

describe('refund-visit offer and awaiting-payment screen', () => {
  it('still offers it for an online signup with a visit paid just before', async () => {
    membership = member(null);
    renderPanel();
    expect(await screen.findByText(/Owner paid/)).toBeTruthy();
  });

  it('does not offer it when staff enrolled the pet at the visit', async () => {
    membership = member(5);
    renderPanel();
    await screen.findByText('BILLING CARD BOX');
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(/Owner paid/)).toBeNull();
  });

  it('while awaiting payment: no old counter-invoice note and no billing card box', async () => {
    membership = member(5, {
      stripeSubscriptionId: null,
      membershipFeePaid: false,
      awaitingPayment: { invoiceId: 'inv-1', since: now.toISOString() },
    });
    renderPanel();
    await screen.findByText('Awaiting payment.');
    await waitFor(() => expect(screen.queryByText(/counter invoice/)).toBeNull());
    expect(screen.queryByText('BILLING CARD BOX')).toBeNull();
  });
});
