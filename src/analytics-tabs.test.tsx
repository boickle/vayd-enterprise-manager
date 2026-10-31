/**
 * Owner decision (Oct 30, 2026): every analytics tab staff can open is gated by a permission
 * from the role catalog. A tab with none showed to every staff login (a controlled substances
 * director saw payments, calls and memberships).
 */
import { vi } from 'vitest';

vi.mock('./pages/InventoryControlledReportPage', () => ({ default: () => null }));
vi.mock('./pages/InventoryActivityPage', () => ({ default: () => null }));

import { ANALYTICS_TAB_PAGES } from './analytics-tabs';

const staffOnly = (role: unknown) =>
  Array.isArray(role) && role.length > 0 && role.every((r) => r === 'admin' || r === 'superadmin');

it('every tab a staff login can open names the permission that opens it', () => {
  const open = ANALYTICS_TAB_PAGES.filter((t) => !staffOnly(t.role) && !t.permissions?.length);
  expect(open.map((t) => t.path)).toEqual([]);
});

it('gates the tabs the owner asked about', () => {
  const perms = (path: string) => ANALYTICS_TAB_PAGES.find((t) => t.path === path)?.permissions;
  expect(perms('payments')).toEqual(['report.payments']);
  expect(perms('appointments')).toEqual(['report.appointments']);
  expect(perms('booking-calendar')).toEqual(['report.booking_calendar']);
  expect(perms('patient-dormancy')).toEqual(['report.dormancy']);
  expect(perms('email-tracking')).toEqual(['report.communication']);
  expect(perms('memberships')).toEqual(['report.membership']);
  expect(perms('inventory/totals')).toEqual(['report.inventory_valuation']);
  expect(perms('inventory/activity')).toEqual([
    'inventory.activity_log.view',
    'inventory.activity_log.controlled',
  ]);
});
