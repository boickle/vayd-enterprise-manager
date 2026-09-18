export const MAIL_SHIPPING_TYPES_KEY = 'inventory.mailShippingTypes' as const;

export type MailShippingKind = 'pickup' | 'shipping';
export type MailShippingCharge = 'none' | 'courtesy' | 'amount';

export type MailShippingType = {
  id: string;
  label: string;
  kind: MailShippingKind;
  charge: MailShippingCharge;
  amount?: number | null;
  catalogItemId?: number | null;
  catalogItemType?: 'procedure' | 'inventory' | null;
  /** Business days to fill / pack before the carrier has it. */
  estimatedDaysToFill?: number | null;
  /** Available for auto-ship as well as one-time orders. */
  autoshipAllowed?: boolean;
  /** Hide except when every cart line is Auto-ship. */
  autoshipOnly?: boolean;
  /** @deprecated Use autoshipOnly. Kept so older saved JSON still reads. */
  autoship?: boolean;
  /** When false, hide from the online store cart. Still available in the mail queue. */
  showOnOnlineStore?: boolean;
  pickupBranchId?: number | null;
  pickupPlaceName?: string | null;
  pickupLine1?: string | null;
  pickupLine2?: string | null;
  pickupCity?: string | null;
  pickupState?: string | null;
  pickupPostal?: string | null;
  /** Thanks-for-your-order email: how to pick up, or what to expect for shipping. */
  clientInstructions?: string | null;
};

export type MailPickupLocation = {
  name: string;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal?: string | null;
};

export function formatMailPickupLocation(
  loc: MailPickupLocation | null | undefined
): string[] {
  if (!loc) return [];
  const cityLine = [loc.city, loc.state, loc.postal].filter(Boolean).join(', ');
  return [loc.name, loc.line1, loc.line2, cityLine]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
}

export const DEFAULT_MAIL_SHIPPING_TYPES: MailShippingType[] = [
  {
    id: 'pickup-brunswick',
    label: 'Pick up at Brunswick Office',
    kind: 'pickup',
    charge: 'none',
    showOnOnlineStore: true,
    clientInstructions:
      'Pick up at the Brunswick office. We will email or text when the bag is ready. Come during open hours, tell the front desk you are picking up a mail-order prescription, and bring a photo ID.',
  },
  {
    id: 'pickup-biddeford',
    label: 'Pick up at Biddeford Office',
    kind: 'pickup',
    charge: 'none',
    showOnOnlineStore: true,
    clientInstructions:
      'Pick up at the Biddeford office. We will email or text when the bag is ready. Come during open hours, tell the front desk you are picking up a mail-order prescription, and bring a photo ID.',
  },
  {
    id: 'ship-courtesy',
    label: 'Shipping — Courtesy (at appointment)',
    kind: 'shipping',
    charge: 'courtesy',
    showOnOnlineStore: false,
  },
  {
    id: 'ship-499',
    label: 'Shipping — $4.99',
    kind: 'shipping',
    charge: 'amount',
    amount: 4.99,
    estimatedDaysToFill: 2,
    showOnOnlineStore: true,
    clientInstructions:
      'We will pack this at the office and ship it once any prescriptions are approved. You will get tracking when it goes out.',
  },
  {
    id: 'ship-autoship',
    label: 'FREE SHIPPING for Auto-Ship',
    kind: 'shipping',
    charge: 'none',
    amount: 0,
    estimatedDaysToFill: 2,
    autoshipAllowed: true,
    autoshipOnly: true,
    autoship: true,
    showOnOnlineStore: true,
  },
];

export function mailTypeAutoshipOnly(row: {
  kind?: string;
  autoship?: boolean;
  autoshipOnly?: boolean;
  autoshipAllowed?: boolean;
}): boolean {
  if (row.autoshipOnly === true) return true;
  if (row.autoshipOnly === false) return false;
  return row.autoship === true && row.kind !== 'pickup';
}

export function mailTypeAutoshipAllowed(row: {
  kind?: string;
  autoship?: boolean;
  autoshipOnly?: boolean;
  autoshipAllowed?: boolean;
}): boolean {
  if (mailTypeAutoshipOnly(row)) return true;
  if (row.autoshipAllowed === true) return true;
  return row.autoship === true && row.kind === 'pickup';
}

