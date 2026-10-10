export type ChartIdentity = {
  clientName: string | null;
  staffName: string | null;
  staffRole: string | null;
  staffEmail: string | null;
  practiceName: string | null;
  practicePhone: string | null;
  practiceEmail: string | null;
  practiceAddress: string | null;
  practiceWebsite: string | null;
};

export function letterheadBlock(id: ChartIdentity | null, patientName?: string | null): string {
  const lines = [
    'LETTERHEAD — use these exact values in any client email. Never write square-bracket placeholders.',
    patientName?.trim() ? `Patient: ${patientName.trim()}` : '',
    id?.clientName?.trim() ? `Owner: ${id.clientName.trim()}` : 'Owner: (not on file — greet as "Hello," not "Dear Owner")',
    id?.staffName?.trim()
      ? `Staff: ${id.staffName.trim()}${id.staffRole?.trim() ? `, ${id.staffRole.trim()}` : ''}`
      : '',
    id?.staffEmail?.trim() ? `Staff email: ${id.staffEmail.trim()}` : '',
    id?.practiceName?.trim() ? `Clinic: ${id.practiceName.trim()}` : '',
    id?.practicePhone?.trim() ? `Clinic phone: ${id.practicePhone.trim()}` : '',
    id?.practiceEmail?.trim() ? `Clinic email: ${id.practiceEmail.trim()}` : '',
    id?.practiceAddress?.trim() ? `Clinic address: ${id.practiceAddress.trim()}` : '',
    id?.practiceWebsite?.trim() ? `Clinic website: ${id.practiceWebsite.trim()}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function ownerFirst(name: string): string {
  return name.split(/\s+/)[0] || name;
}

/** Swap leftover template tokens after the model replies. */
export function fillLetterheadPlaceholders(text: string, id: ChartIdentity | null): string {
  if (!id) return text;
  let out = text;
  if (id.clientName?.trim()) {
    const name = id.clientName.trim();
    out = out.replace(/\[Owner'?s?\s*Name\]/gi, name);
    out = out.replace(/\bDear Owner\b/gi, `Dear ${ownerFirst(name)}`);
  }
  if (id.staffName?.trim()) out = out.replace(/\[Your Name\]/gi, id.staffName.trim());
  if (id.staffRole?.trim()) {
    out = out.replace(/\[Your Position\]/gi, id.staffRole.trim());
    out = out.replace(/\[Your Title\]/gi, id.staffRole.trim());
  }
  const contact = [id.practicePhone, id.staffEmail, id.practiceEmail].filter(Boolean).join(' · ');
  if (contact) out = out.replace(/\[Your Contact Information\]/gi, contact);
  if (id.practiceName?.trim()) {
    const clinic = id.practiceName.trim();
    out = out.replace(/\[Veterinary Clinic Name\]/gi, clinic);
    out = out.replace(/\[Clinic Name\]/gi, clinic);
    out = out.replace(/\[Practice Name\]/gi, clinic);
  }
  if (id.practicePhone?.trim()) out = out.replace(/\[Clinic Phone\]/gi, id.practicePhone.trim());
  if (id.practiceEmail?.trim()) out = out.replace(/\[Clinic Email\]/gi, id.practiceEmail.trim());
  return out;
}
