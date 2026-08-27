import { DateTime } from 'luxon';
import { appendCareOutreachSmsSuffix } from './careOutreachSmsMessage';

function firstName(clientDisplayName?: string | null): string {
  const full = clientDisplayName?.trim();
  if (full) return full.split(/\s+/).filter(Boolean)[0] || 'there';
  return 'there';
}

function petPhrase(names: readonly string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return 'your pet';
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
}

function providerLastName(doctorName?: string | null): string | null {
  const parts = (doctorName ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : null;
}

function slotPhrase(dateIso: string, timeLabel: string, practiceTz: string): string {
  const dt = DateTime.fromISO(dateIso, { zone: practiceTz });
  const day = dt.isValid ? dt.toFormat('cccc, LLL d') : dateIso;
  const time = timeLabel.trim();
  return time ? `${day} at ${time}` : day;
}

export function buildScheduleOptimizeSmsMessage(args: {
  client: string;
  petNames: readonly string[];
  doctorName: string;
  fromDate: string;
  toDate: string;
  fromTimeLabel: string;
  toTimeLabel: string;
  practiceTz: string;
  scope?: 'day' | 'week';
}): string {
  const name = firstName(args.client);
  const pets = petPhrase(args.petNames);
  const doctor = providerLastName(args.doctorName);
  const who = doctor ? `Dr. ${doctor}'s team at Vet At Your Door` : `Vet At Your Door`;
  const fromSlot = slotPhrase(args.fromDate, args.fromTimeLabel, args.practiceTz);
  const toSlot = slotPhrase(args.toDate, args.toTimeLabel, args.practiceTz);
  const sameDay = args.fromDate === args.toDate || args.scope === 'day';
  const body = sameDay
    ? `Hi ${name}, it's ${who}! We can see ${pets} at ${args.toTimeLabel.trim() || 'a better time'} instead of ${args.fromTimeLabel.trim() || 'the current time'} on ${DateTime.fromISO(args.toDate, { zone: args.practiceTz }).toFormat('cccc, LLL d')}, to stay in the neighborhood. Does that time work for you?`
    : `Hi ${name}, it's ${who}! We can move ${pets} from ${fromSlot} to ${toSlot}, when we'll already be in your neighborhood. Does that new time work for you?`;
  return appendCareOutreachSmsSuffix(body);
}
