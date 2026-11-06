import { http } from './http';
import type { ImpersonationTarget } from '../auth/impersonationSession';

export type StartImpersonationInput = {
  userId?: number;
  employeeId?: number;
  clientId?: number;
  reason: string;
};

export type ImpersonationStarted = {
  accessToken: string;
  expiresAt: string;
  target: ImpersonationTarget & { employeeId: number | null };
};

export async function startImpersonation(
  input: StartImpersonationInput
): Promise<ImpersonationStarted> {
  const { data } = await http.post('/auth/impersonation/start', input);
  return data;
}

export async function stopImpersonation(): Promise<void> {
  await http.post('/auth/impersonation/stop', {});
}
