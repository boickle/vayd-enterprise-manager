/**
 * Owner decisions (Oct 29, 2026): an owner who wasn't at the visit signs the membership
 * agreement from an emailed link; nothing is charged or refunded until they sign.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import MembershipAgreementSignPage from './MembershipAgreementSignPage';

const getPublicMembershipAgreement = vi.fn();
const signPublicMembershipAgreement = vi.fn();
vi.mock('../api/memberships', () => ({
  getPublicMembershipAgreement: (...a: unknown[]) => getPublicMembershipAgreement(...a),
  signPublicMembershipAgreement: (...a: unknown[]) => signPublicMembershipAgreement(...a),
}));
vi.mock('../components/SignaturePad', () => ({
  default: ({ onChange }: { onChange: (d: string) => void }) => (
    <button type="button" onClick={() => onChange('data:image/png;base64,AAA')}>
      draw
    </button>
  ),
}));

const pending = {
  status: 'pending',
  kind: 'post_visit_signup',
  practiceName: 'Vet At Your Door',
  petName: 'Pepper',
  planName: 'Canine Foundations - Monthly',
  summary: {
    petName: 'Pepper',
    planName: 'Canine Foundations - Monthly',
    billingInterval: 'monthly',
    price: 59,
    refundDue: 420.13,
    balanceDue: 0,
    subscriptionAmount: 0,
  },
  agreementText: 'Vet At Your Door Membership Agreement\n\nFoundations: one annual wellness exam.',
  expiresAt: '2026-10-30T18:00:00.000Z',
  signedName: null,
  signedAt: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/membership-agreement/tok123']}>
      <Routes>
        <Route path="/membership-agreement/:token" element={<MembershipAgreementSignPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getPublicMembershipAgreement.mockReset();
  signPublicMembershipAgreement.mockReset();
});

it('shows the plan, the refund and the saved agreement text, and signs once everything is filled in', async () => {
  getPublicMembershipAgreement.mockResolvedValue(pending);
  signPublicMembershipAgreement.mockResolvedValue({ status: 'completed' });
  renderPage();

  expect(await screen.findByText(/we'll refund \$420\.13 to\s+your card once you sign/)).toBeInTheDocument();
  expect(screen.getByText('Nothing is charged or refunded until you sign.')).toBeInTheDocument();
  expect(screen.getByText('Foundations: one annual wellness exam.')).toBeInTheDocument();
  const sign = screen.getByRole('button', { name: 'Sign agreement' });
  expect(sign).toBeDisabled();

  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'draw' }));
  fireEvent.change(screen.getByPlaceholderText(/full legal name/), { target: { value: 'Pat Owner' } });
  expect(sign).not.toBeDisabled();
  fireEvent.click(sign);

  await waitFor(() =>
    expect(signPublicMembershipAgreement).toHaveBeenCalledWith('tok123', {
      accepted: true,
      signedName: 'Pat Owner',
      signatureDataUrl: 'data:image/png;base64,AAA',
    }),
  );
  expect(await screen.findByText(/Pepper's membership is active/)).toBeInTheDocument();
  expect(screen.getByText(/refund of \$420\.13 should show up on your card within 5 business days/)).toBeInTheDocument();
});

it('if the signup needs staff, the owner is thanked and told the team will finish', async () => {
  getPublicMembershipAgreement.mockResolvedValue(pending);
  signPublicMembershipAgreement.mockResolvedValue({ status: 'failed' });
  renderPage();
  await screen.findByRole('button', { name: 'Sign agreement' });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'draw' }));
  fireEvent.change(screen.getByPlaceholderText(/full legal name/), { target: { value: 'Pat Owner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign agreement' }));
  expect(await screen.findByText(/Our team will finish setting up the membership/)).toBeInTheDocument();
});

it('an expired link asks them to contact us', async () => {
  getPublicMembershipAgreement.mockResolvedValue({ ...pending, status: 'expired' });
  renderPage();
  expect(await screen.findByText(/This link has expired/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign agreement' })).toBeNull();
});
