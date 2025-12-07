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
