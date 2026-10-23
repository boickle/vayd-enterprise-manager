import { DateTime } from 'luxon';
import jsPDF from 'jspdf';
import { fetchAllEmployees, type Employee } from '../api/appointmentSettings';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { fetchPatientByIdStaff, fetchPatientMedicalRecordStaff } from '../api/patients';
import { getPracticeSettings } from '../api/practiceSettings';
import { formatClientDisplayName } from './clientNamePrefix';
import { pickStr } from './schedulerVisitDisplay';
import { patientSexDisplayFromRecord } from './schedulerVisitDisplay';
import { loadPracticeLetterhead, type PracticeLetterhead } from './practiceLetterhead';

export type PatientDocKind =
  | 'rabies'
  | 'vaccination'
  | 'health'
  | 'vaccineCat'
  | 'vaccineDog'
  | 'litterCheck'
  | 'rx'
  | 'death'
  | 'spayNeuter';

export const LITTER_CHECK_SYSTEMS = [
  'mm/CRT',
  'Mouth/Nose/Throat',
  'Ears',
  'CV',
  'Resp',
  'Abdomen',
  'Urogen',
  'M/S',
  'Integ',
  'Neuro',
] as const;

export type LitterCheckMark = '' | 'normal' | 'abnormal';

export type LitterCheckSystemRow = {
  id: string;
  label: string;
  mark: LitterCheckMark;
};

export function defaultLitterCheckSystems(): LitterCheckSystemRow[] {
  return LITTER_CHECK_SYSTEMS.map((label) => ({
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label,
    mark: '',
  }));
}

export const PATIENT_DOC_KINDS: {
  id: PatientDocKind;
  title: string;
  blurb: string;
  editable: boolean;
}[] = [
  {
    id: 'rabies',
    title: 'Rabies certificate',
    blurb: 'Town / boarding certificate for the latest rabies dose.',
    editable: false,
  },
  {
    id: 'vaccination',
    title: 'Vaccination certificate',
    blurb: 'Current vaccines with dates and expiration.',
    editable: false,
  },
  {
    id: 'health',
    title: 'Domestic health certificate',
    blurb: 'Travel / boarding health letter signed by the doctor.',
    editable: false,
  },
  {
    id: 'vaccineCat',
    title: 'Vaccine template — cat',
    blurb: 'Blank kitten vaccine / preventatives grid the doctor can edit.',
    editable: true,
  },
  {
    id: 'vaccineDog',
    title: 'Vaccine template — dog',
    blurb: 'Blank puppy vaccine / preventatives grid the doctor can edit.',
    editable: true,
  },
  {
    id: 'rx',
    title: 'Prescription print',
    blurb: 'A written Rx the owner can take to another pharmacy.',
    editable: true,
  },
  {
    id: 'litterCheck',
    title: 'Litter check exam',
    blurb: 'Fill in findings per puppy or kitten, or print blank to complete by hand.',
    editable: true,
  },
  {
    id: 'death',
    title: 'Death certificate',
    blurb: 'Official record of date, cause, and attending veterinarian.',
    editable: false,
  },
  {
    id: 'spayNeuter',
    title: 'Spay / neuter certificate',
    blurb: 'Sterilization certificate for licensing or rescue.',
    editable: false,
  },
];

export const VACCINE_PLAN_WEEKS = ['8 weeks', '12 weeks', '16 weeks', '20 weeks', '24 weeks'] as const;

export type VaccinePlanRow = {
  id: string;
  label: string;
  weeks: boolean[];
};

const CAT_VACCINE_PLAN_ROWS = [
  'Doctor Visit',
  'Tech Visit',
  'FVRCP vaccine (Feline Distemper)',
  'FeLV (Feline Leukemia vaccine) — recommended for indoor and outdoor cats',
  'Rabies Vaccine',
  'Flea/Tick Preventative (Frontline Tritak or similar topical given monthly)*',
  'Stool Sample Check',
];

const DOG_VACCINE_PLAN_ROWS = [
  'Doctor Visit',
  'Tech Visit',
  'Bordetella Intranasal Vaccine',
  'Distemper/Adenovirus/Parvovirus Vaccine',
  'Lyme/Leptospirosis Combo Vaccine',
  'Rabies Vaccine',
  'Heartworm/Tick Test (can be combined with spay/neuter)',
  'Heartworm / GI parasite Preventative (Interceptor)*',
  'Flea/Tick Preventative (Activyl Tick Plus — topical given monthly)*',
  'Flea/Tick Preventative (Bravecto — oral treat every 3 months)*',
  'Stool Sample Check',
];

function emptyWeekMarks(): boolean[] {
  return VACCINE_PLAN_WEEKS.map(() => false);
}

export function defaultVaccinePlanRows(kind: 'vaccineCat' | 'vaccineDog'): VaccinePlanRow[] {
  const labels = kind === 'vaccineCat' ? CAT_VACCINE_PLAN_ROWS : DOG_VACCINE_PLAN_ROWS;
  return labels.map((label, i) => ({
    id: `${kind}-${i}`,
    label,
    weeks: emptyWeekMarks(),
  }));
}

export function newVaccinePlanRow(): VaccinePlanRow {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: '',
    weeks: emptyWeekMarks(),
  };
}

export function defaultVaccinePlanNote(kind: 'vaccineCat' | 'vaccineDog'): string {
  if (kind === 'vaccineCat') {
    return 'If no vaccines need to be given, you can get preventatives (Frontline Tritak, Seresto collar, etc.) through our online store. Sign up, choose what you need, set Autoship, and shipping is free. If you want us to set it up, just call us.';
  }
  return 'If no vaccines need to be given or heartworm/tick test taken, you can get preventatives (Activyl Tick Plus, Bravecto, and/or Interceptor) through our online store. Sign up, choose what you need, set Autoship, and shipping is free. If you want us to set it up, just call us.';
}

export function documentIsEditable(kind: PatientDocKind): boolean {
  return PATIENT_DOC_KINDS.find((k) => k.id === kind)?.editable === true;
}

