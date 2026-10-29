// IDEXX VetConnect PLUS: send lab lines from a bill, follow the order, read results.
import { http } from './http';

export type IdexxOrderStatus = 'CREATED' | 'SUBMITTED' | 'CANCELLED';

export type IdexxResultBrief = {
  id: number;
  idexxResultId: string;
  status: string | null;
  statusDetail: string | null;
  modality: string | null;
  hasOutOfRange: boolean;
  hasCritical: boolean;
  /** Panel is released but some analytes still read PENDING. */
  hasPending?: boolean;
  reviewedAt: string | null;
  receivedAt: string | null;
};

export type IdexxOrder = {
  id: number;
  idexxOrderId: string;
  status: IdexxOrderStatus;
  modality: 'REFLAB' | 'INHOUSE';
  patientId: number;
  clientId: number | null;
  testCodes: string[];
  labIds: number[];
  orderedByEmployeeId: number | null;
  veterinarianEmployeeId: number | null;
  appointmentId: number | null;
  visitInvoiceId: string | null;
  invoiceLineIds: string[];
  notes: string | null;
  specimenCollectionDate: string | null;
  editable: boolean;
  uiUrl: string | null;
  pdfUrl: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  lastSyncedAt: string | null;
  created: string;
  results: IdexxResultBrief[];
};

export type IdexxInvoiceLine = {
  lineId: string;
  patientId: number | null;
  labId: number;
  labName: string;
  testCode: string | null;
  orderId: number | null;
};

export type IdexxInvoiceState = {
  configured: boolean;
  invoiceStatus: string;
  lines: IdexxInvoiceLine[];
  orders: IdexxOrder[];
};

export type IdexxPatientOverrides = {
  speciesCode?: string;
  breedCode?: string;
  genderCode?: string;
  birthdate?: string;
  weightLbs?: number;
};

export type IdexxPreview = {
  patient: {
    patientId: string;
    name: string;
    speciesCode: string | null;
    breedCode: string | null;
    genderCode: string | null;
    birthdate: string | null;
  } | null;
  missing: string[];
};

export type IdexxResultSummary = {
  id: number;
  idexxResultId: string;
  patientId: number | null;
  orderId: number | null;
  idexxOrderId: string | null;
  requisitionId: string | null;
  accessionId: string | null;
  status: string | null;
  statusDetail: string | null;
  modality: string | null;
  veterinarian: string | null;
  patientName: string | null;
  clientLastName: string | null;
  /** Ordering veterinarian. IDEXX often leaves its own veterinarian field blank. */
  providerEmployeeId?: number | null;
  providerName?: string | null;
  hasOutOfRange: boolean;
  hasCritical: boolean;
  /** Panel is released but some analytes still read PENDING. */
  hasPending?: boolean;
  delayed: boolean;
  testNames: string[];
  specimenCollectionDate: string | null;
  idexxUpdatedAt: string | null;
  receivedAt: string | null;
  reviewedAt: string | null;
  reviewedByEmployeeId: number | null;
  clientSummaryApprovedAt: string | null;
  /** IDEXX sent a newer copy after the client summary was written. */
  clientSummaryStale: boolean;
};

export type IdexxResultTest = {
  code: string | null;
  name: string | null;
  analyte: string | null;
  result: string | null;
  resultNumeric: number | null;
  resultType: string | null;
  qualifier: string | null;
  units: string | null;
  referenceRange: string | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  outOfRange: boolean;
  outOfRangeCode: string | null;
  status: string | null;
  notes: string[];
};

export type IdexxResultCategory = {
  name: string | null;
  code: string | null;
  notes: Array<{ content: string; title?: string | null }>;
  tests: IdexxResultTest[];
};

export type IdexxResultDetail = IdexxResultSummary & {
  orderReceivedDate: string | null;
  notes: { title?: string | null; content?: string | null } | null;
  categories: IdexxResultCategory[];
  delayNotificationAvailable: boolean;
  clientSummary: string | null;
  clientSummaryApprovedByEmployeeId: number | null;
};

export type IdexxSyncResult = {
  order: IdexxOrder;
  /** Tests added inside IDEXX that were put on the bill. */
  added: string[];
  /** Tests added inside IDEXX that could not be put on the bill. */
  uncaptured: Array<{ code: string; name: string | null; reason: string }>;
};

