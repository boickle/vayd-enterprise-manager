import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import VisitCheckoutPage from './VisitCheckoutPage';

vi.mock('../components/RoomLoaderPdfCanvas', () => ({ default: () => null }));
vi.mock('../utils/extractUploadText', () => ({}));
vi.mock('../utils/householdChartPdfs', () => ({}));
vi.mock('../components/records/RecordDocumentsReview', () => ({ default: () => null }));
const panelProps = vi.fn();
vi.mock('../api/visitWorkflow', async (orig) => ({
  ...((await orig()) as object),
  createEncounter: async () => ({ id: 'enc-1' }),
  getInvoiceByAppointment: async () => ({ id: 'inv-1', patientId: 7, lines: [] }),
  getHouseholdRoster: async () => [{ patientId: 7, patientName: 'Hazel' }],
  listOrders: async () => [],
}));
vi.mock('../api/visitWrapUp', () => ({ getVisitWrapUp: async () => null }));
vi.mock('../api/appointments', () => ({ fetchAppointmentById: async () => null }));
vi.mock('../api/consent', () => ({ getEuthanasiaConsentStatus: async () => null }));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: {} }) }));
vi.mock('../utils/visitRealtime', () => ({
  peerPresenceCaption: () => '',
  subscribeVisit: () => ({ close: () => undefined }),
}));
vi.mock('../components/followUps/ScheduleFollowUpsPlanner', () => ({ default: () => null }));
vi.mock('../components/invoice/EmployerPromotionLine', () => ({ default: () => null }));
vi.mock('../components/soap/DeathWrapUpModal', () => ({ default: () => null }));
vi.mock('../components/soap/CheckoutReminders', () => ({
  default: ({ pets }: { pets: { patientName: string }[] }) => (
    <div data-testid="reminders">reminders for {pets.map((p) => p.patientName).join(',')}</div>
  ),
}));
vi.mock('../components/soap/VisitCheckoutPanel', async (orig) => ({
  ...((await orig()) as object),
  default: (props: Record<string, unknown>) => {
    panelProps(props);
    return <div data-testid="panel" />;
  },
}));

describe('checkout page reminders placement', () => {
  it('renders Reminders in the left pane after Follow-up and not in the panel', async () => {
    render(
      <MemoryRouter initialEntries={['/schedule/soap/1/7/checkout']}>
        <Routes>
          <Route path="/schedule/soap/:appointmentId/:patientId/checkout" element={<VisitCheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const reminders = await screen.findByTestId('reminders');
    const pane = reminders.closest('.soap-checkout-page__pane') as HTMLElement;
    expect(pane).toBeTruthy();
    const heading = screen.getByRole('heading', { name: /Follow-up/ });
    expect(pane.contains(heading)).toBe(true);
    expect(heading.compareDocumentPosition(reminders) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reminders.textContent).toContain('Hazel');
    const panel = await screen.findByTestId('panel');
    expect(pane.contains(panel)).toBe(false);
    await waitFor(() => expect(panelProps).toHaveBeenCalled());
    expect(panelProps.mock.calls.at(-1)![0]).toMatchObject({ remindersInPanel: false });
  });
});
