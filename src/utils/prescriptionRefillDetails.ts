export type RefillSchedule = {
  frequencyLabel: string;
  daysPerFill: number;
  nextDueDate: string | null;
  refillDays: number | null;
  refillThroughDate: string | null;
  refillExpiration: string | null;
};

function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(start: Date, days: number): Date {
  const next = new Date(start);
  next.setDate(next.getDate() + Math.round(days));
  return next;
}

function toInputDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatScheduleDate(value: string | Date | null): string {
  const date = value instanceof Date ? value : value ? parseDate(value) : null;
  return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export function formatDuration(days: number): string {
  if (days < 11) return `${Math.max(1, Math.round(days))} day${Math.round(days) === 1 ? '' : 's'}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return weeks <= 1 ? 'about 1 week' : `about ${weeks} weeks`;
  }
  const months = Math.round(days / 30);
  return months <= 1 ? 'about 1 month' : `about ${months} months`;
}

/**
 * Reads a typical veterinary sig for how often one unit is given. Used only to estimate
 * days' supply — it is not a dosing calculator.
 */
export function parseSigFrequency(instructions: string): { unitsPerDose: number; intervalDays: number; label: string } | null {
  const text = instructions.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const give = text.match(/(?:give|apply|use|administer|insert)\s+(\d+(?:\.\d+)?)/);
  const unitsPerDose = give ? Number(give[1]) : 1;

  const everyMonths = text.match(/(?:once\s+)?every\s+(\d+(?:\.\d+)?)\s+months?/);
  if (everyMonths) {
    const n = Number(everyMonths[1]);
    return { unitsPerDose, intervalDays: n * 30, label: n === 1 ? 'once a month' : `every ${n} months` };
  }

  const everyWeeks = text.match(/(?:once\s+)?every\s+(\d+(?:\.\d+)?)\s+weeks?/);
  if (everyWeeks) {
    const n = Number(everyWeeks[1]);
    return { unitsPerDose, intervalDays: n * 7, label: n === 1 ? 'once a week' : `every ${n} weeks` };
  }

  const everyDays = text.match(/(?:once\s+)?every\s+(\d+(?:\.\d+)?)\s+days?/);
  if (everyDays) {
    const n = Number(everyDays[1]);
    return { unitsPerDose, intervalDays: n, label: n === 1 ? 'once a day' : `every ${n} days` };
  }

  const everyHours = text.match(/every\s+(\d+)(?:\s*[-–to]+\s*(\d+))?\s+hours?/);
  if (everyHours) {
    const a = Number(everyHours[1]);
    const b = everyHours[2] ? Number(everyHours[2]) : a;
    const hours = (a + b) / 2;
    return {
      unitsPerDose,
      intervalDays: hours / 24,
      label: everyHours[2] ? `every ${a}–${b} hours` : `every ${a} hours`,
    };
  }

  if (/\bq\s*12\s*h\b/.test(text)) return { unitsPerDose, intervalDays: 0.5, label: 'every 12 hours' };
  if (/\bq\s*8\s*h\b/.test(text)) return { unitsPerDose, intervalDays: 1 / 3, label: 'every 8 hours' };
  if (/\bq\s*6\s*h\b/.test(text)) return { unitsPerDose, intervalDays: 0.25, label: 'every 6 hours' };
  if (/\bbid\b|twice\s+(?:a\s+)?daily|twice\s+a\s+day|two\s+times\s+(?:a\s+)?(?:day|daily)/.test(text)) {
    return { unitsPerDose, intervalDays: 0.5, label: 'twice daily' };
  }
  if (/\btid\b|three\s+times/.test(text)) return { unitsPerDose, intervalDays: 1 / 3, label: 'three times daily' };
  if (/\bqid\b|four\s+times/.test(text)) return { unitsPerDose, intervalDays: 0.25, label: 'four times daily' };
  if (/\bsid\b|once\s+daily|once\s+a\s+day|every\s+day|\bdaily\b/.test(text)) {
    return { unitsPerDose, intervalDays: 1, label: 'once daily' };
  }
  if (/\bqod\b|\beod\b|every\s+other\s+day/.test(text)) {
    return { unitsPerDose, intervalDays: 2, label: 'every other day' };
  }

  return null;
}

export function estimateRefillSchedule(input: {
  instructions: string;
  quantity: number;
  startDate: string;
  refillCount: number;
  refillExpiration?: string;
}): RefillSchedule | null {
  const parsed = parseSigFrequency(input.instructions);
  if (!parsed || parsed.unitsPerDose <= 0 || parsed.intervalDays <= 0) return null;
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const daysPerFill = (qty / parsed.unitsPerDose) * parsed.intervalDays;
  if (!Number.isFinite(daysPerFill) || daysPerFill <= 0) return null;

  const start = parseDate(input.startDate);
  const nextDue = start ? addDays(start, daysPerFill) : null;
  const refills = Math.max(0, Math.floor(Number(input.refillCount) || 0));
  const refillDays = refills > 0 ? daysPerFill * refills : null;
  const refillThrough = start && refillDays != null ? addDays(start, daysPerFill + refillDays) : null;
  const expiration = input.refillExpiration ? parseDate(input.refillExpiration) : null;

  return {
    frequencyLabel: parsed.label,
    daysPerFill,
    nextDueDate: nextDue ? toInputDate(nextDue) : null,
    refillDays,
    refillThroughDate: refillThrough ? toInputDate(refillThrough) : null,
    refillExpiration: expiration ? toInputDate(expiration) : null,
  };
}
