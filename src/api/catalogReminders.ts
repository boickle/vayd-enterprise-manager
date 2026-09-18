// Catalog reminder definitions + per-item create/clear associations.
import { http } from './http';

export type CatalogReminderDefinition = {
  id: number;
  practiceId: number;
  reminderType: string;
  description: string;
  periodUnit: string;
  remindAt: number;
  dueAt: number;
  expireAt: number;
  adjustByQuantity: boolean;
  isActive: boolean;
};

export type CatalogItemReminderCreate = {
  id: number;
  definitionId: number;
  reminderType: string;
  description: string;
  periodUnit: string;
  remindAt: number;
  dueAt: number;
  expireAt: number;
  adjustByQuantity: boolean;
};

export type CatalogItemReminderClearDef = {
  id: number;
  definitionId: number;
  reminderType: string;
  description: string;
};

export type CatalogItemReminderBundle = {
  creates: CatalogItemReminderCreate[];
  clearDefinitions: CatalogItemReminderClearDef[];
  clearTags: string[];
  /** False while the rules still mirror eVet; true once someone saved them here. */
  scoutEdited: boolean;
};

export type CatalogReminderDefinitionWrite = {
  reminderType?: string;
  description: string;
  periodUnit?: string;
  remindAt?: number;
  dueAt?: number;
  expireAt?: number;
  adjustByQuantity?: boolean;
};

export async function listCatalogReminderDefinitions(
  practiceId: number
): Promise<CatalogReminderDefinition[]> {
  const { data } = await http.get<CatalogReminderDefinition[]>(
    `/practice/${practiceId}/catalog-reminder-definitions`
  );
  return Array.isArray(data) ? data : [];
}

export async function createCatalogReminderDefinition(
  practiceId: number,
  body: CatalogReminderDefinitionWrite
): Promise<CatalogReminderDefinition> {
  const { data } = await http.post<CatalogReminderDefinition>(
    `/practice/${practiceId}/catalog-reminder-definitions`,
    body
  );
  return data;
}

export async function patchCatalogReminderDefinition(
  practiceId: number,
  id: number,
  body: Partial<CatalogReminderDefinitionWrite> & { isActive?: boolean }
): Promise<CatalogReminderDefinition> {
  const { data } = await http.patch<CatalogReminderDefinition>(
    `/practice/${practiceId}/catalog-reminder-definitions/${id}`,
    body
  );
  return data;
}

export async function getInventoryItemReminders(
  practiceId: number,
  inventoryItemId: number
): Promise<CatalogItemReminderBundle> {
  const { data } = await http.get<CatalogItemReminderBundle>(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}/reminders`
  );
  return (
    data ?? {
      creates: [],
      clearDefinitions: [],
      clearTags: [],
      scoutEdited: false,
    }
  );
}

export async function putInventoryItemReminders(
  practiceId: number,
  inventoryItemId: number,
  body: {
    creates?: Array<{
      definitionId?: number;
      reminderType?: string;
      description?: string;
      periodUnit?: string;
      remindAt?: number;
      dueAt?: number;
      expireAt?: number;
      adjustByQuantity?: boolean;
    }>;
    clearDefinitionIds?: number[];
    clearTags?: string[];
  }
): Promise<CatalogItemReminderBundle> {
  const { data } = await http.put<CatalogItemReminderBundle>(
    `/practice/${practiceId}/inventory-items/${inventoryItemId}/reminders`,
    body
  );
  return (
    data ?? {
      creates: [],
      clearDefinitions: [],
      clearTags: [],
      scoutEdited: true,
    }
  );
}
