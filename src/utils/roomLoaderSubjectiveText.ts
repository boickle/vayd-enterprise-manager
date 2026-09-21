import { DateTime } from 'luxon';
import { fetchAppointmentById } from '../api/appointments';
import {
  searchRoomLoaders,
  type RoomLoader,
  type SentToClient,
} from '../api/roomLoader';
import { practiceTimeZoneOrDefault } from './practiceTimezone';
import { formatSoapSectionSpacing } from './soapSectionSpacing';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

type AnyRecord = Record<string, unknown>;

type FormSection = {
  sectionLabel?: string;
  patientId?: number;
  questions?: AnyRecord[];
};

type RoomLoaderClientResponse = {
  formAnswersForPdf?: { pages?: Array<{ sections?: FormSection[] }> };
  summaryForPdf?: AnyRecord;
};

function getQuestionLabel(q: AnyRecord, sectionLabel: string): string {
  const raw = q.question ?? q.label ?? q.prompt ?? q.text ?? sectionLabel ?? '';
  const s = String(raw).trim();
  return s || 'Reason for visit';
}

function isReasonForVisitQuestion(q: AnyRecord): boolean {
  const key = String(q.questionKey ?? q.key ?? '')
    .trim()
    .toLowerCase();
  if (
    key === 'reasonforvisit' ||
    key === 'reason_for_visit' ||
    key === 'staffreasonforvisit' ||
    key === 'staff_reason_for_visit'
  ) {
    return true;
  }
  for (const field of [q.question, q.label, q.prompt, q.text]) {
    if (field == null) continue;
    if (/\breason\s+for\s+visit\b/i.test(String(field).trim())) return true;
  }
  return false;
}

function getAnswerDisplay(q: AnyRecord): string {
  const raw =
    q.answerLabel != null && String(q.answerLabel).trim() !== ''
      ? q.answerLabel
      : q.answer != null && String(q.answer).trim() !== ''
        ? q.answer
        : q.value != null && String(q.value).trim() !== ''
          ? q.value
          : q.selectedValue != null
            ? q.selectedValue
            : q.selectedOption != null
              ? q.selectedOption
              : q.choice != null
                ? q.choice
                : q.selected != null
                  ? q.selected
                  : q.checked === true
                    ? 'Yes'
                    : q.checked === false
                      ? 'No'
                      : null;
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (Array.isArray(raw)) {
    const joined = raw
      .map((x) =>
        x && typeof x === 'object'
          ? String((x as AnyRecord).label ?? (x as AnyRecord).name ?? x)
          : String(x)
      )
      .join(', ')
      .trim();
    return joined;
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as AnyRecord;
    return String(o.label ?? o.name ?? o.text ?? '').trim();
  }
  return String(raw).trim();
}

function questionToSentence(q: AnyRecord, sectionLabel: string): string | null {
  const answer = getAnswerDisplay(q);
  if (!answer) return null;

  const question = getQuestionLabel(q, sectionLabel);
  if (isReasonForVisitQuestion(q)) {
    return `Reason for visit: ${answer}.`;
  }

  const qText = question.trim();
  if (!qText) return null;
  if (qText.endsWith('?')) {
    return `${qText} ${answer}.`;
  }
  return `${qText}: ${answer}.`;
}

function collectSectionsForPatient(
  pages: Array<{ sections?: FormSection[] }>,
  patientId: number
): FormSection[] {
  const patientSections: FormSection[] = [];
  const globalSections: FormSection[] = [];

  for (const page of pages) {
    const sections = page.sections;
    if (!Array.isArray(sections)) continue;
    for (const section of sections) {
      const sid = section.patientId != null ? Number(section.patientId) : null;
      if (sid == null) globalSections.push(section);
      else if (sid === Number(patientId)) patientSections.push(section);
    }
  }

  if (patientSections.length > 0) {
    return [...patientSections, ...globalSections];
  }

  // Single-pet loaders sometimes omit patientId on every section.
  return globalSections.length > 0 ? globalSections : pages.flatMap((p) => p.sections ?? []);
}

export function appointmentReasonFromSentToClient(
  sentToClient: SentToClient | null | undefined,
  patientId: number
): string | null {
  const patients = sentToClient?.patients;
  if (!Array.isArray(patients)) return null;
  const row = patients.find((p) => Number(p.patientId) === Number(patientId));
  const reason = row?.appointmentReason ?? row?.originalAppointmentReason;
  if (reason == null || String(reason).trim() === '') return null;
  return String(reason).trim();
}