export function mailTypeShowOnOnlineStore(row: {
  showOnOnlineStore?: boolean;
  charge?: string;
  label?: string;
}): boolean {
  if (row.showOnOnlineStore === true) return true;
  if (row.showOnOnlineStore === false) return false;
  const hay = String(row.label || '').toLowerCase();
  if (row.charge === 'courtesy' || /courtesy|at appointment/.test(hay)) return false;
  return true;
}

function defaultMailClientInstructions(row: {
  id?: string;
  label?: string;
  kind?: string;
}): string | null {
  const hay = `${row.id || ''} ${row.label || ''}`.toLowerCase();
  if (row.kind === 'pickup' && /brunswick/.test(hay)) {
    return 'Pick up at the Brunswick office. We will email or text when the bag is ready. Come during open hours, tell the front desk you are picking up a mail-order prescription, and bring a photo ID.';
  }
  if (row.kind === 'pickup' && /biddeford/.test(hay)) {
    return 'Pick up at the Biddeford office. We will email or text when the bag is ready. Come during open hours, tell the front desk you are picking up a mail-order prescription, and bring a photo ID.';
  }
  if (row.kind === 'pickup') {
    return `Pick up at ${row.label || 'the office'}. We will email or text when the bag is ready. Come during open hours and bring a photo ID.`;
  }
  return 'We will pack this at the office and ship it once any prescriptions are approved. You will get tracking when it goes out.';
}

