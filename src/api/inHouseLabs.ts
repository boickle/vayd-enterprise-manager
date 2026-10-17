import { http } from './http';
import type { LabFormElement, LabFormElementValueType, LabFormMode } from '../utils/labValues';

export type { LabFormElement, LabFormElementValueType, LabFormMode };
export { formatLabRange, isLabValueAbnormal, resultedByLabel } from '../utils/labValues';

/** The JWT carries no practice, so every call scopes itself the way the rest of the app does. */
const pid = () => Number(import.meta.env.VITE_PRACTICE_ID) || 1;

// ─── Templates ────────────────────────────────────────────────────────────────

export type LabCatalogItem = {
  id: number;
  name: string;
  code: string | null;
};

export type LabFormTemplate = {
  id: number;
  name: string;
  category: string;
  description: string | null;
  mode: LabFormMode;
  elements: LabFormElement[];
  labs?: LabCatalogItem[];
  sortOrder: number;
  isPublished: boolean;
  seedKey: string | null;
};

export type UpsertLabFormTemplate = {
  name?: string;
  category?: string;
  description?: string | null;
  mode?: LabFormMode;
  elements?: LabFormElement[];
  labIds?: number[];
  sortOrder?: number;
  isPublished?: boolean;
  seedKey?: string | null;
};

export async function listLabFormTemplates(includeArchived = false): Promise<LabFormTemplate[]> {
  const { data } = await http.get<LabFormTemplate[]>('/in-house-labs/templates', {
    params: { includeArchived, practiceId: pid() },
  });
  return data;
}

export async function getLabFormTemplate(id: number): Promise<LabFormTemplate> {
  const { data } = await http.get<LabFormTemplate>(`/in-house-labs/templates/${id}`, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function createLabFormTemplate(body: UpsertLabFormTemplate): Promise<LabFormTemplate> {
  const { data } = await http.post<LabFormTemplate>('/in-house-labs/templates', body, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function updateLabFormTemplate(
  id: number,
  body: UpsertLabFormTemplate
): Promise<LabFormTemplate> {
  const { data } = await http.patch<LabFormTemplate>(`/in-house-labs/templates/${id}`, body, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function archiveLabFormTemplate(id: number): Promise<void> {
  await http.delete(`/in-house-labs/templates/${id}`, { params: { practiceId: pid() } });
}

export async function seedLabFormTemplates(
  templates: UpsertLabFormTemplate[]
): Promise<{ created: number; updated: number }> {
  const { data } = await http.post<{ created: number; updated: number }>(
    '/in-house-labs/templates/seed',
    { templates },
    { params: { practiceId: pid() } }
  );
  return data;
}

/** Catalog lab items, for assigning which tests open which form. */
export async function listLabCatalogItems(): Promise<LabCatalogItem[]> {
  const { data } = await http.get<LabCatalogItem[]>('/in-house-labs/catalog-labs', {
    params: { practiceId: pid() },
  });
  return data;
}

export async function listTemplatesForLab(labId: number): Promise<LabFormTemplate[]> {
  const { data } = await http.get<LabFormTemplate[]>(`/in-house-labs/for-lab/${labId}`, {
    params: { practiceId: pid() },
  });
  return data;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export type LabResultStatus = 'pending' | 'complete';

export type LabResultValue = {
  value: string | null;
  comments: string | null;
};

export type LabResult = {
  id: number;
  patientId: number;
  medicalRecordId: number | null;
  labFormTemplateId: number | null;
  labId: number | null;
  encounterOrderId: number | null;
  /** Invoice line the lab was charged on — how the invoice, SOAP, and chart find it. */
  visitInvoiceLineId: string | null;
  status: LabResultStatus;
  templateName: string;
  templateMode: LabFormMode;
  elementsSnapshot: LabFormElement[];
  values: Record<string, LabResultValue>;
  summary: string | null;
  resultedByEmployeeId: number | null;
  resultedAt: string | null;
  serviceDate: string | null;
  patient?: { id: number; name?: string | null } | null;
  lab?: LabCatalogItem | null;
  resultedBy?: { id: number; firstName?: string | null; lastName?: string | null } | null;
};

export async function listPatientLabResults(patientId: number): Promise<LabResult[]> {
  const { data } = await http.get<LabResult[]>('/in-house-labs/results', {
    params: { patientId, practiceId: pid() },
  });
  return data;
}

export async function listLabResultsForOrders(encounterOrderIds: number[]): Promise<LabResult[]> {
  if (!encounterOrderIds.length) return [];
  const { data } = await http.get<LabResult[]>('/in-house-labs/results', {
    params: { encounterOrderIds: encounterOrderIds.join(','), practiceId: pid() },
  });
  return data;
}

/**
 * Results for every lab line on a bill. The API opens a pending form for each
 * lab line that has one, so a snap test can be entered right on the invoice.
 */
/** Every form charged on one invoice line, pending and already resulted. */
export async function listLabResultsForLine(lineId: string): Promise<LabResult[]> {
  const { data } = await http.get<LabResult[]>(
    `/in-house-labs/results/for-line/${encodeURIComponent(lineId)}`,
    { params: { practiceId: pid() } },
  );
  return data;
}

export async function listLabResultsForInvoice(invoiceId: string): Promise<LabResult[]> {
  const { data } = await http.get<LabResult[]>(
    `/in-house-labs/results/for-invoice/${encodeURIComponent(invoiceId)}`,
    { params: { practiceId: pid() } }
  );
  return data;
}

/** Group a bill's results by the invoice line they were charged on. */
export function groupLabResultsByLine(results: LabResult[]): Record<string, LabResult[]> {
  const out: Record<string, LabResult[]> = {};
  for (const r of results) {
    if (!r.visitInvoiceLineId) continue;
    (out[r.visitInvoiceLineId] ??= []).push(r);
  }
  return out;
}

/** Everything ordered but not yet run, across the practice or for one patient. */
export async function listPendingLabResults(patientId?: number): Promise<LabResult[]> {
  const { data } = await http.get<LabResult[]>('/in-house-labs/results/pending', {
    params: { practiceId: pid(), ...(patientId ? { patientId } : {}) },
  });
  return data;
}

export async function getLabResult(id: number): Promise<LabResult> {
  const { data } = await http.get<LabResult>(`/in-house-labs/results/${id}`, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function createLabResult(body: {
  patientId: number;
  labFormTemplateId: number;
  medicalRecordId?: number | null;
  labId?: number | null;
  encounterOrderId?: number | null;
  visitInvoiceLineId?: string | null;
  serviceDate?: string | null;
}): Promise<LabResult> {
  const { data } = await http.post<LabResult>('/in-house-labs/results', body, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function saveLabResult(
  id: number,
  body: {
    values?: Record<string, { value?: string | null; comments?: string | null }>;
    summary?: string | null;
    /** Omit to complete; send 'pending' to park a half-run panel. */
    status?: LabResultStatus;
    serviceDate?: string | null;
  }
): Promise<LabResult> {
  const { data } = await http.patch<LabResult>(`/in-house-labs/results/${id}`, body, {
    params: { practiceId: pid() },
  });
  return data;
}

export async function deleteLabResult(id: number): Promise<void> {
  await http.delete(`/in-house-labs/results/${id}`, { params: { practiceId: pid() } });
}
