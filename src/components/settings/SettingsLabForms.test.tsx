// LAB-A8: the lab form editor follows the lab_form_template.manage permission.
// LAB-A15: Active / Archived tabs, Restore, and the archive prompt's linked-test count.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  archiveLabFormTemplate,
  listLabFormTemplates,
  updateLabFormTemplate,
  type LabFormTemplate,
} from '../../api/inHouseLabs';
import { appConfirm } from '../../utils/appDialog';

let granted: string[] = [];
let loginRole = 'employee';
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: (k: string) => granted.includes(k) }),
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ role: loginRole }) }));
vi.mock('../../utils/appDialog', () => ({ appConfirm: vi.fn(async () => true) }));
vi.mock('../../api/inHouseLabs', () => ({
  listLabFormTemplates: vi.fn(async () => templates),
  listLabCatalogItems: vi.fn(async () => []),
  archiveLabFormTemplate: vi.fn(),
  createLabFormTemplate: vi.fn(),
  seedLabFormTemplates: vi.fn(),
  updateLabFormTemplate: vi.fn(),
}));

import SettingsLabForms from './SettingsLabForms';

const ELEMENTS = [
  { key: 'glu', name: 'GLUCOSE', valueType: 'number', min: 0, max: 500, units: 'mg/dL' },
];

/** The fixture the mocked API serves. Tests replace it to set up active and archived forms. */
let templates: LabFormTemplate[] = [];

function form(over: Partial<LabFormTemplate>): LabFormTemplate {
  return {
    id: 7, name: 'Test Glucose', category: 'In-house', description: null, mode: 'analytes',
    elements: [], labs: [], procedures: [], sortOrder: 0, isPublished: true, seedKey: null,
    ...over,
  } as LabFormTemplate;
}

async function open() {
  render(<SettingsLabForms />);
  fireEvent.click(await screen.findByText('Test Glucose'));
  await screen.findByText('Form name');
}

beforeEach(() => {
  granted = [];
  loginRole = 'employee';
  templates = [form({})];
  vi.clearAllMocks();
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

describe('LAB-A15 archived lab forms', () => {
  beforeEach(() => {
    granted = ['lab_form_template.manage'];
  });

  it('LAB-A15-1: the Active tab lists only the active form; counts 1 and 1', async () => {
    templates = [
      form({ id: 7, name: 'Test Glucose', isPublished: true }),
      form({ id: 8, name: 'Old Cytology', isPublished: false }),
    ];
    render(<SettingsLabForms />);
    await screen.findByText('Test Glucose');
    expect(screen.queryByText('Old Cytology')).toBeNull();
    const active = screen.getByRole('tab', { name: /^Active/ });
    const archived = screen.getByRole('tab', { name: /^Archived/ });
    expect(within(active).getByText('1')).toBeInTheDocument();
    expect(within(archived).getByText('1')).toBeInTheDocument();
    expect(active).toHaveAttribute('aria-selected', 'true');
  });

  it('LAB-A15-2: Restore saves isPublished true with rows and links unchanged, and the form moves to Active', async () => {
    const labs = [{ id: 101, name: 'Glucose', code: 'GLU', catalogItemType: 'lab' as const }];
    const procedures = [{ id: 201, name: 'Schirmer Tear Test', code: null, catalogItemType: 'procedure' as const }];
    templates = [form({ id: 8, name: 'Old Cytology', isPublished: false, elements: ELEMENTS, labs, procedures })];
    vi.mocked(updateLabFormTemplate).mockImplementation(async (id: number, body: Record<string, unknown>) => {
      templates = templates.map((t) => (t.id === id ? { ...t, isPublished: body.isPublished as boolean } : t));
      return templates.find((t) => t.id === id)!;
    });

    render(<SettingsLabForms />);
    await screen.findByText(/No active lab forms/);
    fireEvent.click(screen.getByRole('tab', { name: /^Archived/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Old Cytology/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(updateLabFormTemplate).toHaveBeenCalledTimes(1));
    const [id, body] = vi.mocked(updateLabFormTemplate).mock.calls[0] as [number, Record<string, unknown>];
    expect(id).toBe(8);
    expect(body.isPublished).toBe(true);
    expect(body.elements).toEqual(ELEMENTS);
    expect(body.labIds).toEqual([101]);
    expect(body.procedureIds).toEqual([201]);

    // Moved to Active: the Active tab now lists it and is selected.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(await screen.findByRole('button', { name: /Old Cytology/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Archived/ })).toHaveTextContent('0');
  });

  it('LAB-A15-3: the archive prompt says how many linked tests will stop opening the form', async () => {
    templates = [
      form({
        id: 7,
        name: 'Test Glucose',
        elements: ELEMENTS,
        labs: [
          { id: 101, name: 'Glucose', code: 'GLU', catalogItemType: 'lab' },
          { id: 102, name: 'Glucose repeat', code: 'GLU2', catalogItemType: 'lab' },
        ],
      }),
    ];
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(1));
    const opts = vi.mocked(appConfirm).mock.calls[0][0] as { message: string };
    expect(opts.message).toContain('its 2 linked tests will no longer open it');
    await waitFor(() => expect(archiveLabFormTemplate).toHaveBeenCalledWith(7));
  });
});
