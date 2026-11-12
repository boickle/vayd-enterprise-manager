/**
 * Call dock layout (owner, Nov 12, 2026: the review window opened behind the dock, and the dock sat mid-screen
 * with no way to get it out of the way).
 *  - Steps aside while any dialog is open, unless a call is ringing or live.
 *  - Minimizes to a small pill; a ringing or live call opens it again.
 *  - Starts in the bottom-right corner.
 *  - Shows at most 3 waiting calls, then "+ N more".
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import CallDock, { type CallDockPeek } from './CallDock';

const peeks = (n: number): CallDockPeek[] =>
  Array.from({ length: n }, (_, i) => ({ key: `k${i}`, who: `Caller ${i + 1}`, tone: 'ready', label: 'Ready to file' }));

const dock = (props: Partial<Parameters<typeof CallDock>[0]> = {}) => (
  <CallDock tone="ready" gripLabel="Ready to file" who="Sharon Tweedie" state="Summary ready" primaryLabel="Review & file" {...props} />
);

/** Lets the MutationObserver's animation-frame check run. */
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it('starts in the bottom-right corner', () => {
  render(dock());
  const bunch = document.querySelector('.call-dock-bunch') as HTMLElement;
  expect(bunch.style.right).toBe('20px');
  expect(bunch.style.bottom).toBe('20px');
});

it('steps aside while a dialog is open and comes back when it closes', async () => {
  render(dock());
  expect(screen.getByText('Sharon Tweedie')).toBeTruthy();
  const modal = document.createElement('div');
  modal.setAttribute('aria-modal', 'true');
  document.body.appendChild(modal);
  await flush();
  expect(screen.queryByText('Sharon Tweedie')).toBeNull();
  modal.remove();
  await flush();
  expect(screen.getByText('Sharon Tweedie')).toBeTruthy();
});

it('stays on top of a dialog while a call is ringing or live', async () => {
  const modal = document.createElement('div');
  modal.setAttribute('aria-modal', 'true');
  document.body.appendChild(modal);
  render(dock({ urgent: true, gripLabel: 'Incoming' }));
  await flush();
  expect(screen.getByText('Sharon Tweedie')).toBeTruthy();
  modal.remove();
});

it('is hidden while its own review window is open', () => {
  render(dock({ hidden: true }));
  expect(screen.queryByText('Sharon Tweedie')).toBeNull();
});

it('minimizes to a pill with the count, and Show opens it again', () => {
  render(dock({ behind: peeks(4) }));
  fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
  expect(screen.queryByText('Sharon Tweedie')).toBeNull();
  const pill = screen.getByRole('button', { name: /Calls · 5 waiting/ });
  fireEvent.click(pill);
  expect(screen.getByText('Sharon Tweedie')).toBeTruthy();
});

it('a ringing or live call opens a minimized dock', () => {
  const { rerender } = render(dock());
  fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
  expect(screen.queryByText('Sharon Tweedie')).toBeNull();
  rerender(dock({ urgent: true, gripLabel: 'Incoming' }));
  expect(screen.getByText('Sharon Tweedie')).toBeTruthy();
});

it('lists at most 3 waiting calls, then says how many more', () => {
  render(dock({ behind: peeks(5) }));
  expect(screen.getByText('5 more calls waiting · click one to open it')).toBeTruthy();
  expect(screen.getAllByTitle(/^Show Caller/)).toHaveLength(3);
  expect(screen.getByText('+ 2 more — they move up as you file these')).toBeTruthy();
  expect(screen.getByText(/Ready to file · 6 calls/)).toBeTruthy();
});
