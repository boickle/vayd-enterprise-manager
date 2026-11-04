// Staff-only history of a clinical record (EMR-07b): who entered or changed a prescription's
// directions and for which vet, who approved it for dispensing, who printed the label. Never part
// of the medical record, records sent out, the Rx label or the client portal.
import { http } from './http';
import { currentPracticeId } from '../utils/practiceIdFromToken';

/**
 * What the history is asked for. A prescription by its own id, or by the SOAP order or invoice
 * line it was written on (before the prescription row exists). A vaccine dose edited after
 * sign-off (EMR-A2) is asked for by its log id, or by the same order or invoice line.
 */
export type RecordHistoryEntityType =
  | 'prescription'
  | 'vaccination'
  | 'lab_result'
  | 'encounter_order'
  | 'invoice_line';

export type RecordHistoryEntry = {
  id: string;
  at: string;
  kind: string;
  /** Which record the step belongs to (the pet's History lists several kinds together). */
  entityType?: 'prescription' | 'vaccination' | 'lab_result' | 'encounter';
  entityId?: string | null;
  /** What the record is: "Rx #1203", "Rabies 3yr dose", "Heartworm snap", "Visit #4410". */
  subject?: string;
  actorName: string | null;
  actorRole: string | null;
  forName: string | null;
  rxNumber: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** One readable line from the API, e.g. "Label printed by Sam Fernsby (tech), Rx #12345". */
  text: string;
};

export async function getRecordHistory(
  entityType: RecordHistoryEntityType,
  entityId: string | number
): Promise<RecordHistoryEntry[]> {
  const { data } = await http.get<RecordHistoryEntry[]>('/record-history', {
    params: { practiceId: currentPracticeId(), entityType, entityId: String(entityId) },
  });
  return data;
}

/**
 * Every logged step for one pet, newest first: prescriptions, vaccine doses edited after
 * sign-off, in-house lab results entered, edited and completed. Staff only (client logins 403).
 */
export async function getPatientRecordHistory(
  patientId: string | number
): Promise<RecordHistoryEntry[]> {
  const { data } = await http.get<RecordHistoryEntry[]>('/record-history/patient', {
    params: { practiceId: currentPracticeId(), patientId: Number(patientId) },
  });
  return data;
}

/**
 * Log that a prescription label was printed. Called right after the label goes to the printer;
 * a failure here never blocks or undoes the print.
 */
export async function recordRxLabelPrinted(
  rxNumber: string | number | null | undefined
): Promise<void> {
  const n = Number(String(rxNumber ?? '').trim());
  if (!Number.isInteger(n) || n <= 0) return;
  try {
    await http.post('/record-history/rx-label-printed', {
      practiceId: currentPracticeId(),
      rxNumber: n,
    });
  } catch {
    /* the label printed; only the history entry is missing */
  }
}
