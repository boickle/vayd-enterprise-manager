import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabResultForm from './LabResultForm';
import type { LabResult } from '../../api/inHouseLabs';

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
