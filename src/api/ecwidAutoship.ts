// Auto-ship Import: review Ecwid auto-ships before they move into Scout auto-ship.
import { http } from './http';

export type EcwidAutoshipStatus = 'pending' | 'approved' | 'skipped' | 'moved' | 'gone';

export type MoveAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal: string;
};

export type EcwidAutoshipRow = {
  id: number;
  ecwidSubscriptionId: string;
  lineIndex: number;
  status: EcwidAutoshipStatus;
  nextCharge: string | null;
  daysUntilCharge: number | null;
  addressChoice: 'ecwid' | 'scout';
  notes: string | null;
  reviewedAt: string | null;
  alreadyInScout: boolean;
  move: {
    scoutSubscriptionId: number | null;
    stripeSubscriptionId: string | null;
    stripeMode: 'test' | 'live' | null;
    movedAt: string | null;
    /** cancelled | failed | test_not_cancelled */
    ecwidCancel: string | null;
    error: string | null;
  };
  ecwid: {
    name: string;
    email: string;
    phone: string;
    petName: string;
    product: string;
    options: string;
    sku: string;
    quantity: number;
    price: number;
    tax: number;
    charge: number;
    billingFrequency: string | null;
    skuFrequency: string | null;
    address: MoveAddress;
    hasStripeIds: boolean;
  };
  scout: {
    client: { id: number; name: string; email: string | null; address: MoveAddress | null } | null;
    pets: Array<{ id: number; name: string; active: boolean }>;
    patient: { id: number; name: string } | null;
    item: { id: number; code: string | null; name: string; listed: boolean; needsApproval: boolean } | null;
    quantity: number | null;
    frequency: string | null;
    unitPrice: number | null;
    memberDiscountPct: number;
    tagalongs: Array<{ name: string; amount: number }>;
    taxRate: number;
    charge: number | null;
  };
  proposed: {
    clientAlternatives: Array<{ id: number; label: string }>;
    petAlternatives: Array<{ id: number; label: string }>;
    itemAlternatives: Array<{ id: number; label: string }>;
    clientMatch: string;
    petMatch: string;
    itemMatch: string;
    quantity: number | null;
    quantityBasis: string;
    quantityCheck: boolean;
  };
  diffs: {
    address: 'same' | 'formatting' | 'zip' | 'different' | 'missing';
    price: 'same' | 'increase' | 'decrease' | null;
    priceDifference: number | null;
    frequency: boolean;
    quantity: boolean;
    petName: boolean;
    email: boolean;
    itemUnlisted: boolean;
    rxWithoutPet: boolean;
    chargeSoon: boolean;
  };
  problems: string[];
};

export type EcwidAutoshipPatch = {
  clientId?: number | null;
  patientId?: number | null;
  inventoryItemId?: number | null;
  quantity?: number;
  frequency?: string | null;
  addressChoice?: 'ecwid' | 'scout';
  notes?: string | null;
};

const base = (practiceId: number) => `/practice/${practiceId}/online-store/ecwid-autoship`;

export async function listEcwidAutoships(practiceId: number) {
  const { data } = await http.get<EcwidAutoshipRow[]>(base(practiceId));
  return data ?? [];
}

/** Re-pull ACTIVE Ecwid auto-ships (read-only toward Ecwid). Keeps choices already made. */
export async function refreshEcwidAutoships(practiceId: number) {
  const { data } = await http.post<{
    summary: { fetched: number; added: number; gone: number };
    rows: EcwidAutoshipRow[];
  }>(`${base(practiceId)}/refresh`);
  return data;
}

export async function updateEcwidAutoship(practiceId: number, id: number, body: EcwidAutoshipPatch) {
  const { data } = await http.patch<EcwidAutoshipRow>(`${base(practiceId)}/${id}`, body);
  return data;
}

export type EcwidAutoshipMode = { stripe: 'off' | 'test' | 'live'; cancelsEcwid: boolean };

/** test = Stripe sandbox + test card, Ecwid untouched; live = client's card, Ecwid cancelled. */
export async function getEcwidAutoshipMode(practiceId: number) {
  const { data } = await http.get<EcwidAutoshipMode>(`${base(practiceId)}/mode`);
  return data;
}

/** Move every approved item on one Ecwid auto-ship into Scout. Returns that auto-ship's rows. */
export async function moveEcwidAutoship(practiceId: number, ecwidSubscriptionId: string) {
  const { data } = await http.post<EcwidAutoshipRow[]>(
    `${base(practiceId)}/subscription/${encodeURIComponent(ecwidSubscriptionId)}/move`,
  );
  return data ?? [];
}

/** Move every Ecwid auto-ship whose items are all approved or skipped. */
export async function moveAllApprovedEcwidAutoships(practiceId: number) {
  const { data } = await http.post<{
    moved: string[];
    held: Array<{ ecwidSubscriptionId: string; reason: string }>;
    waitingOnReview: number;
    rows: EcwidAutoshipRow[];
  }>(`${base(practiceId)}/move-approved`);
  return data;
}

export async function setEcwidAutoshipStatus(
  practiceId: number,
  id: number,
  status: 'approved' | 'skipped' | 'pending',
) {
  const { data } = await http.post<EcwidAutoshipRow>(`${base(practiceId)}/${id}/status`, { status });
  return data;
}