/** Build paragraph-style subjective text from client-submitted Room Loader Q&A. */
export function buildSubjectiveTextFromRoomLoaderResponse(
  responseFromClient: RoomLoaderClientResponse | null | undefined,
  patientId: number,
  options?: { appointmentReason?: string | null }
): string {
  const pages = responseFromClient?.formAnswersForPdf?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return '';

  const sections = collectSectionsForPatient(pages, patientId);
  const paragraphs: string[] = [];
  const seenReason = new Set<string>();

  const staffReason = options?.appointmentReason?.trim();
  if (staffReason) {
    paragraphs.push(`Appointment reason: ${staffReason}.`);
    seenReason.add(staffReason.toLowerCase());
  }

  for (const section of sections) {
    const sectionLabel = typeof section.sectionLabel === 'string' ? section.sectionLabel : '';
    const questions = Array.isArray(section.questions) ? section.questions : [];
    const sentences: string[] = [];

    for (const q of questions) {
      const sentence = questionToSentence(q, sectionLabel);
      if (!sentence) continue;
      if (isReasonForVisitQuestion(q)) {
        const answer = getAnswerDisplay(q);
        if (answer && seenReason.has(answer.toLowerCase())) continue;
        if (answer) seenReason.add(answer.toLowerCase());
      }
      sentences.push(sentence);
    }

    if (sentences.length > 0) {
      paragraphs.push(sentences.join(' '));
    }
  }

  return paragraphs.join('\n\n').trim();
}

const PRE_VISIT_SUBJECTIVE_PREFIX = 'Pre-Visit Check-in Information';
/** Older prefix — treat as already polished so we don't re-summarize or double-prefix. */
const LEGACY_PRE_VISIT_SUBJECTIVE_PREFIXES = ['Room Loader information'];

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Shown in Subjective when no client-submitted pre-exam / Room Loader answers exist. */
export const PRE_EXAM_CHECKIN_NOT_FILLED = 'Pre-Exam Check-in Form: Not filled out by client';

/**
 * True when Subjective already carries the client's check-in answers. The "not filled out"
 * line deliberately doesn't count: the client may submit the form after the doctor first
 * opens the chart, and the real answers should replace the line when they arrive.
 */
export function hasPreVisitAnswersBlock(text: string): boolean {
  const t = text.trim();
  if (new RegExp(`^${PRE_VISIT_SUBJECTIVE_PREFIX}\\b`, 'i').test(t)) return true;
  return LEGACY_PRE_VISIT_SUBJECTIVE_PREFIXES.some((p) =>
    new RegExp(`^${escapeForRegExp(p)}\\b`, 'i').test(t)
  );
}

function hasPreVisitSubjectivePrefix(text: string): boolean {
  const t = text.trim();
  if (hasPreVisitAnswersBlock(t)) return true;
  return new RegExp(`^${escapeForRegExp(PRE_EXAM_CHECKIN_NOT_FILLED)}$`, 'i').test(t);
}

/** Drops a leading "not filled out" line so it isn't stranded above the real answers. */
export function stripCheckinPlaceholder(text: string): string {
  const pattern = new RegExp(`^\\s*${escapeForRegExp(PRE_EXAM_CHECKIN_NOT_FILLED)}\\s*`, 'i');
  return text.replace(pattern, '').trim();
}

/** Header the AI scribe files visit-conversation history under, below the check-in block. */
export const VISIT_DISCUSSION_HEADER = 'Visit discussion:';

/** Doctor dictation captured in Jot before walking in — kept separate from client discussion. */
export const CLINICIAN_PREVISIT_HEADER = 'Clinician pre-visit notes:';

/** Prior-chart case summary (Jot / auto on SOAP open) — above visit discussion. */
export const CASE_SUMMARY_HEADER = 'Case summary:';

export function looksLikeSpokenChatter(text: string): boolean {
  return /starbucks|cup of coffee|can we stop|hold on i(?:'| a)?m|turn left|you hungry|need a coffee|silencia|\bon sierra\b/i.test(
    text
  );
}

export type SubjectiveHistoryParts = {
  checkin: string;
  caseSummary: string;
  clinicianPrevisit: string;
  visitDiscussion: string;
};

