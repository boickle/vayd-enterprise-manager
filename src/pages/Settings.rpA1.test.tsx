/**
 * RP-A1 (docs/test-plans/roles-and-permissions.md in vayd-api; owner decision D4: admin logins
 * unchanged). Settings opens by permission, not only by admin login.
 *
 *   RP-A1-2  A practice manager with an employee login sees the Staff tabs and the Finance tabs
 *            her keys cover, and no "need admin privileges" page.
 *   Also:    Executive and Practice Manager (employee logins) never see Admin; the Executive sees
 *            no Settings; an admin login still sees every Settings tab.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'employee' as string,
  keys: new Set<string>(),
  roles: [] as string[],
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ role: state.role, abilities: [] }),
}));
vi.mock('../permissions/PermissionContext', () => ({
  useCan: (key: string) => state.keys.has(key),
  useMayShow: (...keys: string[]) => keys.some((key) => state.keys.has(key)),
  usePermissions: () => ({
    effective: {},
    can: (key: string) => state.keys.has(key),
    hasRole: (...wanted: string[]) => wanted.some((r) => state.roles.includes(r)),
  }),
}));

// The tab bodies are tested on their own; here they only need to render something.
vi.mock('../components/settings/SettingsAppointmentTypes', () => ({
  default: () => <div>appointment types body</div>,
}));
vi.mock('../components/settings/SettingsEmployeeDirectory', () => ({
  default: () => <div>staff body</div>,
}));
vi.mock('../components/settings/SettingsScoutRoles', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsPermissionAudit', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsClSeatAssignment', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsGmailMailboxPermissions', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsBranchesLocations', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsPaymentTypes', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsPracticeLetterhead', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsIdexxStaffPrice', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsEuthanasiaConsent', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsOutsideHospitals', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsAutomaticTasks', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsRoomLoader', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsDepositBankAccounts', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsClientStatuses', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsPatientStatuses', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsMemberships', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsMessageTemplates', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsLabForms', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsMailShippingTypes', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsCountAlerts', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsChatHours', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsProductionIncentive', () => ({ default: () => null }));
vi.mock('../components/settings/SettingsEmployeeSchedulePanel', () => ({ default: () => null }));
vi.mock('../components/ScheduleOverrideModal', () => ({ default: () => null }));
vi.mock('../components/DepotLocationField', () => ({ DepotLocationField: () => null }));
vi.mock('./FormsAdmin', () => ({ default: () => null }));
vi.mock('./WasteAdminPage', () => ({ default: () => null }));
vi.mock('./RoutingScoreThresholds', () => ({ default: () => null }));

vi.mock('../api/appointmentSettings', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchAllAppointmentTypes: vi.fn().mockResolvedValue([]),
  fetchAllEmployees: vi.fn().mockResolvedValue([]),
  fetchAllZones: vi.fn().mockResolvedValue([]),
}));

// Nav mocks (the nav is rendered in the menu tests below).
vi.mock('../scout-tabs', () => ({
  getVisibleScoutTabs: () => [{ path: 'home', label: 'Home' }],
  scoutTabPermissionOk: () => false,
}));
vi.mock('../hooks/useTaskNavBadges', () => ({
  useTaskNavBadges: () => ({ assignedCount: 0, watchingCount: 0 }),
}));
vi.mock('../components/TasksNavLabel', () => ({ default: () => <span>Tasks</span> }));

import Settings from './Settings';
import NavbarScheduleHorizontalNav from '../components/NavbarScheduleHorizontalNav';

/**
 * The practice_manager role's Settings keys in the API catalog (src/permissions/permission-catalog.ts).
 * She has no role.definition.manage (Practice Admin only) and no room_loader.config.manage.
 */
