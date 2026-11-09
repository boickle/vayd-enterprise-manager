import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabResultForm from './LabResultForm';
import type { LabResult } from '../../api/inHouseLabs';

// LAB-A9: the entry controls follow lab_result.enter. Tests grant it unless a case says otherwise.
let granted: string[] = [];
let loginRole = 'employee';
vi.mock('../../permissions/PermissionContext', () => ({
  usePermissions: () => ({ can: (k: string) => granted.includes(k) }),
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ role: loginRole }) }));

const saveLabResult = vi.fn();
vi.mock('../../api/inHouseLabs', async (orig) => ({
  ...(await orig<typeof import('../../api/inHouseLabs')>()),
  saveLabResult: (...args: unknown[]) => saveLabResult(...args),
}));

type El = LabResult['elementsSnapshot'][number];
const num = (key: string, name: string, defaultValue: string | null = null): El =>
  ({ key, name, valueType: 'number', min: null, max: null, unit: null, defaultValue, options: null, abnormalOptions: null }) as unknown as El;
const choice = (key: string, name: string, defaultValue: string | null): El =>
  ({ key, name, valueType: 'select', min: null, max: null, unit: null, defaultValue, options: ['Negative', 'Positive'], abnormalOptions: ['Positive'] }) as unknown as El;

function pending(name: string, elementsSnapshot: El[]): LabResult {
  return {
    id: 7, patientId: 1, medicalRecordId: null, labFormTemplateId: 1, labId: null, encounterOrderId: null,
    visitInvoiceLineId: null, status: 'pending', templateName: name, templateMode: 'grid', elementsSnapshot,
    values: {}, summary: null, resultedByEmployeeId: null, resultedAt: null, serviceDate: null,
  } as unknown as LabResult;
}

beforeEach(() => {
  granted = ['lab_result.enter'];
  loginRole = 'employee';
  saveLabResult.mockReset();
  saveLabResult.mockImplementation(async (_id: number, body: { status: string }) => ({ ...pending('x', []), status: body.status }));
});

describe('LabResultForm pre-fill (LAB-05)', () => {
  it('LAB-05-1: Blood Glucose starts blank and Save results is blocked', async () => {
    const onSaved = vi.fn();
    render(<LabResultForm result={pending('Blood Glucose', [num('glu', 'BLOOD GLUCOSE', '0')])} onSaved={onSaved} />);
    expect((screen.getByLabelText('BLOOD GLUCOSE value') as HTMLInputElement).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Save results' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Still blank: BLOOD GLUCOSE');
    expect(saveLabResult).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('LAB-05-2: Fill normal values sets both Negative rows, then Save saves complete', async () => {
    const onSaved = vi.fn();
    render(
      <LabResultForm
        result={pending('Fluorescein', [choice('od', 'OD', 'Negative'), choice('os', 'OS', 'Negative')])}
        onSaved={onSaved}
      />,
    );
    expect((screen.getByLabelText('OD value') as HTMLSelectElement).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Fill normal values' }));
    expect((screen.getByLabelText('OD value') as HTMLSelectElement).value).toBe('Negative');
    expect((screen.getByLabelText('OS value') as HTMLSelectElement).value).toBe('Negative');
    await userEvent.click(screen.getByRole('button', { name: 'Save results' }));
    expect(saveLabResult).toHaveBeenCalledTimes(1);
    const [, body] = saveLabResult.mock.calls[0];
    expect(body.status).toBe('complete');
    expect(body.values.od.value).toBe('Negative');
    expect(body.values.os.value).toBe('Negative');
    expect(onSaved).toHaveBeenCalled();
  });

  it('LAB-05-3: Fill normal values never fills numeric rows', async () => {
    render(
      <LabResultForm
        result={pending('Urine Dipstick', [num('glu', 'GLUCOSE', '0'), num('ph', 'PH', '7'), choice('nit', 'NITRITE', 'Negative')])}
        onSaved={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fill normal values' }));
    expect((screen.getByLabelText('GLUCOSE value') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('PH value') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('NITRITE value') as HTMLSelectElement).value).toBe('Negative');
    await userEvent.click(screen.getByRole('button', { name: 'Save results' }));
    expect(saveLabResult).not.toHaveBeenCalled();
  });
});

describe('LAB-A6 finish later on a completed result', () => {
  it('LAB-A6-1: a completed result shows no "Save, finish later" but keeps Save results', () => {
    const done = { ...pending('Blood Glucose', [num('glu', 'BLOOD GLUCOSE', '0')]), status: 'complete' } as LabResult;
    render(<LabResultForm result={done} onSaved={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save, finish later' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save results' })).toBeInTheDocument();
  });

  it('LAB-A6-1: a pending result still shows "Save, finish later"', () => {
    render(<LabResultForm result={pending('Blood Glucose', [num('glu', 'BLOOD GLUCOSE', '0')])} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save, finish later' })).toBeInTheDocument();
  });
});

describe('LAB-A9 read-only without lab_result.enter', () => {
  it('LAB-A9-1: a liaison sees the form read-only with the line and no save buttons', () => {
    granted = [];
    loginRole = 'client_liaison';
    render(<LabResultForm result={pending('Blood Glucose', [num('glu', 'BLOOD GLUCOSE', '0')])} onSaved={vi.fn()} />);
    expect(screen.getByText('A tech or doctor enters results')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save results' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save, finish later' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fill normal values' })).toBeNull();
    expect(screen.getByLabelText('BLOOD GLUCOSE value')).toBeDisabled();
    expect(screen.getByLabelText('BLOOD GLUCOSE comments')).toBeDisabled();
    expect(saveLabResult).not.toHaveBeenCalled();
  });

  it('LAB-A9-1: a person with lab_result.enter sees the save buttons and no line', () => {
    render(<LabResultForm result={pending('Blood Glucose', [num('glu', 'BLOOD GLUCOSE', '0')])} onSaved={vi.fn()} />);
    expect(screen.queryByText('A tech or doctor enters results')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save results' })).toBeInTheDocument();
    expect(screen.getByLabelText('BLOOD GLUCOSE value')).not.toBeDisabled();
  });

  it('LAB-A9-1: an admin login keeps the save buttons', () => {
    granted = [];
    loginRole = 'admin';
    render(<LabResultForm result={pending('Blood Glucose', [num('glu', 'BLOOD GLUCOSE', '0')])} onSaved={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save results' })).toBeInTheDocument();
  });
});
