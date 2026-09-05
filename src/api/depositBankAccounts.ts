import { http } from './http';

export type DepositBankAccount = {
  id: number;
  practiceId: number;
  name: string;
  accountNumber: string;
  isActive: boolean;
  sortOrder: number;
};

export type DepositBankAccountWrite = {
  name?: string;
  accountNumber?: string;
  isActive?: boolean;
  sortOrder?: number;
};

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export async function listDepositBankAccounts(opts?: {
  practiceId?: number;
  activeOnly?: boolean;
}): Promise<DepositBankAccount[]> {
  const practiceId = opts?.practiceId ?? PRACTICE_ID;
  const { data } = await http.get<DepositBankAccount[]>('/deposit-bank-accounts', {
    params: {
      practiceId,
      ...(opts?.activeOnly ? { activeOnly: '1' } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

export async function createDepositBankAccount(
  input: { name: string; accountNumber: string } & DepositBankAccountWrite,
  practiceId = PRACTICE_ID,
): Promise<DepositBankAccount> {
  const { data } = await http.post<DepositBankAccount>('/deposit-bank-accounts', {
    practiceId,
    ...input,
  });
  return data;
}

export async function patchDepositBankAccount(
  id: number,
  body: DepositBankAccountWrite,
  practiceId = PRACTICE_ID,
): Promise<DepositBankAccount> {
  const { data } = await http.patch<DepositBankAccount>(`/deposit-bank-accounts/${id}`, {
    practiceId,
    ...body,
  });
  return data;
}