const PRACTICE_MANAGER_KEYS = [
  'staff.login.manage',
  'staff.role.assign',
  'role.manual_booking.manage',
  'staff.employee.manage',
  'audit.log.view',
  'practice.branches.manage',
  'practice.locations.manage',
  'appointment_type.manage',
  'booking_goals.manage',
  'cl_seat.manage',
  'auto_task_rule.manage',
  'message_template.manage',
  'euthanasia_config.manage',
  'outside_hospital.manage',
  'patient_status.manage',
  'client_status.manage',
  'payment_type.manage',
  'deposit_account.manage',
  'tax_level.manage',
  'shipping_type.manage',
  'lab_form_template.manage',
  'online_store.settings.manage',
  'membership.plan.manage',
  'inventory.count.review',
  'inventory.supplier.manage',
  // Non-settings keys she also holds.
  'marketing.view',
  'catalog.view',
  'report.production',
];
const EXECUTIVE_KEYS = [
  'marketing.view',
  'analytics.view_all',
  'report.production',
  'report.payments',
];

const ALL_MENUS: Record<string, string[]> = {
  Practice: [
    'Letterhead',
    'Branches & Locations',
    'Patient Statuses',
    'Euthanasia Consent',
    'Outside Hospitals',
    'Automatic Tasks',
    'Room Loader',
    'In-House Lab Forms',
  ],
  Scheduling: [
    'Appointment Types',
    'Manage Closed Days',
    'Practice Booking Goals',
    'Client Offers & Auto-Book',
  ],
  Staff: ['Staff', 'Roles', 'Permission Audit Log', 'CL Seat Assignment'],
  Inventory: ['Online store', 'Refills', 'Mail shipping', 'Waste / disposal', 'Count alerts'],
  Finance: [
    'Payment Types',
    'Client Discounts',
    'Memberships',
    'Production Incentive',
    'Sales Tax',
  ],
  Communication: [
    'Gmail Mailboxes',
    'Live Chat Hours',
    'Calls',
    'Reminders',
    'Email & Text Templates',
    'Forms',
  ],
};

function signIn(role: string, keys: string[], roles: string[] = []) {
  state.role = role;
  state.keys = new Set(keys);
  state.roles = roles;
}

afterEach(() => signIn('employee', []));

function renderSettings(path = '/schedule/settings') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Settings />
    </MemoryRouter>
  );
}

/** Top-level Settings menus shown. */
function menuLabels(): string[] {
  return Array.from(document.querySelectorAll('.settings-tab-menu__trigger')).map(
    (el) => el.textContent?.trim() ?? ''
  );
}

/** The items under one Settings menu. */
function menuItems(label: string): string[] {
  fireEvent.click(screen.getByRole('button', { name: label }));
  const panel = screen.getByRole('menu', { name: `${label} settings` });
  const items = within(panel)
    .getAllByRole('menuitem')
    .map((el) => el.textContent?.trim() ?? '');
  fireEvent.click(screen.getByRole('button', { name: label }));
  return items;
}

