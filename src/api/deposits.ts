import { http } from './http';

export type UndepositedTender = {
  tenderId: string;
  amount: number;
  receivedAt: string;
  paymentTypeName: string | null;
  method: string;
  checkNumber: string | null;
  cashierEmployeeId: number | null;
  invoiceId: string;
  clientId: number | null;
  clientLabel: string | null;
  scoutInvoiceNumber: number | null;
  providerEmployeeId: number | null;
  providerLabel: string | null;
};

export type DepositLine = {
  id: string;
  tenderId: string;
  amount: number;
  paymentTypeName: string | null;
  method: string;
  checkNumber: string | null;
  receivedAt: string | null;
  clientLabel: string | null;
};

export type PracticeDeposit = {
  id: string;
  practiceId: number;
  status: string;
  bankAccountId: number;
  bankName: string;
  bankAccountNumber: string;
  total: number;
  lineCount: number;
  createdByEmployeeId: number | null;
  createdByLabel: string | null;
  postedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  note: string | null;
  created: string;
  lines: DepositLine[];
};

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export async function listUndepositedTenders(opts?: {
  practiceId?: number;
  from?: string;
  to?: string;
  providerEmployeeId?: number | null;
}): Promise<UndepositedTender[]> {
  const { data } = await http.get<UndepositedTender[]>('/deposits/undeposited', {
    params: {
      practiceId: opts?.practiceId ?? PRACTICE_ID,
      ...(opts?.from ? { from: opts.from } : {}),
      ...(opts?.to ? { to: opts.to } : {}),
      ...(opts?.providerEmployeeId != null && opts.providerEmployeeId > 0
        ? { providerEmployeeId: opts.providerEmployeeId }
        : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

export async function listDeposits(opts?: {
  practiceId?: number;
  limit?: number;
}): Promise<PracticeDeposit[]> {
  const { data } = await http.get<PracticeDeposit[]>('/deposits', {
    params: {
      practiceId: opts?.practiceId ?? PRACTICE_ID,
      ...(opts?.limit != null ? { limit: opts.limit } : {}),
    },
  });
  return Array.isArray(data) ? data : [];
}

export async function createDeposit(input: {
  bankAccountId: number;
  tenderIds: string[];
  note?: string | null;
  depositedOn: string;
  practiceId?: number;
}): Promise<PracticeDeposit> {
  const { data } = await http.post<PracticeDeposit>('/deposits', {
    practiceId: input.practiceId ?? PRACTICE_ID,
    bankAccountId: input.bankAccountId,
    tenderIds: input.tenderIds,
    note: input.note ?? null,
    depositedOn: input.depositedOn,
  });
  return data;
}

export async function voidDeposit(
  id: string,
  opts?: { reason?: string | null; practiceId?: number },
): Promise<PracticeDeposit> {
  const { data } = await http.post<PracticeDeposit>(`/deposits/${id}/void`, {
    practiceId: opts?.practiceId ?? PRACTICE_ID,
    reason: opts?.reason ?? null,
  });
  return data;
}