export type VaccineRowDraft = {
  id: string;
  name: string;
  date: string;
  expires: string;
  lot: string;
  manufacturer: string;
  included: boolean;
};

export type PatientDocDraft = {
  clientId: string;
  clientName: string;
  address: string;
  phone: string;
  patientId: string;
  patientName: string;
  species: string;
  breed: string;
  sex: string;
  color: string;
  birthday: string;
  birthdayDisplay: string;
  weight: string;
  microchip: string;
  tagNumber: string;
  vaccinationDate: string;
  serialNumber: string;
  expirationDate: string;
  vaccinationName: string;
  manufacturer: string;
  vaccineType: string;
  veterinarianName: string;
  veterinarianLicense: string;
  veterinarianEmployeeId: number | null;
  veterinarianSignaturePng: string | null;
  rxCompoundingReason: string;
  vaccineRows: VaccineRowDraft[];
  rxName: string;
  rxStrength: string;
  rxInstructions: string;
  rxQuantity: string;
  rxRefills: string;
  rxDate: string;
  rxNumber: string;
  dateOfDeath: string;
  causeOfDeath: string;
  mannerOfDeath: string;
  procedureName: string;
  surgeryDate: string;
  examDate: string;
  healthStatement: string;
  vaccinePlanKind: 'vaccineCat' | 'vaccineDog' | '';
  vaccinePlanDates: string[];
  vaccinePlanRows: VaccinePlanRow[];
  vaccinePlanNote: string;
  litterWeight: string;
  litterAttitude: string;
  litterSystems: LitterCheckSystemRow[];
  litterAssessment: string;
  litterPlan: string;
};

export type PatientDocProvider = {
  id: number;
  label: string;
  license: string;
  active: boolean;
};

export type PatientDocSource = {
  rabiesLogs: Record<string, unknown>[];
  providers: PatientDocProvider[];
  signatures: Record<string, string>;
  primaryProviderId: number | null;
};

export type PatientDocContext = {
  draft: PatientDocDraft;
  source: PatientDocSource;
  letterhead: PracticeLetterhead;
};

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function isoDateInput(value: unknown): string {
  const raw = pickStr(value);
  if (!raw) return '';
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = DateTime.fromISO(raw);
  return parsed.isValid ? parsed.toFormat('yyyy-LL-dd') : '';
}

export function formatDocDate(value: string | null | undefined): string {
  if (!value) return '';
  const iso = value.slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? DateTime.fromISO(iso)
    : DateTime.fromISO(value);
  return parsed.isValid ? parsed.toFormat('M/d/yyyy') : value;
}

export function formatBirthdayWithAge(iso: string | null | undefined): string {
  if (!iso) return '';
  const birth = DateTime.fromISO(iso);
  if (!birth.isValid) return iso;
  const now = DateTime.now().startOf('day');
  const b = birth.startOf('day');
  if (now < b) return birth.toFormat('M/d/yyyy');
  const days = Math.floor(now.diff(b, 'days').days);
  const date = birth.toFormat('M/d/yyyy');
  if (days < 365) {
    const weeks = Math.floor(days / 7);
    const rem = days % 7;
    const weekBit = `${weeks} week${weeks === 1 ? '' : 's'}`;
    return rem ? `${date} (${weekBit} ${rem} day${rem === 1 ? '' : 's'})` : `${date} (${weekBit})`;
  }
  const years = Math.floor(now.diff(b, 'years').years);
  return `${date} (${years} year${years === 1 ? '' : 's'})`;
}

function formatClientAddress(c: Record<string, unknown>): string {
  const street = [pickStr(c.address1) ?? pickStr(c.addressLine1), pickStr(c.address2) ?? pickStr(c.addressLine2)]
    .filter(Boolean)
    .join(', ');
  const cityLine = [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ');
  const zip = pickStr(c.zip) ?? pickStr(c.zipcode);
  return [street, [cityLine, zip].filter(Boolean).join(' ')].filter(Boolean).join('\n');
}

function formatSexShort(record: Record<string, unknown>): string {
  const display = patientSexDisplayFromRecord(record) ?? pickStr(record.sex) ?? '';
  const u = display.toLowerCase();
  if (u.startsWith('f') || u.includes('female')) return display.length <= 3 ? display : 'F';
  if (u.startsWith('m') || u.includes('male')) return display.length <= 3 ? display : 'M';
  return display;
}

function vaccineNameFromLog(log: Record<string, unknown>): string {
  const inv = asObj(log.inventoryItem) ?? asObj(asObj(log.treatmentItem)?.inventoryItem);
  return (
    pickStr(log.vaccineName) ??
    pickStr(log.name) ??
    pickStr(inv?.name) ??
    pickStr(asObj(asObj(log.treatmentItem)?.procedure)?.name) ??
    'Vaccination'
  );
}

function isRabiesName(name: string): boolean {
  return /\brabies\b/i.test(name);
}

function sortLogsNewest(logs: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...logs].sort((a, b) => {
    const da = Date.parse(String(a.dateVaccinated ?? a.serviceDate ?? '')) || 0;
    const db = Date.parse(String(b.dateVaccinated ?? b.serviceDate ?? '')) || 0;
    return db - da;
  });
}

function employeeLabel(e: Employee): string {
  const name = [e.firstName, e.lastName].filter(Boolean).join(' ').trim();
  const des = (e.designation ?? e.title ?? '').trim();
  return des ? `${name}, ${des}` : name;
}