function headerPattern(header: string): RegExp {
  return new RegExp(`(?:^|\\n)${escapeForRegExp(header)}\\s*\\n?`, 'i');
}

type SectionKey = 'caseSummary' | 'clinicianPrevisit' | 'visitDiscussion';

function firstHeaderIndex(
  raw: string,
  headers: { key: SectionKey; header: string }[]
): { key: SectionKey; index: number; header: string } | null {
  let best: { key: SectionKey; index: number; header: string } | null = null;
  for (const h of headers) {
    const idx = raw.search(headerPattern(h.header));
    if (idx < 0) continue;
    if (!best || idx < best.index) best = { key: h.key, index: idx, header: h.header };
  }
  return best;
}

/**
 * Split Subjective into check-in (client), case summary, clinician prep, and visit discussion.
 */
export function splitSubjectiveHistoryParts(text: string): SubjectiveHistoryParts {
  const empty: SubjectiveHistoryParts = {
    checkin: '',
    caseSummary: '',
    clinicianPrevisit: '',
    visitDiscussion: '',
  };
  const raw = text.trim();
  if (!raw) return empty;

  const sectionHeaders: { key: SectionKey; header: string }[] = [
    { key: 'caseSummary', header: CASE_SUMMARY_HEADER },
    { key: 'clinicianPrevisit', header: CLINICIAN_PREVISIT_HEADER },
    { key: 'visitDiscussion', header: VISIT_DISCUSSION_HEADER },
  ];

  const first = firstHeaderIndex(raw, sectionHeaders);
  let checkin = raw;
  let rest = '';
  if (first) {
    checkin = raw.slice(0, first.index).trim();
    rest = raw.slice(first.index).trim();
  }

  const parts: SubjectiveHistoryParts = {
    checkin,
    caseSummary: '',
    clinicianPrevisit: '',
    visitDiscussion: '',
  };

  let cursor = rest;
  while (cursor) {
    const hit = firstHeaderIndex(cursor, sectionHeaders);
    if (!hit || hit.index !== 0) {
      // Unlabeled remainder → visit discussion
      parts.visitDiscussion = [parts.visitDiscussion, cursor].filter(Boolean).join('\n\n').trim();
      break;
    }
    const afterHeader = cursor.slice(hit.header.length).trim();
    const next = firstHeaderIndex(afterHeader, sectionHeaders);
    const body = (next ? afterHeader.slice(0, next.index) : afterHeader).trim();
    parts[hit.key] = body;
    cursor = next ? afterHeader.slice(next.index).trim() : '';
  }

  if (
    !parts.caseSummary &&
    !parts.clinicianPrevisit &&
    !parts.visitDiscussion &&
    !hasPreVisitSubjectivePrefix(parts.checkin) &&
    !first
  ) {
    return { ...empty, visitDiscussion: raw };
  }

  return parts;
}

const PRE_EXAM_CHECKIN_TAG = '(Pre-Exam Check-In)';

function isPlaceholderCheckin(text: string): boolean {
  return new RegExp(`^${escapeForRegExp(PRE_EXAM_CHECKIN_NOT_FILLED)}$`, 'i').test(text.trim());
}

function stripSubjectiveWrappers(text: string): string {
  let t = text.trim();
  const prefixes = [
    `${PRE_VISIT_SUBJECTIVE_PREFIX}:`,
    PRE_VISIT_SUBJECTIVE_PREFIX,
    ...LEGACY_PRE_VISIT_SUBJECTIVE_PREFIXES.map((p) => `${p}:`),
    ...LEGACY_PRE_VISIT_SUBJECTIVE_PREFIXES,
    VISIT_DISCUSSION_HEADER,
  ];
  for (const prefix of prefixes) {
    t = t.replace(new RegExp(`^${escapeForRegExp(prefix)}\\s*`, 'i'), '').trim();
  }
  return t;
}

function extractAfterHeader(text: string, header: string, stopHeaders: string[]): string {
  const startRe = new RegExp(`(?:^|\\n)${escapeForRegExp(header)}\\s*`, 'i');
  const match = startRe.exec(text);
  if (!match) return '';
  const from = match.index + match[0].length;
  let end = text.length;
  const rest = text.slice(from);
  for (const stop of stopHeaders) {
    const idx = rest.search(new RegExp(`(?:^|\\n)${escapeForRegExp(stop)}\\s*`, 'i'));
    if (idx >= 0 && from + idx < end) end = from + idx;
  }
  return text.slice(from, end).trim();
}

