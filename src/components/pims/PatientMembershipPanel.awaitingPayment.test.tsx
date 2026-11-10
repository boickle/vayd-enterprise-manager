import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Enroll at the visit puts the first fee on the visit invoice (owner decision, Nov 10, 2026). Until that invoice
// is paid the Membership section says so, and Cancel enrollment undoes it.

const membership = {
  id: 41,
  practiceId: 1,
  patientId: 9,
  patientName: 'Juniper',
  packageId: 10,
  planName: 'Membership - Feline Foundations - Monthly',
  planTier: null,
  status: 'active',
  startDate: '2026-11-10T15:00:00.000Z',
  expirationDate: '2027-11-10T15:00:00.000Z',
  billingInterval: 'monthly',
  price: 59,
  outOfPlanDiscount: null,
  onlineStoreDiscount: null,
  stripeSubscriptionId: null,
  notes: null,
  createdByEmployeeId: 5,
  isScoutManaged: true,
  membershipFeePaid: false,
  benefitsPaused: null,
  awaitingPayment: { invoiceId: 'inv-1', since: '2026-11-10T15:00:00.000Z' },
  ownerChange: null,
  groups: [],
  usage: [],
};
const cancelMembershipEnrolment = vi.fn(async () => ({ removed: true, invoiceId: 'inv-1' }));
const listPatientMemberships = vi.fn(async () => [membership]);

vi.mock('../../api/memberships', async (orig) => ({
  ...(await orig<typeof import('../../api/memberships')>()),
  getPatientMembership: vi.fn(async () => membership),
  listPatientMemberships: () => listPatientMemberships(),
  getPatientMembershipAudit: vi.fn(async () => []),
  listBundles: vi.fn(async () => []),
  cancelMembershipEnrolment: (id: number) => cancelMembershipEnrolment(id),
}));
vi.mock('../../api/visitWorkflow', () => ({
  getClientCardOnFile: vi.fn(async () => null),
  listClientVisitInvoices: vi.fn(async () => []),
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
vi.mock('../../utils/appDialog', () => ({
  appAlert: vi.fn(async () => undefined),
  appConfirm: vi.fn(async () => true),
  appPrompt: vi.fn(async () => null),
}));
vi.mock('./MembershipAgreementRequests', () => ({ default: () => null }));
vi.mock('../MembershipCardUpdate', () => ({ default: () => null }));

import PatientMembershipPanel from './PatientMembershipPanel';

describe('Membership section while the fee on the visit invoice is unpaid', () => {
  beforeEach(() => {
    cancelMembershipEnrolment.mockClear();
    listPatientMemberships.mockClear();
  });

  it('says it is awaiting payment, and Cancel enrollment undoes it', async () => {
    render(
      <MemoryRouter>
        <PatientMembershipPanel patientId={9} practiceId={1} clientId={3} patientName="Juniper" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Awaiting payment.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel enrollment' }));
    await waitFor(() => expect(cancelMembershipEnrolment).toHaveBeenCalledWith(41));
    // Reloads the section afterwards.
    await waitFor(() => expect(listPatientMemberships.mock.calls.length).toBeGreaterThan(1));
  });
});