function emptyDraft(): PatientDocDraft {
  return {
    clientId: '',
    clientName: '',
    address: '',
    phone: '',
    patientId: '',
    patientName: '',
    species: '',
    breed: '',
    sex: '',
    color: '',
    birthday: '',
    birthdayDisplay: '',
    weight: '',
    microchip: '',
    tagNumber: '',
    vaccinationDate: '',
    serialNumber: '',
    expirationDate: '',
    vaccinationName: 'Rabies',
    manufacturer: '',
    vaccineType: '',
    veterinarianName: '',
    veterinarianLicense: '',
    veterinarianEmployeeId: null,
    veterinarianSignaturePng: null,
    vaccineRows: [],
    rxName: '',
    rxStrength: '',
    rxInstructions: '',
    rxQuantity: '',
    rxRefills: '0',
    rxCompoundingReason: 'Reason for compounding is compliance and ease of administration.',
    rxDate: DateTime.now().toFormat('yyyy-LL-dd'),
    rxNumber: '',
    dateOfDeath: '',
    causeOfDeath: '',
    mannerOfDeath: 'Euthanasia',
    procedureName: '',
    surgeryDate: DateTime.now().toFormat('yyyy-LL-dd'),
    examDate: DateTime.now().toFormat('yyyy-LL-dd'),
    healthStatement: '',
    vaccinePlanKind: '',
    vaccinePlanDates: VACCINE_PLAN_WEEKS.map(() => ''),
    vaccinePlanRows: [],
    vaccinePlanNote: '',
    litterWeight: '',
    litterAttitude: '',
    litterSystems: defaultLitterCheckSystems(),
    litterAssessment: '',
    litterPlan: '',
  };
}

function pronounPair(sex: string): { they: string; their: string } {
  const u = sex.toLowerCase();
  if (u.startsWith('f') || u.includes('female')) return { they: 'She', their: 'her' };
  if (u.startsWith('m') || u.includes('male')) return { they: 'He', their: 'his' };
  return { they: 'This patient', their: 'their' };
}

export function defaultHealthStatement(draft: PatientDocDraft): string {
  const name = draft.patientName.trim() || 'This patient';
  const { they, their } = pronounPair(draft.sex);
  const subject = they === 'This patient' ? 'This patient' : they;
  return `${name} has been examined by me on this date and appears to be free of any communicable and contagious diseases and is in good health. ${subject} is up to date on ${their} vaccinations.`;
}

function applyRabiesLog(draft: PatientDocDraft, log: Record<string, unknown> | null): PatientDocDraft {
  if (!log) return draft;
  const name = vaccineNameFromLog(log);
  return {
    ...draft,
    tagNumber: pickStr(log.tagNumber) ?? draft.tagNumber,
    vaccinationDate: isoDateInput(log.dateVaccinated) || draft.vaccinationDate,
    serialNumber: pickStr(log.serialNumber) ?? pickStr(log.lotNumber) ?? draft.serialNumber,
    expirationDate:
      isoDateInput(log.nextVaccinationDate) || isoDateInput(log.vaccineExpiration) || draft.expirationDate,
    vaccinationName: name || draft.vaccinationName,
    manufacturer: pickStr(log.manufacturer) ?? draft.manufacturer,
    vaccineType: pickStr(log.vaccineType) ?? draft.vaccineType,
    weight: pickStr(log.weight) ? `${pickStr(log.weight)} LBS` : draft.weight,
  };
}

function namesRoughlyEqual(a: string, b: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const left = clean(a);
  const right = clean(b);
  return Boolean(left && right && (left === right || left.startsWith(right) || right.startsWith(left)));
}

function signatureFor(signatures: Record<string, string>, id: number | null): string | null {
  if (id == null) return null;
  const value = signatures[String(id)];
  return value?.startsWith('data:image/') ? value : null;
}

export function applyProvider(
  draft: PatientDocDraft,
  providers: PatientDocProvider[],
  id: string,
  signatures: Record<string, string> = {},
): PatientDocDraft {
  if (!id) {
    return {
      ...draft,
      veterinarianName: '',
      veterinarianLicense: '',
      veterinarianEmployeeId: null,
      veterinarianSignaturePng: null,
    };
  }
  const p = providers.find((x) => String(x.id) === id);
  if (!p) return draft;
  return {
    ...draft,
    veterinarianName: p.label,
    veterinarianLicense: p.license,
    veterinarianEmployeeId: p.id,
    veterinarianSignaturePng: signatureFor(signatures, p.id),
  };
}

function performerFromRabiesLog(
  log: Record<string, unknown> | null,
  providers: PatientDocProvider[],
): PatientDocProvider | null {
  if (!log) return null;
  const emp = asObj(log.employee);
  const empId = emp?.id != null ? Number(emp.id) : NaN;
  if (Number.isFinite(empId)) {
    const match = providers.find((p) => p.id === empId);
    if (match) return match;
    const name = [pickStr(emp?.firstName), pickStr(emp?.lastName)].filter(Boolean).join(' ').trim();
    return {
      id: empId,
      label: name || pickStr(log.veterinarianName) || `Provider #${empId}`,
      license: pickStr(emp?.licenseNumber) ?? pickStr(log.veterinarianLicense) ?? '',
      active: emp?.isActive !== false && emp?.isDeleted !== true,
    };
  }
  const named = pickStr(log.veterinarianName);
  if (!named) return null;
  return providers.find((p) => namesRoughlyEqual(p.label, named)) ?? null;
}

export function applyRabiesSource(
  draft: PatientDocDraft,
  source: PatientDocSource,
  id: string,
): PatientDocDraft {
  const log = source.rabiesLogs.find((l) => String(l.id) === id) ?? null;
  let next = applyRabiesLog(draft, log);
  const performer = performerFromRabiesLog(log, source.providers);
  if (performer?.active) {
    next = applyProvider(next, source.providers, String(performer.id), source.signatures);
  } else {
    next = applyProvider(next, source.providers, '', source.signatures);
  }
  return next;
}

export function applyKindDefaults(kind: PatientDocKind, draft: PatientDocDraft, source: PatientDocSource): PatientDocDraft {
  let next = draft;
  if (kind === 'rabies') {
    const firstId = source.rabiesLogs[0]?.id;
    return applyRabiesSource(next, source, firstId != null ? String(firstId) : '');
  }
  if (kind === 'health') {
    next = {
      ...next,
      examDate: next.examDate || DateTime.now().toFormat('yyyy-LL-dd'),
      healthStatement: next.healthStatement.trim() || defaultHealthStatement(next),
    };
  }
  if (kind === 'litterCheck') {
    next = {
      ...next,
      examDate: next.examDate || DateTime.now().toFormat('yyyy-LL-dd'),
      litterSystems: next.litterSystems.length ? next.litterSystems : defaultLitterCheckSystems(),
    };
  }
  if (kind === 'vaccineCat' || kind === 'vaccineDog') {
    if (next.vaccinePlanKind !== kind || next.vaccinePlanRows.length === 0) {
      next = {
        ...next,
        vaccinePlanKind: kind,
        vaccinePlanDates: VACCINE_PLAN_WEEKS.map(() => ''),
        vaccinePlanRows: defaultVaccinePlanRows(kind),
        vaccinePlanNote: defaultVaccinePlanNote(kind),
      };
    }
  }
  const primary = source.primaryProviderId
    ? source.providers.find((p) => p.id === source.primaryProviderId && p.active)
    : null;
  if (primary) return applyProvider(next, source.providers, String(primary.id), source.signatures);
  return applyProvider(next, source.providers, '', source.signatures);
}

