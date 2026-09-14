import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  HeartHandshake,
  History,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  addMembershipItem,
  cancelMembership,
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
  type PatientMembership,
} from '../../api/memberships';
import { apiErrorMessage, getToken } from '../../api/http';
import { resolvePracticeIdFromToken } from '../../utils/practiceIdFromToken';
import { appConfirm, appPrompt } from '../../utils/appDialog';
import CatalogItemPicker, { type PickedCatalogItem } from '../catalog/CatalogItemPicker';
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
    quantity: String(b.includedQuantity ?? 1),
    coverage: b.coverage,
    price: b.price != null ? String(b.price) : '',
    percentOff: b.percentOff != null ? String(b.percentOff) : '',
    note: b.note ?? '',
  };
}

function AllowanceMeter({ used, total, label }: { used: number; total: number; label: string }) {
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
};

type PanelMode = 'none' | 'add' | 'change' | 'enrol';

export default function PatientMembershipPanel({
  patientId,
  practiceId: practiceIdProp,
  patientName,
}: Props) {
  const practiceId = practiceIdProp ?? resolvePracticeIdFromToken(getToken());
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [membership, setMembership] = useState<PatientMembership | null>(null);
  const [audit, setAudit] = useState<MembershipAuditEntry[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [plans, setPlans] = useState<Bundle[]>([]);
  const [mode, setMode] = useState<PanelMode>('none');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  // Plan change / enrolment.
  const [changeReason, setChangeReason] = useState('');
  const [carryOverUsage, setCarryOverUsage] = useState(true);
  const [keepCustomItems, setKeepCustomItems] = useState(true);
  const [enrolInterval, setEnrolInterval] = useState<MembershipBillingInterval>('monthly');

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
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

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
    resetAddForm();
  }

  /* --------------------------------------------------------------- mutations */

  async function submitAdd() {
    if (!membership) return;
    if (!addItem) {
      setFormError('Pick a catalog item first.');
      return;
    }
    const qty = numOrNull(addQty);
    if (qty == null || qty <= 0) {
      setFormError('Quantity must be a number above zero.');
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
    const qty = numOrNull(editDraft.quantity);
    if (qty == null || qty <= 0) {
      setFormError('Quantity must be a number above zero.');
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
    const ok = await appConfirm({
      title: `Enrol in ${plan.name}?`,
      message: `${patientName ?? 'This pet'} will be enrolled in ${plan.name}, billed ${
        enrolInterval === 'annual' ? 'annually' : 'monthly'
      }. Every benefit on the plan becomes available right away.`,
      confirmLabel: 'Enrol',
    });
    if (!ok) return;
    setBusy(true);
    setFormError(null);
    try {
      const created = await createPatientMembership({
        patientId,
        packageId: plan.id,
        billingInterval: enrolInterval,
      });
      setMembership(created);
      await refreshAudit(created.id);
      closePanels();
    } catch (e) {
      setFormError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!membership) return;
    const reason = await appPrompt({
      title: `Cancel ${membership.planName}`,
      message:
        'The membership stops renewing and its remaining benefits close. Tell us why — the reason is stored on the audit trail.',
      placeholder: 'e.g. client requested cancellation',
      confirmLabel: 'Cancel membership',
      danger: true,
    });
    if (reason == null) return;
    setBusy(true);
    setError(null);
    try {
      const next = await cancelMembership(membership.id, reason.trim() || undefined);
      setMembership(next);
      await refreshAudit(next.id);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------ render */

  const groupOptions = membership?.groups ?? [];
  /** A cancelled membership still shows its history, but the pet can be put on a plan again. */
  const canEnrol = !loading && (!membership || membership.status !== 'active');

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
                <span className="pmp-field__label">Quantity included</span>
                <input
                  className="pmp-input"
                  inputMode="decimal"
                  value={editDraft.quantity}
                  onChange={(e) => setEditDraft({ ...editDraft, quantity: e.target.value })}
                />
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
              label={`${benefit.remainingQuantity} of ${benefit.includedQuantity} left`}
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
                Pick {group.allowedQuantity} of these {live.length}
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
              label={`${group.remainingQuantity} of ${group.allowedQuantity} left`}
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
    <span className="pmp-head-plan">
      {membership.planName}
      {membership.status !== 'active' ? ' · inactive' : ''}
    </span>
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
            <div className="pmp-empty">
              <p className="pmp-muted">
                {membership
                  ? `The ${membership.planName} membership is no longer active.`
                  : `${patientName ?? 'This pet'} is not on a membership plan.`}
              </p>
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
                Enrol in a plan
              </button>
            </div>
          ) : null}

          {canEnrol && mode === 'enrol' ? (
            <Card title="Available membership plans">
              <label className="pmp-field pmp-field--inline">
                <span className="pmp-field__label">Billing</span>
                <select
                  className="pmp-input"
                  value={enrolInterval}
                  onChange={(e) => setEnrolInterval(e.target.value as MembershipBillingInterval)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>
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
                        Enrol
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {membership ? (
            <>
              <div className="pmp-summary">
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
                      onClick={() => void cancel()}
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
                      label: 'Benefit groups',
                      value: String(membership.groups.length),
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
                      <span className="pmp-field__label">Quantity included</span>
                      <input
                        className="pmp-input"
                        inputMode="decimal"
                        value={addQty}
                        onChange={(e) => setAddQty(e.target.value)}
                      />
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
        </div>
      ) : null}
    </section>
  );
}
