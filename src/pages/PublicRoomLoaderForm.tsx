// src/pages/PublicRoomLoaderForm.tsx
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiBaseUrl, http } from '../api/http';
import { publicStoreProducts, type StoreListing, type StoreVariant } from '../api/onlineStore';
import {
  searchItemsPublic,
  type SearchableItem,
  checkItemPricingPublic,
  clearCheckItemPricingPublicCache,
  type CheckItemPricingResponse,
  type CheckItemPricingPublicRequest,
  simulateBillWithMembershipPublic,
  type RoomLoaderSimulateBillPublicResponse,
  type RoomLoaderSimulateLineItem,
} from '../api/roomLoader';
import {
  getPatientTreatmentHistoryPublic,
  type TreatmentWithItems,
} from '../api/treatments';
import type { Pet } from '../api/clientPortal';
import MembershipRecommendationPanel, {
  type RoomLoaderPlanForDisplay,
  type RoomLoaderPlansForPetForDisplay,
} from '../components/MembershipRecommendationPanel';
import MembershipEnrollmentModal, {
  type MembershipEnrollmentEligiblePet,
} from '../components/MembershipEnrollmentModal';
import {
  fetchFormattedSubscriptionPlans,
  fetchSubscriptionPlanCatalog,
  type FormattedSubscriptionPlan,
  type SubscriptionPlanCatalog,
} from '../api/payments';
import { DateTime } from 'luxon';
import jsPDF from 'jspdf';
import {
  membershipSpeciesPrimaryLabel,
  resolveMembershipPetKind,
} from '../utils/membershipSpecies';
import {
  computeMembershipAgeYearsForRoomLoaderRow,
  petMeetsGoldenAge,
} from '../utils/membershipAge';
import { trackEvent } from '../utils/analytics';
import { computeFoundationsSeniorScreenFalseCoverageVisitDelta } from '../utils/membershipFoundationsSimulate';
import {
  resolveRoomLoaderConfig,
  roomLoaderItemKey,
  type RoomLoaderConfig,
  type RoomLoaderItemRef,
  type RoomLoaderItemQuestion,
  type RoomLoaderPanelOption,
  type RoomLoaderPanelRule,
  type RoomLoaderSpecies,
} from '../api/roomLoaderConfig';
import {
  resolvePetPlan,
  type EngineContext,
  type ResolvedPetPlan,
} from '../utils/roomLoaderOfferEngine';
import { buildPlanContext } from './roomLoader/roomLoaderPlanContext';
import {
  chronicMedKey,
  chronicMedsOtherKey,
  itemQuestionKey,
  medicalConcernPanelKey,
  offerKey,
  outdoorAccessKey,
  outdoorPitchKey,
  panelAnswerKey,
  panelSubAskKey,
} from './roomLoader/roomLoaderFormKeys';
import {
  acceptedConfigItems,
  configAnswerQuestions,
  configSummaryExcludeKey,
  configuredItemRefs,
  effectiveAcceptedPanelOptions,
  missingConfigAnswers,
  panelReplacementLabels,
  rowReplacedByPanel,
  splitDedupedOffers,
  visiblePanelSubAsks,
} from './roomLoader/roomLoaderConfigPlan';
import ChronicMedsSection, { type ChronicMed } from './roomLoader/ChronicMedsSection';
import ItemQuestionsSection from './roomLoader/ItemQuestionsSection';
import OfferSection from './roomLoader/OfferSection';
import OutdoorAccessQuestion from './roomLoader/OutdoorAccessQuestion';
import RoomLoaderLabsPage, { labsPageIsEmpty } from './roomLoader/RoomLoaderLabsPage';
import { doctorNameFromAppointment } from './roomLoader/fillLabCopy';
import { MEMBERSHIP_ALLOTMENT_USED_LABEL, roomLoaderPriceLabel } from './roomLoader/RoomLoaderPrice';
import { getPreDiscountForOneUnit } from '../utils/catalogItemPricing';
import MembershipPitch, { type MembershipPitchRow } from './roomLoader/MembershipPitch';
import MembershipCelebration from './roomLoader/MembershipCelebration';
import ProductGuideSection from './roomLoader/ProductGuideSection';
import {
  CarePlanWhyRecommendBlurb,
  carePlanRowCode,
  carePlanUncheckRecommendationBody,
  configuredUncheckRecommendationHtml,
} from './roomLoader/carePlanRecommendationBlurbs';
import './roomLoader/RoomLoaderSections.css';
import './roomLoader/MembershipPitch.css';
import './PublicRoomLoaderForm.css';

/** Plan/context stand-ins so a pet the payload has not described yet simply offers nothing. */
const emptyPetPlan: ResolvedPetPlan = {
  panelRules: [],
  universalOffers: [],
  gatedOffers: [],
  outdoorPitch: null,
  askOutdoorAccess: false,
  medicalConcernOptions: [],
  itemQuestions: [],
};
const emptyPlanContext: EngineContext = {
  species: 'any',
  ageMonths: null,
  history: [],
  reminders: [],
  estimateLines: [],
  outdoorAccess: null,
  medicalConcern: false,
};