export async function loadPatientDocumentContext(patientId: number): Promise<PatientDocContext> {
  const [patientRaw, mr, letterhead, employees, settings] = await Promise.all([
    fetchPatientByIdStaff(patientId),
    fetchPatientMedicalRecordStaff(patientId).catch(() => null),
    loadPracticeLetterhead(),
    fetchAllEmployees().catch(() => [] as Employee[]),
    getPracticeSettings(Number(import.meta.env.VITE_PRACTICE_ID) || 1).catch(() => null),
  ]);
  const patient = asObj(patientRaw) ?? {};
  let client = asObj(patient.client) ?? (Array.isArray(patient.clients) ? asObj(patient.clients[0]) : null);
  const clientId = client?.id ?? patient.clientId;
  if (clientId != null && (!client || !(pickStr(client.address1) ?? pickStr(client.addressLine1)))) {
    const fetched = await fetchClientByIdStaff(Number(clientId)).catch(() => null);
    if (asObj(fetched)) client = asObj(fetched);
  }

  const logs = sortLogsNewest(
    (mr?.vaccinationLogs ?? []).map(asObj).filter((o): o is Record<string, unknown> => o != null),
  );
  const rabiesLogs = logs.filter((l) => isRabiesName(vaccineNameFromLog(l)));
  const latestByName = new Map<string, Record<string, unknown>>();
  for (const log of logs) {
    const key = vaccineNameFromLog(log).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!latestByName.has(key)) latestByName.set(key, log);
  }

  let signatures: Record<string, string> = {};
  try {
    const parsed = JSON.parse(String(settings?.['labels.providerSignatures'] || '{}'));
    if (parsed && typeof parsed === 'object') {
      signatures = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].startsWith('data:image/'),
        ),
      );
    }
  } catch {
    signatures = {};
  }

  const providers = employees
    .filter((e) => e && e.isDeleted !== true)
    .filter((e) => e.isProvider === true || Boolean(e.licenseNumber))
    .map((e) => ({
      id: e.id,
      label: employeeLabel(e),
      license: (e.licenseNumber ?? '').trim(),
      active: e.isActive !== false,
    }))
    .filter((e) => e.label)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label));

  const dob = pickStr(patient.dateOfBirth) ?? pickStr(patient.dob);
  const weightRaw = pickStr(patient.weight) ?? pickStr(patient.weightLbs);
  const neuter = pickStr(patient.neuterStatus) ?? '';
  const sexWord = (pickStr(patient.sex) ?? '').toLowerCase();
  const defaultProcedure =
    /spay/i.test(neuter) || sexWord.startsWith('f')
      ? 'Ovariohysterectomy (spay)'
      : /neuter/i.test(neuter) || sexWord.startsWith('m')
        ? 'Castration (neuter)'
        : 'Spay / neuter';

  let draft = emptyDraft();
  draft = {
    ...draft,
    clientId: clientId != null ? String(clientId) : '',
    clientName: client
      ? (() => {
          const named = formatClientDisplayName(client);
          return named && named !== 'Client' ? named : pickStr(client.name) ?? named;
        })()
      : '',
    address: client ? formatClientAddress(client) : '',
    phone: pickStr(client?.phone1) ?? pickStr(client?.phone) ?? pickStr(client?.mobilePhone) ?? '',
    patientId: String(patient.id ?? patientId),
    patientName: pickStr(patient.name) ?? `Patient ${patientId}`,
    species: pickStr(patient.species) ?? pickStr(patient.speciesName) ?? '',
    breed: pickStr(patient.breed) ?? pickStr(patient.breedDescription) ?? '',
    sex: formatSexShort(patient),
    color: pickStr(patient.color) ?? '',
    birthday: isoDateInput(dob),
    birthdayDisplay: formatBirthdayWithAge(dob),
    weight: weightRaw ? (/lb/i.test(weightRaw) ? weightRaw : `${weightRaw} LBS`) : '',
    microchip: pickStr(patient.microchip) ?? '',
    tagNumber: pickStr(patient.rabiesTag) ?? '',
    procedureName: defaultProcedure,
    vaccineRows: [...latestByName.values()].map((log, idx) => ({
      id: String(log.id ?? idx),
      name: vaccineNameFromLog(log),
      date: isoDateInput(log.dateVaccinated),
      expires: isoDateInput(log.nextVaccinationDate) || isoDateInput(log.vaccineExpiration),
      lot: pickStr(log.lotNumber) ?? pickStr(log.serialNumber) ?? '',
      manufacturer: pickStr(log.manufacturer) ?? '',
      included: true,
    })),
  };

  const primary = asObj(patient.primaryProvider);
  const primaryIdRaw = primary?.id ?? patient.primaryProviderId;
  const primaryId = primaryIdRaw != null ? Number(primaryIdRaw) : NaN;
  const source: PatientDocSource = {
    rabiesLogs,
    providers,
    signatures,
    primaryProviderId: Number.isFinite(primaryId) ? primaryId : null,
  };
  draft = applyKindDefaults('rx', draft, source);

  return {
    draft,
    source,
    letterhead,
  };
}

export function documentTitle(kind: PatientDocKind): string {
  return PATIENT_DOC_KINDS.find((k) => k.id === kind)?.title ?? 'Patient document';
}

