/**
 * LAB-A11-1: the lab results email from an IDEXX result warns when the pet has died, and uses the
 * softer subject "Lab results for Bella" instead of "Bella's lab results".
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({
    effective: {},
    can: () => false,
    hasRole: () => false,
    isLicensed: false,
    licenseType: null,
  }),
  useCan: () => false,
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ role: 'employee' }) }));

let current: Record<string, unknown>;
let patientRow: Record<string, unknown> | null = null;
vi.mock('../../api/idexx', async () => {
  const actual = await vi.importActual<typeof import('../../api/idexx')>('../../api/idexx');
  return {
    ...actual,
    getIdexxResult: vi.fn(async () => current),
    fetchIdexxResultPdf: vi.fn(async () => new Blob(['x'], { type: 'application/pdf' })),
  };
});
vi.mock('../../api/patients', () => ({
  fetchPatientByIdStaff: vi.fn(async () => patientRow),
}));
vi.mock('../../api/scoutChart', () => ({ recordScoutChartCommunication: vi.fn() }));
vi.mock('../../utils/extractUploadText', () => ({}));
const composeProps: { current: Record<string, unknown> | null } = { current: null };
vi.mock('../ClientEmailComposeModal', () => ({
  ClientEmailComposeModal: (props: Record<string, unknown>) => {
    composeProps.current = props;
    return null;
  },
}));
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
    patientName: 'Bella',
    clientLastName: 'Labtest',
    hasOutOfRange: false,
    hasCritical: false,
    hasPending: false,
    delayed: false,
    testNames: ['Chem'],
    specimenCollectionDate: null,
    idexxUpdatedAt: '2026-11-08T10:00:00Z',
    receivedAt: '2026-11-08T10:00:00Z',
    reviewedAt: '2026-11-08T11:00:00Z',
    reviewedByEmployeeId: null,
    clientSummaryApprovedAt: '2026-11-08T10:30:00Z',
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
    clientSummary: 'Bella is doing well.',
    clientSummaryApprovedByEmployeeId: null,
    ...over,
  };
}

function patient(status: string | null) {
  return {
    id: 42,
    name: 'Bella',
    isActive: status ? false : true,
    patientStatus: status ? { name: status } : null,
    owners: [{ id: 3, firstName: 'Pat', lastName: 'Owner' }],
  };
}

async function openEmailFor(status: string | null) {
  current = result();
  patientRow = patient(status);
  composeProps.current = null;
  render(<IdexxResultView resultId={7} />);
  await screen.findByText(/Final|Partial/);
  fireEvent.click(screen.getByRole('button', { name: /Email lab summary & report/ }));
  await waitFor(() => expect(composeProps.current).not.toBeNull());
  return composeProps.current as {
    initialSubject: string;
    notice?: string | null;
  };
}

beforeEach(() => {
  composeProps.current = null;
});
afterEach(() => vi.clearAllMocks());

describe('LAB-A11 lab results email for a deceased pet', () => {
  it('LAB-A11-1: a deceased pet gets a warning and the subject "Lab results for Bella"', async () => {
    const props = await openEmailFor('Deceased');
    expect(props.initialSubject).toBe('Lab results for Bella');
    expect(props.notice).toContain('deceased or euthanized');
  });

  it('LAB-A11-1: a euthanized pet also gets the warning', async () => {
    const props = await openEmailFor('Euthanized');
    expect(props.initialSubject).toBe('Lab results for Bella');
    expect(props.notice).toBeTruthy();
  });

  it('LAB-A11-1 (control): an active pet keeps "Bella\'s lab results" and no warning', async () => {
    const props = await openEmailFor(null);
    expect(props.initialSubject).toBe("Bella's lab results");
    expect(props.notice ?? null).toBeNull();
  });
});
