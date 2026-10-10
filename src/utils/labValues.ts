/**
 * Shape of an in-house lab form row, plus the pure range checks.
 *
 * Kept out of the API client so anything that only needs the maths — result
 * rendering, the worklist, tests — does not drag the HTTP layer along.
 */

export type LabFormElementValueType = 'number' | 'text' | 'select';

export type LabFormElement = {
  key: string;
  name: string;
  valueType: LabFormElementValueType;
  min: number | null;
  max: number | null;
  units: string | null;
  options?: string[];
  /** Choices that mean "flag this", e.g. ['Positive'] on a snap test. */
  abnormalOptions?: string[];
  defaultValue?: string | null;
};

/** 'analytes' renders the Name/Value/Reference/Comments grid, 'summary' a write-up. */
export type LabFormMode = 'analytes' | 'summary';

/**
 * Whether a reading should be flagged.
 *
 * Snap tests read Negative/Positive rather than a range, so they flag off
 * `abnormalOptions`. Free-text rows and rows with no range never flag.
 */
export function isLabValueAbnormal(
  element: LabFormElement,
  value: string | null | undefined
): boolean {
  if (value == null || value === '') return false;
  if (element.abnormalOptions?.length) {
    return element.abnormalOptions.some((o) => o.toLowerCase() === String(value).toLowerCase());
  }
  if (element.valueType !== 'number') return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (element.min != null && n < element.min) return true;
  if (element.max != null && n > element.max) return true;
  return false;
}

/** "0 – 500 mg/dl", or empty when the row has no range to show. */
export function formatLabRange(element: LabFormElement): string {
  const hasMin = element.min != null;
  const hasMax = element.max != null;
  if (!hasMin && !hasMax) return '';
  const range =
    hasMin && hasMax
      ? `${element.min} – ${element.max}`
      : hasMin
        ? `≥ ${element.min}`
        : `≤ ${element.max}`;
  return element.units ? `${range} ${element.units}` : range;
}

/** Name of whoever ran the lab, or '' when it has not been resulted yet. */
export function resultedByLabel(result: {
  resultedBy?: { firstName?: string | null; lastName?: string | null } | null;
}): string {
  const e = result.resultedBy;
  if (!e) return '';
  return [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
}
