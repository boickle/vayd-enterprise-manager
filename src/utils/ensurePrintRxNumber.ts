import {
  createPatientPrescription,
  listPatientPrescriptions,
  updatePatientPrescription,
  type PrescriptionAcuity,
} from '../api/visitWorkflow';

function sameMed(
  name: string,
  inventoryItemId: number | null | undefined,
  rx: { name: string; inventoryItemId: number | null; discontinuedAt: string | null }
): boolean {
  if (rx.discontinuedAt) return false;
  if (inventoryItemId != null && rx.inventoryItemId === inventoryItemId) return true;
  return rx.name.trim().toLowerCase() === name.trim().toLowerCase();
}

/** Assigns or reuses a practice Rx number so the label is not printed as "Rx: —". */
export async function ensurePrintRxNumber(input: {
  existingNumber?: string | number | null;
  patientId?: number | null;
  name: string;
  inventoryItemId?: number | null;
  instructions: string;
  refill: number;
  startDate: string;
  refillExpiration?: string;
  acuity?: PrescriptionAcuity | '' | null;
}): Promise<number | null> {
  const existing = Number(input.existingNumber);
  if (Number.isFinite(existing) && existing > 0) return existing;
  if (input.patientId == null) return null;

  const list = await listPatientPrescriptions(input.patientId);
  const match = list.find((rx) => sameMed(input.name, input.inventoryItemId, rx));
  if (match) {
    if (match.rxNumber != null && match.rxNumber > 0) return match.rxNumber;
    const updated = await updatePatientPrescription(match.id, { discontinued: false });
    return updated.rxNumber;
  }

  const acuity: PrescriptionAcuity =
    input.acuity === 'chronic' || input.acuity === 'acute' ? input.acuity : 'acute';
  const created = await createPatientPrescription({
    patientId: input.patientId,
    name: input.name,
    acuity,
    inventoryItemId: input.inventoryItemId ?? null,
    instructions: input.instructions,
    refill: input.refill,
    startDate: input.startDate,
    refillExpiration: input.refillExpiration,
  });
  return created.rxNumber;
}