/** Message from an API error, including IDEXX's own field errors. */
export function idexxErrorMessage(
  err: unknown,
  fallback = 'Something went wrong with IDEXX.'
): string {
  const data = (
    err as {
      response?: { data?: { message?: unknown; idexxErrors?: Array<{ message?: string }> } };
    }
  )?.response?.data;
  const detail = data?.idexxErrors
    ?.map((e) => e.message)
    .filter((m): m is string => Boolean(m && !/see data for field level details/i.test(m)));
  if (detail?.length) return detail.join(' ');
  const message = Array.isArray(data?.message) ? data?.message.join(' ') : data?.message;
  if (typeof message === 'string' && message.trim()) return message;
  return err instanceof Error && err.message ? err.message : fallback;
}

export async function getIdexxStatus(check = false) {
  const { data } = await http.get<{
    configured: boolean;
    credentialsValid: boolean | null;
    error?: string;
  }>('/idexx/status', { params: check ? { check: true } : undefined });
  return data;
}

export type IdexxStaffPricing = {
  enabled: boolean;
  mode: 'charge' | 'percent' | 'cost_plus';
  /** Percent off, or markup over cost for cost_plus. */
  percent: number | null;
  /** Fixed staff price; 0 is free. */
  charge: number | null;
};

export type IdexxIntegrationSettings = {
  configured: boolean;
  linkedLabCount: number;
  lastResultAt: string | null;
  staffPricing: IdexxStaffPricing;
};

export async function getIdexxIntegrationSettings() {
  const { data } = await http.get<IdexxIntegrationSettings>('/idexx/settings');
  return data;
}

export async function saveIdexxStaffPricing(pricing: IdexxStaffPricing) {
  const { data } = await http.put<IdexxStaffPricing>('/idexx/settings/staff-pricing', pricing);
  return data;
}

export async function getIdexxInvoiceState(invoiceId: string) {
  const { data } = await http.get<IdexxInvoiceState>(
    `/idexx/invoices/${encodeURIComponent(invoiceId)}`
  );
  return data;
}

export async function getIdexxOrderPreview(patientId: number) {
  const { data } = await http.get<IdexxPreview>('/idexx/orders/preview', { params: { patientId } });
  return data;
}

export async function sendIdexxFromInvoice(
  invoiceId: string,
  body: {
    patientId: number;
    lineIds?: string[];
    veterinarianEmployeeId?: number;
    notes?: string;
    specimenCollectionDate?: string;
    patientOverrides?: IdexxPatientOverrides;
  }
) {
  const { data } = await http.post<IdexxOrder>(
    `/idexx/invoices/${encodeURIComponent(invoiceId)}/orders`,
    body
  );
  return data;
}

/** Re-read the order from IDEXX; tests added there are charged on the bill. */
export async function syncIdexxOrder(orderId: number) {
  const { data } = await http.post<IdexxSyncResult>(`/idexx/orders/${orderId}/sync`);
  return data;
}

export async function cancelIdexxOrder(orderId: number) {
  const { data } = await http.delete<IdexxOrder>(`/idexx/orders/${orderId}`);
  return data;
}

export type IdexxAwaitingLabOrder = IdexxOrder & {
  patientName: string | null;
  clientLastName: string | null;
  testNames: string[];
  /** False when every bill line the order was charged on has been removed. */
  onBill: boolean;
};

/** Orders sent from Scout that IDEXX has no result for yet. */
export async function listIdexxOrdersAwaitingLab() {
  const { data } = await http.get<IdexxAwaitingLabOrder[]>('/idexx/orders/awaiting-lab');
  return data;
}

export async function listIdexxResults(query: {
  patientId?: number;
  orderId?: number;
  status?: 'INPROCESS' | 'COMPLETE' | 'CANCELLED';
  /**
   * True: still at IDEXX, including a released panel with analytes still PENDING.
   * False: every analyte is back.
   */
  incomplete?: boolean;
  /** Ordering veterinarian on the Scout IDEXX order. */
  providerEmployeeId?: number;
  unreviewed?: boolean;
  unmatched?: boolean;
  limit?: number;
  offset?: number;
}) {
  const { data } = await http.get<{ total: number; items: IdexxResultSummary[] }>(
    '/idexx/results',
    {
      params: query,
    }
  );
  return data;
}

