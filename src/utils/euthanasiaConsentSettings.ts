export const EUTHANASIA_PAW_PRINT_ITEMS_KEY = 'euthanasia.pawPrintItems' as const;
export const EUTHANASIA_PROVIDER_PAW_PRINTS_KEY =
  'euthanasia.providerPawPrintOfferings' as const;
export const EUTHANASIA_ASH_RETURN_LABELS_KEY = 'euthanasia.ashReturnLabels' as const;

export type AshReturnChoice = 'mail' | 'hand_deliver_in_person' | 'hand_deliver_leave';

export type AshReturnLabelKey =
  | 'mail'
  | 'hand_deliver'
  | 'hand_deliver_followup'
  | 'hand_deliver_in_person'
  | 'hand_deliver_leave';

export type AshReturnLabels = Record<AshReturnLabelKey, string>;

export const DEFAULT_ASH_RETURN_LABELS: AshReturnLabels = {
  mail:
    'Mail the ashes to me with tracking as soon as they are available. Minimal though they may be, I accept any risks of mail delivery. (Usually 1–2 weeks)',
  hand_deliver: 'Hand deliver them (4-6 weeks)',
  hand_deliver_followup:
    'Should we deliver them in person, or may we leave them in a safe location?',
  hand_deliver_in_person: 'Deliver them in person. Do not leave them if I am not home.',
  hand_deliver_leave: 'They can be left in a safe location (please describe).',
};

export const ASH_RETURN_LABEL_FIELDS: Array<{
  value: AshReturnLabelKey;
  title: string;
  hint: string;
}> = [
  { value: 'mail', title: 'Mail', hint: 'First choice. Include the mail timing in the wording.' },
  {
    value: 'hand_deliver',
    title: 'Hand deliver',
    hint: 'Second choice. Timing belongs here (for example 4-6 weeks).',
  },
  {
    value: 'hand_deliver_followup',
    title: 'Hand-deliver follow-up question',
    hint: 'Asked only after they choose hand deliver.',
  },
  {
    value: 'hand_deliver_in_person',
    title: 'Deliver in person',
    hint: 'First follow-up choice.',
  },
  {
    value: 'hand_deliver_leave',
    title: 'Leave in a safe location',
    hint: 'Second follow-up choice. Clients who pick this must describe where.',
  },
];

export function parseAshReturnLabels(raw: unknown): AshReturnLabels {
  const defaults = { ...DEFAULT_ASH_RETURN_LABELS };
  if (raw == null || raw === '') return defaults;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return defaults;
    const row = parsed as Record<string, unknown>;
    const legacyCombined = !String(row.hand_deliver ?? '').trim();
    (Object.keys(defaults) as AshReturnLabelKey[]).forEach((key) => {
      if (
        legacyCombined &&
        (key === 'hand_deliver_in_person' || key === 'hand_deliver_leave')
      ) {
        return;
      }
      const next = String(row[key] ?? '').trim();
      if (next) defaults[key] = next;
    });
    if (
      defaults.mail.includes('I accept any risks of mail delivery.') &&
      !defaults.mail.includes('Minimal though they may be')
    ) {
      defaults.mail = defaults.mail.replace(
        'I accept any risks of mail delivery.',
        'Minimal though they may be, I accept any risks of mail delivery.',
      );
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function serializeAshReturnLabels(labels: AshReturnLabels): string {
  return JSON.stringify(labels);
}

export const EUTHANASIA_PRIVATE_CREMATION_URNS_KEY =
  'euthanasia.privateCremationUrns' as const;
export const EUTHANASIA_MEMORIAL_DEFAULT_SUBCATEGORY_KEY =
  'euthanasia.memorialDefaultSubcategory' as const;
export const DEFAULT_MEMORIAL_SUBCATEGORY = 'Paw & Nose Prints';

export function parseMemorialDefaultSubcategory(raw: unknown): string {
  const next = String(raw ?? '').trim();
  if (!next) return DEFAULT_MEMORIAL_SUBCATEGORY;
  if (/^all$/i.test(next)) return 'All';
  return next;
}

export type StoreListingRef = {
  listingId: string;
  name: string;
};

export type PrivateCremationUrns = {
  included: StoreListingRef | null;
  substitutes: StoreListingRef[];
};

export const DEFAULT_PRIVATE_CREMATION_URNS: PrivateCremationUrns = {
  included: { listingId: 'p-64', name: 'Hand-crafted Rosewood Urn' },
  substitutes: [
    { listingId: 'p-27', name: 'Decorative Metal Urn' },
    { listingId: 'p-111', name: 'Serenity Photo Urn' },
    { listingId: 'p-41', name: 'Cedar Memorial Urn' },
  ],
};

function parseStoreListingRef(raw: unknown): StoreListingRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as StoreListingRef;
  const listingId = String(row.listingId || '').trim();
  const name = String(row.name || '').trim();
  if (!listingId) return null;
  return { listingId, name: name || listingId };
}

export function parsePrivateCremationUrns(raw: unknown): PrivateCremationUrns {
  const defaults: PrivateCremationUrns = {
    included: DEFAULT_PRIVATE_CREMATION_URNS.included
      ? { ...DEFAULT_PRIVATE_CREMATION_URNS.included }
      : null,
    substitutes: DEFAULT_PRIVATE_CREMATION_URNS.substitutes.map((row) => ({ ...row })),
  };
  if (raw == null || raw === '') return defaults;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return defaults;
    const row = parsed as Partial<PrivateCremationUrns>;
    const included = parseStoreListingRef(row.included);
    const substitutes = Array.isArray(row.substitutes)
      ? row.substitutes.map(parseStoreListingRef).filter((item): item is StoreListingRef => Boolean(item))
      : defaults.substitutes;
    return {
      included: included ?? defaults.included,
      substitutes,
    };
  } catch {
    return defaults;
  }
}

