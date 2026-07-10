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

export type PatientReminderOutreachEntry = {
  mergedText: string;
  reminderIds: number[];
};

export function buildPatientReminderOutreachIndex(
  reminders: readonly {
    id?: number;
    patient?: { id?: number } | null;
    outreachNotes?: string | null;
    notes?: string | null;
  }[],
): Map<number, PatientReminderOutreachEntry> {
  const byPatient = new Map<number, { texts: Set<string>; reminderIds: number[] }>();
  for (const reminder of reminders) {
    const patientId = reminder.patient?.id;
    const reminderId = reminder.id;
    if (patientId == null || !Number.isFinite(patientId)) continue;
    const entry = byPatient.get(patientId) ?? { texts: new Set<string>(), reminderIds: [] };
    if (reminderId != null && Number.isFinite(reminderId)) {
      entry.reminderIds.push(Number(reminderId));
    }
    const text = readReminderOutreachNotes(reminder);
    if (text) entry.texts.add(text);
    byPatient.set(patientId, entry);
  }
  const out = new Map<number, PatientReminderOutreachEntry>();
  for (const [patientId, entry] of byPatient) {
    out.set(patientId, {
      mergedText: [...entry.texts].join('\n\n'),
      reminderIds: entry.reminderIds,
    });
  }
  return out;
}

export function buildReminderOutreachNotesByPatientId(
  reminders: readonly {
    patient?: { id?: number } | null;
    outreachNotes?: string | null;
    notes?: string | null;
  }[],
): Map<number, string> {
  const out = new Map<number, string>();
  for (const [patientId, entry] of buildPatientReminderOutreachIndex(reminders)) {
    if (entry.mergedText) out.set(patientId, entry.mergedText);
  }
  return out;
}
