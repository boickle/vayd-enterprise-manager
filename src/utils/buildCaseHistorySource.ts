import type { Appointment } from '../api/roomLoader';
import type { PatientPrescription, PatientProblem, SoapEncounter } from '../api/visitWorkflow';
import { PE_SYSTEMS, peExamFromValue } from '../components/soap/peTemplate';
import type { CaseHistoryCitation } from './chartCitation';
import {
  buildChartRowsFromMedicalRecord,
  type ChartRow,
  type MedicalRecordBundle,
} from './patientChartFromMedicalRecord';
import { htmlToPlainText, looksLikeHtmlFragment } from './sanitizeCommunicationHtml';
import { patientSexListDisplayFromRecord } from './schedulerVisitDisplay';

export type { CaseHistoryCitation };
export type CaseHistorySource = {
  text: string;
  citations: CaseHistoryCitation[];
};

const EVENT_BODY_CAP = 8_000;
const SOAP_SECTION_CAP = 12_000;
const MAX_DATED_EVENTS = 150;
const MAX_SOAPS = 24;

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function asText(value: string): string {
  return looksLikeHtmlFragment(value) ? htmlToPlainText(value) : value.replace(/<br\s*\/?>/gi, '\n');
}

function clip(value: string, max: number): string {
  const t = value.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}\n  …`;
}

function indentBlock(text: string, pad = '  '): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => `${pad}${line}`.trimEnd())
    .filter((line) => line.trim().length > 0);
}

/** Form title only — drop the " — comments" prefix used on the chart list. */
function formTitle(description: string): string {
  const cut = description.indexOf(' — ');
  return cut > 0 ? description.slice(0, cut).trim() : description.trim();
}

function eventBody(row: ChartRow): { title: string; body: string } {
  const title = formTitle(asText(row.description || ''));
  const detail = asText(row.detailText || '').trim();
  const fromHtml = row.detailHtml ? htmlToPlainText(row.detailHtml).trim() : '';
  const body = [detail, fromHtml].filter(Boolean).join('\n\n').trim();
  return { title, body };
}

function soapVitalsLines(enc: SoapEncounter): string[] {
  const v = enc.objectiveVitals;
  if (!v || typeof v !== 'object') return [];
  const rec = v as Record<string, unknown>;
  const out: string[] = [];
  const weightNotTaken = rec.weightNotTaken === true || rec.weightNotTaken === 'true';
  if (weightNotTaken) {
    out.push('Weight: not taken');
  } else {
    const weight = rec.weight == null ? '' : String(rec.weight).trim();
    if (weight) {
      const unitRaw = String(rec.weightUnit ?? 'lb').toLowerCase();
      out.push(`Weight: ${weight} ${unitRaw === 'kg' ? 'kg' : 'lb'}`);
    }
  }
  const labels: [string, string][] = [
    ['tempF', 'Temp'],
    ['hr', 'HR'],
    ['rr', 'RR'],
    ['bcs', 'BCS'],
    ['fas', 'FAS'],
    ['painScore', 'Pain'],
  ];
  for (const [key, label] of labels) {
    const raw = rec[key];
    const s = raw == null ? '' : String(raw).trim();
    if (s) out.push(`${label}: ${s}`);
  }
  return out;
}

function soapExamLines(enc: SoapEncounter): string[] {
  if (!enc.objectiveExam || typeof enc.objectiveExam !== 'object') return [];
  if (Object.keys(enc.objectiveExam).length === 0) return [];
  const exam = peExamFromValue(enc.objectiveExam);
  const out: string[] = [];
  let normalCount = 0;
  for (const sys of PE_SYSTEMS) {
    const finding = exam[sys.key];
    if (!finding) continue;
    if (finding.status === 'abnormal') {
      const note = finding.note?.trim();
      out.push(`${sys.label}: abnormal${note ? ` — ${note}` : ''}`);
    } else if (finding.status === 'not_examined') {
      out.push(`${sys.label}: not examined`);
    } else if (finding.note?.trim()) {
      out.push(`${sys.label}: ${finding.note.trim()}`);
    } else {
      normalCount += 1;
    }
  }
  if (normalCount > 0 && out.length > 0) {
    out.push(`Remaining systems WNL (${normalCount})`);
  } else if (normalCount > 0 && out.length === 0) {
    out.push(`PE WNL (${normalCount} systems)`);
  }
  return out;
}

function patientChartHref(patientId: string, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ patientId: String(patientId) });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
  }
  return `/schedule/patients?${q.toString()}`;
}

function rowRef(row: ChartRow): string {
  return row.id.replace(/:/g, '-');
}

function rowCite(
  row: ChartRow,
  patientId: string
): Pick<CaseHistoryCitation, 'href' | 'kind' | 'recordId'> {
  if (row.source === 'exam' && row.id.startsWith('exam:')) {
    const recordId = row.id.slice(5);
    return { href: patientChartHref(patientId, { examId: recordId }), kind: 'exam', recordId };
  }
  if (row.id.startsWith('history:')) {
    const recordId = row.id.slice(8);
    return { href: patientChartHref(patientId, { historyId: recordId }), kind: 'history', recordId };
  }
  if (row.id.startsWith('chartNote:')) {
    const recordId = row.id.slice(10);
    return { href: patientChartHref(patientId, { noteId: recordId }), kind: 'chartNote', recordId };
  }
  return { href: patientChartHref(patientId) };
}

function formatSoapEncounter(
  enc: SoapEncounter,
  patientId: string
): { lines: string[]; citation: CaseHistoryCitation } {
  const when = (enc.completedAt ?? enc.updated ?? enc.created ?? '').slice(0, 10) || 'undated';
  const mode = enc.mode === 'quick' ? 'Quick SOAP' : 'Comprehensive SOAP';
  const ref = `soap-${enc.id}`;
  const href = `/schedule/soap/${enc.appointmentId}/${enc.patientId || patientId}${
    enc.clientId ? `?clientId=${enc.clientId}` : ''
  }`;
  const lines = [`- [ref:${ref}] ${when} ${mode} (${enc.status})`];

  const history =
    enc.subjective && typeof enc.subjective.history === 'string'
      ? asText(enc.subjective.history).trim()
      : '';
  if (history) {
    lines.push('  Subjective:');
    lines.push(...indentBlock(clip(history, SOAP_SECTION_CAP), '    '));
  }

  const vitals = soapVitalsLines(enc);
  const exam = soapExamLines(enc);
  const objNotes = enc.objectiveNotes ? asText(enc.objectiveNotes).trim() : '';
  if (vitals.length || exam.length || objNotes) {
    lines.push('  Objective:');
    if (vitals.length) lines.push(`    Vitals: ${vitals.join(', ')}`);
    for (const line of exam) lines.push(`    ${line}`);
    if (objNotes) lines.push(...indentBlock(clip(objNotes, SOAP_SECTION_CAP), '    '));
  }

  if (enc.assessmentReasoning?.trim()) {
    lines.push('  Assessment:');
    lines.push(...indentBlock(clip(asText(enc.assessmentReasoning), SOAP_SECTION_CAP), '    '));
  }

  if (enc.planNotes?.trim()) {
    lines.push('  Plan:');
    lines.push(...indentBlock(clip(asText(enc.planNotes), SOAP_SECTION_CAP), '    '));
  }

  const hasBody = lines.length > 1;
  if (!hasBody) {
    lines.push('  (no SOAP body recorded)');
  }
  return {
    lines,
    citation: { ref, date: when, label: mode, href, kind: 'soap', recordId: String(enc.id) },
  };
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function isoDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function isCancelledVisit(a: Appointment): boolean {
  const status = `${a.statusName ?? ''} ${a.confirmStatusName ?? ''}`.toLowerCase();
  return /cancel|no[\s-]?show/.test(status);
}

function isStaffOrBlockVisit(a: Appointment): boolean {
  if (a.isDeleted || a.isActive === false) return false;
  const extra = a as Appointment & { isBlock?: boolean; isPersonalBlock?: boolean };
  if (extra.isBlock || extra.isPersonalBlock) return true;
  const type = `${a.appointmentType?.prettyName ?? ''} ${a.appointmentType?.name ?? ''}`.toLowerCase();
  return /vacation|sick time|sick day|zone assignment|note to staff|personal block|flex block|\bblock\b/.test(
    type
  );
}

function isRealPatientVisit(a: Appointment): boolean {
  if (a.isDeleted || a.isActive === false) return false;
  if (isCancelledVisit(a) || isStaffOrBlockVisit(a)) return false;
  return true;
}

function visitTypeLabel(a: Appointment): string {
  return (
    pickStr(a.appointmentType?.prettyName) ??
    pickStr(a.appointmentType?.name) ??
    pickStr(a.description) ??
    'Visit'
  );
}

function visitProviderLabel(a: Appointment): string | null {
  const p = a.primaryProvider;
  if (!p) return null;
  const name = [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim();
  return name || null;
}

function latestWeightFact(
  mr: MedicalRecordBundle | null,
  patient: Record<string, unknown> | null
): { label: string; date: string | null } | null {
  type Point = { ms: number; date: string; label: string };
  const points: Point[] = [];

  for (const raw of mr?.weightHistory ?? []) {
    const o = asObj(raw);
    if (!o) continue;
    const w = Number(o.weight);
    const date = isoDate(pickStr(o.serviceDate));
    if (!date || !Number.isFinite(w) || w <= 0) continue;
    const unit = pickStr(o.weightUnit) ?? (o.weightUnitValue != null ? String(o.weightUnitValue) : 'lb');
    const unitLabel = /kg/i.test(unit) ? 'kg' : 'lb';
    const est = o.isWeightEstimate === true ? ' (est.)' : '';
    points.push({
      ms: Date.parse(o.serviceDate as string) || Date.parse(date),
      date,
      label: `${w} ${unitLabel}${est}`,
    });
  }

  for (const raw of mr?.exams ?? []) {
    const o = asObj(raw);
    const vital = asObj(o?.vitalSign);
    if (!o || !vital || vital.weight == null) continue;
    const w = Number(vital.weight);
    const date = isoDate(pickStr(o.serviceDate));
    if (!date || !Number.isFinite(w) || w <= 0) continue;
    const unit = pickStr(vital.weightUnit) ?? 'lb';
    const unitLabel = /kg/i.test(unit) ? 'kg' : 'lb';
    points.push({
      ms: Date.parse(pickStr(o.serviceDate) ?? date) || 0,
      date,
      label: `${w} ${unitLabel}`,
    });
  }

  points.sort((a, b) => a.ms - b.ms);
  const last = points[points.length - 1];
  if (last) return { label: last.label, date: last.date };

  const profile =
    pickStr(patient?.weight) ?? pickStr(patient?.weightLbs) ?? pickStr(patient?.weightKg);
  if (!profile) return null;
  const kg = Boolean(pickStr(patient?.weightKg) && !pickStr(patient?.weight) && !pickStr(patient?.weightLbs));
  return { label: `${profile} ${kg ? 'kg' : 'lb'}`, date: isoDate(pickStr(patient?.weightDate)) };
}

function visitFactsLines(opts: {
  appointments: Appointment[];
  medicalRecord: MedicalRecordBundle | null;
  patient: Record<string, unknown> | null;
  asOfDate: string;
}): string[] {
  const nowMs = Date.parse(`${opts.asOfDate}T23:59:59`) || Date.now();
  const visits = opts.appointments
    .filter(isRealPatientVisit)
    .map((a) => ({ a, ms: Date.parse(a.appointmentStart) }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((x, y) => x.ms - y.ms);

  const past = visits.filter((x) => x.ms <= nowMs);
  const upcoming = visits.filter((x) => x.ms > nowMs);
  const first = past[0];
  const last = past[past.length - 1];
  const weight = latestWeightFact(opts.medicalRecord, opts.patient);

  const lines = ['Visit facts (copy these; do not invent dates or appointments):'];
  lines.push(`- First seen: ${first ? isoDate(first.a.appointmentStart) ?? 'unknown' : 'Not on the books'}`);
  lines.push(`- Last seen: ${last ? isoDate(last.a.appointmentStart) ?? 'unknown' : 'Not on the books'}`);
  if (weight) {
    lines.push(
      `- Current weight: ${weight.label}${weight.date ? ` on ${weight.date}` : ' (date not recorded)'}`
    );
  } else {
    lines.push('- Current weight: Not recorded');
  }
  if (upcoming.length === 0) {
    lines.push('- Upcoming appointments: None on the books');
  } else {
    lines.push('- Upcoming appointments:');
    for (const { a } of upcoming.slice(0, 12)) {
      const when = a.appointmentStart.slice(0, 16).replace('T', ' ');
      const type = visitTypeLabel(a);
      const who = visitProviderLabel(a);
      lines.push(`  - ${when} · ${type}${who ? ` · ${who}` : ''}`);
    }
  }
  return lines;
}

export function buildCaseHistorySource(opts: {
  patientId: string;
  patientName?: string | null;
  clientName?: string | null;
  signalment?: string | null;
  problems: PatientProblem[];
  meds: PatientPrescription[];
  encounters: SoapEncounter[];
  appointments?: Appointment[];
  patientRecord?: Record<string, unknown> | null;
  medicalRecord: MedicalRecordBundle | null;
  asOfDate: string;
}): CaseHistorySource {
  const citations: CaseHistoryCitation[] = [];
  const lines: string[] = [];
  lines.push(`Patient: ${opts.patientName?.trim() || 'Unknown'}`);
  if (opts.clientName?.trim()) lines.push(`Owner: ${opts.clientName.trim()}`);
  if (opts.signalment?.trim()) {
    lines.push(`Clinical signalment (use this in the opening sentence): ${opts.signalment.trim()}`);
  }
  lines.push(`As of: ${opts.asOfDate}`);
  lines.push('');
  lines.push(
    ...visitFactsLines({
      appointments: opts.appointments ?? [],
      medicalRecord: opts.medicalRecord,
      patient: opts.patientRecord ?? null,
      asOfDate: opts.asOfDate,
    })
  );
  lines.push('');
  lines.push(
    'When you cite a fact, copy the matching [ref:…] token from the source lines below so the doctor can open that note.'
  );
  lines.push('');

  const chronic = opts.problems.filter((p) => p.acuity === 'chronic' && p.status !== 'resolved');
  const open = opts.problems.filter((p) => p.status !== 'resolved');
  lines.push('Problems:');
  if (open.length === 0) {
    lines.push('- None listed');
  } else {
    for (const p of open) {
      const flags = [p.kind.replace(/_/g, ' '), p.acuity, p.status].filter(Boolean).join(', ');
      lines.push(`- ${p.label}${flags ? ` (${flags})` : ''}${chronic.includes(p) ? ' [chronic]' : ''}`);
    }
  }
  lines.push('');

  lines.push('Current medications / preventatives:');
  if (opts.meds.length === 0) {
    lines.push('- None listed as chronic');
  } else {
    for (const rx of opts.meds) {
      const extra = [rx.strength, rx.instructions, rx.acuity].filter(Boolean).join(' · ');
      lines.push(`- ${rx.name}${extra ? ` — ${extra}` : ''}`);
    }
  }
  lines.push('');

  const rows = opts.medicalRecord
    ? buildChartRowsFromMedicalRecord(opts.medicalRecord)
    : [];
  const dated = [...rows].sort((a, b) => a.sortTime - b.sortTime);
  lines.push('Chart source (read the note bodies; do not copy visit-by-visit):');
  if (dated.length === 0) {
    lines.push('- None');
  } else {
    for (const r of dated.slice(-MAX_DATED_EVENTS)) {
      const date = r.serviceDateIso ? r.serviceDateIso.slice(0, 10) : 'undated';
      const { title, body } = eventBody(r);
      const heading = title ? `${r.typeLabel}: ${title}` : r.typeLabel;
      const ref = rowRef(r);
      citations.push({
        ref,
        date,
        label: r.typeLabel,
        ...rowCite(r, opts.patientId),
      });
      if (!body) {
        lines.push(`- [ref:${ref}] ${date} ${heading}`);
        continue;
      }
      lines.push(`- [ref:${ref}] ${date} ${heading}`);
      lines.push(...indentBlock(clip(body, EVENT_BODY_CAP)));
    }
  }
  lines.push('');

  const soaps = [...opts.encounters]
    .sort((a, b) => {
      const aKey = a.completedAt ?? a.updated ?? a.created;
      const bKey = b.completedAt ?? b.updated ?? b.created;
      return aKey.localeCompare(bKey);
    })
    .slice(-MAX_SOAPS);
  if (soaps.length) {
    lines.push('SOAP source (synthesize into the snapshot; do not paste S/O/A/P blocks):');
    for (const enc of soaps) {
      const { lines: soapLines, citation } = formatSoapEncounter(enc, opts.patientId);
      citations.push(citation);
      lines.push(...soapLines);
    }
  }

  if (citations.length) {
    lines.push('');
    lines.push('Citation index (copy these [ref:…] tokens when you cite a fact):');
    for (const c of citations) {
      lines.push(`- [ref:${c.ref}] ${c.date} ${c.label}`);
    }
  }

  return { text: lines.join('\n'), citations };
}

function ageYoLabel(record: Record<string, unknown>): string | null {
  const dob = pickStr(record.dob) ?? pickStr(record.dateOfBirth);
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const monthDelta = now.getMonth() - d.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < d.getDate())) years--;
  if (years < 0) return null;
  if (years < 1) {
    let months = now.getMonth() - d.getMonth() + (now.getFullYear() - d.getFullYear()) * 12;
    if (now.getDate() < d.getDate()) months--;
    return months <= 0 ? '4wo' : `${months}mo`;
  }
  return `${years}yo`;
}

function sexAbbrev(record: Record<string, unknown>): string | null {
  const raw = patientSexListDisplayFromRecord(record) ?? pickStr(record.sex);
  if (!raw) return null;
  const compact = raw.replace(/[\s._-]+/g, '').toLowerCase();
  const female = compact.includes('female');
  const male = compact.includes('male') && !female;
  const neutered = compact.includes('neutered') || compact.includes('castrat');
  const spayed = compact.includes('spayed');
  const intact = compact.includes('intact');
  if (compact === 'mn' || (male && (neutered || spayed))) return 'MN';
  if (compact === 'fs' || (female && (spayed || neutered))) return 'FS';
  if (compact === 'mi' || (male && intact)) return 'MI';
  if (compact === 'fi' || (female && intact)) return 'FI';
  if (male) return 'M';
  if (female) return 'F';
  if (raw.length <= 3) return raw.toUpperCase();
  return raw;
}

function breedAbbrev(record: Record<string, unknown>): string | null {
  const breed = pickStr(record.breed) ?? pickStr(record.breedDescription);
  const species = pickStr(record.species) ?? pickStr(record.speciesName);
  const blob = `${breed ?? ''} ${species ?? ''}`.toLowerCase();
  if (/domestic\s*short|\bdsh\b/.test(blob)) return 'DSH';
  if (/domestic\s*long|\bdlh\b/.test(blob)) return 'DLH';
  if (/domestic\s*medium|\bdmh\b/.test(blob)) return 'DMH';
  return breed || species;
}

/** Clinical one-liner: 5yo MN DSH */
export function signalmentFromPatient(record: Record<string, unknown> | null): string {
  if (!record) return '';
  return [ageYoLabel(record), sexAbbrev(record), breedAbbrev(record)].filter(Boolean).join(' ');
}