export function serializePrivateCremationUrns(value: PrivateCremationUrns): string {
  return JSON.stringify(value);
}

export type CatalogItemRef = {
  itemType: 'procedure' | 'inventory' | 'lab';
  itemId: number;
  name: string;
};

export type EuthanasiaPawPrintItems = {
  ink: CatalogItemRef | null;
  clayCharge: CatalogItemRef | null;
  clayFree: CatalogItemRef | null;
};

export type ProviderPawPrintOffering = {
  ink: boolean;
  clayCharge: boolean;
  clayFree: boolean;
};

export type ProviderPawPrintMap = Record<string, ProviderPawPrintOffering>;

export function blankPawPrintItems(): EuthanasiaPawPrintItems {
  return { ink: null, clayCharge: null, clayFree: null };
}

export function blankProviderOffering(): ProviderPawPrintOffering {
  return { ink: true, clayCharge: true, clayFree: false };
}

export function defaultOfferingForProviderName(name: string): ProviderPawPrintOffering {
  if (/greenlaw/i.test(name)) {
    return { ink: false, clayCharge: false, clayFree: true };
  }
  return blankProviderOffering();
}

export function parsePawPrintItems(raw: unknown): EuthanasiaPawPrintItems {
  const empty = blankPawPrintItems();
  if (raw == null || raw === '') return empty;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return empty;
    const pick = (value: unknown): CatalogItemRef | null => {
      if (!value || typeof value !== 'object') return null;
      const row = value as CatalogItemRef;
      const itemId = Number(row.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) return null;
      const itemType =
        row.itemType === 'inventory' || row.itemType === 'lab' ? row.itemType : 'procedure';
      return { itemType, itemId, name: String(row.name || `#${itemId}`) };
    };
    return {
      ink: pick((parsed as EuthanasiaPawPrintItems).ink),
      clayCharge: pick((parsed as EuthanasiaPawPrintItems).clayCharge),
      clayFree: pick((parsed as EuthanasiaPawPrintItems).clayFree),
    };
  } catch {
    return empty;
  }
}

export function serializePawPrintItems(items: EuthanasiaPawPrintItems): string {
  return JSON.stringify(items);
}

export function parseProviderPawPrintMap(raw: unknown): ProviderPawPrintMap {
  if (raw == null || raw === '') return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: ProviderPawPrintMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const row = value as ProviderPawPrintOffering;
      out[id] = {
        ink: Boolean(row.ink),
        clayCharge: Boolean(row.clayCharge),
        clayFree: Boolean(row.clayFree),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeProviderPawPrintMap(map: ProviderPawPrintMap): string {
  return JSON.stringify(map);
}

export function offeringForProvider(
  map: ProviderPawPrintMap,
  employeeId: number | null | undefined,
  providerName = '',
): ProviderPawPrintOffering {
  if (employeeId != null && map[String(employeeId)]) return map[String(employeeId)]!;
  return defaultOfferingForProviderName(providerName);
}

export const EUTHANASIA_CONSENT_STATUS_CHANGED_EVENT =
  'vayd:euthanasia-consent-status-changed';

export type EuthanasiaConsentUiStatus = 'none' | 'sent' | 'complete';

export function notifyEuthanasiaConsentStatusChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EUTHANASIA_CONSENT_STATUS_CHANGED_EVENT));
}
