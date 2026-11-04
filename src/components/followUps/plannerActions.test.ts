import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAppointmentById } from '../../api/appointments';
import { createLabsPendingForwardBookingTasks } from '../forwardBooking/saveForwardBookingDecision';
import { chooseLabsTaskBranchIds, createLabsTask, SourceVisitLinks } from './plannerActions';
import type { PlannerPet } from './plannerData';

vi.mock('../../api/appointments', async (orig) => ({
  ...(await orig<typeof import('../../api/appointments')>()),
  fetchAppointmentById: vi.fn(),
}));
vi.mock('../forwardBooking/saveForwardBookingDecision', async (orig) => ({
  ...(await orig<typeof import('../forwardBooking/saveForwardBookingDecision')>()),
  createLabsPendingForwardBookingTasks: vi.fn(async () => 77),
}));

const pet = (over: Partial<PlannerPet>): PlannerPet => ({
  patientId: 1,
  name: 'Biscuit',
  species: null,
  onTodaysVisit: false,
  appointmentId: null,
  soapEncounterId: null,
  savedMode: null,
  ...over,
});

describe('SourceVisitLinks', () => {
  it("links today's pets to today's visit, once per pet", () => {
    const links = new SourceVisitLinks();
    const p = pet({ onTodaysVisit: true, appointmentId: 101 });
    expect(links.take(p)).toBe(101);
    expect(links.take(p)).toBeNull();
    links.release(1);
    expect(links.take(p)).toBe(101);
  });

  it('links a labs-are-back pet to the visit the labs were drawn at', () => {
    expect(
      new SourceVisitLinks().take(pet({ focusReason: 'Labs are back', sourceAppointmentId: 104 }))
    ).toBe(104);
  });

  it('leaves other household pets unlinked', () => {
    expect(new SourceVisitLinks().take(pet({}))).toBeNull();
  });
});

// SCH-13-4: the API refuses a task on any branch the signed-in staff member does not belong
// to, so the labs task must never be filed on every branch of the practice.
describe('chooseLabsTaskBranchIds', () => {
  const practice = Array.from({ length: 24 }, (_, i) => i + 1);

  it("uses the visit's branch when the staff member belongs to it", () => {
    expect(
      chooseLabsTaskBranchIds({
        visitBranchId: 5,
        staffBranchIds: [9, 5],
        practiceBranchIds: practice,
      })
    ).toEqual([5]);
  });

  it("falls back to the staff member's own practice branches when they are not on the visit's branch", () => {
    expect(
      chooseLabsTaskBranchIds({
        visitBranchId: 5,
        staffBranchIds: [9, 12, 9, 99],
        practiceBranchIds: practice,
      })
    ).toEqual([9, 12]);
  });

  it("uses the visit's branch when the staff member's branches are unknown", () => {
    expect(
      chooseLabsTaskBranchIds({ visitBranchId: 5, staffBranchIds: [], practiceBranchIds: practice })
    ).toEqual([5]);
  });

  it('uses the staff branches when the visit has no branch', () => {
    expect(
      chooseLabsTaskBranchIds({
        visitBranchId: null,
        staffBranchIds: [7],
        practiceBranchIds: practice,
      })
    ).toEqual([7]);
  });

  it('is empty when nothing is known, never every practice branch', () => {
    expect(
      chooseLabsTaskBranchIds({
        visitBranchId: null,
        staffBranchIds: [],
        practiceBranchIds: practice,
      })
    ).toEqual([]);
  });
});

describe('createLabsTask', () => {
  const labsPet = pet({ patientId: 31, name: 'Alder', onTodaysVisit: true, appointmentId: 700 });
  const base = {
    pet: labsPet,
    clientId: 50,
    practiceId: 1,
    practiceBranchIds: Array.from({ length: 24 }, (_, i) => i + 1),
    assigneeIds: [42],
    startAt: '2026-11-07T14:00:00.000Z',
    note: '',
  };

  beforeEach(() => {
    vi.mocked(fetchAppointmentById).mockReset();
    vi.mocked(createLabsPendingForwardBookingTasks).mockClear();
  });

  it("files the task on the visit's branch when the staff member works there", async () => {
    vi.mocked(fetchAppointmentById).mockResolvedValue({ id: 700, branch: { id: 4 } } as never);
    await expect(createLabsTask({ ...base, staffBranchIds: [4, 6] })).resolves.toBe(77);
    expect(fetchAppointmentById).toHaveBeenCalledWith(700, { practiceId: 1 });
    expect(vi.mocked(createLabsPendingForwardBookingTasks).mock.calls[0][0]).toMatchObject({
      title: 'Forward book Alder once labs are back',
      branchIds: [4],
      assigneeEmployeeIds: [42],
      startAt: '2026-11-07T14:00:00.000Z',
      links: [
        { entityType: 'client', entityId: 50 },
        { entityType: 'appointment', entityId: 700 },
        { entityType: 'patient', entityId: 31 },
      ],
    });
  });

  it("files it on the staff member's branches when the visit is on another office", async () => {
    vi.mocked(fetchAppointmentById).mockResolvedValue({ id: 700, branch: { id: 4 } } as never);
    await createLabsTask({ ...base, staffBranchIds: [6] });
    expect(vi.mocked(createLabsPendingForwardBookingTasks).mock.calls[0][0].branchIds).toEqual([6]);
  });

  it("still files it when the visit can't be loaded", async () => {
    vi.mocked(fetchAppointmentById).mockResolvedValue(null);
    await createLabsTask({ ...base, staffBranchIds: [6] });
    expect(vi.mocked(createLabsPendingForwardBookingTasks).mock.calls[0][0].branchIds).toEqual([6]);
  });
});