describe('RP-A1-2: Settings as a practice manager with an employee login', () => {
  it('shows the Staff tabs and the Finance tabs her keys cover, with no admin-privileges page', async () => {
    signIn('employee', PRACTICE_MANAGER_KEYS, ['practice_manager']);
    renderSettings();

    expect(screen.queryByText(/need admin privileges/i)).toBeNull();
    expect(screen.queryByText('Access Denied')).toBeNull();
    expect(await screen.findByText('appointment types body')).toBeTruthy();

    // Roles opens by role.manual_booking.manage; the role permission editor is still checked by the API.
    expect(menuItems('Staff')).toEqual([
      'Staff',
      'Roles',
      'Permission Audit Log',
      'CL Seat Assignment',
    ]);
    // Production Incentive's API takes admin logins only.
    expect(menuItems('Finance')).toEqual([
      'Payment Types',
      'Client Discounts',
      'Memberships',
      'Sales Tax',
    ]);
  });

  it('hides the tabs whose API only admin logins may use, and the ones she holds no key for', () => {
    signIn('employee', PRACTICE_MANAGER_KEYS, ['practice_manager']);
    renderSettings();
    expect(menuItems('Practice')).not.toContain('Room Loader');
    expect(menuItems('Inventory')).not.toContain('Refills');
    const communication = menuItems('Communication');
    expect(communication).not.toContain('Gmail Mailboxes');
    expect(communication).not.toContain('Forms');
    // Go-live call-dock start date (Nov 11, 2026): admin logins only.
    expect(communication).not.toContain('Calls');
    expect(communication).toEqual(
      expect.arrayContaining(['Live Chat Hours', 'Reminders', 'Email & Text Templates'])
    );
  });

  it('opens the Staff tab from a link', async () => {
    signIn('employee', PRACTICE_MANAGER_KEYS, ['practice_manager']);
    renderSettings('/schedule/settings?tab=employee-directory');
    expect(await screen.findByText('staff body')).toBeTruthy();
  });

  it('a link to a tab she may not open lands on her first tab instead', async () => {
    signIn('employee', PRACTICE_MANAGER_KEYS, ['practice_manager']);
    renderSettings('/schedule/settings?tab=production-incentive');
    expect(screen.queryByText(/need admin privileges/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Production Incentive' })).toBeNull();
  });

  it('a staff member with only the audit-log key sees only that tab', () => {
    signIn('employee', ['audit.log.view']);
    renderSettings();
    expect(menuLabels()).toEqual(['Staff']);
    expect(menuItems('Staff')).toEqual(['Permission Audit Log']);
  });
});

describe('RP-A1: admin login unchanged (D4)', () => {
  it('an admin login with no staff keys still sees every Settings tab', () => {
    signIn('admin', []);
    renderSettings();
    expect(menuLabels()).toEqual(Object.keys(ALL_MENUS));
    for (const [label, items] of Object.entries(ALL_MENUS)) {
      expect(menuItems(label)).toEqual(items);
    }
  });

  it('a superadmin login with no staff keys still sees every Settings tab', () => {
    signIn('superadmin', []);
    renderSettings();
    expect(menuLabels()).toEqual(Object.keys(ALL_MENUS));
  });
});

describe('RP-A1: Executive sees no Settings', () => {
  it('the Settings page refuses an executive', () => {
    signIn('employee', EXECUTIVE_KEYS, ['executive']);
    renderSettings();
    expect(screen.getByText('Access Denied')).toBeTruthy();
    expect(menuLabels()).toEqual([]);
  });
});

describe('RP-A1: navigation (Settings by permission, Admin by admin login only)', () => {
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

  function navItems(): string[] {
    render(
      <MemoryRouter initialEntries={['/schedule/home']}>
        <NavbarScheduleHorizontalNav />
      </MemoryRouter>
    );
    const nav = screen.getByRole('navigation', { name: 'Schedule sections' });
    const inline = nav.querySelector('.navbar-schedule-nav-inline') as HTMLElement;
    return Array.from(inline.children).map((el) => {
      const summary = el.tagName === 'DETAILS' ? el.querySelector('summary') : null;
      return (summary ?? el).textContent?.trim() ?? '';
    });
  }

  it('Practice Manager (employee login): Settings, no Admin', () => {
    signIn('employee', PRACTICE_MANAGER_KEYS, ['practice_manager']);
    const items = navItems();
    expect(items).toContain('Settings');
    expect(items).not.toContain('Admin');
  });

  it('Executive: no Settings, no Admin', () => {
    signIn('employee', EXECUTIVE_KEYS, ['executive']);
    const items = navItems();
    expect(items).not.toContain('Settings');
    expect(items).not.toContain('Admin');
  });

  it('a staff member with one Settings key (Permission Audit Log): Settings, no Admin', () => {
    signIn('employee', ['audit.log.view']);
    const items = navItems();
    expect(items).toContain('Settings');
    expect(items).not.toContain('Admin');
  });

  it('admin login: Settings and Admin, as before', () => {
    signIn('admin', []);
    expect(navItems()).toEqual(expect.arrayContaining(['Settings', 'Admin']));
  });
});
