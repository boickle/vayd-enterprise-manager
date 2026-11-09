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
 * `abnormalOptions`. Number rows never flag (owner decision, Nov 8, 2026: no number
 * ranges, whatever a form still holds in min/max), and neither do free-text rows.
 */
export function isLabValueAbnormal(
  element: LabFormElement,
  value: string | null | undefined
): boolean {
  if (value == null || value === '') return false;
  if (element.abnormalOptions?.length) {
    return element.abnormalOptions.some((o) => o.toLowerCase() === String(value).toLowerCase());
  }
  return false;
}

/** The row's units ("mg/dl"), or empty. Number ranges aren't shown (owner decision, Nov 8, 2026). */
export function formatLabRange(element: LabFormElement): string {
  return element.valueType === 'number' && element.units ? element.units : '';
}

/** A row is answered when it has a value or a comment. Whitespace does not count. */
export function labRowHasAnswer(
  value: string | null | undefined,
  comments: string | null | undefined,
): boolean {
  return Boolean(value?.trim() || comments?.trim());
}

/** Rows still blank when someone tries to mark the panel done. */
export function missingLabResultRows(
  elements: LabFormElement[],
  draft: Record<string, { value?: string | null; comments?: string | null } | undefined>,
): LabFormElement[] {
  return elements.filter(
    (el) => !labRowHasAnswer(draft[el.key]?.value, draft[el.key]?.comments),
  );
}

/** Summary forms store rich text. An empty editor is still a paragraph of markup. */
export function labSummaryHasText(summary: string | null | undefined): boolean {
  return (summary ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim().length > 0;
}

/** Name of whoever ran the lab, or '' when it has not been resulted yet. */
export function resultedByLabel(result: {
  resultedBy?: { firstName?: string | null; lastName?: string | null } | null;
}): string {
  const e = result.resultedBy;
  if (!e) return '';
  return [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
}
