/**
 * RP-08 (owner decisions D3 menus and D3 access, Nov 8-9, 2026). docs/test-plans/roles-and-permissions.md
 * in vayd-api.
 *
 *   RP-08-2  Menus by role: Executive sees Marketing and Analytics, no Settings, no Admin. Practice
 *            Manager (employee login) sees Marketing, no Admin. Admin login: unchanged.
 *   RP-08-3  An executive with an individual marketing.manage grant still has no Admin.
 *   RP-08-4  Marketing menu: Promotions ▸ Membership Promotions, Appointment Request Promotions;
 *            Email campaigns.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { canOpenAnalytics, isEmployeeAnalyticsRestricted } from '../utils/analyticsAccess';

const state = vi.hoisted(() => ({ role: 'employee' as string, keys: new Set<string>() }));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ role: state.role, abilities: [] }),
}));
vi.mock('../permissions/PermissionContext', () => ({
  useCan: (key: string) => state.keys.has(key),
  usePermissions: () => ({ effective: {}, can: (key: string) => state.keys.has(key) }),
}));
vi.mock('../scout-tabs', () => ({
  getVisibleScoutTabs: () => [{ path: 'home', label: 'Home' }],
  scoutTabPermissionOk: () => false,
}));
vi.mock('../hooks/useTaskNavBadges', () => ({
  useTaskNavBadges: () => ({ assignedCount: 0, watchingCount: 0 }),
}));
vi.mock('./TasksNavLabel', () => ({ default: () => <span>Tasks</span> }));

import NavbarScheduleHorizontalNav from './NavbarScheduleHorizontalNav';

/** Keys from the API catalog for each role (src/permissions/permission-catalog.ts). */
const EXECUTIVE_KEYS = [
  'marketing.view',
  'analytics.view_all',
  'report.production',
  'report.payments',
];
const PRACTICE_MANAGER_KEYS = [
  'marketing.view',
  'marketing.manage',
  'membership.plan.manage',
  'catalog.view',
  'report.production',
];

// jsdom has no layout: give the nav room so every item stays on the row instead of under "More".
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 2000,
  });
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  }
});

afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

afterEach(() => {
  state.role = 'employee';
  state.keys = new Set();
});

function renderNav(role: string, keys: string[], path = '/schedule/home') {
  state.role = role;
  state.keys = new Set(keys);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavbarScheduleHorizontalNav />
    </MemoryRouter>
  );
}

/** Top-level nav items (the hidden measuring row is aria-hidden). */
function navItems(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Schedule sections' });
  const inline = nav.querySelector('.navbar-schedule-nav-inline') as HTMLElement;
  return Array.from(inline.children).map((el) => {
    const summary = el.tagName === 'DETAILS' ? el.querySelector('summary') : null;
    return (summary ?? el).textContent?.trim() ?? '';
  });
}

describe('RP-08-2: menus by role', () => {
  it('Executive: Marketing, no Settings, no Admin; Analytics opens for every doctor', () => {
    renderNav('employee', EXECUTIVE_KEYS);
    const items = navItems();
    expect(items).toContain('Marketing');
    expect(items).not.toContain('Settings');
    expect(items).not.toContain('Admin');
    // Analytics lives in the user menu; the executive opens it and is not limited to assigned doctors.
    expect(canOpenAnalytics(['employee'], true)).toBe(true);
    expect(isEmployeeAnalyticsRestricted(['employee'], true)).toBe(false);
  });

  it('Practice Manager (employee login): Marketing, no Admin', () => {
    renderNav('employee', PRACTICE_MANAGER_KEYS);
    const items = navItems();
    expect(items).toContain('Marketing');
    expect(items).not.toContain('Admin');
  });

  it('admin login: unchanged (Marketing, Settings and Admin), with no staff keys at all', () => {
    renderNav('admin', []);
    const items = navItems();
    expect(items).toEqual(expect.arrayContaining(['Marketing', 'Settings', 'Admin']));
    expect(isEmployeeAnalyticsRestricted(['admin'])).toBe(false);
  });

  it('superadmin login: unchanged', () => {
    renderNav('superadmin', []);
    expect(navItems()).toEqual(expect.arrayContaining(['Marketing', 'Settings', 'Admin']));
  });

  it('a technician without marketing.view sees no Marketing, and analytics stays limited', () => {
    renderNav('employee', ['catalog.view']);
    expect(navItems()).not.toContain('Marketing');
    expect(isEmployeeAnalyticsRestricted(['employee'], false)).toBe(true);
  });
});

describe('RP-08-3: edit rights for one exec', () => {
  it('an executive with an individual marketing.manage grant still has no Admin or Settings', () => {
    renderNav('employee', [...EXECUTIVE_KEYS, 'marketing.manage']);
    const items = navItems();
    expect(items).toContain('Marketing');
    expect(items).not.toContain('Admin');
    expect(items).not.toContain('Settings');
  });
});

describe('RP-08-4: Marketing menu', () => {
  it('admin login opens Marketing: Promotions ▸ Membership Promotions, Appointment Request Promotions; Email campaigns', () => {
    renderNav('admin', []);
    fireEvent.click(screen.getByText('Marketing', { selector: 'summary' }));
    const menu = screen.getByRole('menu', { name: 'Marketing' });

    const emailCampaigns = within(menu).getByRole('menuitem', { name: 'Email campaigns' });
    expect(emailCampaigns.getAttribute('href')).toBe('/schedule/marketing');

    const promotions = within(menu).getByRole('button', { name: /Promotions/ });
    expect(promotions.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(promotions);
    expect(promotions.getAttribute('aria-expanded')).toBe('true');

    const submenu = within(menu).getByRole('menu', { name: 'Promotions' });
    const links = within(submenu).getAllByRole('menuitem');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Membership Promotions', '/schedule/marketing/membership-promotions'],
      ['Appointment Request Promotions', '/schedule/marketing/appointment-request-promotions'],
    ]);
  });

  it('the Promotions submenu starts open on a promotions page, and Marketing is the active tab', () => {
    renderNav(
      'employee',
      PRACTICE_MANAGER_KEYS,
      '/schedule/marketing/appointment-request-promotions'
    );
    const summary = screen.getByText('Marketing', { selector: 'summary' });
    expect(summary.className).toContain('schedule-app__tab--active');
    const menu = screen.getByRole('menu', { name: 'Marketing', hidden: true });
    expect(
      within(menu)
        .getByRole('button', { name: /Promotions/, hidden: true })
        .getAttribute('aria-expanded')
    ).toBe('true');
  });
});
