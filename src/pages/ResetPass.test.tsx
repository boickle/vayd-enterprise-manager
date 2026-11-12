/** PA-A5 (old link wording) and PA-A6 (the reset token is never logged). The page runs for real; only HTTP is faked. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A plain function (not vi.fn) stands in for the call, so a rejection is only seen by the page.
const calls: unknown[][] = [];
let reply: () => Promise<unknown> = async () => ({});
vi.mock('../api/users', () => ({
  completePasswordReset: (...args: unknown[]) => {
    calls.push(args);
    return reply();
  },
  requestPasswordReset: vi.fn(),
}));

import ResetPass from './ResetPass';

function renderPage(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ResetPass />
    </MemoryRouter>,
  );
}

function submitWith(password: string) {
  fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: password } });
  fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
}

describe('ResetPass', () => {
  beforeEach(() => {
    calls.length = 0;
    reply = async () => ({});
  });

  it('PA-A5-1 a rejected link (401) says it expired or a newer one was sent', async () => {
    const failure = Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401, data: { message: 'Invalid or expired reset link.' } },
    });
    reply = () => Promise.reject(failure);
    renderPage('/reset-password?token=abc');
    submitWith('long-enough-1');
    expect(
      await screen.findByText('This link has expired or a newer one was sent. Use the most recent email.'),
    ).toBeTruthy();
  });

  it('PA-A6-1 console.log is never called with the token', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    reply = async () => ({ data: { status: 'ok' } });
    renderPage('/reset-password?token=abc');
    submitWith('long-enough-1');
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0][0]).toBe('abc');
    for (const call of log.mock.calls) {
      expect(call.map(String).join(' ')).not.toContain('abc');
    }
  });
});
