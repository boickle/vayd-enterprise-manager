/**
 * SCH-03-1, SCH-03-2 and the HOLD case (docs/test-plans/scheduling-and-routing.md), plus SCH-15-5's
 * dialog half: Remove cancels a visit with a client (PATCH, reason kept, never DELETE); blocks and
 * rows with no client are still deleted; HOLD types ask for no reason; a 409 shows its message.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('../api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/http')>();
  return {
    ...actual,
    http: { ...actual.http, patch: h.patch, delete: h.del },
  };
});

import { SchedulerRemoveVisitModal } from './SchedulerRemoveVisitModal';
import type { Appointment } from '../api/roomLoader';

const scoutUuid = '3f2b8c1e-5a47-4d1e-9c0a-6b7d8e9f0a1b';
const visit = (over: Record<string, unknown> = {}) =>
  ({
    id: 501,
    pimsId: scoutUuid,
    pimsType: 'VAYD',
    appointmentStart: '2026-11-10T14:00:00.000Z',
    appointmentEnd: '2026-11-10T15:00:00.000Z',
    client: { id: 7, firstName: 'Ada', lastName: 'Test', lat: 35.78, lon: -78.64 },
    appointmentType: { id: 1, name: 'Medical', isActive: true, isDeleted: false },
    ...over,
  }) as unknown as Appointment;

function open(appt: Appointment) {
  const onRemoved = vi.fn();
  const onClose = vi.fn();
  render(
    <SchedulerRemoveVisitModal
      appt={appt}
      practiceId={1}
      accentColor="#123456"
      onClose={onClose}
      onRemoved={onRemoved}
    />
  );
  return { onRemoved, onClose };
}

beforeEach(() => {
  h.patch.mockReset();
  h.del.mockReset();
  h.patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({
    data: { id: 501, ...body },
  }));
  h.del.mockResolvedValue({ data: { ok: true } });
});

describe('SchedulerRemoveVisitModal (SCH-03 / SCH-15)', () => {
  it('SCH-03-1: a Scout visit with a client is cancelled with the typed reason, never deleted', async () => {
    const { onRemoved } = open(visit());
    fireEvent.change(screen.getByPlaceholderText(/Client cancelled/i), {
      target: { value: 'Client sick' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Visit' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(h.del).not.toHaveBeenCalled();
    expect(h.patch).toHaveBeenCalledTimes(1);
    const [url, body] = h.patch.mock.calls[0];
    expect(url).toBe('/appointments/501');
    expect(body).toMatchObject({
      confirmStatusName: 'Canceled Appointment',
      cancellationReason: 'Client sick',
    });
    expect(onRemoved.mock.calls[0][0]).toMatchObject({
      confirmStatusName: 'Canceled Appointment',
      cancellationReason: 'Client sick',
    });
  });

  it('SCH-03-1b: the reason is required for a visit with a client', async () => {
    open(visit());
    fireEvent.click(screen.getByRole('button', { name: 'Remove Visit' }));
    expect(await screen.findByText(/Enter a reason/i)).toBeTruthy();
    expect(h.patch).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });

  it('SCH-03-2: a personal block with no client is still deleted, with no reason asked', async () => {
    const { onRemoved } = open(
      visit({
        client: null,
        appointmentType: { id: 9, name: 'Personal Block', isActive: true, isDeleted: false },
      })
    );
    expect(screen.queryByPlaceholderText(/Client cancelled/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Visit' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(h.del).toHaveBeenCalledWith('/appointments/501');
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('SCH-03: a HOLD-type visit asks for no reason and is cancelled (PATCH), not deleted', async () => {
    const { onRemoved } = open(
      visit({
        appointmentType: { id: 3, name: 'HOLD', isHold: true, isActive: true, isDeleted: false },
      })
    );
    expect(screen.queryByPlaceholderText(/Client cancelled/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Visit' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(h.del).not.toHaveBeenCalled();
    expect(h.patch).toHaveBeenCalledTimes(1);
    expect(h.patch.mock.calls[0][1]).toMatchObject({ confirmStatusName: 'Canceled Appointment' });
    expect(h.patch.mock.calls[0][1].cancellationReason).toBeUndefined();
  });

  it('SCH-15-5: a 409 from the API is shown in the dialog and the visit is not removed', async () => {
    const message = 'This visit has been started. Finish or void it in the chart first.';
    h.patch.mockRejectedValue({ response: { status: 409, data: { message } } });
    const { onRemoved, onClose } = open(visit());
    fireEvent.change(screen.getByPlaceholderText(/Client cancelled/i), {
      target: { value: 'Changed mind' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Visit' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });
});
