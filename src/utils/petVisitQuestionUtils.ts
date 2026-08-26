import type { AppointmentTypeCardOption } from '../components/NewClientAppointmentTypePicker';

export const NEW_CLIENT_SOMETHING_ELSE_LABEL = 'Something else';

export const EUTHANASIA_AFTERCARE_LABEL = 'What are your preferences for aftercare?';

export const EUTHANASIA_AFTERCARE_OPTIONS = [
  "I will handle my pet's remains (e.g. bury at home)",
  'Private Cremation (Cremation WITH return of ashes)',
  'Burial At Sea (Cremation WITHOUT return of ashes)',
  'I am not sure yet.',
] as const;

export function appointmentTypeMatchesPatterns(
  option: AppointmentTypeCardOption,
  patterns: string[],
): boolean {
  const nameLower = option.name.toLowerCase();
  const prettyLower = option.prettyName.toLowerCase();
  return patterns.some(
    (pattern) => nameLower.includes(pattern) || prettyLower.includes(pattern),
  );
}

export function isEuthanasiaTypeOption(option: AppointmentTypeCardOption): boolean {
  return (
    option.name === 'Euthanasia' ||
    option.name.toLowerCase().includes('euthanasia') ||
    option.prettyName.toLowerCase().includes('euthanasia')
  );
}

export function getSelectedAppointmentType(
  petData: {
    needsToday?: string;
    appointmentTypeId?: number;
    appointmentTypeName?: string;
  },
  options: AppointmentTypeCardOption[],
): AppointmentTypeCardOption | null {
  if (!petData.needsToday?.trim() || !options.length) return null;
  const byId = options.find((o) => o.id === petData.appointmentTypeId);
  if (byId) return byId;
  if (petData.needsToday === NEW_CLIENT_SOMETHING_ELSE_LABEL) {
    return options.find((o) => !isEuthanasiaTypeOption(o)) ?? options[0] ?? null;
  }
  return (
    options.find((o) => o.prettyName === petData.needsToday || o.name === petData.needsToday) ?? null
  );
}
