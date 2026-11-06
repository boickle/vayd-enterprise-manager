import type { StoreTagalongPreview } from '../api/onlineStore';

export type StoreCartTagalong = {
  ruleId: number;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  taxMode: 'after_tax' | 'before_tax';
  taxLevelValue: number | null;
};

function matchesQty(rule: StoreTagalongPreview, qty: number): boolean {
  const q = Number(qty) || 0;
  const min = Number(rule.minQty) || 0;
  const max = rule.maxQty == null ? null : Number(rule.maxQty);
  if (q + 1e-9 < min) return false;
  if (max != null && q - 1e-9 > max) return false;
  return true;
}

export function expandStoreTagalongs(
  line: { quantity: number },
  rules: StoreTagalongPreview[] | null | undefined
): StoreCartTagalong[] {
  const triggerQty = Number(line.quantity) || 0;
  return (rules ?? [])
    .filter((rule) => matchesQty(rule, triggerQty))
    .map((rule) => {
      const each = Number(rule.addQty) || 1;
      const qty = rule.addQtyMode === 'match_trigger' ? each * triggerQty : each;
      const unitPrice = Number(rule.unitPrice) || 0;
      return {
        ruleId: rule.ruleId,
        name: rule.name,
        qty,
        unitPrice,
        amount: unitPrice * qty,
        taxMode: rule.taxMode,
        taxLevelValue: rule.taxLevelValue,
      };
    })
    .filter((row) => row.qty > 0);
}

function qtyLabel(minQty: number, maxQty: number | null): string {
  if (maxQty == null) return `${minQty}+`;
  if (maxQty === minQty) return String(minQty);
  return `${minQty}–${maxQty}`;
}

/** “Buy 2–3, get $20 off. Buy 4+, get $45 instant rebate!” */
export function storeRebatePromoCopy(
  rules: StoreTagalongPreview[] | null | undefined
): string | null {
  const rebates = (rules ?? [])
    .filter((rule) => Number(rule.unitPrice) < 0)
    .slice()
    .sort((a, b) => Number(a.minQty) - Number(b.minQty));
  if (!rebates.length) return null;
  const parts = rebates.map((rule, index) => {
    const off = Math.abs(Number(rule.unitPrice) || 0).toFixed(0);
    const qty = qtyLabel(Number(rule.minQty) || 1, rule.maxQty);
    const last = index === rebates.length - 1;
    return last && rebates.length > 1
      ? `buy ${qty}, get $${off} instant rebate`
      : `Buy ${qty}, get $${off}`;
  });
  if (parts.length === 1) return `${parts[0]} instant rebate!`;
  return `${parts.join(', ')}!`;
}

export function storeRebateSavings(extras: StoreCartTagalong[]): number {
  return extras.reduce((sum, row) => sum + Math.max(0, -row.amount), 0);
}
