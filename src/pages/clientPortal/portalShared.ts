// Shared helpers/types for the pet-first client portal.
import type { ClientAppointment, ClientReminder, Pet, WellnessPlan } from '../../api/clientPortal';
import { apiBaseUrl } from '../../api/http';
import { patientPhotoSrc } from '../../components/pims/PetThumb';

export type PetWithWellness = Pet & {
  wellnessPlans?: WellnessPlan[];
  membershipStatus?: string | null;
  membershipPlanName?: string | null;
  membershipPricingOption?: string | null;
  membershipUpdatedAt?: string | null;
};

export const PRACTICE_NAME = 'Vet At Your Door';
export const PRACTICE_PHONE_DISPLAY = '(207) 536-8387';
export const PRACTICE_PHONE_TEL = 'tel:207-536-8387';
export const PRACTICE_PHONE_SMS = 'sms:207-536-8387';
export const PRACTICE_INFO_EMAIL = 'info@vetatyourdoor.com';
export const LIVE_CHAT_URL = 'https://direct.lc.chat/19087357/';
export const APPOINTMENT_REQUEST_URL =
  import.meta.env.VITE_APPOINTMENT_REQUEST_URL || '/client-portal/request-appointment';

const BASE = import.meta.env.BASE_URL ?? '/';
export const DOG_PLACEHOLDER = `${BASE}doggy.png`;
export const CAT_PLACEHOLDER = `${BASE}catty.png`;
export const LOGO_SRC = `${BASE}final_thick_lines_cropped.jpeg`;

