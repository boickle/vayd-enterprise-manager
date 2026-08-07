// src/api/visitWorkflow.ts
// Doctor workflow API: SOAP encounters, Master Problem List, orders (= charges),
// visit invoices/checkout, euthanasia prepay, and the VisitCompleted hub event.
// Mirrors the backend visitWorkflow module. All calls go through the shared
// authenticated axios instance.
import { http } from './http';

export const VISIT_WORKFLOW_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type SoapEncounterMode = 'quick' | 'comprehensive';
export type SoapEncounterStatus = 'draft' | 'completed';

export type PatientProblemKind = 'presenting_complaint' | 'rule_out' | 'diagnosis';
export type PatientProblemStatus = 'open' | 'active' | 'resolved';
/** Chronic problems pin to the top of the patient record; null means nobody has classified it yet. */
export type PatientProblemAcuity = 'acute' | 'chronic';
export type PrescriptionAcuity = 'acute' | 'chronic';

export type EncounterOrderKind = 'exam' | 'diagnostic' | 'treatment' | 'med' | 'client_ed' | 'note';
export type EncounterOrderState = 'proposed' | 'accepted' | 'declined';
export type EncounterOrderCatalogType = 'inventory' | 'lab' | 'procedure' | 'custom';

export type VisitInvoiceStatus = 'open' | 'finalized' | 'paid' | 'void';

export type SoapEncounter = {
  id: string;
  practiceId: number;
  appointmentId: number;
  patientId: number;
  clientId: number | null;
  mode: SoapEncounterMode;
  status: SoapEncounterStatus;
  subjective: Record<string, unknown> | null;
  objectiveVitals: Record<string, unknown> | null;
  objectiveExam: Record<string, unknown> | null;
  objectiveNotes: string | null;
  assessmentProblemIds: string[] | null;
  assessmentReasoning: string | null;
  planNotes: string | null;
  forwardBookingDisposition: Record<string, unknown> | null;
  forwardBookingEntryId: number | null;
  forwardBookingTaskId: number | null;
  completedByEmployeeId: number | null;
  completedAt: string | null;
  created: string;
  updated: string;
};

export type PatientProblem = {
  id: string;
  practiceId: number;
  patientId: number;
  label: string;
  kind: PatientProblemKind;
  status: PatientProblemStatus;
  acuity: PatientProblemAcuity | null;
  note: string | null;
  createdInEncounterId: string | null;
  /** Set by the first encounter completion that addressed this problem — until then it is
   * only on the working list and does not appear on the medical record. */
  postedToRecordAt: string | null;
  resolvedAt: string | null;
  created: string;
  updated: string;
};

export type EncounterOrder = {
  id: string;
  practiceId: number;
  encounterId: string;
  patientId: number;
  catalogItemId: number | null;
  catalogItemType: EncounterOrderCatalogType | null;
  kind: EncounterOrderKind;
  name: string;
  note: string | null;
  qty: number;
  unitPrice: number;
  state: EncounterOrderState;
  isCovered: boolean;
  invoiceLineId: string | null;
  medLabel: Record<string, unknown> | null;
  dischargeInstruction: string | null;
  created: string;
  updated: string;
};

export type VisitInvoiceLine = {
  id: string;
  invoiceId: string;
  orderId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
  isCovered: boolean;
  taxLevelValue?: number | null;
  isTaxExempt?: boolean;
  taxableAmount?: number;
  taxRate?: number;
  taxAmount?: number;
  isDeleted?: boolean;
};

export type VisitInvoice = {
  id: string;
  practiceId: number;
  appointmentId: number;
  clientId: number | null;
  status: VisitInvoiceStatus;
  subtotal: number;
  membershipAdjustments: number;
  /** Sum of line tax snapshots — ready for a sales/tax report. */
  taxTotal: number;
  total: number;
  amountPaid: number;
  isEuthanasiaPrepay: boolean;
  stripeCustomerId: string | null;
  stripeSetupIntentId: string | null;
  savedPaymentMethodId: string | null;
  stripePaymentIntentId: string | null;
  lastChargeStatus: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  lines?: VisitInvoiceLine[];
};

export type VisitCompletedResult = {
  appointmentId: number;
  visitCompletedAt: string;
  euthanasiaCharge?: {
    attempted: boolean;
    success: boolean;
    status: string | null;
    paymentIntentId: string | null;
    needsManualCollection: boolean;
    message?: string | null;
  };
};

