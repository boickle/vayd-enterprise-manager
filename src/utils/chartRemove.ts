export const CHART_REMOVE_REASONS = [
  { id: 'uploaded_in_error', label: 'Uploaded in error' },
  { id: 'wrong_patient', label: 'Wrong patient' },
  { id: 'duplicate', label: 'Duplicate' },
  {
    id: 'not_medical',
    label: 'Not a medical record (personal photo / wrong file)',
  },
] as const;

export type ChartRemoveReasonId = (typeof CHART_REMOVE_REASONS)[number]['id'];

export function chartRemoveReasonLabel(id: string | null | undefined): string {
  const found = CHART_REMOVE_REASONS.find((r) => r.id === id);
  return found?.label ?? (id?.trim() || 'Removed');
}

export function chartRemovePurgesFile(_id: string | null | undefined): boolean {
  return false;
}
