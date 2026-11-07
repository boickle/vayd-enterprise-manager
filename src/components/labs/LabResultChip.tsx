import { AlertTriangle, Check, Clock } from 'lucide-react';
import { isLabValueAbnormal, type LabResult } from '../../api/inHouseLabs';
import './LabResultChip.css';

export function labAbnormalCount(result: LabResult): number {
  if (result.templateMode === 'summary') return 0;
  return (result.elementsSnapshot ?? []).filter((el) =>
    isLabValueAbnormal(el, result.values?.[el.key]?.value)
  ).length;
}

/**
 * Rolled-up state for every form on one lab charge. Nobody marks a result normal: Scout flags values against
 * each row's range or abnormal options. A notes-only (summary) form has nothing to check, so once saved it is
 * just complete. Normal means every form had values to check and none were flagged.
 */
export type LabResultsState = 'none' | 'waiting' | 'abnormal' | 'normal' | 'complete';

export function labResultsState(results: LabResult[] | null | undefined): LabResultsState {
  if (!results?.length) return 'none';
  if (results.some((r) => r.status === 'pending')) return 'waiting';
  if (results.some((r) => labAbnormalCount(r) > 0)) return 'abnormal';
  return results.some((r) => r.templateMode === 'summary') ? 'complete' : 'normal';
}

type Props = {
  results: LabResult[] | null | undefined;
  /** Chip text for the waiting state; the invoice says "Not run", the chart says "WAITING". */
  waitingLabel?: string;
  className?: string;
};

/**
 * Not run / abnormal / Normal / Complete, for a lab charge wherever it appears — the
 * invoice line, the SOAP checkout, or the chart timeline.
 */
export default function LabResultChip({ results, waitingLabel = 'Not run', className }: Props) {
  const state = labResultsState(results);
  if (state === 'none') return null;
  const flagged = (results ?? []).reduce((n, r) => n + labAbnormalCount(r), 0);
  const cls = `lab-chip lab-chip--${state}${className ? ` ${className}` : ''}`;
  if (state === 'waiting') {
    return (
      <span className={cls}>
        <Clock size={11} aria-hidden /> {waitingLabel}
      </span>
    );
  }
  if (state === 'abnormal') {
    return (
      <span className={cls}>
        <AlertTriangle size={11} aria-hidden /> {flagged} abnormal
      </span>
    );
  }
  return (
    <span className={cls}>
      <Check size={11} aria-hidden /> {state === 'complete' ? 'Complete' : 'Normal'}
    </span>
  );
}
