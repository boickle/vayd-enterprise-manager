import { http } from './http';

export type Provider = {
  id: string | number;
  name: string;
  email: string;
  pimsId?: string | number; // PIMS ID for API calls
  dailyRevenueGoal?: number | null;
  bonusRevenueGoal?: number | null;
  dailyPointGoal?: number | null;
  weeklyPointGoal?: number | null;
};

function buildProviderName(r: any): string {
  const parts: string[] = [];
  if (r.firstName) parts.push(r.firstName);
  if (r.middleInitial || r.middleName) {
    const middle = r.middleInitial || (r.middleName ? r.middleName.charAt(0).toUpperCase() : '');
    if (middle) parts.push(middle);
  }
  if (r.lastName) parts.push(r.lastName);
  
  if (parts.length > 0) {
    return parts.join(' ').trim();
  }
  
  return r.name || `Provider ${r.id ?? ''}`;
}

export async function fetchPrimaryProviders(): Promise<Provider[]> {
  const { data } = await http.get('/employees/providers');
  const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);

  return rows.map((r) => ({
    id: r.id ?? r.pimsId ?? r.employeeId,
    pimsId: r.pimsId ?? r.employee?.pimsId ?? r.id ?? r.employeeId, // Preserve pimsId for API calls
    email: r?.email,
    name: buildProviderName(r),
    dailyRevenueGoal: r?.dailyRevenueGoal ?? null,
    bonusRevenueGoal: r?.bonusRevenueGoal ?? null,
    dailyPointGoal: r?.dailyPointGoal ?? null,
    weeklyPointGoal: r?.weeklyPointGoal ?? null,
  }));
}

/**
 * Fetch veterinarians from /employees/veterinarians endpoint
 * This endpoint returns only veterinarians (D.V.M/V.M.D)
 * @param address Optional address to filter veterinarians by service area
 */
export async function fetchVeterinarians(address?: string): Promise<Provider[]> {
  const params: any = {};
  if (address) {
    params.address = address;
  }
  
  const { data } = await http.get('/employees/veterinarians', { params });
  const veterinarians: any[] = Array.isArray(data) ? data : [];

  return veterinarians
    .filter((v) => v.isActive !== false) // Only include active veterinarians
    .map((v) => {
      const pimsId = v.pimsId ? String(v.pimsId) : null;
      const id = v.id ?? v.pimsId;
      
      return {
        id: id,
        pimsId: pimsId || String(id), // Use pimsId if available, otherwise use id
        email: v?.email || '',
        name: buildProviderName(v),
        dailyRevenueGoal: v?.dailyRevenueGoal ?? null,
        bonusRevenueGoal: v?.bonusRevenueGoal ?? null,
        dailyPointGoal: v?.dailyPointGoal ?? null,
        weeklyPointGoal: v?.weeklyPointGoal ?? null,
      };
    });
}
