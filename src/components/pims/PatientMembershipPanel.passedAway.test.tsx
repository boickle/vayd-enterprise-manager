import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// P-15: after a pet was marked passed away, its Membership section still offered "Enroll in a plan"
// and "Post-appointment sign-up".

vi.mock('../../api/memberships', async (orig) => ({
  ...(await orig<typeof import('../../api/memberships')>()),
  getPatientMembership: vi.fn(async () => null),
  listPatientMemberships: vi.fn(async () => []),
  getPatientMembershipAudit: vi.fn(async () => []),
  listBundles: vi.fn(async () => []),
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
vi.mock('./MembershipAgreementRequests', () => ({ default: () => null }));

import PatientMembershipPanel from './PatientMembershipPanel';

function renderPanel(patientPassedAway: boolean) {
  return render(
    <MemoryRouter>
      <PatientMembershipPanel
        patientId={9}
        practiceId={1}
        clientId={3}
        patientName="Pepper"
        patientPassedAway={patientPassedAway}
      />
    </MemoryRouter>,
  );
}

describe('Membership section for a pet that passed away (P-15)', () => {
  it('offers enrolling while the pet is active', async () => {
    renderPanel(false);
    expect(await screen.findByText('Enroll in a plan')).toBeTruthy();
    expect(screen.getByText('Post-appointment sign-up')).toBeTruthy();
  });

  it('hides both and says why once the pet has passed away', async () => {
    renderPanel(true);
    expect(await screen.findByText('Not available: Pepper has passed away.')).toBeTruthy();
    expect(screen.queryByText('Enroll in a plan')).toBeNull();
    expect(screen.queryByText('Post-appointment sign-up')).toBeNull();
  });
});
