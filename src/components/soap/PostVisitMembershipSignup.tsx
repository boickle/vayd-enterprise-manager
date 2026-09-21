import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  CircleDollarSign,
  Loader2,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  executePostVisitSignup,
  listBundles,
  listPatientMemberships,
  previewPostVisitSignup,
  type Bundle,
  type MembershipBillingInterval,
  type MembershipItemType,
  type PostVisitLineSubstitution,
  type PostVisitSignupPreview,
  type PostVisitSignupResult,
} from '../../api/memberships';
import { listClientVisitInvoices, adoptEvetInvoice, VISIT_WORKFLOW_PRACTICE_ID, type VisitInvoice } from '../../api/visitWorkflow';
import { fetchClientBillingStaff } from '../../api/clientsStaff';
import { normalizeInvoicesFromClient, type NormalizedInvoice } from '../../utils/pimsInvoices';
import { apiErrorMessage } from '../../api/http';
import { fetchChatHoursOfOperation } from '../../api/chatHoursOfOperation';
import {
  cutoffAfterBusinessHoursAgo,
  invoiceInLookback,
} from '../../utils/businessHoursLookback';
import { DEFAULT_PRACTICE_TIMEZONE } from '../../utils/practiceTimezone';
import type { ChatHoursOfOperation } from '../../utils/chatHours';
import { MEMBERSHIP_GOLDEN_MIN_AGE_YEARS } from '../../utils/membershipAge';
import { resolveMembershipPetKind } from '../../utils/membershipSpecies';
import { fetchPatientByIdStaff } from '../../api/patients';
import PostVisitCardEntry from './PostVisitCardEntry';
import {
  getPracticeSettings,
  membershipPostVisitSignupWindowHours,
} from '../../api/practiceSettings';
import './PostVisitMembershipSignup.css';

const PICKER_BAND_BUSINESS_HOURS = 48;

type Props = {
  /** SOAP / receipt: invoice already known. */
  visitInvoiceId?: string | null;
  /** Financial workspace: load invoices for this client and let staff pick. */
  clientId?: number | null;
  /** Required for patient-scoped pricing and plan eligibility. */
  patientId?: number | null;
  /** Pre-check these ids when the picker opens. */
  initialInvoiceIds?: string[];
  /**
   * Already-loaded Scout invoices (financial workspace / patient panel).
   * Shown immediately so the modal does not wait on a second full list fetch.
   */
  seedInvoices?: VisitInvoice[] | null;
  patientName?: string | null;
  /** Species string from the patient chart (dog/canine/cat/feline…). */
  patientSpecies?: string | null;
  /** Age in years when known — drives Golden vs Foundations recommendation. */
  patientAgeYears?: number | null;
  /**
   * Client financial screen: the invoice can name several pets. Ask which one
   * this membership is for instead of guessing from the first line.
   */
  choosePet?: boolean;
  householdPets?: { id: number; name: string }[];
  onClose: () => void;
  onCompleted: (result: PostVisitSignupResult) => void;
};

function money(n: number | null | undefined): string {
  const value = Number(n) || 0;
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
}

function billingIntervalForPlan(plan: Bundle): MembershipBillingInterval {
  if (/\bmonthly\b/i.test(plan.name ?? '')) return 'monthly';
  if (/\b(annual|yearly)\b/i.test(plan.name ?? '')) return 'annual';
  if (plan.priceAnnual != null && plan.priceMonthly == null) return 'annual';
  if (plan.priceMonthly != null && plan.priceAnnual == null) return 'monthly';
  return 'monthly';
}

function listedPriceForPlan(plan: Bundle): number | null {
  const interval = billingIntervalForPlan(plan);
  if (interval === 'annual') return plan.priceAnnual ?? plan.price ?? null;
  return plan.priceMonthly ?? plan.price ?? null;
}

/** Portal / room-loader plan family (foundations, golden, …). */
type PlanFamily = 'foundations' | 'golden' | 'comfort-care' | 'starter' | 'other';

function planFamily(plan: Bundle): PlanFamily {
  const blob = `${plan.portalSlug || ''} ${plan.tier || ''} ${plan.name || ''}`.toLowerCase();
  if (/\bstarter\b|puppy|kitten/.test(blob)) return 'starter';
  if (/\bcomfort\b/.test(blob)) return 'comfort-care';
  if (/\bgolden\b/.test(blob)) return 'golden';
  if (/\bfoundations?\b/.test(blob)) return 'foundations';
  return 'other';
}

function planIsPlus(plan: Bundle): boolean {
  return /\bplus\b/i.test(`${plan.tier || ''} ${plan.name || ''}`);
}

/**
 * Same eligibility as MembershipSignup / room loader `getPlanIdsForPet`:
 * Foundations always; Golden only when age ≥ threshold; starter when young.
 */
function planAllowedForPet(
  plan: Bundle,
  kind: 'dog' | 'cat' | null,
  ageYears: number | null | undefined,
): boolean {
  const family = planFamily(plan);
  const meetsGolden =
    kind != null &&
    ageYears != null &&
    Number.isFinite(ageYears) &&
    ageYears >= MEMBERSHIP_GOLDEN_MIN_AGE_YEARS;
  const shouldShowStarter =
    ageYears != null &&
    Number.isFinite(ageYears) &&
    ageYears <= 1.5 &&
    (kind === 'dog' || kind === 'cat');

  if (family === 'comfort-care') return false;
  if (family === 'starter') return shouldShowStarter;
  if (family === 'golden') return meetsGolden;
  if (family === 'foundations') return true;
  if (ageYears != null && Number.isFinite(ageYears)) {
    const ageMonths = ageYears * 12;
    if (plan.minAgeMonths != null && ageMonths < plan.minAgeMonths) return false;
    if (plan.maxAgeMonths != null && ageMonths > plan.maxAgeMonths) return false;
  }
  return true;
}

function planMatchesSpecies(plan: Bundle, kind: 'dog' | 'cat' | null): boolean {
  if (!kind) return false;
  const planKind =
    resolveMembershipPetKind({ species: plan.species }) ||
    resolveMembershipPetKind({ species: plan.name }) ||
    resolveMembershipPetKind({ breed: plan.name });
  if (!planKind) return true;
  return planKind === kind;
}

/** Portal: recommend Golden when senior; otherwise Foundations (not Plus). */
function isRecommendedPlan(
  plan: Bundle,
  kind: 'dog' | 'cat' | null,
  ageYears: number | null | undefined,
): boolean {
  if (planIsPlus(plan)) return false;
  const family = planFamily(plan);
  const meetsGolden =
    kind != null &&
    ageYears != null &&
    Number.isFinite(ageYears) &&
    ageYears >= MEMBERSHIP_GOLDEN_MIN_AGE_YEARS;
  if (meetsGolden) return family === 'golden';
  return family === 'foundations';
}

