// LAB-A8: the lab form editor follows the lab_form_template.manage permission.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let granted: string[] = [];
let loginRole = 'employee';
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: (k: string) => granted.includes(k) }),
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ role: loginRole }) }));
vi.mock('../../utils/appDialog', () => ({ appConfirm: vi.fn(async () => true) }));
vi.mock('../../api/inHouseLabs', () => ({
  listLabFormTemplates: vi.fn(async () => [
    {
      id: 7, name: 'Test Glucose', category: 'In-house', description: null, mode: 'analytes',
      elements: [], labs: [], procedures: [], sortOrder: 0, isPublished: true, seedKey: null,
    },
  ]),
  listLabCatalogItems: vi.fn(async () => []),
  archiveLabFormTemplate: vi.fn(),
  createLabFormTemplate: vi.fn(),
  seedLabFormTemplates: vi.fn(),
  updateLabFormTemplate: vi.fn(),
}));

import SettingsLabForms from './SettingsLabForms';

async function open() {
  render(<SettingsLabForms />);
  fireEvent.click(await screen.findByText('Test Glucose'));
  await screen.findByText('Form name');
}

beforeEach(() => {
  granted = [];
  loginRole = 'employee';
});

describe('LAB-A8 SettingsLabForms permission', () => {
  it('a person without lab_form_template.manage sees no new, save or archive buttons', async () => {
    await open();
    expect(screen.queryByRole('button', { name: /New lab form/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add missing standard forms/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save lab form/ })).toBeNull();
    expect(screen.getByDisplayValue('Test Glucose')).toBeDisabled();
  });

  it('a person with the permission sees them', async () => {
    granted = ['lab_form_template.manage'];
    await open();
    expect(screen.getByRole('button', { name: /New lab form/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save lab form/ })).toBeInTheDocument();
  });

  it('an admin login keeps the controls', async () => {
    loginRole = 'admin';
    await open();
    await waitFor(() => expect(screen.getByRole('button', { name: /Save lab form/ })).toBeInTheDocument());
  });
});
