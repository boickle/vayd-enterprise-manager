import { useEffect, useMemo, useState } from 'react';
import { fetchUnscheduledReminders } from '../api/careOutreach';
import { careOutreachChipCountFetchRange } from '../utils/careOutreachPriorityFilters';
import {
  buildHoldContactLogParts,
  holdContactLogWriteTarget,
  holdSourceUsesReminderOutreach,
  mergeContactLogTexts,
} from '../utils/clientContactLog';
import { buildPatientReminderOutreachIndex } from '../utils/reminderWorkingNotes';
import { resolveHoldSubmissionId } from '../utils/holdsOpenInScheduler';
import type { HoldHouseholdGroup } from '../utils/holdsHousehold';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type HoldGroupContactLogMeta = {
  contextNote: string | null;
  contactLog: string | null;
  writeTarget: ReturnType<typeof holdContactLogWriteTarget>;
  reminderIds: number[];
  forwardBookingId: number | null;
  submissionId: number | null;
};

export function buildHoldGroupContactLogMeta(args: {
  group: HoldHouseholdGroup;
  patientReminderOutreachIndex: Map<
    number,
    { mergedText: string; reminderIds: number[] }
  >;
  submissionNotesById: ReadonlyMap<number, string | null | undefined>;
}): HoldGroupContactLogMeta | null {
  const { group, patientReminderOutreachIndex, submissionNotesById } = args;
  const primary = group.anchor;
  const writeTarget = holdContactLogWriteTarget(primary);
  if (!writeTarget) return null;

  const reminderIdSet = new Set<number>();
  let reminderTextParts: string[] = [];
  let forwardBookingId = primary.forwardBooking?.id ?? null;
  let submissionId = resolveHoldSubmissionId(primary);

  for (const hold of group.holds) {
    if (hold.forwardBooking?.id != null) {
      forwardBookingId = hold.forwardBooking.id;
    }
    const subId = resolveHoldSubmissionId(hold);
    if (subId != null) submissionId = subId;

    if (holdSourceUsesReminderOutreach(hold.source) && hold.patient?.id != null) {
      const entry = patientReminderOutreachIndex.get(hold.patient.id);
      if (entry) {
        if (entry.mergedText) reminderTextParts.push(entry.mergedText);
        for (const id of entry.reminderIds) reminderIdSet.add(id);
      }
    }
  }

  const submissionNotes =
    submissionId != null ? submissionNotesById.get(submissionId)?.trim() || null : null;

  const parts = buildHoldContactLogParts({
    hold: primary,
    reminderOutreachNotes: reminderTextParts.join('\n\n') || null,
    submissionNotes,
  });

  const extraLogs: string[] = [];
  for (const hold of group.holds) {
    if (hold.id === primary.id) continue;
    const extra = buildHoldContactLogParts({
      hold,
      reminderOutreachNotes:
        hold.patient?.id != null
          ? patientReminderOutreachIndex.get(hold.patient.id)?.mergedText
          : null,
      submissionNotes:
        resolveHoldSubmissionId(hold) != null
          ? submissionNotesById.get(resolveHoldSubmissionId(hold)!)?.trim() || null
          : null,
    });
    if (extra.contactLog) extraLogs.push(extra.contactLog);
    if (!parts.contextNote && extra.contextNote) {
      parts.contextNote = extra.contextNote;
    }
  }

  return {
    contextNote: parts.contextNote,
    contactLog: mergeContactLogTexts(parts.contactLog, ...extraLogs),
    writeTarget,
    reminderIds: [...reminderIdSet],
    forwardBookingId,
    submissionId,
  };
}

export function useHoldsContactLogIndex(enabled: boolean) {
  const [patientReminderOutreachIndex, setPatientReminderOutreachIndex] = useState<
    ReturnType<typeof buildPatientReminderOutreachIndex>
  >(() => new Map());

  useEffect(() => {
    if (!enabled) {
      setPatientReminderOutreachIndex(new Map());
      return;
    }
    let cancelled = false;
    const range = careOutreachChipCountFetchRange();
    void fetchUnscheduledReminders({
      practiceId: PRACTICE_ID,
      dueDateFrom: range.from,
      dueDateTo: range.to,
      limit: 2000,
    })
      .then((reminders) => {
        if (!cancelled) {
          setPatientReminderOutreachIndex(buildPatientReminderOutreachIndex(reminders));
        }
      })
      .catch(() => {
        if (!cancelled) setPatientReminderOutreachIndex(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(
    () => ({ patientReminderOutreachIndex }),
    [patientReminderOutreachIndex],
  );
}