/* ---------- dates ---------- */
export function fmtDateTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}
export function fmtTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function fmtDayLong(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
export function fmtShortDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function fmtReminderDate(r: ClientReminder): string {
  if (!r?.dueIso) return '—';
  const t = Date.parse(r.dueIso);
  if (!Number.isFinite(t)) return r.dueIso;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

export function relativeDay(iso?: string | null): string {
  const d = daysUntil(iso);
  if (d == null) return '';
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d > 1 && d < 7) return `In ${d} days`;
  if (d < 0 && d > -7) return `${-d} day${d === -1 ? '' : 's'} ago`;
  return '';
}

/* ---------- pets ---------- */
export function petAgeLabel(dob?: string | null): string | null {
  if (!dob) return null;
  const b = new Date(dob);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  if (months < 0) return null;
  if (months < 1) return 'Just born';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} old`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years < 2 && rem > 0) return `${years} yr ${rem} mo old`;
  return `${years} year${years === 1 ? '' : 's'} old`;
}

export function petSexLabel(sex?: string | null): string | null {
  if (!sex) return null;
  const s = sex.toLowerCase();
  if (s.includes('female')) return s.includes('spay') ? 'Spayed female' : 'Female';
  if (s.includes('male')) return s.includes('neuter') ? 'Neutered male' : 'Male';
  return sex;
}

export function speciesKind(p: Pick<Pet, 'species' | 'breed'>): 'dog' | 'cat' | 'other' {
  const s = `${p.species ?? ''} ${p.breed ?? ''}`.toLowerCase();
  if (s.includes('canine') || s.includes('dog')) return 'dog';
  if (s.includes('feline') || s.includes('cat')) return 'cat';
  return 'other';
}

export function speciesEmoji(p: Pick<Pet, 'species' | 'breed'>): string {
  const k = speciesKind(p);
  return k === 'dog' ? '🐶' : k === 'cat' ? '🐱' : '🐾';
}

export function petImg(p: Pet): string {
  const uploaded = patientPhotoSrc(p.dbId ?? p.id, p.photoUrl, apiBaseUrl);
  if (uploaded) return uploaded;
  return speciesKind(p) === 'dog' ? DOG_PLACEHOLDER : CAT_PLACEHOLDER;
}

export function petHasUploadedPhoto(p: Pet): boolean {
  return Boolean(patientPhotoSrc(p.dbId ?? p.id, p.photoUrl, apiBaseUrl));
}

export function petMatchesId(p: Pet, id: string | number | null | undefined): boolean {
  if (id == null) return false;
  const s = String(id);
  return s === String(p.id) || (p.dbId != null && s === String(p.dbId));
}

export function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/* ---------- membership ---------- */
export function planIsActive(plan: Pick<WellnessPlan, 'isActive' | 'status'> | null | undefined): boolean {
  if (!plan) return false;
  const isDeleted = (plan as any)?.isDeleted;
  if (isDeleted === true || String(isDeleted).toLowerCase() === 'true') return false;
  const expirationDate = (plan as any)?.expirationDate;
  if (expirationDate) {
    const expDate = new Date(expirationDate);
    if (!isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) return false;
  }
  const direct =
    plan.isActive === true || String(plan.isActive).toLowerCase() === 'true' || String(plan.isActive) === '1';
  if (direct) return true;
  if (typeof (plan as any)?.active === 'boolean' && (plan as any).active) return true;
  if (typeof (plan as any)?.active === 'string') {
    const activeStr = String((plan as any).active).toLowerCase();
    if (activeStr === 'true' || activeStr === '1' || activeStr === 'active') return true;
  }
  const status = typeof plan.status === 'string' ? plan.status.toLowerCase() : undefined;
  return status === 'active';
}

export function cleanMembershipDisplayText(text: string): string {
  if (!text) return text;
  if (text.includes('Add-ons:')) {
    const match = text.match(/^([^(]+)\s*\(Add-ons:\s*([^)]+)\)/);
    if (match) {
      const basePlan = match[1].trim();
      const addOns = match[2]
        .trim()
        .split(',')
        .map((addon) => addon.trim().replace(/\s+Add-on$/i, '').trim())
        .filter(Boolean);
      return addOns.length > 0 ? `${basePlan} ${addOns.join(', ')}` : basePlan;
    }
  }
  return text.replace(/\s+Add-on\b/gi, '');
}

function pricingLabel(planName: string, pricingOption: string | null | undefined): string | null {
  const lower = planName.toLowerCase();
  if (lower.includes('monthly') || lower.includes('annual')) return null;
  if (!pricingOption) return null;
  const po = String(pricingOption).toLowerCase();
  if (po === 'annual') return 'Annual';
  if (po === 'monthly') return 'Monthly';
  return titleCase(String(pricingOption).replace(/[_-]+/g, ' ').trim());
}

export type MembershipView = {
  /** 'active' | 'processing' | 'pending' | 'none' */
  state: 'active' | 'processing' | 'pending' | 'none';
  badgeLabel: string | null;
  /** Plan text to display (e.g. "Foundations Plus", "Golden Annual"). */
  planText: string | null;
  showSignupCta: boolean;
  hasActiveWellnessPlan: boolean;
};

/** Mirrors the long-standing badge/notice rules from the previous portal. */
export function computeMembershipView(p: PetWithWellness): MembershipView {
  const subStatus = p.subscription?.status;
  const subActive = subStatus === 'active';
  const subPending = subStatus === 'pending';

  const allPlans = p.wellnessPlans || [];
  const activePlans = allPlans.filter((plan) => planIsActive(plan));
  const hasActiveWellnessPlan = activePlans.length > 0;
  const hasWellnessPlans = allPlans.length > 0;

  const membershipStatus = p.membershipStatus ? String(p.membershipStatus).toLowerCase() : null;
  const membershipIsPending = membershipStatus === 'pending';
  const hasMembership = p.membershipPlanName != null;
  const membershipIsRecent = p.membershipUpdatedAt
    ? (Date.now() - new Date(p.membershipUpdatedAt).getTime()) / 86_400_000 <= 7
    : false;

  let planText: string | null = null;
  let showNotice = false;

  const processingText = () => {
    const name = cleanMembershipDisplayText(p.membershipPlanName || 'Membership');
    const label = pricingLabel(name, p.membershipPricingOption);
    return label ? `${name} ${label}` : name;
  };

  if (hasActiveWellnessPlan) {
    // Package names often read "Membership - Feline Foundations - Monthly"; the card already says "Membership".
    planText = (activePlans[0].packageName || activePlans[0].name || 'Wellness Plan').replace(/^\s*membership\s*[-–:]\s*/i, '');
    showNotice = true;
  } else if (hasMembership && !hasWellnessPlans) {
    planText = processingText();
    showNotice = true;
  } else if (hasMembership && hasWellnessPlans && !hasActiveWellnessPlan && membershipIsRecent) {
    planText = processingText();
    showNotice = true;
  }

  const showSignupCta =
    !hasActiveWellnessPlan &&
    (!hasMembership || (hasMembership && hasWellnessPlans && !hasActiveWellnessPlan && !membershipIsRecent));

  const isProcessing = hasMembership && !hasActiveWellnessPlan && showNotice;

  let state: MembershipView['state'] = 'none';
  let badgeLabel: string | null = null;
  if (subActive) {
    state = 'active';
    badgeLabel = 'Subscription Active';
  } else if (subPending) {
    state = 'pending';
    badgeLabel = 'Subscription Pending';
  } else if (hasActiveWellnessPlan) {
    state = 'active';
    badgeLabel = 'Member';
  } else if (isProcessing) {
    state = 'processing';
    badgeLabel = 'Membership Processing';
  } else if (membershipIsPending) {
    state = 'pending';
    badgeLabel = 'Membership Pending';
  }

  return { state, badgeLabel, planText, showSignupCta, hasActiveWellnessPlan };
}

/* ---------- appointments ---------- */
export function apptMatchesPet(a: ClientAppointment, p: Pet): boolean {
  const apptPetId = a.patientPimsId != null ? String(a.patientPimsId) : null;
  if (apptPetId && petMatchesId(p, apptPetId)) return true;
  const apptAny = a as any;
  const patientDbId = apptAny?.patientId ?? apptAny?.patient?.id ?? null;
  if (patientDbId != null && petMatchesId(p, patientDbId)) return true;
  if (!apptPetId && patientDbId == null && a.patientName && p.name) {
    return a.patientName.trim().toLowerCase() === p.name.trim().toLowerCase();
  }
  return false;
}

export function apptTypeLabel(a: ClientAppointment): string {
  return (
    a.appointmentTypeName ??
    (typeof a.appointmentType === 'string' ? a.appointmentType : a.appointmentType?.name) ??
    'Visit'
  );
}

export function apptAddress(a: ClientAppointment): string {
  return [a.address1, a.city, a.state, a.zip].filter(Boolean).join(', ');
}

export function groupApptsByDay(appts: ClientAppointment[]) {
  const map = new Map<string, ClientAppointment[]>();
  for (const a of appts) {
    const key = new Date(a.startIso).toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, label: fmtDayLong(items[0]?.startIso), items }));
}

/* ---------- misc ---------- */
export function providerEmailFromName(providerName?: string | null): string {
  if (!providerName) return 'support@vetatyourdoor.com';
  const parts = providerName.trim().split(/\s+/);
  if (parts.length === 0) return 'support@vetatyourdoor.com';
  if (parts.length === 1) return `${parts[0].toLowerCase()}@vetatyourdoor.com`;
  const emailName = `${parts[0].charAt(0)}${parts[parts.length - 1]}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${emailName}@vetatyourdoor.com`;
}

export function providerShortName(name?: string | null): string {
  if (!name) return 'your vet';
  const trimmed = name.trim();
  if (/^dr\.?\s/i.test(trimmed)) return trimmed;
  const parts = trimmed.split(/\s+/);
  const last = parts[parts.length - 1] ?? trimmed;
  return `Dr. ${last}`;
}

export function possessive(name: string): string {
  const n = name.trim() || 'Your pet';
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}