export async function getIdexxResult(id: number) {
  const { data } = await http.get<IdexxResultDetail>(`/idexx/results/${id}`);
  return data;
}

export async function setIdexxResultReviewed(id: number, reviewed: boolean) {
  const { data } = await http.patch<IdexxResultSummary>(`/idexx/results/${id}/reviewed`, {
    reviewed,
  });
  return data;
}

/** Saves the owner-facing write-up; `approved` signs off on exactly this wording. */
export async function saveIdexxClientSummary(id: number, summary: string, approved: boolean) {
  const { data } = await http.put<IdexxResultDetail>(`/idexx/results/${id}/client-summary`, {
    summary,
    approved,
  });
  return data;
}

export async function assignIdexxResultPatient(id: number, patientId: number) {
  const { data } = await http.patch<IdexxResultSummary>(`/idexx/results/${id}/patient`, {
    patientId,
  });
  return data;
}

/** "Check for new results now" instead of waiting for the 5-minute job. */
export async function syncIdexxResults() {
  const { data } = await http.post<{
    received: number;
    created: number;
    updated: number;
    unmatched: number;
  }>('/idexx/results/sync');
  return data;
}

/** IDEXX's official report PDF. */
export async function fetchIdexxResultPdf(id: number): Promise<Blob> {
  const res = await http.get<Blob>(`/idexx/results/${id}/pdf`, { responseType: 'blob' });
  return new Blob([res.data], { type: 'application/pdf' });
}

/** IDEXX's official report PDF, as an object URL to open in a new tab. */
export async function idexxResultPdfUrl(id: number): Promise<string> {
  return URL.createObjectURL(await fetchIdexxResultPdf(id));
}

/** Single-use, signed-in link to the result in VetConnect PLUS. Ask right before opening. */
export async function idexxResultViewUrl(id: number): Promise<string> {
  const { data } = await http.get<{ url: string }>(`/idexx/results/${id}/view-url`);
  return data.url;
}

export async function idexxGenders() {
  const { data } = await http.get<Array<{ code: string; name: string }>>(
    '/idexx/reference/genders'
  );
  return data ?? [];
}

export async function idexxSpecies() {
  const { data } = await http.get<Array<{ code: string; name: string }>>(
    '/idexx/reference/species'
  );
  return data ?? [];
}

/**
 * IDEXX can mark a panel COMPLETE (and leave statusDetail blank) while
 * chemistry, T4, or other analytes still read PENDING. Those are partial.
 */
export function idexxResultIsPartial(r: {
  status?: string | null;
  statusDetail?: string | null;
  hasPending?: boolean;
  categories?: Array<{ tests?: Array<{ result?: string | null }> }>;
}): boolean {
  if ((r.status || '').toUpperCase() === 'CANCELLED') return false;
  if ((r.statusDetail || '').toUpperCase() === 'PARTIAL') return true;
  if (r.hasPending) return true;
  return (r.categories ?? []).some((category) =>
    (category.tests ?? []).some((test) => /^pending$/i.test((test.result ?? '').trim()))
  );
}

/** Where an order or result stands, in words staff use. */
export function idexxStatusLabel(order: Pick<IdexxOrder, 'status' | 'results'> | null): {
  label: string;
  tone: 'todo' | 'wait' | 'done' | 'alert' | 'warn' | 'muted';
} {
  if (!order) return { label: 'Not sent', tone: 'todo' };
  if (order.status === 'CANCELLED') return { label: 'Cancelled', tone: 'muted' };
  if (order.status === 'CREATED') return { label: 'Finish in IDEXX', tone: 'todo' };
  const results = order.results ?? [];
  // IDEXX sends a first (in-process) result once the lab has the specimen.
  if (!results.length) return { label: 'Not at IDEXX yet', tone: 'wait' };
  const critical = results.some((r) => r.hasCritical);
  const abnormal = results.some((r) => r.hasOutOfRange);
  const complete = results.every(
    (r) => (r.status || '').toUpperCase() === 'COMPLETE' && !idexxResultIsPartial(r)
  );
  const base = complete ? 'Final' : 'Partial';
  if (critical) return { label: `${base} · critical`, tone: 'alert' };
  if (abnormal) return { label: `${base} · abnormal`, tone: 'warn' };
  return { label: complete ? 'Final · normal' : 'Partial', tone: complete ? 'done' : 'wait' };
}
