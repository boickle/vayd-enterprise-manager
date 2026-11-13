// Permission Audit Log "What changed": role changes and offboards (B3, Nov 10), grants and licenses
// (B5, Nov 11) read as words, not raw data.
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
      'Last day: Nov 20, 2026',
      'Tasks go to: Tess Holt',
      'Their pets and households go to: Maya Ortiz',
      'Now work with Maya Ortiz: 1 person who worked with them',
    ]);
  });

  it('reads a grant as what was given, how far and until when', () => {
    const lines = describeDetail(
      {
        action: 'grant',
        permissionKey: 'membership.cancel',
        scope: 'all',
        expiresAt: '2026-11-25T00:00:00.000Z',
      },
      label,
      staff
    );
    expect(lines).toEqual(['Extra permission given: Cancel a membership', 'Ends: Nov 25, 2026']);
    expect(
      describeDetail(
        { action: 'grant', permissionKey: 'membership.cancel', scope: 'own', expiresAt: null },
        label,
        staff
      )
    ).toEqual(['Extra permission given: Cancel a membership (their own only)', 'No end date']);
  });

  it('reads a removed grant', () => {
    expect(
      describeDetail({ action: 'revoke', permissionKey: 'membership.cancel' }, label, staff)
    ).toEqual(['Extra permission removed: Cancel a membership']);
  });

  it('reads a license change in words', () => {
    const lines = describeDetail(
      {
        before: { isLicensed: false, licenseType: null },
        after: { isLicensed: true, licenseType: 'technician' },
      },
      label,
      staff
    );
    expect(lines).toEqual(['License: Not licensed → Licensed technician']);
  });
});

describe('license list changes (Nov 12, 2026)', () => {
  it('says what was added, changed and removed', () => {
    const lines = describeDetail(
      {
        action: 'licenses',
        before: [
          { kind: 'veterinary', state: 'ME', number: 'VET1' },
          { kind: 'veterinary', state: 'NH', number: 'NH-5' },
        ],
        after: [
          { kind: 'veterinary', state: 'ME', number: 'VET2' },
          { kind: 'veterinary', state: 'VT', number: 'VT-3' },
        ],
      },
      (k) => k,
    );
    expect(lines).toEqual([
      'License (ME): VET1 → VET2',
      'License (VT) added: VT-3',
      'License (NH) removed (was NH-5)',
    ]);
  });
});
