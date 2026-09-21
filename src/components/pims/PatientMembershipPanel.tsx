import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  HeartHandshake,
  History,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  addMembershipItem,
  cancelMembership,
  previewMembershipCancel,
  changeMembershipPlan,
  createPatientMembership,
  getPatientMembership,
  getPatientMembershipAudit,
  listBundles,
  listPatientMemberships,
  removeMembershipItem,
  updateMembershipItem,
  type Bundle,
  type ItemCoverage,
  type MembershipAuditEntry,
  type MembershipBenefit,
  type MembershipBillingInterval,
  type MembershipGroup,
  type MembershipCancelPreview,
  type PatientMembership,
} from '../../api/memberships';
import {
  addCounterInvoiceLine,
  ensureCounterInvoice,
  listClientVisitInvoices,
  type VisitInvoice,
} from '../../api/visitWorkflow';
import { apiErrorMessage, getToken } from '../../api/http';
import {
  getPracticeSettings,
  membershipAssignFeeToProvider,
  membershipPostVisitSignupWindowHours,
} from '../../api/practiceSettings';
import { resolvePracticeIdFromToken } from '../../utils/practiceIdFromToken';
import {
  buildClientFinancialHref,
} from '../../utils/clientFinancial';
import { appConfirm, appPrompt } from '../../utils/appDialog';
import CatalogItemPicker, { type PickedCatalogItem } from '../catalog/CatalogItemPicker';
import PostVisitMembershipSignup from '../soap/PostVisitMembershipSignup';
import { Card, FactGrid, PimsBadge } from './detail/PimsDetailKit';
import './PatientMembershipPanel.css';

/* ------------------------------------------------------------------ helpers */

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function dateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function coverageLabel(b: {
  coverage: ItemCoverage;
  price: number | null;
  percentOff: number | null;
}): string {
  if (b.coverage === 'copay') {
    return b.price != null ? `${money(b.price)} copay` : 'Copay';
  }
  if (b.coverage === 'percent_off') {
    return b.percentOff != null ? `${b.percentOff}% off` : 'Discounted';
  }
  return 'Included';
}

function planPriceLabel(plan: Bundle): string {
  const parts: string[] = [];
  if (plan.priceMonthly != null) parts.push(`${money(plan.priceMonthly)}/mo`);
  if (plan.priceAnnual != null) parts.push(`${money(plan.priceAnnual)}/yr`);
  if (!parts.length && plan.price != null) parts.push(money(plan.price));
  return parts.join(' · ') || 'No price set';
}

/**
 * Plans are usually named “… Annual” / “… Monthly” with a single price field.
 * Prefer that over a separate billing dropdown so staff don’t enroll an annual
 * plan as monthly by accident.
 */
function billingIntervalForPlan(plan: Bundle): MembershipBillingInterval {
  if (/\bmonthly\b/i.test(plan.name ?? '')) return 'monthly';
  if (/\b(annual|yearly)\b/i.test(plan.name ?? '')) return 'annual';
  if (plan.priceAnnual != null && plan.priceMonthly == null) return 'annual';
  if (plan.priceMonthly != null && plan.priceAnnual == null) return 'monthly';
  return 'monthly';
}

function listedPriceForPlan(
  plan: Bundle,
  interval: MembershipBillingInterval,
): number | null {
  if (interval === 'annual') return plan.priceAnnual ?? plan.price ?? null;
  return plan.priceMonthly ?? plan.price ?? null;
}

/** Keep the interval the pet is already billed on unless the new plan has no price for it. */
function intervalFor(plan: Bundle, current: string | null): MembershipBillingInterval {
  if (current === 'annual') {
    return plan.priceAnnual == null && plan.priceMonthly != null ? 'monthly' : 'annual';
  }
  if (current === 'monthly') {
    return plan.priceMonthly == null && plan.priceAnnual != null ? 'annual' : 'monthly';
  }
  return plan.priceMonthly != null ? 'monthly' : 'annual';
}

const COVERAGE_OPTIONS: { value: ItemCoverage; label: string }[] = [
  { value: 'included', label: 'Included — no charge' },
  { value: 'copay', label: 'Copay — fixed price' },
  { value: 'percent_off', label: 'Percent off catalog price' },
];

/* --------------------------------------------------------------- benefit row */

type BenefitDraft = {
  quantity: string;
  coverage: ItemCoverage;
  price: string;
  percentOff: string;
  note: string;
};

function draftFromBenefit(b: MembershipBenefit): BenefitDraft {
  return {
    quantity:
      b.includedQuantity != null && Number(b.includedQuantity) < 0
        ? 'unlimited'
        : String(b.includedQuantity ?? 1),
    coverage: b.coverage,
    price: b.price != null ? String(b.price) : '',
    percentOff: b.percentOff != null ? String(b.percentOff) : '',
    note: b.note ?? '',
  };
}

function isUnlimitedAllowance(value: number | string | null | undefined): boolean {
  if (typeof value === 'string') return value.trim().toLowerCase() === 'unlimited';
  if (value == null) return false;
  return Number.isFinite(Number(value)) && Number(value) < 0;
}

function parseAllowanceInput(raw: string): number | null {
  if (raw.trim().toLowerCase() === 'unlimited') return -1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.round(n);
}