function firstParagraph(s: string): string {
  return (s.split(/\n\s*\n/)[0] ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

function toBullets(section: string): string[] {
  if (!section.trim()) return [];
  const lines = section
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const dashed = lines.filter((l) => /^[-•]/.test(l));
  const source = dashed.length > 0 ? dashed : lines;
  return source.map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
}

function parseSoapHistorySections(text: string): {
  presentingComplaint: string;
  history: string[];
  medications: string[];
} {
  const raw = stripSubjectiveWrappers(text);
  if (!raw || isPlaceholderCheckin(raw)) {
    return { presentingComplaint: '', history: [], medications: [] };
  }
  const pc = extractAfterHeader(raw, 'Presenting Complaint:', [
    'Patient History:',
    'Current Medications:',
  ]);
  const ph = extractAfterHeader(raw, 'Patient History:', [
    'Current Medications:',
    'Presenting Complaint:',
  ]);
  const meds = extractAfterHeader(raw, 'Current Medications:', [
    'Patient History:',
    'Presenting Complaint:',
  ]);
  if (pc || ph || meds) {
    return {
      presentingComplaint: firstParagraph(pc),
      history: toBullets(ph),
      medications: toBullets(meds).filter((b) => !/^none\.?$/i.test(b)),
    };
  }
  return {
    presentingComplaint: '',
    history: raw
      .split(/\n+/)
      .map((l) => l.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean),
    medications: [],
  };
}

function trimPeriod(s: string): string {
  return s.replace(/\.+$/g, '').trim();
}

function normPhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(\s*pre-exam check-in\s*\)/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COVER_STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'for',
  'is',
  'are',
  'was',
  'were',
  'to',
  'of',
  'on',
  'in',
  'at',
  'here',
  'presents',
  'present',
  'presenting',
  'patient',
  'owner',
  'reports',
  'reported',
  'client',
  'with',
  'that',
  'this',
  'they',
  'he',
  'she',
  'it',
  'his',
  'her',
  'their',
]);

function phraseCoveredBy(haystack: string, needle: string): boolean {
  const h = normPhrase(haystack);
  const n = normPhrase(needle);
  if (!n || !h) return false;
  if (h.includes(n) || (n.length > 24 && n.includes(h))) return true;
  const tokens = n.split(' ').filter((t) => t.length > 2 && !COVER_STOP.has(t));
  if (tokens.length === 0) return false;
  return tokens.filter((t) => h.includes(t)).length / tokens.length >= 0.72;
}

function checkinReasonAddon(checkin: string): string {
  const t = trimPeriod(checkin);
  const m = t.match(
    /\b(?:is here for|here for|presents for|presenting for|seen for|coming in for|coming for)\s+(.+)/i
  );
  if (m?.[1]) return trimPeriod(m[1]);
  return t;
}

function combinePresentingComplaints(checkinPc: string, visitPc: string): string {
  const checkin = trimPeriod(checkinPc.replace(/^presenting complaint:\s*/i, ''));
  const visit = trimPeriod(visitPc.replace(/^presenting complaint:\s*/i, ''));
  if (!checkin) return visit;
  if (!visit) return checkin;
  if (phraseCoveredBy(visit, checkin) || phraseCoveredBy(checkin, visit)) return visit;
  const checkinEuth = /euthan/i.test(checkin);
  const visitEuth = /euthan/i.test(visit);
  if (checkinEuth !== visitEuth) {
    return `${visit}. Pre-exam check-in had listed ${checkin.charAt(0).toLowerCase()}${checkin.slice(1)}.`;
  }
  const addon = checkinReasonAddon(checkin);
  if (phraseCoveredBy(visit, addon)) return visit;
  return `${visit}; ${addon}.`;
}

function isIndoorOnlyLine(s: string): boolean {
  return (
    /\bdoes not go outdoors\b|\bnot (?:an )?outdoor\b|\bindoor only\b|\bindoor cat\b|\bdoes not live with a (?:cat|dog) that goes outdoors\b/i.test(
      s
    ) && !/\bindoor\s*[/-]\s*outdoor\b|\bindoor-outdoor\b/i.test(s)
  );
}

