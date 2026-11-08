import { createRef } from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreCartCardEntry, { type StoreCardBillingPrefill, type StoreCartCardEntryHandle } from './StoreCartCardEntry';

const createPaymentMethod = vi.fn();

vi.mock('../../api/practicePublicConfig', () => ({ loadStripePublishableKey: vi.fn().mockResolvedValue('pk_test_x') }));
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue({
    elements: () => ({ create: () => ({ mount: vi.fn(), unmount: vi.fn() }) }),
    createPaymentMethod: (...args: unknown[]) => createPaymentMethod(...args),
  }),
}));

const blank: StoreCardBillingPrefill = { name: '', email: '', line1: '', line2: '', city: '', state: '', postal: '' };
const address = { line1: '12 Fixture Lane', line2: '', city: 'Madison', state: 'WI', postal: '53703' };

async function mountReady(prefill: StoreCardBillingPrefill) {
  const ref = createRef<StoreCartCardEntryHandle>();
  const view = render(<StoreCartCardEntry ref={ref} billingPrefill={prefill} canSaveCard={false} />);
  // Ready once Stripe has "loaded": createPaymentMethod no longer says "Enter the card first."
  await waitFor(async () => {
    createPaymentMethod.mockResolvedValueOnce({ paymentMethod: { id: 'pm_probe' } });
    await ref.current!.createPaymentMethod().catch((e: Error) => {
      if (/Enter the card first/.test(e.message)) throw e;
    });
  });
  createPaymentMethod.mockClear();
  return { ref, view };
}

describe('OS-A17: the card form follows the name and email typed on the page', () => {
  beforeEach(() => createPaymentMethod.mockReset());

  it('OS-A17-1: typing the email one letter at a time on the page sends the whole email to Stripe', async () => {
    const { ref, view } = await mountReady({ ...blank, ...address, name: 's', email: 's' });
    for (const [name, email] of [
      ['Sa', 'sa'],
      ['Sam Guest', 'sam@example.com'],
    ]) {
      view.rerender(
        <StoreCartCardEntry ref={ref} billingPrefill={{ ...blank, ...address, name, email }} canSaveCard={false} />,
      );
    }
    createPaymentMethod.mockResolvedValueOnce({ paymentMethod: { id: 'pm_1' } });
    await act(async () => {
      await ref.current!.createPaymentMethod();
    });
    const details = createPaymentMethod.mock.calls[0][0].billing_details;
    expect(details.email).toBe('sam@example.com');
    expect(details.name).toBe('Sam Guest');
  });

  it('OS-A17-2: a name the buyer typed in the card form is kept when the page changes', async () => {
    const { ref, view } = await mountReady({ ...blank, ...address, name: 'Page Name', email: 'a@example.com' });
    fireEvent.change(screen.getByDisplayValue('Page Name'), { target: { value: 'Card Holder' } });
    view.rerender(
      <StoreCartCardEntry
        ref={ref}
        billingPrefill={{ ...blank, ...address, name: 'Page Name Changed', email: 'b@example.com' }}
        canSaveCard={false}
      />,
    );
    createPaymentMethod.mockResolvedValueOnce({ paymentMethod: { id: 'pm_2' } });
    await act(async () => {
      await ref.current!.createPaymentMethod();
    });
    const details = createPaymentMethod.mock.calls[0][0].billing_details;
    expect(details.name).toBe('Card Holder');
    expect(details.email).toBe('b@example.com');
  });
});