function AllowanceMeter({
  used,
  total,
  label,
}: {
  used: number;
  total: number;
  label: string;
}) {
  if (isUnlimitedAllowance(total)) {
    return (
      <div className="pmp-meter">
        <span className="pmp-meter__label">
          Unlimited{used > 0 ? ` · ${used} used` : ''}
        </span>
      </div>
    );
  }
  const safeTotal = total > 0 ? total : 0;
  const pct = safeTotal > 0 ? Math.min(100, Math.round((used / safeTotal) * 100)) : 0;
  const spent = safeTotal > 0 && used >= safeTotal;
  return (
    <div className="pmp-meter">
      <div
        className={`pmp-meter__track${spent ? ' pmp-meter__track--spent' : ''}`}
        role="img"
        aria-label={label}
      >
        <span className="pmp-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className={`pmp-meter__label${spent ? ' pmp-meter__label--spent' : ''}`}>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- panel */

type Props = {
  patientId: number;
  /**
   * Defaults to the signed-in practice. Left to default so catalog search and
   * membership writes resolve the practice the same way — searching one
   * practice's catalog while writing to another's plan is rejected by the API.
   */
  practiceId?: number;
  patientName?: string | null;
  /** Owner client — used to open a counter invoice after enrollment. */
  clientId?: number | null;
  patientSpecies?: string | null;
  patientAgeYears?: number | null;
};

type PanelMode = 'none' | 'add' | 'change' | 'enrol' | 'cancel';

export default function PatientMembershipPanel({
  patientId,
  practiceId: practiceIdProp,
  patientName,
  clientId,
  patientSpecies,
  patientAgeYears,
}: Props) {
  const navigate = useNavigate();
  const practiceId = practiceIdProp ?? resolvePracticeIdFromToken(getToken());
  const [open, setOpen] = useState(true);
  const [inactiveDetailsOpen, setInactiveDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [membership, setMembership] = useState<PatientMembership | null>(null);
  const [audit, setAudit] = useState<MembershipAuditEntry[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [plans, setPlans] = useState<Bundle[]>([]);
  const [mode, setMode] = useState<PanelMode>('none');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [postVisitOpen, setPostVisitOpen] = useState(false);
  const [postVisitWindowHours, setPostVisitWindowHours] = useState(24);
  const [postVisitHoursLeft, setPostVisitHoursLeft] = useState<number | null>(null);
  const [postVisitInvoiceIds, setPostVisitInvoiceIds] = useState<string[]>([]);
  const [postVisitSeedInvoices, setPostVisitSeedInvoices] = useState<VisitInvoice[]>([]);

  // Add-a-benefit form.
  const [addItem, setAddItem] = useState<PickedCatalogItem | null>(null);
  const [addQty, setAddQty] = useState('1');
  const [addCoverage, setAddCoverage] = useState<ItemCoverage>('included');
  const [addPrice, setAddPrice] = useState('');
  const [addPercent, setAddPercent] = useState('');
  const [addGroupId, setAddGroupId] = useState('');
  const [addNote, setAddNote] = useState('');

  // Inline benefit edit.
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<BenefitDraft | null>(null);
  const [cancelPreview, setCancelPreview] = useState<MembershipCancelPreview | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const cancelSectionRef = useRef<HTMLDivElement | null>(null);

  // Plan change / enrolment.
  const [changeReason, setChangeReason] = useState('');
  const [carryOverUsage, setCarryOverUsage] = useState(true);
  const [keepCustomItems, setKeepCustomItems] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listPatientMemberships({ patientId });
      const current = rows.find((r) => r.status === 'active') ?? rows[0] ?? null;
      if (!current) {
        setMembership(null);
        setAudit([]);
        return;
      }
      const [full, log] = await Promise.all([
        getPatientMembership(current.id).catch(() => current),
        getPatientMembershipAudit(current.id).catch(() => [] as MembershipAuditEntry[]),
      ]);
      setMembership(full);
      setAudit(log);
      if (full.status !== 'active') {
        setInactiveDetailsOpen(false);
      }
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Post-visit signup window: hours left since newest paid invoice for this pet.
  useEffect(() => {
    if (!clientId) {
      setPostVisitHoursLeft(null);
      setPostVisitInvoiceIds([]);
      setPostVisitSeedInvoices([]);
      return;
    }
    const ownerPaidStripe =
      membership?.status === 'active' &&
      Boolean(membership.stripeSubscriptionId?.startsWith('sub_'));
    if (membership?.status === 'active' && !ownerPaidStripe) {
      setPostVisitHoursLeft(null);
      setPostVisitInvoiceIds([]);
      setPostVisitSeedInvoices([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [settings, invoices] = await Promise.all([
          getPracticeSettings(practiceId),
          listClientVisitInvoices(clientId, { lite: true }),
        ]);
        if (cancelled) return;
        const windowHours = membershipPostVisitSignupWindowHours(settings);
        setPostVisitWindowHours(windowHours);
        const paid = invoices.filter((inv) => {
          if ((Number(inv.amountPaid) || 0) <= 0 || inv.status === 'void') return false;
          if (inv.patientId === patientId) return true;
          return (inv.lines ?? []).some(
            (l) => l.patientId == null || l.patientId === patientId,
          );
        });
        setPostVisitSeedInvoices(invoices);
        setPostVisitInvoiceIds(paid.slice(0, 5).map((i) => i.id));
        let newest: number | null = null;
        for (const inv of paid) {
          const stamp = inv.paidAt || inv.finalizedAt || inv.created;
          if (!stamp) continue;
          const ms = Date.parse(stamp);
          if (!Number.isFinite(ms)) continue;
          if (newest == null || ms > newest) newest = ms;
        }
        if (newest == null) {
          setPostVisitHoursLeft(null);
          return;
        }
        const ageHours = (Date.now() - newest) / 3_600_000;
        setPostVisitHoursLeft(windowHours - ageHours);
      } catch {
        if (!cancelled) {
          setPostVisitHoursLeft(null);
          setPostVisitInvoiceIds([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, membership?.status, membership?.stripeSubscriptionId, patientId, practiceId]);

  // Prefetched so "Change plan" opens straight onto the list of plans.
  useEffect(() => {
    let cancelled = false;
    listBundles({ kind: 'membership' })
      .then((rows) => {
        if (!cancelled) setPlans(rows.filter((p) => p.isActive && !p.isArchived));
      })
      .catch(() => {
        if (!cancelled) setPlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAudit = useCallback(async (membershipId: number) => {
    try {
      setAudit(await getPatientMembershipAudit(membershipId));
    } catch {
      /* the audit is supporting detail; a failure here shouldn't mask the write */
    }
  }, []);

  /**
   * Benefits only carry the employee id that added them, so names come from the audit log,
   * which records both. Falls back to the id so the row still reads as an attribution.
   */
  const employeeNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of audit) {
      if (entry.employeeId != null && entry.employeeName) {
        map.set(entry.employeeId, entry.employeeName);
      }
    }
    return map;
  }, [audit]);

  const employeeLabel = useCallback(
    (id: number | null): string => {
      if (id == null) return 'Unknown staff';
      return employeeNames.get(id) ?? `Employee #${id}`;
    },
    [employeeNames]
  );

  const otherPlans = useMemo(
    () => plans.filter((p) => p.id !== membership?.packageId),
    [plans, membership]
  );

  const customCount = useMemo(() => {
    if (!membership) return 0;
    return membership.groups.reduce(
      (sum, g) => sum + g.benefits.filter((b) => b.isCustom && !b.isRemoved).length,
      0
    );
  }, [membership]);

  function resetAddForm() {
    setAddItem(null);
    setAddQty('1');
    setAddCoverage('included');
    setAddPrice('');
    setAddPercent('');
    setAddGroupId('');
    setAddNote('');
  }

  function closePanels() {
    setMode('none');
    setFormError(null);
    setEditId(null);
    setEditDraft(null);
    setCancelPreview(null);
    setCancelReason('');
    resetAddForm();
  }

  /* --------------------------------------------------------------- mutations */

  async function submitAdd() {
    if (!membership) return;
    if (!addItem) {
      setFormError('Pick a catalog item first.');
      return;
    }
    const qty = parseAllowanceInput(addQty);
    if (qty == null) {
      setFormError('Quantity must be a number above zero, or unlimited.');
      return;
    }
    if (addCoverage === 'copay' && numOrNull(addPrice) == null) {
      setFormError('Enter the copay the client pays.');
      return;
    }
    if (addCoverage === 'percent_off' && numOrNull(addPercent) == null) {
      setFormError('Enter the percent off.');
      return;
    }

    const existing = membership.groups.flatMap((g) =>
      g.benefits
        .filter(
          (b) =>
            !b.isRemoved &&
            b.itemType === addItem.itemType &&
            b.catalogItemId === addItem.catalogItemId,
        )
        .map(
          (b) =>
            `• ${b.name} — ${coverageLabel(b)}, ${
              isUnlimitedAllowance(b.includedQuantity)
                ? 'unlimited'
                : `×${b.includedQuantity}`
            }`,
        ),
    );
    if (existing.length > 0) {
      const ok = await appConfirm({
        title: 'Already on this membership',
        message:
          `${addItem.name} is already on this pet’s membership:\n\n${existing.join('\n')}\n\n` +
          'Add another benefit line anyway? Use this when the first visits are fully covered and later ones use a different discount.',
        confirmLabel: 'Add another line',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const next = await addMembershipItem(membership.id, {
        itemType: addItem.itemType,
        catalogItemId: addItem.catalogItemId,
        includedQuantity: qty,
        coverage: addCoverage,
        price: addCoverage === 'copay' ? numOrNull(addPrice) : null,
        percentOff: addCoverage === 'percent_off' ? numOrNull(addPercent) : null,
        groupId: addGroupId ? Number(addGroupId) : null,
        note: addNote.trim() || null,
      });
      setMembership(next);
      await refreshAudit(next.id);
      closePanels();
    } catch (e) {
      setFormError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(benefitId: number) {
    if (!membership || !editDraft) return;
    const qty = parseAllowanceInput(editDraft.quantity);
    if (qty == null) {
      setFormError('Quantity must be a number above zero, or unlimited.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const next = await updateMembershipItem(membership.id, benefitId, {
        includedQuantity: qty,
        coverage: editDraft.coverage,
        price: editDraft.coverage === 'copay' ? numOrNull(editDraft.price) : null,
        percentOff: editDraft.coverage === 'percent_off' ? numOrNull(editDraft.percentOff) : null,
        note: editDraft.note.trim() || null,
      });
      setMembership(next);
      await refreshAudit(next.id);
      setEditId(null);
      setEditDraft(null);
    } catch (e) {
      setFormError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeBenefit(benefit: MembershipBenefit) {
    if (!membership) return;
    const reason = await appPrompt({
      title: `Remove ${benefit.name}`,
      message:
        'Why is this benefit coming off this pet’s membership? The reason is stored on the audit trail.',
      placeholder: 'e.g. added to the wrong pet',
      confirmLabel: 'Remove benefit',
    });
    if (reason == null) return;
    setBusy(true);
    setError(null);
    try {
      await removeMembershipItem(membership.id, benefit.id, reason.trim() || undefined);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function switchToPlan(plan: Bundle) {
    if (!membership) return;
    const interval = intervalFor(plan, membership.billingInterval);
    const bullets = [
      carryOverUsage
        ? '• Usage carries over: visits already given on the current plan stay counted, so the new plan cannot hand the same service back a second time.'
        : '• Usage resets: every allowance on the new plan starts full, even for services already given this term.',
      keepCustomItems
        ? `• Staff-added benefits are kept: the ${customCount} benefit${customCount === 1 ? '' : 's'} added to this pet specifically stay on the membership.`
        : '• Staff-added benefits are dropped: anything added to this pet specifically will be removed.',
      `• Billing moves to ${plan.name} at ${interval === 'annual' ? 'the annual rate' : 'the monthly rate'}. No Stripe dashboard work is needed.`,
    ];
    const ok = await appConfirm({
      title: `Move to ${plan.name}?`,
      message: `${patientName ? `${patientName}’s` : 'This'} membership changes from ${membership.planName} to ${plan.name}.\n\n${bullets.join('\n')}`,
      confirmLabel: `Move to ${plan.name}`,
    });
    if (!ok) return;
    setBusy(true);
    setFormError(null);
    try {
      const next = await changeMembershipPlan(membership.id, {
        packageId: plan.id,
        billingInterval: interval,
        carryOverUsage,
        keepCustomItems,
        reason: changeReason.trim() || `Changed to ${plan.name} from the patient chart`,
      });
      setMembership(next);
      await refreshAudit(next.id);
      setChangeReason('');
      closePanels();
    } catch (e) {
      setFormError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function enrol(plan: Bundle) {
    const interval = billingIntervalForPlan(plan);
    const price = listedPriceForPlan(plan, interval);
    const ok = await appConfirm({
      title: `Enroll in ${plan.name}?`,
      message: `${patientName ?? 'This pet'} will be enrolled in ${plan.name}, billed ${
        interval === 'annual' ? 'annually' : 'monthly'
      }. Benefits are available right away — you’ll be taken to an invoice to collect payment.`,
      confirmLabel: 'Enroll',
    });
    if (!ok) return;
    setBusy(true);
    setFormError(null);
    try {
      const created = await createPatientMembership({
        patientId,
        packageId: plan.id,
        billingInterval: interval,
        price,
      });
      setMembership(created);
      await refreshAudit(created.id);
      closePanels();

      if (clientId != null && Number(clientId) > 0) {
        try {
          const settings = await getPracticeSettings(practiceId).catch(() => ({}));
          const assignToProvider = membershipAssignFeeToProvider(settings);
          const invoice = await ensureCounterInvoice({
            clientId: Number(clientId),
            patientId,
          });
          const withLine = await addCounterInvoiceLine(invoice.id, {
            description: plan.name,
            qty: 1,
            unitPrice: price ?? created.price ?? 0,
            listUnitPrice: price ?? created.price ?? null,
            patientId,
            sourceBundleId: plan.id,
            sourceBundleName: plan.name,
            miscCharge: true,
            excludeFromProduction: !assignToProvider,
          });
          navigate(
            buildClientFinancialHref({
              clientId,
              invoice: withLine.id,
              patientId,
            }),
          );
          return;
        } catch (invoiceErr) {
          setError(
            `Enrolled, but could not open the invoice: ${apiErrorMessage(invoiceErr)}`,
          );
        }
      }
    } catch (e) {
      setFormError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (mode !== 'cancel') return;
    cancelSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [mode, cancelLoading]);

  async function openCancel() {
    if (!membership) return;
    setFormError(null);
    setError(null);
    setMode(mode === 'cancel' ? 'none' : 'cancel');
    if (mode === 'cancel') {
      setCancelPreview(null);
      return;
    }
    setCancelLoading(true);
    try {
      const preview = await previewMembershipCancel(membership.id);
      setCancelPreview(preview);
    } catch (e) {
      setFormError(apiErrorMessage(e));
      setCancelPreview(null);
    } finally {
      setCancelLoading(false);
    }
  }

  async function cancel() {
    if (!membership) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setFormError('Tell us why the owner is canceling.');
      return;
    }
    setBusy(true);
    setError(null);
    setFormError(null);
    try {
      const result = await cancelMembership(membership.id, reason, {
        chargeAmount: cancelPreview?.chargeAmount,
        refundAmount: cancelPreview?.refundAmount,
      });
      setMembership(result.membership);
      setInactiveDetailsOpen(false);
      closePanels();
      await refreshAudit(result.membership.id);
      if (result.moneyError) {
        setError(result.moneyError);
      }
      if (clientId != null && result.invoiceId) {
        navigate(
          buildClientFinancialHref({
            clientId,
            invoice: result.invoiceId,
            patientId,
          }),
        );
      }
    } catch (e) {
      setFormError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------ render */

  const groupOptions = membership?.groups ?? [];
  /** A cancelled membership still shows its history, but the pet can be put on a plan again. */
  const canEnrol = !loading && (!membership || membership.status !== 'active');
  const ownerPaidRecently = (() => {
    if (membership?.status !== 'active') return false;
    if (!membership.stripeSubscriptionId?.startsWith('sub_')) return false;
    if (!membership.startDate) return false;
    const ageHours = (Date.now() - Date.parse(membership.startDate)) / 3_600_000;
    return ageHours >= -1 && ageHours <= postVisitWindowHours + 1;
  })();

  function renderBenefitRow(benefit: MembershipBenefit, group: MembershipGroup) {
    const editing = editId === benefit.id && editDraft != null;
    const sharedAllowance = group.selectionMode === 'choice';

    if (editing && editDraft) {
      return (
        <li key={benefit.id} className="pmp-benefit pmp-benefit--editing">
          <div className="pmp-form pmp-form--inline">
            <p className="pmp-form__title">Edit {benefit.name}</p>
            <div className="pmp-form__grid">
              <label className="pmp-field">
                <span className="pmp-field__label">Allowance</span>
                <select
                  className="pmp-input"
                  value={isUnlimitedAllowance(editDraft.quantity) ? 'unlimited' : 'limited'}
                  onChange={(e) =>
                    setEditDraft({
                      ...editDraft,
                      quantity:
                        e.target.value === 'unlimited'
                          ? 'unlimited'
                          : editDraft.quantity === 'unlimited'
                            ? '1'
                            : editDraft.quantity || '1',
                    })
                  }
                >
                  <option value="limited">Limited</option>
                  <option value="unlimited">Unlimited</option>
                </select>
                {isUnlimitedAllowance(editDraft.quantity) ? null : (
                  <input
                    className="pmp-input"
                    inputMode="decimal"
                    value={editDraft.quantity}
                    onChange={(e) => setEditDraft({ ...editDraft, quantity: e.target.value })}
                  />
                )}
              </label>
              <label className="pmp-field">
                <span className="pmp-field__label">Coverage</span>
                <select
                  className="pmp-input"
                  value={editDraft.coverage}
                  onChange={(e) =>
                    setEditDraft({
                      ...editDraft,
                      coverage: e.target.value as ItemCoverage,
                    })
                  }
                >
                  {COVERAGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {editDraft.coverage === 'copay' ? (
                <label className="pmp-field">
                  <span className="pmp-field__label">Copay</span>
                  <input
                    className="pmp-input"
                    inputMode="decimal"
                    value={editDraft.price}
                    onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })}
                  />
                </label>
              ) : null}
              {editDraft.coverage === 'percent_off' ? (
                <label className="pmp-field">
                  <span className="pmp-field__label">Percent off</span>
                  <input
                    className="pmp-input"
                    inputMode="decimal"
                    value={editDraft.percentOff}
                    onChange={(e) => setEditDraft({ ...editDraft, percentOff: e.target.value })}
                  />
                </label>
              ) : null}
              <label className="pmp-field pmp-field--full">
                <span className="pmp-field__label">Note</span>
                <input
                  className="pmp-input"
                  value={editDraft.note}
                  placeholder="Why this pet has this benefit"
                  onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })}
                />
              </label>
            </div>
            {formError ? (
              <p className="pmp-form__error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="pmp-form__actions">
              <button
                type="button"
                className="pims-detail__btn-secondary"
                disabled={busy}
                onClick={() => {
                  setEditId(null);
                  setEditDraft(null);
                  setFormError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pims-detail__btn-primary"
                disabled={busy}
                onClick={() => void submitEdit(benefit.id)}
              >
                {busy ? 'Saving…' : 'Save benefit'}
              </button>
            </div>
          </div>
        </li>
      );
    }

    return (
      <li
        key={benefit.id}
        className={`pmp-benefit${benefit.isRemoved ? ' pmp-benefit--removed' : ''}${
          benefit.isCustom ? ' pmp-benefit--custom' : ''
        }`}
      >
        {sharedAllowance ? <span className="pmp-benefit__alt-dot" aria-hidden /> : null}
        <div className="pmp-benefit__main">
          <div className="pmp-benefit__head">
            <span className="pmp-benefit__name">{benefit.name}</span>
            {benefit.code ? <span className="pmp-benefit__code">{benefit.code}</span> : null}
            <span className={`pmp-coverage pmp-coverage--${benefit.coverage.replace('_', '-')}`}>
              {coverageLabel(benefit)}
            </span>
            {benefit.isCustom ? (
              <PimsBadge
                tone="info"
                title={`Added to this pet's membership by ${employeeLabel(benefit.addedByEmployeeId)}`}
              >
                Added for this pet
              </PimsBadge>
            ) : null}
            {benefit.isRemoved ? <PimsBadge tone="muted">Removed</PimsBadge> : null}
          </div>
          {sharedAllowance ? (
            <p className="pmp-benefit__sub">
              Draws on the shared allowance above
              {benefit.includedQuantity > 1 ? ` · counts as ${benefit.includedQuantity}` : ''}
            </p>
          ) : (
            <AllowanceMeter
              used={benefit.usedQuantity}
              total={benefit.includedQuantity}
              label={
                isUnlimitedAllowance(benefit.includedQuantity)
                  ? 'Unlimited'
                  : `${benefit.remainingQuantity} of ${benefit.includedQuantity} left`
              }
            />
          )}
          {benefit.isCustom ? (
            <p className="pmp-benefit__audit">
              Added by <strong>{employeeLabel(benefit.addedByEmployeeId)}</strong> on{' '}
              {shortDate(benefit.addedAt)}
              {benefit.note ? ` · “${benefit.note}”` : ''}
            </p>
          ) : benefit.note ? (
            <p className="pmp-benefit__audit">{benefit.note}</p>
          ) : null}
          {benefit.isRemoved ? (
            <p className="pmp-benefit__audit">
              Removed by <strong>{employeeLabel(benefit.removedByEmployeeId)}</strong> on{' '}
              {shortDate(benefit.removedAt)}
            </p>
          ) : null}
        </div>
        {!benefit.isRemoved ? (
          <div className="pmp-benefit__actions">
            <button
              type="button"
              className="pims-detail__btn-quiet"
              disabled={busy}
              onClick={() => {
                setFormError(null);
                setEditId(benefit.id);
                setEditDraft(draftFromBenefit(benefit));
              }}
            >
              <Pencil size={13} aria-hidden />
              Edit
            </button>
            <button
              type="button"
              className="pmp-icon-btn"
              aria-label={`Remove ${benefit.name}`}
              title="Remove from this membership"
              disabled={busy}
              onClick={() => void removeBenefit(benefit)}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        ) : null}
      </li>
    );
  }

  function renderGroup(group: MembershipGroup) {
    const live = group.benefits.filter((b) => !b.isRemoved);
    const removed = group.benefits.filter((b) => b.isRemoved);
    const isChoice = group.selectionMode === 'choice';

    return (
      <div
        key={group.id}
        className={`pmp-group${isChoice ? ' pmp-group--choice' : ' pmp-group--all'}`}
      >
        <div className="pmp-group__head">
          <div className="pmp-group__title-wrap">
            <h4 className="pmp-group__title">{group.name || 'Benefits'}</h4>
            {isChoice ? (
              <span className="pmp-group__mode">
                {isUnlimitedAllowance(group.allowedQuantity)
                  ? `Unlimited picks of these ${live.length}`
                  : `Pick ${group.allowedQuantity} of these ${live.length}`}
              </span>
            ) : (
              <span className="pmp-group__mode pmp-group__mode--all">
                All {live.length} included
              </span>
            )}
          </div>
          {isChoice ? (
            <AllowanceMeter
              used={group.usedQuantity}
              total={group.allowedQuantity}
              label={
                isUnlimitedAllowance(group.allowedQuantity)
                  ? 'Unlimited'
                  : `${group.remainingQuantity} of ${group.allowedQuantity} left`
              }
            />
          ) : null}
        </div>

        {isChoice ? (
          <p className="pmp-group__explain">
            One shared allowance. Taking any option below draws the whole group down.
          </p>
        ) : null}

        {live.length === 0 ? (
          <p className="pmp-muted">No benefits in this group.</p>
        ) : (
          <ul className="pmp-benefits">
            {live.flatMap((benefit, i) =>
              isChoice && i > 0
                ? [
                    <li className="pmp-or" key={`or-${benefit.id}`} aria-hidden>
                      <span>OR</span>
                    </li>,
                    renderBenefitRow(benefit, group),
                  ]
                : [renderBenefitRow(benefit, group)]
            )}
          </ul>
        )}

        {removed.length > 0 ? (
          <ul className="pmp-benefits pmp-benefits--removed">
            {removed.map((benefit) => renderBenefitRow(benefit, group))}
          </ul>
        ) : null}
      </div>
    );
  }

  const headerBadge = membership ? (
    <>
      <span className="pmp-head-plan">{membership.planName}</span>
      {membership.status !== 'active' ? (
        <span className="pmp-head-inactive" aria-label="Membership inactive">
          Inactive
        </span>
      ) : null}
    </>
  ) : null;

  return (
    <section className="pims-emr-story__card pmp" aria-labelledby="pims-emr-membership">
      <div className="pims-emr-story__collapse-row">
        <button
          type="button"
          id="pims-emr-membership"
          className="pims-emr-story__collapse"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <HeartHandshake size={15} aria-hidden />
          Membership
          {headerBadge}
        </button>
      </div>

      {open ? (
        <div className="pims-emr-story__block">
          {loading ? <p className="pmp-muted">Loading membership…</p> : null}
          {error ? (
            <p className="pims-detail__banner-error" role="alert">
              {error}
            </p>
          ) : null}

          {canEnrol ? (
            <div className={`pmp-empty${membership ? ' pmp-empty--inactive' : ''}`}>
              {membership ? (
                <p className="pmp-inactive-banner" role="status">
                  <strong>Inactive</strong>
                  {` — ${membership.planName} is no longer active.`}
                </p>
              ) : (
                <p className="pmp-muted">
                  {`${patientName ?? 'This pet'} is not on a membership plan.`}
                </p>
              )}
              <div className="pmp-empty__actions">
                <button
                  type="button"
                  className="pims-detail__btn-primary"
                  disabled={busy}
                  onClick={() => {
                    setFormError(null);
                    setMode(mode === 'enrol' ? 'none' : 'enrol');
                  }}
                >
                  <UserPlus size={14} aria-hidden />
                  Enroll in a plan
                </button>
                {clientId ? (
                  <button
                    type="button"
                    className="pims-detail__btn-ghost"
                    disabled={busy}
                    title={
                      postVisitHoursLeft == null
                        ? 'Re-price a recent paid visit under a new membership'
                        : postVisitHoursLeft <= 0
                          ? `Outside the ${postVisitWindowHours}h post-visit window — override required`
                          : `${Math.max(0, Math.ceil(postVisitHoursLeft))}h left in the post-visit window`
                    }
                    onClick={() => setPostVisitOpen(true)}
                  >
                    <ShieldCheck size={14} aria-hidden />
                    Post-visit signup
                    {postVisitHoursLeft == null
                      ? null
                      : postVisitHoursLeft <= 0
                        ? ' · EXPIRED'
                        : ` · ${Math.max(0, Math.ceil(postVisitHoursLeft))}h left`}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {canEnrol && mode === 'enrol' ? (
            <Card title="Available membership plans">
              {formError ? (
                <p className="pmp-form__error" role="alert">
                  {formError}
                </p>
              ) : null}
              {plans.length === 0 ? (
                <p className="pmp-muted">
                  No active membership plans yet. Plans are built in Settings → Memberships.
                </p>
              ) : (
                <ul className="pmp-plans">
                  {plans.map((plan) => (
                    <li key={plan.id} className="pmp-plan">
                      <div className="pmp-plan__main">
                        <span className="pmp-plan__name">{plan.name}</span>
                        <span className="pmp-plan__meta">
                          {[plan.tier, plan.species, planPriceLabel(plan)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {plan.marketingSummary ? (
                          <span className="pmp-plan__blurb">{plan.marketingSummary}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="pims-detail__btn-primary"
                        disabled={busy}
                        onClick={() => void enrol(plan)}
                      >
                        Enroll
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {membership ? (
            <>
              {membership.status !== 'active' ? (
                <button
                  type="button"
                  className="pmp-inactive-details-toggle"
                  aria-expanded={inactiveDetailsOpen}
                  onClick={() => setInactiveDetailsOpen((v) => !v)}
                >
                  {inactiveDetailsOpen ? (
                    <ChevronDown size={14} aria-hidden />
                  ) : (
                    <ChevronRight size={14} aria-hidden />
                  )}
                  {inactiveDetailsOpen ? 'Hide previous plan details' : 'Show previous plan details'}
                </button>
              ) : null}

              {membership.status === 'active' || inactiveDetailsOpen ? (
              <>
              <div
                className={`pmp-summary${
                  membership.status !== 'active' ? ' pmp-summary--inactive' : ''
                }`}
              >
                <div className="pmp-summary__head">
                  <div>
                    <h3 className="pmp-summary__plan">{membership.planName}</h3>
                    <div className="pmp-summary__badges">
                      {membership.planTier ? (
                        <PimsBadge tone="muted">{membership.planTier}</PimsBadge>
                      ) : null}
                      <PimsBadge tone={membership.status === 'active' ? 'ok' : 'danger'}>
                        {membership.status === 'active' ? 'Active' : 'Inactive'}
                      </PimsBadge>
                      {customCount > 0 ? (
                        <PimsBadge tone="info">{customCount} added for this pet</PimsBadge>
                      ) : null}
                    </div>
                  </div>
                  <div className="pmp-summary__actions">
                    {ownerPaidRecently && clientId ? (
                      <button
                        type="button"
                        className="pims-detail__btn-ghost"
                        disabled={busy}
                        title={
                          postVisitHoursLeft == null
                            ? 'Owner already paid in Stripe. Refund the covered visit only.'
                            : postVisitHoursLeft <= 0
                              ? `Outside the ${postVisitWindowHours}h post-visit window — override required`
                              : `Owner already paid. ${Math.max(0, Math.ceil(postVisitHoursLeft))}h left to refund the visit.`
                        }
                        onClick={() => setPostVisitOpen(true)}
                      >
                        <ShieldCheck size={15} aria-hidden />
                        Owner paid — refund visit
                        {postVisitHoursLeft == null
                          ? null
                          : postVisitHoursLeft <= 0
                            ? ' · EXPIRED'
                            : ` · ${Math.max(0, Math.ceil(postVisitHoursLeft))}h left`}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="pmp-btn-change"
                      disabled={busy || membership.status !== 'active'}
                      onClick={() => {
                        setFormError(null);
                        setMode(mode === 'change' ? 'none' : 'change');
                      }}
                    >
                      <ArrowLeftRight size={15} aria-hidden />
                      Change plan
                    </button>
                    <button
                      type="button"
                      className="pims-detail__btn-secondary"
                      disabled={busy || membership.status !== 'active'}
                      onClick={() => {
                        setFormError(null);
                        setMode(mode === 'add' ? 'none' : 'add');
                      }}
                    >
                      <Plus size={14} aria-hidden />
                      Add benefit
                    </button>
                    <button
                      type="button"
                      className="pims-detail__btn-danger"
                      disabled={busy || membership.status !== 'active'}
                      onClick={() => void openCancel()}
                    >
                      <X size={14} aria-hidden />
                      Cancel
                    </button>
                  </div>
                </div>
                <FactGrid
                  columns={3}
                  rows={[
                    { label: 'Started', value: shortDate(membership.startDate) },
                    { label: 'Expires', value: shortDate(membership.expirationDate) },
                    {
                      label: 'Billing',
                      value: membership.billingInterval
                        ? membership.billingInterval === 'annual'
                          ? 'Annual'
                          : 'Monthly'
                        : null,
                    },
                    { label: 'Price', value: money(membership.price) },
                    {
                      label: 'Out-of-plan discount',
                      value:
                        membership.outOfPlanDiscount != null
                          ? `${membership.outOfPlanDiscount}% off other services`
                          : null,
                    },
                    {
                      label: 'Online store discount',
                      value:
                        membership.onlineStoreDiscount != null &&
                        Number(membership.onlineStoreDiscount) > 0
                          ? `${membership.onlineStoreDiscount}% off store orders`
                          : null,
                    },
                  ]}
                />
              </div>

              {mode === 'change' ? (
                <Card
                  title="Change this pet’s plan"
                  icon={<ArrowLeftRight size={16} aria-hidden />}
                >
                  <p className="pmp-muted pmp-change__lede">
                    One click moves the membership over — billing included. Nobody has to open
                    Stripe.
                  </p>
                  <div className="pmp-change__opts">
                    <label className="pmp-check">
                      <input
                        type="checkbox"
                        checked={carryOverUsage}
                        onChange={(e) => setCarryOverUsage(e.target.checked)}
                      />
                      <span>
                        <strong>Carry usage over</strong> — services already given stay counted, so
                        the new plan can’t hand them back.
                      </span>
                    </label>
                    <label className="pmp-check">
                      <input
                        type="checkbox"
                        checked={keepCustomItems}
                        onChange={(e) => setKeepCustomItems(e.target.checked)}
                      />
                      <span>
                        <strong>Keep staff-added benefits</strong> — the{' '}
                        {customCount === 1 ? 'benefit' : 'benefits'} added to this pet specifically
                        stay on.
                      </span>
                    </label>
                    <label className="pmp-field pmp-field--full">
                      <span className="pmp-field__label">Reason (optional)</span>
                      <input
                        className="pmp-input"
                        value={changeReason}
                        placeholder="e.g. client wanted the puppy plan instead"
                        onChange={(e) => setChangeReason(e.target.value)}
                      />
                    </label>
                  </div>
                  {formError ? (
                    <p className="pmp-form__error" role="alert">
                      {formError}
                    </p>
                  ) : null}
                  {otherPlans.length === 0 ? (
                    <p className="pmp-muted">No other active membership plans to move to.</p>
                  ) : (
                    <ul className="pmp-plans">
                      {otherPlans.map((plan) => (
                        <li key={plan.id} className="pmp-plan">
                          <div className="pmp-plan__main">
                            <span className="pmp-plan__name">{plan.name}</span>
                            <span className="pmp-plan__meta">
                              {[plan.tier, plan.species, planPriceLabel(plan)]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                            {plan.marketingSummary ? (
                              <span className="pmp-plan__blurb">{plan.marketingSummary}</span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="pmp-btn-change"
                            disabled={busy}
                            onClick={() => void switchToPlan(plan)}
                          >
                            Move to this plan
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ) : null}

              {mode === 'cancel' ? (
                <div ref={cancelSectionRef} className="pmp-cancel">
                <Card title={`Cancel ${membership.planName}`} icon={<X size={16} aria-hidden />}>
                  {cancelLoading ? (
                    <p className="pmp-muted">Working out this term’s paid vs used…</p>
                  ) : cancelPreview ? (
                    <>
                      <p className="pmp-owner-sees">{cancelPreview.ownerWillSee}</p>
                      <div className="pmp-cancel-totals">
                        <div>
                          <span>Paid this {cancelPreview.termLabel}</span>
                          <strong>{money(cancelPreview.paidThisTerm)}</strong>
                        </div>
                        <div>
                          <span>Covered services used</span>
                          <strong>{money(cancelPreview.usedThisTerm)}</strong>
                        </div>
                        <div>
                          <span>
                            {cancelPreview.chargeAmount > 0.009
                              ? 'Owner owes'
                              : cancelPreview.refundAmount > 0.009
                                ? 'Refund to owner'
                                : 'Settlement'}
                          </span>
                          <strong>
                            {money(
                              cancelPreview.chargeAmount > 0.009
                                ? cancelPreview.chargeAmount
                                : cancelPreview.refundAmount,
                            )}
                          </strong>
                        </div>
                      </div>
                      {cancelPreview.paidLines.length ? (
                        <ul className="pmp-cancel-lines">
                          {cancelPreview.paidLines.map((line) => (
                            <li key={`paid-${line.description}`}>
                              Paid: {line.description} · {money(line.amount)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {cancelPreview.coveredLines.length ? (
                        <ul className="pmp-cancel-lines">
                          {cancelPreview.coveredLines.map((line) => (
                            <li key={`used-${line.description}`}>
                              Used: {line.description} · {money(line.amount)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="pmp-muted">No covered services were used this term.</p>
                      )}
                    </>
                  ) : (
                    <p className="pmp-muted">
                      We could not calculate the settlement. You can still cancel after entering a
                      reason — try again if this stays empty.
                    </p>
                  )}
                  <label className="pmp-field pmp-field--full">
                    <span className="pmp-field__label">Why is the owner canceling?</span>
                    <textarea
                      className="pmp-input"
                      rows={3}
                      value={cancelReason}
                      placeholder="e.g. moving away, cost, pet passed"
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                  </label>
                  {formError ? (
                    <p className="pmp-form__error" role="alert">
                      {formError}
                    </p>
                  ) : null}
                  <div className="pmp-form__actions">
                    <button
                      type="button"
                      className="pims-detail__btn-secondary"
                      disabled={busy}
                      onClick={closePanels}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="pims-detail__btn-danger"
                      disabled={busy || cancelLoading || !cancelReason.trim()}
                      onClick={() => void cancel()}
                    >
                      {cancelPreview?.chargeAmount && cancelPreview.chargeAmount > 0.009
                        ? `Cancel & charge ${money(cancelPreview.chargeAmount)}`
                        : cancelPreview?.refundAmount && cancelPreview.refundAmount > 0.009
                          ? `Cancel & refund ${money(cancelPreview.refundAmount)}`
                          : 'Cancel membership'}
                    </button>
                  </div>
                </Card>
                </div>
              ) : null}

              {mode === 'add' ? (
                <Card title="Add a benefit to this pet only" icon={<Plus size={16} aria-hidden />}>
                  <p className="pmp-muted pmp-change__lede">
                    This adds the line to {patientName ?? 'this pet'}’s membership alone — the plan
                    template is untouched — and records who added it.
                  </p>
                  <div className="pmp-form__grid">
                    <div className="pmp-field pmp-field--full">
                      <span className="pmp-field__label">Catalog item</span>
                      <CatalogItemPicker
                        practiceId={practiceId}
                        value={addItem}
                        onChange={setAddItem}
                        disabled={busy}
                      />
                    </div>
                    <label className="pmp-field">
                      <span className="pmp-field__label">Allowance</span>
                      <select
                        className="pmp-input"
                        value={isUnlimitedAllowance(addQty) ? 'unlimited' : 'limited'}
                        onChange={(e) =>
                          setAddQty(
                            e.target.value === 'unlimited'
                              ? 'unlimited'
                              : addQty === 'unlimited'
                                ? '1'
                                : addQty || '1',
                          )
                        }
                      >
                        <option value="limited">Limited</option>
                        <option value="unlimited">Unlimited</option>
                      </select>
                      {isUnlimitedAllowance(addQty) ? null : (
                        <input
                          className="pmp-input"
                          inputMode="decimal"
                          value={addQty}
                          onChange={(e) => setAddQty(e.target.value)}
                        />
                      )}
                    </label>
                    <label className="pmp-field">
                      <span className="pmp-field__label">Coverage</span>
                      <select
                        className="pmp-input"
                        value={addCoverage}
                        onChange={(e) => setAddCoverage(e.target.value as ItemCoverage)}
                      >
                        {COVERAGE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {addCoverage === 'copay' ? (
                      <label className="pmp-field">
                        <span className="pmp-field__label">Copay</span>
                        <input
                          className="pmp-input"
                          inputMode="decimal"
                          value={addPrice}
                          placeholder="25"
                          onChange={(e) => setAddPrice(e.target.value)}
                        />
                      </label>
                    ) : null}
                    {addCoverage === 'percent_off' ? (
                      <label className="pmp-field">
                        <span className="pmp-field__label">Percent off</span>
                        <input
                          className="pmp-input"
                          inputMode="decimal"
                          value={addPercent}
                          placeholder="20"
                          onChange={(e) => setAddPercent(e.target.value)}
                        />
                      </label>
                    ) : null}
                    <label className="pmp-field pmp-field--full">
                      <span className="pmp-field__label">Attach to a group</span>
                      <select
                        className="pmp-input"
                        value={addGroupId}
                        onChange={(e) => setAddGroupId(e.target.value)}
                      >
                        <option value="">Its own line, no group</option>
                        {groupOptions.map((g) => (
                          <option key={g.id} value={String(g.id)}>
                            {g.name || `Group ${g.id}`}
                            {g.selectionMode === 'choice'
                              ? ` — widen this OR choice (pick ${g.allowedQuantity})`
                              : ' — all included'}
                          </option>
                        ))}
                      </select>
                      <span className="pmp-field__hint">
                        Attaching to a <strong>choice</strong> group makes this a further
                        alternative sharing that group’s one allowance.
                      </span>
                    </label>
                    <label className="pmp-field pmp-field--full">
                      <span className="pmp-field__label">Note</span>
                      <input
                        className="pmp-input"
                        value={addNote}
                        placeholder="Why this pet gets this benefit"
                        onChange={(e) => setAddNote(e.target.value)}
                      />
                    </label>
                  </div>
                  {formError ? (
                    <p className="pmp-form__error" role="alert">
                      {formError}
                    </p>
                  ) : null}
                  <div className="pmp-form__actions">
                    <button
                      type="button"
                      className="pims-detail__btn-secondary"
                      disabled={busy}
                      onClick={closePanels}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="pims-detail__btn-primary"
                      disabled={busy}
                      onClick={() => void submitAdd()}
                    >
                      {busy ? 'Adding…' : 'Add benefit'}
                    </button>
                  </div>
                </Card>
              ) : null}

              <div className="pmp-groups">
                {membership.groups.length === 0 ? (
                  <p className="pmp-muted">This membership has no benefit groups yet.</p>
                ) : (
                  [...membership.groups].sort((a, b) => a.sortOrder - b.sortOrder).map(renderGroup)
                )}
              </div>

              <div className="pmp-audit">
                <button
                  type="button"
                  className="pmp-audit__toggle"
                  aria-expanded={auditOpen}
                  onClick={() => setAuditOpen((v) => !v)}
                >
                  {auditOpen ? (
                    <ChevronDown size={14} aria-hidden />
                  ) : (
                    <ChevronRight size={14} aria-hidden />
                  )}
                  <History size={14} aria-hidden />
                  Audit trail
                  <span className="pims-detail__count">{audit.length}</span>
                </button>
                {auditOpen ? (
                  audit.length === 0 ? (
                    <p className="pmp-muted">Nothing recorded yet.</p>
                  ) : (
                    <ol className="pmp-audit__list">
                      {audit.map((entry) => (
                        <li key={entry.id} className="pmp-audit__entry">
                          <span className="pmp-audit__summary">{entry.summary}</span>
                          <span className="pmp-audit__meta">
                            {entry.employeeName ?? 'System'} · {dateTime(entry.createdAt)}
                            {entry.action ? ` · ${entry.action}` : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )
                ) : null}
              </div>
              </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {postVisitOpen && clientId ? (
        <PostVisitMembershipSignup
          clientId={clientId}
          patientId={patientId}
          patientName={patientName}
          patientSpecies={patientSpecies}
          patientAgeYears={patientAgeYears}
          initialInvoiceIds={postVisitInvoiceIds}
          seedInvoices={postVisitSeedInvoices}
          onClose={() => setPostVisitOpen(false)}
          onCompleted={() => {
            setPostVisitOpen(false);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}
