/** Fields used to render staff names in dropdowns and labels. */
export type EmployeeNameFields = {
  firstName?: string | null;
  lastName?: string | null;
  middleName?: string | null;
  middleInitial?: string | null;
  email?: string | null;
};

/** e.g. "Deirdre M. Frey" — matches provider / analytics name formatting. */
export function formatEmployeeDisplayName(emp: EmployeeNameFields): string {
  const parts: string[] = [];
  const first = emp.firstName?.trim();
  const last = emp.lastName?.trim();
  if (first) parts.push(first);
  if (emp.middleInitial?.trim()) {
    const middle = emp.middleInitial.trim();
    parts.push(middle.length === 1 ? `${middle}.` : middle);
  } else if (emp.middleName?.trim()) {
    parts.push(`${emp.middleName.trim().charAt(0).toUpperCase()}.`);
  }
  if (last) parts.push(last);
  if (parts.length > 0) return parts.join(' ');
  return emp.email?.trim() || '';
}
