function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export type AppointmentRequestPetEuthNotes = {
  needsTodayDetails: string | null;
  euthanasiaReason: string | null;
  beenToVetLastThreeMonths: string | null;
  interestedInOtherOptions: string | null;
  aftercarePreference: string | null;
};

export function appointmentRequestPetEuthNotesFromRequestData(
  requestData: Record<string, unknown>,
  specific: Record<string, unknown> | null,
  opts?: { allowTopLevelFallback?: boolean },
): AppointmentRequestPetEuthNotes {
  const fallback = opts?.allowTopLevelFallback !== false;
  const fromSpecific = (field: string) => (specific ? pickStr(specific[field]) : null);
  const fromTop = (field: string) => (fallback ? pickStr(requestData[field]) : null);

  return {
    needsTodayDetails:
      fromSpecific('needsTodayDetails') ??
      fromTop('visitDetails') ??
      fromTop('needsTodayDetails'),
    euthanasiaReason: fromSpecific('euthanasiaReason') ?? fromTop('euthanasiaReason'),
    beenToVetLastThreeMonths:
      fromSpecific('beenToVetLastThreeMonths') ?? fromTop('beenToVetLastThreeMonths'),
    interestedInOtherOptions:
      fromSpecific('interestedInOtherOptions') ?? fromTop('interestedInOtherOptions'),
    aftercarePreference:
      fromSpecific('aftercarePreference') ?? fromTop('aftercarePreference'),
  };
}

/** Owner-entered lines for staff notes / detail views (matches online-booking paragraph fields). */
export function formatAppointmentRequestPetStaffNoteLines(
  notes: AppointmentRequestPetEuthNotes,
): string[] {
  const lines: string[] = [];
  const details = notes.needsTodayDetails?.trim();
  if (details) lines.push(details);

  const euthReason = notes.euthanasiaReason?.trim();
  if (euthReason) lines.push(euthReason);

  const beenToVet = notes.beenToVetLastThreeMonths?.trim();
  if (beenToVet) lines.push(`Been to the vet in the last three months: ${beenToVet}`);

  const otherOptions = notes.interestedInOtherOptions?.trim();
  if (otherOptions) lines.push(otherOptions);

  const aftercare = notes.aftercarePreference?.trim();
  if (aftercare) lines.push(`Aftercare: ${aftercare}`);

  return lines;
}

export function buildAppointmentRequestPetClientDetails(
  requestData: Record<string, unknown>,
  specific: Record<string, unknown> | null,
  opts?: { allowTopLevelFallback?: boolean },
): string | null {
  const lines = formatAppointmentRequestPetStaffNoteLines(
    appointmentRequestPetEuthNotesFromRequestData(requestData, specific, opts),
  );
  return lines.length ? lines.join('\n\n') : null;
}

export function buildAppointmentRequestPetStaffInstructions(
  opts: {
    appointmentType?: string | null;
    requestData?: Record<string, unknown>;
    specific?: Record<string, unknown> | null;
    clientDetails?: string | null;
    allowTopLevelFallback?: boolean;
    globalNotes?: string | null;
  },
): string {
  const parts: string[] = ['Online Booking'];
  const typeLabel = opts.appointmentType?.trim();
  if (typeLabel) parts.push(typeLabel);

  const noteLines =
    opts.requestData != null
      ? formatAppointmentRequestPetStaffNoteLines(
          appointmentRequestPetEuthNotesFromRequestData(
            opts.requestData,
            opts.specific ?? null,
            { allowTopLevelFallback: opts.allowTopLevelFallback },
          ),
        )
      : (opts.clientDetails?.trim() ? [opts.clientDetails.trim()] : []);

  if (noteLines.length > 0) {
    parts.push(noteLines.join('\n\n'));
  } else if (opts.globalNotes?.trim()) {
    parts.push(opts.globalNotes.trim());
  }

  return parts.join('\n\n');
}
