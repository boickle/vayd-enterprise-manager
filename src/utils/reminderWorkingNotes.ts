/** Staff "Outreach notes" on care outreach / schedule loader reminders. */
export function readReminderOutreachNotes(
  r: { outreachNotes?: string | null; notes?: string | null } | Record<string, unknown>,
): string {
  const any = r as Record<string, unknown>;
  const snake = typeof any.outreach_notes === 'string' ? any.outreach_notes : null;
  const typed = r as { outreachNotes?: string | null; notes?: string | null };
  return String(typed.outreachNotes ?? snake ?? typed.notes ?? '').trim();
}

/** Combine unique outreach notes from one or more reminders for forward-booking `note`. */
export function workingNotesFromReminders(
  reminders: readonly { outreachNotes?: string | null; notes?: string | null }[],
): string | null {
  const unique = [...new Set(reminders.map(readReminderOutreachNotes).filter(Boolean))];
  if (unique.length === 0) return null;
  return unique.join('\n\n');
}

export function buildReminderOutreachNotesByPatientId(
  reminders: readonly {
    patient?: { id?: number } | null;
    outreachNotes?: string | null;
    notes?: string | null;
  }[],
): Map<number, string> {
  const byPatient = new Map<number, Set<string>>();
  for (const reminder of reminders) {
    const patientId = reminder.patient?.id;
    if (patientId == null || !Number.isFinite(patientId)) continue;
    const text = readReminderOutreachNotes(reminder);
    if (!text) continue;
    const set = byPatient.get(patientId) ?? new Set<string>();
    set.add(text);
    byPatient.set(patientId, set);
  }
  const out = new Map<number, string>();
  for (const [patientId, texts] of byPatient) {
    out.set(patientId, [...texts].join('\n\n'));
  }
  return out;
}
