import { Check, Clock } from 'lucide-react';
import { isLabValueAbnormal, type LabResult } from '../../api/inHouseLabs';
import './LabResultChip.css';

export function labAbnormalCount(result: LabResult): number {
  if (result.templateMode === 'summary') return 0;
  return (result.elementsSnapshot ?? []).filter((el) =>
    isLabValueAbnormal(el, result.values?.[el.key]?.value)
  ).length;
}

/**
 * Rolled-up state for every form on one lab charge: not run yet, or complete. The chip
 * doesn't judge the result (owner decision, Nov 8, 2026); an abnormal choice is flagged
 * inside the form itself.
 */
export type LabResultsState = 'none' | 'waiting' | 'complete';

export function labResultsState(results: LabResult[] | null | undefined): LabResultsState {
  if (!results?.length) return 'none';
  if (results.some((r) => r.status === 'pending')) return 'waiting';
  return 'complete';
}

type Props = {
  results: LabResult[] | null | undefined;
  /** Chip text for the waiting state; the invoice says "Not run", the chart says "WAITING". */
  waitingLabel?: string;
  className?: string;
};

/**
 * Not run / Complete, for a lab charge wherever it appears — the
 * invoice line, the SOAP checkout, or the chart timeline.
 */
export default function LabResultChip({ results, waitingLabel = 'Not run', className }: Props) {
  const state = labResultsState(results);
  if (state === 'none') return null;
  const cls = `lab-chip lab-chip--${state}${className ? ` ${className}` : ''}`;
  if (state === 'waiting') {
    return (
      <span className={cls}>
        <Clock size={11} aria-hidden /> {waitingLabel}
      </span>
    );
  }
  return (
    <span className={cls}>
      <Check size={11} aria-hidden /> Complete
    </span>
  );
}
