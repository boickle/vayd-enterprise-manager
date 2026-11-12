/**
 * RP-A1 (docs/test-plans/roles-and-permissions.md in vayd-api): Settings opens by permission, not
 * only by admin login. Each tab is shown to staff who hold the permission that guards its API.
 * Admin and superadmin logins still see every tab (owner decision D4: admin logins unchanged).
 *
 * A tab with no permissions listed stays admin-login only, because its API only lets admin
 * logins in (Gmail mailboxes, production incentive, forms, the refill production switch).
 */
import type { PermissionScope, RoleSlug } from '../api/permissions';

export const SETTINGS_TAB_IDS = [
  'practice-letterhead',
  'branches-locations',
  'euthanasia-consent',
  'outside-hospitals',
  'appointment-types',
  'practice-booking-goals',
  'client-offers',
  'employee-types',
  'employee-zones',
  'employee-schedule',
  'inventory-online-store',
  'inventory-refills',
  'inventory-mail-shipping',
  'inventory-sales-tax',
  'inventory-waste',
  'inventory-count-alerts',
  'employee-images',
  'employee-goals',
  'production-incentive',
  'employee-directory',
  'roles',
  'permission-audit',
  'cl-seat-assignment',
  'gmail-mailboxes',
  'chat-hours',
  'call-dock',
  'reminders',
  'payment-types',
  'client-statuses',
  'patient-statuses',
  'memberships',
  'message-templates',
  'forms',
  'lab-forms',
  'automatic-tasks',
  'room-loader',
] as const;
export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

type TabRequirement = { key: string; atLeast?: PermissionScope };

const STAFF_HUB: TabRequirement[] = [
  { key: 'staff.employee.manage' },
  { key: 'staff.login.manage' },
  { key: 'staff.role.assign' },
  // The Medical Director sets licenses on the Access tab (D1; owner, Nov 9, 2026).
  { key: 'staff.license.manage' },
];

/** Any one of these opens the tab. Empty: admin and superadmin logins only. */
export const SETTINGS_TAB_PERMISSIONS: Record<SettingsTabId, readonly TabRequirement[]> = {
  // Practice
  'practice-letterhead': [{ key: 'practice.branches.manage' }],
  'branches-locations': [{ key: 'practice.branches.manage' }, { key: 'practice.locations.manage' }],
  'patient-statuses': [{ key: 'patient_status.manage' }],
  'euthanasia-consent': [{ key: 'euthanasia_config.manage' }],
  'outside-hospitals': [{ key: 'outside_hospital.manage' }],
  // Also shown (read-only) to the Practice Admin and Practice Manager roles; see settingsTabAllowed.
  'automatic-tasks': [{ key: 'auto_task_rule.manage' }],
  'room-loader': [{ key: 'room_loader.config.manage' }],
  'lab-forms': [{ key: 'lab_form_template.manage' }],
  // Scheduling
  'appointment-types': [{ key: 'appointment_type.manage' }],
  'practice-booking-goals': [{ key: 'booking_goals.manage' }],
  'client-offers': [{ key: 'booking_goals.manage' }],
  // Staff (the old per-section ids open the Staff hub)
  'employee-directory': STAFF_HUB,
  'employee-types': STAFF_HUB,
  'employee-zones': STAFF_HUB,
  'employee-schedule': STAFF_HUB,
  'employee-images': STAFF_HUB,
  'employee-goals': STAFF_HUB,
  roles: [{ key: 'role.definition.manage' }, { key: 'role.manual_booking.manage' }],
  'permission-audit': [{ key: 'audit.log.view' }],
  'cl-seat-assignment': [{ key: 'cl_seat.manage' }],
  // Inventory
  'inventory-online-store': [{ key: 'online_store.settings.manage' }],
  'inventory-refills': [],
  'inventory-mail-shipping': [{ key: 'shipping_type.manage' }],
  'inventory-waste': [{ key: 'inventory.supplier.manage' }],
  'inventory-count-alerts': [{ key: 'inventory.count.review', atLeast: 'all' }],
  // Finance
  'payment-types': [{ key: 'payment_type.manage' }, { key: 'deposit_account.manage' }],
  'client-statuses': [{ key: 'client_status.manage' }],
  memberships: [{ key: 'membership.plan.manage' }],
  'production-incentive': [],
  'inventory-sales-tax': [{ key: 'tax_level.manage' }],
  // Communication
  'gmail-mailboxes': [],
  'chat-hours': [{ key: 'message_template.manage' }],
  // Go-live call-dock start date: admin and superadmin only (API key calls.* has no staff rule).
  'call-dock': [],
  reminders: [{ key: 'message_template.manage' }],
  'message-templates': [{ key: 'message_template.manage' }],
  forms: [],
};

export type SettingsAccessInput = {
  /** Admin or superadmin login. */
  isAdminLogin: boolean;
  can: (permissionKey: string, atLeast?: PermissionScope) => boolean;
  hasRole?: (...roles: RoleSlug[]) => boolean;
};

export function isAdminLoginRole(role: unknown): boolean {
  const roles = Array.isArray(role) ? role : role ? [role] : [];
  return roles.some((r) => ['admin', 'superadmin'].includes(String(r).toLowerCase().trim()));
}

export function settingsTabAllowed(tab: SettingsTabId, input: SettingsAccessInput): boolean {
  if (input.isAdminLogin) return true;
  if (
    tab === 'automatic-tasks' &&
    (input.hasRole?.('practice_admin', 'practice_manager') ?? false)
  ) {
    return true;
  }
  return SETTINGS_TAB_PERMISSIONS[tab].some(({ key, atLeast }) => input.can(key, atLeast));
}

/** Tabs this user may open, in menu order. */
export function allowedSettingsTabs(input: SettingsAccessInput): SettingsTabId[] {
  return SETTINGS_TAB_IDS.filter((tab) => settingsTabAllowed(tab, input));
}

/** Whether Settings shows in the navigation and opens at all. */
export function canOpenSettings(input: SettingsAccessInput): boolean {
  return input.isAdminLogin || allowedSettingsTabs(input).length > 0;
}
