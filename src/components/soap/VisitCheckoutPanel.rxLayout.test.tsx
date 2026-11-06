/**
 * EMR-07b follow-up: in the narrow checkout column the Rx drawer stacks sig, fields, then an
 * actions row. History must live in the actions row, not in the fields row with the refills input.
 * (jsdom cannot measure layout, so this checks structure; the CSS stacks the rows.)
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutInvoiceRxFields } from './VisitCheckoutPanel';

vi.mock('../records/RecordHistoryLink', () => ({
  default: () => <button type="button" className="record-history-link">History</button>,
}));
vi.mock('../BookPatientChartButton', () => ({
  BookPatientChartButton: ({ label, className }: { label: string; className?: string }) => (
    <button type="button" className={className}>{label}</button>
  ),
}));
// Heavy PDF.js chains pulled in by the panel's other imports; irrelevant to this layout check.
vi.mock('../RoomLoaderPdfCanvas', () => ({ default: () => null }));
vi.mock('../../utils/extractUploadText', () => ({}));
vi.mock('../../utils/householdChartPdfs', () => ({}));
vi.mock('../records/RecordDocumentsReview', () => ({ default: () => null }));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  usePermissions: () => ({ effective: null }),
}));

describe('EMR-07b: checkout Rx drawer layout', () => {
  it('puts History in the actions row, apart from the refills input', () => {
    const line = {
      id: 'line-1',
      description: 'Carprofen 75mg',
      instructions: '1 tab PO q12h',
      instructionsEnteredByName: 'Emr technician',
      instructionsEnteredByEmployeeId: 5,
      trackLots: false,
    } as never;
    const { container } = render(
      <CheckoutInvoiceRxFields
        line={line}
        invoice={{ id: 'inv-1' } as never}
        recorded={null}
        rxName="Carprofen"
        disabled={false}
        scriptApproved={false}
        mailed={false}
        hideLotPicker
        dymoSource={null}
        patientId={7}
        patientName="Hazel"
        onSaved={() => {}}
        onPrescriptionSaved={() => {}}
        onError={() => {}}
        onApproved={() => {}}
      />,
    );
    const history = screen.getByRole('button', { name: 'History' });
    const refills = container.querySelector('.client-fin__refill-input') as HTMLElement;
    const actions = container.querySelector('.client-fin__rx-actions') as HTMLElement;
    const extras = container.querySelector('.client-fin__rx-extras') as HTMLElement;
    expect(history).toBeVisible();
    expect(refills).toBeVisible();
    expect(history).not.toBe(refills);
    expect(actions).toContainElement(history);
    expect(actions).toContainElement(screen.getByRole('button', { name: 'View details' }));
    expect(extras).toContainElement(refills);
    expect(extras).not.toContainElement(history);
    expect(actions).not.toContainElement(refills);
    // "Entered by" is its own line under the directions, not squeezed into the label row.
    const entered = screen.getByText('Entered by Emr technician');
    expect(entered.closest('.client-fin__sig-label')).toBeNull();
  });
});
