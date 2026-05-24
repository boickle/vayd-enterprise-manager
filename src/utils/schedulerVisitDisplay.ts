import { DateTime } from 'luxon';
import { truthyApiFlag } from '../api/appointments';
import type { Provider } from '../api/employee';
import type { Appointment, Client, Patient } from '../api/roomLoader';
import { patientsForAppointment } from './schedulerAddPet';

export function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function clientLabel(c: Appointment['client']): string {
  if (!c) return '—';
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.join(' ').trim() || '—';
}

export function fullClientHouseholdName(c: Client | undefined): string {
  if (!c) return '—';
  const primary = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  const second = [c.secondFirstName, c.secondLastName].filter(Boolean).join(' ').trim();
  if (primary && second) return `${primary} · ${second}`;
  return primary || second || '—';
}

export function providerLabel(p: Appointment['primaryProvider']): string {
  if (!p) return '—';
  const fromParts = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  if (fromParts) return fromParts;
  const o = p as { name?: string | null };
  return pickStr(o.name) || '—';
}

export function clientAddressOneLine(c: Client | undefined): string | null {
  if (!c) return null;
  const line1 = pickStr(c.address1);
  const line2 = pickStr(c.address2);
  const cityState = [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ');
  const zip = pickStr(c.zipcode);
  const tail = [cityState, zip].filter(Boolean).join(cityState && zip ? ' ' : '');
  const parts = [line1, line2, tail].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function clientPhonesLine(c: Client | undefined): string | null {
  if (!c) return null;
  const parts = [pickStr(c.phone1), pickStr(c.phone2)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function clientEmailsLine(c: Client | undefined): string | null {
  if (!c) return null;
  const parts = [pickStr(c.email), pickStr(c.secondEmail)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function clientAddressMultiline(c: Client | undefined): string | null {
  if (!c) return null;
  const line1 = pickStr(c.address1);
  const line2 = pickStr(c.address2);
  const cityState = [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ');
  const zip = pickStr(c.zipcode);
  const line3 = [cityState, zip].filter(Boolean).join(cityState && zip ? ' ' : '');
  const lines = [line1, line2, line3].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

export function googleMapsUrlForAppointment(a: Appointment): string | null {
  const c = a.client;
  if (!c) return null;
  if (typeof c.lat === 'number' && typeof c.lon === 'number') {
    return `https://www.google.com/maps?q=${c.lat},${c.lon}`;
  }
  const line = clientAddressOneLine(c);
  if (!line) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`;
}

export function patientBreedDisplayOnly(p: Patient): string | null {
  return pickStr(p.breedEntity?.name) ?? pickStr(p.breed) ?? null;
}

export function patientSexAbbrevDisplay(p: Patient): string | null {
  const raw = pickStr(p.sex)?.trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s._-]+/g, '').toLowerCase();
  if (compact === 'fs' || compact === 'sf') return 'FS';
  if (compact === 'fi') return 'FI';
  if (compact === 'mn') return 'MN';
  if (compact === 'mi') return 'MI';
  if (compact === 'cm') return 'CM';
  if (compact === 'f') return 'F';
  if (compact === 'm') return 'M';
  const s = raw.toLowerCase();
  const spayed = s.includes('spayed') || /\bspay\b/.test(s);
  const neutered = s.includes('neutered') || s.includes('castrat') || /\bneuter\b/.test(s);
  if (s.includes('female') || s.includes('bitch') || s.includes('queen')) {
    return spayed ? 'FS' : 'FI';
  }
  if (s.includes('male') && !s.includes('female')) {
    return neutered ? 'MN' : 'MI';
  }
  if (spayed && !s.includes('male')) return 'FS';
  if (neutered && !s.includes('female')) return 'MN';
  if (raw.length <= 4 && /^[A-Za-z]+$/i.test(raw)) return raw.toUpperCase();
  return null;
}

export function patientAgeYearsMonthsDisplay(p: Patient, practiceTz: string): string | null {
  const dobIso = pickStr(p.dob);
  if (!dobIso) return null;
  const birth = DateTime.fromISO(dobIso);
  if (!birth.isValid) return null;
  const ref = DateTime.now().setZone(practiceTz).startOf('day');
  const b = birth.setZone(practiceTz).startOf('day');
  if (!b.isValid || ref < b) return null;
  let years = ref.year - b.year;
  let months = ref.month - b.month;
  const dayDiff = ref.day - b.day;
  if (dayDiff < 0) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0 || (years === 0 && months < 0)) return null;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (parts.length > 0) return parts.join(' ');
  const ageDays = Math.floor(ref.diff(b, 'days').days);
  if (ageDays < 0) return null;
  if (ageDays < 7) return ageDays <= 0 ? '<1d' : `${ageDays}d`;
  const w = Math.floor(ageDays / 7);
  return `${Math.max(1, w)}w`;
}

export function patientSpeciesIconKind(p: Patient): 'dog' | 'cat' | null {
  const spec = (pickStr(p.speciesEntity?.name) ?? pickStr(p.species) ?? '').toLowerCase();
  if (!spec) return null;
  if (spec.includes('canine') || spec.includes('dog')) return 'dog';
  if (spec.includes('feline') || spec.includes('cat')) return 'cat';
  return null;
}

export function patientSexHighlightTone(p: Patient): 'male' | 'female' | 'neutral' {
  const raw = (pickStr(p.sex) ?? '').trim();
  if (!raw) return 'neutral';
  const compact = raw.replace(/[\s._-]+/g, '').toLowerCase();
  if (compact === 'fs' || compact === 'fi' || compact === 'sf' || compact === 'f') return 'female';
  if (compact === 'mn' || compact === 'mi' || compact === 'm') return 'male';
  const s = raw.toLowerCase();
  if (s.includes('female') || s.includes('bitch') || s.includes('queen')) return 'female';
  if (s.includes('male') && !s.includes('female')) return 'male';
  if (s.includes('spayed') || /\bspay\b/.test(s)) return 'female';
  if (s.includes('neutered') || s.includes('castrat') || /\bneuter\b/.test(s)) return 'male';
  return 'neutral';
}

export function patientLastWeightDisplay(p: Patient): string | null {
  const o = p as unknown as Record<string, unknown>;
  const raw =
    p.weight ??
    p.lastWeight ??
    p.weightLbs ??
    p.lastWeightLbs ??
    o.lastRecordedWeight ??
    o.last_weight ??
    o.weight_lbs;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const hasUnit = /\b(kg|lbs?)\b/i.test(s) || s.includes('/');
  const weightPart = hasUnit ? s : `${s} lbs`;
  const dateRaw =
    pickStr(p.lastWeightDate ?? undefined) ??
    pickStr(p.weightDate ?? undefined) ??
    pickStr(o.lastWeightDate as string | undefined) ??
    pickStr(o.last_weight_date as string | undefined);
  if (dateRaw) {
    const d = DateTime.fromISO(dateRaw);
    if (d.isValid) return `${weightPart} (${d.toFormat('M/d/yyyy')})`;
  }
  return weightPart;
}

function providerNameWithSignatorySuffix(args: {
  firstName?: string | null;
  lastName?: string | null;
  designation?: string | null;
  title?: string | null;
}): string | null {
  const name = [pickStr(args.firstName), pickStr(args.lastName)].filter(Boolean).join(' ').trim();
  if (!name) return null;
  const suffix = pickStr(args.designation) ?? pickStr(args.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function primaryProviderFromPatientRecord(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const flat =
    pickStr(o.primaryProviderName) ??
    pickStr(o.primaryProviderFullName) ??
    pickStr(o.primaryCareProviderName) ??
    pickStr(o.pimsPrimaryProviderName) ??
    pickStr(o.primary_provider_name);
  if (flat) return flat;

  const raw =
    o.primaryProvider ??
    o.primary_provider ??
    o.primaryCareProvider ??
    o.employee;
  if (!raw || typeof raw !== 'object') return null;
  const pr = raw as Record<string, unknown>;
  const first = pickStr(pr.firstName);
  const last = pickStr(pr.lastName);
  const byParts = [first, last].filter(Boolean).join(' ').trim();
  if (byParts) {
    return providerNameWithSignatorySuffix({
      firstName: first,
      lastName: last,
      designation: pickStr(pr.designation),
      title: pickStr(pr.title),
    });
  }
  const composed =
    pickStr(pr.name) ?? pickStr(pr.fullName) ?? pickStr(pr.displayName) ?? '';
  if (!composed) return null;
  const suffix = pickStr(pr.designation) ?? pickStr(pr.credentials) ?? pickStr(pr.title);
  if (suffix && !composed.toLowerCase().includes(suffix.toLowerCase())) return `${composed}, ${suffix}`;
  return composed;
}

function patientPrimaryProviderDisplay(p: Patient, appt: Appointment): string | null {
  const fromPet = primaryProviderFromPatientRecord(p);
  if (fromPet) return fromPet;
  const sing = appt.patient;
  if (sing && String(sing.id) === String(p.id)) {
    return primaryProviderFromPatientRecord(sing);
  }
  return null;
}

function labelFromAppointmentPatientPrimaryProvider(
  ref: Appointment['patientPrimaryProvider'] | null | undefined
): string | null {
  if (!ref) return null;
  return providerNameWithSignatorySuffix({
    firstName: ref.firstName,
    lastName: ref.lastName,
    designation: ref.designation,
    title: ref.title,
  });
}

function findProviderRowForChartPcp(
  providers: readonly Provider[] | undefined,
  ref: NonNullable<Appointment['patientPrimaryProvider']>
): Provider | null {
  if (!providers?.length) return null;
  const rid = ref.id;
  if (rid == null || !Number.isFinite(Number(rid))) return null;
  const n = Number(rid);
  return (
    providers.find((p) => Number(p.id) === n) ??
    providers.find((p) => p.pimsId != null && Number(p.pimsId) === n) ??
    providers.find((p) => String(p.id) === String(rid)) ??
    null
  );
}

function providerLabelFormalFromProviderRow(p: Provider): string | null {
  const name =
    [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim() || pickStr(p.name);
  if (!name) return null;
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function chartPrimaryProviderLabelFromRefAndProviders(
  ref: Appointment['patientPrimaryProvider'] | null | undefined,
  providers: readonly Provider[] | undefined
): string | null {
  if (!ref) return null;
  const row = findProviderRowForChartPcp(providers, ref);
  if (!row) return null;
  return providerLabelFormalFromProviderRow(row);
}

export function appointmentPatientChartPrimaryProviderLabel(
  appt: Appointment,
  providers?: readonly Provider[] | null
): string | null {
  const fromEmployees = chartPrimaryProviderLabelFromRefAndProviders(
    appt.patientPrimaryProvider,
    providers ?? undefined
  );
  if (fromEmployees) return fromEmployees;
  const fromDoctor = labelFromAppointmentPatientPrimaryProvider(appt.patientPrimaryProvider);
  if (fromDoctor) return fromDoctor;
  for (const p of patientsForAppointment(appt)) {
    const v = patientPrimaryProviderDisplay(p, appt);
    if (v) return v;
  }
  return null;
}

function primaryProviderLabelNameOnlyForCompare(label: string): string {
  const idx = label.indexOf(',');
  return (idx >= 0 ? label.slice(0, idx) : label).trim();
}

function appointmentNamesRoughlyEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function appointmentChartPrimaryProviderDiffersFromAssignee(
  appt: Appointment,
  chartLabel: string
): boolean {
  const assignee = providerLabel(appt.primaryProvider);
  if (!assignee || assignee === '—') return false;
  if (appointmentNamesRoughlyEqual(assignee, primaryProviderLabelNameOnlyForCompare(chartLabel)))
    return false;
  const aid = appt.primaryProvider?.id;
  const pref = appt.patientPrimaryProvider;
  if (aid != null && pref && Number(pref.id) === Number(aid)) return false;
  return true;
}

export function appointmentPatientMember(appt: Appointment): {
  isMember: boolean;
  membershipName: string | null;
} {
  const clin = appt.client as { isMember?: unknown; membershipName?: string | null } | undefined;

  let membershipName: string | null = null;
  let isMember = false;

  const consider = (flag: unknown, raw: unknown) => {
    if (truthyApiFlag(flag)) isMember = true;
    const name =
      typeof raw === 'string' && raw.trim()
        ? raw.trim()
        : raw != null && String(raw).trim()
          ? String(raw).trim()
          : null;
    if (name) {
      isMember = true;
      if (!membershipName) membershipName = name;
    }
  };

  consider(appt.isMember, appt.membershipName);
  consider(clin?.isMember, clin?.membershipName);
  for (const p of patientsForAppointment(appt)) {
    consider(p.isMember, p.membershipName);
  }

  return { isMember, membershipName };
}
