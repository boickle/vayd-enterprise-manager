/**
 * Owner decision (Oct 30, 2026): only a charge that changes the pet's status (e.g. "Euthanized")
 * opens the passed-away wrap-up at checkout. A euthanasia visit can end without euthanasia.
 */
import { vi } from 'vitest';

vi.mock('../api/http', () => ({ apiErrorMessage: () => '' }));
vi.mock('../api/careOutreach', () => ({}));
vi.mock('../api/memberships', () => ({}));
vi.mock('../api/onlineStore', () => ({}));
vi.mock('../api/patientInactivation', () => ({}));
vi.mock('../api/visitEstimates', () => ({}));
vi.mock('../api/visitWorkflow', () => ({ VISIT_WORKFLOW_PRACTICE_ID: 1 }));
vi.mock('./membershipCancelEstimateLine', () => ({}));
vi.mock('./euthanasiaFutureAppointments', () => ({}));

import { deathWrapUpTriggeredByInvoice } from './deathWrapUp';

type Line = Parameters<typeof deathWrapUpTriggeredByInvoice>[0] extends infer I
  ? I extends { lines?: Array<infer L> }
    ? L
    : never
  : never;
const line = (over: Partial<Line>) =>
  ({ id: 'l1', isDeleted: false, patientId: 7, catalogChangePatientStatusTo: null, ...over }) as Line;
const invoice = (lines: Line[]) => ({ patientId: 7, lines }) as never;

it('opens for a charge that makes this pet Euthanized', () => {
  expect(deathWrapUpTriggeredByInvoice(invoice([line({ catalogChangePatientStatusTo: 'Euthanized' })]), 7)).toBe(true);
});

it('does not open for a euthanasia visit billed without a status-changing charge (Duke)', () => {
  const duke = invoice([
    line({ id: 'proc', catalogChangePatientStatusTo: null }),
    line({ id: 'sol', catalogChangePatientStatusTo: '' }),
  ]);
  expect(deathWrapUpTriggeredByInvoice(duke, 7)).toBe(false);
});

it("ignores a removed or returned charge, and another pet's charge", () => {
  expect(
    deathWrapUpTriggeredByInvoice(invoice([line({ isDeleted: true, catalogChangePatientStatusTo: 'Euthanized' })]), 7)
  ).toBe(false);
  expect(
    deathWrapUpTriggeredByInvoice(
      invoice([
        line({ id: 'a', catalogChangePatientStatusTo: 'Euthanized' }),
        line({ id: 'r', returnOfLineId: 'a' }),
      ]),
      7
    )
  ).toBe(false);
  expect(
    deathWrapUpTriggeredByInvoice(invoice([line({ patientId: 8, catalogChangePatientStatusTo: 'Euthanized' })]), 7)
  ).toBe(false);
});
