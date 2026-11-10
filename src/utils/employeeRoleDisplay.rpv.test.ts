import { describe, expect, it } from 'vitest';
import { humanizeEmployeeRoleName } from './employeeRoleDisplay';

describe('humanizeEmployeeRoleName (Nov 9, 2026: Profile tab showed "Executive (read only)")', () => {
  it('keeps hyphens in a name that is already words', () => {
    expect(humanizeEmployeeRoleName('Executive (read-only)')).toBe('Executive (read-only)');
    expect(humanizeEmployeeRoleName('Billing / AR')).toBe('Billing / AR');
  });
  it('still turns slugs into words', () => {
    expect(humanizeEmployeeRoleName('lead_tech')).toBe('lead tech');
    expect(humanizeEmployeeRoleName('lead-tech')).toBe('lead tech');
    expect(humanizeEmployeeRoleName('LeadTech')).toBe('Lead Tech');
  });
});