function newId(): string {
  return `mail-ship-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function parseMailShippingTypes(raw: unknown): MailShippingType[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return DEFAULT_MAIL_SHIPPING_TYPES;
    }
  }
  if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_MAIL_SHIPPING_TYPES;
  const rows = parsed
    .map((row): MailShippingType | null => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const label = String(r.label || '').trim();
      if (!label) return null;
      const kind: MailShippingKind = r.kind === 'pickup' ? 'pickup' : 'shipping';
      const charge: MailShippingCharge =
        r.charge === 'courtesy' || r.charge === 'amount' || r.charge === 'none'
          ? r.charge
          : kind === 'pickup'
            ? 'none'
            : 'amount';
      const amount = Number(r.amount);
      const flags = {
        kind,
        autoship: r.autoship === true,
        autoshipOnly: typeof r.autoshipOnly === 'boolean' ? r.autoshipOnly : undefined,
        autoshipAllowed: typeof r.autoshipAllowed === 'boolean' ? r.autoshipAllowed : undefined,
      };
      const autoshipOnly = mailTypeAutoshipOnly(flags);
      return {
        id: String(r.id || newId()),
        label,
        kind,
        charge,
        amount: charge === 'amount' && Number.isFinite(amount) ? amount : null,
        catalogItemId:
          r.catalogItemId != null && Number.isFinite(Number(r.catalogItemId))
            ? Number(r.catalogItemId)
            : null,
        catalogItemType:
          r.catalogItemType === 'inventory'
            ? 'inventory'
            : r.catalogItemType === 'procedure'
              ? 'procedure'
              : null,
        estimatedDaysToFill:
          r.estimatedDaysToFill != null && Number.isFinite(Number(r.estimatedDaysToFill))
            ? Math.max(0, Math.round(Number(r.estimatedDaysToFill)))
            : null,
        autoshipAllowed: mailTypeAutoshipAllowed(flags),
        autoshipOnly,
        autoship: autoshipOnly,
        showOnOnlineStore: mailTypeShowOnOnlineStore({
          showOnOnlineStore:
            typeof r.showOnOnlineStore === 'boolean' ? r.showOnOnlineStore : undefined,
          charge,
          label,
        }),
        pickupBranchId:
          r.pickupBranchId != null && Number.isFinite(Number(r.pickupBranchId))
            ? Number(r.pickupBranchId)
            : null,
        pickupPlaceName: String(r.pickupPlaceName || '').trim() || null,
        pickupLine1: String(r.pickupLine1 || '').trim() || null,
        pickupLine2: String(r.pickupLine2 || '').trim() || null,
        pickupCity: String(r.pickupCity || '').trim() || null,
        pickupState: String(r.pickupState || '').trim() || null,
        pickupPostal: String(r.pickupPostal || '').trim() || null,
        clientInstructions:
          String(r.clientInstructions || '').trim() ||
          defaultMailClientInstructions({
            id: String(r.id || ''),
            label,
            kind,
          }),
      };
    })
    .filter((row): row is MailShippingType => row != null);
  return rows.length ? rows : DEFAULT_MAIL_SHIPPING_TYPES;
}

export function serializeMailShippingTypes(types: MailShippingType[]): string {
  return JSON.stringify(types);
}

export function blankMailShippingType(): MailShippingType {
  return {
    id: newId(),
    label: '',
    kind: 'shipping',
    charge: 'amount',
    amount: 4.99,
    estimatedDaysToFill: 2,
    showOnOnlineStore: false,
  };
}

export function catalogItemIdsFromMailTypes(types: MailShippingType[]): number[] {
  return [
    ...new Set(
      types
        .map((type) => type.catalogItemId)
        .filter((id): id is number => id != null && Number.isFinite(id) && id > 0),
    ),
  ];
}

export function mailOriginForType(type: MailShippingType): 'office_pickup' | 'staff_mail' {
  return type.kind === 'pickup' ? 'office_pickup' : 'staff_mail';
}

export function mailShippingPaymentForType(
  type: MailShippingType,
  shippingPaid?: boolean
): 'paid' | 'awaiting_payment' {
  if (type.kind === 'pickup' || type.charge === 'courtesy' || type.charge === 'none') {
    return 'paid';
  }
  return shippingPaid ? 'paid' : 'awaiting_payment';
}

export function mailShippingAmountForType(type: MailShippingType): number {
  if (type.charge !== 'amount') return Number(type.amount) || 0;
  return Number(type.amount) || 0;
}

export function isInvoiceShippingLine(line: {
  catalogItemId?: number | null;
  catalogItemType?: string | null;
  description?: string | null;
}, shippingTypeIds?: Iterable<number>): boolean {
  const type = String(line.catalogItemType ?? '').toLowerCase();
  if (type === 'procedure' && line.catalogItemId != null && shippingTypeIds) {
    const ids = shippingTypeIds instanceof Set ? shippingTypeIds : new Set(shippingTypeIds);
    if (ids.has(Number(line.catalogItemId))) return true;
  }
  return /shipping|pick[\s-]?up|mailed meds|free shipping/i.test(line.description ?? '');
}

export function attachShippingLines<T extends { id: string; patientId?: number | null }>(
  lines: T[],
  isShipping: (line: T) => boolean,
  canReceiveShipping?: (line: T) => boolean
): { parents: T[]; attached: Map<string, T[]>; leftover: T[] } {
  const claimed = new Set<string>();
  const parents = lines.filter((line) => !isShipping(line));
  const attached = new Map<string, T[]>(parents.map((parent) => [parent.id, []]));
  let current: T | null = null;
  for (const line of lines) {
    if (!isShipping(line)) {
      if (!canReceiveShipping || canReceiveShipping(line)) current = line;
      continue;
    }
    if (!current) continue;
    attached.get(current.id)?.push(line);
    claimed.add(line.id);
  }
  return {
    parents,
    attached,
    leftover: lines.filter((line) => isShipping(line) && !claimed.has(line.id)),
  };
}

export function catalogProcedureToMailShippingType(row: {
  id: number;
  name: string;
  code?: string | null;
  price?: number | string | null;
}): MailShippingType {
  const label = String(row.name || '').trim() || `Procedure #${row.id}`;
  const hay = `${label} ${row.code || ''}`.toLowerCase();
  const amount = Number(row.price) || 0;
  const kind: MailShippingKind = /pick\s*up|pickup/.test(hay) ? 'pickup' : 'shipping';
  const charge: MailShippingCharge =
    amount > 0
      ? 'amount'
      : /courtesy|free|no ship|mailed meds/.test(hay)
        ? 'courtesy'
        : kind === 'pickup'
          ? 'none'
          : 'none';
  return {
    id: `procedure-${row.id}`,
    label,
    kind,
    charge,
    amount,
    catalogItemId: row.id,
    catalogItemType: 'procedure',
    showOnOnlineStore: charge !== 'courtesy',
  };
}