const pid = () => VISIT_WORKFLOW_PRACTICE_ID;

// --- Encounters ---

export async function listEncounters(params: {
  appointmentId?: number;
  patientId?: number;
  status?: SoapEncounterStatus;
}): Promise<SoapEncounter[]> {
  const { data } = await http.get<SoapEncounter[]>('/soap-encounters', {
    params: { practiceId: pid(), ...params },
  });
  return data;
}

/**
 * Appointment ids whose SOAP is signed & locked — for calendar lock badges / menu copy.
 * Same pattern as GET /forward-bookings/calendar-index.
 */
export async function fetchSoapCalendarLockIndex(
  practiceId: number = VISIT_WORKFLOW_PRACTICE_ID
): Promise<{ lockedAppointmentIds: number[] }> {
  const { data } = await http.get<{ lockedAppointmentIds?: number[] }>(
    '/soap-encounters/calendar-lock-index',
    { params: { practiceId } }
  );
  const ids = Array.isArray(data?.lockedAppointmentIds)
    ? data.lockedAppointmentIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    : [];
  return { lockedAppointmentIds: ids };
}

export async function createEncounter(body: {
  appointmentId: number;
  patientId: number;
  clientId?: number;
  mode?: SoapEncounterMode;
}): Promise<SoapEncounter> {
  const { data } = await http.post<SoapEncounter>('/soap-encounters', {
    practiceId: pid(),
    ...body,
  });
  return data;
}

export async function getEncounter(id: string): Promise<SoapEncounter> {
  const { data } = await http.get<SoapEncounter>(`/soap-encounters/${encodeURIComponent(id)}`, {
    params: { practiceId: pid() },
  });
  return data;
}

/** One candidate patient for a multi-pet household visit (docs/ai-scribe.md "Multi-pet visits"). */
export type HouseholdRosterEntry = {
  patientId: number;
  patientName: string;
  species: string | null;
  appointmentId: number;
  soapEncounterId: string;
  isCurrent: boolean;
};

/**
 * Other patients from the same client seen around the same time as this encounter's appointment
 * (docs/ai-scribe.md "Multi-pet visits"), always including the current patient. A length-1 result
 * means no siblings were found — the paste-transcript flow stays single-patient in that case.
 */
export async function getHouseholdRoster(encounterId: string): Promise<HouseholdRosterEntry[]> {
  const { data } = await http.get<HouseholdRosterEntry[]>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/household-roster`,
    { params: { practiceId: pid() } }
  );
  return data;
}

export async function updateEncounter(
  id: string,
  body: Partial<
    Pick<
      SoapEncounter,
      | 'mode'
      | 'subjective'
      | 'objectiveVitals'
      | 'objectiveExam'
      | 'objectiveNotes'
      | 'assessmentProblemIds'
      | 'assessmentReasoning'
      | 'planNotes'
      | 'forwardBookingDisposition'
      | 'forwardBookingEntryId'
      | 'forwardBookingTaskId'
    >
  >
): Promise<SoapEncounter> {
  const { data } = await http.patch<SoapEncounter>(`/soap-encounters/${encodeURIComponent(id)}`, {
    practiceId: pid(),
    ...body,
  });
  return data;
}

export async function completeEncounter(id: string): Promise<SoapEncounter> {
  const { data } = await http.post<SoapEncounter>(
    `/soap-encounters/${encodeURIComponent(id)}/complete`,
    { practiceId: pid() }
  );
  return data;
}

// --- Orders (order = charge) ---

export async function listOrders(encounterId: string): Promise<EncounterOrder[]> {
  const { data } = await http.get<EncounterOrder[]>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders`,
    { params: { practiceId: pid() } }
  );
  return data;
}

export async function createOrder(
  encounterId: string,
  body: {
    name: string;
    kind?: EncounterOrderKind;
    catalogItemId?: number;
    catalogItemType?: EncounterOrderCatalogType;
    qty?: number;
    unitPrice?: number;
    isCovered?: boolean;
    state?: EncounterOrderState;
    medLabel?: Record<string, unknown>;
    dischargeInstruction?: string;
    note?: string;
  }
): Promise<EncounterOrder> {
  const { data } = await http.post<EncounterOrder>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders`,
    { practiceId: pid(), ...body }
  );
  return data;
}

export async function updateOrder(
  encounterId: string,
  orderId: string,
  body: {
    name?: string;
    note?: string | null;
    qty?: number;
    unitPrice?: number;
    isCovered?: boolean;
  }
): Promise<EncounterOrder> {
  const { data } = await http.patch<EncounterOrder>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(orderId)}`,
    { practiceId: pid(), ...body }
  );
  return data;
}

