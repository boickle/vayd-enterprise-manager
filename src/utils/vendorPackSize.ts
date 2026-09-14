/** Infer stock units in one vendor pack from text like "25X1DS" or "10DS". */
export function inferVendorPackSize(
  description: string | null | undefined
): number | null {
  const s = String(description ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  const x1 = s.match(/\b(\d{1,4})\s*[xX×]\s*1(?:\s*(?:ds|doses?))?\b/i);
  if (x1) {
    const n = Number(x1[1]);
    if (Number.isFinite(n) && n > 1) return n;
  }
  const ds = s.match(/\b(\d{1,4})\s*(?:ds|doses)\b/i);
  if (ds) {
    const n = Number(ds[1]);
    if (Number.isFinite(n) && n > 1) return n;
  }
  return null;
}

export function suggestedReceiveQuantity(args: {
  invoiceQty: number | null | undefined;
  description: string | null | undefined;
  rememberedPerVendorQty?: number | null;
  unitsPerPackage?: number | null;
}): { receiveQuantity: number; receiveUnitsPerVendorQty: number } {
  const invoiceQty =
    args.invoiceQty != null && Number(args.invoiceQty) > 0 ? Number(args.invoiceQty) : 1;
  const remembered =
    args.rememberedPerVendorQty != null && Number(args.rememberedPerVendorQty) > 0
      ? Number(args.rememberedPerVendorQty)
      : null;
  const pkg =
    args.unitsPerPackage != null && Number(args.unitsPerPackage) > 1
      ? Number(args.unitsPerPackage)
      : null;
  const per = remembered ?? inferVendorPackSize(args.description) ?? pkg ?? 1;
  return {
    receiveQuantity: invoiceQty * per,
    receiveUnitsPerVendorQty: per,
  };
}

const SELL_UNIT_LABELS: Record<string, string> = {
  capsule: 'capsules',
  tablet: 'tablets',
  bottle: 'bottles',
  package: 'packages',
  ml: 'mL',
  gram: 'grams',
  each: 'each',
};

export function sellUnitLabel(
  sellUnitType?: string | null,
  sellUnitTypeDetail?: string | null
): string {
  const type = (sellUnitType ?? '').trim();
  if (type === 'other') {
    const detail = (sellUnitTypeDetail ?? '').trim();
    return detail || 'units';
  }
  if (type && SELL_UNIT_LABELS[type]) return SELL_UNIT_LABELS[type];
  if (type) return type;
  return 'units';
}
