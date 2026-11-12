/** Placeholders the lab-panel copy may use. Prices stay on the choices, not in the paragraphs. */
export type LabCopyVars = {
  petName: string;
  doctorName: string;
  panel1: string;
  panel2: string;
};

export function fillLabCopy(html: string, vars: LabCopyVars): string {
  if (!html) return '';
  return html.replace(/\{(petName|doctorName|panel1|panel2)\}/g, (_, key: keyof LabCopyVars) => vars[key] ?? '');
}

export function doctorNameFromAppointment(appointment: unknown): string {
  if (!appointment || typeof appointment !== 'object') return 'your veterinarian';
  const provider = (appointment as { primaryProvider?: Record<string, unknown> }).primaryProvider;
  if (!provider) return 'your veterinarian';
  const first = typeof provider.firstName === 'string' ? provider.firstName.trim() : '';
  const last = typeof provider.lastName === 'string' ? provider.lastName.trim() : '';
  if (!last) return first ? `Dr. ${first}` : 'your veterinarian';
  const title = typeof provider.title === 'string' && provider.title.trim() ? provider.title.trim() : 'Dr.';
  return `${title} ${last}`;
}
