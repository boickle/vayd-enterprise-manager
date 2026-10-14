/** Parse "45", "45 lbs", etc. to a positive weight in pounds. */
export function parseAppointmentRequestPetWeightLbs(
  value: string | number | null | undefined,
): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const match = String(value).trim().match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function appointmentRequestPetWeightError(
  value: string | number | null | undefined,
): string | null {
  if (!String(value ?? '').trim()) return 'Weight is required';
  if (parseAppointmentRequestPetWeightLbs(value) == null) {
    return 'Enter weight in pounds (e.g. 45 or 45 lbs)';
  }
  return null;
}
