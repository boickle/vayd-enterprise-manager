/**
 * T-B4: an appointment link reads "Visit Nov 11" (the visit's date in Eastern), plus the
 * visit reason when the appointment has one, never "appointment #6563". Other links unchanged.
 * Run under TZ=UTC as well: a visit at 11 pm Eastern is the next day in UTC.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchAppointmentById: vi.fn(),
  fetchPatientByIdStaff: vi.fn(async () => ({ name: 'Maple' })),
  fetchClientByIdStaff: vi.fn(async () => ({ firstName: 'Maria', lastName: 'Rivera' })),
}));
vi.mock('../api/appointments', () => ({ fetchAppointmentById: api.fetchAppointmentById }));
vi.mock('../api/patients', () => ({ fetchPatientByIdStaff: api.fetchPatientByIdStaff }));
vi.mock('../api/clientsStaff', () => ({ fetchClientByIdStaff: api.fetchClientByIdStaff }));

import {
  appointmentLinkLabel,
  resolveTaskLinkLabelMap,
  taskLinkDisplayLabel,
} from './taskLinkDisplay';

const link = (entityType: string, entityId: number) => ({ id: entityId, entityType, entityId }) as never;

beforeEach(() => {
  api.fetchAppointmentById.mockReset();
  api.fetchPatientByIdStaff.mockClear();
  api.fetchClientByIdStaff.mockClear();
});

describe('appointment link label (T-B4-1)', () => {
  it('reads "Visit Nov 11" for a morning visit', () => {
    expect(appointmentLinkLabel({ appointmentStart: '2026-11-11T14:00:00.000Z' })).toBe('Visit Nov 11');
  });

  it('uses the Eastern date for an 11 pm ET visit (already Nov 12 in UTC)', () => {
    // 11:00 PM Nov 11 in New York = 04:00 Nov 12 UTC.
    expect(appointmentLinkLabel({ appointmentStart: '2026-11-12T04:00:00.000Z' })).toBe('Visit Nov 11');
  });

  it('adds the visit reason when the appointment has one', () => {
    expect(
      appointmentLinkLabel({ appointmentStart: '2026-11-11T14:00:00.000Z', description: '  Vomiting recheck ' }),
    ).toBe('Visit Nov 11 · Vomiting recheck');
  });

  it('shortens a long reason', () => {
    const label = appointmentLinkLabel({
      appointmentStart: '2026-11-11T14:00:00.000Z',
      description: 'Annual wellness exam with vaccines, heartworm test and a nail trim if time allows',
    });
    expect(label.startsWith('Visit Nov 11 · Annual wellness exam')).toBe(true);
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(60);
  });

  it('resolves an appointment link to "Visit Nov 11", never "appointment #6563"', async () => {
    api.fetchAppointmentById.mockResolvedValue({ id: 6563, appointmentStart: '2026-11-12T04:00:00.000Z' });
    const labels = await resolveTaskLinkLabelMap([link('appointment', 6563)]);
    expect(api.fetchAppointmentById).toHaveBeenCalledWith(6563);
    expect(taskLinkDisplayLabel(link('appointment', 6563), labels)).toBe('Visit Nov 11');
  });

  it('an appointment that cannot be loaded still reads as a visit', async () => {
    api.fetchAppointmentById.mockResolvedValue(null);
    const labels = await resolveTaskLinkLabelMap([link('appointment', 6563)]);
    expect(taskLinkDisplayLabel(link('appointment', 6563), labels)).toBe('Visit #6563');
  });
});

describe('other links unchanged (T-B4-2)', () => {
  it('patient and client links keep their names; other types keep their fallback', async () => {
    const labels = await resolveTaskLinkLabelMap([link('patient', 21), link('client', 7)]);
    expect(taskLinkDisplayLabel(link('patient', 21), labels)).toBe('Maple');
    expect(taskLinkDisplayLabel(link('client', 7), labels)).toBe('Maria Rivera');
    expect(taskLinkDisplayLabel(link('lab_order', 5), labels)).toBe('lab order #5');
    expect(api.fetchAppointmentById).not.toHaveBeenCalled();
  });
});
