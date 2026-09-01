import { DateTime } from 'luxon';

export type ScheduleOptimizeSmsKind = 'ask' | 'moved';

export type ScheduleOptimizeSmsFields = {
  petNames: readonly string[];
  fromDate: string;
  toDate: string;
  practiceTz: string;
  fromTimeLabel?: string | null;
  toTimeLabel?: string | null;
  fromWindowLabel?: string | null;
  toWindowLabel?: string | null;
  originalStartIso?: string | null;
  newStartIso?: string | null;
};

function petPhrase(names: readonly string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return 'your pet';
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
}

function petsAppointmentPhrase(names: readonly string[]): string {
  const phrase = petPhrase(names);
  if (phrase === 'your pet') return "your pet's appointment";
  if (phrase.toLowerCase().endsWith('s')) return `${phrase}' appointment`;
  return `${phrase}'s appointment`;
}

function weekdayDate(dateIso: string, practiceTz: string, fallbackIso?: string | null): string {
  let dt = DateTime.fromISO(dateIso, { zone: practiceTz });
  if (!dt.isValid && fallbackIso) {
    dt = DateTime.fromISO(fallbackIso, { zone: 'utc' }).setZone(practiceTz);
  }
  return dt.isValid ? dt.toFormat('cccc, LLLL d') : dateIso.trim();
}

function clockLabel(timeLabel?: string | null, startIso?: string | null, practiceTz?: string): string {
  const labeled = timeLabel?.trim();
  if (labeled) return labeled;
  if (!startIso || !practiceTz) return '';
  const dt = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  return dt.isValid ? dt.toFormat('h:mm a') : '';
}

function windowPart(windowLabel?: string | null): string {
  const win = windowLabel?.trim();
  if (!win) return '';
  return win.startsWith('(') ? win : `(${win})`;
}

/** Previous slot: weekday, date, time, and effective window. */
export function formatOptimizeSmsFromWhen(fields: ScheduleOptimizeSmsFields): string {
  const day = weekdayDate(fields.fromDate, fields.practiceTz, fields.originalStartIso);
  const time = clockLabel(fields.fromTimeLabel, fields.originalStartIso, fields.practiceTz);
  const win = windowPart(fields.fromWindowLabel);
  return [day, time ? `at ${time}` : '', win].filter(Boolean).join(' ');
}

/** New slot: weekday, date, and effective window (time as fallback if no window). */
export function formatOptimizeSmsToWhen(fields: ScheduleOptimizeSmsFields): string {
  const day = weekdayDate(fields.toDate, fields.practiceTz, fields.newStartIso);
  const win = windowPart(fields.toWindowLabel);
  if (win) return `${day} ${win}`;
  const time = clockLabel(fields.toTimeLabel, fields.newStartIso, fields.practiceTz);
  return time ? `${day} at ${time}` : day;
}

export function buildScheduleOptimizeSmsMessage(
  kind: ScheduleOptimizeSmsKind,
  fields: ScheduleOptimizeSmsFields
): string {
  const pets = petsAppointmentPhrase(fields.petNames);
  const toWhen = formatOptimizeSmsToWhen(fields);
  if (kind === 'moved') {
    return `Hi it's Vet At Your Door. We've moved ${pets} to ${toWhen}. Thank you for your flexibility!`;
  }
  const fromWhen = formatOptimizeSmsFromWhen(fields);
  return `Hi it's Vet At Your Door. We were wondering if it was at all possible to move ${pets} from ${fromWhen} to ${toWhen}. Can you let us know?`;
}
