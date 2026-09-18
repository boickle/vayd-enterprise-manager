import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  resolveBundleForSale,
  type Bundle,
  type BundleGroup,
  type BundleItem,
  type BundleSaleGroupSelection,
  type BundleSaleResolution,
} from '../../api/memberships';
import { apiErrorMessage } from '../../api/http';
import './BundleSalePickerModal.css';

type Props = {
  bundle: Bundle;
  onCancel: () => void;
  onResolved: (resolution: BundleSaleResolution) => void | Promise<void>;
};

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function picksNeeded(group: BundleGroup): number {
  const n = Number(group.allowedQuantity);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n < 0) return 1;
  return Math.floor(n);
}

function groupIsRequired(group: BundleGroup): boolean {
  if (group.selectionMode === 'any') return false;
  return group.isRequired !== false;
}

function toggleId(ids: number[], id: number, max: number | null): number[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (max == null) return [...ids, id];
  if (max <= 1) return [id];
  if (ids.length >= max) return [...ids.slice(1), id];
  return [...ids, id];
}

function itemLabel(item: BundleItem): string {
  const bits = [item.name];
  if (item.code) bits.push(item.code);
  if (item.catalogPrice != null) bits.push(money(item.catalogPrice));
  return bits.join(' · ');
}

function groupReady(group: BundleGroup, selected: number[]): boolean {
  if (group.selectionMode === 'any') return true;
  const need = picksNeeded(group);
  if (selected.length === 0) return !groupIsRequired(group);
  return selected.length === need;
}

/**
 * Step-through picker for sell-once bundle OR / ANY groups. One group per
 * step; Add to invoice only after the last choice.
 */