export function documentFilename(kind: PatientDocKind, patientName: string): string {
  const slug = (patientName || 'patient').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
  const day = DateTime.now().toFormat('yyyy-LL-dd');
  const prefix: Record<PatientDocKind, string> = {
    rabies: 'Rabies_Certificate',
    vaccination: 'Vaccination_Certificate',
    health: 'Domestic_Health_Certificate',
    vaccineCat: 'Vaccine_Template_Cat',
    vaccineDog: 'Vaccine_Template_Dog',
    rx: 'Prescription',
    litterCheck: 'Litter_Check_Exam',
    death: 'Death_Certificate',
    spayNeuter: 'Spay_Neuter_Certificate',
  };
  return `${prefix[kind]}_${slug}_${day}.pdf`;
}

const TEAL: [number, number, number] = [15, 118, 110];
const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [75, 85, 99];
const RULE: [number, number, number] = [209, 213, 219];

function wrapLines(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize((text || '—').replace(/\s+\n/g, '\n'), width) as string[];
}

async function letterheadLogo(letterhead: PracticeLetterhead): Promise<string | null> {
  if (letterhead.logoDataUrl) return letterhead.logoDataUrl;
  try {
    const res = await fetch('/final_thick_lines_cropped.jpeg');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function logoFit(dataUrl: string, maxW: number, maxH: number): Promise<{ w: number; h: number }> {
  const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
  if (!size || !size.w || !size.h) return { w: maxW, h: maxH };
  const scale = Math.min(maxW / size.w, maxH / size.h);
  return { w: Math.round(size.w * scale), h: Math.round(size.h * scale) };
}

function drawHeader(
  doc: jsPDF,
  letterhead: PracticeLetterhead,
  logo: string | null,
  title: string,
  logoSize?: { w: number; h: number },
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  const lw = logoSize?.w ?? 72;
  const lh = logoSize?.h ?? 72;
  if (logo) {
    try {
      const format = logo.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(logo, format, margin, 28, lw, lh);
    } catch {
      try {
        doc.addImage(logo, logo.includes('image/png') ? 'JPEG' : 'PNG', margin, 28, lw, lh);
      } catch {
        /* skip broken logo */
      }
    }
  }
  doc.setTextColor(...TEAL);
  doc.setFont('times', 'bold');
  doc.setFontSize(13);
  const name = letterhead.name || 'Vet At Your Door';
  doc.text(name, pageW - margin, 38, { align: 'right' });
  doc.setFont('times', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const lines = [letterhead.address, letterhead.phone].filter(Boolean);
  let ay = 52;
  for (const line of lines) {
    for (const part of line.split(' · ')) {
      doc.text(part, pageW - margin, ay, { align: 'right' });
      ay += 13;
    }
  }
  const y = Math.max(28 + lh + 14, ay + 10);
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(1.6);
  doc.line(margin, y, pageW - margin, y);
  const titleY = y + 26;
  doc.setFont('times', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...TEAL);
  doc.text(title.toUpperCase(), pageW / 2, titleY, { align: 'center' });
  return titleY + 20;
}

function drawPair(
  doc: jsPDF,
  leftX: number,
  rightX: number,
  y: number,
  rows: Array<[string, string, string, string]>,
  colW: number,
): number {
  doc.setFontSize(10);
  for (const [ll, lv, rl, rv] of rows) {
    const leftLines = wrapLines(doc, lv || '—', colW - 8);
    const rightLines = wrapLines(doc, rv || '—', colW - 8);
    const h = Math.max(leftLines.length, rightLines.length) * 13 + 4;
    doc.setFont('times', 'bold');
    doc.setTextColor(...MUTED);
    if (ll) doc.text(`${ll}:`, leftX, y);
    if (rl) doc.text(`${rl}:`, rightX, y);
    doc.setFont('times', 'normal');
    doc.setTextColor(...INK);
    if (ll) doc.text(leftLines, leftX + 92, y);
    if (rl) doc.text(rightLines, rightX + 108, y);
    y += h;
  }
  return y;
}

function certValue(value: string): string {
  const t = (value || '').trim();
  if (!t || t === '0' || t === '—') return '—';
  return t;
}

function drawBoxedFields(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  title: string,
  fields: Array<{ label: string; value: string; half?: boolean }>,
): number {
  const pad = 12;
  type Line = Array<{ label: string; value: string }>;
  const lines: Line[] = [];
  let pending: { label: string; value: string } | null = null;
  for (const field of fields) {
    if (field.half) {
      if (pending) {
        lines.push([pending, { label: field.label, value: field.value }]);
        pending = null;
      } else {
        pending = { label: field.label, value: field.value };
      }
    } else {
      if (pending) {
        lines.push([pending]);
        pending = null;
      }
      lines.push([{ label: field.label, value: field.value }]);
    }
  }
  if (pending) lines.push([pending]);

  const innerW = w - pad * 2;
  const rowHeights = lines.map((line) => {
    const colW = innerW / line.length - 8;
    const tallest = Math.max(
      ...line.map((cell) => wrapLines(doc, certValue(cell.value), colW).length),
    );
    return 11 + tallest * 12 + 8;
  });
  const h = pad + 14 + rowHeights.reduce((sum, row) => sum + row, 0) + 4;
  doc.setFillColor(247, 251, 249);
  doc.setDrawColor(15, 118, 110);
  doc.setLineWidth(0.9);
  doc.roundedRect(x, y, w, h, 5, 5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...TEAL);
  doc.text(title.toUpperCase(), x + pad, y + pad + 8);

  let fy = y + pad + 22;
  lines.forEach((line, idx) => {
    const colW = innerW / line.length;
    line.forEach((cell, i) => {
      const cx = x + pad + i * colW;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(cell.label.toUpperCase(), cx, fy);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(wrapLines(doc, certValue(cell.value), colW - 8), cx, fy + 13);
    });
    fy += rowHeights[idx];
  });
  return y + h + 10;
}

function drawSignature(
  doc: jsPDF,
  y: number,
  vetName: string,
  license: string,
  png?: string | null,
  followContent = false,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const floor = pageH - 128;
  y = followContent ? Math.min(y + 22, floor) : Math.min(Math.max(y + 28, 600), floor);
  const x = pageW - margin - 240;
  if (png) {
    try {
      const format = png.includes('image/jpeg') || png.includes('image/jpg') ? 'JPEG' : 'PNG';
      doc.addImage(png, format, x, y - 46, 160, 42);
    } catch {
      /* skip broken signature */
    }
  }
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.8);
  doc.line(x, y, pageW - margin, y);
  doc.setFont('times', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text('Veterinarian signature', x, y + 14);
  doc.setFont('times', 'normal');
  doc.setTextColor(...INK);
  if (vetName) doc.text(vetName, x, y + 28);
  if (license) doc.text(`Lic. # ${license}`, x, y + 42);
  return y + 56;
}

export async function generatePatientDocumentPdf(
  kind: PatientDocKind,
  draft: PatientDocDraft,
  letterhead: PracticeLetterhead,
): Promise<Blob> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const logo = await letterheadLogo(letterhead);
  const logoSize = logo ? await logoFit(logo, 78, 78) : undefined;
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  const colW = (pageW - margin * 2 - 24) / 2;
  const leftX = margin;
  const rightX = margin + colW + 24;
  const heading =
    kind === 'health'
      ? 'Health Certificate'
      : kind === 'vaccineCat' || kind === 'vaccineDog'
        ? 'Vaccine / Preventatives Plan'
        : kind === 'litterCheck'
          ? 'Litter Check Exam'
          : documentTitle(kind);
  let y = drawHeader(doc, letterhead, logo, heading, logoSize);

  if (kind === 'rabies') {
    const boxW = pageW - margin * 2;
    y = drawBoxedFields(doc, margin, y, boxW, 'Owner', [
      { label: 'Name', value: draft.clientName },
      { label: 'Address', value: draft.address.replace(/\n/g, ', ') },
      { label: 'Phone', value: draft.phone, half: true },
      { label: 'Client ID', value: draft.clientId, half: true },
    ]);
    y = drawBoxedFields(doc, margin, y, boxW, 'Animal', [
      { label: 'Name', value: draft.patientName, half: true },
      { label: 'Patient ID', value: draft.patientId, half: true },
      { label: 'Species', value: draft.species, half: true },
      { label: 'Breed', value: draft.breed, half: true },
      { label: 'Sex', value: draft.sex, half: true },
      { label: 'Color', value: draft.color, half: true },
      { label: 'Age / birthday', value: draft.birthdayDisplay || formatDocDate(draft.birthday), half: true },
      { label: 'Weight', value: draft.weight, half: true },
      { label: 'Microchip', value: draft.microchip },
    ]);
    y = drawBoxedFields(doc, margin, y, boxW, 'Rabies vaccination', [
      { label: 'Vaccine', value: draft.vaccinationName },
      { label: 'Manufacturer', value: draft.manufacturer, half: true },
      { label: 'Vaccine type', value: draft.vaccineType, half: true },
      { label: 'Serial / lot', value: draft.serialNumber, half: true },
      { label: 'Tag number', value: draft.tagNumber, half: true },
      { label: 'Date given', value: formatDocDate(draft.vaccinationDate), half: true },
      { label: 'Expires', value: formatDocDate(draft.expirationDate), half: true },
    ]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const statement = wrapLines(
      doc,
      `This certifies that ${draft.patientName || 'this animal'} was vaccinated against rabies as described above.`,
      boxW,
    );
    doc.text(statement, margin, y);
    y += statement.length * 13 + 8;
    drawSignature(
      doc,
      y,
      draft.veterinarianName,
      draft.veterinarianLicense,
      draft.veterinarianSignaturePng,
      true,
    );
  }

  if (kind === 'vaccination' || kind === 'death' || kind === 'spayNeuter') {
    y = drawPair(doc, leftX, rightX, y, [
      ['Client ID', draft.clientId, 'Patient ID', draft.patientId],
      ['Client name', draft.clientName, 'Patient name', draft.patientName],
      ['Address', draft.address.replace(/\n/g, ', '), 'Species', draft.species],
      ['Phone', draft.phone, 'Breed', draft.breed],
      ['', '', 'Sex', draft.sex],
      ['', '', 'Color', draft.color],
      ['', '', 'Birthday', draft.birthdayDisplay || formatDocDate(draft.birthday)],
      ['', '', 'Weight', draft.weight],
      ['', '', 'Microchip', draft.microchip],
    ], colW);
    y += 8;
    doc.setDrawColor(...RULE);
    doc.line(margin, y, pageW - margin, y);
    y += 20;
  }

  if (kind === 'vaccination') {
    const rows = draft.vaccineRows.filter((r) => r.included);
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text('Vaccination details', margin, y);
    y += 16;
    doc.setFillColor(...TEAL);
    doc.rect(margin, y, pageW - margin * 2, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text('Vaccine', margin + 6, y + 12);
    doc.text('Date', 292, y + 12);
    doc.text('Expires', 372, y + 12);
    doc.text('Lot / serial', 452, y + 12);
    y += 18;
    doc.setFont('times', 'normal');
    doc.setTextColor(...INK);
    if (rows.length === 0) {
      doc.text('No vaccinations selected.', margin + 6, y + 14);
      y += 22;
    }
    rows.forEach((row, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, pageW - margin * 2, 20, 'F');
      }
      doc.text(row.name.slice(0, 46), margin + 6, y + 13);
      doc.text(formatDocDate(row.date) || '—', 292, y + 13);
      doc.text(formatDocDate(row.expires) || '—', 372, y + 13);
      doc.text((row.lot || '—').slice(0, 22), 452, y + 13);
      y += 20;
    });
    y += 8;
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(`Administered by ${draft.veterinarianName || letterhead.name || 'the attending veterinarian'}.`, margin, y);
    drawSignature(doc, y, draft.veterinarianName, draft.veterinarianLicense, draft.veterinarianSignaturePng);
  }

  if (kind === 'rx') {
    y = drawPair(doc, leftX, rightX, y, [
      ['Date', formatDocDate(draft.rxDate), 'Patient name', draft.patientName],
      ['Client name', draft.clientName, 'Patient age', draft.birthdayDisplay || formatDocDate(draft.birthday)],
      ['Address', draft.address.replace(/\n/g, ', '), 'Species & breed', [draft.species, draft.breed].filter(Boolean).join(' ')],
      ['Phone', draft.phone, 'Weight', draft.weight],
    ], colW);
    y += 10;
    doc.setDrawColor(...RULE);
    doc.line(margin, y, pageW - margin, y);
    y += 28;
    doc.setFont('times', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text('Rx:', margin, y);
    y += 22;
    doc.setFontSize(12);
    const med = [draft.rxName, draft.rxStrength].filter(Boolean).join('  ·  ');
    if (med) {
      doc.setFont('times', 'bold');
      doc.text(med, margin, y);
      y += 18;
    }
    if (draft.rxQuantity.trim()) {
      doc.setFont('times', 'normal');
      doc.text(`Quantity: ${draft.rxQuantity}`, margin, y);
      y += 16;
    }
    if (draft.rxInstructions.trim()) {
      doc.setFont('times', 'normal');
      const dir = wrapLines(doc, draft.rxInstructions, pageW - margin * 2);
      doc.text(dir, margin, y);
      y += dir.length * 15 + 8;
    }
    if (draft.rxCompoundingReason.trim()) {
      doc.setFont('times', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(...INK);
      const note = wrapLines(
        doc,
        `Compounding note: ${draft.rxCompoundingReason.trim()}`,
        pageW - margin * 2,
      );
      doc.text(note, margin, y);
      y += note.length * 15 + 8;
    }
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(`Refills: ${draft.rxRefills.trim() || '0'}`, margin, y);
    y += 16;
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('May be filled at any licensed pharmacy. Not valid unless signed by the veterinarian.', margin, y);
    drawSignature(doc, y, draft.veterinarianName, draft.veterinarianLicense, draft.veterinarianSignaturePng);
  }

  if (kind === 'death') {
    y = drawPair(doc, leftX, rightX, y, [
      ['Date of death', formatDocDate(draft.dateOfDeath), 'Manner', draft.mannerOfDeath],
      ['Cause', draft.causeOfDeath, 'Veterinarian', draft.veterinarianName],
      ['', '', 'License', draft.veterinarianLicense],
    ], colW);
    y += 16;
    doc.setFont('times', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    const statement = `This certifies that ${draft.patientName || 'this patient'}, a ${[draft.sex, draft.color, draft.breed, draft.species].filter(Boolean).join(' ') || 'patient'} owned by ${draft.clientName || 'the client'}, died on ${formatDocDate(draft.dateOfDeath) || 'the date above'}.`;
    doc.text(wrapLines(doc, statement, pageW - margin * 2), margin, y);
    drawSignature(doc, y + 36, draft.veterinarianName, draft.veterinarianLicense, draft.veterinarianSignaturePng);
  }

  if (kind === 'spayNeuter') {
    y = drawPair(doc, leftX, rightX, y, [
      ['Procedure', draft.procedureName, 'Surgery date', formatDocDate(draft.surgeryDate)],
      ['Veterinarian', draft.veterinarianName, 'License', draft.veterinarianLicense],
    ], colW);
    y += 16;
    doc.setFont('times', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    const statement = `This certifies that ${draft.patientName || 'this patient'} was surgically sterilized (${draft.procedureName || 'spay/neuter'}) on ${formatDocDate(draft.surgeryDate) || 'the date above'} at ${letterhead.name || 'this practice'}.`;
    doc.text(wrapLines(doc, statement, pageW - margin * 2), margin, y);
    drawSignature(doc, y + 36, draft.veterinarianName, draft.veterinarianLicense, draft.veterinarianSignaturePng);
  }

  if (kind === 'health') {
    const boxW = pageW - margin * 2;
    y = drawBoxedFields(doc, margin, y, boxW, 'Owner', [
      { label: 'Name', value: draft.clientName },
      { label: 'Address', value: draft.address.replace(/\n/g, ', ') },
      { label: 'Phone', value: draft.phone, half: true },
      { label: 'Client ID', value: draft.clientId, half: true },
    ]);
    y = drawBoxedFields(doc, margin, y, boxW, 'Animal', [
      { label: 'Name', value: draft.patientName, half: true },
      { label: 'Patient ID', value: draft.patientId, half: true },
      { label: 'Species / breed', value: [draft.species, draft.breed].filter(Boolean).join(' ') },
      { label: 'Sex', value: draft.sex, half: true },
      { label: 'Color', value: draft.color, half: true },
      { label: 'Age / birthday', value: draft.birthdayDisplay || formatDocDate(draft.birthday), half: true },
      { label: 'Weight', value: draft.weight, half: true },
      { label: 'Microchip', value: draft.microchip, half: true },
      { label: 'Exam date', value: formatDocDate(draft.examDate), half: true },
    ]);
    const rows = draft.vaccineRows.filter((r) => r.included);
    doc.setFont('times', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...TEAL);
    doc.text(`${draft.patientName || 'Patient'}'s core vaccines`, margin, y);
    y += 14;
    doc.setFillColor(...TEAL);
    doc.rect(margin, y, boxW, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text('Name', margin + 6, y + 12);
    doc.text('Given', 292, y + 12);
    doc.text('Expires', 420, y + 12);
    y += 18;
    doc.setFont('times', 'normal');
    doc.setTextColor(...INK);
    if (rows.length === 0) {
      doc.text('No vaccinations selected.', margin + 6, y + 14);
      y += 22;
    }
    rows.forEach((row, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, boxW, 20, 'F');
      }
      doc.text(row.name.slice(0, 46), margin + 6, y + 13);
      doc.text(formatDocDate(row.date) || '—', 292, y + 13);
      doc.text(formatDocDate(row.expires) || '—', 420, y + 13);
      y += 20;
    });
    y += 16;
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    const statement = wrapLines(
      doc,
      draft.healthStatement.trim() || defaultHealthStatement(draft),
      boxW,
    );
    doc.text(statement, margin, y);
    y += statement.length * 15 + 8;
    drawSignature(
      doc,
      y,
      draft.veterinarianName,
      draft.veterinarianLicense,
      draft.veterinarianSignaturePng,
      true,
    );
  }

  if (kind === 'vaccineCat' || kind === 'vaccineDog') {
    const boxW = pageW - margin * 2;
    const weekCount = VACCINE_PLAN_WEEKS.length;
    const labelW = 236;
    const weekW = (boxW - labelW) / weekCount;
    const rowH = 22;
    doc.setFont('times', 'italic');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(`${draft.patientName || 'Patient'}`, margin, y);
    y += 16;
    doc.setFillColor(...TEAL);
    doc.rect(margin, y, boxW, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Vaccine / medication / procedure', margin + 6, y + 13);
    VACCINE_PLAN_WEEKS.forEach((week, i) => {
      doc.text(week, margin + labelW + i * weekW + weekW / 2, y + 13, { align: 'center' });
    });
    y += 20;
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, boxW, rowH, 'F');
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.4);
    doc.rect(margin, y, boxW, rowH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('Approximate date', margin + 6, y + 14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    draft.vaccinePlanDates.forEach((date, i) => {
      const text = formatDocDate(date);
      if (text) doc.text(text, margin + labelW + i * weekW + weekW / 2, y + 14, { align: 'center' });
    });
    y += rowH;
    const planRows = draft.vaccinePlanRows.length
      ? draft.vaccinePlanRows
      : defaultVaccinePlanRows(kind);
    planRows.forEach((row, idx) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const labelLines = wrapLines(doc, row.label.trim() || ' ', labelW - 12);
      const thisH = Math.max(rowH, 10 + labelLines.length * 10);
      if (idx % 2 === 0) {
        doc.setFillColor(252, 252, 253);
        doc.rect(margin, y, boxW, thisH, 'F');
      }
      doc.setDrawColor(...RULE);
      doc.rect(margin, y, boxW, thisH);
      for (let i = 0; i < weekCount; i += 1) {
        const x = margin + labelW + i * weekW;
        doc.line(x, y, x, y + thisH);
      }
      doc.setTextColor(...INK);
      doc.text(labelLines, margin + 6, y + 13);
      row.weeks.forEach((checked, i) => {
        const cx = margin + labelW + i * weekW + weekW / 2;
        const cy = y + thisH / 2;
        const size = 9;
        doc.setDrawColor(...INK);
        doc.setLineWidth(0.7);
        doc.rect(cx - size / 2, cy - size / 2, size, size);
        if (checked) {
          doc.setLineWidth(1.1);
          doc.line(cx - 2.6, cy, cx - 0.6, cy + 2.4);
          doc.line(cx - 0.6, cy + 2.4, cx + 3.2, cy - 2.4);
        }
      });
      y += thisH;
    });
    y += 16;
    doc.setFont('times', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const note = wrapLines(
      doc,
      draft.vaccinePlanNote.trim() || defaultVaccinePlanNote(kind),
      boxW,
    );
    doc.text(note, margin, y);
    y += note.length * 12 + 10;
    if (letterhead.phone) {
      doc.setFont('times', 'normal');
      doc.text(
        `If you have any questions or concerns, please call us at ${letterhead.phone}.`,
        margin,
        y,
      );
    }
  }

  if (kind === 'litterCheck') {
    const boxW = pageW - margin * 2;
    y = drawPair(doc, leftX, rightX, y, [
      ['Patient', draft.patientName, 'DOB / age', draft.birthdayDisplay || formatDocDate(draft.birthday)],
      ['Sex', draft.sex, 'Breed', draft.breed],
      ['Exam date', formatDocDate(draft.examDate), 'Weight', draft.litterWeight || draft.weight],
    ], colW);
    y += 12;
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text('Attitude / hydration / subjective', margin, y);
    y += 14;
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const attitude = wrapLines(doc, draft.litterAttitude.trim() || ' ', boxW);
    doc.text(attitude, margin, y);
    y += Math.max(attitude.length * 13, 20) + 8;
    const systems = draft.litterSystems.length ? draft.litterSystems : defaultLitterCheckSystems();
    systems.forEach((row) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(row.label, margin, y + 10);
      const marks: Array<{ label: string; on: boolean }> = [
        { label: 'Normal', on: row.mark === 'normal' },
        { label: 'Abnormal', on: row.mark === 'abnormal' },
      ];
      marks.forEach((mark, i) => {
        const x = margin + 220 + i * 110;
        doc.setDrawColor(...INK);
        doc.setLineWidth(0.7);
        doc.rect(x, y + 2, 9, 9);
        if (mark.on) {
          doc.setLineWidth(1.1);
          doc.line(x + 1.6, y + 6.4, x + 3.6, y + 8.8);
          doc.line(x + 3.6, y + 8.8, x + 7.4, y + 3.4);
        }
        doc.text(mark.label, x + 14, y + 10);
      });
      y += 18;
    });
    y += 8;
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text('Assessment', margin, y);
    y += 14;
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const assessment = wrapLines(doc, draft.litterAssessment.trim() || ' ', boxW);
    doc.text(assessment, margin, y);
    y += Math.max(assessment.length * 13, 22) + 8;
    doc.setFont('times', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...TEAL);
    doc.text('Plan', margin, y);
    y += 14;
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const plan = wrapLines(doc, draft.litterPlan.trim() || ' ', boxW);
    doc.text(plan, margin, y);
    y += Math.max(plan.length * 13, 22) + 16;
    doc.setFont('times', 'normal');
    doc.setTextColor(...INK);
    doc.text(`Veterinarian: ${draft.veterinarianName || '________________________'}`, margin, y);
    y += 28;
    doc.setDrawColor(...RULE);
    doc.line(margin, y, margin + 220, y);
    doc.setFont('times', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('Signature', margin, y + 12);
  }

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont('times', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `${letterhead.name || 'Vet At Your Door'}  ·  Generated ${DateTime.now().toFormat('MMMM d, yyyy')}`,
    pageW / 2,
    pageH - 28,
    { align: 'center' },
  );
  return doc.output('blob');
}
