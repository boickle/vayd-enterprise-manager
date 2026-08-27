import { http } from './http';

/** Membership package definition (benefit bundle / plan catalog row). */
export type MembershipPackage = {
  id: number;
  name: string;
  description?: string | null;
  price?: number | null;
  isArchived?: boolean;
  isAutoRenew?: boolean;
  renewalMonths?: number | null;
  outOfPlanDiscount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
  pimsId?: string | null;
  pimsType?: string | null;
  managedByScout?: boolean;
  practice?: { id?: number; name?: string | null } | null;
};

/** Patient-attached wellness / membership plan. */
export type ManagedWellnessPlan = {
  id: number;
  startDate?: string | null;
  expirationDate?: string | null;
  price?: number | null;
  wellnessPlanStatusValue?: number;
  isActive?: boolean;
  pimsId?: string | null;
  pimsType?: string | null;
  managedByScout?: boolean;
  overrideAutoRenew?: boolean;
  autoRenewPlanId?: number | null;
  patient?: {
    id?: number;
    name?: string | null;
    pimsId?: string | null;
  } | null;
  package?: {
    id?: number;
    name?: string | null;
  } | null;
  practice?: { id?: number; name?: string | null } | null;
  provider?: { id?: number; name?: string | null } | null;
};

export type CreatePackagePayload = {
  practiceId: number;
  name: string;
  description?: string | null;
  price?: number | null;
  isAutoRenew?: boolean;
  renewalMonths?: number | null;
  outOfPlanDiscount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type UpdatePackagePayload = {
  name?: string;
  description?: string | null;
  price?: number | null;
  isAutoRenew?: boolean;
  renewalMonths?: number | null;
  outOfPlanDiscount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  isArchived?: boolean;
  isActive?: boolean;
};

export type CreateWellnessPlanPayload = {
  practiceId: number;
  patientId: number;
  packageId: number;
  startDate: string;
  expirationDate: string;
  wellnessPlanStatusValue?: number;
  price?: number | null;
  providerId?: number | null;
  autoRenewPlanId?: number | null;
  overrideAutoRenew?: boolean;
};

export type UpdateWellnessPlanPayload = {
  packageId?: number;
  startDate?: string;
  expirationDate?: string;
  wellnessPlanStatusValue?: number;
  price?: number | null;
  providerId?: number | null;
  autoRenewPlanId?: number | null;
  overrideAutoRenew?: boolean;
  cancellationReasonId?: number | null;
  isActive?: boolean;
};

/** Product / benefit line item inside a membership package. */
export type MembershipPackageItem = {
  id: number;
  name: string;
  kind: 'procedure' | 'inventory' | 'lab' | 'unknown';
  quantity?: number | null;
  price?: number | null;
  minimumPrice?: number | null;
  maximumPrice?: number | null;
  productionOverride?: number | null;
  ordinal?: number | null;
  managedByScout?: boolean;
  pimsType?: string | null;
  packageId?: number | null;
};

export type UpdatePackageItemPayload = {
  price?: number | null;
  quantity?: number | null;
  minimumPrice?: number | null;
  maximumPrice?: number | null;
  productionOverride?: number | null;
  ordinal?: number | null;
};

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.items)) return d.items as T[];
    if (Array.isArray(d.rows)) return d.rows as T[];
  }
  return [];
}

function toIsoOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'toISO' in v && typeof (v as { toISO: () => string }).toISO === 'function') {
    try {
      return (v as { toISO: () => string }).toISO() || null;
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function normalizePackage(raw: any): MembershipPackage {
  return {
    id: Number(raw?.id),
    name: String(raw?.name ?? ''),
    description: raw?.description ?? null,
    price: raw?.price != null ? Number(raw.price) : null,
    isArchived: !!raw?.isArchived,
    isAutoRenew: !!raw?.isAutoRenew,
    renewalMonths: raw?.renewalMonths != null ? Number(raw.renewalMonths) : null,
    outOfPlanDiscount: raw?.outOfPlanDiscount != null ? Number(raw.outOfPlanDiscount) : null,
    startDate: toIsoOrNull(raw?.startDate),
    endDate: toIsoOrNull(raw?.endDate),
    isActive: raw?.isActive !== false,
    pimsId: raw?.pimsId ?? null,
    pimsType: raw?.pimsType ?? null,
    managedByScout: !!raw?.managedByScout,
    practice: raw?.practice
      ? { id: raw.practice.id != null ? Number(raw.practice.id) : undefined, name: raw.practice.name ?? null }
      : null,
  };
}

function normalizeWellnessPlan(raw: any): ManagedWellnessPlan {
  return {
    id: Number(raw?.id),
    startDate: toIsoOrNull(raw?.startDate),
    expirationDate: toIsoOrNull(raw?.expirationDate),
    price: raw?.price != null ? Number(raw.price) : null,
    wellnessPlanStatusValue:
      raw?.wellnessPlanStatusValue != null ? Number(raw.wellnessPlanStatusValue) : undefined,
    isActive: raw?.isActive !== false,
    pimsId: raw?.pimsId ?? null,
    pimsType: raw?.pimsType ?? null,
    managedByScout: !!raw?.managedByScout,
    overrideAutoRenew: !!raw?.overrideAutoRenew,
    autoRenewPlanId: raw?.autoRenewPlanId != null ? Number(raw.autoRenewPlanId) : null,
    patient: raw?.patient
      ? {
          id: raw.patient.id != null ? Number(raw.patient.id) : undefined,
          name: raw.patient.name ?? null,
          pimsId: raw.patient.pimsId ?? null,
        }
      : null,
    package: raw?.package
      ? {
          id: raw.package.id != null ? Number(raw.package.id) : undefined,
          name: raw.package.name ?? null,
        }
      : null,
    practice: raw?.practice
      ? { id: raw.practice.id != null ? Number(raw.practice.id) : undefined, name: raw.practice.name ?? null }
      : null,
    provider: raw?.provider
      ? {
          id: raw.provider.id != null ? Number(raw.provider.id) : undefined,
          name: raw.provider.name ?? raw.provider.firstName ?? null,
        }
      : null,
  };
}

/** GET /packages?practiceId=&activeOnly=&includeArchived= */
export async function fetchMembershipPackages(params: {
  practiceId: number;
  activeOnly?: boolean;
  includeArchived?: boolean;
}): Promise<MembershipPackage[]> {
  const { data } = await http.get('/packages', {
    params: {
      practiceId: params.practiceId,
      activeOnly: params.activeOnly ?? true,
      includeArchived: params.includeArchived ?? false,
    },
  });
  return asArray(data).map(normalizePackage);
}

/** POST /packages/scout */
export async function createMembershipPackage(
  payload: CreatePackagePayload,
): Promise<MembershipPackage> {
  const { data } = await http.post('/packages/scout', payload);
  return normalizePackage(data);
}

/** PATCH /packages/:id */
export async function updateMembershipPackage(
  id: number,
  payload: UpdatePackagePayload,
): Promise<MembershipPackage> {
  const { data } = await http.patch(`/packages/${encodeURIComponent(String(id))}`, payload);
  return normalizePackage(data);
}

/** GET /wellness-plans?practiceId=&patientId= */
export async function fetchManagedWellnessPlans(params: {
  practiceId?: number;
  patientId?: number;
}): Promise<ManagedWellnessPlan[]> {
  const query: Record<string, string> = {};
  if (params.practiceId != null) query.practiceId = String(params.practiceId);
  if (params.patientId != null) query.patientId = String(params.patientId);
  const { data } = await http.get('/wellness-plans', { params: query });
  return asArray(data).map(normalizeWellnessPlan);
}

/** POST /wellness-plans/scout */
export async function createManagedWellnessPlan(
  payload: CreateWellnessPlanPayload,
): Promise<ManagedWellnessPlan> {
  const { data } = await http.post('/wellness-plans/scout', payload);
  return normalizeWellnessPlan(data);
}

/** PATCH /wellness-plans/:id */
export async function updateManagedWellnessPlan(
  id: number,
  payload: UpdateWellnessPlanPayload,
): Promise<ManagedWellnessPlan> {
  const { data } = await http.patch(
    `/wellness-plans/${encodeURIComponent(String(id))}`,
    payload,
  );
  return normalizeWellnessPlan(data);
}

export function planStatusLabel(plan: ManagedWellnessPlan): string {
  const status = plan.wellnessPlanStatusValue;
  if (status === 0) return 'Cancelled';
  if (status == null) return plan.isActive === false ? 'Inactive' : 'Active';
  if (status !== 0) {
    if (plan.expirationDate) {
      const exp = new Date(plan.expirationDate);
      if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) return 'Expired';
    }
    return 'Active';
  }
  return 'Inactive';
}

export function ownershipLabel(row: { managedByScout?: boolean; pimsType?: string | null }): string {
  if (row.managedByScout) return 'Scout';
  if (String(row.pimsType || '').toUpperCase() === 'VAYD') return 'Scout';
  if (String(row.pimsType || '').toUpperCase() === 'EVET') return 'eVet';
  return row.pimsType || 'Unknown';
}

function packageItemProductName(raw: any): { name: string; kind: MembershipPackageItem['kind'] } {
  if (raw?.procedure?.name) return { name: String(raw.procedure.name), kind: 'procedure' };
  if (raw?.inventoryItem?.name) return { name: String(raw.inventoryItem.name), kind: 'inventory' };
  if (raw?.lab?.name) return { name: String(raw.lab.name), kind: 'lab' };
  return { name: `Item #${raw?.id ?? '?'}`, kind: 'unknown' };
}

function normalizePackageItem(raw: any): MembershipPackageItem {
  const { name, kind } = packageItemProductName(raw);
  return {
    id: Number(raw?.id),
    name,
    kind,
    quantity: raw?.quantity != null ? Number(raw.quantity) : null,
    price: raw?.price != null ? Number(raw.price) : null,
    minimumPrice: raw?.minimumPrice != null ? Number(raw.minimumPrice) : null,
    maximumPrice: raw?.maximumPrice != null ? Number(raw.maximumPrice) : null,
    productionOverride:
      raw?.productionOverride != null ? Number(raw.productionOverride) : null,
    ordinal: raw?.ordinal != null ? Number(raw.ordinal) : null,
    managedByScout: !!raw?.managedByScout,
    pimsType: raw?.pimsType ?? null,
    packageId:
      raw?.package?.id != null
        ? Number(raw.package.id)
        : raw?.packageId != null
          ? Number(raw.packageId)
          : null,
  };
}

/** GET /package-items?packageId= */
export async function fetchMembershipPackageItems(
  packageId: number,
): Promise<MembershipPackageItem[]> {
  const { data } = await http.get('/package-items', {
    params: { packageId },
  });
  return asArray(data).map(normalizePackageItem);
}

/** PATCH /package-items/:id */
export async function updateMembershipPackageItem(
  id: number,
  payload: UpdatePackageItemPayload,
): Promise<MembershipPackageItem> {
  const { data } = await http.patch(
    `/package-items/${encodeURIComponent(String(id))}`,
    payload,
  );
  return normalizePackageItem(data);
}
