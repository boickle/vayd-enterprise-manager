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

export type ReminderCatalogItemType = 'inventory' | 'procedure' | 'lab';

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
  associatedCatalogItemType: ReminderCatalogItemType;
  associatedCatalogItemId: number;
  associatedCatalogItemName: string;
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

function catalogReminderPath(
  practiceId: number,
  itemType: ReminderCatalogItemType,
  itemId: number
): string {
  if (itemType === 'procedure') {
    return `/practice/${practiceId}/procedures/${itemId}/reminders`;
  }
  if (itemType === 'lab') {
    return `/practice/${practiceId}/labs/${itemId}/reminders`;
  }
  return `/practice/${practiceId}/inventory-items/${itemId}/reminders`;
}

export type CatalogItemReminderWrite = {
  creates?: Array<{
    definitionId?: number;
    reminderType?: string;
    description?: string;
    periodUnit?: string;
    remindAt?: number;
    dueAt?: number;
    expireAt?: number;
    adjustByQuantity?: boolean;
    associatedCatalogItemType?: ReminderCatalogItemType | null;
    associatedCatalogItemId?: number | null;
  }>;
  clearDefinitionIds?: number[];
  clearTags?: string[];
};

export async function getCatalogItemReminders(
  practiceId: number,
  itemType: ReminderCatalogItemType,
  itemId: number
): Promise<CatalogItemReminderBundle> {
  const { data } = await http.get<CatalogItemReminderBundle>(
    catalogReminderPath(practiceId, itemType, itemId)
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

export async function putCatalogItemReminders(
  practiceId: number,
  itemType: ReminderCatalogItemType,
  itemId: number,
  body: CatalogItemReminderWrite
): Promise<CatalogItemReminderBundle> {
  const { data } = await http.put<CatalogItemReminderBundle>(
    catalogReminderPath(practiceId, itemType, itemId),
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

export async function getInventoryItemReminders(
  practiceId: number,
  inventoryItemId: number
): Promise<CatalogItemReminderBundle> {
  return getCatalogItemReminders(practiceId, 'inventory', inventoryItemId);
}

export async function putInventoryItemReminders(
  practiceId: number,
  inventoryItemId: number,
  body: CatalogItemReminderWrite
): Promise<CatalogItemReminderBundle> {
  return putCatalogItemReminders(practiceId, 'inventory', inventoryItemId, body);
}
