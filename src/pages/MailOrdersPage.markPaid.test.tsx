/** OS-A1-2: Mark paid opens a confirm dialog that suggests recording the payment on the invoice and asks for a reason. */
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../api/onlineStore', () => ({}));

import { MarkPaidButton } from './MailOrdersPage';

it('OS-A1-2: clicking Mark paid shows a dialog that suggests recording the payment on the invoice', () => {
  const onConfirm = vi.fn();
  render(<MarkPaidButton onConfirm={onConfirm} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toMatch(/record the payment on the invoice/i);
  expect(onConfirm).not.toHaveBeenCalled();
});

it('OS-A1-2: the dialog needs a reason, then passes it on', () => {
  const onConfirm = vi.fn();
  render(<MarkPaidButton onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
  const confirm = screen.getAllByRole('button', { name: 'Mark paid' }).pop() as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: '  Check on invoice 1042 ' } });
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledWith('Check on invoice 1042');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('OS-A1-2: Cancel closes the dialog without marking paid', () => {
  const onConfirm = vi.fn();
  render(<MarkPaidButton onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onConfirm).not.toHaveBeenCalled();
});
