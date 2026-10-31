// src/api/salesTax.ts
// Sales & Tax report: GET /analytics/sales-tax (invoice-date basis).
import { http } from './http';
import { currentPracticeId } from '../utils/practiceIdFromToken';

export type SalesTaxBucket = {
  gross: number;
  exempt: number;
  taxable: number;
  tax: number;
  lines: number;
};

export type SalesTaxCategoryRow = SalesTaxBucket & {
  key: string;
  label: string;
  kind: 'product' | 'service' | 'package' | 'other';
};

export type SalesTaxPaymentRow = {
  type: string;
  source: 'evet' | 'scout' | 'square' | 'stripe';
  count: number;
  amount: number;
  excluded: boolean;
};

export type SalesTaxReport = {
  start: string;
  end: string;
  timezone: string;
  taxRate: number;
  taxRateName: string;
  generatedAt: string;
  summary: {
    grossSales: number;
    exemptSales: number;
    taxableSales: number;
    salesTax: number;
    totalWithTax: number;
    invoices: number;
  };
  channels: {
    clinic: SalesTaxBucket & { invoices: number };
    onlineStore: SalesTaxBucket & { invoices: number };
    subscriptions: SalesTaxBucket & {
      square: number;
      stripe: number;
      charges: number;
      included: boolean;
    };
  };
  categories: SalesTaxCategoryRow[];
  memberships: {
    excludedPackageSales: number;
    excludedPackageInvoices: number;
    providerStart: string;
  };
  storeOrders: {
    orders: number;
    subtotal: number;
    discount: number;
    shipping: number;
    tax: number;
    total: number;
    autoshipOrders: number;
    autoshipSubtotal: number;
  };
  useTax: {
    events: number;
    cost: number;
    tax: number;
    byReason: { code: string; label: string; events: number; cost: number }[];
  };
  payments: { rows: SalesTaxPaymentRow[]; received: number; excluded: number };
  tieOut: { salesWithTax: number; received: number; difference: number };
  paymentBasis: { applied: number; taxable: number; exempt: number; tax: number };
  scout: { invoices: number; gross: number; tax: number };
  stripeBreakdown: SalesTaxStripeRow[];
  warnings: string[];
};

export type SalesTaxStripeRow = {
  kind: 'membership' | 'store_autoship' | 'ecwid' | 'hills_to_home' | 'scout' | 'other';
  label: string;
  count: number;
  amount: number;
  refunded: number;
  inSubscriptions: boolean;
};

export async function fetchSalesTaxReport(start: string, end: string): Promise<SalesTaxReport> {
  const { data } = await http.get<SalesTaxReport>('/analytics/sales-tax', {
    params: { start, end, practiceId: currentPracticeId() },
  });
  return data;
}
