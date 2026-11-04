import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VisitCheckoutPanel from './VisitCheckoutPanel';

vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: {}, employeeId: 1 }) }));
vi.mock('./CheckoutReminders', () => ({
  default: () => <div data-testid="reminders" />,
}));
vi.mock('../RoomLoaderPdfCanvas', () => ({ default: () => null }));
vi.mock('../../utils/extractUploadText', () => ({}));
vi.mock('../../utils/householdChartPdfs', () => ({}));
vi.mock('../records/RecordDocumentsReview', () => ({ default: () => null }));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  usePermissions: () => ({ effective: null }),
}));

const invoice = { id: 'inv-1', patientId: 7, status: 'open', lines: [] } as never;
const base = {
  invoice,
  patientId: 7,
  roster: [{ patientId: 7, patientName: 'Hazel' }],
  practiceId: 1,
  onInvoiceChange: () => {},
} as never;

describe('checkout panel: Follow-up then Reminders', () => {
  it('renders followUpSlot before the reminders', () => {
    render(<VisitCheckoutPanel {...(base as object)} followUpSlot={<div data-testid="follow" />} />);
    const follow = screen.getByTestId('follow');
    const rem = screen.getByTestId('reminders');
    expect(follow.compareDocumentPosition(rem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits reminders when the page renders them itself', () => {
    render(<VisitCheckoutPanel {...(base as object)} remindersInPanel={false} />);
    expect(screen.queryByTestId('reminders')).toBeNull();
  });
});
