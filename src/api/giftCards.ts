import { http } from './http';
import { storeApiError } from './onlineStore';

export type GiftCardStatus = 'scheduled' | 'active' | 'depleted' | 'void';

export type GiftCardBalance = {
  last4: string;
  balance: number;
  faceValue: number;
  status: GiftCardStatus;
  spendable: boolean;
};

export type GiftCardPrintView = {
  brand: string;
  code: string;
  faceValue: number;
  balance: number;
  status: GiftCardStatus;
  recipientName: string | null;
  fromName: string | null;
  message: string | null;
  terms: string | null;
};

export type StaffGiftCard = {
  id: string;
  practiceId: number;
  code: string;
  status: GiftCardStatus;
  faceValue: number;
  amountPaid: number;
  balance: number;
  source: 'online_purchase' | 'staff_issued';
  issueReason: string | null;
  issuedByEmployeeId: number | null;
  purchaserClientId: number | null;
  purchaserName: string | null;
  purchaserEmail: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  fromName: string | null;
  message: string | null;
  deliverAt: string | null;
  deliveredAt: string | null;
  stripePaymentIntentId: string | null;
  mailOrderId: number | null;
  voidedAt: string | null;
  voidReason: string | null;
  created: string;
  printUrl: string;
};

export type GiftCardTransactionType =
  | 'issue'
  | 'redeem'
  | 'redeem_reversal'
  | 'void'
  | 'refund'
  | 'adjust';

export type GiftCardTransaction = {
  id: string;
  type: GiftCardTransactionType;
  channel: string;
  faceAmount: number;
  paidValueAmount: number;
  balanceAfter: number;
  visitInvoiceId: string | null;
  mailOrderId: number | null;
  clientId: number | null;
  employeeId: number | null;
  note: string | null;
  created: string;
};

export const GIFT_CARD_STATUS_LABELS: Record<GiftCardStatus, string> = {
  scheduled: 'Scheduled',
  active: 'Active',
  depleted: 'Used up',
  void: 'Void',
};

export const GIFT_CARD_TXN_LABELS: Record<GiftCardTransactionType, string> = {
  issue: 'Issued',
  redeem: 'Redeemed',
  redeem_reversal: 'Redemption reversed',
  void: 'Voided',
  refund: 'Refunded',
  adjust: 'Adjusted',
};

export const GIFT_CARD_CHANNEL_LABELS: Record<string, string> = {
  store: 'Online store',
  visit: 'Visit checkout',
  staff_ledger: 'Client ledger',
  portal: 'Client portal',
  staff: 'Staff',
};

async function call<T>(run: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await run()).data;
  } catch (err) {
    throw new Error(storeApiError(err));
  }
}

/** Format what someone typed into XXXX-XXXX-XXXX-XXXX as they type. */
export function formatGiftCardInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16)
    .replace(/(.{4})(?=.)/g, '$1-');
}

export function giftCardCodeComplete(value: string): boolean {
  return value.replace(/[^A-Za-z0-9]/g, '').length === 16;
}

/* ---------- public (store, portal, recipients) ---------- */

export function checkGiftCardBalance(practiceId: number, code: string) {
  return call(() =>
    http.post<GiftCardBalance>(`/public/store/gift-cards/check`, { practiceId, code })
  );
}

export function getGiftCardPrintView(token: string) {
  return call(() =>
    http.get<GiftCardPrintView>(`/public/store/gift-cards/print/${encodeURIComponent(token)}`)
  );
}

/* ---------- staff ---------- */

export function listGiftCards(practiceId: number, params: { q?: string; status?: string } = {}) {
  return call(() => http.get<StaffGiftCard[]>(`/practice/${practiceId}/gift-cards`, { params }));
}

export function getGiftCard(practiceId: number, id: string) {
  return call(() =>
    http.get<{ card: StaffGiftCard; transactions: GiftCardTransaction[] }>(
      `/practice/${practiceId}/gift-cards/${id}`
    )
  );
}

