import { useState } from 'react';
import { X } from 'lucide-react';
import type { MembershipCoverageAlternative } from '../../api/roomLoader';
import './MembershipCoveragePickerModal.css';

type Props = {
  itemName: string;
  alternatives: MembershipCoverageAlternative[];
  initialId?: number | null;
  onCancel: () => void;
  onPick: (wellnessPlanItemId: number) => void;
};

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function allowanceLabel(alt: MembershipCoverageAlternative): string {
  if (alt.includedQuantity < 0) {
    return alt.usedQuantity > 0 ? `Unlimited · ${alt.usedQuantity} used` : 'Unlimited';
  }
  return `${alt.remainingQuantity} of ${alt.includedQuantity} left`;
}

/**
 * When a membership has both “1 included” and “50% off unlimited” (etc.) for the
 * same catalog item, staff picks which benefit to apply on this charge.
 */
export default function MembershipCoveragePickerModal({
  itemName,
  alternatives,
  initialId,
  onCancel,
  onPick,
}: Props) {
  const [selected, setSelected] = useState<number>(
    () => initialId ?? alternatives[0]?.wellnessPlanItemId ?? 0,
  );

  return (
    <div className="mcp-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="mcp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mcp-modal__head">
          <div>
            <p className="mcp-modal__eyebrow">Membership coverage</p>
            <h2 id="mcp-title" className="mcp-modal__title">
              Which benefit for {itemName}?
            </h2>
            <p className="mcp-modal__hint">
              This pet has more than one active benefit for this item. Pick which one to use on
              this charge.
            </p>
          </div>
          <button type="button" className="mcp-icon-btn" aria-label="Close" onClick={onCancel}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <ul className="mcp-options">
          {alternatives.map((alt) => {
            const on = selected === alt.wellnessPlanItemId;
            return (
              <li key={alt.wellnessPlanItemId}>
                <label className={`mcp-option${on ? ' is-on' : ''}`}>
                  <input
                    type="radio"
                    name="mcp-coverage"
                    checked={on}
                    onChange={() => setSelected(alt.wellnessPlanItemId)}
                  />
                  <span className="mcp-option__body">
                    <span className="mcp-option__label">{alt.label}</span>
                    <span className="mcp-option__meta">
                      {money(alt.adjustedPrice)} · {allowanceLabel(alt)}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <footer className="mcp-modal__foot">
          <button type="button" className="mcp-btn mcp-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="mcp-btn mcp-btn--primary"
            disabled={!selected}
            onClick={() => onPick(selected)}
          >
            Use this benefit
          </button>
        </footer>
      </div>
    </div>
  );
}
