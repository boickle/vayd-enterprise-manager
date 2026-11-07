import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('../api/appointmentRequestPromotions', () => ({
  buildAppointmentRequestPromoUrl: () => 'https://example.test/promo',
  fetchAppointmentRequestPromotions: vi.fn().mockResolvedValue([]),
  createAppointmentRequestPromotion: (...a: unknown[]) => create(...a),
  updateAppointmentRequestPromotion: vi.fn(),
}));

import AppointmentRequestPromotionsPanel from './AppointmentRequestPromotionsPanel';
import { optionalExpiresIso, toDateInputValue } from '../utils/promotionExpiry';

beforeEach(() => create.mockReset());

describe('promo code expiry (PAY-A6-2)', () => {
  it('PAY-A6-2: picking Dec 31 and saving sends expiresAt = Dec 31 23:59:59 Eastern', async () => {
    create.mockResolvedValue({ id: 1, name: 'Test', companyName: 'Test', token: 't' });
    const { container } = render(<AppointmentRequestPromotionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /new|add|create/i }));
    fireEvent.change(screen.getByLabelText(/Internal name/i), { target: { value: 'Test co' } });
    fireEvent.change(screen.getByLabelText(/Public Name/i), { target: { value: 'Test promo' } });
    fireEvent.change(screen.getByLabelText(/Discount amount/i), { target: { value: '10' } });
    const date = container.ownerDocument.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: '2026-12-31' } });
    const buttons = screen.getAllByRole('button', { name: /create|save/i });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(create).toHaveBeenCalled());
    // 23:59:59 EST (UTC-5) = Jan 1 04:59:59Z
    expect(create.mock.calls[0][0].expiresAt).toBe('2027-01-01T04:59:59.000Z');
  });

  it('end of day follows daylight time too, and the edit field shows the same day back', () => {
    expect(optionalExpiresIso('2026-07-31')).toBe('2026-08-01T03:59:59.000Z');
    expect(toDateInputValue('2027-01-01T04:59:59.000Z')).toBe('2026-12-31');
    expect(toDateInputValue('2026-12-31T12:00:00.000Z')).toBe('2026-12-31');
    expect(optionalExpiresIso('')).toBeUndefined();
  });
});
