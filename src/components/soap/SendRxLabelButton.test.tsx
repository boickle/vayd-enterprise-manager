import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SendRxLabelButton from './SendRxLabelButton';

const source = {
  patientName: 'Biscuit',
  ownerName: 'Pat Owner',
  name: 'Simparica Trio',
  instructions: 'Give 1 treat every 30 days.',
};

describe('SendRxLabelButton', () => {
  it('shows a red reason instead of opening the dialog when the Rx is not approved', () => {
    render(
      <SendRxLabelButton
        source={source}
        blockedReason="Save the sig and approve the Rx before printing the label."
      />,
    );
    const button = screen.getByRole('button', { name: /print label/i });
    expect(button).not.toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('alert')).toHaveTextContent('approve the Rx before printing');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
