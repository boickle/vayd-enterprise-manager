import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHECKIN_FORM_PRICE_NOTE, PrevisitCheckinPriceNote } from './PrevisitCheckinPriceNote';

describe('A1 pre-visit accept rows show the check-in price note', () => {
  it('shows the note on an open pre-visit line priced from the form', () => {
    render(<PrevisitCheckinPriceNote note={CHECKIN_FORM_PRICE_NOTE} state="proposed" />);
    expect(screen.getByTestId('previsit-checkin-price-note').textContent).toMatch(/Priced from the check-in form/);
  });

  it('shows nothing for a catalog-priced line (no note) or other notes', () => {
    const { container, rerender } = render(<PrevisitCheckinPriceNote note={null} state="proposed" />);
    expect(container.textContent).toBe('');
    rerender(<PrevisitCheckinPriceNote note="Something else" state="proposed" />);
    expect(container.textContent).toBe('');
  });

  it('does not repeat itself on a declined line (its decline reason shows instead)', () => {
    const { container } = render(<PrevisitCheckinPriceNote note={CHECKIN_FORM_PRICE_NOTE} state="declined" />);
    expect(container.textContent).toBe('');
  });
});
