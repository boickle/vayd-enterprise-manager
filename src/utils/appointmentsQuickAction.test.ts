import { describe, expect, it } from 'vitest';
import { mayShowAppointmentsQuickAction } from './appointmentsQuickAction';

const staff =
  (...held: string[]) =>
  (...wanted: string[]) =>
    wanted.some((r) => held.includes(r));

describe('Appointments quick action', () => {
  it('shows for CLs, lead CLs, practice managers and practice admins', () => {
    for (const role of [
      'client_liaison',
      'lead_client_liaison',
      'practice_manager',
      'practice_admin',
    ]) {
      expect(mayShowAppointmentsQuickAction(['employee'], staff(role))).toBe(true);
    }
  });
  it('shows for admin logins', () => {
    expect(mayShowAppointmentsQuickAction(['admin'], staff())).toBe(true);
  });
  it('does not show for doctors or technicians', () => {
    expect(mayShowAppointmentsQuickAction(['employee'], staff('veterinarian'))).toBe(false);
    expect(mayShowAppointmentsQuickAction(['employee'], staff('technician'))).toBe(false);
  });
});