function isOutdoorLifestyleLine(s: string): boolean {
  return /\bindoor\s*[/-]\s*outdoor\b|\bindoor-outdoor\b|\bhunt(?:s|ing)\b|\bgoes (?:outside|outdoors)\b|\boutdoor cat\b/i.test(
    s
  );
}

const VAX_NAME =
  /\b(lepto(?:spirosis)?|lyme|felv|feline leukemia|leukemia|bordetella|rabies|fvrcp)\b/i;

function electedVaccine(s: string): string | null {
  if (!/owner (?:elects?|selected|requests?|chose)|elected|requested/i.test(s)) return null;
  return s.match(VAX_NAME)?.[1] ?? null;
}

function mentionsDeclinedVaccine(s: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`\\b${escaped}\\b`, 'i').test(s)) return false;
  return /declin(?:ed|e)|elected not to|not (?:initiated|recommended|started)|do not start/i.test(s);
}

function withParenthetical(bullet: string, note: string): string {
  if (bullet.toLowerCase().includes(note.toLowerCase())) return bullet;
  return `${trimPeriod(bullet)} (${note})`;
}

function tagPreExam(bullet: string): string {
  if (/\(\s*pre-exam check-in\s*\)/i.test(bullet)) return bullet;
  return `${trimPeriod(bullet)} ${PRE_EXAM_CHECKIN_TAG}`;
}

function mergeHistoryBullets(
  visitHistory: string[],
  checkinHistory: string[]
): { history: string[]; leftover: string[] } {
  const history = [...visitHistory];
  const leftover: string[] = [];
  const visitBlob = history.join('\n');

  for (const raw of checkinHistory) {
    const checkin = raw.replace(/\s*\(\s*pre-exam check-in\s*\)\.?/gi, '').trim();
    if (!checkin) continue;
    if (phraseCoveredBy(visitBlob, checkin) || history.some((v) => phraseCoveredBy(v, checkin))) {
      continue;
    }
    if (isIndoorOnlyLine(checkin)) {
      const idx = history.findIndex(isOutdoorLifestyleLine);
      if (idx >= 0) {
        history[idx] = withParenthetical(
          history[idx]!,
          'pre-exam check-in had reported indoor only'
        );
        continue;
      }
    }
    const vax = electedVaccine(checkin);
    if (vax) {
      const idx = history.findIndex((v) => mentionsDeclinedVaccine(v, vax));
      if (idx >= 0) {
        history[idx] = withParenthetical(history[idx]!, 'elected on pre-exam check-in');
        continue;
      }
    }
    leftover.push(checkin);
  }
  return { history, leftover };
}

function mergeMedicationBullets(visit: string[], checkin: string[]): string[] {
  const out = [...visit];
  for (const raw of checkin) {
    const med = raw.replace(/\s*\(\s*pre-exam check-in\s*\)\.?/gi, '').trim();
    if (!med) continue;
    if (out.some((v) => phraseCoveredBy(v, med) || phraseCoveredBy(med, v))) continue;
    out.push(tagPreExam(med));
  }
  return out;
}