export default function BundleSalePickerModal({ bundle, onCancel, onResolved }: Props) {
  const pickGroups = useMemo(
    () =>
      [...bundle.groups]
        .filter(
          (g) =>
            (g.selectionMode === 'choice' || g.selectionMode === 'any') &&
            g.id > 0 &&
            g.items.length > 0,
        )
        // ORs first (required picks), then ANYs (optional multi-check), then
        // sortOrder within each mode so staff walk the wizard in a predictable order.
        .sort((a, b) => {
          const modeRank = (m: string) => (m === 'choice' ? 0 : 1);
          const byMode = modeRank(a.selectionMode) - modeRank(b.selectionMode);
          if (byMode !== 0) return byMode;
          return a.sortOrder - b.sortOrder;
        }),
    [bundle.groups],
  );
  const includedItems = useMemo(
    () =>
      [...bundle.groups]
        .filter((g) => g.selectionMode === 'all' || g.id === 0)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .flatMap((g) => g.items),
    [bundle.groups],
  );

  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Record<number, number[]>>(() => {
    const init: Record<number, number[]> = {};
    for (const g of pickGroups) init[g.id] = [];
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = Math.max(pickGroups.length, 1);
  const stepIndex = Math.min(step, totalSteps - 1);
  const group = pickGroups[stepIndex] ?? null;
  const isLast = stepIndex >= pickGroups.length - 1;
  const selected = group ? (picks[group.id] ?? []) : [];
  const stepReady = group ? groupReady(group, selected) : true;

  async function confirm() {
    if (!pickGroups.every((g) => groupReady(g, picks[g.id] ?? [])) || submitting) return;
    setSubmitting(true);
    setError(null);
    const selections: BundleSaleGroupSelection[] = pickGroups.map((g) => ({
      groupId: g.id,
      packageItemIds: picks[g.id] ?? [],
    }));
    try {
      const resolution = await resolveBundleForSale(bundle.id, selections);
      await onResolved(resolution);
    } catch (e: unknown) {
      setError(apiErrorMessage(e) || 'Could not expand this bundle.');
      setSubmitting(false);
    }
  }

  function goNext() {
    if (!stepReady || isLast) return;
    setError(null);
    setStep((s) => Math.min(s + 1, totalSteps - 1));
  }

  function goBack() {
    if (stepIndex <= 0) return;
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  return createPortal(
    <div className="bsp-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="bsp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bsp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bsp-modal__head">
          <div>
            <p className="bsp-modal__eyebrow">Bundle</p>
            <h2 id="bsp-title" className="bsp-modal__title">
              {bundle.name}
            </h2>
            <p className="bsp-modal__hint">
              {pickGroups.length > 1
                ? `Step ${stepIndex + 1} of ${pickGroups.length} — choose for this group, then continue.`
                : 'Choose options to put on this invoice. Included items are added automatically.'}
            </p>
          </div>
          <button type="button" className="bsp-icon-btn" aria-label="Close" onClick={onCancel}>
            <X size={18} aria-hidden />
          </button>
        </header>

        {pickGroups.length > 1 ? (
          <div className="bsp-steps" aria-hidden>
            {pickGroups.map((g, i) => (
              <span
                key={g.id}
                className={`bsp-steps__dot${i === stepIndex ? ' is-current' : ''}${i < stepIndex ? ' is-done' : ''}`}
              />
            ))}
          </div>
        ) : null}

        <div className="bsp-modal__body" key={group?.id ?? 'empty'}>
          {group ? (
            <section
              className={`bsp-group${group.selectionMode === 'any' ? ' bsp-group--any' : ' bsp-group--choice'}`}
            >
              <header className="bsp-group__head">
                <h3 className="bsp-group__title">
                  {group.name ||
                    (group.selectionMode === 'any' ? 'Optional add-ons' : 'Choose one')}
                </h3>
                <span className="bsp-group__meta">
                  {group.selectionMode === 'any'
                    ? `Any · ${selected.length} selected`
                    : groupIsRequired(group)
                      ? `Pick ${picksNeeded(group)}${selected.length ? ` · ${selected.length} selected` : ''}`
                      : `Optional · pick ${picksNeeded(group)} or skip${selected.length ? ` · ${selected.length} selected` : ''}`}
                </span>
              </header>
              {group.description ? <p className="bsp-group__desc">{group.description}</p> : null}
              <ul className="bsp-options">
                {group.items.map((item) => {
                  const anyMode = group.selectionMode === 'any';
                  const need = picksNeeded(group);
                  const required = groupIsRequired(group);
                  const max = anyMode ? null : need;
                  const useRadio = !anyMode && required && need === 1;
                  const on = selected.includes(item.id);
                  return (
                    <li key={item.id}>
                      <label className={`bsp-option${on ? ' is-on' : ''}`}>
                        <input
                          type={useRadio ? 'radio' : 'checkbox'}
                          name={`bsp-g-${group.id}`}
                          checked={on}
                          onChange={() =>
                            setPicks((prev) => ({
                              ...prev,
                              [group.id]: toggleId(prev[group.id] ?? [], item.id, max),
                            }))
                          }
                        />
                        <span>{itemLabel(item)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="bsp-group__desc">Nothing to choose for this bundle.</p>
          )}

          {isLast && includedItems.length > 0 ? (
            <section className="bsp-group">
              <header className="bsp-group__head">
                <h3 className="bsp-group__title">Also included</h3>
              </header>
              <ul className="bsp-included">
                {includedItems.map((item) => (
                  <li key={item.id}>{itemLabel(item)}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {error ? <p className="bsp-error">{error}</p> : null}

        <footer className="bsp-modal__foot">
          {stepIndex > 0 ? (
            <button
              type="button"
              className="bsp-btn bsp-btn--ghost"
              onClick={goBack}
              disabled={submitting}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="bsp-modal__foot-end">
            <button
              type="button"
              className="bsp-btn bsp-btn--ghost"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            {isLast ? (
              <button
                type="button"
                className="bsp-btn bsp-btn--primary"
                disabled={!stepReady || submitting}
                onClick={() => void confirm()}
              >
                {submitting ? 'Adding…' : 'Add to invoice'}
              </button>
            ) : (
              <button
                type="button"
                className="bsp-btn bsp-btn--primary"
                disabled={!stepReady || submitting}
                onClick={goNext}
              >
                Next
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
