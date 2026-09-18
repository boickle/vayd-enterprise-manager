import axios from 'axios';
import { http } from './http';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const publicConsentClient = axios.create({ baseURL, withCredentials: false });

export type PawPrintChoice = 'none' | 'ink' | 'clayCharge' | 'clayFree';
export type AftercareChoice =
  | 'private_cremation'
  | 'burial_at_sea'
  | 'home_burial'
  | 'unsure';
export type AshReturnChoice =
  | 'mail'
  | 'hand_deliver_in_person'
  | 'hand_deliver_leave';

export type ConsentCatalogItem = {
  itemType: 'procedure' | 'inventory' | 'lab';
  itemId: number;
  name: string;
};

export type ProviderPawPrintOffering = {
  ink: boolean;
  clayCharge: boolean;
  clayFree: boolean;
};

export type EuthanasiaConsentAnswers = {
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  petName: string;
  petWeightLbs: string;
  vetsToNotify: string;
  otherVetsToNotify: string;
  aftercare: AftercareChoice;
  aftercareConfirmed: 'yes';
  nameplateLine1?: string;
  nameplateLine2?: string;
  nameplateLine3?: string;
  ashReturn?: AshReturnChoice;
  ashLeaveNotes?: string;
  pawPrintInk: boolean;
  pawPrintClay: boolean;
  pawPrints?: PawPrintChoice[];
  pawPrint?: PawPrintChoice;
  additionalInfo?: string;
  memorialItems?: ConsentMemorialItem[];
  consentAcknowledged: true;
};

export type ConsentMemorialItem = {
  listingId: string;
  name: string;
  storeCategory?: string | null;
  priceFrom?: number | null;
  timing: 'shop_now' | 'later';
  quantity?: number;
  variantName?: string | null;
  inventoryItemId?: number | null;
  procedureId?: number | null;
  catalogItemType?: 'inventory' | 'procedure';
};

export function parseMemorialItems(raw: unknown): ConsentMemorialItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsentMemorialItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Partial<ConsentMemorialItem>;
    const listingId = String(item.listingId || '').trim();
    const name = String(item.name || '').trim();
    if (!listingId || !name) continue;
    out.push({
      listingId,
      name,
      storeCategory: item.storeCategory ?? null,
      priceFrom: typeof item.priceFrom === 'number' ? item.priceFrom : null,
      timing: item.timing === 'shop_now' ? 'shop_now' : 'later',
      quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
      variantName: item.variantName ?? null,
      inventoryItemId: typeof item.inventoryItemId === 'number' ? item.inventoryItemId : null,
      procedureId: typeof item.procedureId === 'number' ? item.procedureId : null,
      catalogItemType: item.catalogItemType,
    });
  }
  return out;
}

export function memorialCartTotal(items: ConsentMemorialItem[]): number {
  return items
    .filter((item) => item.timing !== 'later')
    .reduce((sum, item) => sum + (Number(item.priceFrom) || 0) * (item.quantity || 1), 0);
}

function stripRepeatedTitle(title: string, detail: string): string {
  const raw = detail.trim();
  if (!raw || !title) return raw;
  if (raw.toLowerCase() === title.toLowerCase()) return '';
  const cores = [title, title.split(/\s*[-–—:/|]\s*/)[0] || ''].filter(Boolean);
  let next = raw;
  for (const core of cores) {
    const stripped = next
      .replace(new RegExp(`^${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:/|,]*\\s*`, 'i'), '')
      .trim();
    if (stripped && stripped.toLowerCase() !== next.toLowerCase()) next = stripped;
  }
  return next.replace(/\s*[-–—]\s*Final Gift\s*$/i, '').trim();
}

export function memorialItemParts(item: ConsentMemorialItem): {
  title: string;
  detail: string | null;
  amount: number;
  amountLabel: string;
} {
  const amount = (Number(item.priceFrom) || 0) * (item.quantity || 1);
  const amountLabel =
    amount === 0
      ? 'No charge'
      : amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const [head, ...rest] = String(item.name || '').split(/\s+[—–]\s+/);
  const title = (head || item.name || '').trim();
  const fromName = rest.join(' — ').trim();
  const fromVariant =
    item.variantName && item.variantName !== item.name && item.variantName !== title
      ? item.variantName
      : '';
  const detail = stripRepeatedTitle(title, [fromName, fromVariant].filter(Boolean).join(' — '));
  return { title, detail: detail || null, amount, amountLabel };
}

export function formatMemorialItemLine(item: ConsentMemorialItem): string {
  const { title, detail, amountLabel } = memorialItemParts(item);
  return detail ? `${title} (${detail}) — ${amountLabel}` : `${title} — ${amountLabel}`;
}

