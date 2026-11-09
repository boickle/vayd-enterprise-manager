import { AlertTriangle, Check, Clock } from 'lucide-react';
import { isLabValueAbnormal, type LabResult } from '../../api/inHouseLabs';
import './LabResultChip.css';

export function labAbnormalCount(result: LabResult): number {
  if (result.templateMode === 'summary') return 0;
  return (result.elementsSnapshot ?? []).filter((el) =>
    isLabValueAbnormal(el, result.values?.[el.key]?.value)
  ).length;
}

/** Rows a result can be judged on: choice rows with abnormal answers (e.g. a 4Dx). */
function judgedRows(result: LabResult) {
  if (result.templateMode === 'summary') return [];
  return (result.elementsSnapshot ?? []).filter((el) => (el.abnormalOptions ?? []).length > 0);
}

/**
 * Rolled-up state for every form on one lab charge (owner decisions, Nov 8, 2026): numbers aren't
 * judged (no ranges), so a form with only numbers, text or a write-up is just Complete. A form
 * with choice rows (Negative / Positive) is Abnormal when an abnormal answer was picked, and
 * Normal when it has answers and none is abnormal.
 */
export type LabResultsState = 'none' | 'waiting' | 'abnormal' | 'normal' | 'complete';

export function labResultsState(results: LabResult[] | null | undefined): LabResultsState {
  if (!results?.length) return 'none';
  if (results.some((r) => r.status === 'pending')) return 'waiting';
  if (results.some((r) => labAbnormalCount(r) > 0)) return 'abnormal';
  const answeredChoice = results.some((r) =>
    judgedRows(r).some((el) => Boolean(r.values?.[el.key]?.value)),
  );
  return answeredChoice ? 'normal' : 'complete';
}

type Props = {
  results: LabResult[] | null | undefined;
  /** Chip text for the waiting state; the invoice says "Not run", the chart says "WAITING". */
  waitingLabel?: string;
  className?: string;
};

/**
 * Not run / N abnormal / Normal / Complete, for a lab charge wherever it appears — the
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
  if (state === 'abnormal') {
    const flagged = (results ?? []).reduce((n, r) => n + labAbnormalCount(r), 0);
    return (
      <span className={cls}>
        <AlertTriangle size={11} aria-hidden /> {flagged} abnormal
      </span>
    );
  }
  return (
    <span className={cls}>
      <Check size={11} aria-hidden /> {state === 'normal' ? 'Normal' : 'Complete'}
    </span>
  );
}
