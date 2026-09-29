// src/api/visitEstimates.ts
// Quotes priced before the work happens. Separate from visit invoices on purpose:
// nothing in receivables reads an estimate. The one seam into money is `convert`,
// which copies the quoted lines onto a real invoice at the visit.
import { http } from './http';
import { VISIT_WORKFLOW_PRACTICE_ID } from './visitWorkflow';

export type VisitEstimateStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'converted'
  | 'declined'
  | 'expired';

export type VisitEstimateLine = {
  id: string;
  practiceId: number;
  estimateId: string;
  patientId: number | null;
  patientName?: string | null;
  providerEmployeeId: number | null;
  enteredByEmployeeId: number | null;
  enteredByName: string | null;
  catalogItemId: number | null;
  catalogItemType: string | null;
  bundleSaleId: string | null;
  sourceBundleId: number | null;
  sourceBundleName: string | null;
  hideOnInvoice: boolean;
  description: string;
  qty: number;
  unitPrice: number;
  listUnitPrice: number | null;
  amount: number;
  isCovered: boolean;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  /** Virtual: inventory/procedure catalog flag. Missing means no pencil. */
  catalogAllowPriceChange?: boolean;
  created: string;
  updated: string;
};

export type VisitEstimate = {
  id: string;
  practiceId: number;
  appointmentId: number | null;
  patientId: number | null;
  clientId: number | null;
  estimateNumber: number | null;
  title: string | null;
  createdByEmployeeId: number | null;
  status: VisitEstimateStatus;
  subtotal: number;
  membershipAdjustments: number;
  taxTotal: number;
  total: number;
  stripeCustomerId: string | null;
  savedPaymentMethodId: string | null;
  stripePaymentIntentId: string | null;
  lastChargeStatus: string | null;
  authorizedAmount: number | null;
  authorizedAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  expiresAt: string | null;
  convertedInvoiceId: string | null;
  convertedAt: string | null;
  lines: VisitEstimateLine[];
  created: string;
  updated: string;
};

export type UpsertEstimateLineInput = {
  description?: string;
  qty?: number;
  unitPrice?: number;
  catalogItemId?: number | null;
  catalogItemType?: string | null;
  isCovered?: boolean;
  listUnitPrice?: number | null;
  patientId?: number | null;
  providerEmployeeId?: number | null;
  bundleSaleId?: string | null;
  sourceBundleId?: number | null;
  sourceBundleName?: string | null;
};

const practiceId = () => VISIT_WORKFLOW_PRACTICE_ID;

export async function getVisitEstimate(id: string): Promise<VisitEstimate> {
  const { data } = await http.get<VisitEstimate>(
    `/visit-estimates/${id}?practiceId=${practiceId()}`
  );
  return data;
}

/** The live quote on a visit, or null when nobody has written one yet. */
export async function getEstimateForAppointment(
  appointmentId: number
): Promise<VisitEstimate | null> {
  const { data } = await http.get<VisitEstimate | null>(
    `/visit-estimates/by-appointment/${appointmentId}?practiceId=${practiceId()}`
  );
  return data ?? null;
}

export async function listClientEstimates(
  clientId: number,
  opts?: { includeClosed?: boolean }
): Promise<VisitEstimate[]> {
  const query = new URLSearchParams({ practiceId: String(practiceId()) });
  if (opts?.includeClosed) query.set('includeClosed', '1');
  const { data } = await http.get<VisitEstimate[]>(
    `/visit-estimates/client/${clientId}?${query.toString()}`
  );
  return data;
}

/** Open or reuse the quote for a visit. Safe to call on every entry point. */
export async function ensureEstimateForAppointment(input: {
  appointmentId: number;
  patientId?: number | null;
  clientId?: number | null;
  title?: string | null;
}): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>('/visit-estimates/for-appointment', {
    practiceId: practiceId(),
    ...input,
  });
  return data;
}

export async function createVisitEstimate(input: {
  appointmentId?: number | null;
  patientId?: number | null;
  clientId?: number | null;
  title?: string | null;
}): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>('/visit-estimates', {
    practiceId: practiceId(),
    ...input,
  });
  return data;
}