/** `chronicMedsByPatient` may be absent on older payloads; anything unusable is dropped. */
function normalizeChronicMedsByPatient(raw: unknown): Record<string, ChronicMed[]> {
  if (raw == null || typeof raw !== 'object') return {};
  const out: Record<string, ChronicMed[]> = {};
  for (const [patientId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const meds = value.flatMap((row: any) => {
      const prescriptionId = Number(row?.prescriptionId ?? row?.id);
      const name = String(row?.name ?? '').trim();
      if (!Number.isFinite(prescriptionId) || name === '') return [];
      return [
        {
          prescriptionId,
          name,
          strength: row?.strength != null ? String(row.strength) : null,
          instructions: row?.instructions != null ? String(row.instructions) : null,
          inventoryItemId: row?.inventoryItemId != null ? Number(row.inventoryItemId) : null,
          refillsRemaining: row?.refillsRemaining != null ? Number(row.refillsRemaining) : null,
          autoshipActive: row?.autoshipActive === true,
        },
      ];
    });
    if (meds.length > 0) out[String(patientId)] = meds;
  }
  return out;
}

/** Dollar amount credited when an additional pet enrolls in membership (same household / multi-pet rule). */
const VAYD_MULTI_PET_MEMBERSHIP_CREDIT_USD = 75;
/** Label for the credit line on summary, PDF payload, and simulate exclusions. */
const VAYD_MULTI_PET_MEMBERSHIP_CREDIT_LINE_NAME = 'VAYD multi-pet membership credit';

/** Match full appointment to room-loader patient by `patient.id` (`appointments[]` order may not match `patients[]`). */
function getAppointmentForRoomLoaderPet(
  appointments: any[] | undefined,
  patientRow: any,
  fallbackIndex: number
): any | undefined {
  if (!appointments?.length) return undefined;
  const pid = patientRow?.patientId ?? patientRow?.patient?.id ?? patientRow?.id;

  const patientIdsEqual = (a: unknown, b: unknown) =>
    a != null && b != null && String(a) === String(b);

  if (pid != null) {
    const apptByEmbeddedPatient = appointments.find((a: any) => {
      const ap = a?.patient;
      if (!ap || typeof ap !== 'object') return false;
      const aid = (ap as any).id ?? (ap as any).patientId ?? (ap as any).patient_id;
      return patientIdsEqual(aid, pid);
    });
    if (apptByEmbeddedPatient) return apptByEmbeddedPatient;

    const apptByTopLevelPatientId = appointments.find((a: any) =>
      patientIdsEqual(a.patientId ?? a.patient_id, pid)
    );
    if (apptByTopLevelPatientId) return apptByTopLevelPatientId;
  }

  const apptIds = patientRow?.appointmentIds;
  if (Array.isArray(apptIds) && apptIds.length) {
    const wanted = new Set(apptIds.map((x: any) => String(x)));
    const apptByRowIds = appointments.find((a: any) => a?.id != null && wanted.has(String(a.id)));
    if (apptByRowIds) return apptByRowIds;
  }

  if (fallbackIndex >= 0 && fallbackIndex < appointments.length) {
    return appointments[fallbackIndex];
  }
  return undefined;
}

/** Quality of Life / hospice-style visits — suppress membership upsell and related simulate on the public summary. */
function publicRoomLoaderAppointmentIsQOLExam(appt: any | undefined): boolean {
  const t = (appt?.appointmentType?.prettyName ?? appt?.appointmentType?.name ?? '').toString().toLowerCase();
  return t.includes('qol') || t.includes('quality of life') || t.includes('hospice');
}

/** Match appointment `patient` to a room-loader row by id (order may not match `patients[]`). */
function getAppointmentPatientForRoomLoaderPet(
  appointments: any[] | undefined,
  patientRow: any,
  fallbackIndex: number
): any | undefined {
  return getAppointmentForRoomLoaderPet(appointments, patientRow, fallbackIndex)?.patient;
}

const MEMBERSHIP_SHARED_BENEFITS = [
  'A dedicated "One-Team" that gets to know your pet over time',
  'Priority scheduling with your One-Team',
  '7-day support from VAYD staff',
  '50% off exams on additional visits',
  'Member pricing (10% off) in our online store',
];

/** Plan card content for room-loader info popover (same as MembershipSignup). Key by base plan id (e.g. foundations, golden). */
const MEMBERSHIP_PLAN_CARD_DETAILS: Record<string, { name: string; tagLine: string; includes: string[] }> = {
  foundations: {
    name: 'Foundations',
    tagLine: 'Annual Membership Plan',
    includes: [
      'One comprehensive wellness exam & trip fee',
      'Annual vaccinations recommended for age and lifestyle',
      'Annual "basic" lab panel (CBC, abbreviated chemistry)',
      'Annual fecal test',
      'Heartworm/Tick test (dogs)',
      'FIV/FeLV/heartworm test (cats)',
      ...MEMBERSHIP_SHARED_BENEFITS,
    ],
  },
  golden: {
    name: 'Golden',
    tagLine: 'Annual Membership Plan',
    includes: [
      'Two comprehensive wellness exams & trip fees',
      'Annual vaccinations recommended for age and lifestyle',
      'Annual "advanced" lab panel (CBC, chemistry, thyroid, urinalysis)',
      'Annual fecal test',
      'FeLV/FIV/heartworm test (cats)',
      'Pancreatitis screening (cats)',
      '"4dx" Heartworm/Tick test (dogs)',
      'A team that gets to know your pet over time',
      'Priority scheduling with your One-Team',
      '7-day support from VAYD staff',
    ],
  },
  'starter-addon': {
    name: 'Puppy / Kitten Add-on',
    tagLine: 'For Puppies & Kittens',
    includes: [
      'Two additional exams (one doctor, one technician) and trip fees to complete the vaccine series.',
      'All boosters for full protection.',
      'Microchip scan & placement if needed.',
    ],
  },
};

function getMembershipPlanCardDetails(planId: string): { name: string; tagLine: string; includes: string[] } | null {
  const baseId = (planId || '').replace(/-cat|-dog$/i, '');
  return MEMBERSHIP_PLAN_CARD_DETAILS[baseId] ?? MEMBERSHIP_PLAN_CARD_DETAILS[planId] ?? null;
}

/** All plan IDs used in membership flow (base + add-ons). Filter per pet using same logic as MembershipSignup. */
const ALL_MEMBERSHIP_PLAN_IDS = ['foundations', 'golden', 'starter-addon'] as const;

/** Pet details for membership plan filtering (same logic as MembershipSignup: kind + ageYears). */
function getPetDetailsForMembership(
  p: any,
  appointmentPatient?: any
): { kind: 'dog' | 'cat' | null; ageYears: number | null } {
  const kind = resolveMembershipPetKind(p, appointmentPatient ? [appointmentPatient] : undefined);
  const ageYears = computeMembershipAgeYearsForRoomLoaderRow(p, appointmentPatient);
  return { kind, ageYears };
}

/** Which plan IDs to show for a pet (same logic as Client Portal: Golden only when age meets threshold, Starter for puppy/kitten). */
function getPlanIdsForPet(
  petDetails: { kind: 'dog' | 'cat' | null; ageYears: number | null },
  goldenPlans?: { name?: string | null; minAgeMonths?: number | null; species?: string | null }[] | null
): string[] {
  const { kind, ageYears } = petDetails;
  const meetsGolden = kind != null && petMeetsGoldenAge(ageYears, goldenPlans, kind);
  const shouldShowStarter = ageYears != null && ageYears <= 1.5 && (kind === 'dog' || kind === 'cat');
  const planIds: string[] = ['foundations'];
  if (meetsGolden) planIds.push('golden');
  if (shouldShowStarter) planIds.push('starter-addon');
  return planIds;
}

function normalizePlanBaseId(planId: string): string {
  return (planId || '').replace(/-cat|-dog$/i, '');
}

const MEMBERSHIP_ADDON_PLAN_BASE_IDS = new Set(['starter-addon']);

/**
 * Primary wellness plan for recommendation copy (excludes add-ons).
 * Matches MembershipSignup: recommend Golden only when `meetsGolden`; otherwise Foundations (not "first Golden in list").
 */
function getRecommendedWellnessPlanFromList(
  plans: RoomLoaderPlanForDisplay[],
  meetsGolden: boolean
): RoomLoaderPlanForDisplay | null {
  const wellness = plans.filter((p) => !MEMBERSHIP_ADDON_PLAN_BASE_IDS.has(normalizePlanBaseId(p.planId)));
  if (wellness.length === 0) return null;
  const withBase = wellness.map((p) => ({ p, base: normalizePlanBaseId(p.planId) }));
  if (meetsGolden) {
    const golden = withBase.find((x) => x.base === 'golden');
    if (golden) return golden.p;
  }
  const foundations = withBase.find((x) => x.base === 'foundations');
  if (foundations) return foundations.p;
  return wellness[0];
}

/**
 * Same total as each pet card’s “If you enroll in membership today” (`dueAtVisit`): member-priced visit + store/tax,
 * with multi-pet credit applied — does not add the first month’s membership charge (that’s called out separately in the panel).
 * Can be negative when the multi-pet credit exceeds visit due; the summary footer shows that as “-$X.XX (credit)”.
 *
 * Mixed households (some pets already members): keep existing members’ current summary pricing and swap only
 * non-member (upsell) pets to simulated member pricing via `canonicalGrandTotal`.
 */
const VAYD_MULTI_PET_MEMBERSHIP_CREDIT_USD_FOOTER = 75;

/** Optional extended simulate (visit + declined lines) for Care Coverage Comparison only; totals use `monthly`. */
type MembershipPanelSimulateEntry = {
  monthly: RoomLoaderSimulateBillPublicResponse | null;
  annual: RoomLoaderSimulateBillPublicResponse | null;
  monthlyExtended?: RoomLoaderSimulateBillPublicResponse | null;
};

function estimatedDueTodayWithMembershipForUpsellPets(
  pets: RoomLoaderPlansForPetForDisplay[],
  membershipPanelByPatientId: Record<number, MembershipPanelSimulateEntry>,
  allPatients: any[],
  patientHasMembershipFlag: (p: any) => boolean,
  membershipFooterOpts?: {
    summaryLineItems: Array<{ name: string; price: number; quantity: number; patientId?: number; category?: string }>;
    firstPatientId: number;
    /** Full summary grand total (includes existing members + store). Required for mixed-household footer math. */
    canonicalGrandTotal?: number;
  }
): number | null {
  if (pets.length === 0) return null;
  let sumMemberVisit = 0;
  let sumOriginalVisit = 0;
  let storeTax: number | null = null;

  for (const petPlans of pets) {
    const monthly = membershipPanelByPatientId[petPlans.patientId]?.monthly;
    if (!monthly) return null;

    const monthlyExtended = membershipPanelByPatientId[petPlans.patientId]?.monthlyExtended;
    const adjustments = monthlyExtended?.lineItemAdjustments ?? monthly?.lineItemAdjustments ?? [];
    const rec = getRecommendedWellnessPlanFromList(petPlans.plans, petPlans.meetsGolden);
    const planBase = rec ? normalizePlanBaseId(rec.planId) : '';
    let foundationsSeniorFalseVisitDelta = 0;
    if (membershipFooterOpts && planBase) {
      const filtered = filterLineItemsForPatientSimulate(
        membershipFooterOpts.summaryLineItems,
        petPlans.patientId,
        membershipFooterOpts.firstPatientId
      ).filter((li) => (li as { category?: string }).category !== 'store');
      foundationsSeniorFalseVisitDelta = computeFoundationsSeniorScreenFalseCoverageVisitDelta(
        planBase,
        petPlans.patientId,
        filtered,
        adjustments,
        normItemName
      );
    }

    const otherPets = allPatients.filter((p: any) => {
      const pid = Number(p?.patientId ?? p?.patient?.id ?? p?.id);
      return !Number.isNaN(pid) && pid !== petPlans.patientId;
    });
    const otherMembers = otherPets.filter((p: any) => patientHasMembershipFlag(p));
    const currentPatient = allPatients.find(
      (p: any) => Number(p?.patientId ?? p?.patient?.id ?? p?.id) === petPlans.patientId
    );
    const thisPetIsMember = currentPatient ? patientHasMembershipFlag(currentPatient) : false;
    const householdIndex = allPatients.findIndex(
      (p: any) => Number(p?.patientId ?? p?.patient?.id ?? p?.id) === petPlans.patientId
    );
    const isFirstHouseholdPet = householdIndex === 0;
    const qualifiesForMultiPetCredit =
      !thisPetIsMember && (otherMembers.length >= 1 || (allPatients.length > 1 && !isFirstHouseholdPet));
    const multiPetCreditUsd = qualifiesForMultiPetCredit ? VAYD_MULTI_PET_MEMBERSHIP_CREDIT_USD_FOOTER : 0;

    sumMemberVisit +=
      Number(monthly.withMembershipVisitSubtotal) - multiPetCreditUsd + foundationsSeniorFalseVisitDelta;
    sumOriginalVisit += Number(monthly.originalVisitSubtotal);

    const st = Math.max(0, Number(monthly.originalTotal) - Number(monthly.originalVisitSubtotal));
    if (storeTax === null) storeTax = st;
  }

  const householdHasExistingMember = allPatients.some((p: any) => patientHasMembershipFlag(p));
  const grand = membershipFooterOpts?.canonicalGrandTotal;
  if (householdHasExistingMember && grand != null && Number.isFinite(grand)) {
    // Keep member pets’ current summary amounts; replace only upsell pets’ full-price visit with simulated member pricing.
    return grand - sumOriginalVisit + sumMemberVisit;
  }

  return sumMemberVisit + (storeTax ?? 0);
}

function getFirstPlanIdFromCatalogNode(node: any): string | null {
  if (!node || typeof node !== 'object') return null;
  if (node.planId && typeof node.planId === 'string') return node.planId;
  for (const key of Object.keys(node)) {
    const id = getFirstPlanIdFromCatalogNode(node[key]);
    if (id) return id;
  }
  return null;
}

type CatalogPlanCombo = 'base' | 'plus' | 'starter' | 'plusStarter';

function extractCatalogComboEntry(target: any, combo: CatalogPlanCombo): { planId: string } | undefined {
  if (!target) return undefined;
  const entry = target[combo] ?? (combo === 'plusStarter' ? target.plus_starter : undefined);
  if (!entry || typeof entry !== 'object') return undefined;
  const planId = (entry as { planId?: string; plan_id?: string }).planId ?? (entry as { plan_id?: string }).plan_id;
  if (planId) return { planId: String(planId) };
  return undefined;
}

/**
 * Stripe catalog plan id for base tier (monthly then annual) — mirrors MembershipSignup.lookupCatalogEntry
 * so dog/cat get the correct Square plan name and pricing path.
 */
function getCatalogStripePlanIdForRoomLoader(
  catalog: SubscriptionPlanCatalog | null | undefined,
  planKey: string,
  species: 'dog' | 'cat' | null,
  cadence: 'monthly' | 'annual'
): string | null {
  if (!catalog || !planKey || typeof catalog !== 'object') return null;
  const planNode = (catalog as Record<string, unknown>)[planKey] as Record<string, unknown> | undefined;
  if (!planNode || typeof planNode !== 'object') return null;

  if (species && planNode[species] && typeof planNode[species] === 'object') {
    const speciesNode = planNode[species] as Record<string, unknown>;
    const cadenceNode = speciesNode[cadence] as Record<string, unknown> | undefined;
    const entry = extractCatalogComboEntry(cadenceNode, 'base');
    if (entry?.planId) return entry.planId;
  }

  const fallbackCadence = planNode[cadence] as Record<string, unknown> | undefined;
  if (fallbackCadence) {
    const entry = extractCatalogComboEntry(fallbackCadence, 'base');
    if (entry?.planId) return entry.planId;
  }

  return null;
}

function resolveSubscriptionPlanDisplayNameForSpecies(
  formatted: FormattedSubscriptionPlan[],
  catalog: SubscriptionPlanCatalog | null | undefined,
  planSlug: string,
  species: 'dog' | 'cat' | null
): string | undefined {
  if (!formatted?.length) return undefined;
  const byId = (id: string) => formatted.find((p) => p.planId === id)?.planName;

  if (species === 'dog' || species === 'cat') {
    const monthlyId = getCatalogStripePlanIdForRoomLoader(catalog, planSlug, species, 'monthly');
    if (monthlyId) {
      const n = byId(monthlyId);
      if (n) return n;
    }
    const annualId = getCatalogStripePlanIdForRoomLoader(catalog, planSlug, species, 'annual');
    if (annualId) {
      const n = byId(annualId);
      if (n) return n;
    }
    return undefined;
  }

  const sub =
    catalog && typeof catalog === 'object' ? (catalog as Record<string, unknown>)[planSlug] : undefined;
  const fallbackTreeId = sub != null ? getFirstPlanIdFromCatalogNode(sub) : null;
  if (fallbackTreeId) {
    const n = byId(fallbackTreeId);
    if (n) return n;
  }
  return undefined;
}

function normItemName(n: string): string {
  return (n ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

/** Line items for simulate: one pet's visit lines; store/tax only on first patient in list. */
function filterLineItemsForPatientSimulate<T extends { patientId?: number; category?: string }>(
  items: T[],
  patientId: number,
  firstPatientId: number
): T[] {
  return items.filter((li) => {
    if ((li as { category?: string }).category === 'membershipCredit') return false;
    if ((li as { category?: string }).category === 'store') return patientId === firstPatientId;
    const pid = (li as { patientId?: number }).patientId ?? 0;
    return pid === patientId;
  });
}

function patientHasMembershipFlag(p: any): boolean {
  const pat = p?.patient ?? p;
  const name = p?.membershipName ?? pat?.membershipName;
  return !!(p?.isMember ?? pat?.isMember ?? (name != null && String(name).trim() !== ''));
}

/**
 * True if this pet should be treated as already enrolled in membership for upsell UI.
 * Flags may live only on `appointments[].patient` while `patients[]` rows omit them; scan all appointments by patient id.
 */
function roomLoaderPatientHasMembership(p: any, appointments: any[] | undefined): boolean {
  if (patientHasMembershipFlag(p)) return true;
  if (!appointments?.length) return false;
  const pid = Number(p?.patientId ?? p?.patient?.id ?? p?.id);
  if (Number.isNaN(pid)) return false;
  for (const a of appointments) {
    const ap = a?.patient;
    if (!ap) continue;
    const aid = Number(ap.id ?? ap.patientId);
    if (Number.isNaN(aid) || aid !== pid) continue;
    if (patientHasMembershipFlag(ap)) return true;
  }
  return false;
}

/**
 * Non-member pet on the form with at least one other household pet (same `patients[]`) already a member — eligible for multi-pet upsell blurb and estimate adjustment.
 * Relies on API including member pets on the client (appointment or not).
 */
function roomLoaderPetEligibleForMultiPetMembershipUpsell(
  patient: any,
  allPatients: any[],
  appointments: any[] | undefined
): boolean {
  if (roomLoaderPatientHasMembership(patient, appointments)) return false;
  const pid = Number(patient?.patientId ?? patient?.patient?.id ?? patient?.id);
  if (Number.isNaN(pid)) return false;
  return allPatients.some((other: any) => {
    const oid = Number(other?.patientId ?? other?.patient?.id ?? other?.id);
    if (Number.isNaN(oid) || oid === pid) return false;
    return roomLoaderPatientHasMembership(other, appointments);
  });
}

/** Membership plan label for display (row or matched appointment `patient`). */
function getRoomLoaderMembershipDetailText(p: any, appointments: any[] | undefined): string | undefined {
  if (!roomLoaderPatientHasMembership(p, appointments)) return undefined;
  const pat = p?.patient ?? p;
  let name: string | null | undefined = p?.membershipName ?? pat?.membershipName;
  const pid = Number(p?.patientId ?? p?.patient?.id ?? p?.id);
  if ((!name || !String(name).trim()) && !Number.isNaN(pid) && appointments?.length) {
    for (const a of appointments) {
      const ap = a?.patient;
      if (!ap) continue;
      const aid = Number(ap.id ?? ap.patientId);
      if (aid !== pid) continue;
      const n = ap.membershipName;
      if (n != null && String(n).trim()) {
        name = n;
        break;
      }
    }
  }
  const s = name != null ? String(name).trim() : '';
  return s || undefined;
}

function RoomLoaderPatientMemberBadge({
  patient,
  appointments,
}: {
  patient: any;
  appointments: any[] | undefined;
}) {
  if (!roomLoaderPatientHasMembership(patient, appointments)) return null;
  const detail = getRoomLoaderMembershipDetailText(patient, appointments);
  return (
    <div
      style={{
        marginTop: '8px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: '#0f5132',
          backgroundColor: '#d1e7dd',
          border: '1px solid #badbcc',
          borderRadius: '999px',
          padding: '4px 10px',
        }}
      >
        Member
      </span>
      {detail ? (
        <span style={{ fontSize: '13px', color: '#555', lineHeight: 1.45 }}>{detail}</span>
      ) : null}
    </div>
  );
}

function getItemId(item: SearchableItem): number | undefined {
  return item.inventoryItem?.id ?? (item as any).procedure?.id ?? item.lab?.id;
}

type SummaryLineDisplayPricing =
  | CheckItemPricingResponse
  | { wellnessPlanPricing?: any; discountPricing?: any }
  | null;

/**
 * True when wellness/membership pricing should drive adjusted unit price or discount UI.
 * Membership discounts may apply with `hasCoverage: false` (e.g. `priceAdjustedByMembership`, `outOfPlanDiscountApplied`).
 */
function wellnessPlanHasDiscountSignal(wp: any): boolean {
  if (!wp) return false;
  if (wp.hasCoverage === true) return true;
  const o = wp.originalPrice != null ? Number(wp.originalPrice) : null;
  const a = wp.adjustedPrice != null ? Number(wp.adjustedPrice) : null;
  if (o != null && a != null && o !== a) return true;
  if (wp.priceAdjustedByMembership === true || wp.outOfPlanDiscountApplied === true) return true;
  if (wp.membershipDiscountAmount != null && Number(wp.membershipDiscountAmount) > 0) return true;
  return false;
}

/** Show strikethrough / discount note for summary and care-plan rows (wellness + client discount). */
function hasDiscountPricingNote(
  pricing: CheckItemPricingResponse | { wellnessPlanPricing?: any; discountPricing?: any } | null | undefined
): boolean {
  if (!pricing) return false;
  if (pricing.discountPricing?.priceAdjustedByDiscount) return true;
  return wellnessPlanHasDiscountSignal(pricing.wellnessPlanPricing);
}

/**
 * Package names read "Membership - Feline Golden - Annual". The celebration card already
 * says "member", so drop that prefix and the separator dashes to leave "Feline Golden
 * Annual". Only " - " with surrounding space is collapsed, so "Add-on" survives intact.
 */
function formatMembershipPlanLabel(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^\s*membership\s*[-–:]\s*/i, '')
    .replace(/\s+[-–]\s+/g, ' ')
    .trim();
  return cleaned || null;
}

/**
 * Summary line: avoid locking to stale `item.price` when the row only has employee `discountPricing`
 * (that bypassed check-item-pricing and hid membership pricing after enrollment). Prefer row
 * `wellnessPlanPricing.adjustedPrice` when coverage is already embedded; else prefer check-item-pricing
 * when the cache has a result; else fall back to embedded row price.
 */
function resolveSummaryLinePrice(
  patientId: number,
  displayRow: any,
  getClientPricing: (pid: number, si: SearchableItem | null) => CheckItemPricingResponse | null,
  getClientAdjustedPrice: (pid: number, si: SearchableItem | null) => number | null
): { unitPrice: number; displayPricing: SummaryLineDisplayPricing } {
  const searchableItem = displayRow?.searchableItem as SearchableItem | null | undefined;
  const wp = displayRow?.wellnessPlanPricing;
  if (
    wp &&
    wp.adjustedPrice != null &&
    !Number.isNaN(Number(wp.adjustedPrice)) &&
    wellnessPlanHasDiscountSignal(wp)
  ) {
    return {
      unitPrice: Number(wp.adjustedPrice),
      displayPricing: {
        wellnessPlanPricing: wp,
        discountPricing: displayRow.discountPricing,
      },
    };
  }

  const sid = searchableItem != null ? getItemId(searchableItem) : undefined;
  if (searchableItem != null && sid != null) {
    const cached = getClientPricing(patientId, searchableItem);
    if (cached != null) {
      const adjusted = getClientAdjustedPrice(patientId, searchableItem);
      if (adjusted != null) {
        return { unitPrice: adjusted, displayPricing: cached };
      }
    }
  }

  if (displayRow?.wellnessPlanPricing != null || displayRow?.discountPricing != null) {
    return {
      unitPrice: Number(displayRow.price) ?? 0,
      displayPricing: {
        wellnessPlanPricing: displayRow.wellnessPlanPricing ?? undefined,
        discountPricing: displayRow.discountPricing ?? undefined,
      },
    };
  }

  if (searchableItem != null) {
    return {
      unitPrice: getClientAdjustedPrice(patientId, searchableItem) ?? Number(displayRow.price) ?? 0,
      displayPricing: getClientPricing(patientId, searchableItem),
    };
  }

  return {
    unitPrice: Number(displayRow?.price) || 0,
    displayPricing: null,
  };
}

/** Extract code from a SearchableItem (procedure, lab, or inventory) for summaryForPdf. */
function getSearchItemCode(item: SearchableItem | null | undefined): string | undefined {
  if (!item) return undefined;
  return (item as any).lab?.code ?? (item as any).procedure?.code ?? (item as any).inventoryItem?.code ?? undefined;
}

/** Extract code from a display item (reminder/added/trip fee row) for summaryForPdf. */
function getCodeFromDisplayItem(item: any): string | undefined {
  if (!item) return undefined;
  return item.code ?? getSearchItemCode(item?.searchableItem) ?? undefined;
}

/**
 * Care-plan / summary line items use stable `_publicRecKeySuffix` (reminder id, added-item id, synthetic, etc.)
 * so `pet{n}_rec_*` does not drift when rows are regrouped or filtered and indices shift.
 */
function publicCarePlanRecKeySuffixFromRow(row: any, displayIndexFallback: number): string {
  const s = row?._publicRecKeySuffix;
  if (s != null && String(s) !== '') return String(s);
  return `i${displayIndexFallback}`;
}

function publicFormCarePlanRecKey(petIdx: number, row: any, displayIndexFallback: number): string {
  return `pet${petIdx}_rec_${publicCarePlanRecKeySuffixFromRow(row, displayIndexFallback)}`;
}

/** FormData key for client-adjusted quantity on summary (inventory medications from check-item-pricing). */
function publicFormSummaryMedicationQtyKey(petIdx: number, row: any, displayIndexFallback: number): string {
  return `pet${petIdx}_rec_medqty_${publicCarePlanRecKeySuffixFromRow(row, displayIndexFallback)}`;
}

/** Lowest quantity the client may choose: 1 if staff suggested more than one (they may reduce); otherwise staff amount. */
function publicMedicationQuantityClientMin(staffQty: number): number {
  const s = Math.max(1, Math.floor(staffQty));
  return s > 1 ? 1 : s;
}

/** True when public check-item-pricing returned an inventory catalog item flagged as medication. */
function checkItemPricingResponseIsMedicationInventory(pricing: CheckItemPricingResponse | null): boolean {
  if (!pricing?.item) return false;
  const itemType = String(pricing.item.itemType ?? '').toLowerCase();
  if (itemType !== 'inventory') return false;
  return (pricing.item.inventoryItem as { isMedication?: boolean } | undefined)?.isMedication === true;
}

/** Inventory care-plan row: allow client qty edit on summary when pricing response marks the catalog item as medication. */
function publicFormInventoryRowAllowsClientQuantityFromPricing(
  patientId: number,
  row: any,
  getClientPricing: (pid: number, si: SearchableItem | null) => CheckItemPricingResponse | null
): boolean {
  const t = (row?.type ?? row?.itemType ?? '').toString().toLowerCase();
  if (t !== 'inventory') return false;
  const si = row?.searchableItem as SearchableItem | null | undefined;
  if (!si) return false;
  return checkItemPricingResponseIsMedicationInventory(getClientPricing(patientId, si));
}

/** Effective line quantity for care-plan / summary / snapshot (client may adjust medication qty on summary within min/max). */
function effectivePublicMedicationInventoryQuantity(
  formData: Record<string, unknown>,
  petIdx: number,
  item: any,
  displayIndexFallback: number,
  patientId: number,
  getClientPricing: (pid: number, si: SearchableItem | null) => CheckItemPricingResponse | null
): number {
  const staffQty = Math.max(1, Math.floor(Number(item.quantity) || 1));
  if (!publicFormInventoryRowAllowsClientQuantityFromPricing(patientId, item, getClientPricing)) return staffQty;
  const key = publicFormSummaryMedicationQtyKey(petIdx, item, displayIndexFallback);
  if (!Object.prototype.hasOwnProperty.call(formData, key)) return staffQty;
  const v = Math.floor(Number(formData[key]));
  if (!Number.isFinite(v)) return staffQty;
  const minClient = publicMedicationQuantityClientMin(staffQty);
  return Math.max(minClient, Math.min(999, v));
}

/** Reads checkbox state; prefers stable key, then legacy index key for in-session migration. */
function publicFormCarePlanRecRowChecked(
  formData: Record<string, unknown>,
  petIdx: number,
  row: any,
  displayIndexFallback: number
): boolean {
  const sk = publicFormCarePlanRecKey(petIdx, row, displayIndexFallback);
  const lk = `pet${petIdx}_rec_${displayIndexFallback}`;
  let raw: unknown;
  if (Object.prototype.hasOwnProperty.call(formData, sk)) raw = formData[sk];
  else if (Object.prototype.hasOwnProperty.call(formData, lk)) raw = formData[lk];
  else raw = undefined;
  return raw !== false;
}

/** Build a SearchableItem from a row with id, name, price, itemType (for check-item-pricing lookup). */
function rowToSearchableItem(row: {
  id?: number | null;
  name?: string;
  price?: number | string | null;
  itemType?: string;
  type?: string;
  code?: string;
  categoryName?: string | null;
  isMedication?: boolean;
}): SearchableItem | null {
  const id = row.id;
  if (id == null) return null;
  const name = row.name ?? '';
  const price = row.price != null ? String(row.price) : '';
  const code = row.code;
  const itemType = (row.itemType ?? row.type ?? 'procedure').toString().toLowerCase();
  const entry = { id, name, price, code };
  const base: SearchableItem = {
    name,
    itemType: itemType === 'lab' ? 'lab' : itemType === 'inventory' ? 'inventory' : 'procedure',
  } as SearchableItem;
  if (itemType === 'lab') return { ...base, lab: entry } as SearchableItem;
  if (itemType === 'inventory') {
    const cn = row.categoryName != null && String(row.categoryName).trim() !== '' ? String(row.categoryName).trim() : null;
    const inventoryEntry = {
      ...entry,
      ...(cn ? { categoryName: cn } : {}),
      ...(row.isMedication === true ? { isMedication: true } : {}),
    };
    return { ...base, inventoryItem: inventoryEntry } as SearchableItem;
  }
  return { ...base, procedure: entry } as SearchableItem;
}

function publicFormNameHasPhrase(item: { name?: string }, phrase: string): boolean {
  return (item.name ?? '').toLowerCase().includes(phrase.toLowerCase());
}

/** Care-plan / pricing row is a sharps disposal line. */
function publicFormDisplayRowIsSharps(row: any): boolean {
  return publicFormNameHasPhrase(row, 'sharps');
}

/** Staff may add the disposal line more than once across reminders and added items. */
function dedupeSharpsRowsInPetLineItems(petItems: any[]): any[] {
  let keptSharps = false;
  const out: any[] = [];
  for (const row of petItems) {
    if (publicFormDisplayRowIsSharps(row)) {
      if (keptSharps) continue;
      keptSharps = true;
    }
    out.push(row);
  }
  return out;
}

/** Line items from API patient payload (reminders + added), excluding sharps/trip — used for pricing + sharps rules. */
function buildPublicPetLineItems(patient: any): any[] {
  const petItems: any[] = [];
  if (patient.reminders && Array.isArray(patient.reminders)) {
    patient.reminders.forEach((reminder: any) => {
      if (reminder.item) {
        const itemType = reminder.item?.type ?? reminder.itemType ?? 'procedure';
        const categoryName = reminder.item?.categoryName ?? reminder.item?.inventoryItem?.categoryName;
        const row: any = {
          name: reminder.item.name,
          price: reminder.item.price,
          quantity: reminder.quantity || 1,
          type: itemType,
          id: reminder.item?.id ?? reminder.item?.procedure?.id ?? reminder.item?.lab?.id ?? reminder.item?.inventoryItem?.id,
          itemType,
          code:
            reminder.item?.code ??
            reminder.item?.procedure?.code ??
            reminder.item?.lab?.code ??
            reminder.item?.inventoryItem?.code,
          categoryName,
        };
        if (reminder.wellnessPlanPricing) row.wellnessPlanPricing = reminder.wellnessPlanPricing;
        if (reminder.discountPricing) row.discountPricing = reminder.discountPricing;
        const invMed = reminder.item?.inventoryItem?.isMedication === true;
        row.searchableItem = rowToSearchableItem({
          id: row.id,
          name: row.name,
          price: row.price,
          itemType: row.itemType,
          code: row.code,
          categoryName,
          isMedication: invMed ? true : undefined,
        });
        const rid = reminder.reminderId;
        if (rid != null && String(rid) !== '') row._publicRecKeySuffix = `r${rid}`;
        petItems.push(row);
      } else {
        const text = (reminder.reminderText ?? reminder.description ?? '').toLowerCase();
        if (text.includes('visit') || text.includes('consult')) {
          const row: any = {
            name: reminder.reminderText ?? reminder.description ?? 'Visit/Consult',
            price: reminder.price ?? null,
            quantity: reminder.quantity ?? 1,
            type: reminder.itemType ?? 'procedure',
          };
          if (reminder.wellnessPlanPricing) row.wellnessPlanPricing = reminder.wellnessPlanPricing;
          if (reminder.discountPricing) row.discountPricing = reminder.discountPricing;
          const rid = reminder.reminderId;
          if (rid != null && String(rid) !== '') row._publicRecKeySuffix = `r${rid}`;
          petItems.push(row);
        }
      }
    });
  }
  if (patient.addedItems && Array.isArray(patient.addedItems)) {
    patient.addedItems.forEach((item: any) => {
      const itemType = item.itemType ?? item.type ?? 'procedure';
      const categoryName = item.categoryName ?? item.inventoryItem?.categoryName;
      const row: any = {
        name: item.name,
        price: item.price,
        quantity: item.quantity || 1,
        type: itemType,
        id: item.id ?? item.procedure?.id ?? item.lab?.id ?? item.inventoryItem?.id,
        itemType,
        code: item.code ?? item.procedure?.code ?? item.lab?.code ?? item.inventoryItem?.code,
        categoryName,
      };
      if (item.wellnessPlanPricing) row.wellnessPlanPricing = item.wellnessPlanPricing;
      if (item.discountPricing) row.discountPricing = item.discountPricing;
      const addedInvMed = item.inventoryItem?.isMedication === true;
      row.searchableItem = rowToSearchableItem({
        id: row.id,
        name: row.name,
        price: row.price,
        itemType: row.itemType,
        code: row.code,
        categoryName,
        isMedication: addedInvMed ? true : undefined,
      });
      const aid = item.id;
      if (aid != null && String(aid) !== '') row._publicRecKeySuffix = `a${aid}`;
      petItems.push(row);
    });
  }
  return petItems;
}

/** Lab work question: top-level form keys plus nested `patient.questions` from API. */
function publicFormPetLabWorkConcernYes(formData: Record<string, unknown>, petKey: string, patient: any): boolean {
  return (
    formData[`${petKey}_labWork`] === true ||
    formData[`${petKey}_labWork`] === 'yes' ||
    (patient as any)?.questions?.labWork === true
  );
}

/** Build item payload for public check-item-pricing from a SearchableItem. Passes the full item object (inventoryItem, lab, or procedure) like from search. */
function buildPricingItemPayload(item: SearchableItem | null | undefined): CheckItemPricingPublicRequest['item'] | null {
  if (!item) return null;
  const t = (item.itemType ?? '').toLowerCase();
  if (t === 'lab' && item.lab) return { lab: item.lab };
  if (t === 'procedure' && (item as any).procedure) return { procedure: (item as any).procedure };
  if (t === 'inventory' && item.inventoryItem) return { inventoryItem: item.inventoryItem };
  if (item.lab) return { lab: item.lab };
  if ((item as any).procedure) return { procedure: (item as any).procedure };
  if (item.inventoryItem) return { inventoryItem: item.inventoryItem };
  return null;
}

type RoomLoaderStoreFulfillment = 'visit' | 'ship';

type RoomLoaderStoreProduct = {
  id: string;
  name: string;
  price: number;
  /** How many of this item the client wants. Absent on rows saved before quantity existed. */
  quantity?: number;
  visitPrice?: number;
  shipPrice?: number;
  fulfillment?: RoomLoaderStoreFulfillment;
  sku?: string;
  listingId?: string;
  inventoryItemId?: number | null;
  procedureId?: number | null;
  catalogItemType?: 'inventory' | 'procedure';
  optionLabel?: string | null;
};

/** Quantity for a store row, tolerating older saved payloads that had none. */
function storeItemQty(item: RoomLoaderStoreProduct): number {
  const n = Math.floor(Number(item.quantity));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function storeQtyButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: '28px',
    height: '28px',
    padding: 0,
    fontSize: '16px',
    lineHeight: 1,
    fontWeight: 700,
    color: disabled ? '#adb5bd' : '#084298',
    background: '#fff',
    border: `1px solid ${disabled ? '#dee2e6' : '#b6d4fe'}`,
    borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

/** Two rows are the same product when the catalog row and fulfillment choice match. */
function sameStoreProduct(a: RoomLoaderStoreProduct, b: RoomLoaderStoreProduct): boolean {
  return a.id === b.id && (a.fulfillment ?? 'visit') === (b.fulfillment ?? 'visit');
}

/** Cache key for store additional-item rows (membership / discount pricing). */
function getStoreItemPricingCacheKey(patientId: number, product: RoomLoaderStoreProduct, index: number): string {
  return `p${patientId}-store-${String(product.id)}-${index}`;
}

function pickAdjustedUnitPriceFromCheckResponse(pricing: CheckItemPricingResponse | null): number | null {
  if (!pricing) return null;
  const wp = pricing.wellnessPlanPricing as any;
  if (
    wp &&
    wp.adjustedPrice != null &&
    !Number.isNaN(Number(wp.adjustedPrice)) &&
    wellnessPlanHasDiscountSignal(wp)
  ) {
    return Number(wp.adjustedPrice);
  }
  if (pricing.adjustedPrice != null) return Number(pricing.adjustedPrice);
  return null;
}

/** One row in the store option modal: label, price, and the item to add. */
type StoreModalRow = { key: string; label: string; price: number; item: RoomLoaderStoreProduct };

function variantLabel(listing: StoreListing, variant: StoreVariant, idx: number): string {
  const option = String(variant.optionLabel ?? '').trim();
  if (option) return option;
  const parts = [variant.strength, variant.pack]
    .map((p) => String(p ?? '').trim())
    .filter((p) => p && p !== listing.name);
  if (parts.length) return parts.join(' · ');
  const name = String(variant.name ?? '').trim();
  if (name) return name;
  return variant.code || `Option ${idx + 1}`;
}

function listingUnitPrice(listing: StoreListing, variant?: StoreVariant | null): number {
  const n = Number(variant?.onlineStorePrice ?? listing.priceFrom ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type CatalogPriceMap = Map<string, number>;

function catalogPriceKey(itemType: string | undefined, id: number | null | undefined): string | null {
  if (id == null || !Number.isFinite(Number(id))) return null;
  return `${itemType || 'inventory'}:${Number(id)}`;
}

function listingVisitPrice(
  listing: StoreListing,
  variant: StoreVariant | null | undefined,
  catalogPrices?: CatalogPriceMap
): number {
  const itemType = variant?.catalogItemType ?? (variant?.procedureId ? 'procedure' : 'inventory');
  const id = variant?.inventoryItemId ?? variant?.procedureId ?? null;
  const key = catalogPriceKey(itemType, id);
  const fromCatalog =
    key && catalogPrices
      ? catalogPrices.get(key) ?? catalogPrices.get(`id:${Number(id)}`)
      : undefined;
  if (fromCatalog != null && Number.isFinite(fromCatalog) && fromCatalog > 0) return fromCatalog;
  const n = Number(variant?.onlineStorePrice ?? listing.priceFrom ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isCatalogOnlyListing(listing: StoreListing): boolean {
  return String(listing.listingId || '').startsWith('catalog-');
}

function listingToStoreProduct(
  listing: StoreListing,
  variant: StoreVariant | null,
  idx: number,
  fulfillment: RoomLoaderStoreFulfillment = 'visit',
  catalogPrices?: CatalogPriceMap
): RoomLoaderStoreProduct {
  const label = variant ? variantLabel(listing, variant, idx) : listing.name;
  const shipPrice = listingUnitPrice(listing, variant);
  const visitPrice = listingVisitPrice(listing, variant, catalogPrices);
  return {
    id: `${listing.listingId}-${variant?.inventoryItemId ?? variant?.procedureId ?? idx}-${fulfillment}`,
    name: listing.name,
    price: fulfillment === 'ship' ? shipPrice : visitPrice,
    visitPrice,
    shipPrice,
    fulfillment,
    sku: variant?.code ?? undefined,
    listingId: listing.listingId,
    inventoryItemId: variant?.inventoryItemId ?? null,
    procedureId: variant?.procedureId ?? null,
    catalogItemType: variant?.catalogItemType ?? (variant?.procedureId ? 'procedure' : 'inventory'),
    optionLabel: label,
  };
}

function listingVariants(listing: StoreListing): StoreVariant[] {
  if (listing.variants?.length) return listing.variants;
  return [
    {
      inventoryItemId: listing.imageInventoryItemId,
      name: listing.name,
      code: null,
      onlineStorePrice: listing.priceFrom,
      strength: null,
      pack: '',
      optionLabel: listing.name,
    },
  ];
}

function listingMinPrice(listing: StoreListing, catalogPrices?: CatalogPriceMap): number {
  const prices = listingVariants(listing).flatMap((v) => {
    const visit = listingVisitPrice(listing, v, catalogPrices);
    const ship = listingUnitPrice(listing, v);
    return [visit, ship].filter((n) => Number.isFinite(n) && n > 0);
  });
  return prices.length ? Math.min(...prices) : Number(listing.priceFrom ?? 0) || 0;
}

/** Build modal rows from Scout store listings (one row per variant × fulfillment). */
function getStoreModalRows(listings: StoreListing[], catalogPrices?: CatalogPriceMap): StoreModalRow[] {
  const rows: StoreModalRow[] = [];
  listings.forEach((listing) => {
    listingVariants(listing).forEach((variant, idx) => {
      const visitItem = listingToStoreProduct(listing, variant, idx, 'visit', catalogPrices);
      const shipItem = listingToStoreProduct(listing, variant, idx, 'ship', catalogPrices);
      const option = visitItem.optionLabel || listing.name;
      const optionPrefix = option && option !== listing.name ? `${option} — ` : '';
      rows.push({
        key: `${visitItem.id}-visit`,
        label: `${optionPrefix}Bring to the visit`,
        price: visitItem.price,
        item: visitItem,
      });
      const shipAvailable =
        Number(variant.onlineStorePrice) > 0 ||
        (!isCatalogOnlyListing(listing) && shipItem.price > 0);
      if (shipAvailable) {
        rows.push({
          key: `${shipItem.id}-ship`,
          label: `${optionPrefix}Ship to me`,
          price: shipItem.price,
          item: shipItem,
        });
      }
    });
  });
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = `${row.label}\t${row.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.price - b.price);
}

function storeListingSearchText(listing: StoreListing): string {
  return [
    listing.name,
    listing.storeCategory,
    ...listingVariants(listing).flatMap((v) => [v.name, v.code, v.optionLabel, v.strength, v.pack]),
  ]
    .filter(Boolean)
    .join(' ');
}

function indexCatalogPrices(items: SearchableItem[]): CatalogPriceMap {
  const map: CatalogPriceMap = new Map();
  for (const item of items) {
    const id = getItemId(item);
    const price = getSearchItemPrice(item);
    if (id == null || price == null || !Number.isFinite(price)) continue;
    const type = (item.itemType ?? 'inventory').toString();
    map.set(`${type}:${id}`, price);
    map.set(`id:${id}`, price);
  }
  return map;
}

/** Catalog list price: Lab = price; Procedure = price + serviceFee; Inventory = max(minimum, price + serviceFee). */
function getSearchItemPrice(item: SearchableItem | null | undefined): number | null {
  if (!item) return null;
  const computed = getPreDiscountForOneUnit(item);
  if (Number.isFinite(computed)) {
    const hasCatalogField =
      item.price != null ||
      item.inventoryItem?.price != null ||
      (item as any).lab?.price != null ||
      (item as any).procedure?.price != null;
    if (hasCatalogField || computed > 0) return computed;
  }
  const raw =
    (item as any).price ??
    item.inventoryItem?.price ??
    (item as any).lab?.price ??
    (item as any).procedure?.price ??
    item.wellnessPlanPricing?.adjustedPrice ??
    item.wellnessPlanPricing?.originalPrice;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * Fuzzy score for search: how well `text` matches `query` (0 = no match, 1 = exact).
 * Used to sort store search results when the query is a partial name.
 */
function fuzzyScoreQuery(query: string, text: string): number {
  const q = (query || '').trim().toLowerCase();
  const t = (text || '').trim().toLowerCase();
  if (!q) return 1;
  if (!t) return 0;
  if (t.includes(q)) return 1;
  const qWords = q.split(/\s+/).filter(Boolean);
  const wordsFound = qWords.filter((w) => t.includes(w)).length;
  if (wordsFound === qWords.length) return 0.9;
  if (wordsFound > 0) {
    const wordScore = (wordsFound / qWords.length) * 0.7;
    let rest = t;
    const subsequence = [...q].every((c) => {
      const i = rest.indexOf(c);
      if (i === -1) return false;
      rest = rest.slice(i + 1);
      return true;
    });
    return wordScore + (subsequence ? 0.15 : 0);
  }
  let idx = 0;
  for (const c of q) {
    const i = t.indexOf(c, idx);
    if (i === -1) return 0;
    idx = i + 1;
  }
  return 0.3;
}

/** Patient id on a root-level `ReminderWithPrice` row from the room-loader API. */
function rootReminderPatientId(rwp: any): number | null {
  const p = rwp?.reminder?.patient ?? rwp?.patient;
  const raw = p?.id ?? rwp?.reminder?.patientId ?? rwp?.patientId;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * Cat vs dog from joined species labels (already lowercased is fine).
 * Word boundaries avoid false positives: "cat" inside Catahoula, cathy@…, application, etc.
 */
function isCatSpeciesTokens(speciesJoinedLower: string): boolean {
  const t = speciesJoinedLower.trim().toLowerCase();
  if (!t) return false;
  return /\b(cat|cats|feline|felines|kitten|kittens)\b/.test(t);
}

const PDF_MARGIN = 0.5;
const PDF_PAGE_WIDTH = 8.5;
const PDF_PAGE_HEIGHT = 11;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const LINE_HEIGHT = 0.2;
const FONT_SIZE = 10;
const FONT_SIZE_SECTION = 11;
const FONT_SIZE_TITLE = 18;
const COLOR_DARK: [number, number, number] = [33, 37, 41];   // #212529
const COLOR_MUTED: [number, number, number] = [73, 80, 87];  // #495057
const COLOR_LINE: [number, number, number] = [222, 226, 230]; // #dee2e6
const COLOR_HEADER_BG: [number, number, number] = [248, 249, 250]; // #f8f9fa

type PdfOptions = { logoDataUrl?: string; practiceName?: string; logoWidth?: number; logoHeight?: number };

/** Build a jsPDF from responseFromClient (formAnswersForPdf + summaryForPdf) for completed room-loader view. */
function buildRoomLoaderPdf(responseFromClient: any, options?: PdfOptions): jsPDF {
  const doc = new jsPDF('portrait', 'in', 'letter');
  doc.setProperties({ title: 'Pre-Visit Check-In' });
  const practiceName = options?.practiceName ?? 'Vet At Your Door';
  let y = PDF_MARGIN;

  const pushY = (dy: number) => {
    y += dy;
    if (y > PDF_PAGE_HEIGHT - PDF_MARGIN - 0.4) {
      doc.addPage();
      y = PDF_MARGIN;
      drawHeader();
    }
  };

  const drawHeader = () => {
    const maxLogoW = 1.65;
    const maxLogoH = 0.65;
    const LOGO_DPI = 96; // pixels per inch for natural dimensions
    let logoW = maxLogoW;
    let logoH = maxLogoH;
    const natW = options?.logoWidth;
    const natH = options?.logoHeight;
    if (natW != null && natH != null && natW > 0 && natH > 0) {
      const natWIn = natW / LOGO_DPI;
      const natHIn = natH / LOGO_DPI;
      const scale = Math.min(maxLogoW / natWIn, maxLogoH / natHIn, 1);
      logoW = natWIn * scale;
      logoH = natHIn * scale;
    }
    const headerBottom = y + maxLogoH + 0.35;
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(0, 0, PDF_PAGE_WIDTH, headerBottom, 'F');
    const hasLogo = !!options?.logoDataUrl;
    if (hasLogo) {
      try {
        doc.addImage(options!.logoDataUrl!, 'JPEG', PDF_MARGIN, y, logoW, logoH);
      } catch {
        try {
          doc.addImage(options!.logoDataUrl!, 'PNG', PDF_MARGIN, y, logoW, logoH);
        } catch {
          /* ignore */
        }
      }
    }
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(hasLogo ? 14 : 18);
    doc.text(practiceName, hasLogo ? PDF_MARGIN + logoW + 0.2 : PDF_MARGIN, y + maxLogoH / 2 + (hasLogo ? 0.06 : 0.1));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text('Pre-Visit Check-In', hasLogo ? PDF_MARGIN + logoW + 0.2 : PDF_MARGIN, y + maxLogoH / 2 + (hasLogo ? 0.2 : 0.22));
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    doc.setFontSize(FONT_SIZE);
    y += maxLogoH + 0.28;
    doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
    doc.setLineWidth(0.012);
    doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
    pushY(0.28);
  };

  drawHeader();

  const addPageTitle = (title: string) => {
    pushY(0.12);
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT_SIZE_TITLE);
    const lines = doc.splitTextToSize(title, PDF_CONTENT_WIDTH);
    doc.text(lines, PDF_MARGIN, y);
    pushY(lines.length * 0.24 + 0.1);
    doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
    doc.setLineWidth(0.018);
    doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
    pushY(0.22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE);
  };

  const addSectionLabel = (label: string) => {
    pushY(0.06);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT_SIZE_SECTION);
    doc.text(label, PDF_MARGIN, y);
    pushY(0.22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(FONT_SIZE);
    doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
  };

  const formAnswers = responseFromClient?.formAnswersForPdf?.pages;
  if (Array.isArray(formAnswers)) {
    for (const page of formAnswers) {
      if (page.title) addPageTitle(page.title);
      const sections = page.sections ?? [];
      for (const sec of sections) {
        if (sec.sectionLabel) addSectionLabel(sec.sectionLabel);
        const questions = sec.questions ?? [];
        for (const qa of questions) {
          if (qa.question) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
            const qLines = doc.splitTextToSize(qa.question, PDF_CONTENT_WIDTH);
            doc.text(qLines, PDF_MARGIN, y);
            pushY(qLines.length * LINE_HEIGHT + 0.04);
          }
          const ans = qa.answerLabel != null ? String(qa.answerLabel) : (qa.answer != null ? String(qa.answer) : '—');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(FONT_SIZE);
          doc.setTextColor(COLOR_DARK[0], COLOR_DARK[1], COLOR_DARK[2]);
          const aLines = doc.splitTextToSize(ans || '—', PDF_CONTENT_WIDTH - 0.25);
          doc.text(aLines, PDF_MARGIN + 0.25, y);
          pushY(aLines.length * LINE_HEIGHT + 0.14);
        }
        pushY(0.1);
      }
      pushY(0.15);
    }
  }

  const summary = responseFromClient?.summaryForPdf;
  if (summary) {
    if (summary.title) addPageTitle(summary.title);
    const pets = summary.pets ?? [];
    for (const pet of pets) {
      pushY(0.1);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(FONT_SIZE_SECTION);
      doc.text(pet.patientName ?? 'Pet', PDF_MARGIN, y);
      pushY(LINE_HEIGHT + 0.08);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_SIZE);
      const rows = pet.rows ?? [];
      for (const row of rows) {
        const label = row.crossedOut ? `(declined) ${row.name}` : row.name;
        const amt = row.lineTotal != null ? `$${Number(row.lineTotal).toFixed(2)}` : '';
        const leftLines = doc.splitTextToSize(label, PDF_CONTENT_WIDTH - 1.2);
        doc.text(leftLines, PDF_MARGIN, y);
        if (amt) doc.text(amt, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(amt), y);
        pushY(Math.max(leftLines.length * LINE_HEIGHT, LINE_HEIGHT) + 0.02);
      }
      if (pet.subtotal != null) {
        const subStr = `Subtotal: $${Number(pet.subtotal).toFixed(2)}`;
        doc.setFont('helvetica', 'bold');
        doc.text(subStr, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(subStr), y);
        pushY(LINE_HEIGHT + 0.1);
        doc.setFont('helvetica', 'normal');
      }
    }
    const addItems = summary.additionalItems;
    if (addItems?.label) {
      addSectionLabel(addItems.label);
      if (Array.isArray(addItems?.items)) {
        for (const it of addItems.items) {
          const line = `${it.name} (qty ${it.quantity ?? 1})`;
          const amt = `$${Number(it.price || 0).toFixed(2)}`;
          doc.text(line, PDF_MARGIN, y);
          doc.text(amt, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(amt), y);
          pushY(LINE_HEIGHT + 0.02);
        }
      }
      if (addItems?.subtotal != null) {
        const s = `Subtotal: $${Number(addItems.subtotal).toFixed(2)}`;
        doc.text(s, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(s), y);
        pushY(LINE_HEIGHT);
      }
      if (addItems?.taxLabel && addItems?.tax != null) {
        const t = `${addItems.taxLabel}: $${Number(addItems.tax).toFixed(2)}`;
        doc.text(t, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(t), y);
        pushY(LINE_HEIGHT);
      }
    }
    pushY(0.1);
    if (summary.grandTotal != null) {
      doc.setDrawColor(COLOR_LINE[0], COLOR_LINE[1], COLOR_LINE[2]);
      doc.setLineWidth(0.012);
      doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
      pushY(0.15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      const totalStr = `Estimated Total Due At Visit: $${Number(summary.grandTotal).toFixed(2)}`;
      doc.text(totalStr, PDF_PAGE_WIDTH - PDF_MARGIN - doc.getTextWidth(totalStr), y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FONT_SIZE);
    }
  }

  return doc;
}

/**
 * Maps saved `currentPage` from the older layout (one combined check-in, one combined labs)
 * to the current layout (one check-in page and one labs page per pet). Only applies when N ≥ 2.
 */
function migrateSavedRoomLoaderCurrentPage(oldPage: number, patientCount: number): number {
  const n = patientCount;
  if (n <= 1) return oldPage;
  const oldLabs = n + 2;
  const oldSummary = n + 3;
  if (oldPage === 1) return 1;
  if (oldPage >= 2 && oldPage <= n + 1) return n + oldPage - 1;
  if (oldPage === oldLabs) return 2 * n + 1;
  if (oldPage === oldSummary) return 3 * n + 1;
  return oldPage;
}

export default function PublicRoomLoaderForm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const dataRef = useRef<any>(null);
  dataRef.current = data;
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [treatmentHistoryByPatientId, setTreatmentHistoryByPatientId] = useState<Record<number, TreatmentWithItems[]>>({});
  /** After history has been fetched for a patient id (public API). Until true, optional vaccine UI that depends on history stays hidden to avoid flash (empty history briefly looks like "never had" vaccines). */
  const [treatmentHistoryReadyByPatientId, setTreatmentHistoryReadyByPatientId] = useState<Record<number, boolean>>({});
  /** The practice's Room Loader configuration; every lab, add-on and pitch on this form comes from it. */
  const [roomLoaderConfig, setRoomLoaderConfig] = useState<RoomLoaderConfig>(() =>
    resolveRoomLoaderConfig(undefined)
  );
  /** Active chronic prescriptions per patient id, as sent on the payload. */
  const [chronicMedsByPatient, setChronicMedsByPatient] = useState<Record<string, ChronicMed[]>>({});
  /** Catalog rows for every configured item, keyed `${itemType}:${itemId}`, so rows can be priced. */
  const [configCatalogItems, setConfigCatalogItems] = useState<Record<string, SearchableItem>>({});
  /** Client-adjusted pricing (discounts/membership) for labs and vaccines. Key: `${patientId}-${itemType}-${itemId}`. */
  const [clientPricingCache, setClientPricingCache] = useState<Record<string, CheckItemPricingResponse | null>>({});
  /** Bumped after room-loader refetch (e.g. post-enrollment) so check-item-pricing effect always re-runs. */
  const [pricingRefreshKey, setPricingRefreshKey] = useState(0);
  /** Scout store search on Summary page. */
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [storeSearchResults, setStoreSearchResults] = useState<StoreListing[]>([]);
  const [storeSearchLoading, setStoreSearchLoading] = useState(false);
  const [storeSearchError, setStoreSearchError] = useState<string | null>(null);
  const [storeCatalog, setStoreCatalog] = useState<StoreListing[] | null>(null);
  const [storeCatalogPrices, setStoreCatalogPrices] = useState<CatalogPriceMap>(new Map());
  /** Store items added by client on Summary page (for subtotal + 5.5% tax). */
  const [storeAdditionalItems, setStoreAdditionalItems] = useState<RoomLoaderStoreProduct[]>([]);
  /** Index of row to play a short “just added” animation (set only from Add, not on restore). */
  const [storeItemJustAddedIndex, setStoreItemJustAddedIndex] = useState<number | null>(null);
  /** When set, show modal to pick a variation of this product (same name, different options/SKU). */
  const [storeOptionModalGroup, setStoreOptionModalGroup] = useState<StoreListing[] | null>(null);
  /** True when form was already submitted (client or admin viewing); show read-only or PDF view. */
  const [formAlreadySubmitted, setFormAlreadySubmitted] = useState(false);
  /** When submitStatus === 'completed', we show PDF view; this is the blob URL for the generated PDF. */
  /** Inline validation errors keyed by form field (e.g. pet0_outdoorAccess). Shown below the field instead of alert. */
  const [fieldValidationErrors, setFieldValidationErrors] = useState<Record<string, string>>({});
  /** Per-pet membership simulate (recommended plan) when recommendation panel is open. */
  const [membershipPanelByPatientId, setMembershipPanelByPatientId] = useState<
    Record<number, MembershipPanelSimulateEntry>
  >({});
  const [membershipPanelLoading, setMembershipPanelLoading] = useState(false);
  /**
   * Session-only: enrollment order and which pets receive the $75 multi-pet credit on the summary after signing up
   * (second+ enrollment in this session, or first enrollment while another pet on the form was already a member).
   */
  const [roomLoaderSessionMembership, setRoomLoaderSessionMembership] = useState<{
    enrollmentOrder: number[];
    multiPetCreditPatientIds: Record<number, true>;
  }>({ enrollmentOrder: [], multiPetCreditPatientIds: {} });
  /** Collapsible "Expand to see how membership could change your bill" section on summary (only for non-members). */
  const [membershipBillSectionExpanded, setMembershipBillSectionExpanded] = useState(false);
  /** Public membership enrollment modal (same flow as appointment request form). */
  const [showMembershipEnrollmentModal, setShowMembershipEnrollmentModal] = useState(false);
  /** Formatted subscription plans (for membership comparison plan names); same source as Client Portal signup. */
  const [formattedSubscriptionPlans, setFormattedSubscriptionPlans] = useState<FormattedSubscriptionPlan[]>([]);
  const [subscriptionPlanCatalog, setSubscriptionPlanCatalog] = useState<SubscriptionPlanCatalog | null>(null);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [currentPage]);

  useEffect(() => {
    const tokenValue = token;
    if (!tokenValue) {
      setError('Missing token parameter');
      setLoading(false);
      return;
    }
    const safeToken = tokenValue as string;

    async function fetchRoomLoaderData() {
      try {
        setLoading(true);
        setError(null);
        const { data: responseData } = await http.get(
          `/public/room-loader/form?token=${encodeURIComponent(safeToken)}`
        );
        setData(responseData);
        setRoomLoaderConfig(resolveRoomLoaderConfig(responseData?.config));
        setChronicMedsByPatient(normalizeChronicMedsByPatient(responseData?.chronicMedsByPatient));

        // Backend stores submit body in response_from_client; mapper may expose as responseFromClient or savedForm
        const rawSaved = responseData?.responseFromClient ?? responseData?.savedForm ?? responseData?.sentToClient ?? null;
        const savedForm = rawSaved && typeof rawSaved === 'object' && rawSaved.formData != null
          ? rawSaved.formData
          : rawSaved;

        // Initialize form data: defaults first, then overlay saved form (excluding nested keys we restore to separate state)
        if (responseData?.patients) {
          const initialFormData: Record<string, any> = {};
          const appts = responseData.appointments || [];
          responseData.patients.forEach((patient: any, idx: number) => {
            const petKey = `pet${idx}`;
            // Do not pre-fill "Do you want to share any additional details about the reason for this visit?"
            initialFormData[`${petKey}_appointmentReason`] = '';
            initialFormData[`${petKey}_generalWellbeing`] = '';
            initialFormData[`${petKey}_eatingDrinkingNormal`] = '';
            initialFormData[`${petKey}_eatingDrinkingNormalDetails`] = '';
            initialFormData[`${petKey}_outdoorAccess`] = '';
            initialFormData[`${petKey}_specificConcerns`] = '';
            initialFormData[`${petKey}_newPatientBehavior`] = '';
            initialFormData[`${petKey}_feeding`] = '';
            initialFormData[`${petKey}_foodAllergies`] = '';
            initialFormData[`${petKey}_foodAllergiesDetails`] = '';
            initialFormData[`${petKey}_carePlanLooksRight`] = '';
            initialFormData[`${petKey}_labWork`] = '';
          });
          initialFormData['anythingElseNotes'] = '';
          initialFormData['additionalItemsRequest'] = '';
          if (savedForm && typeof savedForm === 'object') {
            const {
              optedInVaccineItems: _ovi,
              storeAdditionalItems: _sai,
              currentPage: _cp,
              remindersByPet: _rbp,
              totals: _tot,
              labSelections: _lab,
              commonlySelectedItems: savedCommon,
              ...savedInputs
            } = savedForm;
            const mergedFormData = { ...initialFormData, ...savedInputs };
            if (savedCommon && typeof savedCommon === 'object') {
              Object.entries(savedCommon).forEach(([k, v]) => {
                mergedFormData[k] = v;
              });
            }
            setFormData(mergedFormData);
          } else {
            setFormData(initialFormData);
          }
        }

        // Restore store additional items from saved formData
        if (savedForm?.storeAdditionalItems && Array.isArray(savedForm.storeAdditionalItems)) {
          setStoreAdditionalItems(
            savedForm.storeAdditionalItems.map((item: any) => ({
              id: String(item.id ?? item.listingId ?? item.sku ?? item.name ?? ''),
              name: item.name ?? '',
              price: Number(item.price ?? 0),
              visitPrice: item.visitPrice != null ? Number(item.visitPrice) : undefined,
              shipPrice: item.shipPrice != null ? Number(item.shipPrice) : undefined,
              fulfillment: item.fulfillment === 'ship' ? 'ship' : item.fulfillment === 'visit' ? 'visit' : undefined,
              sku: item.sku ?? item.code,
              listingId: item.listingId,
              inventoryItemId: item.inventoryItemId ?? null,
              procedureId: item.procedureId ?? null,
              catalogItemType: item.catalogItemType,
              optionLabel: item.optionLabel,
            }))
          );
        }

        // Restore current page (e.g. summary) so user returns to where they left off
        if (typeof savedForm?.currentPage === 'number' && savedForm.currentPage >= 1) {
          const n = (responseData?.patients ?? []).length;
          let restored = migrateSavedRoomLoaderCurrentPage(savedForm.currentPage, n);
          const maxPage = n > 0 ? 3 * n + 1 : 1;
          if (restored > maxPage) restored = maxPage;
          if (restored < 1) restored = 1;
          setCurrentPage(restored);
        }

        // When API returns submitStatus === 'completed', form was submitted — show PDF view (and read-only)
        if (responseData?.submitStatus === 'completed') {
          setFormAlreadySubmitted(true);
        } else if (savedForm && typeof savedForm === 'object') {
          const hasSubmitPayload =
            savedForm.summaryForPdf != null ||
            (Array.isArray(savedForm.summaryLineItems) && savedForm.summaryLineItems.length > 0);
          if (hasSubmitPayload) setFormAlreadySubmitted(true);
        }

      } catch (err: any) {
        console.error('Error fetching room loader form data:', err);
        setError(err?.response?.data?.message || err?.message || 'Failed to load room loader form');
      } finally {
        setLoading(false);
      }
    }

    fetchRoomLoaderData();
  }, [token]);

  // Fetch formatted subscription plans and catalog when at least one pet may see membership upsell (same source as Client Portal for plan names/display)
  useEffect(() => {
    const hasPatients = Array.isArray(data?.patients) && data.patients.length > 0;
    if (!hasPatients) return;
    const anyPetWithoutMembership = data.patients.some(
      (p: any) => !roomLoaderPatientHasMembership(p, data?.appointments)
    );
    if (!anyPetWithoutMembership) return;
    let alive = true;
    Promise.all([fetchFormattedSubscriptionPlans(), fetchSubscriptionPlanCatalog()])
      .then(([formatted, catalog]) => {
        if (!alive) return;
        setFormattedSubscriptionPlans(Array.isArray(formatted) ? formatted : []);
        setSubscriptionPlanCatalog(catalog && typeof catalog === 'object' ? catalog : null);
      })
      .catch(() => {
        if (!alive) return;
        setFormattedSubscriptionPlans([]);
        setSubscriptionPlanCatalog(null);
      });
    return () => {
      alive = false;
    };
  }, [data?.patients, data?.appointments]);

  // Resolve plan display name from formatted plans / catalog (same logic as MembershipSignup)
  const membershipPlanDisplayName = useMemo(() => {
    const map: Record<string, string> = {};
    const formatted = formattedSubscriptionPlans;
    const catalog = subscriptionPlanCatalog;
    if (!formatted.length) return map;
    const byPlanId = (id: string) => formatted.find((p) => p.planId === id)?.planName;
    if (catalog && typeof catalog === 'object') {
      for (const slug of Object.keys(catalog)) {
        const planId = getFirstPlanIdFromCatalogNode(catalog[slug]);
        if (planId) {
          const name = byPlanId(planId);
          if (name) map[slug] = name;
        }
      }
    }
    formatted.forEach((p) => {
      if (p.planId && p.planName) map[p.planId] = p.planName;
    });
    return map;
  }, [formattedSubscriptionPlans, subscriptionPlanCatalog]);

  // Build plans per pet using same logic as Client Portal: Golden only for 9+, Plus always, Puppy/Kitten when age <= 1.5
  const availablePlansForPetsForDisplay = useMemo((): RoomLoaderPlansForPetForDisplay[] => {
    if (!data?.patients?.length) return [];
    return data.patients.map((p: any, idx: number) => {
      if (roomLoaderPatientHasMembership(p, data?.appointments)) return null;
      const patientId = p.patientId ?? p.patient?.id ?? p.id;
      if (patientId == null) return null;
      const patientName = p.patientName ?? p.patient?.name ?? p.name ?? 'Pet';
      const apptPatient = getAppointmentPatientForRoomLoaderPet(data?.appointments, p, idx);
      const petDetails = getPetDetailsForMembership(p, apptPatient);
      const goldenPlans = data?.membershipAges?.plans ?? null;
      const meetsGolden = petDetails.kind != null && petMeetsGoldenAge(petDetails.ageYears, goldenPlans, petDetails.kind);
      const planIds = getPlanIdsForPet(petDetails, goldenPlans);
      const plans: RoomLoaderPlanForDisplay[] = planIds.map((planId) => {
        const details = getMembershipPlanCardDetails(planId);
        const speciesResolved = resolveSubscriptionPlanDisplayNameForSpecies(
          formattedSubscriptionPlans,
          subscriptionPlanCatalog,
          planId,
          petDetails.kind
        );
        return {
          planId,
          planName: speciesResolved ?? details?.name ?? planId,
          tagLine: details?.tagLine ?? '',
        };
      });
      return {
        patientId: Number(patientId),
        patientName,
        plans,
        membershipSpeciesKind: petDetails.kind,
        meetsGolden,
      };
    }).filter((x: RoomLoaderPlansForPetForDisplay | null): x is RoomLoaderPlansForPetForDisplay => x != null);
  }, [data?.patients, data?.appointments, formattedSubscriptionPlans, subscriptionPlanCatalog]);

  /** Pets eligible for in-flow membership enrollment (same modal as appointment request). */
  const roomLoaderMembershipEligiblePets = useMemo((): MembershipEnrollmentEligiblePet[] => {
    if (!data?.patients?.length) return [];
    return data.patients
      .filter((p: any) => !roomLoaderPatientHasMembership(p, data?.appointments))
      .map((p: any, idx: number) => {
        const apptPatient = getAppointmentPatientForRoomLoaderPet(data?.appointments, p, idx);
        return {
          id: String(p.patientId ?? p.patient?.id ?? p.id),
          name: p.patientName ?? p.patient?.name ?? p.name ?? 'Pet',
          species: membershipSpeciesPrimaryLabel(p, apptPatient ? [apptPatient] : undefined),
          isBackendPet: true,
        };
      });
  }, [data?.patients, data?.appointments]);

  /**
   * Pets the client enrolled during this form session, in enrollment order. Drives the
   * congratulations card that replaces the pitch once they come back from checkout.
   */
  const justEnrolledPets = useMemo((): Array<{ patientId: number; name: string; planName: string | null }> => {
    const order = roomLoaderSessionMembership.enrollmentOrder;
    if (order.length === 0 || !data?.patients?.length) return [];
    return order.map((pid) => {
      const row = data.patients.find(
        (p: any) => Number(p.patientId ?? p.patient?.id ?? p.id) === pid
      );
      const name = row?.patientName ?? row?.patient?.name ?? row?.name ?? 'Your pet';
      const planName = getRoomLoaderMembershipDetailText(row, data?.appointments);
      return { patientId: pid, name: String(name), planName: planName ?? null };
    });
  }, [roomLoaderSessionMembership.enrollmentOrder, data?.patients, data?.appointments]);

  /** Close membership bill explainer when no pets remain eligible for upsell (e.g. after enrollment refetch). */
  useEffect(() => {
    if (availablePlansForPetsForDisplay.length === 0) {
      setMembershipBillSectionExpanded(false);
      setMembershipPanelByPatientId({});
    }
  }, [availablePlansForPetsForDisplay.length]);

  useEffect(() => {
    /** Keep modal open for multi-pet households after first enrollment; only close when no pets remain eligible. */
    if (roomLoaderMembershipEligiblePets.length === 0) setShowMembershipEnrollmentModal(false);
  }, [roomLoaderMembershipEligiblePets.length]);

  /** Same membership resolution as upsell lists (row + matched `appointments[].patient`). */
  const resolveRoomLoaderPatientMembership = useCallback(
    (p: any) => roomLoaderPatientHasMembership(p, data?.appointments),
    [data?.appointments]
  );

  const roomLoaderModalClientInfo = useMemo(() => {
    const c = data?.client ?? data?.appointments?.[0]?.client;
    const d = data as Record<string, unknown> | null | undefined;
    const patients = Array.isArray(data?.patients) ? data!.patients : [];
    const patientWithEmail = patients.find(
      (p: any) =>
        (typeof p?.clientEmail === 'string' && p.clientEmail.trim()) ||
        (typeof p?.email === 'string' && p.email.trim())
    ) as Record<string, unknown> | undefined;

    const pick = (...vals: unknown[]): string | undefined => {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return undefined;
    };

    // Prefer explicit form-response / API root fields (added on GET form), then client records, then any patient row.
    const email = pick(
      d?.submitterEmail,
      d?.formEmail,
      d?.contactEmail,
      d?.responseEmail,
      d?.email,
      d?.clientEmail,
      (c as any)?.email,
      (c as any)?.primaryEmail,
      data?.appointments?.[0]?.client && (data.appointments[0].client as { email?: string }).email,
      patientWithEmail?.clientEmail,
      patientWithEmail?.email
    );

    const first = (c as any)?.firstName ?? (c as any)?.first_name ?? '';
    const last = (c as any)?.lastName ?? (c as any)?.last_name ?? '';
    return {
      email,
      fullName: { first: first || undefined, last: last || undefined },
    };
  }, [data]);

  const getRoomLoaderEnrollmentPet = useCallback(
    (eligible: MembershipEnrollmentEligiblePet) => {
      const pid = Number(eligible.id);
      const idx =
        data?.patients?.findIndex(
          (pt: any) => Number(pt.patientId ?? pt.patient?.id ?? pt.id) === pid
        ) ?? -1;
      const p = idx >= 0 ? data?.patients?.[idx] : undefined;
      if (!p) {
        return { id: eligible.id, name: eligible.name, species: eligible.species };
      }
      const apptPatient = getAppointmentPatientForRoomLoaderPet(data?.appointments, p, idx);
      const membershipEligibility = getPetDetailsForMembership(p, apptPatient);
      const dbId = p.patientId ?? p.patient?.id ?? p.id;
      const dbIdStr = dbId != null ? String(dbId) : eligible.id;
      const clientIdVal =
        data?.clientId ?? data?.client?.id ?? p.clientId ?? (p as any)?.client?.id ?? data?.appointments?.[0]?.client?.id;
      return {
        id: dbIdStr,
        dbId: dbIdStr,
        patientId: typeof dbId === 'number' ? dbId : Number(dbIdStr),
        name: p.patientName ?? p.patient?.name ?? eligible.name,
        species:
          membershipSpeciesPrimaryLabel(p, apptPatient ? [apptPatient] : undefined) ?? eligible.species,
        breed: p.breed ?? p.patient?.breed,
        dob: p.dob ?? p.patient?.dob ?? (apptPatient as { dob?: string } | undefined)?.dob,
        sex: p.sex ?? p.patient?.sex ?? (apptPatient as { sex?: string } | undefined)?.sex,
        clientId: clientIdVal != null ? clientIdVal : undefined,
        ...(p.patient ? { patient: p.patient } : {}),
        ...(apptPatient ? { _membershipSpeciesExtraSources: [apptPatient] } : {}),
        _membershipEligibilitySnapshot: membershipEligibility,
      } as Pet;
    },
    [data?.patients, data?.clientId, data?.client?.id, data?.appointments]
  );

  async function refetchRoomLoaderAfterMembership(enrolledPetId?: string) {
    const tokenValue = token;
    if (!tokenValue) return;

    if (enrolledPetId != null && String(enrolledPetId).trim() !== '') {
      const pid = Number(enrolledPetId);
      if (!Number.isNaN(pid)) {
        const snap = dataRef.current;
        const hadExistingOtherMember =
          snap?.patients?.some((p: any) => {
            const oid = Number(p.patientId ?? p.patient?.id ?? p.id);
            if (Number.isNaN(oid) || oid === pid) return false;
            return roomLoaderPatientHasMembership(p, snap?.appointments);
          }) ?? false;

        setRoomLoaderSessionMembership((prev) => {
          if (prev.enrollmentOrder.includes(pid)) return prev;
          const isAdditionalInSession = prev.enrollmentOrder.length >= 1;
          const qualifiesForCredit = hadExistingOtherMember || isAdditionalInSession;
          return {
            enrollmentOrder: [...prev.enrollmentOrder, pid],
            multiPetCreditPatientIds: qualifiesForCredit
              ? { ...prev.multiPetCreditPatientIds, [pid]: true }
              : prev.multiPetCreditPatientIds,
          };
        });
      }
    }

    clearCheckItemPricingPublicCache();
    setClientPricingCache({});
    try {
      const { data: responseData } = await http.get(
        `/public/room-loader/form?token=${encodeURIComponent(tokenValue as string)}`
      );
      setData(responseData);
      setRoomLoaderConfig(resolveRoomLoaderConfig(responseData?.config));
      setChronicMedsByPatient(normalizeChronicMedsByPatient(responseData?.chronicMedsByPatient));
      setPricingRefreshKey((k) => k + 1);
    } catch (e) {
      console.error('Failed to refresh room loader after membership enrollment', e);
    }
    setMembershipPanelByPatientId({});
    setMembershipBillSectionExpanded(false);
  }

  /** Stable id list so we do not restart treatment-history fetch on unrelated `data.patients` reference changes (avoids cancelled requests never committing `historyReady`). */
  const treatmentHistoryPatientIdsKey = useMemo(() => {
    const ids = (data?.patients ?? [])
      .map((p: any) => p?.patientId ?? p?.patient?.id)
      .filter((id: any) => id != null)
      .map((id: any) => String(id));
    return ids.length ? ids.join(',') : '';
  }, [data?.patients]);

  useEffect(() => {
    setTreatmentHistoryByPatientId({});
    setTreatmentHistoryReadyByPatientId({});
  }, [token]);

  useEffect(() => {
    setRoomLoaderSessionMembership({ enrollmentOrder: [], multiPetCreditPatientIds: {} });
  }, [token]);

  // Fetch treatment history on the last check-in page so gated optional vaccines are filtered
  // before the care plan renders (empty history briefly looks like "never vaccinated").
  useEffect(() => {
    const tokenValue = token;
    const n = data?.patients?.length ?? 0;
    if (!tokenValue || n === 0 || currentPage < n) return;
    if (!treatmentHistoryPatientIdsKey) return;
    const patientIds = treatmentHistoryPatientIdsKey.split(',').map((s: string) => Number(s));

    let cancelled = false;
    const historyByPatient: Record<number, TreatmentWithItems[]> = {};
    Promise.all(
      patientIds.map(async (patientId: number) => {
        if (cancelled) return;
        try {
          const history = await getPatientTreatmentHistoryPublic(patientId, tokenValue);
          if (!cancelled) historyByPatient[patientId] = history ?? [];
        } catch (e) {
          if (!cancelled) historyByPatient[patientId] = [];
        }
      })
    ).then(() => {
      if (cancelled) return;
      setTreatmentHistoryByPatientId((prev) => ({ ...prev, ...historyByPatient }));
      setTreatmentHistoryReadyByPatientId((prev) => {
        const next = { ...prev };
        for (const id of patientIds) {
          next[id] = true;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [token, treatmentHistoryPatientIdsKey, currentPage, data?.patients?.length]);

  useEffect(() => {
    setFieldValidationErrors((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const k of Object.keys(prev)) {
        if (k.endsWith('_optionalVaccinesLoading')) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [treatmentHistoryReadyByPatientId]);

  /** Tracks whether the membership bill section was expanded on the previous effect run (for immediate fetch on open vs debounced refetch). */
  const membershipPanelWasExpandedRef = useRef(false);
  /** Invalidates in-flight membership simulate requests so stale responses do not clear loading or overwrite newer data. */
  const membershipSimulateSeqRef = useRef(0);

  /** Load membership simulate when the explainer panel is open or on the visit summary (footer “due with membership” line). Refetch when summary lines / store totals change (debounced). */
  useEffect(() => {
    const patientsLen = data?.patients?.length ?? 0;
    const summaryPageIndexCalc = patientsLen > 0 ? 3 * patientsLen + 1 : -1;
    const onVisitSummaryPage = patientsLen > 0 && currentPage === summaryPageIndexCalc;
    const firstPatientRow = data?.patients?.[0];
    const summaryApptForMembership =
      firstPatientRow != null
        ? getAppointmentForRoomLoaderPet(data?.appointments ?? [], firstPatientRow, 0)
        : undefined;
    const visitIsQOLExamForMembership = publicRoomLoaderAppointmentIsQOLExam(summaryApptForMembership);
    const shouldLoadMembershipSimulate =
      !visitIsQOLExamForMembership &&
      !formAlreadySubmitted &&
      availablePlansForPetsForDisplay.length > 0 &&
      (membershipBillSectionExpanded || onVisitSummaryPage);

    if (!shouldLoadMembershipSimulate) {
      membershipPanelWasExpandedRef.current = false;
      setMembershipPanelLoading(false);
      return;
    }
    const tokenValue = token;
    if (!tokenValue || !data) return;

    const panelJustOpened = !membershipPanelWasExpandedRef.current;
    membershipPanelWasExpandedRef.current = true;

    const seq = ++membershipSimulateSeqRef.current;
    const debounceMs = panelJustOpened ? 0 : 350;

    const timer = window.setTimeout(() => {
      (async () => {
        try {
          if (panelJustOpened) {
            setMembershipPanelLoading(true);
            setMembershipPanelByPatientId({});
          } else {
            setMembershipPanelLoading(true);
          }
          const snapshot = buildFullFormSnapshot();
          const summaryLineItems = snapshot?.summaryLineItems ?? [];
          const membershipComparisonDeclinedLines = snapshot?.membershipComparisonDeclinedLines ?? [];
          const totals = snapshot?.totals ?? {};
          const patientsData = data?.patients ?? [];
          const firstPid = Number(
            patientsData[0]?.patientId ?? patientsData[0]?.patient?.id ?? patientsData[0]?.id ?? 0
          );
          const practiceId = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id;
          const clientId =
            data?.clientId ??
            data?.client?.id ??
            data?.patients?.[0]?.clientId ??
            (data?.patients?.[0] as any)?.client?.id ??
            data?.appointments?.[0]?.client?.id;
          const next: Record<number, MembershipPanelSimulateEntry> = {};
          for (const petPlans of availablePlansForPetsForDisplay) {
            const rec = getRecommendedWellnessPlanFromList(petPlans.plans, petPlans.meetsGolden);
            if (!rec) continue;
            const filtered = filterLineItemsForPatientSimulate(summaryLineItems, petPlans.patientId, firstPid).filter(
              (li) => (li as { category?: string }).category !== 'store'
            );
            const toSimLine = (li: {
              name: string;
              quantity: number;
              price: number;
              patientId?: number;
              patientName?: string;
              category?: string;
              itemType?: 'lab' | 'procedure' | 'inventory';
              itemId?: number;
            }): RoomLoaderSimulateLineItem => ({
              name: li.name,
              quantity: li.quantity,
              price: li.price,
              patientId: li.patientId ?? 0,
              patientName: li.patientName,
              category: li.category,
              ...(li.itemType && li.itemId != null && { itemType: li.itemType, itemId: li.itemId }),
            });
            const lineItems: RoomLoaderSimulateLineItem[] = filtered.map(toSimLine);
            const declinedForPet = filterLineItemsForPatientSimulate(
              membershipComparisonDeclinedLines,
              petPlans.patientId,
              firstPid
            ).filter((li) => (li as { category?: string }).category !== 'store');
            const request = {
              token: tokenValue as string,
              practiceId,
              clientId,
              planId: rec.planId,
              ...(petPlans.membershipSpeciesKind != null ? { species: petPlans.membershipSpeciesKind } : {}),
              patientIds: [petPlans.patientId],
              lineItems,
              storeSubtotal: totals.storeSubtotal,
              storeTax: totals.storeTax,
            };
            const [monthly, annual] = await Promise.all([
              simulateBillWithMembershipPublic({ ...request, pricingOption: 'monthly' }),
              simulateBillWithMembershipPublic({ ...request, pricingOption: 'annual' }),
            ]);
            let monthlyExtended: RoomLoaderSimulateBillPublicResponse | null = null;
            if (declinedForPet.length > 0) {
              const extendedLineItems: RoomLoaderSimulateLineItem[] = [
                ...lineItems,
                ...declinedForPet.map((li) => toSimLine(li)),
              ];
              monthlyExtended = await simulateBillWithMembershipPublic({
                ...request,
                lineItems: extendedLineItems,
                pricingOption: 'monthly',
              });
            }
            if (membershipSimulateSeqRef.current === seq)
              next[petPlans.patientId] = { monthly, annual, monthlyExtended };
          }
          if (membershipSimulateSeqRef.current === seq) setMembershipPanelByPatientId(next);
        } catch (err) {
          console.error('Membership recommendation panel load error:', err);
        } finally {
          if (membershipSimulateSeqRef.current === seq) setMembershipPanelLoading(false);
        }
      })();
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      membershipSimulateSeqRef.current += 1;
    };
  }, [
    membershipBillSectionExpanded,
    formAlreadySubmitted,
    availablePlansForPetsForDisplay,
    currentPage,
    data?.patients?.length,
    token,
    data,
    formData,
    storeAdditionalItems,
  ]);

  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('MMM dd, yyyy');
    } catch {
      return dateStr;
    }
  }

  function formatTime(dateStr: string | null | undefined): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('h:mm a');
    } catch {
      return dateStr;
    }
  }

  function handleInputChange(key: string, value: any) {
    if (formAlreadySubmitted) return;
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
    setFieldValidationErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const practiceId = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;

  /** Build full form snapshot for submit: estimate rows with checked state, totals, configured choices, store items, current page. */
  function buildFullFormSnapshot() {
    const patientsData = data?.patients ?? [];
    const appts = data?.appointments ?? [];
    const nPdfPets = patientsData.length;
    const firstPidForStore =
      patientsData.length > 0
        ? Number(patientsData[0]?.patientId ?? patientsData[0]?.patient?.id ?? 0)
        : NaN;
    const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
    const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);
    const lineCategory = (item: any): 'lab' | 'procedure' | 'inventory' => {
      const t = (item?.type ?? item?.itemType ?? 'procedure').toString().toLowerCase();
      if (t === 'lab' || t === 'laboratory') return 'lab';
      if (t === 'inventory') return 'inventory';
      return 'procedure';
    };

    type LineItem = {
      name: string;
      quantity: number;
      price: number;
      patientId?: number;
      patientName?: string;
      category?: string;
      itemType?: 'lab' | 'procedure' | 'inventory';
      itemId?: number;
      /** Unchecked on care plan/summary — listed only in membership comparison, not in visit total or primary simulate. */
      membershipComparisonDeclinedOnly?: boolean;
    };
    type PdfRow = {
      type: 'visitConsult' | 'tripFee' | 'reminder' | 'vaccine' | 'lab' | 'common' | 'membershipCredit';
      name: string;
      quantity: number;
      price: number;
      lineTotal: number;
      checked?: boolean;
      uncheckable?: boolean;
      crossedOut?: boolean;
      /** Panel that already covers this staff line; rendered beside the strikethrough. */
      fecalReplacedBy?: string;
      /** Item code for backend/API use */
      code?: string;
      /** Membership/care plan info for backend PDF display */
      wellnessPlanPricing?: Record<string, unknown>;
    };
    type Qa = { question: string; answer: string | boolean | null; answerLabel?: string | null };
    type Section = { sectionLabel?: string; patientId?: number; patientName?: string; questions: Qa[] };
    type PageSection = { pageNumber: number; title: string; sections: Section[] };

    /** Extract membership-related pricing for backend PDF. Omitted when no membership applies. */
    const getMembershipInfoForPdf = (pricing: any): Record<string, unknown> | undefined => {
      const wp = pricing?.wellnessPlanPricing;
      if (!wp) return undefined;
      const hasMembership =
        wp.hasCoverage || (wp as any)?.priceAdjustedByMembership || (wp.originalPrice != null && wp.adjustedPrice != null && wp.originalPrice !== wp.adjustedPrice);
      if (!hasMembership) return undefined;
      return {
        hasCoverage: wp.hasCoverage,
        priceAdjustedByMembership: (wp as any)?.priceAdjustedByMembership,
        membershipPlanName: wp.membershipPlanName ?? undefined,
        originalPrice: wp.originalPrice,
        adjustedPrice: wp.adjustedPrice,
        membershipDiscountAmount: wp.membershipDiscountAmount,
        isWithinLimit: wp.isWithinLimit,
      };
    };

    const remindersByPet: Array<{
      patientId: number | undefined;
      patientName: string;
      displayItems: any[];
      checked: boolean[];
      tripFeeItems: any[];
    }> = [];
    const petSubtotals: number[] = [];
    const pdfPets: Array<{
      patientId: number | undefined;
      patientName: string;
      rows: PdfRow[];
      subtotal: number;
      commonSectionLabel?: string;
    }> = [];
    const summaryLineItems: LineItem[] = [];
    const membershipComparisonDeclinedLines: LineItem[] = [];
    const formAnswersPages: PageSection[] = [];
    const optedInVaccineItems: Record<
      number,
      Array<{ itemType: string; id: number; name: string; code?: string; price: number; quantity: number }>
    > = {};
    const commonlySelectedItems: Record<string, boolean> = {};
    const labSelections: Record<string, Record<string, any>> = {};
    const configuredKeysShown = new Set<string>();
    let grandTotal = 0;

    patientsData.forEach((patient: any, petIdx: number) => {
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const petKey = `pet${petIdx}`;
      const plan = petPlans[petIdx] ?? emptyPetPlan;
      const ctx = petPlanContexts[petIdx] ?? emptyPlanContext;
      const allItems = recommendedItemsByPet[petIdx] ?? [];
      const displayItems = allItems.filter((item: any) => !hasPhrase(item, 'trip fee') && !hasPhrase(item, 'sharps'));
      const tripFeeItems = allItems.filter((item: any) => hasPhrase(item, 'trip fee') || hasPhrase(item, 'sharps'));
      const replacedLabels = panelReplacementLabels(
        effectiveAcceptedPanelOptions(plan, petKey, formData),
        ctx.estimateLines
      );

      const checked = displayItems.map((item: any, idx: number) => {
        if (rowReplacedByPanel(item, replacedLabels) != null) return false;
        const isVisitOrConsult = hasPhrase(item, 'visit') || hasPhrase(item, 'consult');
        return isVisitOrConsult || publicFormCarePlanRecRowChecked(formData, petIdx, item, idx);
      });
      remindersByPet.push({ patientId, patientName: petName, displayItems, checked, tripFeeItems });

      const rows: PdfRow[] = [];
      let petSubtotal = 0;

      displayItems.forEach((item: any, idx: number) => {
        const isVisitOrConsult = hasPhrase(item, 'visit') || hasPhrase(item, 'consult');
        const replacedBy = rowReplacedByPanel(item, replacedLabels);
        const pricing =
          item.wellnessPlanPricing != null
            ? { wellnessPlanPricing: item.wellnessPlanPricing }
            : item.searchableItem
              ? getClientPricing(patientId, item.searchableItem)
              : null;
        const price =
          item.searchableItem != null
            ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0)
            : Number(item.price) || 0;
        const qty = isVisitOrConsult
          ? Number(item.quantity) || 1
          : effectivePublicMedicationInventoryQuantity(formData, petIdx, item, idx, Number(patientId), getClientPricing);
        const isChecked = checked[idx];
        const counted = isChecked && replacedBy == null;
        const lineTotal = counted ? price * qty : 0;
        petSubtotal += lineTotal;
        rows.push({
          type: isVisitOrConsult ? 'visitConsult' : 'reminder',
          name: item.name,
          quantity: qty,
          price,
          lineTotal,
          checked: isChecked,
          uncheckable: isVisitOrConsult,
          crossedOut: !counted,
          ...(replacedBy != null ? { fecalReplacedBy: replacedBy } : {}),
          code: getCodeFromDisplayItem(item),
          wellnessPlanPricing: getMembershipInfoForPdf(pricing),
        });
        const line: LineItem = {
          name: item.name,
          quantity: qty,
          price,
          patientId: Number(patientId),
          patientName: petName,
          category: lineCategory(item),
          itemType: lineCategory(item),
          ...(item.id != null ? { itemId: Number(item.id) } : {}),
        };
        if (counted) summaryLineItems.push(line);
        else membershipComparisonDeclinedLines.push({ ...line, membershipComparisonDeclinedOnly: true });
      });

      tripFeeItems.forEach((item: any) => {
        const pricing =
          item.wellnessPlanPricing != null
            ? { wellnessPlanPricing: item.wellnessPlanPricing }
            : item.searchableItem
              ? getClientPricing(patientId, item.searchableItem)
              : null;
        const price =
          item.searchableItem != null
            ? (getClientAdjustedPrice(patientId, item.searchableItem) ?? Number(item.price) ?? 0)
            : Number(item.price) || 0;
        const qty = Number(item.quantity) || 1;
        const lineTotal = price * qty;
        petSubtotal += lineTotal;
        rows.push({
          type: 'tripFee',
          name: item.name,
          quantity: qty,
          price,
          lineTotal,
          checked: true,
          uncheckable: true,
          crossedOut: false,
          code: getCodeFromDisplayItem(item),
          wellnessPlanPricing: getMembershipInfoForPdf(pricing),
        });
        summaryLineItems.push({
          name: item.name,
          quantity: qty,
          price,
          patientId: Number(patientId),
          patientName: petName,
          category: lineCategory(item),
          itemType: lineCategory(item),
          ...(item.id != null ? { itemId: Number(item.id) } : {}),
        });
      });

      acceptedConfigItems(plan, ctx, petKey, formData).forEach((entry) => {
        const excludeKey = configSummaryExcludeKey(petKey, entry.item);
        configuredKeysShown.add(excludeKey);
        const excluded = formData[excludeKey] === true;
        const searchable = configCatalogItem(entry.item);
        const pricing = searchable ? getClientPricing(patientId, searchable) : null;
        const price =
          (searchable ? (getClientAdjustedPrice(patientId, searchable) ?? getSearchItemPrice(searchable)) : null) ?? 0;
        const lineTotal = excluded ? 0 : price;
        petSubtotal += lineTotal;
        rows.push({
          type: entry.category === 'lab' ? 'lab' : entry.category === 'common' ? 'common' : 'vaccine',
          name: entry.displayName,
          quantity: 1,
          price,
          lineTotal,
          checked: !excluded,
          uncheckable: false,
          crossedOut: excluded,
          ...(entry.item.code ? { code: entry.item.code } : {}),
          wellnessPlanPricing: getMembershipInfoForPdf(pricing),
        });
        const line: LineItem = {
          name: entry.displayName,
          quantity: 1,
          price,
          patientId: Number(patientId),
          patientName: petName,
          category: entry.item.itemType,
          itemType: entry.item.itemType,
          itemId: entry.item.itemId,
        };
        if (excluded) {
          membershipComparisonDeclinedLines.push({ ...line, membershipComparisonDeclinedOnly: true });
          return;
        }
        summaryLineItems.push(line);
        if (entry.category === 'vaccine') {
          const pid = Number(patientId);
          const list = optedInVaccineItems[pid] ?? (optedInVaccineItems[pid] = []);
          list.push({
            itemType: entry.item.itemType,
            id: entry.item.itemId,
            name: entry.displayName,
            ...(entry.item.code ? { code: entry.item.code } : {}),
            price,
            quantity: 1,
          });
        } else if (entry.category === 'common') {
          commonlySelectedItems[`summary_common_${patientId}_${entry.item.itemId}`] = true;
        }
      });

      const pidForCredit = Number(patientId);
      if (!Number.isNaN(pidForCredit) && roomLoaderSessionMembership.multiPetCreditPatientIds[pidForCredit]) {
        const credit = VAYD_MULTI_PET_MEMBERSHIP_CREDIT_USD;
        petSubtotal -= credit;
        rows.push({
          type: 'membershipCredit',
          name: VAYD_MULTI_PET_MEMBERSHIP_CREDIT_LINE_NAME,
          quantity: 1,
          price: -credit,
          lineTotal: -credit,
        });
      }

      petSubtotals.push(petSubtotal);
      grandTotal += petSubtotal;
      pdfPets.push({ patientId, patientName: petName, rows, subtotal: petSubtotal });

      const panelChoices: Record<string, any> = {};
      plan.panelRules.forEach((rule: RoomLoaderPanelRule) => {
        const key = panelAnswerKey(petKey, rule.id);
        configuredKeysShown.add(key);
        const value = formData[key];
        if (value != null && value !== '') panelChoices[rule.id] = value;
      });
      plan.medicalConcernOptions.forEach((option: RoomLoaderPanelOption) => {
        const key = medicalConcernPanelKey(petKey, option.id);
        configuredKeysShown.add(key);
        const value = formData[key];
        if (value != null && value !== '') panelChoices[option.id] = value;
      });
      visiblePanelSubAsks(plan, ctx, petKey, formData).forEach((sub) => {
        const key = panelSubAskKey(petKey, sub.id);
        configuredKeysShown.add(key);
        const value = formData[key];
        if (value != null && value !== '') panelChoices[sub.id] = value;
      });
      if (Object.keys(panelChoices).length > 0) labSelections[String(patientId)] = panelChoices;

      if (plan.askOutdoorAccess) configuredKeysShown.add(outdoorAccessKey(petKey));
      if (plan.outdoorPitch) configuredKeysShown.add(outdoorPitchKey(petKey));
      const { gated, universal } = splitDedupedOffers(plan);
      [...gated, ...universal].forEach((offer) => configuredKeysShown.add(offerKey(petKey, offer.id)));
      plan.itemQuestions.forEach((question: RoomLoaderItemQuestion) =>
        configuredKeysShown.add(itemQuestionKey(petKey, question.id))
      );
      if (roomLoaderConfig.chronicMeds.enabled) {
        chronicMedsForPatient(Number(patientId)).forEach((med) =>
          configuredKeysShown.add(chronicMedKey(petKey, med.prescriptionId))
        );
        if (roomLoaderConfig.chronicMeds.allowFreeText) configuredKeysShown.add(chronicMedsOtherKey(petKey));
      }
    });

    const storeSubtotal = storeAdditionalItems.reduce((sum, item, idx) => {
      const unit =
        !Number.isNaN(firstPidForStore) && firstPidForStore > 0
          ? getStoreAdjustedPrice(firstPidForStore, item, idx)
          : null;
      return sum + (unit ?? Number(item.price)) * storeItemQty(item);
    }, 0);
    const storeTaxRate = 0.055;
    const storeTax = storeSubtotal * storeTaxRate;
    grandTotal += storeSubtotal + storeTax;

    // Store additional items: always include name, quantity, price, code (sku) for backend summary
    const storeAdditionalItemsPayload = storeAdditionalItems.map((item, idx) => ({
      id: item.id,
      name: item.name,
      quantity: storeItemQty(item),
      price:
        !Number.isNaN(firstPidForStore) && firstPidForStore > 0
          ? (getStoreAdjustedPrice(firstPidForStore, item, idx) ?? Number(item.price))
          : Number(item.price),
      sku: item.sku,
      code: item.sku ?? (item as { code?: string }).code,
      listingId: item.listingId ?? null,
      inventoryItemId: item.inventoryItemId ?? null,
      procedureId: item.procedureId ?? null,
      catalogItemType: item.catalogItemType ?? null,
      optionLabel: item.optionLabel ?? null,
      fulfillment: item.fulfillment ?? 'visit',
      visitPrice: item.visitPrice ?? null,
      shipPrice: item.shipPrice ?? null,
    }));

    const summaryForPdf = {
      title: 'Pre-Visit Check-In',
      instruction: "We've put together a personalized plan based on your pet's needs and our medical recommendations. You can review each item below, make adjustments, and see pricing clearly upfront so you feel informed and confident before your visit.",
      pets: pdfPets,
      additionalItems: {
        label: 'Additional items',
        items: storeAdditionalItemsPayload.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price, code: (i as any).code ?? i.sku })),
        subtotal: storeSubtotal,
        taxLabel: 'Sales tax (5.5%)',
        taxRate: storeTaxRate,
        tax: storeTax,
      },
      grandTotal,
    };

    // --- formAnswersForPdf: every question text + client answer for PDF (all pages before Summary) ---
    patientsData.forEach((patient: any, petIdx: number) => {
      const petKey = `pet${petIdx}`;
      const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const plan = petPlans[petIdx] ?? emptyPetPlan;
      const ctx = petPlanContexts[petIdx] ?? emptyPlanContext;
      const configAnswers = configAnswerQuestions({
        config: roomLoaderConfig,
        plan,
        ctx,
        petKey,
        petName,
        formData,
        chronicMeds: chronicMedsForPatient(Number(patientId)),
      });
      const apptRowPdfP1 = getAppointmentForRoomLoaderPet(appts, patient, petIdx);
      const markedNewByApi = patient.isNewPatient === true || apptRowPdfP1?.isNewPatient === true;
      const explicitlyNotNew = patient.isNewPatient === false || apptRowPdfP1?.isNewPatient === false;
      const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
      const treatAsNewWhenNoReminders = patient.isNewPatient !== false && apptRowPdfP1?.isNewPatient !== false;
      const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));

      const questions: Qa[] = [];
      const addOptional = (question: string, key: string, valueLabels?: Record<string, string>) => {
        const raw = formData[key];
        const val = raw === undefined ? null : raw;
        const label = valueLabels && val != null && typeof val === 'string' ? (valueLabels[val] ?? val) : (typeof val === 'string' ? val : null);
        questions.push({ question, answer: val ?? null, answerLabel: label ?? (val != null ? String(val) : null) });
      };
      addOptional('Do you want to share any additional details about the reason for this visit?', `${petKey}_appointmentReason`);
      addOptional(`Is ${petName} eating, drinking, defecating, and urinating normally?`, `${petKey}_eatingDrinkingNormal`, { yes: 'Yes', no: 'No' });
      if (formData[`${petKey}_eatingDrinkingNormal`] === 'no') {
        addOptional('Please describe.', `${petKey}_eatingDrinkingNormalDetails`);
      }
      addOptional(`How is ${petName} doing otherwise? Are there any other concerns you'd like us to address during this visit?`, `${petKey}_generalWellbeing`);
      if ((patient as any).questions?.mobility === true) {
        addOptional(`It sounds like you may have some concerns about ${petName}'s mobility. Can you tell us more about what you're noticing?`, `${petKey}_mobilityDetails`);
      }
      configAnswers.checkIn.forEach((qa) => questions.push(qa));
      if (isNewPatient) {
        addOptional(`Describe ${petName}'s behavior at home, around strangers, and at a typical vet office.`, `${petKey}_newPatientBehavior`);
        addOptional(`What are you feeding ${petName}? (brand, amount, frequency)`, `${petKey}_feeding`);
        addOptional(`Do you or ${petName} have any food allergies? (we like to bribe!)`, `${petKey}_foodAllergies`, { yes: 'Yes', no: 'No' });
        if (formData[`${petKey}_foodAllergies`] === 'yes') {
          addOptional('If yes, what are they?', `${petKey}_foodAllergiesDetails`);
        }
      }
      if (questions.length > 0) {
        formAnswersPages.push({
          pageNumber: petIdx + 1,
          title:
            nPdfPets > 1
              ? `Time to Check-in — ${petName} (${petIdx + 1} of ${nPdfPets})`
              : 'Time to Check-in for your Appointment',
          sections: [{ sectionLabel: `Pet ${petIdx + 1}: ${petName}`, patientId, patientName: petName, questions }],
        });
      }

      if (configAnswers.carePlan.length > 0) {
        formAnswersPages.push({
          pageNumber: nPdfPets + 1 + petIdx,
          title: nPdfPets > 1 ? `Veterinary Care Plan — ${petName}` : 'Veterinary Care Plan',
          sections: [
            {
              sectionLabel: `${petName} — Optional Add-ons & Questions`,
              patientId,
              patientName: petName,
              questions: configAnswers.carePlan,
            },
          ],
        });
      }

      if (configAnswers.labs.length > 0) {
        formAnswersPages.push({
          pageNumber: 2 * nPdfPets + 1 + petIdx,
          title: nPdfPets > 1 ? `${roomLoaderConfig.labsPage.title} — ${petName}` : roomLoaderConfig.labsPage.title,
          sections: [{ sectionLabel: petName, patientId, patientName: petName, questions: configAnswers.labs }],
        });
      }
    });

    // Review page: Anything else you want us to know?
    const anythingElseNotes = (formData['anythingElseNotes'] ?? '').toString().trim();
    // Only asked when the practice has no online store to search, so it is usually blank.
    const additionalItemsRequest = (formData['additionalItemsRequest'] ?? '').toString().trim();
    const summaryPdfPageNumber = nPdfPets > 0 ? 3 * nPdfPets + 1 : 2;
    formAnswersPages.push({
      pageNumber: summaryPdfPageNumber,
      title: 'Review Your Care Plan & Estimate',
      sections: [{
        sectionLabel: 'Additional notes',
        questions: [
          ...(additionalItemsRequest
            ? [{
                question: 'Other medications or products to bring',
                answer: additionalItemsRequest,
                answerLabel: additionalItemsRequest,
              }]
            : []),
          {
            question: 'Anything else you want us to know?',
            answer: anythingElseNotes || null,
            answerLabel: anythingElseNotes || null,
          },
        ],
      }],
    });
    formAnswersPages.sort((a, b) => a.pageNumber - b.pageNumber);

    const formAnswersForPdf = { pages: formAnswersPages };

    // Only include form fields for questions that were actually shown to the client
    const staticCheckInSuffixes = new Set([
      'appointmentReason',
      'eatingDrinkingNormal',
      'eatingDrinkingNormalDetails',
      'generalWellbeing',
      'mobilityDetails',
      'newPatientBehavior',
      'feeding',
      'foodAllergies',
      'foodAllergiesDetails',
      'labWork',
    ]);
    const allowedFormData: Record<string, any> = {};
    for (const [key, value] of Object.entries(formData)) {
      if (configuredKeysShown.has(key)) {
        allowedFormData[key] = value;
        continue;
      }
      if (!key.startsWith('pet')) {
        allowedFormData[key] = value;
        continue;
      }
      const petMatch = key.match(/^pet(\d+)_(.+)$/);
      if (!petMatch) continue;
      if (!patientsData[Number(petMatch[1])]) continue;
      const suffix = petMatch[2];
      if (suffix.startsWith('rec_') || staticCheckInSuffixes.has(suffix)) allowedFormData[key] = value;
    }

    return {
      ...allowedFormData,
      currentPage,
      optedInVaccineItems,
      storeAdditionalItems: storeAdditionalItemsPayload,
      commonlySelectedItems,
      remindersByPet,
      summaryLineItems,
      membershipComparisonDeclinedLines,
      summaryForPdf,
      formAnswersForPdf,
      totals: {
        grandTotal,
        storeSubtotal,
        storeTax,
        storeTaxRate,
        petSubtotals,
      },
      labSelections,
    };
  }

  /** Validate every required answer across the whole form before submit. */
  function validateRequiredBeforeSubmit(): { valid: boolean; message?: string; errors?: Record<string, string> } {
    const patientsData = data?.patients ?? [];
    const appts = data?.appointments ?? [];
    const errors: Record<string, string> = {};
    for (let petIdx = 0; petIdx < patientsData.length; petIdx++) {
      const patient = patientsData[petIdx];
      const petKey = `pet${petIdx}`;
      const petName = patient.patientName || `Pet ${petIdx + 1}`;
      const apptRowSubmit = getAppointmentForRoomLoaderPet(appts, patient, petIdx);

      const markedNewByApi = patient.isNewPatient === true || apptRowSubmit?.isNewPatient === true;
      const explicitlyNotNew = patient.isNewPatient === false || apptRowSubmit?.isNewPatient === false;
      const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
      const treatAsNewWhenNoReminders = patient.isNewPatient !== false && apptRowSubmit?.isNewPatient !== false;
      const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));
      if (isNewPatient) {
        const behavior = (formData[`${petKey}_newPatientBehavior`] ?? '').toString().trim();
        if (!behavior) {
          errors[`${petKey}_newPatientBehavior`] = `Please describe ${petName}'s behavior at home, around strangers, and at a typical vet office.`;
        }
        const foodAllergies = formData[`${petKey}_foodAllergies`];
        if (foodAllergies !== 'yes' && foodAllergies !== 'no') {
          errors[`${petKey}_foodAllergies`] = `Please answer the Food Allergies question for ${petName}.`;
        }
        if (foodAllergies === 'yes') {
          const details = (formData[`${petKey}_foodAllergiesDetails`] ?? '').toString().trim();
          if (!details) {
            errors[`${petKey}_foodAllergiesDetails`] = `Please describe ${petName}'s food allergies.`;
          }
        }
      }

      Object.assign(
        errors,
        missingConfigAnswers({
          config: roomLoaderConfig,
          plan: petPlans[petIdx] ?? emptyPetPlan,
          petKey,
          petName,
          formData,
        })
      );

      // Gated add-ons depend on treatment history, so do not let a submit race the lookup.
      const historyPatientId = patient.patientId ?? patient.patient?.id ?? null;
      const historyReady =
        historyPatientId != null && treatmentHistoryReadyByPatientId[historyPatientId] === true;
      const labWorkYes = publicFormPetLabWorkConcernYes(formData, petKey, patient);
      const hideOffersForQOL = publicRoomLoaderAppointmentIsQOLExam(apptRowSubmit) && !labWorkYes;
      const hasGatedOffers = (roomLoaderConfig.gatedOffers ?? []).some((offer) => offer.enabled);
      if (historyPatientId != null && !historyReady && !hideOffersForQOL && hasGatedOffers) {
        errors[`${petKey}_optionalVaccinesLoading`] = `We're still loading vaccine history for ${petName}. Please wait a moment, then try again.`;
      }
    }

    if (Object.keys(errors).length > 0) {
      return { valid: false, message: Object.values(errors)[0], errors };
    }
    return { valid: true };
  }

  /** Validate required fields when leaving a Labs page for one pet. */
  function validateRequiredForLabsPetPage(
    labsPetIndex: number
  ): { valid: boolean; message?: string; errors?: Record<string, string> } {
    const patient = (data?.patients ?? [])[labsPetIndex];
    if (!patient) return { valid: true };
    const petKey = `pet${labsPetIndex}`;
    const petName = patient.patientName || `Pet ${labsPetIndex + 1}`;
    const all = missingConfigAnswers({
      config: roomLoaderConfig,
      plan: petPlans[labsPetIndex] ?? emptyPetPlan,
      petKey,
      petName,
      formData,
      suffix: 'before continuing',
    });
    const errors: Record<string, string> = {};
    for (const [key, message] of Object.entries(all)) {
      if (key.startsWith(`${petKey}_panel_`) || key.startsWith(`${petKey}_mcPanel_`)) errors[key] = message;
    }
    if (Object.keys(errors).length > 0) {
      return { valid: false, message: Object.values(errors)[0], errors };
    }
    return { valid: true };
  }

  /** Validate required check-in fields for one pet (reason follow-ups, eating/normal, new-patient blocks). Outdoor (cats) is on the Veterinary Care Plan only. */
  function validateRequiredForCheckInPet(petIdx: number): { valid: boolean; message?: string; errors?: Record<string, string> } {
    const patientsData = data?.patients ?? [];
    const appts = data?.appointments ?? [];
    const patient = patientsData[petIdx];
    if (!patient) return { valid: true };
    const errors: Record<string, string> = {};
    const petKey = `pet${petIdx}`;
    const petName = patient.patientName || `Pet ${petIdx + 1}`;
    const apptRowP1 = getAppointmentForRoomLoaderPet(appts, patient, petIdx);
    const markedNewByApi = patient.isNewPatient === true || apptRowP1?.isNewPatient === true;
    const explicitlyNotNew = patient.isNewPatient === false || apptRowP1?.isNewPatient === false;
    const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
    const treatAsNewWhenNoReminders = patient.isNewPatient !== false && apptRowP1?.isNewPatient !== false;
    const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));

    const eatingNormal = formData[`${petKey}_eatingDrinkingNormal`];
    if (eatingNormal !== 'yes' && eatingNormal !== 'no') {
      errors[`${petKey}_eatingDrinkingNormal`] = `Please answer whether ${petName} is eating, drinking, defecating, and urinating normally.`;
    }
    if (eatingNormal === 'no') {
      const details = (formData[`${petKey}_eatingDrinkingNormalDetails`] ?? '').toString().trim();
      if (!details) {
        errors[`${petKey}_eatingDrinkingNormalDetails`] = `Please describe ${petName}'s eating, drinking, or elimination.`;
      }
    }
    if (isNewPatient) {
      const behavior = (formData[`${petKey}_newPatientBehavior`] ?? '').toString().trim();
      if (!behavior) {
        errors[`${petKey}_newPatientBehavior`] = `Please describe ${petName}'s behavior at home, around strangers, and at a typical vet office before continuing.`;
      }
      const foodAllergies = formData[`${petKey}_foodAllergies`];
      if (foodAllergies !== 'yes' && foodAllergies !== 'no') {
        errors[`${petKey}_foodAllergies`] = `Please answer the Food Allergies question for ${petName} before continuing.`;
      }
      if (foodAllergies === 'yes') {
        const details = (formData[`${petKey}_foodAllergiesDetails`] ?? '').toString().trim();
        if (!details) {
          errors[`${petKey}_foodAllergiesDetails`] = `Please describe ${petName}'s food allergies before continuing.`;
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      return { valid: false, message: Object.values(errors)[0], errors };
    }
    return { valid: true };
  }

  /** Scroll to the first field with a validation error (care plan / check-in field names). */
  function scrollToFirstFormFieldError(errors: Record<string, string> | undefined): void {
    const firstKey = errors && Object.keys(errors)[0];
    if (!firstKey || typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const el =
        document.querySelector(`input[name="${CSS.escape(firstKey)}"]`) ||
        document.querySelector(`textarea[name="${CSS.escape(firstKey)}"]`) ||
        document.querySelector(`select[name="${CSS.escape(firstKey)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  /** Validate required fields for one pet on Care Plan (outdoor if cat + any vaccine questions shown). Used before "Next pet" or "Next: Labs". */
  function validateRequiredForCarePlanPet(petIdx: number): { valid: boolean; message?: string; errors?: Record<string, string> } {
    const patientsData = data?.patients ?? [];
    const appts = data?.appointments ?? [];
    const patient = patientsData[petIdx];
    if (!patient) return { valid: true };
    const petKey = `pet${petIdx}`;
    const petName = patient.patientName || `Pet ${petIdx + 1}`;
    const apptRowCarePlan = getAppointmentForRoomLoaderPet(appts, patient, petIdx);
    const errors: Record<string, string> = {};

    const all = missingConfigAnswers({
      config: roomLoaderConfig,
      plan: petPlans[petIdx] ?? emptyPetPlan,
      petKey,
      petName,
      formData,
      suffix: 'before continuing',
    });
    const outdoorKey = outdoorAccessKey(petKey);
    if (all[outdoorKey]) errors[outdoorKey] = all[outdoorKey];
    for (const question of (petPlans[petIdx] ?? emptyPetPlan).itemQuestions) {
      const key = itemQuestionKey(petKey, question.id);
      if (all[key]) errors[key] = all[key];
    }

    // Gated add-ons depend on treatment history, so hold the page until it has loaded.
    const patientId = patient.patientId ?? patient.patient?.id;
    const historyReady = patientId != null && treatmentHistoryReadyByPatientId[patientId] === true;
    const labWorkYes = publicFormPetLabWorkConcernYes(formData, petKey, patient);
    const hideOffersForQOL = publicRoomLoaderAppointmentIsQOLExam(apptRowCarePlan) && !labWorkYes;
    const hasGatedOffers = (roomLoaderConfig.gatedOffers ?? []).some((offer) => offer.enabled);
    if (patientId != null && !historyReady && !hideOffersForQOL && hasGatedOffers) {
      errors[`${petKey}_optionalVaccinesLoading`] = `We're still loading vaccine history for ${petName}. Please wait a moment, then try again.`;
    }

    if (Object.keys(errors).length > 0) {
      return { valid: false, message: Object.values(errors)[0], errors };
    }
    return { valid: true };
  }

  async function handleSubmit() {
    const tokenValue = token;
    if (!tokenValue) return;
    const safeToken = tokenValue as string;

    const validation = validateRequiredBeforeSubmit();
    if (!validation.valid) {
      setFieldValidationErrors(validation.errors || {});
      const firstErrorKey = Object.keys(validation.errors || {})[0] ?? '';
      const N = (data?.patients ?? []).length;
      const petNum = firstErrorKey.match(/^pet(\d+)_/)?.[1];
      if (petNum != null && N > 0) {
        const pi = Math.min(Math.max(0, Number(petNum)), N - 1);
        const isLabsField = /_(panel|mcPanel|subask)_/.test(firstErrorKey);
        const isSummaryField =
          firstErrorKey.includes('_chronicMed_') || firstErrorKey.includes('_chronicMedsOther');
        const isCarePlanField =
          firstErrorKey.includes('outdoorAccess') ||
          firstErrorKey.includes('outdoorPitch') ||
          firstErrorKey.includes('_offer_') ||
          firstErrorKey.includes('_ask_') ||
          firstErrorKey.includes('labWork') ||
          firstErrorKey.includes('optionalVaccines') ||
          firstErrorKey.includes('_rec_');
        if (isLabsField) setCurrentPage(2 * N + 1 + pi);
        else if (isSummaryField) setCurrentPage(3 * N + 1);
        else if (isCarePlanField) setCurrentPage(N + 1 + pi);
        else setCurrentPage(pi + 1);
      }
      return;
    }
    setFieldValidationErrors({});

    const payloadFormData = buildFullFormSnapshot();

    setSubmitting(true);
    try {
      await http.post('/public/room-loader/submit', {
        token: safeToken,
        formData: payloadFormData,
      });
      // Refetch so we get submitStatus === 'completed' and responseFromClient, then show thank you page
      const { data: responseData } = await http.get(
        `/public/room-loader/form?token=${encodeURIComponent(safeToken)}`
      );
      setData(responseData);
      if (responseData?.submitStatus === 'completed') {
        setFormAlreadySubmitted(true);
      } else if (responseData?.responseFromClient ?? responseData?.savedForm) {
        const raw = responseData?.responseFromClient ?? responseData?.savedForm;
        const hasSubmitPayload =
          raw?.formData?.summaryForPdf != null ||
          (Array.isArray(raw?.formData?.summaryLineItems) && (raw?.formData?.summaryLineItems?.length ?? 0) > 0);
        if (hasSubmitPayload) setFormAlreadySubmitted(true);
      }
    } catch (err: any) {
      console.error('Error submitting form:', err);
      setFieldValidationErrors((prev) => ({ ...prev, _submit: 'Failed to submit form. Please try again.' }));
    } finally {
      setSubmitting(false);
    }
  }

  const patients = data?.patients ?? [];
  const appointments = data?.appointments ?? [];

  /**
   * The engine's view of each pet. Rebuilt as answers arrive so history gates, species and
   * age windows re-resolve without the form knowing anything about the rules themselves.
   */
  const petPlanContexts = useMemo(
    () =>
      (data?.patients ?? []).map((patient: any, petIdx: number) => {
        const patientId = Number(patient?.patientId ?? patient?.patient?.id ?? petIdx);
        const history = Number.isNaN(patientId) ? [] : treatmentHistoryByPatientId[patientId] ?? [];
        return buildPlanContext({ data, patient, petKey: `pet${petIdx}`, formData, history });
      }),
    [data, formData, treatmentHistoryByPatientId]
  );

  const petPlans = useMemo(
    () => petPlanContexts.map((ctx: EngineContext) => resolvePetPlan(roomLoaderConfig, ctx)),
    [petPlanContexts, roomLoaderConfig]
  );

  useEffect(() => {
    if (roomLoaderConfig.membership.startExpanded) setMembershipBillSectionExpanded(true);
  }, [roomLoaderConfig.membership.startExpanded]);

  const speciesOnForm = useMemo<RoomLoaderSpecies[]>(
    () => Array.from(new Set(petPlanContexts.map((ctx: EngineContext) => ctx.species))),
    [petPlanContexts]
  );

  const chronicMedsForPatient = (patientId: number): ChronicMed[] =>
    chronicMedsByPatient[String(patientId)] ?? [];

  /**
   * One batched catalog lookup covering every item the configuration can offer, so prices
   * resolve without a request per item per render.
   */
  useEffect(() => {
    if (!data) return;
    const refs = configuredItemRefs(roomLoaderConfig);
    if (refs.length === 0) {
      setConfigCatalogItems({});
      return;
    }
    const practiceId = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    const specs = refs.map((ref) => ({
      key: roomLoaderItemKey(ref),
      q: (ref.code ?? '').trim() !== '' ? (ref.code as string) : ref.name,
      code: ref.code,
      itemId: ref.itemId,
    }));
    let cancelled = false;
    Promise.all(
      specs.map((spec) =>
        searchItemsPublic({
          q: spec.q,
          ...(spec.code ? { code: spec.code } : {}),
          practiceId,
          limit: 10,
        }).catch(() => [] as SearchableItem[])
      )
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, SearchableItem> = {};
      specs.forEach((spec, i) => {
        const arr = Array.isArray(results[i]) ? (results[i] as SearchableItem[]) : [];
        const byId = arr.find((it) => getItemId(it) === spec.itemId);
        const byCode =
          spec.code != null && spec.code !== ''
            ? arr.find(
                (it) =>
                  (getSearchItemCode(it) ?? '').toString().toUpperCase() ===
                  (spec.code as string).toUpperCase()
              )
            : undefined;
        const found = byId ?? byCode ?? arr[0];
        if (found) next[spec.key] = found;
      });
      setConfigCatalogItems(next);
    });
    return () => {
      cancelled = true;
    };
  }, [data, roomLoaderConfig]);

  /** Fetch client-adjusted pricing (discounts/membership) for every row a pet can be shown. */
  useEffect(() => {
    const tokenValue = token;
    const patients = data?.patients ?? [];
    if (!tokenValue || !patients.length) return;
    const practiceId = data?.practice?.id ?? data?.practiceId ?? data?.appointments?.[0]?.practice?.id ?? 1;
    const clientId = data?.clientId ?? data?.client?.id ?? data?.patients?.[0]?.clientId ?? (data?.patients?.[0] as any)?.client?.id ?? data?.appointments?.[0]?.client?.id ?? undefined;
    const speciesByPatientId = new Map<number, string | undefined>();
    patients.forEach((p: any, idx: number) => {
      const pid = Number(p.patientId ?? p.patient?.id ?? idx);
      if (Number.isNaN(pid)) return;
      const apptPatient = getAppointmentPatientForRoomLoaderPet(data?.appointments, p, idx);
      speciesByPatientId.set(
        pid,
        membershipSpeciesPrimaryLabel(p, apptPatient ? [apptPatient] : undefined) ?? undefined
      );
    });
    const configItems = Object.values(configCatalogItems);
    const pairs: { patientId: number; item: SearchableItem; key: string }[] = [];
    patients.forEach((p: any, idx: number) => {
      const patientId = p.patientId ?? p.patient?.id ?? idx;
      configItems.forEach((item) => {
        const id = getItemId(item);
        if (id == null) return;
        if (!buildPricingItemPayload(item)) return;
        const itemType = (item.itemType ?? 'procedure').toString();
        pairs.push({ patientId, item, key: `p${patientId}-${itemType}-${id}` });
      });
      // Display items (reminders + added items) so review page shows membership/discount pricing
      (p.reminders ?? []).forEach((reminder: any) => {
        if (
          reminder.item?.id != null ||
          reminder.item?.procedure?.id != null ||
          reminder.item?.lab?.id != null ||
          reminder.item?.inventoryItem?.id != null
        ) {
          const id =
            reminder.item?.id ??
            reminder.item?.procedure?.id ??
            reminder.item?.lab?.id ??
            reminder.item?.inventoryItem?.id;
          if (id == null) return;
          const categoryName = reminder.item?.categoryName ?? reminder.item?.inventoryItem?.categoryName;
          const row = {
            id,
            name: reminder.item.name,
            price: reminder.item.price,
            itemType: reminder.item?.type ?? reminder.itemType ?? 'procedure',
            code:
              reminder.item?.code ??
              reminder.item?.procedure?.code ??
              reminder.item?.lab?.code ??
              reminder.item?.inventoryItem?.code,
            categoryName,
          };
          const si = rowToSearchableItem(row);
          if (si) {
            const itemType = (si.itemType ?? 'procedure').toString();
            pairs.push({ patientId, item: si, key: `p${patientId}-${itemType}-${id}` });
          }
        }
      });
      (p.addedItems ?? []).forEach((item: any) => {
        const id = item?.id ?? item?.procedure?.id ?? item?.lab?.id ?? item?.inventoryItem?.id;
        if (id == null) return;
        const categoryName = item.categoryName ?? item.inventoryItem?.categoryName;
        const row = {
          id,
          name: item.name,
          price: item.price,
          itemType: item.itemType ?? item.type ?? 'procedure',
          code: item.code ?? item.procedure?.code ?? item.lab?.code ?? item.inventoryItem?.code,
          categoryName,
        };
        const si = rowToSearchableItem(row);
        if (si) {
          const itemType = (si.itemType ?? 'procedure').toString();
          pairs.push({ patientId, item: si, key: `p${patientId}-${itemType}-${id}` });
        }
      });
    });
    const seen = new Set<string>();
    const toFetch = pairs.filter(({ key }) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const firstPid =
      patients.length > 0 ? Number(patients[0]?.patientId ?? patients[0]?.patient?.id ?? 0) : NaN;
    const storePricingPromises =
      !Number.isNaN(firstPid) && firstPid > 0 && storeAdditionalItems.length > 0
        ? storeAdditionalItems.map((product, idx) => {
            const key = getStoreItemPricingCacheKey(firstPid, product, idx);
            const species = speciesByPatientId.get(Number(firstPid));
            const catalogItem =
              product.inventoryItemId != null
                ? { inventoryItem: { id: product.inventoryItemId } }
                : product.procedureId != null
                  ? { procedure: { id: product.procedureId } }
                  : undefined;
            return checkItemPricingPublic({
              token: tokenValue,
              patientId: firstPid,
              practiceId,
              clientId,
              ...(species ? { species } : {}),
              itemType: product.catalogItemType ?? 'inventory',
              ...(catalogItem ? { item: catalogItem } : {}),
              ...(product.fulfillment === 'ship'
                ? { customPrice: Number(product.shipPrice ?? product.price) }
                : {}),
              customName: product.name,
            })
              .then((res) => ({ key, res }))
              .catch(() => ({ key, res: null as CheckItemPricingResponse | null }));
          })
        : [];
    if (toFetch.length === 0 && storePricingPromises.length === 0) return;
    let pricingFetchCancelled = false;
    const requests = toFetch.map(({ patientId, item, key }) => {
      const payload = buildPricingItemPayload(item);
      if (!payload) return Promise.resolve({ key, res: null as CheckItemPricingResponse | null });
      const itemType = (item.itemType ?? 'procedure').toString();
      const species = speciesByPatientId.get(Number(patientId));
      return checkItemPricingPublic({
        token: tokenValue,
        patientId,
        practiceId,
        clientId,
        ...(species ? { species } : {}),
        itemType,
        item: payload,
      })
        .then((res) => ({ key, res }))
        .catch(() => ({ key, res: null as CheckItemPricingResponse | null }));
    });
    Promise.all([...requests, ...storePricingPromises]).then((results) => {
      if (pricingFetchCancelled) return;
      const next: Record<string, CheckItemPricingResponse | null> = {};
      results.forEach(({ key, res }) => {
        next[key] = res;
      });
      setClientPricingCache((prev) => ({ ...prev, ...next }));
    });
    return () => {
      pricingFetchCancelled = true;
    };
  }, [token, data, data?.patients, configCatalogItems, storeAdditionalItems, pricingRefreshKey]);

  /** Load the full public store catalog once (same path as the online storefront). */
  useEffect(() => {
    let cancelled = false;
    const pid = Number(practiceId) || 1;
    void publicStoreProducts(pid, undefined, undefined, token || undefined)
      .then((rows) => {
        if (!cancelled) setStoreCatalog(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setStoreCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, token]);

  /** Type-ahead over the practice's online store listings; the catalog call only supplies clinic prices. */
  useEffect(() => {
    const q = storeSearchQuery.trim();
    if (q.length < 2) {
      setStoreSearchResults([]);
      setStoreSearchError(null);
      setStoreSearchLoading(false);
      return;
    }
    setStoreSearchLoading(true);
    setStoreSearchError(null);
    const timeoutId = window.setTimeout(() => {
      const pid = Number(practiceId) || 1;
      const fromCatalog = (storeCatalog ?? []).filter(
        (listing) => fuzzyScoreQuery(q, storeListingSearchText(listing)) > 0
      );
      const catalogSearch = searchItemsPublic({ q, practiceId: pid, limit: 50, code: q }).catch(
        () => [] as SearchableItem[]
      );
      const storeSearch =
        fromCatalog.length > 0
          ? Promise.resolve(fromCatalog)
          : publicStoreProducts(pid, q, undefined, token || undefined).catch(() => [] as StoreListing[]);
      Promise.all([storeSearch, catalogSearch])
        .then(([storeRows, catalogItems]) => {
          // The catalog call is only here to price the bring-to-visit option. Catalog rows are
          // deliberately NOT offered as results: the client can only order what the practice
          // put on the online store, and the raw catalog holds in-clinic-only items and
          // internal lines such as negative-price rebates.
          setStoreCatalogPrices(indexCatalogPrices(catalogItems));
          const seenIds = new Set<string>();
          const listings: StoreListing[] = [];
          for (const listing of storeRows || []) {
            const id = String(listing.listingId || listing.name);
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            listings.push(listing);
          }
          setStoreSearchResults(listings);
          setStoreSearchError(null);
        })
        .catch(() => {
          setStoreSearchResults([]);
          setStoreSearchError('Could not search the store. Try again in a moment.');
        })
        .finally(() => setStoreSearchLoading(false));
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [storeSearchQuery, practiceId, token, storeCatalog]);

  /** When a product is opened, refresh clinic (catalog) prices for its variants. */
  useEffect(() => {
    if (!storeOptionModalGroup?.length) return;
    const name = storeOptionModalGroup[0].name;
    if (!name) return;
    const pid = Number(practiceId) || 1;
    let cancelled = false;
    void searchItemsPublic({ q: name, practiceId: pid, limit: 25, code: name })
      .then((items) => {
        if (cancelled || !items.length) return;
        setStoreCatalogPrices((prev) => {
          const next = new Map(prev);
          indexCatalogPrices(items).forEach((price, key) => next.set(key, price));
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storeOptionModalGroup, practiceId]);

  /**
   * Whether this practice actually has an online store to search. `storeCatalog` is null while
   * loading and an empty array when the store is off or nothing is listed; in that case the
   * search box could only ever come back empty, so the form asks in free text instead.
   */
  const storeStocked = storeCatalog != null && storeCatalog.length > 0;
  const storeCatalogLoading = storeCatalog == null;

  /** Group store listings by product name; sort by fuzzy match to the query. */
  const storeSearchResultsByName = useMemo(() => {
    const query = storeSearchQuery.trim().toLowerCase();
    const sorted = query
      ? [...storeSearchResults].sort((a, b) => {
          const textA = `${a.name || ''} ${a.variants?.map((v) => v.code || '').join(' ') || ''}`.trim();
          const textB = `${b.name || ''} ${b.variants?.map((v) => v.code || '').join(' ') || ''}`.trim();
          return fuzzyScoreQuery(storeSearchQuery, textB) - fuzzyScoreQuery(storeSearchQuery, textA);
        })
      : storeSearchResults;
    const map = new Map<string, StoreListing[]>();
    for (const listing of sorted) {
      const name = listing.name || 'Unnamed';
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(listing);
    }
    return Array.from(map.entries());
  }, [storeSearchResults, storeSearchQuery]);

  /** Get client-adjusted pricing from cache (discounts/membership). */
  const getClientPricing = (patientId: number, item: SearchableItem | null): CheckItemPricingResponse | null => {
    if (!item) return null;
    const id = getItemId(item);
    if (id == null) return null;
    const itemType = (item.itemType ?? 'procedure').toString();
    return clientPricingCache[`p${patientId}-${itemType}-${id}`] ?? null;
  };
  /**
   * Price to show for labs/vaccines/commonly selected items: prefer wellness/membership-adjusted unit price when
   * check-item-pricing embeds it (e.g. percentage off out-of-plan services). Top-level `adjustedPrice` can still
   * reflect catalog price until backend merges; mirrors `resolveSummaryLinePrice` for reminder rows.
   */
  const getClientAdjustedPrice = (patientId: number, item: SearchableItem | null): number | null => {
    const pricing = getClientPricing(patientId, item);
    const picked = pickAdjustedUnitPriceFromCheckResponse(pricing);
    if (picked != null) return picked;
    if (pricing?.wellnessPlanPricing?.hasCoverage === true) {
      const covered = Number(pricing.wellnessPlanPricing.adjustedPrice);
      if (Number.isFinite(covered)) return covered;
      return 0;
    }
    return getSearchItemPrice(item);
  };

  /** Membership-adjusted unit price for store additional items. */
  const getStoreAdjustedPrice = (patientId: number, product: RoomLoaderStoreProduct, index: number): number | null => {
    const pricing = clientPricingCache[getStoreItemPricingCacheKey(patientId, product, index)] ?? null;
    const picked = pickAdjustedUnitPriceFromCheckResponse(pricing);
    if (picked != null) return picked;
    const raw = Number(product.price);
    return Number.isFinite(raw) ? raw : null;
  };

  const getStoreItemPricing = (patientId: number, product: RoomLoaderStoreProduct, index: number): CheckItemPricingResponse | null => {
    return clientPricingCache[getStoreItemPricingCacheKey(patientId, product, index)] ?? null;
  };

  function setStoreItemQuantity(index: number, next: number) {
    if (readOnly) return;
    const clamped = Math.max(1, Math.min(99, Math.floor(next)));
    setStoreAdditionalItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantity: clamped } : item))
    );
  }

  /** Human-readable note for why a price was discounted (membership plan and/or client discount), or why full price applies. */
  const getDiscountNote = (pricing: CheckItemPricingResponse | { wellnessPlanPricing?: any; discountPricing?: any; } | null): string | null => {
    if (!pricing) return null;
    const parts: string[] = [];
    const wp = pricing.wellnessPlanPricing;
    const dp = pricing.discountPricing;
    // Membership quantity already used — full price applies
    if (wp?.hasCoverage && wp.isWithinLimit === false) {
      return MEMBERSHIP_ALLOTMENT_USED_LABEL;
    }
    const hasWellness = wp ? wellnessPlanHasDiscountSignal(wp) : false;
    const hasDiscount = dp?.priceAdjustedByDiscount;
    if (hasWellness && wp) {
      if (wp.adjustedPrice === 0) {
        parts.push('Included in Membership');
      } else {
        parts.push(`Membership: $${Number(wp.originalPrice).toFixed(2)} → $${Number(wp.adjustedPrice).toFixed(2)}`);
      }
    }
    if (hasDiscount && dp?.clientDiscounts) {
      const reason =
        dp.clientDiscounts.staffItemDiscount?.label
          ? dp.clientDiscounts.staffItemDiscount.label
          : dp.clientDiscounts.clientStatusDiscount?.clientStatusName
          ? `${dp.clientDiscounts.clientStatusDiscount.clientStatusName} discount`
          : dp.clientDiscounts.personalDiscount
            ? 'Personal discount'
            : 'Client discount';
      const amount =
        dp.discountAmount != null
          ? `$${dp.discountAmount.toFixed(2)} off`
          : dp.discountPercentage != null
            ? `${dp.discountPercentage.toFixed(1)}% off`
            : '';
      parts.push(amount ? `${amount} — ${reason}` : reason);
    } else if (hasDiscount) {
      const amount =
        dp!.discountAmount != null
          ? `$${dp!.discountAmount!.toFixed(2)} off`
          : dp!.discountPercentage != null
            ? `${dp!.discountPercentage!.toFixed(1)}% off`
            : '';
      parts.push(amount || 'Discount applied');
    }
    return parts.length > 0 ? parts.join('. ') : null;
  };

  /** Short line for Additional items list: membership / client discount or savings vs list price. */
  const getStoreItemDiscountDescription = (pricing: CheckItemPricingResponse | null): string | null => {
    if (!pricing) return null;
    const fromNote = getDiscountNote(pricing);
    if (fromNote) return fromNote;
    const o = Number(pricing.originalPrice);
    const a = pickAdjustedUnitPriceFromCheckResponse(pricing) ?? Number(pricing.adjustedPrice);
    if (Number.isFinite(o) && Number.isFinite(a) && o > a + 0.005) {
      const pct = o > 0 ? Math.round((1 - a / o) * 100) : 0;
      return `You save $${(o - a).toFixed(2)}${pct > 0 ? ` (${pct}% off)` : ''}`;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="public-room-loader public-room-loader-loading" style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Loading room loader form...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-room-loader public-room-loader-error" style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ color: '#dc3545' }}>Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="public-room-loader public-room-loader-error" style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2>No data available</h2>
      </div>
    );
  }

  // When submitStatus === 'completed', show thank you page (no PDF preview)
  if (formAlreadySubmitted && data.responseFromClient) {
    const clientPortalUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/client-portal`;
    return (
      <div className="public-room-loader public-room-loader-thank-you" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div className="public-room-loader-thank-you-inner" style={{ backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ marginBottom: '14px', fontSize: '48px' }}>✓</div>
          <h1 style={{ margin: '0 0 6px', fontSize: '26px', fontWeight: 700, color: '#1a1a1a' }}>
            Thank you
          </h1>
          <p style={{ margin: '0 0 6px', fontSize: '16px', color: '#444', lineHeight: 1.4 }}>
            Your Pre-Visit Check-In has been submitted.
          </p>
          <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#666', lineHeight: 1.4 }}>
            Our team has received your form. A copy was emailed to you with a PDF attachment for your records.
          </p>
          <p style={{ margin: '0 0 6px', fontSize: '15px', color: '#444', lineHeight: 1.4, textAlign: 'left', fontWeight: 700 }}>
            Want to spread out the cost of care while getting even more support and benefits?
          </p>
          <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#555', lineHeight: 1.4, textAlign: 'left' }}>
            Memberships allow you to turn wellness care into easy monthly payments while giving you priority scheduling with your dedicated One Team and priority 7-day support from VAYD staff. Members also save 50% on additional exams and get member pricing in our online store. You can explore membership options in your Client Portal. To apply membership benefits to this visit, enrollment should be completed before your appointment.
          </p>
          <div className="public-room-loader-thank-you-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
            {token && (
              <a
                href={`${apiBaseUrl}/public/room-loader/pdf?token=${encodeURIComponent(token)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="public-room-loader-thank-you-btn public-room-loader-thank-you-btn-pdf"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '48px',
                  padding: '14px 24px',
                  fontSize: '16px',
                  fontWeight: 600,
                  backgroundColor: '#1a1a1a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                  textDecoration: 'none',
                }}
              >
                View PDF
              </a>
            )}
            <a
              href={clientPortalUrl}
              className="public-room-loader-thank-you-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '48px',
                padding: '14px 28px',
                fontSize: '16px',
                fontWeight: 600,
                backgroundColor: '#0d6efd',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(13, 110, 253, 0.35)',
                textDecoration: 'none',
              }}
            >
              Visit your Client Portal
            </a>
          </div>
        </div>
      </div>
    );
  }

  const firstPatient = patients[0];
  const firstAppt = appointments[0];

  const appointmentDate = firstAppt?.appointmentStart ? formatDate(firstAppt.appointmentStart) : '____';
  // Support both { start, end } and { windowStartIso, windowEndIso } / { windowStartLocal, windowEndLocal }
  const aw = firstPatient?.arrivalWindow;
  const arrivalStartIso = aw?.start ?? aw?.windowStartIso;
  const arrivalEndIso = aw?.end ?? aw?.windowEndIso;
  const arrivalWindowStart = arrivalStartIso ? formatTime(arrivalStartIso) : (aw?.windowStartLocal ?? '____');
  const arrivalWindowEnd = arrivalEndIso ? formatTime(arrivalEndIso) : (aw?.windowEndLocal ?? '____');

  const nPets = patients.length;
  const firstCarePlanPage = nPets > 0 ? nPets + 1 : 1;
  const lastCheckInPage = nPets;
  const firstLabPage = nPets > 0 ? 2 * nPets + 1 : 1;
  const lastLabPage = nPets > 0 ? 3 * nPets : 0;
  const summaryPageIndex = nPets > 0 ? 3 * nPets + 1 : 1;
  const isCheckInPage = nPets > 0 && currentPage >= 1 && currentPage <= lastCheckInPage;
  const checkInPetIndex = isCheckInPage ? currentPage - 1 : 0;
  const isLabsPage = nPets > 0 && currentPage >= firstLabPage && currentPage <= lastLabPage;
  const labsPetIndex = isLabsPage ? currentPage - firstLabPage : 0;
  const isSummaryPage = nPets > 0 && currentPage === summaryPageIndex;
  const isLastLabsPet = isLabsPage && currentPage === lastLabPage;
  const isFirstLabsPet = isLabsPage && currentPage === firstLabPage;

  const configCatalogItem = (ref: { itemType: string; itemId: number }): SearchableItem | null =>
    configCatalogItems[`${ref.itemType}:${ref.itemId}`] ?? null;

  /** Catalog list price, then membership / client-discount amount when they differ. */
  const priceForPatient =
    (patientId: number | string) =>
    (ref: { itemType: string; itemId: number }) => {
      const item = configCatalogItem(ref);
      if (!item) return null;
      const list = getSearchItemPrice(item);
      const pricing = getClientPricing(Number(patientId), item);
      const allotmentUsed =
        pricing?.wellnessPlanPricing?.hasCoverage === true &&
        pricing.wellnessPlanPricing.isWithinLimit === false;
      const adjusted = getClientAdjustedPrice(Number(patientId), item);
      return roomLoaderPriceLabel(list, adjusted, { allotmentUsed });
    };

  /** Practice-configured "why we recommend" for an unchecked row, else the built-in copy. */
  const uncheckRecommendation = (item: any): { html?: string; plainBody?: string } | null => {
    const html = configuredUncheckRecommendationHtml(item, roomLoaderConfig.declineReasons);
    if (html) return { html };
    const plainBody = carePlanUncheckRecommendationBody(carePlanRowCode(item));
    return plainBody ? { plainBody } : null;
  };

  const recommendedItemsByPet: any[][] = patients.map((patient: any) =>
    dedupeSharpsRowsInPetLineItems(buildPublicPetLineItems(patient))
  );

  // Flow: pages 1..N check-in, N+1..2N care plan, 2N+1..3N labs, 3N+1 summary.
  const isCarePlanPage = nPets > 0 && currentPage >= firstCarePlanPage && currentPage <= 2 * nPets;
  const carePlanPetIndex = isCarePlanPage ? currentPage - firstCarePlanPage : 0;
  const currentCarePlanPatient = isCarePlanPage ? patients[carePlanPetIndex] : null;
  const currentPetRecommendedItems = currentCarePlanPatient != null ? recommendedItemsByPet[carePlanPetIndex] ?? [] : [];
  const isLastCarePlanPet = isCarePlanPage && currentPage === 2 * nPets;
  const isFirstCarePlanPet = isCarePlanPage && currentPage === firstCarePlanPage;

  // Check if cat and age conditions

  const sectionLabelStyle = { marginBottom: '6px', color: '#555', fontSize: '17px', fontWeight: 600 } as const;
  const questionLabelStyle = { display: 'block', marginBottom: '6px', fontWeight: 500, color: '#333', fontSize: '15px' } as const;
  const textareaStyle = {
    width: '100%',
    minHeight: '64px',
    padding: '8px 10px',
    border: '1px solid #c5d8f0',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical' as const,
    backgroundColor: '#eef6ff',
    boxSizing: 'border-box' as const,
  };
  const readOnly = formAlreadySubmitted;

  const checkInPatientForPage = isCheckInPage ? patients[checkInPetIndex] : null;
  const checkInApptForPage =
    checkInPatientForPage != null
      ? getAppointmentForRoomLoaderPet(appointments, checkInPatientForPage, checkInPetIndex)
      : null;
  const checkInPetName = checkInPatientForPage?.patientName || `Pet ${checkInPetIndex + 1}`;
  const checkInAppointmentDate = checkInApptForPage?.appointmentStart
    ? formatDate(checkInApptForPage.appointmentStart)
    : appointmentDate;
  const checkInAw = checkInPatientForPage?.arrivalWindow;
  const checkInArrivalStartIso = checkInAw?.start ?? checkInAw?.windowStartIso;
  const checkInArrivalEndIso = checkInAw?.end ?? checkInAw?.windowEndIso;
  const checkInArrivalStart = checkInArrivalStartIso
    ? formatTime(checkInArrivalStartIso)
    : (checkInAw?.windowStartLocal ?? '____');
  const checkInArrivalEnd = checkInArrivalEndIso ? formatTime(checkInArrivalEndIso) : (checkInAw?.windowEndLocal ?? '____');
  const checkInArrivalSame = checkInArrivalStart !== '____' && checkInArrivalStart === checkInArrivalEnd;

  return (
    <div className="public-room-loader">
      {readOnly && (
        <div
          style={{
            marginBottom: '11px',
            padding: '14px 18px',
            backgroundColor: '#e7f3ff',
            border: '1px solid #0d6efd',
            borderRadius: '8px',
            color: '#0a58ca',
            fontSize: '16px',
            fontWeight: 500,
          }}
          role="alert"
        >
          This form has already been submitted. Your answers are shown for your records only. No changes can be saved.
        </div>
      )}
      {/* Check-in — one page per pet */}
      {isCheckInPage && checkInPatientForPage != null && (
        <div className="public-room-loader-form-page">
          <div className="public-room-loader-page-label" style={{ position: 'absolute', top: '14px', right: '14px', fontSize: '13px', color: '#666' }}>
            {nPets > 1
              ? `Check-in — ${checkInPetName} (${checkInPetIndex + 1} of ${nPets})`
              : `PAGE ${currentPage}`}
          </div>

          <div style={{ marginBottom: '10px', paddingBottom: '12px', borderBottom: '3px solid #e0e0e0' }}>
            <div style={{ marginBottom: '10px', textAlign: 'center' }}>
              <img
                src="/final_thick_lines_cropped.jpeg"
                alt="VAYD"
                style={{
                  height: '44px',
                  width: 'auto',
                  opacity: 0.92,
                  mixBlendMode: 'multiply',
                  display: 'inline-block',
                  verticalAlign: 'middle',
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
            <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>
              Time to Check-in for your Appointment
            </h1>
            <p style={{ fontSize: '16px', lineHeight: '1.42', color: '#555', marginTop: '7px', marginBottom: '8px' }}>
              We are looking forward to {checkInPetName}&apos;s appointment on {checkInAppointmentDate}.
            </p>
            <p style={{ fontSize: '16px', lineHeight: '1.42', color: '#555', marginBottom: '8px' }}>
              Window of arrival:{' '}
              {checkInArrivalSame ? checkInArrivalStart : `${checkInArrivalStart} – ${checkInArrivalEnd}`}
            </p>
            <p style={{ fontSize: '16px', lineHeight: '1.42', color: '#555', marginBottom: '0' }}>
              To best prepare for your appointment, please answer the questions below. We&apos;ll give you an estimate of costs after you answer some questions.
            </p>
          </div>

          {(() => {
            const patient: any = checkInPatientForPage;
            const petIdx = checkInPetIndex;
            const petKey = `pet${petIdx}`;
            const petName = patient.patientName || `Pet ${petIdx + 1}`;
            const apptRowCheckin = getAppointmentForRoomLoaderPet(appointments, patient, petIdx);
            // Show new-patient questions when: not explicitly marked as not new, no reminders (not established in wellness), and either API marks as new or neither source says false (treat missing/undefined as possibly new).
            const markedNewByApi = patient.isNewPatient === true || apptRowCheckin?.isNewPatient === true;
            const explicitlyNotNew = patient.isNewPatient === false || apptRowCheckin?.isNewPatient === false;
            const hasReminders = Array.isArray(patient.reminders) && patient.reminders.length > 0;
            const treatAsNewWhenNoReminders = patient.isNewPatient !== false && apptRowCheckin?.isNewPatient !== false;
            const isNewPatient = !explicitlyNotNew && (markedNewByApi || (!hasReminders && treatAsNewWhenNoReminders));
            const appointmentReasonDisplay =
              patient.appointmentReason ??
              (apptRowCheckin && (apptRowCheckin.description || apptRowCheckin.instructions)) ??
              '(RL-APPT-REASON)';

            return (
              <div
                key={petIdx}
                style={{
                  marginBottom: '10px',
                  padding: '12px',
                  backgroundColor: '#fff',
                  border: '2px solid #ddd',
                  borderRadius: '8px',
                }}
              >
                <div style={{ marginBottom: '14px', paddingBottom: '9px', borderBottom: '3px solid #e0e0e0' }}>
                  <h3 style={{ margin: 0, color: '#212529', fontSize: '20px', fontWeight: 700 }}>
                    Pet {petIdx + 1}: {petName}
                  </h3>
                  <RoomLoaderPatientMemberBadge patient={patient} appointments={appointments} />
                </div>

                <div style={{ marginBottom: '11px' }}>
                  <h4 style={sectionLabelStyle}>Reason for Appointment</h4>
                  <div style={{ padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd', marginBottom: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px', fontWeight: 500 }}>You told us:</div>
                    <div style={{ fontSize: '14px', color: '#333' }}>{appointmentReasonDisplay}</div>
                  </div>
                  <label style={questionLabelStyle}>Do you want to share any additional details about the reason for this visit?</label>
                  <textarea
                    value={formData[`${petKey}_appointmentReason`] || ''}
                    onChange={(e) => handleInputChange(`${petKey}_appointmentReason`, e.target.value)}
                    readOnly={readOnly}
                    disabled={readOnly}
                    style={{ ...textareaStyle, minHeight: '100px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                    placeholder="Please provide more details..."
                  />
                </div>

                {(patient.questions?.mobility === true) && (
                  <div style={{ marginBottom: '11px' }}>
                    <h4 style={sectionLabelStyle}>Mobility</h4>
                    <label style={questionLabelStyle}>
                      It sounds like you may have some concerns about {petName}&apos;s mobility. Can you tell us more about what you&apos;re noticing?
                    </label>
                    <textarea
                      value={formData[`${petKey}_mobilityDetails`] || ''}
                      onChange={(e) => handleInputChange(`${petKey}_mobilityDetails`, e.target.value)}
                      readOnly={readOnly}
                      disabled={readOnly}
                      style={{ ...textareaStyle, minHeight: '100px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                      placeholder="Please describe what you're noticing..."
                    />
                  </div>
                )}

                <div style={{ marginBottom: '11px' }}>
                  <h4 style={sectionLabelStyle}>General Well-being & Concerns</h4>
                  <label style={questionLabelStyle}>
                    Is {petName} eating, drinking, defecating, and urinating normally?{' '}
                    <span style={{ color: '#dc3545' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: readOnly ? 'default' : 'pointer', fontSize: '16px' }}>
                      <input type="radio" name={`${petKey}_eatingDrinkingNormal`} value="yes" checked={formData[`${petKey}_eatingDrinkingNormal`] === 'yes'} onChange={(e) => handleInputChange(`${petKey}_eatingDrinkingNormal`, e.target.value)} disabled={readOnly} style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }} />
                      Yes
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: readOnly ? 'default' : 'pointer', fontSize: '16px' }}>
                      <input type="radio" name={`${petKey}_eatingDrinkingNormal`} value="no" checked={formData[`${petKey}_eatingDrinkingNormal`] === 'no'} onChange={(e) => handleInputChange(`${petKey}_eatingDrinkingNormal`, e.target.value)} disabled={readOnly} style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }} />
                      No
                    </label>
                  </div>
                  {fieldValidationErrors[`${petKey}_eatingDrinkingNormal`] && (
                    <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_eatingDrinkingNormal`]}</p>
                  )}
                  {formData[`${petKey}_eatingDrinkingNormal`] === 'no' && (
                    <>
                      <label style={questionLabelStyle}>Please describe. <span style={{ color: '#dc3545' }}>*</span></label>
                      <textarea
                        value={formData[`${petKey}_eatingDrinkingNormalDetails`] || ''}
                        onChange={(e) => handleInputChange(`${petKey}_eatingDrinkingNormalDetails`, e.target.value)}
                        readOnly={readOnly}
                        disabled={readOnly}
                        style={{ ...textareaStyle, minHeight: '100px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                        placeholder="Describe any issues with eating, drinking, or elimination..."
                      />
                      {fieldValidationErrors[`${petKey}_eatingDrinkingNormalDetails`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_eatingDrinkingNormalDetails`]}</p>
                      )}
                    </>
                  )}
                  <label style={{ ...questionLabelStyle, marginTop: '10px' }}>
                    How is {petName} doing otherwise? Are there any other concerns you'd like us to address during this visit?
                  </label>
                  <textarea
                    value={formData[`${petKey}_generalWellbeing`] || ''}
                    onChange={(e) => handleInputChange(`${petKey}_generalWellbeing`, e.target.value)}
                    readOnly={readOnly}
                    disabled={readOnly}
                    style={{ ...textareaStyle, ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                    placeholder="How is your pet doing? Any other concerns?"
                  />
                </div>

                {isNewPatient && (
                  <>
                    <div style={{ marginBottom: '11px' }}>
                      <h4 style={sectionLabelStyle}>New Patient – Behavior</h4>
                      <p style={{ fontSize: '15px', lineHeight: '1.42', color: '#555', marginBottom: '8px' }}>
                        Since we haven't met {petName} before, it helps to know a bit about their behavior (aligned with our Fear Free™ approach).
                      </p>
                      <label style={questionLabelStyle}>Describe {petName}'s behavior at home, around strangers, and at a typical vet office. <span style={{ color: '#dc3545' }}>*</span></label>
                      <textarea value={formData[`${petKey}_newPatientBehavior`] || ''} onChange={(e) => handleInputChange(`${petKey}_newPatientBehavior`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, minHeight: '120px', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="Describe your pet's behavior..." />
                      {fieldValidationErrors[`${petKey}_newPatientBehavior`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_newPatientBehavior`]}</p>
                      )}
                    </div>
                    <div style={{ marginBottom: '11px' }}>
                      <h4 style={sectionLabelStyle}>Feeding</h4>
                      <label style={questionLabelStyle}>What are you feeding {petName}? (brand, amount, frequency)</label>
                      <textarea value={formData[`${petKey}_feeding`] || ''} onChange={(e) => handleInputChange(`${petKey}_feeding`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="What are you feeding your pet?" />
                    </div>
                    <div style={{ marginBottom: '11px' }}>
                      <h4 style={sectionLabelStyle}>Food Allergies <span style={{ color: '#dc3545' }}>*</span></h4>
                      <label style={questionLabelStyle}>Do you or {petName} have any food allergies? (we like to bribe!)</label>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '16px' }}>
                          <input type="radio" name={`${petKey}_foodAllergies`} value="yes" checked={formData[`${petKey}_foodAllergies`] === 'yes'} onChange={(e) => handleInputChange(`${petKey}_foodAllergies`, e.target.value)} disabled={readOnly} style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }} />
                          Yes
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: readOnly ? 'default' : 'pointer', fontSize: '16px' }}>
                          <input type="radio" name={`${petKey}_foodAllergies`} value="no" checked={formData[`${petKey}_foodAllergies`] === 'no'} onChange={(e) => handleInputChange(`${petKey}_foodAllergies`, e.target.value)} disabled={readOnly} style={{ marginRight: '8px', cursor: readOnly ? 'default' : 'pointer' }} />
                          No
                        </label>
                      </div>
                      {fieldValidationErrors[`${petKey}_foodAllergies`] && (
                        <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_foodAllergies`]}</p>
                      )}
                      {formData[`${petKey}_foodAllergies`] === 'yes' && (
                        <>
                          <label style={questionLabelStyle}>If yes, what are they? <span style={{ color: '#dc3545' }}>*</span></label>
                          <textarea value={formData[`${petKey}_foodAllergiesDetails`] || ''} onChange={(e) => handleInputChange(`${petKey}_foodAllergiesDetails`, e.target.value)} readOnly={readOnly} disabled={readOnly} style={{ ...textareaStyle, ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }} placeholder="Please describe..." />
                          {fieldValidationErrors[`${petKey}_foodAllergiesDetails`] && (
                            <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{fieldValidationErrors[`${petKey}_foodAllergiesDetails`]}</p>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px', paddingTop: '12px', borderTop: '2px solid #e0e0e0' }}>
            <button
              type="button"
              onClick={() => {
                const v = validateRequiredForCheckInPet(checkInPetIndex);
                if (!v.valid) {
                  setFieldValidationErrors(v.errors || {});
                  return;
                }
                setFieldValidationErrors({});
                if (checkInPetIndex < nPets - 1) {
                  setCurrentPage(currentPage + 1);
                } else {
                  setCurrentPage(firstCarePlanPage);
                }
              }}
              style={{
                padding: '12px 28px',
                backgroundColor: '#0d6efd',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {nPets > 1 && checkInPetIndex < nPets - 1 ? 'Next pet →' : 'Continue to Care Plan →'}
            </button>
          </div>
        </div>
      )}

      {/* Veterinary Care Plan — one page per pet when multiple pets */}
      {isCarePlanPage && currentCarePlanPatient != null && (
        <div className="public-room-loader-form-page" style={{
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: '14px', right: '14px', fontSize: '13px', color: '#666' }}>
            {patients.length > 1
              ? `Care Plan — ${currentCarePlanPatient.patientName || `Pet ${carePlanPetIndex + 1}`} (${carePlanPetIndex + 1} of ${patients.length})`
              : `PAGE ${firstCarePlanPage}`}
          </div>

          <div style={{ marginBottom: '14px', paddingBottom: '9px', borderBottom: '3px solid #e0e0e0' }}>
            <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>
              Veterinary Care Plan{patients.length > 1 ? ` — ${currentCarePlanPatient.patientName || `Pet ${carePlanPetIndex + 1}`}` : ''}
            </h1>
            <RoomLoaderPatientMemberBadge patient={currentCarePlanPatient} appointments={appointments} />
          </div>

          <div style={{ marginBottom: '11px' }}>
            <h4 style={sectionLabelStyle}>
              The following items are recommended for {currentCarePlanPatient?.patientName || `Pet ${carePlanPetIndex + 1}`}'s upcoming visit.
            </h4>
            <p style={{ fontSize: '14px', color: '#555', marginTop: '4px', marginBottom: '8px' }}>
              (Please uncheck any items you do not want)
            </p>
            {currentCarePlanPatient?.notesToClient?.trim() && (
              <div style={{ marginBottom: '10px', padding: '12px 16px', backgroundColor: '#e7f3ff', borderRadius: '6px', border: '1px solid #b6d4fe' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 600, color: '#0a58ca' }}>
                  Extra notes from your team about their recommendations:
                </h4>
                <p style={{ margin: 0, fontSize: '15px', color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {currentCarePlanPatient.notesToClient}
                </p>
              </div>
            )}
            {(() => {
              const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
              const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);
              const displayItems = currentPetRecommendedItems.filter(
                (item) => !hasPhrase(item, 'trip fee') && !hasPhrase(item, 'sharps')
              );
              if (displayItems.length === 0) {
                return <p style={{ color: '#666', fontStyle: 'italic', margin: 0 }}>No recommended items at this time.</p>;
              }
              const petKeyCp = `pet${carePlanPetIndex}`;
              const planCp = petPlans[carePlanPetIndex] ?? emptyPetPlan;
              const ctxCp = petPlanContexts[carePlanPetIndex] ?? emptyPlanContext;
              const carePlanPatientIdForPricing = Number(
                currentCarePlanPatient?.patientId ?? currentCarePlanPatient?.patient?.id ?? carePlanPetIndex
              );
              const acceptedPanelsCp = effectiveAcceptedPanelOptions(planCp, petKeyCp, formData);
              const panelReplacedLabelsCp = panelReplacementLabels(acceptedPanelsCp, ctxCp.estimateLines);
              const itemCategory = (item: any) => {
                const t = (item.type ?? item.itemType ?? 'procedure').toString().toLowerCase();
                if (t === 'lab' || t === 'laboratory') return 'lab';
                if (t === 'inventory') return 'inventory';
                return 'procedure';
              };
              // `originalIdx` is preserved so checkbox keys stay stable when rows are grouped by type.
              const sortedWithOriginalIdx = displayItems.map((item, originalIdx) => ({ item, originalIdx }));
              const procedureItems = sortedWithOriginalIdx.filter(({ item }) => itemCategory(item) === 'procedure');
              const labItems = sortedWithOriginalIdx.filter(({ item }) => itemCategory(item) === 'lab');
              const inventoryItems = sortedWithOriginalIdx.filter(({ item }) => itemCategory(item) === 'inventory');
              const CarePlanSeparator = () => <div style={{ height: '1px', backgroundColor: '#e0e0e0', margin: '6px 0' }} />;
              const renderRow = ({ item, originalIdx }: { item: any; originalIdx: number }, displayIdx: number, groupLength: number) => {
                const isVisitOrConsult = hasPhrase(item, 'visit') || hasPhrase(item, 'consult');
                const replacedByLabel = rowReplacedByPanel(item, panelReplacedLabelsCp);
                const isReplacedForItem = replacedByLabel != null;
                const recKey = publicFormCarePlanRecKey(carePlanPetIndex, item, originalIdx);
                const isChecked = isReplacedForItem
                  ? false
                  : isVisitOrConsult || publicFormCarePlanRecRowChecked(formData, carePlanPetIndex, item, originalIdx);
                const disabled = isVisitOrConsult || isReplacedForItem;
                const uncheckBody =
                  !isChecked && !isReplacedForItem && !disabled
                    ? uncheckRecommendation(item)
                    : null;
                return (
                  <div
                    key={`cp-${carePlanPetIndex}-${originalIdx}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 0 }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderBottom: displayIdx < groupLength - 1 ? '1px solid #e0e0e0' : 'none',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={disabled || readOnly}
                        readOnly={disabled}
                        style={{ marginRight: '12px', width: '18px', height: '18px', cursor: disabled ? 'default' : 'pointer' }}
                        onChange={() => {
                          if (!disabled && !readOnly) handleInputChange(recKey, !isChecked);
                        }}
                      />
                      <span
                        style={{
                          fontSize: '16px',
                          ...(isReplacedForItem
                            ? { textDecoration: 'line-through', color: '#888' }
                            : !isChecked
                              ? { color: '#888' }
                              : { color: '#333' }),
                        }}
                      >
                        {item.name}
                        {isReplacedForItem && replacedByLabel ? (
                          <span style={{ fontSize: '13px', color: '#666', marginLeft: '8px', fontStyle: 'italic', textDecoration: 'none' }}>
                            Already combined in the {replacedByLabel} chosen
                          </span>
                        ) : null}
                      </span>
                      {(() => {
                        const qCare = effectivePublicMedicationInventoryQuantity(
                          formData,
                          carePlanPetIndex,
                          item,
                          originalIdx,
                          carePlanPatientIdForPricing,
                          getClientPricing
                        );
                        const showQtyLabel =
                          qCare > 1 ||
                          (publicFormInventoryRowAllowsClientQuantityFromPricing(
                            carePlanPatientIdForPricing,
                            item,
                            getClientPricing
                          ) &&
                            isChecked &&
                            !isReplacedForItem);
                        return showQtyLabel ? (
                          <span style={{ fontSize: '14px', color: '#666', marginLeft: '8px' }}>(Qty: {qCare})</span>
                        ) : null;
                      })()}
                    </div>
                    {uncheckBody ? <CarePlanWhyRecommendBlurb {...uncheckBody} /> : null}
                  </div>
                );
              };
              return (
                <div style={{ padding: '10px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd' }}>
                  {procedureItems.map((entry, i) => renderRow(entry, i, procedureItems.length))}
                  {procedureItems.length > 0 && (labItems.length > 0 || inventoryItems.length > 0) && <CarePlanSeparator />}
                  {labItems.map((entry, i) => renderRow(entry, i, labItems.length))}
                  {labItems.length > 0 && inventoryItems.length > 0 && <CarePlanSeparator />}
                  {inventoryItems.map((entry, i) => renderRow(entry, i, inventoryItems.length))}
                </div>
              );
            })()}
          </div>

          {/* Outdoor access and optional add-ons, from the practice's Room Loader configuration */}
          {currentCarePlanPatient != null && (() => {
            const petIdx = carePlanPetIndex;
            const petKey = `pet${petIdx}`;
            const petName = currentCarePlanPatient.patientName || `Pet ${petIdx + 1}`;
            const plan = petPlans[petIdx] ?? emptyPetPlan;
            const patientIdForCarePlan = Number(
              currentCarePlanPatient.patientId ?? currentCarePlanPatient.patient?.id ?? petIdx
            );
            const apptForCarePlan = getAppointmentForRoomLoaderPet(appointments, currentCarePlanPatient, petIdx);
            const labWorkYes = publicFormPetLabWorkConcernYes(formData, petKey, currentCarePlanPatient);
            const hideOffersForQOL = publicRoomLoaderAppointmentIsQOLExam(apptForCarePlan) && !labWorkYes;
            const gatedOffers = splitDedupedOffers(plan).gated;
            const gatedOffersConfigured = (roomLoaderConfig.gatedOffers ?? []).some((offer) => offer.enabled);
            const needsHistoryForGatedOffers =
              gatedOffersConfigured &&
              !hideOffersForQOL &&
              Number.isFinite(patientIdForCarePlan);
            const historyReady =
              !needsHistoryForGatedOffers ||
              treatmentHistoryReadyByPatientId[patientIdForCarePlan] === true;
            const optionalVaccinesPending =
              needsHistoryForGatedOffers &&
              treatmentHistoryReadyByPatientId[patientIdForCarePlan] !== true;
            const outdoorError = fieldValidationErrors[outdoorAccessKey(petKey)];
            return (
              <>
                {plan.askOutdoorAccess ? (
                  <div style={{ marginBottom: '11px' }}>
                    <OutdoorAccessQuestion
                      petKey={petKey}
                      petName={petName}
                      config={roomLoaderConfig.outdoor}
                      pitch={plan.outdoorPitch}
                      formData={formData}
                      onChange={handleInputChange}
                      priceFor={priceForPatient(patientIdForCarePlan)}
                      disabled={readOnly}
                    />
                    {outdoorError && (
                      <p style={{ marginTop: '6px', marginBottom: 0, fontSize: '13px', color: '#dc3545' }}>{outdoorError}</p>
                    )}
                  </div>
                ) : null}
                {optionalVaccinesPending ? (
                  <p
                    className="settings-muted"
                    style={{ margin: '0 0 11px', fontSize: '14px' }}
                    aria-live="polite"
                  >
                    Loading optional vaccines for {petName}…
                  </p>
                ) : null}
                {!hideOffersForQOL && historyReady && gatedOffers.length > 0 ? (
                  <div style={{ marginBottom: '11px' }}>
                    <OfferSection
                      petKey={petKey}
                      title={`Optional vaccines & add-ons for ${petName}`}
                      petName={petName}
                      offers={gatedOffers}
                      formData={formData}
                      onChange={handleInputChange}
                      priceFor={priceForPatient(patientIdForCarePlan)}
                      disabled={readOnly}
                    />
                  </div>
                ) : null}
                {!hideOffersForQOL && plan.itemQuestions.length > 0 ? (
                  <div style={{ marginBottom: '11px' }}>
                    <ItemQuestionsSection
                      petKey={petKey}
                      petName={petName}
                      questions={plan.itemQuestions}
                      formData={formData}
                      onChange={handleInputChange}
                      errors={fieldValidationErrors}
                      disabled={readOnly}
                    />
                  </div>
                ) : null}
              </>
            );
          })()}

          {fieldValidationErrors[`pet${carePlanPetIndex}_optionalVaccinesLoading`] && (
            <p
              style={{
                marginBottom: '10px',
                padding: '12px',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '6px',
                color: '#856404',
                fontSize: '14px',
              }}
            >
              {fieldValidationErrors[`pet${carePlanPetIndex}_optionalVaccinesLoading`]}
            </p>
          )}

          <div className="public-room-loader-nav-buttons">
            <button
              type="button"
              className="public-room-loader-btn"
              onClick={() => setCurrentPage(isFirstCarePlanPet ? lastCheckInPage : currentPage - 1)}
              style={{
                backgroundColor: '#fff',
                color: '#333',
                border: '1px solid #ced4da',
                cursor: 'pointer',
              }}
            >
              {isFirstCarePlanPet ? '← Back to Check-in' : '← Previous pet'}
            </button>
            {isLastCarePlanPet ? (
              <button
                type="button"
                className="public-room-loader-btn"
                onClick={() => {
                  const v = validateRequiredForCarePlanPet(carePlanPetIndex);
                  if (!v.valid) {
                    setFieldValidationErrors(v.errors || {});
                    scrollToFirstFormFieldError(v.errors);
                    return;
                  }
                  setFieldValidationErrors({});
                  setCurrentPage(firstLabPage);
                }}
                style={{
                  backgroundColor: '#0d6efd',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Next: Labs We Recommend →
              </button>
            ) : (
              <button
                type="button"
                className="public-room-loader-btn"
                onClick={() => {
                  const v = validateRequiredForCarePlanPet(carePlanPetIndex);
                  if (!v.valid) {
                    setFieldValidationErrors(v.errors || {});
                    scrollToFirstFormFieldError(v.errors);
                    return;
                  }
                  setFieldValidationErrors({});
                  setCurrentPage(currentPage + 1);
                }}
                style={{
                  backgroundColor: '#0d6efd',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Next pet →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Labs We Recommend — one page per pet */}
      {/* Labs We Recommend — one page per pet, built from the practice's configured panel rules */}
      {isLabsPage && (
        <div className="public-room-loader-form-page" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: '14px', right: '14px', fontSize: '13px', color: '#666' }}>
            {nPets > 1
              ? `Labs — ${patients[labsPetIndex]?.patientName ?? `Pet ${labsPetIndex + 1}`} (${labsPetIndex + 1} of ${nPets})`
              : `PAGE ${currentPage}`}
          </div>

          {(() => {
            const labsPatient = patients[labsPetIndex];
            if (labsPatient == null) return null;
            const petKey = `pet${labsPetIndex}`;
            const petName = labsPatient.patientName || `Pet ${labsPetIndex + 1}`;
            const plan = petPlans[labsPetIndex] ?? emptyPetPlan;
            const ctx = petPlanContexts[labsPetIndex] ?? emptyPlanContext;
            const patientIdForLabs = Number(labsPatient.patientId ?? labsPatient.patient?.id ?? labsPetIndex);
            if (labsPageIsEmpty(plan)) {
              return (
                <p style={{ margin: 0, color: '#666', fontStyle: 'italic' }}>
                  No additional lab work is recommended for {petName} today.
                </p>
              );
            }
            return (
              <RoomLoaderLabsPage
                config={roomLoaderConfig}
                petKey={petKey}
                petName={petName}
                plan={plan}
                ctx={ctx}
                formData={formData}
                onChange={handleInputChange}
                priceFor={priceForPatient(patientIdForLabs)}
                errors={fieldValidationErrors}
                badge={<RoomLoaderPatientMemberBadge patient={labsPatient} appointments={appointments} />}
                doctorName={doctorNameFromAppointment(appointments?.[0])}
                disabled={readOnly}
              />
            );
          })()}

          <div className="public-room-loader-nav-buttons">
            <button
              type="button"
              className="public-room-loader-btn"
              onClick={() => setCurrentPage(isFirstLabsPet ? 2 * nPets : currentPage - 1)}
              style={{
                backgroundColor: '#fff',
                color: '#333',
                border: '1px solid #ced4da',
                cursor: 'pointer',
              }}
            >
              {isFirstLabsPet ? '← Back to Care Plan' : '← Previous pet'}
            </button>
            <button
              type="button"
              className="public-room-loader-btn"
              onClick={() => {
                const v = validateRequiredForLabsPetPage(labsPetIndex);
                if (!v.valid) {
                  setFieldValidationErrors(v.errors || {});
                  return;
                }
                setFieldValidationErrors({});
                if (isLastLabsPet) {
                  setCurrentPage(summaryPageIndex);
                } else {
                  setCurrentPage(currentPage + 1);
                }
              }}
              style={{
                backgroundColor: '#0d6efd',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {isLastLabsPet ? 'Next: Summary →' : 'Next pet →'}
            </button>
          </div>
        </div>
      )}

      {/* Final Summary */}
      {isSummaryPage && (() => {
        const nameLower = (n: string | undefined) => (n ?? '').toLowerCase();
        const hasPhrase = (item: { name?: string }, phrase: string) => nameLower(item.name).includes(phrase);
        const formatPrice = (p: number | null | undefined) => (p != null && !Number.isNaN(Number(p)) ? `$${Number(p).toFixed(2)}` : '$0.00');
        const summaryPagePrimaryAppt =
          patients.length > 0 ? getAppointmentForRoomLoaderPet(appointments, patients[0], 0) : undefined;
        const summaryPageVisitIsQOLExam = publicRoomLoaderAppointmentIsQOLExam(summaryPagePrimaryAppt);
        const summarySnapshot = buildFullFormSnapshot();
        const canonicalGrandTotal = summarySnapshot.totals.grandTotal;
        const summaryFirstPatientId = Number(
          patients[0]?.patientId ?? patients[0]?.patient?.id ?? patients[0]?.id ?? 0
        );
        const estimatedDueTodayWithMembership = estimatedDueTodayWithMembershipForUpsellPets(
          availablePlansForPetsForDisplay,
          membershipPanelByPatientId,
          data?.patients ?? [],
          resolveRoomLoaderPatientMembership,
          {
            summaryLineItems: summarySnapshot.summaryLineItems ?? [],
            firstPatientId: summaryFirstPatientId,
            canonicalGrandTotal,
          }
        );
        const showMembershipFooterComparison =
          !summaryPageVisitIsQOLExam &&
          !readOnly &&
          availablePlansForPetsForDisplay.length > 0 &&
          !membershipPanelLoading &&
          estimatedDueTodayWithMembership != null;
        const membershipPitchSavings =
          estimatedDueTodayWithMembership != null
            ? Math.max(0, canonicalGrandTotal - estimatedDueTodayWithMembership)
            : null;
        // The expand copy stays reachable as a default so the pitch reads sensibly before a practice edits it.
        const membershipPitchExpandLabel =
          roomLoaderConfig.membership.expandLabel?.trim() ||
          'Expand to see how membership could change your bill';
        const membershipPitchCollapseLabel =
          roomLoaderConfig.membership.collapseLabel?.trim() || 'Hide the comparison';
        const membershipPitchRows: MembershipPitchRow[] = availablePlansForPetsForDisplay.flatMap((petPlans) => {
          const entry = membershipPanelByPatientId[petPlans.patientId];
          const adjustments =
            entry?.monthlyExtended?.lineItemAdjustments ?? entry?.monthly?.lineItemAdjustments ?? [];
          return adjustments.map((adj) => ({
            name: adj.name,
            originalPrice: Number(adj.originalPrice),
            adjustedPrice: Number(adj.adjustedPrice),
          }));
        });
        const showMembershipPitch =
          roomLoaderConfig.membership.enabled &&
          !readOnly &&
          !summaryPageVisitIsQOLExam &&
          availablePlansForPetsForDisplay.length > 0;
        // Plan label and the drop in visit cost both come from the priced summary rows: those
        // carry the full package name, where the patient row only has the short "Golden".
        const justEnrolledRows: any[] = justEnrolledPets.length
          ? (summarySnapshot.summaryForPdf?.pets ?? []).flatMap((pet: any) =>
              justEnrolledPets.some((p) => p.patientId === Number(pet?.patientId))
                ? (pet?.rows ?? [])
                : []
            )
          : [];
        const justEnrolledSavings = justEnrolledRows.reduce((sum: number, row: any) => {
          const saved = Number(row?.wellnessPlanPricing?.membershipDiscountAmount);
          return sum + (Number.isFinite(saved) && saved > 0 ? saved : 0);
        }, 0);
        const justEnrolledPlanName =
          formatMembershipPlanLabel(
            justEnrolledRows.find((row: any) => row?.wellnessPlanPricing?.membershipPlanName)
              ?.wellnessPlanPricing?.membershipPlanName
          ) ?? formatMembershipPlanLabel(justEnrolledPets[0]?.planName);
        const membershipCelebrationNode =
          justEnrolledPets.length > 0 && !readOnly ? (
            <MembershipCelebration
              petNames={justEnrolledPets.map((p) => p.name)}
              planName={justEnrolledPlanName}
              visitSavings={justEnrolledSavings > 0 ? justEnrolledSavings : null}
              formatPrice={formatPrice}
            />
          ) : null;
        const membershipPitchNode = showMembershipPitch ? (
          <MembershipPitch
            config={roomLoaderConfig.membership}
            savings={membershipPitchSavings}
            rows={membershipPitchRows}
            expanded={membershipBillSectionExpanded}
            onToggle={(next) => {
              if (next) {
                trackEvent('room_loader_membership_bill_explainer_opened', {
                  eligible_pet_count: availablePlansForPetsForDisplay.length,
                });
              }
              setMembershipBillSectionExpanded(next);
            }}
            expandLabel={membershipPitchExpandLabel}
            collapseLabel={membershipPitchCollapseLabel}
            formatPrice={formatPrice}
            loading={membershipPanelLoading}
          >
            {(() => {
              const patientsData = data?.patients ?? [];
              const firstPid = Number(
                patientsData[0]?.patientId ?? patientsData[0]?.patient?.id ?? patientsData[0]?.id ?? 0
              );
              return (
                <MembershipRecommendationPanel
                  pets={availablePlansForPetsForDisplay}
                  membershipPanelByPatientId={membershipPanelByPatientId}
                  membershipPanelLoading={membershipPanelLoading}
                  summaryLineItems={summarySnapshot?.summaryLineItems ?? []}
                  membershipComparisonDeclinedLines={summarySnapshot?.membershipComparisonDeclinedLines ?? []}
                  firstPatientId={firstPid}
                  todayVisitTotalAlignedWithSummary={
                    availablePlansForPetsForDisplay.length === 1 && patientsData.length === 1
                      ? canonicalGrandTotal
                      : undefined
                  }
                  allPatients={patientsData}
                  membershipPlanDisplayName={membershipPlanDisplayName}
                  formatPrice={formatPrice}
                  enrollPrimaryPetName={
                    availablePlansForPetsForDisplay[0]?.patientName ||
                    patientsData[0]?.patientName ||
                    patientsData[0]?.patient?.name ||
                    'your pet'
                  }
                  hasMultiplePetsOnForm={availablePlansForPetsForDisplay.length > 1}
                  onOpenMembershipEnrollment={() => setShowMembershipEnrollmentModal(true)}
                  normalizePlanBaseId={normalizePlanBaseId}
                  getRecommendedWellnessPlanFromList={getRecommendedWellnessPlanFromList}
                  filterLineItemsForPatientSimulate={filterLineItemsForPatientSimulate}
                  normItemName={normItemName}
                  patientHasMembershipFlag={resolveRoomLoaderPatientMembership}
                />
              );
            })()}
          </MembershipPitch>
        ) : null;
        return (
          <div className="public-room-loader-summary-page">
            <div style={{ marginBottom: '14px', paddingBottom: '9px', borderBottom: '3px solid #e0e0e0' }}>
              <h1 style={{ margin: 0, color: '#212529', fontSize: '24px', fontWeight: 700 }}>Review Your Care Plan & Estimate</h1>
              <p style={{ fontSize: '16px', lineHeight: '1.42', color: '#555', marginTop: '10px', marginBottom: 0 }}>
                We've put together a personalized plan based on your pet's needs and our medical recommendations. You can review each item below, make adjustments, and see pricing clearly upfront so you feel informed and confident before your visit.
              </p>
            </div>

            {membershipCelebrationNode}
            {roomLoaderConfig.membership.placement === 'top' ? membershipPitchNode : null}

            {patients.map((patient: any, petIdx: number) => {
              const patientId = patient.patientId ?? patient.patient?.id ?? petIdx;
              const petName = patient.patientName || `Pet ${petIdx + 1}`;
              const allItems = recommendedItemsByPet[petIdx] ?? [];
              const displayItems = allItems.filter((item: any) => !hasPhrase(item, 'trip fee') && !hasPhrase(item, 'sharps'));
              const tripFeeItems = allItems.filter((item: any) => hasPhrase(item, 'trip fee') || hasPhrase(item, 'sharps'));
              const displayWithIdx = displayItems.map((item: any, idx: number) => ({ item, idx }));
              const itemCategory = (item: any) => {
                const t = (item.type ?? item.itemType ?? 'procedure').toString().toLowerCase();
                if (t === 'lab' || t === 'laboratory') return 'lab';
                if (t === 'inventory') return 'inventory';
                return 'procedure';
              };
              const procedureDisplay = displayWithIdx.filter(({ item }) => itemCategory(item) === 'procedure');
              const labDisplayForSummary = displayWithIdx.filter(({ item }) => itemCategory(item) === 'lab');
              const inventoryDisplay = displayWithIdx.filter(({ item }) => itemCategory(item) === 'inventory');
              const SummarySeparator = () => <div style={{ height: '1px', backgroundColor: '#e0e0e0', margin: '6px 0' }} />;

              const petKeySummary = `pet${petIdx}`;
              const planSummary = petPlans[petIdx] ?? emptyPetPlan;
              const ctxSummary = petPlanContexts[petIdx] ?? emptyPlanContext;
              const configRowsForPet = acceptedConfigItems(planSummary, ctxSummary, petKeySummary, formData);
              const configLabRows = configRowsForPet.filter((entry) => entry.category === 'lab');
              const configAddOnRows = configRowsForPet.filter((entry) => entry.category === 'vaccine');
              const configUniversalRows = configRowsForPet.filter((entry) => entry.category === 'common');
              const summaryUniversalOffers = splitDedupedOffers(planSummary).universal;
              const acceptedPanelsSummary = effectiveAcceptedPanelOptions(
                planSummary,
                petKeySummary,
                formData
              );
              const panelReplacedLabels = panelReplacementLabels(
                acceptedPanelsSummary,
                ctxSummary.estimateLines
              );
              const configUniversalTotal = configUniversalRows.reduce(
                (sum, entry) =>
                  formData[configSummaryExcludeKey(petKeySummary, entry.item)] === true
                    ? sum
                    : sum + (getClientAdjustedPrice(patientId, configCatalogItem(entry.item)) ?? 0),
                0
              );

              let petSubtotal = configUniversalTotal;
              const pidN = Number(patientId);
              const sessionMultiPetCredit =
                !Number.isNaN(pidN) && roomLoaderSessionMembership.multiPetCreditPatientIds[pidN]
                  ? VAYD_MULTI_PET_MEMBERSHIP_CREDIT_USD
                  : 0;
              const showMultiPetMembershipUpsellBlurb = roomLoaderPetEligibleForMultiPetMembershipUpsell(
                patient,
                patients,
                appointments
              );

              const renderDisplayRow = (item: any, idx: number) => {
                const isVisitOrConsult = hasPhrase(item, 'visit') || hasPhrase(item, 'consult');
                const replacedByLabel = rowReplacedByPanel(item, panelReplacedLabels);
                const isReplaced = replacedByLabel != null;
                const recKey = publicFormCarePlanRecKey(petIdx, item, idx);
                const canUncheck = !isVisitOrConsult && !isReplaced && !readOnly;
                const isChecked = isReplaced
                  ? false
                  : isVisitOrConsult || publicFormCarePlanRecRowChecked(formData, petIdx, item, idx);
                const { unitPrice, displayPricing } = resolveSummaryLinePrice(
                  patientId,
                  item,
                  getClientPricing,
                  getClientAdjustedPrice
                );
                const summaryPatientIdN = Number(patientId);
                const qty = effectivePublicMedicationInventoryQuantity(
                  formData,
                  petIdx,
                  item,
                  idx,
                  summaryPatientIdN,
                  getClientPricing
                );
                const staffQtyBaseline = Math.max(1, Math.floor(Number(item.quantity) || 1));
                const medQtyInputMin = publicMedicationQuantityClientMin(staffQtyBaseline);
                const showMedQtyControl =
                  publicFormInventoryRowAllowsClientQuantityFromPricing(summaryPatientIdN, item, getClientPricing) &&
                  isChecked &&
                  !isReplaced &&
                  !readOnly;
                const lineTotal = isChecked && !isReplaced ? unitPrice * qty : 0;
                petSubtotal += lineTotal;
                const discountNote =
                  getDiscountNote(displayPricing) ??
                  (hasDiscountPricingNote(displayPricing) ? 'Membership or discount applied' : null);
                const quantityUsedNote =
                  displayPricing?.wellnessPlanPricing?.hasCoverage &&
                  displayPricing.wellnessPlanPricing.isWithinLimit === false;
                const hasPricingNote = discountNote != null || quantityUsedNote;
                const displayNote =
                  discountNote != null
                    ? discountNote
                    : quantityUsedNote
                      ? MEMBERSHIP_ALLOTMENT_USED_LABEL
                      : null;
                const uncheckBody =
                  !isChecked && !isReplaced && canUncheck ? uncheckRecommendation(item) : null;
                return (
                  <div
                    key={`d-${petIdx}-${idx}`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: canUncheck ? 'pointer' : 'default', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!canUncheck || readOnly}
                          onChange={canUncheck ? () => handleInputChange(recKey, !isChecked) : undefined}
                          style={{
                            marginRight: '12px',
                            width: '18px',
                            height: '18px',
                            cursor: canUncheck ? 'pointer' : 'default',
                            flexShrink: 0,
                            opacity: canUncheck ? 1 : 0.6,
                            accentColor: canUncheck ? undefined : '#999',
                          }}
                        />
                        <span
                          style={{
                            ...(isReplaced || !isChecked
                              ? { textDecoration: 'line-through', color: '#888' }
                              : { color: '#333' }),
                          }}
                        >
                          {item.name}
                          {(qty > 1 ||
                            (publicFormInventoryRowAllowsClientQuantityFromPricing(summaryPatientIdN, item, getClientPricing) &&
                              isChecked &&
                              !isReplaced &&
                              !showMedQtyControl)) && (
                            <span style={{ color: '#666', marginLeft: '6px', fontSize: '14px' }}>(Qty: {qty})</span>
                          )}
                          {isReplaced && replacedByLabel ? (
                            <span style={{ fontSize: '13px', color: '#666', marginLeft: '8px', fontStyle: 'italic', textDecoration: 'none' }}>
                              Already combined in the {replacedByLabel} chosen
                            </span>
                          ) : null}
                        </span>
                      </label>
                      <span
                        style={{
                          fontWeight: 700,
                          flexShrink: 0,
                          ...(isReplaced || !isChecked ? { textDecoration: 'line-through', color: '#888' } : {}),
                        }}
                      >
                        {formatPrice(isChecked && !isReplaced ? lineTotal : 0)}
                      </span>
                    </div>
                    {showMedQtyControl && (
                      <div style={{ marginLeft: '30px', marginTop: '4px', marginBottom: '2px', fontSize: '14px', color: '#555' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                          <span>
                            {staffQtyBaseline > 1
                              ? `Quantity (your team suggested ${staffQtyBaseline}; you may lower to ${medQtyInputMin} or increase up to 999)`
                              : `Quantity (minimum ${medQtyInputMin} from your visit plan; increase if you need more)`}
                          </span>
                          <input
                            type="number"
                            min={medQtyInputMin}
                            max={999}
                            step={1}
                            value={qty}
                            onChange={(e) => {
                              const raw = parseInt(e.target.value, 10);
                              const v = Number.isFinite(raw)
                                ? Math.max(medQtyInputMin, Math.min(999, raw))
                                : staffQtyBaseline;
                              handleInputChange(publicFormSummaryMedicationQtyKey(petIdx, item, idx), v);
                            }}
                            style={{
                              width: '72px',
                              padding: '6px 10px',
                              fontSize: '15px',
                              borderRadius: '6px',
                              border: '1px solid #ccc',
                            }}
                          />
                        </label>
                      </div>
                    )}
                    {isChecked && !isReplaced && hasPricingNote && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{displayNote}</div>}
                    {uncheckBody ? <CarePlanWhyRecommendBlurb {...uncheckBody} /> : null}
                  </div>
                );
              };

              /** A configured panel, sub-ask or add-on the client accepted earlier, with a summary opt-out. */
              const renderConfigRow = (entry: { displayName: string; item: RoomLoaderItemRef }) => {
                const excludeKey = configSummaryExcludeKey(petKeySummary, entry.item);
                const isExcluded = formData[excludeKey] === true;
                const searchable = configCatalogItem(entry.item);
                const pricing = getClientPricing(patientId, searchable);
                const price = getClientAdjustedPrice(patientId, searchable) ?? 0;
                if (!isExcluded) petSubtotal += price;
                const discountNote =
                  getDiscountNote(pricing) ??
                  (hasDiscountPricingNote(pricing) ? 'Membership or discount applied' : null);
                return (
                  <div key={excludeKey} style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={!isExcluded}
                          disabled={readOnly}
                          onChange={() => !readOnly && handleInputChange(excludeKey, !isExcluded)}
                          style={{ marginRight: '12px', width: '18px', height: '18px', cursor: readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                        />
                        <span style={{ ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : { color: '#333' }) }}>
                          {entry.displayName}
                        </span>
                      </label>
                      <span style={{ fontWeight: 700, flexShrink: 0, ...(isExcluded ? { textDecoration: 'line-through', color: '#888' } : {}) }}>
                        {formatPrice(isExcluded ? 0 : price)}
                      </span>
                    </div>
                    {!isExcluded && discountNote != null && (
                      <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{discountNote}</div>
                    )}
                  </div>
                );
              };

              return (
                <div key={petIdx} style={{ marginBottom: '15px', padding: '12px', backgroundColor: '#f9f9f9', border: '1px solid #ddd', borderRadius: '8px' }}>
                  <div style={{ marginBottom: '14px' }}>
                    <h3 style={{ margin: 0, color: '#212529', fontSize: '18px', fontWeight: 700 }}>{petName}</h3>
                    {showMultiPetMembershipUpsellBlurb && (
                      <p
                        style={{
                          margin: '10px 0 0',
                          fontSize: '14px',
                          color: '#166534',
                          lineHeight: 1.5,
                          padding: '10px 12px',
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: 8,
                        }}
                      >
                        We also offer a $75 VAYD multi-pet membership credit for each additional pet. This never expires.
                      </p>
                    )}
                    <RoomLoaderPatientMemberBadge patient={patient} appointments={appointments} />
                  </div>
                  <div style={{ borderBottom: '1px solid #e0e0e0', paddingBottom: '12px', marginBottom: '8px' }}>
                    {/* Procedures: uncheckable (visit/consult), trip fee/sharps, then checkable procedure items */}
                    {procedureDisplay.map(({ item, idx }) => renderDisplayRow(item, idx))}
                    {tripFeeItems.map((item: any, idx: number) => {
                      const { unitPrice, displayPricing: tripPricing } = resolveSummaryLinePrice(
                        patientId,
                        item,
                        getClientPricing,
                        getClientAdjustedPrice
                      );
                      const qty = Number(item.quantity) || 1;
                      const lineTotal = unitPrice * qty;
                      petSubtotal += lineTotal;
                      const hasTripDiscount = hasDiscountPricingNote(tripPricing);
                      const tripQuantityUsedNote = tripPricing?.wellnessPlanPricing?.hasCoverage && tripPricing.wellnessPlanPricing.isWithinLimit === false;
                      const hasTripPricingNote = hasTripDiscount || tripQuantityUsedNote;
                      const tripDiscountNote = getDiscountNote(tripPricing) ?? 'Membership or discount applied';
                      const tripDisplayNote = tripQuantityUsedNote && !hasTripDiscount
                        ? MEMBERSHIP_ALLOTMENT_USED_LABEL
                        : tripDiscountNote;
                      return (
                        <div key={`t-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0', fontSize: '15px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', color: '#666' }}>
                            <label style={{ display: 'flex', alignItems: 'center', flex: 1, margin: 0, cursor: 'default' }}>
                              <input
                                type="checkbox"
                                checked
                                disabled
                                readOnly
                                style={{ marginRight: '12px', width: '18px', height: '18px', flexShrink: 0, opacity: 0.6, accentColor: '#999' }}
                              />
                              <span style={{ flex: 1, color: '#666' }}>
                                {item.name}
                                {qty > 1 && <span style={{ color: '#666', marginLeft: '6px', fontSize: '14px' }}>(Qty: {qty})</span>}
                              </span>
                            </label>
                            <span style={{ fontWeight: 700, flexShrink: 0 }}>{formatPrice(lineTotal)}</span>
                          </div>
                          {hasTripPricingNote && <div style={{ fontSize: '12px', color: '#1976d2', marginTop: '2px', textAlign: 'right' }}>{tripDisplayNote}</div>}
                        </div>
                      );
                    })}
                    {(procedureDisplay.length > 0 || tripFeeItems.length > 0) ? <SummarySeparator /> : null}
                    {/* Labs: Labs-page panels first (stable position), then visit reminder/added lab lines */}
                    {/* Lab panels — always keep rows visible when the client chose Yes on Labs; price can be 0 while items load */}
                    {configLabRows.map(renderConfigRow)}
                    {labDisplayForSummary.map(({ item, idx }) => renderDisplayRow(item, idx))}
                    {labDisplayForSummary.length > 0 || configLabRows.length > 0 ? <SummarySeparator /> : null}
                    {inventoryDisplay.map(({ item, idx }) => renderDisplayRow(item, idx))}
                    {configAddOnRows.length > 0 ? <SummarySeparator /> : null}
                    {configAddOnRows.map(renderConfigRow)}
                    {summaryUniversalOffers.length > 0 ? (
                      <OfferSection
                        petKey={petKeySummary}
                        title={`Would you like to add anything else for ${petName}?`}
                        offers={summaryUniversalOffers}
                        formData={formData}
                        onChange={handleInputChange}
                        priceFor={priceForPatient(patientId)}
                        disabled={readOnly}
                      />
                    ) : null}
                    {roomLoaderConfig.chronicMeds.enabled &&
                    chronicMedsForPatient(Number(patientId)).length > 0 ? (
                      <ChronicMedsSection
                        petKey={petKeySummary}
                        petName={petName}
                        config={roomLoaderConfig.chronicMeds}
                        meds={chronicMedsForPatient(Number(patientId))}
                        formData={formData}
                        onChange={handleInputChange}
                        disabled={readOnly}
                      />
                    ) : null}
                  </div>
                  {sessionMultiPetCredit > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 0',
                        fontSize: '15px',
                        color: '#166534',
                        borderTop: '1px solid #e8f5e9',
                        marginTop: '4px',
                      }}
                    >
                      <span>{VAYD_MULTI_PET_MEMBERSHIP_CREDIT_LINE_NAME}</span>
                      <span style={{ fontWeight: 700 }}>-{formatPrice(sessionMultiPetCredit)}</span>
                    </div>
                  )}
                  {patients.length > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '15px', fontWeight: 600, color: '#333' }}>
                      Subtotal: <strong>{formatPrice(petSubtotal - sessionMultiPetCredit)}</strong>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Additional items — directly under last pet, above store search */}
            {storeAdditionalItems.length > 0 && (() => {
              const firstPid =
                data?.patients?.length && data.patients.length > 0
                  ? Number(data.patients[0]?.patientId ?? data.patients[0]?.patient?.id ?? 0)
                  : NaN;
              const storeSubtotal = storeAdditionalItems.reduce((sum, item, idx) => {
                const unit =
                  !Number.isNaN(firstPid) && firstPid > 0
                    ? getStoreAdjustedPrice(firstPid, item, idx)
                    : null;
                return sum + (unit ?? Number(item.price)) * storeItemQty(item);
              }, 0);
              const storeTaxRate = 0.055;
              const storeTax = storeSubtotal * storeTaxRate;
              return (
                <div
                  id="public-room-loader-additional-items"
                  style={{
                    marginBottom: '14px',
                    padding: '16px',
                    background: 'linear-gradient(180deg, #f0f7ff 0%, #e8f2fc 100%)',
                    border: '2px solid #0d6efd',
                    borderRadius: '10px',
                    boxShadow: '0 4px 14px rgba(13, 110, 253, 0.12)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <span style={{ fontSize: '20px', lineHeight: 1 }} aria-hidden>✓</span>
                    <h4 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#084298' }}>Additional items</h4>
                  </div>
                  <p style={{ fontSize: '14px', lineHeight: 1.5, color: '#495057', margin: '0 0 12px 0' }}>
                    These products are included in your estimated total below (plus sales tax).
                  </p>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {storeAdditionalItems.map((item, idx) => {
                      const qty = storeItemQty(item);
                      const storePricing =
                        !Number.isNaN(firstPid) && firstPid > 0 ? getStoreItemPricing(firstPid, item, idx) : null;
                      const finalUnit =
                        !Number.isNaN(firstPid) && firstPid > 0
                          ? (getStoreAdjustedPrice(firstPid, item, idx) ?? Number(item.price))
                          : Number(item.price);
                      const listOrOrig =
                        storePricing != null && storePricing.originalPrice != null
                          ? Number(storePricing.originalPrice)
                          : Number(item.price);
                      const showPriceCompare =
                        Number.isFinite(listOrOrig) && Number.isFinite(finalUnit) && listOrOrig > finalUnit + 0.005;
                      const discountLine = storePricing ? getStoreItemDiscountDescription(storePricing) : null;
                      return (
                      <li
                        key={`${item.id}-${idx}`}
                        className={idx === storeItemJustAddedIndex ? 'public-room-loader-store-item-new' : undefined}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '10px',
                          padding: '12px 12px',
                          marginBottom: idx < storeAdditionalItems.length - 1 ? '8px' : 0,
                          borderRadius: '8px',
                          border: '1px solid #b6d4fe',
                          backgroundColor: '#fff',
                          fontSize: '15px',
                          fontWeight: idx === storeItemJustAddedIndex ? 600 : 400,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ color: '#212529' }}>{item.name}</span>
                          {item.fulfillment ? (
                            <div style={{ fontSize: '13px', color: '#495057', marginTop: '4px' }}>
                              {item.fulfillment === 'ship' ? 'Ship to me (online store price)' : 'Bring to the visit (clinic price)'}
                              {qty > 1 ? ` · ${formatPrice(finalUnit)} each` : ''}
                            </div>
                          ) : null}
                          {discountLine != null && discountLine !== '' && (
                            <div
                              style={{
                                fontSize: '13px',
                                color: '#166534',
                                marginTop: '6px',
                                lineHeight: 1.4,
                                fontWeight: 500,
                              }}
                            >
                              {discountLine}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                            aria-label={`Quantity for ${item.name}`}
                          >
                            <button
                              type="button"
                              aria-label={`Decrease quantity of ${item.name}`}
                              disabled={readOnly || qty <= 1}
                              onClick={() => setStoreItemQuantity(idx, qty - 1)}
                              style={storeQtyButtonStyle(readOnly || qty <= 1)}
                            >
                              −
                            </button>
                            <span
                              style={{ minWidth: '20px', textAlign: 'center', fontWeight: 600, fontSize: '14px' }}
                            >
                              {qty}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase quantity of ${item.name}`}
                              disabled={readOnly || qty >= 99}
                              onClick={() => setStoreItemQuantity(idx, qty + 1)}
                              style={storeQtyButtonStyle(readOnly || qty >= 99)}
                            >
                              +
                            </button>
                          </div>
                          <span style={{ fontWeight: 700, color: '#212529', textAlign: 'right' }}>
                            {showPriceCompare ? (
                              <>
                                <span
                                  style={{
                                    textDecoration: 'line-through',
                                    color: '#888',
                                    fontWeight: 600,
                                    marginRight: '8px',
                                  }}
                                >
                                  {formatPrice(listOrOrig * qty)}
                                </span>
                                <span>{formatPrice(finalUnit * qty)}</span>
                              </>
                            ) : (
                              formatPrice(finalUnit * qty)
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (readOnly) return;
                              setStoreItemJustAddedIndex(null);
                              setStoreAdditionalItems((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            disabled={readOnly}
                            style={{ padding: '6px 12px', fontSize: '13px', color: readOnly ? '#999' : '#dc3545', background: '#fff', border: `1px solid ${readOnly ? '#999' : '#dc3545'}`, borderRadius: '6px', cursor: readOnly ? 'not-allowed' : 'pointer', fontWeight: 600 }}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                  <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #b6d4fe', fontSize: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px', fontWeight: 500 }}>Subtotal: {formatPrice(storeSubtotal)}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px', fontWeight: 500 }}>Sales tax (5.5%): {formatPrice(storeTax)}</div>
                  </div>
                </div>
              );
            })()}

            {/* Store search - type-ahead, add products to Additional items */}
            <div style={{ marginBottom: '14px', padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#212529', marginBottom: '8px' }}>Add other medications or products</div>
              <p style={{ fontSize: '14px', lineHeight: 1.5, color: '#555', marginBottom: '8px', marginTop: 0 }}>
                {storeStocked
                  ? "If you'd like us to bring additional items, you can search and add them here. This is a great place to include preventatives, chronic medications, or other products you know your pet needs."
                  : "If you'd like us to bring anything with us, tell us here and we'll get it ready and priced before the visit. Preventatives, chronic medications, or anything else you know your pet needs."}
              </p>
              {patients.length > 0 && (
                <p style={{ fontSize: '14px', color: '#555', marginBottom: '8px', marginTop: 0 }}>
                  Pet weight{patients.length > 1 ? 's' : ''}: {patients.map((p: any, i: number) => {
                    const name = p.patientName || `Pet ${i + 1}`;
                    const w = p.weight ?? p.patient?.weight ?? p.currentWeight;
                    const weightStr = w != null && w !== '' ? (typeof w === 'number' ? `${w} lbs` : String(w).replace(/\s*lb(s)?\s*$/i, '') + ' lbs') : '—';
                    return <span key={i}>{i > 0 ? '; ' : ''}{name}: {weightStr}</span>;
                  })}
                </p>
              )}
              {!storeStocked ? (
                <textarea
                  value={(formData['additionalItemsRequest'] ?? '').toString()}
                  onChange={(e) =>
                    !readOnly &&
                    setFormData((prev) => ({ ...prev, additionalItemsRequest: e.target.value }))
                  }
                  readOnly={readOnly}
                  disabled={readOnly || storeCatalogLoading}
                  placeholder={
                    storeCatalogLoading
                      ? 'Loading…'
                      : 'e.g. 3 months of Bravecto for Poppy, a refill of her ear drops...'
                  }
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '10px 12px',
                    border: '1px solid #ced4da',
                    borderRadius: '6px',
                    fontSize: '15px',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    backgroundColor: '#fff',
                    ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}),
                  }}
                />
              ) : (
              <>
                <div style={{ position: 'relative', marginBottom: storeSearchResults.length > 0 ? '12px' : 0 }}>
                  <input
                    type="text"
                    value={storeSearchQuery}
                    onChange={(e) => !readOnly && setStoreSearchQuery(e.target.value)}
                    readOnly={readOnly}
                    disabled={readOnly}
                    placeholder="Type to search products..."
                    style={{ width: '100%', padding: '10px 12px', paddingRight: storeSearchLoading ? '36px' : '12px', border: '1px solid #ced4da', borderRadius: '6px', fontSize: '15px', boxSizing: 'border-box', ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}) }}
                  />
                  {storeSearchLoading && (
                    <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: '#666' }}>Searching...</span>
                  )}
                </div>
                {storeSearchError ? (
                  <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#dc3545' }}>{storeSearchError}</p>
                ) : null}
                {!storeSearchLoading &&
                !storeSearchError &&
                storeSearchQuery.trim().length >= 2 &&
                storeSearchResultsByName.length === 0 ? (
                  <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#666' }}>
                    No store products matched “{storeSearchQuery.trim()}”.
                  </p>
                ) : null}
                {storeSearchResultsByName.length > 0 && (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: '200px', overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: '6px', backgroundColor: '#fff' }}>
                    {storeSearchResultsByName.map(([productName, items]) => {
                      const minPrice = Math.min(...items.map((listing) => listingMinPrice(listing, storeCatalogPrices)));
                      return (
                        <li
                          key={productName}
                          onClick={() => {
                          if (readOnly) return;
                          setStoreOptionModalGroup(items);
                          setStoreSearchQuery('');
                        }}
                          style={{ padding: '10px 12px', borderBottom: '1px solid #eee', cursor: readOnly ? 'default' : 'pointer', fontSize: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...(readOnly ? { opacity: 0.85 } : {}) }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e7f1ff'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
                        >
                          <span>{productName}</span>
                          <span style={{ fontWeight: 600 }}>{items.length > 1 ? <>from <strong>${minPrice.toFixed(2)}</strong></> : <strong>${minPrice.toFixed(2)}</strong>}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
              )}
            </div>

            <ProductGuideSection config={roomLoaderConfig.productGuide} speciesOnForm={speciesOnForm} />

            {/* Anything else you want us to know? */}
            <div style={{ marginBottom: '14px', padding: '16px', backgroundColor: '#e8f2fc', borderRadius: '8px', border: '1px solid #c5d8f0' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#212529', marginBottom: '8px' }}>Anything else you want us to know?</div>
              <p style={{ fontSize: '14px', lineHeight: 1.5, color: '#555', marginBottom: '8px', marginTop: 0 }}>
                Optional: share any other details you'd like our team to know before your visit.
              </p>
              <textarea
                value={(formData['anythingElseNotes'] ?? '').toString()}
                onChange={(e) => !readOnly && setFormData((prev) => ({ ...prev, anythingElseNotes: e.target.value }))}
                readOnly={readOnly}
                disabled={readOnly}
                placeholder="e.g. special handling, parking notes, or other requests..."
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '10px 12px',
                  border: '1px solid #c5d8f0',
                  borderRadius: '6px',
                  fontSize: '15px',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  backgroundColor: '#f5faff',
                  ...(readOnly ? { opacity: 0.85, cursor: 'default' } : {}),
                }}
              />
            </div>

            {/* Modal: pick a variation of a product (same name, different options/SKU) */}
            {storeOptionModalGroup && storeOptionModalGroup.length > 0 && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                }}
                onClick={() => setStoreOptionModalGroup(null)}
              >
                <div
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: '8px',
                    padding: '12px',
                    maxWidth: '420px',
                    width: '90%',
                    maxHeight: '80vh',
                    overflow: 'auto',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h4 style={{ margin: 0, marginBottom: '10px', fontSize: '16px', fontWeight: 600, color: '#333' }}>
                    {storeOptionModalGroup[0].name}
                  </h4>
                  <p style={{ margin: 0, marginBottom: '8px', fontSize: '13px', color: '#666' }}>
                    Choose an option. Bring-to-visit uses the clinic price; ship uses the online store price.
                  </p>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {getStoreModalRows(storeOptionModalGroup, storeCatalogPrices).map(({ key, label, price, item }, idx) => (
                      <li
                        key={`${key}-${label}-${price}-${idx}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 0',
                          borderBottom: '1px solid #eee',
                          gap: '8px',
                        }}
                      >
                        <span style={{ fontSize: '14px', color: '#333' }}>{label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong>{formatPrice(price)}</strong>
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => {
                              if (readOnly) return;
                              // Show full name (product + option picked) in the Additional items list and PDF
                              const baseName = (item.name || '').trim();
                              const option = (item.optionLabel || '').trim();
                              const fullName =
                                option && baseName && option !== baseName && !baseName.includes(option)
                                  ? `${baseName} - ${option}`
                                  : baseName || option || 'Additional item';
                              const picked = { ...item, name: fullName, quantity: 1 };
                              let newIdx = 0;
                              setStoreAdditionalItems((prev) => {
                                // Re-adding the same option bumps the count rather than
                                // stacking a second identical line.
                                const existing = prev.findIndex((row) => sameStoreProduct(row, picked));
                                if (existing >= 0) {
                                  newIdx = existing;
                                  return prev.map((row, i) =>
                                    i === existing
                                      ? { ...row, quantity: Math.min(99, storeItemQty(row) + 1) }
                                      : row
                                  );
                                }
                                const next = [...prev, picked];
                                newIdx = next.length - 1;
                                return next;
                              });
                              setStoreItemJustAddedIndex(newIdx);
                              window.setTimeout(() => setStoreItemJustAddedIndex(null), 1200);
                              requestAnimationFrame(() => {
                                document.getElementById('public-room-loader-additional-items')?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'nearest',
                                });
                              });
                              setStoreOptionModalGroup(null);
                              setStoreSearchQuery('');
                            }}
                            style={{
                              padding: '6px 12px',
                              fontSize: '13px',
                              backgroundColor: readOnly ? '#adb5bd' : '#0d6efd',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                            }}
                          >
                            Add
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setStoreOptionModalGroup(null)}
                      style={{
                        padding: '8px 16px',
                        fontSize: '14px',
                        backgroundColor: '#6c757d',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div style={{ width: '100%' }}>
              {roomLoaderConfig.membership.placement === 'before-total' ? membershipPitchNode : null}
              <div
                className="public-room-loader-summary-total-row"
                style={{
                  marginTop:
                    !readOnly &&
                    !summaryPageVisitIsQOLExam &&
                    availablePlansForPetsForDisplay.length > 0
                      ? '20px'
                      : '24px',
                  paddingTop:
                    !readOnly &&
                    !summaryPageVisitIsQOLExam &&
                    availablePlansForPetsForDisplay.length > 0
                      ? 0
                      : '20px',
                  borderTop:
                    !readOnly &&
                    !summaryPageVisitIsQOLExam &&
                    availablePlansForPetsForDisplay.length > 0
                      ? undefined
                      : '3px solid #e0e0e0',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                  <span style={{ fontSize: '20px', fontWeight: 700, color: '#212529' }}>
                    Estimated Total Due At Visit: <strong>{formatPrice(canonicalGrandTotal)}</strong>
                  </span>
                  {showMembershipFooterComparison && (
                    <span style={{ fontSize: '18px', fontWeight: 700, color: '#166534' }}>
                      Estimated Due At Visit With Membership:{' '}
                      <strong>
                        {estimatedDueTodayWithMembership < 0
                          ? `-${formatPrice(Math.abs(estimatedDueTodayWithMembership))} (credit)`
                          : formatPrice(estimatedDueTodayWithMembership)}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {fieldValidationErrors._submit && (
              <p style={{ marginTop: '10px', marginBottom: 0, fontSize: '14px', color: '#dc3545' }}>{fieldValidationErrors._submit}</p>
            )}
            <style>{`
              @keyframes publicRoomLoaderStoreItemPop {
                0% { transform: scale(0.94); opacity: 0.75; }
                40% { transform: scale(1.03); opacity: 1; }
                70% { transform: scale(0.99); }
                100% { transform: scale(1); opacity: 1; }
              }
              @keyframes publicRoomLoaderStoreRowGlow {
                0% {
                  box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.45), 0 6px 20px rgba(13, 110, 253, 0.2);
                  border-color: #0d6efd;
                }
                100% {
                  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
                  border-color: #b6d4fe;
                }
              }
              .public-room-loader-store-item-new {
                animation: publicRoomLoaderStoreItemPop 0.55s ease-out, publicRoomLoaderStoreRowGlow 1.1s ease-out 0.05s forwards;
              }
              @keyframes roomLoaderSubmitPopIn {
                0% { transform: scale(0.92); opacity: 0.6; box-shadow: 0 0 0 0 rgba(13, 110, 253, 0); }
                50% { transform: scale(1.06); opacity: 1; box-shadow: 0 0 0 8px rgba(13, 110, 253, 0.28); }
                100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 0 rgba(13, 110, 253, 0); }
              }
              @keyframes roomLoaderSubmitPulse {
                0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(13, 110, 253, 0.38); }
                50% { transform: scale(1.04); box-shadow: 0 0 20px 4px rgba(13, 110, 253, 0.48); }
              }
              .public-room-loader-submit-btn-throb {
                animation: roomLoaderSubmitPopIn 0.5s ease-out forwards,
                  roomLoaderSubmitPulse 2.2s ease-in-out 0.6s infinite;
              }
              .public-room-loader-submit-btn-throb:hover:not(:disabled) {
                animation: none;
                transform: scale(1.05);
                box-shadow: 0 0 20px 4px rgba(13, 110, 253, 0.42);
              }
            `}</style>
            <div className="public-room-loader-summary-actions">
              <button
                type="button"
                className="public-room-loader-btn"
                onClick={() => setCurrentPage(lastLabPage)}
                style={{
                  backgroundColor: '#fff',
                  color: '#333',
                  border: '1px solid #ced4da',
                }}
              >
                ← Back to Labs
              </button>
              <button
                type="button"
                className={`public-room-loader-btn${
                  !readOnly && !submitting && roomLoaderMembershipEligiblePets.length === 0
                    ? ' public-room-loader-submit-btn-throb'
                    : ''
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  handleSubmit();
                }}
                disabled={submitting || readOnly}
                style={{
                  backgroundColor: submitting || readOnly ? '#adb5bd' : '#0d6efd',
                  color: '#fff',
                  border: 'none',
                  cursor: submitting || readOnly ? 'not-allowed' : 'pointer',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
              >
                {submitting ? 'Submitting...' : readOnly ? 'Already submitted' : 'Submit Form'}
              </button>
            </div>
          </div>
        );
      })()}
      <MembershipEnrollmentModal
        open={showMembershipEnrollmentModal}
        onClose={() => setShowMembershipEnrollmentModal(false)}
        eligiblePets={roomLoaderMembershipEligiblePets}
        getPetForSignup={getRoomLoaderEnrollmentPet}
        modalClientInfo={roomLoaderModalClientInfo}
        onAfterPetEnrolled={refetchRoomLoaderAfterMembership}
        onEnrollmentFlowCompleted={refetchRoomLoaderAfterMembership}
        doneButtonLabel="Done – return to visit summary"
        fromRoomLoaderPublicForm
      />
    </div>
  );
}
