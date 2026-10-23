import { http } from './http';
import { currentPracticeId } from '../utils/practiceIdFromToken';

export type InactivationItemKind =
  | 'membership'
  | 'autoship'
  | 'reminder'
  | 'appointment'
  | 'prescription'
  | 'mailOrder';

export type InactivationItem = {
  kind: InactivationItemKind;
  id: number;
  label: string;
};

export type PatientInactivationRecord = {
  id: number;
  patientId: number;
  items: InactivationItem[];
  created: string;
  restoredAt: string | null;
};

export type MembershipRestoreResult = {
  id: number;
  billingRestarted: boolean;
  firstChargeDate: string | null;
};

export async function recordPatientInactivation(
  patientId: number,
  items: InactivationItem[]
): Promise<PatientInactivationRecord> {
  const { data } = await http.post<PatientInactivationRecord>('/patient-inactivations', {
    practiceId: currentPracticeId(),
    patientId,
    items,
  });
  return data;
}

export async function getOpenPatientInactivation(
  patientId: number
): Promise<PatientInactivationRecord | null> {
  const { data } = await http.get<PatientInactivationRecord | null>(
    `/patient-inactivations/patients/${encodeURIComponent(patientId)}/open`,
    { params: { practiceId: currentPracticeId() } }
  );
  return data && typeof data === 'object' && 'id' in data ? data : null;
}

export async function markPatientInactivationRestored(
  recordId: number,
  items: InactivationItem[]
): Promise<PatientInactivationRecord> {
  const { data } = await http.post<PatientInactivationRecord>(
    `/patient-inactivations/${encodeURIComponent(recordId)}/restored`,
    { practiceId: currentPracticeId(), items }
  );
  return data;
}

/** Same membership year continues; billing restarts at the next regular date. */
export async function restoreMembershipAfterInactivation(
  membershipId: number
): Promise<MembershipRestoreResult> {
  const { data } = await http.post<MembershipRestoreResult>(
    `/memberships/patient-memberships/${encodeURIComponent(membershipId)}/restore`,
    { practiceId: currentPracticeId() }
  );
  return data;
}
