// Permission Audit Log "What changed": role changes and offboards read as words, not raw data (B3, Nov 10).
import { describe, expect, it } from 'vitest';
import { describeDetail } from './SettingsPermissionAudit';

const label = (k: string) => (k === 'membership.cancel' ? 'Cancel a membership' : k);
const staff = (id: unknown) =>
  (({ 7: 'Tess Holt', 9: 'Maya Ortiz' }) as Record<number, string>)[Number(id)] ?? `#${id}`;

describe('Permission Audit Log details', () => {
  it('names the role and office that was added or removed', () => {
    const lines = describeDetail(
      {
        action: 'roles',
        before: [],
        after: [
          {
            roleId: 5,
            slug: 'technician',
            name: 'Technician',
            branchId: 2,
            office: 'Raleigh office',
          },
        ],
      },
      label,
      staff
    );
    expect(lines).toEqual(['Roles: added Technician (Raleigh office)']);
    expect(lines.join(' ')).not.toMatch(/[{}"]/);
  });

  it('lists an offboarding as last day and who takes over, with names', () => {
    const lines = describeDetail(
      {
        offboardingId: 3,
        lastDay: '2026-11-20',
        taskToEmployeeId: 7,
        primaryDoctorToId: 9,
        worksWith: [{ userId: 41, doctorId: 9 }],
        householdClientId: null,
      },
      label,
      staff
    );
    expect(lines).toEqual([
      'Last day: 2026-11-20',
      'Tasks go to: Tess Holt',
      'Their pets and households go to: Maya Ortiz',
      'Now work with Maya Ortiz: 1 person who worked with them',
    ]);
  });

  it('leaves grant rows as they were', () => {
    const lines = describeDetail(
      { action: 'grant', permissionKey: 'membership.cancel' },
      label,
      staff
    );
    expect(lines).toEqual(['action: grant', 'permissionKey: Cancel a membership']);
  });
});