function ageYearsFromPatientPayload(payload: unknown): number | null {
  if (payload == null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const dobRaw = p.dateOfBirth ?? p.dob ?? p.date_of_birth;
  if (typeof dobRaw === 'string' && dobRaw.trim()) {
    const d = new Date(dobRaw);
    if (!Number.isNaN(d.getTime())) {
      return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    }
  }
  return null;
}

function substitutionPayload(
  map: Record<string, string>,
): PostVisitLineSubstitution[] {
  return Object.entries(map)
    .filter(([, value]) => Boolean(value))
    .map(([visitInvoiceLineId, value]) => {
      const [itemType, id] = value.split(':');
      return {
        visitInvoiceLineId,
        itemType: itemType as MembershipItemType,
        catalogItemId: Number(id),
      };
    })
    .filter(
      (row) =>
        (row.itemType === 'lab' ||
          row.itemType === 'procedure' ||
          row.itemType === 'inventory') &&
        Number.isFinite(row.catalogItemId) &&
        row.catalogItemId > 0,
    );
}

function describeAge(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function invoiceStamp(inv: VisitInvoice): string | null {
  return inv.paidAt || inv.finalizedAt || inv.created || null;
}

function invoiceLabel(inv: VisitInvoice): string {
  const when = invoiceStamp(inv);
  const date = when
    ? new Date(when).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Unknown date';
  const petNames = [
    ...new Set(
      (inv.lines ?? [])
        .map((l) => (l.patientName || '').trim())
        .filter(Boolean),
    ),
  ];
  const pets = petNames.length ? petNames.join(', ') : inv.patientId ? `Pet #${inv.patientId}` : 'Pet';
  const source = inv.id.startsWith('evet:')
    ? `eVet${inv.evetInvoiceNumber != null ? ` #${inv.evetInvoiceNumber}` : ''}`
    : inv.evetInvoiceId != null
      ? `eVet #${inv.evetInvoiceNumber ?? inv.evetInvoiceId}`
      : inv.appointmentId
        ? 'Visit'
        : 'Store / counter';
  return `${date} · ${pets} · ${source} · ${money(inv.total)}`;
}

/** Paid eVet ledger rows, shown until they are taken over into Scout. */
function evetPickerInvoice(inv: NormalizedInvoice): VisitInvoice | null {
  const evetId = Number(inv.raw.id);
  if (!Number.isFinite(evetId)) return null;
  if (inv.raw.isDeleted === true) return null;
  const status = String(inv.status).toLowerCase();
  if (status === 'void' || status === 'deleted') return null;
  if ((Number(inv.paid) || 0) <= 0.009) return null;
  const when = typeof inv.raw.invoicedDate === 'string' ? inv.raw.invoicedDate : null;
  const number = Number(inv.number);
  const id = `evet:${evetId}`;
  return {
    id,
    practiceId: 0,
    appointmentId: null,
    clientId: null,
    status: 'paid',
    subtotal: inv.total,
    membershipAdjustments: 0,
    taxTotal: 0,
    total: inv.total,
    amountPaid: inv.paid,
    isEuthanasiaPrepay: false,
    stripeCustomerId: null,
    stripeSetupIntentId: null,
    savedPaymentMethodId: null,
    stripePaymentIntentId: null,
    lastChargeStatus: null,
    finalizedAt: when,
    paidAt: when,
    created: when ?? undefined,
    evetInvoiceId: evetId,
    evetInvoiceNumber: Number.isFinite(number) ? number : null,
    lines: inv.lines
      .filter((line) => !line.isRemoved)
      .map((line) => ({
        id: line.key,
        invoiceId: id,
        orderId: null,
        patientId: line.patientId,
        patientName: line.patient && line.patient !== '—' ? line.patient : null,
        description: line.description,
        qty: Number(line.qty) || 1,
        unitPrice: line.unitPrice,
        amount: line.total,
        isCovered: line.isCovered,
      })),
  };
}

/**
 * Post-visit membership signup: re-price selected invoices under a new plan,
 * refund overpayment, credit benefits, email the client.
 */
export default function PostVisitMembershipSignup({
  visitInvoiceId,
  clientId,
  patientId,
  initialInvoiceIds,
  seedInvoices,
  patientName,
  patientSpecies,
  patientAgeYears,
  choosePet = false,
  householdPets = [],
  onClose,
  onCompleted,
}: Props) {
  const [chosenPatientId, setChosenPatientId] = useState<number | null>(null);
  const enrollPatientId = choosePet ? chosenPatientId : (patientId ?? null);
  const enrollName = choosePet
    ? (householdPets.find((p) => p.id === chosenPatientId)?.name ?? null)
    : (patientName ?? null);
  const needsPicker = (clientId != null || enrollPatientId != null) && !visitInvoiceId;
  const [plans, setPlans] = useState<Bundle[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [billingInterval, setBillingInterval] =
    useState<MembershipBillingInterval>('monthly');
  const [ownerPaidPlan, setOwnerPaidPlan] = useState<{
    packageId: number;
    planName: string;
    billingInterval: MembershipBillingInterval;
  } | null>(null);
  const [preview, setPreview] = useState<PostVisitSignupPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [skipRefund, setSkipRefund] = useState(false);
  const [note, setNote] = useState('');
  const [overrideWindow, setOverrideWindow] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PostVisitSignupResult | null>(null);
  const createCardRef = useRef<(() => Promise<string>) | null>(null);

  const [allInvoices, setAllInvoices] = useState<VisitInvoice[]>([]);
  const evetRowsRef = useRef<VisitInvoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(needsPicker);
  const [hoursOfOperation, setHoursOfOperation] =
    useState<ChatHoursOfOperation | null>(null);
  const [lookbackBands, setLookbackBands] = useState(1);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (visitInvoiceId) return [visitInvoiceId];
    return initialInvoiceIds?.length ? [...initialInvoiceIds] : [];
  });
  const [householdFallback, setHouseholdFallback] = useState(false);
  const [resolvedSpecies, setResolvedSpecies] = useState<string | null>(
    choosePet ? null : (patientSpecies ?? null),
  );
  const [resolvedAgeYears, setResolvedAgeYears] = useState<number | null>(
    choosePet ? null : (patientAgeYears ?? null),
  );
  const [memberPatientIds, setMemberPatientIds] = useState<Set<number>>(new Set());
  const [substitutions, setSubstitutions] = useState<Record<string, string>>({});
  const previewSeq = useRef(0);
  const subKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (choosePet) return;
    setResolvedSpecies(patientSpecies ?? null);
  }, [choosePet, patientSpecies]);

  useEffect(() => {
    if (choosePet) return;
    setResolvedAgeYears(patientAgeYears ?? null);
  }, [choosePet, patientAgeYears]);

  useEffect(() => {
    if (enrollPatientId == null) {
      if (choosePet) {
        setResolvedSpecies(null);
        setResolvedAgeYears(null);
      }
      return;
    }
    let cancelled = false;
    void fetchPatientByIdStaff(enrollPatientId)
      .then((payload) => {
        if (cancelled || payload == null) return;
        const kind = resolveMembershipPetKind(payload);
        if (kind) setResolvedSpecies(kind === 'dog' ? 'Canine' : 'Feline');
        const age = ageYearsFromPatientPayload(payload);
        if (age != null) setResolvedAgeYears(age);
      })
      .catch(() => {
        /* keep whatever we have */
      });
    return () => {
      cancelled = true;
    };
  }, [choosePet, enrollPatientId]);

  useEffect(() => {
    if (!choosePet || clientId == null) return;
    let cancelled = false;
    void listPatientMemberships({ clientId })
      .then((rows) => {
        if (cancelled) return;
        setMemberPatientIds(
          new Set(
            rows.filter((row) => row.status === 'active').map((row) => row.patientId),
          ),
        );
      })
      .catch(() => {
        /* picker still works without the member badges */
      });
    return () => {
      cancelled = true;
    };
  }, [choosePet, clientId]);

  useEffect(() => {
    if (enrollPatientId == null) {
      setOwnerPaidPlan(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [rows, settings] = await Promise.all([
          listPatientMemberships({ patientId: enrollPatientId }),
          getPracticeSettings(VISIT_WORKFLOW_PRACTICE_ID).catch(() => null),
        ]);
        if (cancelled) return;
        const windowHours = membershipPostVisitSignupWindowHours(settings);
        const paid = rows.find((row) => {
          if (row.status !== 'active') return false;
          if (!row.stripeSubscriptionId?.startsWith('sub_')) return false;
          if (!row.startDate) return false;
          const ageHours = (Date.now() - Date.parse(row.startDate)) / 3_600_000;
          return ageHours >= -1 && ageHours <= windowHours + 1;
        });
        if (!paid) {
          setOwnerPaidPlan(null);
          return;
        }
        const interval: MembershipBillingInterval =
          paid.billingInterval === 'annual' ? 'annual' : 'monthly';
        setOwnerPaidPlan({
          packageId: paid.packageId,
          planName: paid.planName,
          billingInterval: interval,
        });
        setPackageId(paid.packageId);
        setBillingInterval(interval);
      } catch {
        if (!cancelled) setOwnerPaidPlan(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enrollPatientId]);

  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    listBundles({ kind: 'membership' })
      .then((rows) => {
        if (cancelled) return;
        const sellable = rows.filter((r) => !r.isArchived && r.isActive);
        setPlans(sellable);
        if (sellable.length === 1) setPackageId(sellable[0].id);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPaidInvoiceRows = useCallback(
    (rows: VisitInvoice[]) => {
      const paidAll = rows.filter(
        (r) => (Number(r.amountPaid) || 0) > 0 && r.status !== 'void',
      );
      const adopted = new Set(
        paidAll.map((r) => r.evetInvoiceId).filter((id): id is number => id != null),
      );
      const combined = [
        ...paidAll,
        ...evetRowsRef.current.filter(
          (row) => row.evetInvoiceId == null || !adopted.has(row.evetInvoiceId),
        ),
      ];
      let paid = combined;
      let usedHouseholdFallback = false;
      if (enrollPatientId != null) {
        const forPet = combined.filter((inv) => {
          if (inv.patientId === enrollPatientId) return true;
          const lines = inv.lines ?? [];
          if (lines.length === 0) {
            return inv.patientId == null;
          }
          return lines.some(
            (l) => l.patientId == null || l.patientId === enrollPatientId,
          );
        });
        if (forPet.length > 0) {
          paid = forPet;
        } else if (combined.length > 0) {
          paid = combined;
          usedHouseholdFallback = true;
        } else {
          paid = [];
        }
      }
      setHouseholdFallback(usedHouseholdFallback);
      setAllInvoices(paid);
      setShowAllInvoices(false);
      setLookbackBands(1);
      const allowed = new Set(paid.map((inv) => inv.id));
      setSelectedIds((cur) => {
        const kept = cur.filter((id) => allowed.has(id));
        if (kept.length) return kept;
        const seeded = (initialInvoiceIds ?? []).filter((id) => allowed.has(id));
        return seeded;
      });
    },
    [enrollPatientId, initialInvoiceIds],
  );

  useEffect(() => {
    if (!needsPicker || clientId == null) return;
    let cancelled = false;

    if (seedInvoices && seedInvoices.length > 0) {
      applyPaidInvoiceRows(seedInvoices);
      setInvoicesLoading(false);
    } else {
      setInvoicesLoading(true);
    }

    Promise.all([
      listClientVisitInvoices(clientId, { lite: true }),
      fetchChatHoursOfOperation(Number(import.meta.env.VITE_PRACTICE_ID) || 1).catch(
        () => null,
      ),
      fetchClientBillingStaff(
        clientId,
        Number(import.meta.env.VITE_PRACTICE_ID) || 1,
      ).catch(() => ({})),
    ])
      .then(([rows, hours, billing]) => {
        if (cancelled) return;
        const evet = normalizeInvoicesFromClient(billing)
          .map(evetPickerInvoice)
          .filter((row): row is VisitInvoice => row != null);
        evetRowsRef.current = evet;
        applyPaidInvoiceRows(rows);
        setHoursOfOperation(hours);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setInvoicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyPaidInvoiceRows, clientId, needsPicker, seedInvoices]);

  const cutoff = useMemo(
    () =>
      cutoffAfterBusinessHoursAgo({
        businessHours: lookbackBands * PICKER_BAND_BUSINESS_HOURS,
        hoursOfOperation,
        timeZone: DEFAULT_PRACTICE_TIMEZONE,
      }),
    [hoursOfOperation, lookbackBands],
  );

  const visibleInvoices = useMemo(() => {
    const byId = new Map(allInvoices.map((i) => [i.id, i]));
    let inBand: VisitInvoice[];
    if (showAllInvoices) {
      inBand = [...allInvoices];
    } else {
      inBand = allInvoices.filter((inv) => {
        const stamp = invoiceStamp(inv);
        // Missing stamps only appear after staff asks to look earlier.
        if (stamp == null) return lookbackBands > 1;
        return invoiceInLookback(stamp, cutoff);
      });
    }
    for (const id of selectedIds) {
      const row = byId.get(id);
      if (row && !inBand.some((r) => r.id === id)) inBand.push(row);
    }
    return inBand.sort((a, b) => {
      const ta = Date.parse(invoiceStamp(a) || '') || 0;
      const tb = Date.parse(invoiceStamp(b) || '') || 0;
      return tb - ta;
    });
  }, [allInvoices, cutoff, lookbackBands, selectedIds, showAllInvoices]);

  const hiddenOlderCount = useMemo(() => {
    if (showAllInvoices) return 0;
    const visibleIds = new Set(visibleInvoices.map((i) => i.id));
    return allInvoices.filter((inv) => !visibleIds.has(inv.id)).length;
  }, [allInvoices, showAllInvoices, visibleInvoices]);

  const hasOlderInvoices = hiddenOlderCount > 0;

  const selectedInvoiceIds = visitInvoiceId
    ? [visitInvoiceId]
    : selectedIds;

  useEffect(() => {
    setPreview(null);
    setSubstitutions({});
    setOverrideWindow(false);
    setOverrideReason('');
  }, [packageId, billingInterval, enrollPatientId, selectedInvoiceIds.join(',')]);

  const materializeInvoices = useCallback(async (ids: string[]) => {
    const out: string[] = [];
    const swapped = new Map<string, VisitInvoice>();
    for (const id of ids) {
      if (!id.startsWith('evet:')) {
        out.push(id);
        continue;
      }
      const evetId = Number(id.slice(5));
      const adopted = await adoptEvetInvoice(evetId);
      swapped.set(id, adopted);
      out.push(adopted.id);
    }
    if (swapped.size > 0) {
      setAllInvoices((cur) => cur.map((inv) => swapped.get(inv.id) ?? inv));
      setSelectedIds(out);
    }
    return out;
  }, []);

  const runPreview = useCallback(async () => {
    if (!packageId || selectedInvoiceIds.length === 0) return;
    if (choosePet && enrollPatientId == null) return;
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setError(null);
    try {
      const visitInvoiceIds = await materializeInvoices(selectedInvoiceIds);
      const next = await previewPostVisitSignup({
        visitInvoiceIds,
        packageId,
        billingInterval,
        ...(enrollPatientId != null ? { patientId: enrollPatientId } : {}),
        ...(Object.keys(substitutions).length
          ? { substitutions: substitutionPayload(substitutions) }
          : {}),
      });
      if (seq !== previewSeq.current) return;
      setPreview(next);
    } catch (e) {
      if (seq !== previewSeq.current) return;
      setPreview(null);
      setError(apiErrorMessage(e));
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
    }
  }, [
    billingInterval,
    choosePet,
    enrollPatientId,
    materializeInvoices,
    packageId,
    selectedInvoiceIds,
    substitutions,
  ]);

  const runExecute = useCallback(async () => {
    if (!packageId || !preview || selectedInvoiceIds.length === 0) return;
    if (preview.outsideWindow && (!overrideWindow || !overrideReason.trim())) {
      setError('Confirm the window override and add a short reason before continuing.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      let paymentMethodId: string | undefined;
      if (preview.needsCard && !preview.ownerAlreadyPaid) {
        if (!createCardRef.current) {
          setError('Enter a card to start the membership.');
          setRunning(false);
          return;
        }
        paymentMethodId = await createCardRef.current();
      }
      const visitInvoiceIds = await materializeInvoices(selectedInvoiceIds);
      const res = await executePostVisitSignup({
        visitInvoiceIds,
        packageId,
        billingInterval,
        confirmRefundAmount: preview.refundDue,
        confirmChargeAmount: preview.balanceDue,
        confirmSubscriptionAmount: preview.subscriptionAmount ?? 0,
        skipRefund,
        ...(paymentMethodId ? { paymentMethodId } : {}),
        ...(enrollPatientId != null ? { patientId: enrollPatientId } : {}),
        ...(Object.keys(substitutions).length
          ? { substitutions: substitutionPayload(substitutions) }
          : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(preview.outsideWindow
          ? {
              overrideWindow: true,
              overrideWindowReason: overrideReason.trim(),
            }
          : {}),
      });
      setResult(res);
      onCompleted(res);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [
    enrollPatientId,
    note,
    onCompleted,
    overrideReason,
    overrideWindow,
    materializeInvoices,
    packageId,
    preview,
    selectedInvoiceIds,
    skipRefund,
    substitutions,
    billingInterval,
  ]);

  const substitutionKey = useMemo(
    () =>
      Object.entries(substitutions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([lineId, value]) => `${lineId}=${value}`)
        .join('|'),
    [substitutions],
  );

  useEffect(() => {
    if (subKeyRef.current == null) {
      subKeyRef.current = substitutionKey;
      return;
    }
    if (subKeyRef.current === substitutionKey) return;
    subKeyRef.current = substitutionKey;
    if (!packageId || selectedInvoiceIds.length === 0) return;
    if (choosePet && enrollPatientId == null) return;
    void runPreview();
  }, [
    choosePet,
    enrollPatientId,
    packageId,
    runPreview,
    selectedInvoiceIds.length,
    substitutionKey,
  ]);

  const petKind = useMemo(
    () => resolveMembershipPetKind({ species: resolvedSpecies }),
    [resolvedSpecies],
  );
  const ageYears = resolvedAgeYears ?? patientAgeYears ?? null;

  const visiblePlans = useMemo(() => {
    const filtered = plans.filter((plan) => {
      if (billingIntervalForPlan(plan) !== billingInterval) return false;
      if (!planMatchesSpecies(plan, petKind)) return false;
      if (!planAllowedForPet(plan, petKind, ageYears)) return false;
      return listedPriceForPlan(plan) != null;
    });
    return filtered.sort((a, b) => {
      const ar = isRecommendedPlan(a, petKind, ageYears) ? 0 : 1;
      const br = isRecommendedPlan(b, petKind, ageYears) ? 0 : 1;
      if (ar !== br) return ar - br;
      const ap = planIsPlus(a) ? 1 : 0;
      const bp = planIsPlus(b) ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [ageYears, billingInterval, petKind, plans]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === packageId) ?? null,
    [packageId, plans],
  );

  useEffect(() => {
    if (packageId && !visiblePlans.some((p) => p.id === packageId)) {
      setPackageId(null);
    }
  }, [packageId, visiblePlans]);

  // Prefer auto-selecting the recommended plan once plans + pet details are ready.
  useEffect(() => {
    if (packageId != null || plansLoading) return;
    const rec = visiblePlans.find((p) => isRecommendedPlan(p, petKind, ageYears));
    if (rec) setPackageId(rec.id);
  }, [ageYears, packageId, petKind, plansLoading, visiblePlans]);

  const assignableBenefits = useMemo(() => {
    if (!selectedPlan) return [];
    const seen = new Set<string>();
    const out: { key: string; name: string }[] = [];
    for (const group of selectedPlan.groups ?? []) {
      for (const item of group.items ?? []) {
        const key = `${item.itemType}:${item.catalogItemId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cover =
          item.coverage === 'included'
            ? 'included'
            : item.coverage === 'copay'
              ? 'copay'
              : 'discount';
        out.push({ key, name: `${item.name} · ${cover}` });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedPlan]);

  const assignedLineIds = useMemo(
    () =>
      new Set(
        Object.entries(substitutions)
          .filter(([, value]) => Boolean(value))
          .map(([lineId]) => lineId),
      ),
    [substitutions],
  );
  const covered =
    preview?.lines.filter(
      (l) => l.coveredByMembership && !assignedLineIds.has(l.visitInvoiceLineId),
    ) ?? [];
  const notCovered =
    preview?.lines.filter(
      (l) => !l.coveredByMembership || assignedLineIds.has(l.visitInvoiceLineId),
    ) ?? [];
  const visitAge = describeAge(
    preview?.oldestInvoiceAgeHours ?? preview?.invoice.visitAgeHours ?? null,
  );
  const canExecute =
    Boolean(preview) &&
    !running &&
    !previewing &&
    (!choosePet || enrollPatientId != null) &&
    (!preview?.outsideWindow || (overrideWindow && Boolean(overrideReason.trim())));
  const planStep = 1 + (choosePet ? 1 : 0) + (needsPicker ? 1 : 0);
  const numbersStep = planStep + 1;
  const ownerAlreadyPaid = preview
    ? Boolean(preview.ownerAlreadyPaid)
    : Boolean(ownerPaidPlan);
  const ownerSees = preview ? ownerWillSee(preview, billingInterval) : null;

  function toggleInvoice(id: string) {
    setSelectedIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  return createPortal(
    <div className="pvms-backdrop" role="dialog" aria-modal="true" aria-label="Post-visit membership signup">
      <div className="pvms-modal">
        <header className="pvms-head">
          <div>
            <h2 className="pvms-title">
              <ShieldCheck size={18} aria-hidden="true" />
              Post-visit membership signup
            </h2>
            <p className="pvms-sub">
              {ownerAlreadyPaid
                ? `${enrollName ?? 'This pet'} already paid for ${
                    ownerPaidPlan?.planName ?? preview?.planName ?? 'this membership'
                  } in Stripe. This refunds the covered visit only.`
                : choosePet && !enrollName
                  ? 'Choose which pet to enroll, then re-price selected invoices and refund the difference.'
                  : enrollName
                    ? `Enroll ${enrollName}, re-price selected invoices, and refund the difference.`
                    : 'Enroll this pet, re-price selected invoices, and refund the difference.'}
            </p>
          </div>
          <button type="button" className="pvms-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="pvms-body">
          {error && (
            <div className="pvms-alert pvms-alert--error">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {result ? (
            <SignupReceipt result={result} />
          ) : (
            <>
              {choosePet ? (
                <section className="pvms-section">
                  <h3 className="pvms-section__title">1. Which pet?</h3>
                  <p className="pvms-muted">
                    This membership is for one pet. Plans follow that pet’s species and age.
                    Pets who already have a membership are marked — pick the one who is not
                    enrolled yet.
                  </p>
                  {householdPets.length === 0 ? (
                    <p className="pvms-muted">No pets on this client.</p>
                  ) : (
                    <div className="pvms-plans" role="radiogroup" aria-label="Pet to enroll">
                      {householdPets.map((pet) => {
                        const already = memberPatientIds.has(pet.id);
                        return (
                          <button
                            key={pet.id}
                            type="button"
                            role="radio"
                            aria-checked={chosenPatientId === pet.id}
                            className={`pvms-plan${chosenPatientId === pet.id ? ' is-selected' : ''}`}
                            onClick={() => setChosenPatientId(pet.id)}
                            disabled={running}
                          >
                            <span className="pvms-plan__name">{pet.name}</span>
                            <span className="pvms-plan__price">
                              {already ? 'Already a member' : 'Not enrolled'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : null}

              {needsPicker ? (
                <section className="pvms-section">
                  <h3 className="pvms-section__title">
                    {choosePet ? '2. Choose invoices' : '1. Choose invoices'}
                  </h3>
                  <p className="pvms-muted">
                    {showAllInvoices
                      ? 'Showing all paid invoices for this household, including eVet bills. Select one or more for the same pet.'
                      : `Showing paid invoices from the last ${
                          lookbackBands * PICKER_BAND_BUSINESS_HOURS
                        } business hours, including eVet. Select one or more for the same pet.`}
                  </p>
                  <p className="pvms-muted">
                    eVet invoices are taken over into Scout when you calculate. Those refunds are
                    by hand — they were not paid in Stripe.
                  </p>
                  {householdFallback ? (
                    <p className="pvms-muted">
                      Couldn’t match invoices to this pet by id — showing household paid Scout
                      invoices. Pick the ones for this pet.
                    </p>
                  ) : null}
                  {invoicesLoading ? (
                    <p className="pvms-muted">Loading invoices…</p>
                  ) : visibleInvoices.length === 0 ? (
                    <p className="pvms-muted">
                      {allInvoices.length === 0
                        ? 'No paid invoices for this household yet. Scout receipts and eVet bills both show here once they are paid.'
                        : hasOlderInvoices
                          ? 'No paid invoices in this window. Click Load earlier to include older receipts.'
                          : 'No paid invoices in this window.'}
                    </p>
                  ) : (
                    <ul className="pvms-invoice-list">
                      {visibleInvoices.map((inv) => (
                        <li key={inv.id}>
                          <label className="pvms-check pvms-invoice-row">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(inv.id)}
                              onChange={() => toggleInvoice(inv.id)}
                              disabled={running}
                            />
                            <span>{invoiceLabel(inv)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  {hasOlderInvoices ? (
                    <div className="pvms-lookback-actions">
                      <button
                        type="button"
                        className="btn secondary pvms-preview-btn"
                        disabled={running || invoicesLoading}
                        onClick={() => setLookbackBands((n) => n + 1)}
                      >
                        Load earlier (another {PICKER_BAND_BUSINESS_HOURS} business hours)
                        {hiddenOlderCount > 0 ? ` · ${hiddenOlderCount} older` : ''}
                      </button>
                      <button
                        type="button"
                        className="btn secondary pvms-preview-btn"
                        disabled={running || invoicesLoading}
                        onClick={() => setShowAllInvoices(true)}
                      >
                        Show all paid invoices
                      </button>
                    </div>
                  ) : allInvoices.length > 0 && (lookbackBands > 1 || showAllInvoices) ? (
                    <p className="pvms-muted">
                      {showAllInvoices
                        ? 'All paid Scout invoices are listed above.'
                        : 'No older paid Scout invoices.'}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section className="pvms-section">
                {ownerAlreadyPaid ? (
                  <>
                    <h3 className="pvms-section__title">{planStep}. Owner already paid</h3>
                    <p className="pvms-muted">
                      {ownerPaidPlan?.planName ?? preview?.planName ?? 'This membership'} is
                      already in Stripe
                      {ownerPaidPlan
                        ? ` at ${
                            ownerPaidPlan.billingInterval === 'annual'
                              ? 'the annual price'
                              : 'the monthly price'
                          }`
                        : ''}
                      . The first month or year is not charged again, and a second membership is
                      not started. Calculate the visit refund below.
                    </p>
                  </>
                ) : (
                  <>
                <h3 className="pvms-section__title">
                  {planStep}. Choose the plan
                </h3>
                <div className="pvms-interval" role="radiogroup" aria-label="Billing interval">
                  {(['monthly', 'annual'] as MembershipBillingInterval[]).map((iv) => (
                    <button
                      key={iv}
                      type="button"
                      role="radio"
                      aria-checked={billingInterval === iv}
                      className={`pvms-interval__btn${billingInterval === iv ? ' is-active' : ''}`}
                      onClick={() => {
                        setBillingInterval(iv);
                        setPackageId(null);
                      }}
                      disabled={running}
                    >
                      {iv === 'monthly' ? 'Monthly' : 'Annual'}
                    </button>
                  ))}
                </div>
                {plansLoading ? (
                  <p className="pvms-muted">Loading plans…</p>
                ) : visiblePlans.length === 0 ? (
                  <p className="pvms-muted">
                    {!petKind
                      ? 'Select a pet with a known species (dog or cat) to see recommended membership plans.'
                      : `No ${billingInterval} plans match this pet (${petKind})${
                          ageYears != null ? ` at ${ageYears.toFixed(1)} years` : ''
                        }. Check Settings → Memberships for species, age, and ${billingInterval} prices.`}
                  </p>
                ) : (
                  <div className="pvms-plans">
                    {visiblePlans.map((plan) => {
                      const price = listedPriceForPlan(plan);
                      const recommended = isRecommendedPlan(plan, petKind, ageYears);
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`pvms-plan${packageId === plan.id ? ' is-selected' : ''}${
                            recommended ? ' is-recommended' : ''
                          }`}
                          onClick={() => {
                            setPackageId(plan.id);
                            setBillingInterval(billingIntervalForPlan(plan));
                          }}
                          disabled={running}
                        >
                          {recommended ? (
                            <span className="pvms-plan__badge">Recommended</span>
                          ) : null}
                          <span className="pvms-plan__name">{plan.name}</span>
                          {plan.tier && <span className="pvms-plan__tier">{plan.tier}</span>}
                          <span className="pvms-plan__price">
                            {price == null
                              ? 'No price set'
                              : `${money(price)} / ${
                                  billingIntervalForPlan(plan) === 'annual' ? 'yr' : 'mo'
                                }`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                  </>
                )}
              </section>

              <section className="pvms-section">
                <h3 className="pvms-section__title">
                  {numbersStep}. Check the numbers
                </h3>
                <button
                  type="button"
                  className="btn secondary pvms-preview-btn"
                  onClick={runPreview}
                  disabled={
                    !packageId ||
                    selectedInvoiceIds.length === 0 ||
                    (choosePet && enrollPatientId == null) ||
                    previewing ||
                    running
                  }
                >
                  {previewing ? (
                    <>
                      <Loader2 size={14} className="pvms-spin" aria-hidden="true" /> Working it
                      out…
                    </>
                  ) : (
                    <>
                      <CircleDollarSign size={14} aria-hidden="true" />
                      {preview ? 'Recalculate' : 'Calculate refund'}
                    </>
                  )}
                </button>

                {preview && (
                  <>
                    {preview.warnings.length > 0 && (
                      <div className="pvms-alert pvms-alert--warn">
                        <AlertTriangle size={15} aria-hidden="true" />
                        <ul className="pvms-warnlist">
                          {preview.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {visitAge && (
                      <p className="pvms-muted pvms-agenote">
                        Oldest selected invoice was billed {visitAge}
                        {preview.windowHours != null
                          ? ` (window ${preview.windowHours}h)`
                          : ''}
                        .
                      </p>
                    )}

                    {preview.outsideWindow ? (
                      <div className="pvms-override">
                        <label className="pvms-check">
                          <input
                            type="checkbox"
                            checked={overrideWindow}
                            onChange={(e) => setOverrideWindow(e.target.checked)}
                            disabled={running}
                          />
                          <span>
                            Override the post-visit window
                            <em className="pvms-check__hint">
                              Required outside the practice window. This is written to the
                              membership audit.
                            </em>
                          </span>
                        </label>
                        {overrideWindow ? (
                          <label className="pvms-field">
                            <span className="pvms-field__label">Override reason</span>
                            <input
                              type="text"
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              placeholder="e.g. client called back next day"
                              disabled={running}
                            />
                          </label>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="pvms-totals">
                      <Total label="Paid on selected invoices" value={money(preview.amountAlreadyPaid)} />
                      <Total
                        label="Covered by membership"
                        value={money(Math.abs(preview.membershipAdjustments))}
                        tone="good"
                      />
                      {(preview.planPrice ?? 0) > 0 && !preview.ownerAlreadyPaid ? (
                        <Total
                          label={membershipChargeLabel(preview, billingInterval)}
                          value={money(preview.planPrice)}
                        />
                      ) : null}
                      <Total label="New total owed" value={money(preview.newTotal)} />
                      <Total
                        label={preview.balanceDue > 0 ? 'Still owed' : 'One-time refund'}
                        value={money(
                          preview.balanceDue > 0 ? preview.balanceDue : preview.refundDue,
                        )}
                        tone={preview.balanceDue > 0 ? 'warn' : 'accent'}
                        emphasis
                      />
                    </div>
                    {ownerSees ? <p className="pvms-owner-sees">{ownerSees}</p> : null}

                    {preview.needsCard && !preview.ownerAlreadyPaid ? (
                      <div className="pvms-card-block">
                        <h4 className="pvms-lines__title">Card for the membership</h4>
                        <p className="pvms-muted">
                          {preview.paidInStripe
                            ? 'This visit was paid in Stripe, but that payment cannot start a membership — a terminal swipe is not a reusable card. Enter a card to charge the first period and start the subscription.'
                            : 'Enter a card to charge the first period and start the subscription.'}
                        </p>
                        <PostVisitCardEntry
                          name={enrollName}
                          onReady={(create) => {
                            createCardRef.current = create;
                          }}
                        />
                      </div>
                    ) : null}

                    {(preview.invoices?.length ?? 0) > 1 ? (
                      <div className="pvms-lines">
                        <h4 className="pvms-lines__title">By invoice</h4>
                        <table className="pvms-table">
                          <thead>
                            <tr>
                              <th>Invoice</th>
                              <th className="pvms-num">Paid</th>
                              <th className="pvms-num">New total</th>
                              <th className="pvms-num">Refund</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.invoices!.map((inv) => (
                              <tr key={inv.id}>
                                <td>
                                  {inv.visitAt
                                    ? new Date(inv.visitAt).toLocaleString(undefined, {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit',
                                      })
                                    : inv.id.slice(0, 8)}
                                </td>
                                <td className="pvms-num">{money(inv.amountPaid)}</td>
                                <td className="pvms-num">{money(inv.newTotal ?? 0)}</td>
                                <td className="pvms-num">{money(inv.refundDue ?? 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    <LineTable
                      title={`Covered by ${selectedPlan?.name ?? 'the plan'}`}
                      lines={covered}
                      empty="Nothing on these bills is covered by that plan."
                    />
                    <LineTable
                      title="Not covered — assign to a plan benefit if it should count"
                      lines={notCovered}
                      empty="Everything on these bills is covered."
                      assignOptions={assignableBenefits}
                      assignments={substitutions}
                      onAssign={(lineId, value) => {
                        setSubstitutions((cur) => {
                          const next = { ...cur };
                          if (!value) delete next[lineId];
                          else next[lineId] = value;
                          return next;
                        });
                      }}
                      disabled={running || previewing}
                    />

                    <label className="pvms-check">
                      <input
                        type="checkbox"
                        checked={skipRefund}
                        onChange={(e) => setSkipRefund(e.target.checked)}
                        disabled={running}
                      />
                      <span>
                        {preview && preview.balanceDue > 0.009 && preview.refundDue <= 0.009
                          ? 'Don’t charge the card automatically'
                          : 'Don’t issue the refund automatically'}
                        <em className="pvms-check__hint">
                          {preview && preview.balanceDue > 0.009 && preview.refundDue <= 0.009
                            ? 'The membership is still created and invoices are still re-priced — collect the balance by hand.'
                            : 'The membership is still created and invoices are still re-priced — only the money stays put. Use this if you’ll refund by hand.'}
                        </em>
                      </span>
                    </label>

                    <label className="pvms-field">
                      <span className="pvms-field__label">Note for the record (optional)</span>
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. signed up at the door"
                        disabled={running}
                      />
                    </label>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="pvms-foot">
          {result ? (
            <button type="button" className="btn primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn secondary" onClick={onClose} disabled={running}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={runExecute}
                disabled={!canExecute}
                title={
                  !preview
                    ? 'Calculate the refund first'
                    : preview.outsideWindow && !overrideWindow
                      ? 'Override the window to continue'
                      : undefined
                }
              >
                {running ? (
                  <>
                    <Loader2 size={14} className="pvms-spin" aria-hidden="true" /> Signing them
                    up…
                  </>
                ) : (
                  signupActionLabel(preview, skipRefund, billingInterval)
                )}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function membershipChargeLabel(
  preview: PostVisitSignupPreview,
  billingInterval: MembershipBillingInterval,
): string {
  const every = billingInterval === 'annual' ? 'every year' : 'every month';
  if ((preview.subscriptionAmount ?? 0) > 0.009 || preview.needsCard) {
    return `Charged today, then ${every}`;
  }
  return billingInterval === 'annual'
    ? 'First year of membership'
    : 'First month of membership';
}

function ownerWillSee(
  preview: PostVisitSignupPreview,
  billingInterval: MembershipBillingInterval,
): string | null {
  const every = billingInterval === 'annual' ? 'every year' : 'every month';
  const first = billingInterval === 'annual' ? 'first year' : 'first month';
  const price = preview.planPrice ?? 0;
  const subscription = preview.subscriptionAmount ?? 0;
  if (preview.ownerAlreadyPaid) {
    if (preview.refundDue <= 0.009) {
      return 'The owner already paid for this membership. Nothing else is charged or refunded.';
    }
    const byHand = preview.manualSettlement ? ' by hand' : '';
    return `The owner will see a one-time refund of ${money(preview.refundDue)}${byHand} for services they already paid that this membership covers. They already paid for the membership, so they will not be charged again.`;
  }
  if (subscription > 0.009 || preview.needsCard) {
    const amount = subscription > 0.009 ? subscription : price;
    const charge = `a charge of ${money(amount)} today, and ${money(amount)} ${every}`;
    if (preview.refundDue > 0.009) {
      const byHand = preview.manualSettlement ? ' by hand' : '';
      return `The owner will see ${charge}, plus a one-time refund of ${money(preview.refundDue)}${byHand} for services they already paid that this membership covers.`;
    }
    return `The owner will see ${charge}.`;
  }
  if (price > 0.009 && preview.balanceDue > 0.009) {
    return `The owner still owes ${money(preview.balanceDue)}. The membership is ${money(price)} ${every}, and the visit credit did not cover the ${first}.`;
  }
  return null;
}

function signupActionLabel(
  preview: PostVisitSignupPreview | null,
  skipRefund: boolean,
  billingInterval: MembershipBillingInterval,
): string {
  if (!preview) return `Sign up & refund ${money(0)}`;
  if (preview.ownerAlreadyPaid) {
    if (skipRefund) return 'Re-price only (no refund)';
    if (preview.manualSettlement && preview.refundDue > 0.009) {
      return `Refund ${money(preview.refundDue)} by hand`;
    }
    return `Refund ${money(preview.refundDue)}`;
  }
  if (skipRefund) {
    return preview.balanceDue > 0.009 && preview.refundDue <= 0.009
      ? 'Sign up & re-price (no charge)'
      : 'Sign up & re-price (no refund)';
  }
  const subscription = preview.subscriptionAmount ?? 0;
  if (subscription > 0.009) {
    const cadence = billingInterval === 'annual' ? 'yr' : 'mo';
    const start = `start ${money(subscription)}/${cadence} subscription`;
    if (preview.manualSettlement && preview.refundDue > 0.009) {
      return `Sign up — refund ${money(preview.refundDue)} by hand & ${start}`;
    }
    if (preview.refundDue > 0.009) {
      return `Sign up, refund ${money(preview.refundDue)} & ${start}`;
    }
    return `Sign up & ${start}`;
  }
  if (preview.manualSettlement) {
    if (preview.refundDue > 0.009 && preview.balanceDue > 0.009) {
      return `Sign up — refund ${money(preview.refundDue)} and collect ${money(preview.balanceDue)} by hand`;
    }
    if (preview.balanceDue > 0.009) {
      return `Sign up — collect ${money(preview.balanceDue)} by hand`;
    }
    return `Sign up — refund ${money(preview.refundDue)} by hand`;
  }
  if (preview.balanceDue > 0.009 && preview.refundDue <= 0.009) {
    return `Sign up & charge ${money(preview.balanceDue)}`;
  }
  if (preview.balanceDue > 0.009) {
    return `Sign up, refund ${money(preview.refundDue)} & charge ${money(preview.balanceDue)}`;
  }
  return `Sign up & refund ${money(preview.refundDue)}`;
}

function Total({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'accent';
  emphasis?: boolean;
}) {
  return (
    <div
      className={`pvms-total${emphasis ? ' pvms-total--lead' : ''}${tone ? ` pvms-total--${tone}` : ''}`}
    >
      <span className="pvms-total__label">{label}</span>
      <span className="pvms-total__value">{value}</span>
    </div>
  );
}

function LineTable({
  title,
  lines,
  empty,
  assignOptions,
  assignments,
  onAssign,
  disabled,
}: {
  title: string;
  lines: PostVisitSignupPreview['lines'];
  empty: string;
  assignOptions?: { key: string; name: string }[];
  assignments?: Record<string, string>;
  onAssign?: (lineId: string, value: string) => void;
  disabled?: boolean;
}) {
  const showAssign = Boolean(assignOptions && onAssign);
  return (
    <div className="pvms-lines">
      <h4 className="pvms-lines__title">{title}</h4>
      {showAssign ? (
        <p className="pvms-muted">
          If the billed item is the same visit as a covered benefit (annual wellness
          counted as senior wellness), assign it. That benefit is decremented and the
          line is re-priced.
        </p>
      ) : null}
      {lines.length === 0 ? (
        <p className="pvms-muted">{empty}</p>
      ) : (
        <table className="pvms-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="pvms-num">Was</th>
              <th className="pvms-num">Now</th>
              <th>Why</th>
              {showAssign ? <th>Assign to</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`${line.visitInvoiceId ?? ''}:${line.visitInvoiceLineId}`}>
                <td>
                  {line.description}
                  {line.qty > 1 && <span className="pvms-qty"> ×{line.qty}</span>}
                </td>
                <td className="pvms-num">{money(line.currentAmount)}</td>
                <td className="pvms-num">{money(line.newAmount)}</td>
                <td className="pvms-why">{line.coverageReason}</td>
                {showAssign ? (
                  <td>
                    <select
                      className="pvms-assign"
                      aria-label={`Assign ${line.description} to a plan benefit`}
                      value={assignments?.[line.visitInvoiceLineId] ?? ''}
                      disabled={disabled || assignOptions!.length === 0}
                      onChange={(e) => onAssign!(line.visitInvoiceLineId, e.target.value)}
                    >
                      <option value="">
                        {assignOptions!.length === 0
                          ? 'No benefits on this plan'
                          : 'Leave not covered'}
                      </option>
                      {assignOptions!.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SignupReceipt({ result }: { result: PostVisitSignupResult }) {
  const owe = (result.chargeAmount ?? 0) > 0.009;
  const moneyLine = owe
    ? result.chargeStatus === 'issued'
      ? `Charged ${money(result.chargeAmount ?? 0)}${result.chargeReference ? ` (${result.chargeReference})` : ''}.`
      : result.chargeStatus === 'skipped'
        ? `Charge of ${money(result.chargeAmount ?? 0)} was not taken — collect this by hand.`
        : result.chargeStatus === 'failed'
          ? `Charge of ${money(result.chargeAmount ?? 0)} FAILED. Collect this by hand.`
          : `Still owed ${money(result.chargeAmount ?? 0)}.`
    : result.refundStatus === 'issued'
      ? `Refunded ${money(result.refundAmount)}${result.refundReference ? ` (${result.refundReference})` : ''}.`
      : result.refundStatus === 'not_needed'
        ? 'No refund was due.'
        : result.refundStatus === 'skipped'
          ? `Refund of ${money(result.refundAmount)} was not issued — refund this by hand.`
          : `Refund of ${money(result.refundAmount)} FAILED. Refund this by hand.`;
  const moneyFailed = owe
    ? result.chargeStatus === 'failed'
    : result.refundStatus === 'failed';

  return (
    <div className="pvms-receipt">
      <div className="pvms-alert pvms-alert--ok">
        <Check size={15} aria-hidden="true" />
        <span>
          {result.ownerAlreadyPaid ? (
            <>
              Owner already paid for <strong>{result.planName}</strong>. Visit refund only.
            </>
          ) : (
            <>
              Enrolled in <strong>{result.planName}</strong>.
            </>
          )}
          {result.windowOverridden ? ' Window override was recorded.' : ''}
        </span>
      </div>
      {result.subscriptionStatus === 'issued' ? (
        <div className="pvms-alert pvms-alert--ok">
          <CircleDollarSign size={15} aria-hidden="true" />
          <span>
            Started the subscription and charged {money(result.subscriptionAmount ?? 0)} today
            {result.subscriptionId ? ` (${result.subscriptionId})` : ''}.
          </span>
        </div>
      ) : result.subscriptionStatus === 'failed' ? (
        <div className="pvms-alert pvms-alert--error">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            Stripe subscription did not start
            {result.subscriptionError ? `: ${result.subscriptionError}` : ''}.
          </span>
        </div>
      ) : null}

      <div
        className={`pvms-alert ${moneyFailed ? 'pvms-alert--error' : 'pvms-alert--ok'}`}
      >
        <CircleDollarSign size={15} aria-hidden="true" />
        <span>{moneyLine}</span>
      </div>
      {(result.chargeError || result.refundError) && (
        <p className="pvms-muted">{result.chargeError || result.refundError}</p>
      )}

      <div className={`pvms-alert ${result.emailSent ? 'pvms-alert--ok' : 'pvms-alert--warn'}`}>
        <Mail size={15} aria-hidden="true" />
        <span>
          {result.emailSent
            ? 'The client has been emailed a breakdown.'
            : 'The client email did not send — let them know manually.'}
        </span>
      </div>

      <div className="pvms-totals">
        <Total label="New total" value={money(result.invoice.total)} />
        <Total label="Paid" value={money(result.invoice.amountPaid)} />
        <Total label="Balance" value={money(result.invoice.balanceDue)} emphasis />
      </div>

      {result.benefitsCredited.length > 0 && (
        <p className="pvms-muted">
          {result.benefitsCredited.length} service
          {result.benefitsCredited.length === 1 ? '' : 's'} from these invoices
          {result.benefitsCredited.length === 1 ? ' was' : ' were'} credited against the new plan,
          so they cannot be claimed twice.
        </p>
      )}

      {result.warnings.length > 0 && (
        <div className="pvms-alert pvms-alert--warn">
          <AlertTriangle size={15} aria-hidden="true" />
          <ul className="pvms-warnlist">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
