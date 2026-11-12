import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('./http', () => ({ http: { post: (...args: unknown[]) => post(...args) } }));

import { saveEmployees, upsertEmployees } from './employeesMutations';

/**
 * RP-02 (docs/test-plans/roles-and-permissions.md in vayd-api): Settings → Staff and Admin → Users
 * send the GET /employees/:id body back to the save. Its roleIds include office roles, and saving
 * them made every office role practice-wide. Roles change only through PUT /employees/:id/roles.
 */
describe('employee save never sends roles (RP-02)', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: { ok: true } });
  });

  const fromGet = {
    id: 42,
    firstName: 'Tess',
    lastName: 'Tech',
    roleIds: [30, 31],
    roleAssignments: [
      { roleId: 30, branchId: 2 },
      { roleId: 31, branchId: null },
    ],
    isActive: false,
  };

  it('drops roleIds and roleAssignments from a single save (edit, deactivate, reactivate)', async () => {
    await saveEmployees(fromGet);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/employees');
    expect(body).not.toHaveProperty('roleIds');
    expect(body).not.toHaveProperty('roleAssignments');
    expect(body).toMatchObject({ id: 42, lastName: 'Tech', isActive: false });
  });

  it('drops them from every row of a list save and from upsert', async () => {
    await saveEmployees([fromGet, { ...fromGet, id: 43 }]);
    for (const row of post.mock.calls[0][1]) {
      expect(row).not.toHaveProperty('roleIds');
      expect(row).not.toHaveProperty('roleAssignments');
    }
    await upsertEmployees({ ...fromGet, pimsId: 'P1' });
    expect(post.mock.calls[1][0]).toBe('/employees/upsert');
    expect(post.mock.calls[1][1]).not.toHaveProperty('roleIds');
  });

  it('does not change the object the screen passed in', async () => {
    const dto = { ...fromGet };
    await saveEmployees(dto);
    expect(dto.roleIds).toEqual([30, 31]);
  });
});
