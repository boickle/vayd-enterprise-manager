// src/api/treatments.ts
import { http } from './http';

// ---------------------------------------------------------------------------
// Types (from GET /treatments/patient/:patientId/history)
// ---------------------------------------------------------------------------

export type TreatmentHistoryPractice = {
  id: number;
  name: string;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  phone1?: string | null;
  [key: string]: unknown;
};

export type TreatmentHistoryPatient = {
  id: number;
  name: string;
  breed?: string | null;
  species?: string | null;
  [key: string]: unknown;
};

export type TreatmentItemLab = {
  id: number;
  name: string;
  code?: string | null;
  price?: string | number | null;
  [key: string]: unknown;
};

export type TreatmentItemProcedure = {
  id: number;
  name: string;
  code?: string | null;
  price?: string | number | null;
  [key: string]: unknown;
};

export type TreatmentItemInventory = {
  id: number;
  name: string;
  code?: string | null;
  price?: string | number | null;
  [key: string]: unknown;
};

export type TreatmentItem = {
  id: number;
  quantity: number;
  price: number;
  serviceFee?: number;
  percentageDiscount?: number;
  minimumPrice?: number;
  totalPrice: number;
  tierPrice?: number | null;
  ignoreTierPricing?: boolean;
  isDeclined?: boolean;
  excludeProductionOnItem?: boolean;
  serviceDate: string;
  lab?: TreatmentItemLab | null;
  procedure?: TreatmentItemProcedure | null;
  inventoryItem?: TreatmentItemInventory | null;
  prescriptions?: unknown[];
  [key: string]: unknown;
};

export type TreatmentWithItems = {
  id: number;
  created?: string;
  updated?: string;
  externalCreated?: string | null;
  externalUpdated?: string | null;
  isActive: boolean;
  pimsId?: string | null;
  pimsType?: string | null;
  isDeleted: boolean;
  practice?: TreatmentHistoryPractice | null;
  patient?: TreatmentHistoryPatient | null;
  treatmentItems: TreatmentItem[];
  isEstimate?: boolean;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Get all treatment records (with line items) for a patient.
 * Used e.g. for room-loader client form questions based on treatment history.
 */
export async function getPatientTreatmentHistory(
  patientId: number
): Promise<TreatmentWithItems[]> {
  const { data } = await http.get<TreatmentWithItems[]>(
    `/treatments/patient/${patientId}/history`
  );
  return data;
}