export function staffCheckGiftCard(practiceId: number, code: string) {
  return call(() =>
    http.post<GiftCardBalance & { id: string }>(`/practice/${practiceId}/gift-cards/check`, {
      code,
    })
  );
}

/** Take a gift card as payment on an invoice; returns the updated invoice. */
export function staffRedeemGiftCard<TInvoice = unknown>(
  practiceId: number,
  body: {
    invoiceId: string;
    code: string;
    amount: number;
    channel: 'visit' | 'staff_ledger';
    cashierEmployeeId?: number | null;
  }
) {
  return call(() => http.post<TInvoice>(`/practice/${practiceId}/gift-cards/redeem`, body));
}

export type StaffIssueGiftCardInput = {
  faceValue: number;
  reason: string;
  amountPaid?: number | null;
  purchaserClientId?: number | null;
  purchaserName?: string | null;
  purchaserEmail?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  fromName?: string | null;
  message?: string | null;
  deliverAt?: string | null;
};

export function issueGiftCard(practiceId: number, body: StaffIssueGiftCardInput) {
  return call(() => http.post<StaffGiftCard>(`/practice/${practiceId}/gift-cards`, body));
}

export function voidGiftCard(practiceId: number, id: string, reason: string) {
  return call(() =>
    http.post<StaffGiftCard>(`/practice/${practiceId}/gift-cards/${id}/void`, { reason })
  );
}

export function refundGiftCard(practiceId: number, id: string, reason: string) {
  return call(() =>
    http.post<StaffGiftCard>(`/practice/${practiceId}/gift-cards/${id}/refund`, { reason })
  );
}

export function adjustGiftCard(practiceId: number, id: string, amount: number, reason: string) {
  return call(() =>
    http.post<StaffGiftCard>(`/practice/${practiceId}/gift-cards/${id}/adjust`, {
      amount,
      reason,
    })
  );
}

export function resendGiftCard(practiceId: number, id: string, email?: string | null) {
  return call(() =>
    http.post<unknown>(`/practice/${practiceId}/gift-cards/${id}/resend`, { email: email || null })
  );
}

/* ---------- report ---------- */

type Money = { face: number; paid: number };

export type GiftCardReportSummary = {
  opening: Money;
  sold: Money & { count: number; discount: number };
  staffIssued: Money & {
    count: number;
    byReason: Array<Money & { reason: string; count: number }>;
  };
  redeemed: Money & { byChannel: Array<Money & { channel: string }> };
  voided: Money & { count: number };
  refunded: Money & { count: number };
  adjusted: Money;
  closing: Money;
  difference: Money;
};

export type GiftCardReportRow = {
  id: string;
  created: string;
  type: GiftCardTransactionType;
  channel: string;
  faceAmount: number;
  paidValueAmount: number;
  balanceAfter: number;
  giftCardId: string;
  codeLast4: string;
  source: 'online_purchase' | 'staff_issued';
  issueReason: string | null;
  purchaserName: string | null;
  purchaserEmail: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  clientName: string | null;
  employeeName: string | null;
  invoiceNumber: number | null;
  visitInvoiceId: string | null;
  mailOrderId: number | null;
  note: string | null;
};

export type GiftCardReport = {
  startDate: string;
  endDate: string;
  summary: GiftCardReportSummary;
  rows: GiftCardReportRow[];
};

export function fetchGiftCardReport(practiceId: number, startDate: string, endDate: string) {
  return call(() =>
    http.get<GiftCardReport>(`/analytics/gift-cards`, {
      params: { practiceId, startDate, endDate },
    })
  );
}

export async function downloadGiftCardReportCsv(
  practiceId: number,
  startDate: string,
  endDate: string
) {
  const blob = await call(() =>
    http.get<Blob>(`/analytics/gift-cards/csv`, {
      params: { practiceId, startDate, endDate },
      responseType: 'blob',
    })
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gift-cards-${startDate}-to-${endDate}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
