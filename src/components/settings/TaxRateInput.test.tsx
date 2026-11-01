// CAT-02-6: a rate typed as a fraction (0.055) warns "Enter the percent, e.g. 5.5".
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TaxRateInput from './TaxRateInput';

function Harness({ onRate }: { onRate: (n: number) => void }) {
  const [v, setV] = useState(5.5);
  return (
    <TaxRateInput
      label="Level 1 rate (%)"
      value={v}
      onChange={(n) => {
        setV(n);
        onRate(n);
      }}
    />
  );
}

describe('TaxRateInput', () => {
  it('shows no warning for 5.5, warns for 0.055, clears when corrected', () => {
    const onRate = vi.fn();
    render(<Harness onRate={onRate} />);
    const input = screen.getByLabelText(/Level 1 rate/);
    expect(screen.queryByText('Enter the percent, e.g. 5.5')).toBeNull();

    fireEvent.change(input, { target: { value: '0.055' } });
    expect(onRate).toHaveBeenLastCalledWith(0.055);
    expect(screen.getByText('Enter the percent, e.g. 5.5')).toBeTruthy();

    fireEvent.change(input, { target: { value: '5.5' } });
    expect(screen.queryByText('Enter the percent, e.g. 5.5')).toBeNull();
  });

  it('does not warn for 0 (no tax)', () => {
    render(<TaxRateInput label="Level 2 rate (%)" value={0} onChange={() => undefined} />);
    expect(screen.queryByText('Enter the percent, e.g. 5.5')).toBeNull();
  });
});
