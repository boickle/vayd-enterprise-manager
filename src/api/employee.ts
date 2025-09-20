import { http } from './http';

export type Provider = {
  id: string | number;
  name: string;
  email: string;
  dailyRevenueGoal?: number | null;
  bonusRevenueGoal?: number | null;
  dailyPointGoal?: number | null;
  weeklyPointGoal?: number | null;
};

export async function fetchPrimaryProviders(): Promise<Provider[]> {
  const { data } = await http.get('/employees/providers');
  const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);

  return rows.map((r) => ({
    id: r.id ?? r.pimsId ?? r.employeeId,
    email: r?.email,
    name:
      [r.firstName, r.lastName].filter(Boolean).join(' ').trim() ||
      r.name ||
      `Provider ${r.id ?? ''}`,
    dailyRevenueGoal: r?.dailyRevenueGoal ?? null,
    bonusRevenueGoal: r?.bonusRevenueGoal ?? null,
    dailyPointGoal: r?.dailyPointGoal ?? null,
    weeklyPointGoal: r?.weeklyPointGoal ?? null,
  }));
}