export async function setOrderState(
  encounterId: string,
  orderId: string,
  state: EncounterOrderState
): Promise<EncounterOrder> {
  const { data } = await http.patch<EncounterOrder>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(
      orderId
    )}/state`,
    { practiceId: pid(), state }
  );
  return data;
}

export async function deleteOrder(encounterId: string, orderId: string): Promise<void> {
  await http.delete(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(orderId)}`,
    { params: { practiceId: pid() } }
  );
}

// --- What the visit produced: doses given and prescriptions written ---

export type VaccineDosageType = 'booster' | 'initial';

/**
 * A dose recorded against an order. This is a real `vaccination_logs` row, the same table the
 * eVet import fills, so it shows up in the patient chart and the vaccination certificate.
 */
export type OrderVaccination = {
  id: number;
  encounterOrderId: string | null;
  vaccineName: string | null;
  dateVaccinated: string | null;
  nextVaccinationDate: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  vaccineExpiration: string | null;
  tagNumber: string | null;
  manufacturer: string | null;
  vaccineType: string | null;
  dosageType: number | null;
  usdaLicensingMonths: number | null;
  animalControlLicensingMonths: number | null;
  veterinarianName: string | null;
  veterinarianLicense: string | null;
};

/** A prescription written against an order. A real `prescriptions` row. */
export type OrderPrescription = {
  id: number;
  encounterOrderId: string | null;
  name: string;
  strength: string | null;
  instructions: string | null;
  refill: number | null;
  refillExpiration: string | null;
  startDate: string | null;
  rxNumber: number | null;
  acuity: PrescriptionAcuity | null;
  discontinuedAt: string | null;
};

/** A patient-scoped chronic (or any) prescription for the EMR / SOAP pin. */
export type PatientPrescription = {
  id: number;
  name: string;
  strength: string | null;
  instructions: string | null;
  refill: number | null;
  refillExpiration: string | null;
  startDate: string | null;
  acuity: PrescriptionAcuity | null;
  discontinuedAt: string | null;
  /** Catalog item for future refills when the pin was matched to inventory. */
  inventoryItemId: number | null;
};

/**
 * The stock an order consumes, which is often not the item charged: DAPP1, DAPP3 and DAPPBOOST
 * all draw from a single DAPPINV stock item. Read-only — nothing decrements yet.
 */
export type StockDraw = {
  orderId: string;
  inventoryItemId: number;
  inventoryItemName: string;
  inventoryItemCode: string | null;
  quantity: number;
};

export type OrderClinicalDetails = {
  vaccinations: OrderVaccination[];
  prescriptions: OrderPrescription[];
  /** Orders whose catalog item sits in the Vaccines category, so a dose must be recorded. */
  vaccineOrderIds: string[];
  stockDraws: StockDraw[];
};

export async function getOrderClinicalDetails(encounterId: string): Promise<OrderClinicalDetails> {
  const { data } = await http.get<OrderClinicalDetails>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/order-clinical-details`,
    { params: { practiceId: pid() } }
  );
  return data;
}

export type VaccineDefaults = {
  /** Interval from the last time this practice gave this vaccine; null if never. */
  nextDueMonths: number | null;
  manufacturer: string | null;
  vaccineType: string | null;
  serialNumber: string | null;
};

export async function getVaccineDefaults(
  encounterId: string,
  orderId: string,
  catalogItemId: number
): Promise<VaccineDefaults> {
  const { data } = await http.get<VaccineDefaults>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(
      orderId
    )}/vaccination-defaults`,
    { params: { practiceId: pid(), catalogItemId } }
  );
  return data;
}

export type PrescriptionDefaults = {
  instructions: string | null;
  strength: string | null;
  refill: number | null;
  /** Applied to whichever start date the form is showing. */
  refillExpiration: { unit: 'days' | 'months'; amount: number } | null;
  /** ISO date, set instead of `refillExpiration` when the catalog pins a fixed date. */
  refillExpirationDate: string | null;
  source: 'patient-history' | 'catalog' | null;
};

