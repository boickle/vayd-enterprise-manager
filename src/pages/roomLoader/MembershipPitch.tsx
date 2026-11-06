// src/pages/roomLoader/MembershipPitch.tsx
// The membership pitch on the summary page. The savings headline and a few preview rows
// show while collapsed; expanding hides those rows and reveals the full comparison.
import type { ReactNode } from 'react';
import type { RoomLoaderMembershipConfig } from '../../utils/roomLoaderConfigTypes';
import RoomLoaderHtml from './RoomLoaderHtml';
import './MembershipPitch.css';

export type MembershipPitchRow = {
  name: string;
  originalPrice: number;
  adjustedPrice: number;
};

type Props = {
  config: RoomLoaderMembershipConfig;
  /** Total the household would save this visit, or null while the simulate is loading. */
  savings: number | null;
  /** Comparison rows for the preview; the component sorts and trims them. */
  rows: MembershipPitchRow[];
  expanded: boolean;
  onToggle: (next: boolean) => void;
  expandLabel: string;
  collapseLabel: string;
  formatPrice: (value: number) => string;
  loading?: boolean;
  /** The full comparison, revealed when expanded. */
  children: ReactNode;
};

export default function MembershipPitch({
  config,
  savings,
  rows,
  expanded,
  onToggle,
  expandLabel,
  collapseLabel,
  formatPrice,
  loading = false,
  children,
}: Props) {
  const previewCount = Math.max(0, Math.trunc(config.previewRowCount));
  const ranked = rows
    .filter((row) => row.originalPrice - row.adjustedPrice > 0.005)
    .sort((a, b) => b.originalPrice - b.adjustedPrice - (a.originalPrice - a.adjustedPrice));
  const preview = ranked.slice(0, previewCount);
  const hiddenCount = ranked.length - preview.length;

  return (
    <section className="rl-pitch" aria-labelledby="rl-pitch-headline">
      <h2 className="rl-pitch__headline" id="rl-pitch-headline">
        {config.headline}
      </h2>
      <RoomLoaderHtml html={config.subheadHtml} className="rl-pitch__subhead" />

      <div className="rl-pitch__savings">
        <span className="rl-pitch__savingsAmount">
          {savings != null && savings > 0 ? formatPrice(savings) : loading ? '—' : formatPrice(0)}
        </span>
        <span className="rl-pitch__savingsLabel">
          {savings != null && savings > 0
            ? 'less on this visit with a membership'
            : loading
              ? 'calculating your savings…'
              : 'in membership savings on this visit'}
        </span>
      </div>

      {preview.length > 0 && !expanded ? (
        <ul className="rl-pitch__rows">
          {preview.map((row, idx) => (
            <li className="rl-pitch__row" key={`${row.name}-${idx}`}>
              <span className="rl-pitch__rowName">{row.name}</span>
              <span className="rl-pitch__rowPrices">
                <span className="rl-pitch__was">{formatPrice(row.originalPrice)}</span>
                <span className="rl-pitch__now">{formatPrice(row.adjustedPrice)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {hiddenCount > 0 && !expanded ? (
        <p className="rl-pitch__more">
          …and {hiddenCount} more {hiddenCount === 1 ? 'item' : 'items'} in the full comparison.
        </p>
      ) : null}

      <button
        type="button"
        className={`rl-pitch__toggle${
          expanded ? '' : ' public-room-loader-membership-explainer-trigger--throb'
        }`}
        id="membership-bill-explainer-trigger"
        aria-expanded={expanded}
        aria-controls="membership-bill-explainer-panel"
        onClick={() => onToggle(!expanded)}
      >
        <span aria-hidden className="rl-pitch__caret">
          {expanded ? '▼' : '▶'}
        </span>
        {expanded ? collapseLabel : expandLabel}
      </button>

      {expanded ? (
        <div className="rl-pitch__panel" id="membership-bill-explainer-panel">
          {children}
        </div>
      ) : null}
    </section>
  );
}
