import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HiddenButChargedTag, HIDDEN_BUT_CHARGED_TEXT } from './HiddenButChargedTag';

describe('HiddenButChargedTag', () => {
  it('shows for a hidden $58.61 line', () => {
    render(<HiddenButChargedTag line={{ hideOnInvoice: true, amount: 58.61 }} />);
    expect(screen.getByText(HIDDEN_BUT_CHARGED_TEXT)).toBeTruthy();
  });
  it('shows for a hidden return (negative amount) given as a string', () => {
    render(<HiddenButChargedTag line={{ hideOnInvoice: true, amount: '-58.61' }} />);
    expect(screen.getByTestId('hidden-but-charged-tag')).toBeTruthy();
  });
  it('does not show for a hidden $0 line', () => {
    render(<HiddenButChargedTag line={{ hideOnInvoice: true, amount: 0 }} />);
    expect(screen.queryByTestId('hidden-but-charged-tag')).toBeNull();
  });
  it('does not show for a normal priced line', () => {
    render(<HiddenButChargedTag line={{ hideOnInvoice: false, amount: 58.61 }} />);
    expect(screen.queryByTestId('hidden-but-charged-tag')).toBeNull();
  });
});
