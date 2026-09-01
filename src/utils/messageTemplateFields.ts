import { firstNameFromDisplayName } from './clientNamePrefix';

export type MessageChannel = 'email' | 'sms' | 'both';
export type MessageCategory = 'clinical' | 'billing' | 'scheduling' | 'general' | 'system';

export type MergeField = {
  id: string;
  label: string;
  group: 'Client' | 'Patient' | 'Pronouns' | 'Clinic' | 'Visit';
  sample: string;
};

/**
 * Fields staff can nest in a template, then generate before send.
 * Never add client connection notes (or any other internal household notes) here.
 */
export const MERGE_FIELDS: MergeField[] = [
  { id: 'client_first_name', label: 'Client first name', group: 'Client', sample: 'Sarah' },
  { id: 'client_last_name', label: 'Client last name', group: 'Client', sample: 'Johnson' },
  { id: 'client_full_name', label: 'Client full name', group: 'Client', sample: 'Sarah Johnson' },
  { id: 'patient_name', label: 'Patient name', group: 'Patient', sample: 'Fluffy' },
  { id: 'pets', label: 'Pet name(s)', group: 'Patient', sample: 'Fluffy' },
  { id: 'species', label: 'Species', group: 'Patient', sample: 'dog' },
  { id: 'he_she', label: 'he/she', group: 'Pronouns', sample: 'he' },
  { id: 'him_her', label: 'him/her', group: 'Pronouns', sample: 'him' },
  { id: 'his_her', label: 'his/her', group: 'Pronouns', sample: 'his' },
  { id: 'He_She', label: 'He/She', group: 'Pronouns', sample: 'He' },
  { id: 'have_has', label: 'has/have', group: 'Pronouns', sample: 'has' },
  { id: 'doctor_last_name', label: 'Doctor last name', group: 'Clinic', sample: 'Frey' },
  { id: 'clinic_name', label: 'Clinic name', group: 'Clinic', sample: 'Vet At Your Door' },
  { id: 'clinic_phone', label: 'Clinic phone', group: 'Clinic', sample: '(215) 555-0100' },
  { id: 'today', label: "Today's date", group: 'Visit', sample: 'Monday, August 31' },
  { id: 'date_label', label: 'Visit date', group: 'Visit', sample: 'Tuesday, September 2' },
  { id: 'window_start', label: 'Window start', group: 'Visit', sample: '10:00 AM' },
  { id: 'window_end', label: 'Window end', group: 'Visit', sample: '12:00 PM' },
  { id: 'minutes_away', label: 'Minutes away', group: 'Visit', sample: '15' },
  { id: 'tech_first_name', label: 'Technician first name', group: 'Visit', sample: 'Alex' },
  { id: 'timeframe', label: 'Follow-up timeframe', group: 'Visit', sample: 'the next 2–3 weeks' },
  { id: 'hold_deadline', label: 'Hold deadline', group: 'Visit', sample: '5:00 PM today' },
  { id: 'amount', label: 'Amount due', group: 'Visit', sample: '$128.40' },
  { id: 'invoice_labels', label: 'Invoice label', group: 'Visit', sample: 'Invoice 1042' },
  { id: 'invoice_total', label: 'Invoice total', group: 'Visit', sample: '$128.40' },
  { id: 'pay_link', label: 'Pay link', group: 'Visit', sample: 'https://pay.example.com/abc' },
  { id: 'pay_button', label: 'Pay now button', group: 'Visit', sample: '<a href="#">Pay Now</a>' },
  { id: 'invoice_html', label: 'Invoice in email', group: 'Visit', sample: '<table><tr><td>Exam</td><td>$128.40</td></tr></table>' },
  { id: 'ledger_html', label: 'Ledger in email', group: 'Visit', sample: '<table><tr><td>Invoice 20</td><td>$82.40</td></tr></table>' },
];

export const MERGE_FIELD_GROUPS = ['Client', 'Patient', 'Pronouns', 'Clinic', 'Visit'] as const;

export type MergeValues = Partial<Record<string, string | null | undefined>>;

export function tokenFor(id: string): string {
  return `{{${id}}}`;
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function applyMergeFields(
  text: string,
  values: MergeValues,
  missing: 'blank' | 'keep' = 'blank',
): string {
  return text.replace(TOKEN_RE, (full, id: string) => {
    const raw = values[id];
    if (raw != null && String(raw).trim()) return String(raw);
    return missing === 'keep' ? full : '';
  });
}

export function hasMergeTokens(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}

export function sampleMergeValues(): MergeValues {
  const out: MergeValues = {};
  for (const f of MERGE_FIELDS) out[f.id] = f.sample;
  return out;
}

export function pronounsFromSex(sex: string | null | undefined): {
  he_she: string;
  him_her: string;
  his_her: string;
  He_She: string;
} {
  const s = (sex ?? '').toLowerCase();
  const female = /\b(f|fs|fi|female|bitch|spay)/i.test(s) && !/\bmale\b/.test(s);
  const male = /\b(m|mn|mi|cm|male|neut)/i.test(s) && !female;
  if (female) return { he_she: 'she', him_her: 'her', his_her: 'her', He_She: 'She' };
  if (male) return { he_she: 'he', him_her: 'him', his_her: 'his', He_She: 'He' };
  return { he_she: 'they', him_her: 'them', his_her: 'their', He_She: 'They' };
}

const DEFAULT_CLINIC = 'Vet At Your Door';

export function withClinicDefaults(values: MergeValues): MergeValues {
  return {
    clinic_name: DEFAULT_CLINIC,
    clinic_phone: '(207) 536-8387',
    today: new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
    ...values,
  };
}

export function mergeValuesFromNames(opts: {
  clientFirstName?: string | null;
  clientLastName?: string | null;
  clientFullName?: string | null;
  patientName?: string | null;
  species?: string | null;
  sex?: string | null;
  doctorLastName?: string | null;
}): MergeValues {
  const full =
    opts.clientFullName?.trim() ||
    [opts.clientFirstName, opts.clientLastName].filter(Boolean).join(' ').trim();
  const first =
    firstNameFromDisplayName(opts.clientFirstName) ||
    firstNameFromDisplayName(full) ||
    '';
  const last = opts.clientLastName?.trim() || full.split(/\s+/).slice(1).join(' ');
  const patient = opts.patientName?.trim() || '';
  return withClinicDefaults({
    client_first_name: first || 'there',
    client_last_name: last,
    client_full_name: full,
    patient_name: patient,
    pets: patient || 'your pet',
    species: opts.species?.trim() || '',
    have_has: 'has',
    doctor_last_name: opts.doctorLastName?.trim() || '',
    ...pronounsFromSex(opts.sex),
  });
}
