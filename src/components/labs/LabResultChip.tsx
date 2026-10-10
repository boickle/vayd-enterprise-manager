import { AlertTriangle, Check, Clock } from 'lucide-react';
import { isLabValueAbnormal, type LabResult } from '../../api/inHouseLabs';
import './LabResultChip.css';

export function labAbnormalCount(result: LabResult): number {
  if (result.templateMode === 'summary') return 0;
  return (result.elementsSnapshot ?? []).filter((el) =>
    isLabValueAbnormal(el, result.values?.[el.key]?.value)
  ).length;
}

/** Rolled-up state for every form on one lab charge. */
export type LabResultsState = 'none' | 'waiting' | 'abnormal' | 'normal';

export function labResultsState(results: LabResult[] | null | undefined): LabResultsState {
  if (!results?.length) return 'none';
  if (results.some((r) => r.status === 'pending')) return 'waiting';
  return results.some((r) => labAbnormalCount(r) > 0) ? 'abnormal' : 'normal';
}

type Props = {
  results: LabResult[] | null | undefined;
  /** Chip text for the waiting state; the invoice says "Not run", the chart says "WAITING". */
  waitingLabel?: string;
  className?: string;
};

/**
 * Not run / abnormal / Normal, for a lab charge wherever it appears — the
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
      <Check size={11} aria-hidden /> Normal
    </span>
  );
}
