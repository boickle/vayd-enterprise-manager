// src/api/platformPractices.ts
import { http } from './http';

export type PracticeFeature = 'messaging' | 'payments' | 'evetSync';

export type PlatformPracticeSummary = {
  key: string;
  name: string;
  status: 'provisioning' | 'active' | 'maintenance' | 'suspended' | 'offboarded';
  isDefault: boolean;
  primaryHost: string | null;
  hosts: Array<{ hostname: string; isPrimary: boolean }>;
  features: Record<PracticeFeature, boolean>;
  database: string;
  schemaError: string | null;
  lastBackup?: { status: string; startedAt: string; finishedAt: string | null } | null;
  usageThisMonth?: Record<string, number>;
};

export type PlatformPracticeDetail = PlatformPracticeSummary & {
  schema: { lastMigration: string | null; migratedAt: string | null; error: string | null };
  secrets: Array<{ name: string; valueRef: string }>;
  config: Array<{ name: string; value: string }>;
  /** Settings each switch still needs before it will work. */
  readiness: Record<PracticeFeature, string[]>;
  backups: Array<{
    id: number;
    kind: string;
    status: string;
    sizeBytes: number | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
  usage: Array<{
    day: string;
    provider: string;
    operation: string;
    unit: string;
    calls: number;
    unitsIn: number;
    unitsOut: number;
  }>;
};

export type PracticeUpdate = {
  name?: string;
  status?: 'active' | 'suspended';
  features?: Partial<Record<PracticeFeature, boolean>>;
};

let platformAdminCheck: { token: string; result: Promise<boolean> } | null = null;

/** Whether the signed-in person is a platform admin; asked once per sign-in. */
export function fetchIsPlatformAdmin(token: string): Promise<boolean> {
  if (platformAdminCheck?.token !== token) {
    platformAdminCheck = {
      token,
      result: http
        .get<{ isPlatformAdmin: boolean }>('/platform/me')
        .then(({ data }) => !!data?.isPlatformAdmin)
        .catch(() => false),
    };
  }
  return platformAdminCheck.result;
}

const path = (key: string, rest = '') => `/platform/practices/${encodeURIComponent(key)}${rest}`;

export async function fetchPlatformPractices() {
  const { data } = await http.get<PlatformPracticeSummary[]>('/platform/practices');
  return data;
}

export async function fetchPlatformPractice(key: string) {
  const { data } = await http.get<PlatformPracticeDetail>(path(key));
  return data;
}

export async function updatePlatformPractice(key: string, patch: PracticeUpdate) {
  const { data } = await http.patch<PlatformPracticeDetail>(path(key), patch);
  return data;
}

export async function setPlatformPracticeDomains(key: string, hosts: string[], primary: string) {
  const { data } = await http.put<PlatformPracticeDetail>(path(key, '/domains'), {
    hosts,
    primary,
  });
  return data;
}

export async function setPlatformPracticeSecret(key: string, name: string, valueRef: string) {
  const { data } = await http.put<PlatformPracticeDetail>(
    path(key, `/secrets/${encodeURIComponent(name)}`),
    { valueRef }
  );
  return data;
}

export async function deletePlatformPracticeSecret(key: string, name: string) {
  const { data } = await http.delete<PlatformPracticeDetail>(
    path(key, `/secrets/${encodeURIComponent(name)}`)
  );
  return data;
}

export async function setPlatformPracticeConfig(key: string, name: string, value: string) {
  const { data } = await http.put<PlatformPracticeDetail>(
    path(key, `/config/${encodeURIComponent(name)}`),
    { value }
  );
  return data;
}

export async function deletePlatformPracticeConfig(key: string, name: string) {
  const { data } = await http.delete<PlatformPracticeDetail>(
    path(key, `/config/${encodeURIComponent(name)}`)
  );
  return data;
}
