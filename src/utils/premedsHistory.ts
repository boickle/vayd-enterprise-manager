import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { fetchPremedsHistory, type PremedsHistoryVisit } from '../api/appointments';

/** Pets (by patient id) whose most recent past visit needed pre-meds. */
export function usePremedsHistory(
  practiceId: number | null | undefined,
  patientIds: Array<string | number>,
  enabled = true
): Map<string, PremedsHistoryVisit> {
  const key = useMemo(
    () =>
      [...new Set(patientIds.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id)))]
        .sort()
        .join(','),
    [patientIds]
  );
  const [byPatient, setByPatient] = useState<Map<string, PremedsHistoryVisit>>(() => new Map());

  useEffect(() => {
    if (!enabled || !practiceId || !key) {
      setByPatient(new Map());
      return;
    }
    let cancelled = false;
    fetchPremedsHistory(practiceId, key.split(','))
      .then((rows) => {
        if (cancelled) return;
        setByPatient(new Map(rows.map((row) => [String(row.patientId), row])));
      })
      .catch(() => {
        if (!cancelled) setByPatient(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, key, enabled]);

  return byPatient;
}

export function premedsHistoryVisitReason(
  visit: PremedsHistoryVisit,
  petName?: string | null
): string {
  if (visit.source === 'chart' || !visit.appointmentStart) {
    const note = visit.premedsNote?.trim();
    return `${petName?.trim() || 'This pet'}'s chart says pre-meds for every visit${
      note ? ` (${note})` : ''
    }`;
  }
  const when = DateTime.fromISO(visit.appointmentStart).toFormat('LLL d, yyyy');
  const type = visit.appointmentTypeName?.trim();
  const who = petName?.trim() ? `${petName.trim()}'s` : 'The';
  return `${who} last visit (${when}${type ? ` · ${type}` : ''}) had pre-meds`;
}

export const PREMEDS_FORWARD_BOOKING_REASON = 'This forward booking was flagged for pre-meds';

/** Notice under "Needs pre-meds" explaining a pre-check, or warning when it was unchecked. */
export function premedsHistoryNotice(reasons: string[], checked: boolean): string | null {
  if (!reasons.length) return null;
  const joined = reasons.join('; ');
  return checked
    ? `Pre-checked: ${joined}. Uncheck if the pet no longer needs them.`
    : `${joined}. Confirm with the client — check the box if the pet still needs them.`;
}
