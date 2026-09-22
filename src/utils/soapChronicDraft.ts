import {
  createPatientPrescription,
  createProblem,
  getEncounter,
  updateEncounter,
  updatePatientPrescription,
  updateProblem,
} from '../api/visitWorkflow';

export type SoapChronicDraftAddProblem = {
  tempId: string;
  label: string;
  acuity: 'acute' | 'chronic';
};

export type SoapChronicDraftAddMedication = {
  tempId: string;
  name: string;
  inventoryItemId: number | null;
};

export type SoapChronicDraft = {
  addProblems: SoapChronicDraftAddProblem[];
  resolveProblemIds: string[];
  addMedications: SoapChronicDraftAddMedication[];
  discontinueRxIds: number[];
};

function storageKey(encounterId: string): string {
  return `vayd:soap-chronic-draft:${encounterId}`;
}

export function emptySoapChronicDraft(): SoapChronicDraft {
  return {
    addProblems: [],
    resolveProblemIds: [],
    addMedications: [],
    discontinueRxIds: [],
  };
}

export function soapChronicDraftHasChanges(draft: SoapChronicDraft): boolean {
  return (
    draft.addProblems.length > 0 ||
    draft.resolveProblemIds.length > 0 ||
    draft.addMedications.length > 0 ||
    draft.discontinueRxIds.length > 0
  );
}

export function readSoapChronicDraft(encounterId: string | null | undefined): SoapChronicDraft {
  if (!encounterId) return emptySoapChronicDraft();
  try {
    const raw = localStorage.getItem(storageKey(encounterId));
    if (!raw) return emptySoapChronicDraft();
    const parsed = JSON.parse(raw) as Partial<SoapChronicDraft>;
    return {
      addProblems: Array.isArray(parsed.addProblems) ? parsed.addProblems : [],
      resolveProblemIds: Array.isArray(parsed.resolveProblemIds) ? parsed.resolveProblemIds : [],
      addMedications: Array.isArray(parsed.addMedications) ? parsed.addMedications : [],
      discontinueRxIds: Array.isArray(parsed.discontinueRxIds) ? parsed.discontinueRxIds : [],
    };
  } catch {
    return emptySoapChronicDraft();
  }
}

export function writeSoapChronicDraft(
  encounterId: string | null | undefined,
  draft: SoapChronicDraft,
): void {
  if (!encounterId) return;
  try {
    if (!soapChronicDraftHasChanges(draft)) {
      localStorage.removeItem(storageKey(encounterId));
      return;
    }
    localStorage.setItem(storageKey(encounterId), JSON.stringify(draft));
  } catch {
    /* private browsing / quota */
  }
}

export function clearSoapChronicDraft(encounterId: string | null | undefined): void {
  if (!encounterId) return;
  try {
    localStorage.removeItem(storageKey(encounterId));
  } catch {
    /* ignore */
  }
}

export function newSoapChronicDraftId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Persist SOAP working-copy problem/med edits. Called when the doctor signs wrap-up. */
export async function commitSoapChronicDraft(
  encounterId: string,
  patientId: number,
  draft: SoapChronicDraft,
): Promise<void> {
  const createdIds: string[] = [];
  for (const row of draft.addProblems) {
    const created = await createProblem({
      patientId,
      label: row.label,
      kind: 'presenting_complaint',
      acuity: row.acuity,
      createdInEncounterId: encounterId,
    });
    createdIds.push(created.id);
  }
  if (createdIds.length > 0) {
    const enc = await getEncounter(encounterId);
    const prev = enc.assessmentProblemIds ?? [];
    await updateEncounter(encounterId, {
      assessmentProblemIds: Array.from(new Set([...prev, ...createdIds])),
    });
  }
  for (const id of draft.resolveProblemIds) {
    await updateProblem(id, { status: 'resolved' });
  }
  for (const row of draft.addMedications) {
    await createPatientPrescription({
      patientId,
      name: row.name,
      acuity: 'chronic',
      inventoryItemId: row.inventoryItemId,
    });
  }
  for (const id of draft.discontinueRxIds) {
    await updatePatientPrescription(id, { discontinued: true });
  }
  clearSoapChronicDraft(encounterId);
}
