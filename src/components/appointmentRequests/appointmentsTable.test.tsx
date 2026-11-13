/** Appointments list redesign, step 1: Liaison dropdown, Route / Re-Route button, Hold tab strip (owner, Nov 11, 2026). */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { LiaisonSelect } from './LiaisonSelect';
import { RouteButton } from './RouteButton';
import { AppointmentsTabStrip } from './AppointmentsTabStrip';
import { rememberAppointmentTabCounts } from './appointmentTabCounts';

const liaisons = [
  { id: 1, firstName: 'Morgan', lastName: 'Lee' },
  { id: 2, firstName: 'Lindsey', lastName: 'Park' },
];

describe('LiaisonSelect', () => {
  it('shows "Select liaison" when nobody owns the request', () => {
    render(<LiaisonSelect value={null} liaisons={liaisons} onChange={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('option', { name: 'Select liaison' })).toBeTruthy();
  });

  it('lets anyone hand the request to someone else, or clear it', () => {
    const onChange = vi.fn();
    render(<LiaisonSelect value={liaisons[0]} liaisons={liaisons} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith(2);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('is locked for read-only users (techs, doctors; Nov 13, 2026)', () => {
    render(<LiaisonSelect value={liaisons[0]} liaisons={liaisons} onChange={() => {}} disabled />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  });

  it('keeps an owner who is not on the CL list selectable', () => {
    const doctor = { id: 9, firstName: 'Dana', lastName: 'Quinn' };
    render(<LiaisonSelect value={doctor} liaisons={liaisons} onChange={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('9');
    expect(screen.getByRole('option', { name: 'Dana' })).toBeTruthy();
  });
});

describe('RouteButton', () => {
  it('says Route before anything is booked', () => {
    const onRoute = vi.fn();
    render(<RouteButton hasVisit={false} onRoute={onRoute} />);
    fireEvent.click(screen.getByRole('button', { name: 'Route' }));
    expect(onRoute).toHaveBeenCalled();
  });

  it('offers Reschedule or Explore alternatives once there is a visit', () => {
    const onReschedule = vi.fn();
    const onExplore = vi.fn();
    render(<RouteButton hasVisit onReschedule={onReschedule} onExploreAlternatives={onExplore} />);
    fireEvent.click(screen.getByRole('button', { name: /Re-Route/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Explore alternatives' }));
    expect(onExplore).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Re-Route/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reschedule' }));
    expect(onReschedule).toHaveBeenCalled();
  });
});

describe('AppointmentsTabStrip (Hold tab)', () => {
  it('marks Hold active and links back to the request tabs', () => {
    render(
      <MemoryRouter initialEntries={['/schedule/appointments/holds']}>
        <Routes>
          <Route path="/schedule/appointments/holds" element={<AppointmentsTabStrip />} />
          <Route path="/schedule/appointments" element={<p>Requests list</p>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('tab', { name: 'Hold' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Booked' }));
    expect(screen.getByText('Requests list')).toBeTruthy();
  });

  it('says In progress, with the counts the Appointments list last worked out (B2)', () => {
    rememberAppointmentTabCounts({
      new: { count: 3, mine: 1, others: 0 },
      contacted: { count: 5, mine: 0, others: 2 },
      booked: { mine: 0, others: 0 },
    });
    render(
      <MemoryRouter>
        <AppointmentsTabStrip />
      </MemoryRouter>
    );
    expect(screen.queryByRole('tab', { name: /Contacted/ })).toBeNull();
    const inProgress = screen.getByRole('tab', { name: /In progress/ });
    expect(inProgress.textContent).toContain('(5)');
    expect(screen.getByRole('tab', { name: /^New/ }).textContent).toContain('(3)');
    expect(screen.getByRole('tab', { name: /^Booked/ }).textContent).not.toContain('(');
    sessionStorage.clear();
  });
});
