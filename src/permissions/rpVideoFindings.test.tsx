/**
 * Findings from checking the permissions training videos (Nov 9, 2026); owner answers the same day.
 * docs/training/permissions.md (training/permissions-scripts).
 *
 *   RPV-5  The Medical Director (holds "Set whether an employee is licensed", nothing else in Staff)
 *          opens Settings → Staff.
 *   RPV-7  A blocked page tells people to ask a practice admin, on their Access tab in Settings → Staff.
 *   RPV-8  The Analytics link needs at least one report: none for the mail order roles, some for a CL.
 */
import { render, screen } from '@testing-library/react';
import { visibleAnalyticsTabs } from '../analytics-tabs';
import { PermissionDenied } from './PermissionGate';
import { allowedSettingsTabs, settingsTabAllowed } from './settingsTabAccess';

const holding = (...keys: string[]) => (key: string) => keys.includes(key);

describe('RPV-5 Medical Director and Settings → Staff', () => {
  it('opens the Staff hub with only "Set whether an employee is licensed"', () => {
    const input = { isAdminLogin: false, can: holding('staff.license.manage') };
    expect(settingsTabAllowed('employee-directory', input)).toBe(true);
    // Not the Roles page or the audit log.
    expect(allowedSettingsTabs(input)).not.toContain('roles');
    expect(allowedSettingsTabs(input)).not.toContain('permission-audit');
  });

  it('still shuts Staff for someone with none of the staff permissions', () => {
    expect(settingsTabAllowed('employee-directory', { isAdminLogin: false, can: holding('soap.edit') })).toBe(false);
  });
});

describe('RPV-7 blocked page wording', () => {
  it('names a practice admin and the Access tab, not "Employee Settings"', () => {
    render(<PermissionDenied what="Bank deposits" />);
    expect(screen.getByText('Bank deposits isn’t part of your access')).toBeInTheDocument();
    expect(
      screen.getByText('Ask a practice admin if you need it — they can add it on your Access tab in Settings → Staff.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Employee Settings|practice manager/)).toBeNull();
  });
});

describe('RPV-8 Analytics link', () => {
  it('has no report for the mail order roles (their catalog keys)', () => {
    const mailOrder = holding(
      'client.view', 'estimate.create', 'invoice.return', 'invoice.legacy.adopt',
      'card_on_file.manage', 'paylink.send', 'store.subscription.manage', 'mail_order.fulfill',
    );
    expect(visibleAnalyticsTabs(['employee'], false, mailOrder)).toHaveLength(0);
  });

  it('has reports for a client liaison', () => {
    const cl = holding('report.appointments', 'report.membership', 'report.communication');
    expect(visibleAnalyticsTabs(['employee'], false, cl).length).toBeGreaterThan(0);
  });

  it('shows everything to an admin login', () => {
    expect(visibleAnalyticsTabs(['admin'], true, () => false).length).toBeGreaterThan(5);
  });
});
