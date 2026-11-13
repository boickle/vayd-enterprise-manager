/** Marketing → Promotions page: tabs for each kind of promotion, like Labs (owner, Nov 11, 2026). */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import PromotionsLayout from './PromotionsLayout';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/schedule" element={<PromotionsLayout />}>
          <Route path="marketing/membership-promotions" element={<p>Membership page</p>} />
          <Route
            path="marketing/appointment-request-promotions"
            element={<p>Appointment request page</p>}
          />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('PromotionsLayout', () => {
  it('shows a Promotions title with two tabs, and the page for the open tab', () => {
    renderAt('/schedule/marketing/appointment-request-promotions');
    expect(screen.getByRole('heading', { name: 'Promotions' })).toBeTruthy();
    const tabs = within(screen.getByRole('navigation', { name: 'Promotions' })).getAllByRole('link');
    expect(tabs.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Membership Promotions', '/schedule/marketing/membership-promotions'],
      ['Appointment Request Promotions', '/schedule/marketing/appointment-request-promotions'],
    ]);
    expect(tabs[1].className).toContain('active');
    expect(tabs[0].className).not.toContain('active');
    expect(screen.getByText('Appointment request page')).toBeTruthy();
  });

  it('the membership tab is active on the membership page', () => {
    renderAt('/schedule/marketing/membership-promotions');
    expect(screen.getByRole('link', { name: 'Membership Promotions' }).className).toContain('active');
    expect(screen.getByText('Membership page')).toBeTruthy();
  });
});
