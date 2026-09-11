import { http } from './http';

export const PAYMENT_OPTION_TYPES = [
  'cash',
  'check',
  'credit_card',
  'credit_card_auto',
  'other',
] as const;

export type PaymentOptionType = (typeof PAYMENT_OPTION_TYPES)[number];

export const PAYMENT_OPTION_TYPE_LABELS: Record<PaymentOptionType, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  credit_card_auto: 'Credit Card (Auto Fill)',
  other: 'Other',
};

export type PracticePaymentType = {
  id: number;
  practiceId: number;
  name: string;
  optionType: PaymentOptionType;
  isDefault: boolean;
  isDiscountCategory: boolean;
  discountPercent: number;
  excludeFromIncome: boolean;
  getsDeposited: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type PaymentTypeWrite = {
  name?: string;
  optionType?: PaymentOptionType;
  isDefault?: boolean;
  isDiscountCategory?: boolean;
  discountPercent?: number;
  excludeFromIncome?: boolean;
  getsDeposited?: boolean;
  isActive?: boolean;
};

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function normalizeRow(row: PracticePaymentType): PracticePaymentType {
  const optionType = (PAYMENT_OPTION_TYPES as readonly string[]).includes(row.optionType)
    ? row.optionType
    : 'other';
  return {
    ...row,
    optionType,
    isDefault: row.isDefault === true,
    isDiscountCategory: row.isDiscountCategory === true,
    discountPercent: Number(row.discountPercent) || 0,
    excludeFromIncome: row.excludeFromIncome === true,
    getsDeposited: row.getsDeposited === true,
    isActive: row.isActive !== false,
  };
}

export async function listPaymentTypes(
  practiceId = PRACTICE_ID,
): Promise<PracticePaymentType[]> {
  const { data } = await http.get<PracticePaymentType[]>('/payment-types', {
    params: { practiceId },
  });
  return (Array.isArray(data) ? data : []).map(normalizeRow);
}

export async function patchPaymentType(
  id: number,
  body: PaymentTypeWrite,
  practiceId = PRACTICE_ID,
): Promise<PracticePaymentType> {
  const { data } = await http.patch<PracticePaymentType>(`/payment-types/${id}`, {
    practiceId,
    ...body,
  });
  return normalizeRow(data);
}

export async function createPaymentType(
  input: { name: string } & PaymentTypeWrite,
  practiceId = PRACTICE_ID,
): Promise<PracticePaymentType> {
  const { data } = await http.post<PracticePaymentType>('/payment-types', {
    practiceId,
    ...input,
  });
  return normalizeRow(data);
}
