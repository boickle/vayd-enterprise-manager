import { http } from './http';

export type MembershipTransaction = {
  id: number;
  status?: string | null;
  clientId?: number | string | null;
  patientId?: number | string | null;
  practiceId?: number | string | null;
  planName?: string | null;
  pricingOption?: string | null;
  amount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  metadata?: Record<string, any> | null;
  [key: string]: any;
};

function normalizeTransaction(raw: any): MembershipTransaction {
  if (!raw || typeof raw !== 'object') {
    return { id: 0 };
  }

  const id = Number(raw.id ?? raw.transactionId ?? 0);
  const createdAt =
    raw.createdAt ??
    raw.created_at ??
    raw.timestamp ??
    raw.created ??
    null;
  const updatedAt =
    raw.updatedAt ??
    raw.updated_at ??
    raw.modifiedAt ??
    raw.modified_at ??
    null;

  const metadata =
    raw.metadata && typeof raw.metadata === 'object'
      ? (raw.metadata as Record<string, any>)
      : null;

  const primaryPlan =
    Array.isArray(raw.plansSelected) && raw.plansSelected.length > 0
      ? raw.plansSelected[0]
      : null;

  return {
    id,
    status: raw.status ?? metadata?.status ?? null,
    clientId:
      raw.clientId ??
      raw.client_id ??
      raw.client?.id ??
      metadata?.clientId ??
      null,
    patientId:
      raw.patientId ??
      raw.patient_id ??
      raw.patient?.id ??
      metadata?.patientId ??
      null,
    practiceId:
      raw.practiceId ??
      raw.practice_id ??
      raw.practice?.id ??
      metadata?.practiceId ??
      null,
    planName:
      raw.planName ??
      raw.plan?.name ??
      primaryPlan?.planName ??
      metadata?.planName ??
      null,
    pricingOption:
      raw.pricingOption ??
      raw.pricing_option ??
      primaryPlan?.pricingOption ??
      metadata?.pricingOption ??
      metadata?.billingPreference ??
      null,
    amount:
      typeof raw.amount === 'number'
        ? raw.amount
        : typeof raw.amountMoney?.amount === 'number'
        ? raw.amountMoney.amount
        : metadata?.price ?? null,
    createdAt: createdAt ? String(createdAt) : null,
    updatedAt: updatedAt ? String(updatedAt) : null,
    metadata,
    ...raw,
  };
}

export async function listMembershipTransactions(params: {
  clientId?: string | number;
  patientId?: string | number;
  practiceId?: string | number;
  status?: string;
} = {}): Promise<MembershipTransaction[]> {
  const query: Record<string, string> = {};

  if (params.clientId != null) query.clientId = String(params.clientId);
  if (params.patientId != null) query.patientId = String(params.patientId);
  if (params.practiceId != null) query.practiceId = String(params.practiceId);
  if (params.status != null) query.status = String(params.status);

  const { data } = await http.get('/membership-transactions', {
    params: query,
  });

  const rows: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.rows)
    ? data.rows
    : data
    ? [data]
    : [];

  return rows.map(normalizeTransaction);
}

