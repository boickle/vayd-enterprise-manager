// src/api/visitWorkflow.ts
// Doctor workflow API: SOAP encounters, Master Problem List, orders (= charges),
// visit invoices/checkout, euthanasia prepay, and the VisitCompleted hub event.
// Mirrors the backend visitWorkflow module. All calls go through the shared
// authenticated axios instance.
import { http } from './http';

export const VISIT_WORKFLOW_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type SoapEncounterMode = 'quick' | 'comprehensive';
export type SoapEncounterStatus = 'draft' | 'completed';

export type PatientProblemKind =
  | 'presenting_complaint'
  | 'rule_out'
  | 'diagnosis';
export type PatientProblemStatus = 'open' | 'active' | 'resolved';

export type EncounterOrderKind =
  | 'exam'
  | 'diagnostic'
  | 'treatment'
  | 'med'
  | 'client_ed';
export type EncounterOrderState = 'proposed' | 'accepted' | 'declined';
export type EncounterOrderCatalogType =
  | 'inventory'
  | 'lab'
  | 'procedure'
  | 'custom';

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
  assessmentProblemIds: string[] | null;
  assessmentReasoning: string | null;
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
  note: string | null;
  createdInEncounterId: string | null;
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
};

export type VisitInvoice = {
  id: string;
  practiceId: number;
  appointmentId: number;
  clientId: number | null;
  status: VisitInvoiceStatus;
  subtotal: number;
  membershipAdjustments: number;
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
  const { data } = await http.get<SoapEncounter>(
    `/soap-encounters/${encodeURIComponent(id)}`,
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
      | 'assessmentProblemIds'
      | 'assessmentReasoning'
      | 'forwardBookingDisposition'
      | 'forwardBookingEntryId'
      | 'forwardBookingTaskId'
    >
  >
): Promise<SoapEncounter> {
  const { data } = await http.patch<SoapEncounter>(
    `/soap-encounters/${encodeURIComponent(id)}`,
    { practiceId: pid(), ...body }
  );
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
  }
): Promise<EncounterOrder> {
  const { data } = await http.post<EncounterOrder>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders`,
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

export async function deleteOrder(
  encounterId: string,
  orderId: string
): Promise<void> {
  await http.delete(
    `/soap-encounters/${encodeURIComponent(encounterId)}/orders/${encodeURIComponent(
      orderId
    )}`,
    { params: { practiceId: pid() } }
  );
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
  body: Partial<Pick<PatientProblem, 'label' | 'kind' | 'status' | 'note'>>
): Promise<PatientProblem> {
  const { data } = await http.patch<PatientProblem>(
    `/patient-problems/${encodeURIComponent(id)}`,
    { practiceId: pid(), ...body }
  );
  return data;
}

export async function deleteProblem(id: string): Promise<void> {
  await http.delete(`/patient-problems/${encodeURIComponent(id)}`, {
    params: { practiceId: pid() },
  });
}

// --- Visit invoice / checkout ---

export async function getInvoiceByAppointment(
  appointmentId: number
): Promise<VisitInvoice | null> {
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
  const { data } = await http.get<VisitInvoice>(
    `/visit-invoices/${encodeURIComponent(id)}`,
    { params: { practiceId: pid() } }
  );
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
  const { data } = await http.post<VisitInvoice>(
    `/visit-invoices/${encodeURIComponent(id)}/void`,
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

export async function createTerminalPaymentIntent(
  invoiceId: string
): Promise<{ id: string; clientSecret: string; invoiceId: string }> {
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

export async function markVisitCompleted(
  appointmentId: number
): Promise<VisitCompletedResult> {
  const { data } = await http.post<VisitCompletedResult>(
    `/visits/${appointmentId}/completed`,
    { practiceId: pid() }
  );
  return data;
}
