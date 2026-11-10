/**
 * LAB-03 / LAB-04 (screen half): the email buttons follow owner decision D2, and Mark reviewed /
 * Approve wording follow `lab_result.review` (D1) with a reason from anyone who is not a vet (Q2).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const granted = new Set<string>();
let roles: string[] = [];
let loginRole = 'employee';
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({
    effective: {},
    can: (k: string) => granted.has(k),
    hasRole: (...wanted: string[]) => wanted.some((r) => roles.includes(r)),
    isLicensed: false,
    licenseType: null,
  }),
  useCan: (k: string) => granted.has(k),
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ role: loginRole }) }));

const setIdexxResultReviewed = vi.fn();
const saveIdexxClientSummary = vi.fn();
let current: Record<string, unknown>;
vi.mock('../../api/idexx', async () => {
  const actual = await vi.importActual<typeof import('../../api/idexx')>('../../api/idexx');
  return {
    ...actual,
    getIdexxResult: vi.fn(async () => current),
    setIdexxResultReviewed: (...a: unknown[]) => setIdexxResultReviewed(...a),
    saveIdexxClientSummary: (...a: unknown[]) => saveIdexxClientSummary(...a),
    fetchIdexxResultPdf: vi.fn(async () => new Blob(['x'], { type: 'application/pdf' })),
  };
});
vi.mock('../../api/patients', () => ({ fetchPatientByIdStaff: vi.fn(async () => null) }));
vi.mock('../../api/scoutChart', () => ({ recordScoutChartCommunication: vi.fn() }));
vi.mock('../../utils/extractUploadText', () => ({}));
vi.mock('../ClientEmailComposeModal', () => ({ ClientEmailComposeModal: () => null }));
vi.mock('../pims/PimsChartNoteComposeModal', () => ({ PimsChartNoteComposeModal: () => null }));

import IdexxResultView from './IdexxResultView';

function result(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    idexxResultId: 'R7',
    patientId: 42,
    orderId: 1,
    idexxOrderId: '1',
    requisitionId: null,
    accessionId: 'A1',
    status: 'COMPLETE',
    statusDetail: null,
    modality: 'REFLAB',
    veterinarian: null,
    patientName: 'Max',
    clientLastName: 'Labtest',
    hasOutOfRange: false,
    hasCritical: false,
    hasPending: false,
    delayed: false,
    testNames: ['Chem'],
    specimenCollectionDate: null,
    idexxUpdatedAt: '2026-11-08T10:00:00Z',
    receivedAt: '2026-11-08T10:00:00Z',
    reviewedAt: null,
    reviewedByEmployeeId: null,
    clientSummaryApprovedAt: null,
    clientSummaryStale: false,
    orderReceivedDate: null,
    notes: null,
    categories: [
      {
        name: 'Chemistry',
        code: null,
        notes: [],
        tests: [
          {
            code: 'GLU',
            name: 'Glucose',
            analyte: null,
            result: '95',
            resultNumeric: 95,
            resultType: null,
            qualifier: null,
            units: 'mg/dL',
            referenceRange: '70-140',
            low: 70,
            high: 140,
            criticalLow: null,
            criticalHigh: null,
            outOfRange: false,
            outOfRangeCode: null,
            status: 'COMPLETE',
            notes: [],
          },
        ],
      },
    ],
    delayNotificationAvailable: false,
    clientSummary: 'Max is doing well.',
    clientSummaryApprovedByEmployeeId: null,
    ...over,
  };
}

async function open(over: Record<string, unknown> = {}) {
  current = result(over);
  render(<IdexxResultView resultId={7} />);
  await screen.findByText(/Final|Partial/);
}
const btn = (name: RegExp) => screen.queryByRole('button', { name });

beforeEach(() => {
  granted.clear();
  roles = [];
  loginRole = 'employee';
  setIdexxResultReviewed.mockReset();
  saveIdexxClientSummary.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('LAB-03 emailing results (screen)', () => {
  it('LAB-03-1: a draft summary leaves "Email lab summary & report" disabled, saying the summary needs approving', async () => {
    await open({ reviewedAt: '2026-11-08T11:00:00Z' });
    expect(btn(/Email lab summary & report/)).toBeDisabled();
    expect(screen.getByTestId('idexx-email-why').textContent).toContain(
      'The summary needs approving first'
    );
  });

  it('LAB-03-2: IDEXX changed the result after approval: disabled, and the stale note is shown', async () => {
    await open({
      reviewedAt: '2026-11-08T11:00:00Z',
      clientSummaryApprovedAt: '2026-11-08T10:30:00Z',
      clientSummaryStale: true,
    });
    expect(btn(/Email lab summary & report/)).toBeDisabled();
    expect(screen.getByTestId('idexx-email-why').textContent).toContain(
      'IDEXX changed this result'
    );
    fireEvent.click(screen.getByText('Client summary'));
    expect(
      screen.getByText(/IDEXX sent an updated result after this was written/)
    ).toBeInTheDocument();
  });

  it('LAB-03-3: a partial result: the email is off and Approve wording is disabled', async () => {
    granted.add('lab_result.review');
    roles = ['veterinarian'];
    await open({ status: 'INPROCESS', hasPending: true });
    expect(btn(/Email lab summary & report/)).toBeDisabled();
    expect(screen.getByTestId('idexx-email-why').textContent).toContain("aren't complete");
    fireEvent.click(screen.getByText('Client summary'));
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByRole('button', { name: /Approve wording/ })).toBeDisabled();
  });

  it('LAB-03-4: "Email lab report" stays disabled until the result is reviewed', async () => {
    await open();
    expect(btn(/Email lab report/)).toBeDisabled();
    expect(screen.getByTestId('idexx-email-why').textContent).toContain(
      'Mark the result reviewed first'
    );
  });

  it('LAB-03-5 (screen part): approved current summary on a complete, reviewed result enables both buttons', async () => {
    await open({
      reviewedAt: '2026-11-08T11:00:00Z',
      clientSummaryApprovedAt: '2026-11-08T10:30:00Z',
    });
    expect(btn(/Email lab summary & report/)).toBeEnabled();
    expect(btn(/Email lab report/)).toBeEnabled();
    expect(screen.queryByTestId('idexx-email-why')).toBeNull();
  });
});

describe('LAB-04 buttons and reasons (screen)', () => {
  it('LAB-04-6: a client liaison sees no Mark reviewed and no Approve wording, but still has the PDF', async () => {
    await open();
    expect(btn(/Mark reviewed/)).toBeNull();
    fireEvent.click(screen.getByText('Client summary'));
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(btn(/Approve wording/)).toBeNull();
    expect(btn(/PDF/)).toBeEnabled();
  });

  it('LAB-04-7: a tech must pick a reason before Mark reviewed saves, and it is sent with the request', async () => {
    granted.add('lab_result.review');
    roles = ['technician'];
    setIdexxResultReviewed.mockResolvedValue({
      reviewedAt: '2026-11-08T12:00:00Z',
      reviewedByEmployeeId: 5,
      reviewedByName: 'Sam Fernsby',
      reviewedReason: 'Vet reviewed verbally',
    });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Mark reviewed/ }));
    expect(setIdexxResultReviewed).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole('button', { name: /Mark reviewed/ }).pop()!;
    expect(confirm).toBeDisabled();
    expect(screen.queryByLabelText(/vet to sign later/i)).toBeNull();
    fireEvent.click(screen.getByLabelText('Vet reviewed verbally'));
    fireEvent.click(screen.getAllByRole('button', { name: /Mark reviewed/ }).pop()!);
    await waitFor(() =>
      expect(setIdexxResultReviewed).toHaveBeenCalledWith(7, true, 'Vet reviewed verbally')
    );
    expect(await screen.findByTestId('idexx-reviewed-by')).toHaveTextContent(
      'by Sam Fernsby — Vet reviewed verbally'
    );
  });

  it('LAB-04-7b: "Other" needs its free text', async () => {
    granted.add('lab_result.review');
    roles = ['technician'];
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Mark reviewed/ }));
    fireEvent.click(screen.getByLabelText('Other'));
    expect(screen.getAllByRole('button', { name: /Mark reviewed/ }).pop()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Reason'), {
      target: { value: 'Dr. Quill by phone' },
    });
    expect(screen.getAllByRole('button', { name: /Mark reviewed/ }).pop()).toBeEnabled();
  });

  it('a vet marks reviewed with no reason prompt', async () => {
    granted.add('lab_result.review');
    roles = ['veterinarian'];
    setIdexxResultReviewed.mockResolvedValue({
      reviewedAt: '2026-11-08T12:00:00Z',
      reviewedByEmployeeId: 3,
    });
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Mark reviewed/ }));
    await waitFor(() => expect(setIdexxResultReviewed).toHaveBeenCalledWith(7, true, undefined));
    expect(screen.queryByTestId('idexx-reason-prompt')).toBeNull();
  });
});