export async function getPrescriptionDefaults(
  encounterId: string,
  orderId: string,
  catalogItemId: number
): Promise<PrescriptionDefaults> {
  const { data } = await http.get<PrescriptionDefaults>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(
      orderId
    )}/prescription-defaults`,
    { params: { practiceId: pid(), catalogItemId } }
  );
  return data;
}

export async function saveOrderVaccination(
  encounterId: string,
  orderId: string,
  body: {
    vaccineName?: string;
    dateVaccinated?: string;
    nextVaccinationDate: string;
    lotNumber?: string;
    serialNumber?: string;
    vaccineExpiration?: string;
    tagNumber?: string;
    manufacturer?: string;
    vaccineType?: string;
    dosageType?: VaccineDosageType;
    usdaLicensingMonths?: number;
    animalControlLicensingMonths?: number;
    employeeId?: number;
  }
): Promise<OrderVaccination> {
  const { data } = await http.put<OrderVaccination>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(
      orderId
    )}/vaccination`,
    { practiceId: pid(), ...body }
  );
  return data;
}

export async function saveOrderPrescription(
  encounterId: string,
  orderId: string,
  body: {
    name?: string;
    strength?: string;
    instructions?: string;
    refill?: number;
    refillExpiration?: string;
    startDate?: string;
    acuity?: PrescriptionAcuity;
    employeeId?: number;
  }
): Promise<OrderPrescription> {
  const { data } = await http.put<OrderPrescription>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(
      orderId
    )}/prescription`,
    { practiceId: pid(), ...body }
  );
  return data;
}

// --- Master Problem List ---

export async function listProblems(
  patientId: number,
  opts?: { activeOnly?: boolean }
): Promise<PatientProblem[]> {
  const { data } = await http.get<PatientProblem[]>('/patient-problems', {
    params: { practiceId: pid(), patientId, activeOnly: opts?.activeOnly },
  });
  return data;
}

export async function createProblem(body: {
  patientId: number;
  label: string;
  kind?: PatientProblemKind;
  status?: PatientProblemStatus;
  acuity?: PatientProblemAcuity;
  note?: string;
  createdInEncounterId?: string;
}): Promise<PatientProblem> {
  const { data } = await http.post<PatientProblem>('/patient-problems', {
    practiceId: pid(),
    ...body,
  });
  return data;
}

export async function updateProblem(
  id: string,
  body: Partial<Pick<PatientProblem, 'label' | 'kind' | 'status' | 'acuity' | 'note'>>
): Promise<PatientProblem> {
  const { data } = await http.patch<PatientProblem>(`/patient-problems/${encodeURIComponent(id)}`, {
    practiceId: pid(),
    ...body,
  });
  return data;
}

export async function deleteProblem(id: string): Promise<void> {
  await http.delete(`/patient-problems/${encodeURIComponent(id)}`, {
    params: { practiceId: pid() },
  });
}

/** Chronic meds still being taken (and optionally the full patient Rx list). */
export async function listPatientPrescriptions(
  patientId: number,
  opts?: { activeChronicOnly?: boolean }
): Promise<PatientPrescription[]> {
  const { data } = await http.get<PatientPrescription[]>('/patient-prescriptions', {
    params: {
      practiceId: pid(),
      patientId,
      activeChronicOnly: opts?.activeChronicOnly,
    },
  });
  return data;
}

/** Mark a prescription as no longer taking (or clear that mark). */
export async function updatePatientPrescription(
  id: number,
  body: { discontinued?: boolean }
): Promise<PatientPrescription> {
  const { data } = await http.patch<PatientPrescription>(
    `/patient-prescriptions/${encodeURIComponent(String(id))}`,
    { practiceId: pid(), ...body }
  );
  return data;
}

/** Freeform chronic med on the patient pin (no checkout charge). */
export async function createPatientPrescription(body: {
  patientId: number;
  name: string;
  acuity?: PrescriptionAcuity;
  inventoryItemId?: number | null;
}): Promise<PatientPrescription> {
  const { data } = await http.post<PatientPrescription>('/patient-prescriptions', {
    practiceId: pid(),
    ...body,
  });
  return data;
}

/** Charged visit item published to the patient medical record after finalize. */
export type PostedVisitCharge = {
  id: string;
  name: string;
  kind: string;
  qty: number;
  unitPrice: number;
  isCovered: boolean;
  postedToRecordAt: string;
  isVaccine: boolean;
  isMed: boolean;
  prescriptionPending: boolean;
  vaccinationPending: boolean;
  prescription: {
    instructions: string | null;
    strength: string | null;
    refill: number;
    acuity: string | null;
    refillExpiration: string | null;
  } | null;
  vaccination: {
    lotNumber: string | null;
    nextVaccinationDate: string | null;
    dateVaccinated: string | null;
  } | null;
};

export async function listPatientVisitCharges(patientId: number): Promise<PostedVisitCharge[]> {
  const { data } = await http.get<PostedVisitCharge[]>('/patient-visit-charges', {
    params: { practiceId: pid(), patientId },
  });
  return data;
}

// --- Visit invoice / checkout ---

export async function getInvoiceByAppointment(appointmentId: number): Promise<VisitInvoice | null> {
  const { data } = await http.get<VisitInvoice | null>(
    `/visit-invoices/by-appointment/${appointmentId}`,
    { params: { practiceId: pid() } }
  );
  return data;
}

export async function createInvoice(body: {
  appointmentId: number;
  clientId?: number;
  isEuthanasiaPrepay?: boolean;
}): Promise<VisitInvoice> {
  const { data } = await http.post<VisitInvoice>('/visit-invoices', {
    practiceId: pid(),
    ...body,
  });
  return data;
}

export async function getInvoice(id: string): Promise<VisitInvoice> {
  const { data } = await http.get<VisitInvoice>(`/visit-invoices/${encodeURIComponent(id)}`, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function finalizeInvoice(id: string): Promise<VisitInvoice> {
  const { data } = await http.post<VisitInvoice>(
    `/visit-invoices/${encodeURIComponent(id)}/finalize`,
    { practiceId: pid() }
  );
  return data;
}

export async function voidInvoice(id: string): Promise<VisitInvoice> {
  const { data } = await http.post<VisitInvoice>(`/visit-invoices/${encodeURIComponent(id)}/void`, {
    practiceId: pid(),
  });
  return data;
}

/** Undo a void — back to open so the bill can be corrected and collected. */
export async function reopenInvoice(id: string): Promise<VisitInvoice> {
  const { data } = await http.post<VisitInvoice>(
    `/visit-invoices/${encodeURIComponent(id)}/reopen`,
    { practiceId: pid() }
  );
  return data;
}

// --- Payments ---

export async function createEuthanasiaSetupIntent(body: {
  appointmentId: number;
  clientId?: number;
  customerEmail?: string;
  customerName?: string;
}): Promise<{
  invoiceId: string;
  setupIntentClientSecret: string;
  stripeCustomerId: string;
}> {
  const { data } = await http.post('/visit-payments/euthanasia-setup', {
    practiceId: pid(),
    ...body,
  });
  return data;
}

export async function savePaymentMethod(
  invoiceId: string,
  paymentMethodId: string
): Promise<VisitInvoice> {
  const { data } = await http.post<VisitInvoice>(
    `/visit-payments/${encodeURIComponent(invoiceId)}/save-payment-method`,
    { practiceId: pid(), paymentMethodId }
  );
  return data;
}

export async function chargeSavedCard(invoiceId: string): Promise<VisitInvoice> {
  const { data } = await http.post<VisitInvoice>(
    `/visit-payments/${encodeURIComponent(invoiceId)}/charge-saved-card`,
    { practiceId: pid() }
  );
  return data;
}

export async function getTerminalConnectionToken(): Promise<{ secret: string }> {
  const { data } = await http.post('/visit-payments/terminal/connection-token', {
    practiceId: pid(),
  });
  return data;
}

export async function createTerminalPaymentIntent(invoiceId: string): Promise<{
  id: string;
  clientSecret: string;
  invoiceId: string;
  invoice?: VisitInvoice;
}> {
  const { data } = await http.post(
    `/visit-payments/${encodeURIComponent(invoiceId)}/terminal/payment-intent`,
    { practiceId: pid() }
  );
  return data;
}

export async function confirmTerminalPayment(
  invoiceId: string,
  paymentIntentId: string
): Promise<VisitInvoice> {
  const { data } = await http.post<VisitInvoice>(
    `/visit-payments/${encodeURIComponent(invoiceId)}/terminal/confirm`,
    { practiceId: pid(), paymentIntentId }
  );
  return data;
}

// --- Visit lifecycle (VisitCompleted hub event) ---

export async function markVisitCompleted(appointmentId: number): Promise<VisitCompletedResult> {
  const { data } = await http.post<VisitCompletedResult>(`/visits/${appointmentId}/completed`, {
    practiceId: pid(),
  });
  return data;
}
