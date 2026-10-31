import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  EmailNotSentWarning,
  emailNotSentReasonFromSend,
  InactivePetNotice,
  isInactiveCheckInPet,
  recipientsForPayload,
  secondEmailOnFile,
  SendRecipientChoice,
} from './roomLoaderSendNotices';

describe('RL-07-6 inactive pets on the staff screen', () => {
  it('marks a deceased pet and a pet whose visits are all cancelled as inactive; a live pet is not', () => {
    expect(isInactiveCheckInPet({ patient: { isActive: false }, appointments: [{ confirmStatusName: 'Confirmed' }] })).toBe(true);
    expect(isInactiveCheckInPet({ patient: { isActive: true }, appointments: [{ confirmStatusName: 'Canceled Appointment' }] })).toBe(true);
    expect(isInactiveCheckInPet({ patient: { isActive: true }, appointments: [{ confirmStatusName: 'Confirmed' }] })).toBe(false);
    expect(
      isInactiveCheckInPet({ patient: { isActive: true }, appointments: [{ confirmStatusName: 'Canceled Appointment' }, { confirmStatusName: 'Confirmed' }] }),
    ).toBe(false);
  });

  it('the notice says the pet is inactive and left out of the send', () => {
    render(<InactivePetNotice petName="Bella" />);
    expect(screen.getByTestId('room-loader-inactive-pet').textContent).toMatch(/Bella is inactive.*left out/);
  });
});

describe('RL-14-3 warning when the email did not go', () => {
  it('names the reason and offers Send by SMS', () => {
    const onSms = vi.fn();
    const { rerender } = render(<EmailNotSentWarning reason="no_email" canSendBySms onSendBySms={onSms} onDismiss={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/no email address/i);
    fireEvent.click(screen.getByRole('button', { name: 'Send by SMS' }));
    expect(onSms).toHaveBeenCalledTimes(1);
    rerender(<EmailNotSentWarning reason="send_failed" canSendBySms onSendBySms={onSms} onDismiss={() => {}} />);
    expect(screen.getByRole('alert').textContent).toMatch(/failed to send/i);
  });

  it('hides the SMS button when there is no phone number', () => {
    render(<EmailNotSentWarning reason="no_email" canSendBySms={false} onSendBySms={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Send by SMS' })).toBeNull();
  });
});

describe('RL-14-4 success unchanged', () => {
  it('emailSent:true gives no warning, so the normal confirmation (modal closes) runs', () => {
    expect(emailNotSentReasonFromSend({ emailSent: true }, {})).toBeNull();
    expect(emailNotSentReasonFromSend({ emailSent: true, reason: 'send_failed' }, {})).toBeNull();
    // and the failure case still warns
    expect(emailNotSentReasonFromSend({ emailSent: false, reason: 'no_email' }, {})).toBe('no_email');
    const { container } = render(<div />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('AL-05 who gets the check-in email', () => {
  it('AL-05-7 with a second email: asks primary (default) / second / both and reports the choice', () => {
    const onChange = vi.fn();
    render(<SendRecipientChoice primaryEmail="a@x.test" secondEmail="b@x.test" value="primary" onChange={onChange} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(3);
    expect(radios[0].checked).toBe(true);
    fireEvent.click(screen.getByLabelText(/Second email/));
    expect(onChange).toHaveBeenCalledWith('second');
    fireEvent.click(screen.getByLabelText(/Both emails/));
    expect(onChange).toHaveBeenCalledWith('both');
    expect(recipientsForPayload('b@x.test', 'second')).toBe('second');
    expect(recipientsForPayload('b@x.test', 'both')).toBe('both');
    expect(recipientsForPayload('b@x.test', 'primary')).toBeUndefined();
  });

  it('AL-05-8 with one email: no question and no recipients sent', () => {
    const { container } = render(<SendRecipientChoice primaryEmail="a@x.test" secondEmail={secondEmailOnFile({ secondEmail: '  ' })} value="primary" onChange={() => {}} />);
    expect(container.innerHTML).toBe('');
    expect(secondEmailOnFile({ secondEmail: null })).toBeNull();
    expect(recipientsForPayload(null, 'both')).toBeUndefined();
  });
});
