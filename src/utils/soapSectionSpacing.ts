/**
 * Ensure a blank line before Scribble-style section headers so Subjective / Plan / Assessment
 * read clearly (Presenting Complaint → blank → Patient History → blank → Current Medications).
 */
const SECTION_HEADERS = [
  'Presenting Complaint:',
  'Patient History:',
  'Current Medications:',
  'Visit discussion:',
  'Problem List:',
  'Diagnostics:',
  'Treatment Plan/Medications:',
  'Client Communication:',
  'Vital Signs:',
  'Findings:',
] as const;

export function formatSoapSectionSpacing(text: string): string {
  let out = text.replace(/\r\n/g, '\n').trim();
  if (!out) return '';

  for (const header of SECTION_HEADERS) {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Single newline before header → blank line (but not at start of string).
    out = out.replace(new RegExp(`([^\\n])\\n(${escaped})`, 'gi'), '$1\n\n$2');
    // Header jammed on same line after other text (rare) → break with blank line.
    out = out.replace(
      new RegExp(`([^\\n:\\s])[ \\t]*(${escaped})`, 'gi'),
      '$1\n\n$2'
    );
  }

  return out.replace(/\n{3,}/g, '\n\n').trim();
}