export async function addEstimateLine(
  estimateId: string,
  input: UpsertEstimateLineInput
): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>(
    `/visit-estimates/${estimateId}/lines`,
    { practiceId: practiceId(), ...input }
  );
  return data;
}

export async function updateEstimateLine(
  estimateId: string,
  lineId: string,
  input: UpsertEstimateLineInput
): Promise<VisitEstimate> {
  const { data } = await http.patch<VisitEstimate>(
    `/visit-estimates/${estimateId}/lines/${lineId}`,
    { practiceId: practiceId(), ...input }
  );
  return data;
}

export async function removeEstimateLine(
  estimateId: string,
  lineId: string
): Promise<VisitEstimate> {
  const { data } = await http.delete<VisitEstimate>(
    `/visit-estimates/${estimateId}/lines/${lineId}?practiceId=${practiceId()}`
  );
  return data;
}

export async function markEstimateSent(estimateId: string): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>(`/visit-estimates/${estimateId}/sent`, {
    practiceId: practiceId(),
  });
  return data;
}

export async function markEstimateAccepted(estimateId: string): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>(`/visit-estimates/${estimateId}/accept`, {
    practiceId: practiceId(),
  });
  return data;
}

export async function markEstimateDeclined(estimateId: string): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>(`/visit-estimates/${estimateId}/decline`, {
    practiceId: practiceId(),
  });
  return data;
}

export async function deleteVisitEstimate(estimateId: string): Promise<void> {
  await http.delete(`/visit-estimates/${estimateId}?practiceId=${practiceId()}`);
}

/** Turn the quote into the real bill. Returns the invoice. */
export async function convertEstimateToInvoice(
  estimateId: string
): Promise<{ id: string; total: number; status: string }> {
  const { data } = await http.post(`/visit-estimates/${estimateId}/convert`, {
    practiceId: practiceId(),
  });
  return data;
}

/**
 * Convert, finalize, and take the held money in one call — the post-visit button.
 * Captures less when the final bill came in under the quote, charges the
 * difference to the same card when it came in over.
 */
export async function settleEstimate(
  estimateId: string
): Promise<{ id: string; total: number; status: string }> {
  const { data } = await http.post(`/visit-estimates/${estimateId}/settle`, {
    practiceId: practiceId(),
  });
  return data;
}

/** Card by phone: Stripe authorization hold for the quoted total. */
export async function createEstimateSetupIntent(
  estimateId: string,
  input?: { customerEmail?: string | null; customerName?: string | null }
): Promise<{
  estimateId: string;
  setupIntentClientSecret: string;
  paymentIntentClientSecret: string;
  stripeCustomerId: string;
  amount: number;
}> {
  const { data } = await http.post(`/visit-estimates/${estimateId}/setup-intent`, {
    practiceId: practiceId(),
    ...input,
  });
  return data;
}

export async function saveEstimatePaymentMethod(
  estimateId: string,
  paymentMethodId: string
): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>(
    `/visit-estimates/${estimateId}/payment-method`,
    { practiceId: practiceId(), paymentMethodId }
  );
  return data;
}

export async function recordEstimateAuthorization(
  estimateId: string,
  input: { paymentIntentId: string; paymentMethodId?: string | null }
): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>(
    `/visit-estimates/${estimateId}/record-authorization`,
    { practiceId: practiceId(), ...input }
  );
  return data;
}

/** Hold the quoted amount. No money moves until the invoice captures it. */
export async function authorizeEstimate(estimateId: string): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>(
    `/visit-estimates/${estimateId}/authorize`,
    { practiceId: practiceId() }
  );
  return data;
}

export async function cancelEstimateAuthorization(
  estimateId: string
): Promise<VisitEstimate> {
  const { data } = await http.post<VisitEstimate>(
    `/visit-estimates/${estimateId}/cancel-authorization`,
    { practiceId: practiceId() }
  );
  return data;
}

/** True when a usable hold is sitting on this quote. */
export function hasLiveAuthorization(estimate: VisitEstimate | null): boolean {
  return Boolean(
    estimate?.stripePaymentIntentId && estimate.lastChargeStatus === 'requires_capture'
  );
}

export function estimateHasCard(estimate: VisitEstimate | null): boolean {
  return Boolean(estimate?.savedPaymentMethodId);
}
