/** Appointments list, step 2: Booking, Communication and Records pills open a menu (owner, Nov 11, 2026). */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusPillMenu } from './StatusPillMenu';

describe('StatusPillMenu', () => {
  it('is a plain pill with no menu items', () => {
    render(<StatusPillMenu ariaLabel="Records" tone="records-none" label="No records" items={[]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('No records')).toBeTruthy();
  });

  it('opens a menu, marks the current choice, and runs the picked item', () => {
    const pick = vi.fn();
    render(
      <StatusPillMenu
        ariaLabel="Communication for Laura Smith"
        tone="comm-contacted"
        label="Contacted"
        items={[
          { label: 'Contacted', selected: true, onClick: () => {} },
          { divider: true },
          { label: 'Communication complete', hint: 'Nothing left to say', onClick: pick },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Communication for Laura Smith: Contacted' }));
    expect(screen.getByRole('menuitem', { name: /✓ Contacted/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Communication complete/ }));
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('shows Saving… and cannot be opened while saving', () => {
    render(
      <StatusPillMenu
        ariaLabel="Records"
        tone="records-open"
        label="Requested"
        saving
        items={[{ label: 'Records complete', onClick: () => {} }]}
      />
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Saving…');
  });
});
