/**
 * RP-08-4 (owner decision D3 menus): neither promotions page is left under Admin, and the old Admin
 * links redirect to the new Marketing pages.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';

vi.mock('./pages/OpenPhoneCoaching', () => ({ default: () => null }));
vi.mock('./pages/AdminUsers', () => ({ default: () => <p>Users page</p> }));
vi.mock('./pages/PlatformPractices', () => ({ default: () => null }));

import { getAdminTabPages } from './admin-tabs';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {['/admin', '/schedule/admin'].map((base) => (
          <Route key={base} path={base}>
            {getAdminTabPages().map((tab) => (
              <Route key={tab.path} path={tab.path} element={tab.element} />
            ))}
          </Route>
        ))}
        <Route
          path="/schedule/marketing/membership-promotions"
          element={<p>Membership Promotions page</p>}
        />
        <Route
          path="/schedule/marketing/appointment-request-promotions"
          element={<p>Appointment Request Promotions page</p>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('RP-08-4: promotions leave Admin', () => {
  it('no visible Admin tab is a promotions page', () => {
    const visible = getAdminTabPages().filter((tab) => !tab.hidden);
    expect(visible.map((t) => t.label)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/promotion/i)])
    );
    expect(visible.some((t) => /promotion/i.test(t.path))).toBe(false);
    expect(visible.map((t) => t.label)).toContain('Users');
  });

  it.each([
    ['/schedule/admin/membership-promotions', 'Membership Promotions page'],
    ['/schedule/admin/appointment-request-promotions', 'Appointment Request Promotions page'],
    ['/admin/membership-promotions', 'Membership Promotions page'],
    ['/admin/appointment-request-promotions', 'Appointment Request Promotions page'],
  ])('%s redirects to Marketing', (from, page) => {
    renderAt(from);
    expect(screen.getByText(page)).toBeInTheDocument();
  });
});