function renderSoapHistory(sections: {
  presentingComplaint: string;
  history: string[];
  medications: string[];
}): string {
  const blocks: string[] = [];
  if (sections.presentingComplaint) {
    blocks.push(
      `Presenting Complaint: ${sections.presentingComplaint.replace(/^presenting complaint:\s*/i, '')}`
    );
  }
  if (sections.history.length > 0) {
    blocks.push(`Patient History:\n${sections.history.map((b) => `- ${b}`).join('\n')}`);
  }
  if (sections.medications.length > 0) {
    blocks.push(`Current Medications:\n${sections.medications.map((b) => `- ${b}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}

/**
 * One Presenting Complaint + Patient History after SOAP exists. Check-in facts already
 * covered by the visit drop; additive ones keep a "(Pre-Exam Check-In)" tag; conflicts
 * stay on the visit line with a short explanation.
 */
export function foldCheckinIntoVisit(checkin: string, visitDiscussion: string): string {
  const visitRaw = stripSubjectiveWrappers(visitDiscussion);
  if (!visitRaw) return stripSubjectiveWrappers(checkin);
  if (!checkin.trim() || isPlaceholderCheckin(checkin)) return visitRaw;

  const checkinParts = parseSoapHistorySections(checkin);
  const visitParts = parseSoapHistorySections(visitDiscussion);
  const visitHasSoap = Boolean(visitParts.presentingComplaint || visitParts.history.length);

  if (!visitHasSoap) {
    const extras = checkinParts.history
      .filter((b) => !phraseCoveredBy(visitRaw, b))
      .map(tagPreExam);
    return extras.length > 0 ? `${visitRaw}\n\n${extras.map((b) => `- ${b}`).join('\n')}` : visitRaw;
  }

  const { history, leftover } = mergeHistoryBullets(visitParts.history, checkinParts.history);
  return formatSoapSectionSpacing(
    renderSoapHistory({
      presentingComplaint: combinePresentingComplaints(
        checkinParts.presentingComplaint,
        visitParts.presentingComplaint
      ),
      history: [...history, ...leftover.map(tagPreExam)],
      medications: mergeMedicationBullets(visitParts.medications, checkinParts.medications),
    })
  );
}

/** Pull form-only facts back out so Re-load can fold them into a new visit note. */
export function extractTaggedPreExamFacts(text: string): string {
  const parsed = parseSoapHistorySections(text);
  const taggedHistory = parsed.history.filter((b) => /\(\s*pre-exam check-in\s*\)/i.test(b));
  const taggedPc = /\(\s*pre-exam check-in\s*\)/i.test(parsed.presentingComplaint)
    ? parsed.presentingComplaint.replace(/\s*\(\s*pre-exam check-in\s*\)\.?/gi, '').trim()
    : '';
  if (!taggedHistory.length && !taggedPc) return '';
  return renderSoapHistory({
    presentingComplaint: taggedPc,
    history: taggedHistory.map((b) => b.replace(/\s*\(\s*pre-exam check-in\s*\)\.?/gi, '').trim()),
    medications: [],
  });
}

/** True when Subjective is already a visit SOAP (not the standalone check-in block). */
export function subjectiveHasVisitSoap(text: string): boolean {
  const t = text.trim();
  if (!t || hasPreVisitAnswersBlock(t) || isPlaceholderCheckin(t)) return false;
  const parts = splitSubjectiveHistoryParts(t);
  const body = parts.visitDiscussion.trim() || t;
  return /presenting complaint:/i.test(body) && /patient history:/i.test(body);
}

/**
 * After a visit SOAP exists: fold check-in into that history (one complaint, one
 * history) and drop generated case-summary dumps.
 */
export function cleanSubjectiveAfterVisit(parts: SubjectiveHistoryParts): SubjectiveHistoryParts {
  const next = { ...parts };
  if (caseSummaryLooksGenerated(next.caseSummary)) {
    next.caseSummary = '';
  }
  if (next.visitDiscussion.trim()) {
    const checkin = isPlaceholderCheckin(next.checkin) ? '' : next.checkin;
    next.visitDiscussion = foldCheckinIntoVisit(checkin, next.visitDiscussion);
    next.checkin = '';
  }
  return next;
}

export function joinSubjectiveHistoryParts(parts: SubjectiveHistoryParts): string {
  const blocks: string[] = [];
  if (parts.checkin.trim()) blocks.push(parts.checkin.trim());
  if (parts.caseSummary.trim()) {
    blocks.push(`${CASE_SUMMARY_HEADER}\n\n${parts.caseSummary.trim()}`);
  }
  if (parts.clinicianPrevisit.trim()) {
    blocks.push(`${CLINICIAN_PREVISIT_HEADER}\n\n${parts.clinicianPrevisit.trim()}`);
  }
  if (parts.visitDiscussion.trim()) {
    const v = stripSubjectiveWrappers(parts.visitDiscussion);
    if (!v) return blocks.join('\n\n').trim();
    // Stacked "Visit discussion" only while check-in is still a separate block.
    if (parts.checkin.trim()) blocks.push(`${VISIT_DISCUSSION_HEADER}\n\n${v}`);
    else blocks.push(v);
  }
  return blocks.join('\n\n').trim();
}

/** Replace doctor prep dictation without clobbering check-in or the in-room visit discussion. */
export function mergeClinicianPrevisitNotes(existing: string, notes: string): string {
  const incoming = notes.trim();
  if (!incoming) return existing.trim();
  const parts = splitSubjectiveHistoryParts(existing);
  parts.clinicianPrevisit = incoming;
  return joinSubjectiveHistoryParts(parts);
}

/**
 * True when a Case summary block looks like it describes a different pet than `patientName`
 * (e.g. "Charlie is a cat…" on Simon's chart).
 */
/**
 * True when Case summary is a generated dump, not a doctor's note.
 *
 * Auto-seed used to paste chart-chat into Subjective ("patient of unspecified species",
 * "no chronic medications listed"). That block is not medical history — Process should
 * drop it rather than leave it above the visit discussion.
 */
export function caseSummaryLooksGenerated(summary: string): boolean {
  const text = summary.trim();
  if (!text) return false;
  return (
    /unspecified (species|age|sex|breed)/i.test(text) ||
    /this patient only/i.test(text) ||
    /no dated clinical history/i.test(text) ||
    /no chronic medications or preventatives/i.test(text) ||
    /no handling history/i.test(text) ||
    /no pending follow-up documented/i.test(text) ||
    (/^as of \d{4}-\d{2}-\d{2}/im.test(text) && /open items:/i.test(text))
  );
}

/**
 * Drop check-in lines the visit conversation contradicted.
 *
 * Room Loader answers stay on the page as if they were still true, so Casper is "indoor"
 * in check-in and "indoor/outdoor" in the visit, and Rosie elects Lyme on the form then
 * declines it in the room. Visit discussion is the source of truth.
 */
export function reconcileCheckinWithVisit(checkin: string, visitDiscussion: string): string {
  const visit = visitDiscussion.trim();
  if (!checkin.trim() || !visit) return checkin;

  const lines = checkin.split(/\r?\n/);
  const keep: string[] = [];
  let visitComplaint: string | null = null;
  const complaintMatch = visit.match(/presenting complaint:\s*(.+)/i);
  if (complaintMatch?.[1]) visitComplaint = complaintMatch[1].trim();

  const visitOutdoor =
    /\bindoor\s*[\/-]\s*outdoor\b|\bindoor-outdoor\b|\bhunt(?:s|ing)\b|\bgoes (?:outside|outdoors)\b|\boutdoor cat\b/i.test(
      visit
    );
  const declinedVaccine = (name: RegExp) =>
    new RegExp(
      `(?:declin(?:ed|e)|elected not to|not (?:initiated|recommended|started)|do not start)[^.]{0,80}${name.source}`,
      'i'
    ).test(visit) ||
    new RegExp(
      `${name.source}[^.]{0,80}(?:declin(?:ed|e)|elected not to|not (?:initiated|recommended|started))`,
      'i'
    ).test(visit);

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      visitComplaint &&
      /^presenting complaint:/i.test(trimmed) &&
      (/\basdf\b/i.test(trimmed) || /unspecified concern/i.test(trimmed))
    ) {
      keep.push(line.replace(/^(Presenting Complaint:\s*).+$/i, `$1${visitComplaint}`));
      continue;
    }

    if (
      visitOutdoor &&
      /\bdoes not go outdoors\b|\bnot (?:an )?outdoor\b|\bindoor only\b|\bdoes not live with a (?:cat|dog) that goes outdoors\b/i.test(
        trimmed
      )
    ) {
      continue;
    }

    const election =
      /owner (?:elects?|selected|requests?|chose)\b/i.test(trimmed) &&
      /\b(lepto(?:spirosis)?|lyme|felv|leukemia|bordetella|rabies|fvrcp)\b/i.test(trimmed);
    if (election) {
      const vax = trimmed.match(
        /\b(lepto(?:spirosis)?|lyme|felv|feline leukemia|leukemia|bordetella|rabies|fvrcp)\b/i
      );
      if (vax && declinedVaccine(new RegExp(vax[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))) {
        continue;
      }
    }

    keep.push(line);
  }

  return keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function caseSummaryLooksWrongForPatient(
  summary: string,
  patientName: string
): boolean {
  const text = summary.trim();
  if (!text) return false;
  if (caseSummaryLooksGenerated(text)) return true;
  const name = patientName.trim();
  if (!name || /^Patient #\d+$/i.test(name)) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namesSelf = new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  if (namesSelf) return false;
  // Opens with "OtherName is a …" or otherwise narrates a named subject without this pet.
  if (/^[A-Z][a-zA-Z'’-]+\s+is\b/m.test(text)) return true;
  if (/\b(is a|presents as|patient of)\b/i.test(text)) return true;
  return false;
}

/**
 * Seed or replace the prior-chart case summary block (Process leaves this alone).
 * Pass `patientName` to overwrite a summary that names the wrong pet.
 */
export function mergeCaseSummaryNotes(
  existing: string,
  summary: string,
  opts?: { patientName?: string }
): string {
  const incoming = summary.trim();
  if (!incoming) return existing.trim();
  const parts = splitSubjectiveHistoryParts(existing);
  const existingSummary = parts.caseSummary.trim();
  if (
    existingSummary &&
    !(
      opts?.patientName &&
      caseSummaryLooksWrongForPatient(existingSummary, opts.patientName)
    )
  ) {
    return existing.trim();
  }
  parts.caseSummary = incoming;
  return joinSubjectiveHistoryParts(parts);
}

/**
 * Puts the pre-visit check-in block back on top of Subjective. Used when a chart already
 * has doctor- or scribe-written history but no check-in block — the block belongs first,
 * and the existing text becomes the visit discussion under it.
 */
export function prependCheckinBlock(block: string, existing: string): string {
  const rest = existing.trim();
  if (!rest) return block;
  const parts = splitSubjectiveHistoryParts(rest);
  parts.checkin = block;
  if (!parts.caseSummary && !parts.clinicianPrevisit && !parts.visitDiscussion && rest) {
    if (rest.toLowerCase().startsWith(VISIT_DISCUSSION_HEADER.toLowerCase())) {
      return joinSubjectiveHistoryParts({
        checkin: block,
        caseSummary: '',
        clinicianPrevisit: '',
        visitDiscussion: rest.slice(VISIT_DISCUSSION_HEADER.length).trim(),
      });
    }
    parts.visitDiscussion = rest;
  }
  return joinSubjectiveHistoryParts(parts);
}

/** Prefix AI (or raw) intake text so doctors can see it came from pre-visit check-in. */
export function withRoomLoaderSubjectivePrefix(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  if (hasPreVisitSubjectivePrefix(trimmed)) return trimmed;
  return `${PRE_VISIT_SUBJECTIVE_PREFIX}:\n\n${trimmed}`;
}

/**
 * True when Subjective still looks like our raw Room Loader Q&A dump (not a clinical note
 * and not already prefixed). Intentionally strict so reopening an unfinished SOAP never
 * overwrites doctor-typed history.
 */
export function looksLikeRawRoomLoaderSubjective(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (hasPreVisitSubjectivePrefix(t)) return false;
  // Our builder always leads with staff/client visit reason when present.
  if (/^Appointment reason:/i.test(t)) return true;
  if (/^Reason for visit:/i.test(t)) return true;
  // Fallback: multiple "Question? Answer." sentences typical of formAnswersForPdf export.
  const qaPairs = t.match(/[^?\n]{8,}\?\s+\S+/g) ?? [];
  return qaPairs.length >= 3;
}

function roomLoaderHasClientAnswers(loader: RoomLoader): boolean {
  const response = loader.responseFromClient;
  const pages = response?.formAnswersForPdf?.pages;
  return Array.isArray(pages) && pages.length > 0;
}

function roomLoaderAppointmentIds(loader: RoomLoader): number[] {
  return (loader.appointments ?? [])
    .map((a) => Number(a.id))
    .filter((id) => Number.isFinite(id));
}

/** Most recent Room Loader the client submitted for this appointment. */
export async function findSubmittedRoomLoaderForAppointment(
  appointmentId: number
): Promise<RoomLoader | null> {
  const appt = await fetchAppointmentById(appointmentId, { practiceId: PRACTICE_ID });
  if (!appt?.appointmentStart) return null;

  const practiceTz = practiceTimeZoneOrDefault(
    (appt as { practice?: { timezone?: string } }).practice?.timezone
  );
  const apptDay = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' })
    .setZone(practiceTz)
    .toISODate();
  if (!apptDay) return null;

  const rows = await searchRoomLoaders({
    practiceId: PRACTICE_ID,
    appointmentFrom: apptDay,
    appointmentTo: apptDay,
    activeOnly: true,
  });

  return (
    rows
      .filter((row) => roomLoaderAppointmentIds(row).includes(appointmentId))
      .filter(roomLoaderHasClientAnswers)
      .sort((a, b) => b.id - a.id)[0] ?? null
  );
}