export type EuthanasiaConsentForm = {
  formType: 'euthanasia';
  token: string;
  expiresAt: string | null;
  providerName: string | null;
  client: { firstName: string; lastName: string; email: string };
  pet: { name: string; weightLbs: string };
  pawPrint: {
    offering: ProviderPawPrintOffering;
    items: {
      ink: ConsentCatalogItem | null;
      clayCharge: ConsentCatalogItem | null;
      clayFree: ConsentCatalogItem | null;
    };
    options: Array<{
      value: PawPrintChoice;
      label: string;
      catalogItem: ConsentCatalogItem | null;
    }>;
    showInkPhoto: boolean;
    showClayPhotos: boolean;
    clayChargePayment?: { required: boolean; amount: number; itemName: string } | null;
    storeListing?: {
      listingId: string;
      name: string;
      hasImage: boolean;
      imageProductId?: number | null;
      imageInventoryItemId?: number | null;
      storeProductId?: number | null;
    } | null;
  };
  practiceId?: number;
  memorialStorePath: string;
  memorialStoreCategory?: string;
  ashReturnLabels?: {
    mail: string;
    hand_deliver: string;
    hand_deliver_followup: string;
    hand_deliver_in_person: string;
    hand_deliver_leave: string;
  };
  privateCremationUrns?: {
    included: { listingId: string; name: string } | null;
    substitutes: Array<{ listingId: string; name: string }>;
  };
  memorialDefaultSubcategory?: string;
};

export type EuthanasiaConsentMenuMode = 'send' | 'resend' | 'view';

export type EuthanasiaConsentStatus = {
  isEuthanasia: boolean;
  invite: {
    id: number;
    sentAt: string | null;
    expiresAt: string | null;
    respondedAt: string | null;
    email: string | null;
    formUrl: string;
  } | null;
  response: {
    submittedAt: string;
    signedName: string | null;
    signatureDataUrl: string;
    answers: Record<string, unknown>;
    aftercareLabel: string;
    pawPrintLabel: string;
    selectedCatalogItem: ConsentCatalogItem | null;
    selectedCatalogItems?: ConsentCatalogItem[];
  } | null;
};

export function euthanasiaConsentMenuMode(
  status: Pick<EuthanasiaConsentStatus, 'invite' | 'response'> | null | undefined,
): EuthanasiaConsentMenuMode {
  if (status?.response) return 'view';
  if (status?.invite) return 'resend';
  return 'send';
}

export function euthanasiaConsentMenuLabel(mode: EuthanasiaConsentMenuMode): string {
  if (mode === 'view') return 'View Euthanasia Consent';
  if (mode === 'resend') return 'Re-send Euthanasia Consent';
  return 'Send Euthanasia Consent';
}

export async function getEuthanasiaConsentForm(token: string): Promise<EuthanasiaConsentForm> {
  const { data } = await publicConsentClient.get<EuthanasiaConsentForm>('/consent/euthanasia/form', {
    params: { token },
  });
  return data;
}

export async function submitEuthanasiaConsent(body: {
  token: string;
  answers: EuthanasiaConsentAnswers;
  signatureDataUrl: string;
  signedName: string;
  paymentMethodId?: string;
}): Promise<{ ok: boolean; submittedAt: string }> {
  const { data } = await publicConsentClient.post('/consent/euthanasia/submit', body);
  return data;
}

export async function sendEuthanasiaConsent(body: {
  appointmentId: number;
  patientId: number;
  clientId?: number;
}): Promise<{
  inviteId: number;
  sentTo: string;
  intendedRecipientEmail: string | null;
  formUrl: string;
  expiresAt: string;
}> {
  const { data } = await http.post('/consent/euthanasia/send', body);
  return data;
}

export async function getEuthanasiaConsentStatuses(
  appointmentIds: number[],
): Promise<{ statuses: Record<number, 'none' | 'sent' | 'complete'> }> {
  const ids = appointmentIds.filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return { statuses: {} };
  const { data } = await http.get<{ statuses: Record<number, 'none' | 'sent' | 'complete'> }>(
    '/consent/euthanasia/statuses',
    { params: { appointmentIds: ids.join(',') } },
  );
  return data ?? { statuses: {} };
}

export async function getEuthanasiaConsentStatus(
  appointmentId: number,
  patientId?: number,
): Promise<EuthanasiaConsentStatus> {
  const { data } = await http.get<EuthanasiaConsentStatus>('/consent/euthanasia/status', {
    params: {
      appointmentId,
      ...(patientId != null ? { patientId } : {}),
    },
  });
  return data;
}
