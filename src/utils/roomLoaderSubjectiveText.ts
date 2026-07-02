import { DateTime } from 'luxon';
import { fetchAppointmentById } from '../api/appointments';
import {
  searchRoomLoaders,
  type RoomLoader,
  type SentToClient,
} from '../api/roomLoader';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

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
