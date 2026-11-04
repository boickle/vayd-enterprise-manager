/**
 * When a SOAP may still become a medical note (owner decision Nov 4, 2026): nothing entered on
 * it yet. Mirrors the API's rule (encounter-mode-switch.util.ts), which has the final say: the
 * pre-exam check-in block the SOAP page fills in on its own does not count; vitals count once a
 * reading (or "No weight taken") is recorded; the exam counts once a system is not "normal" or
 * has a note.
 */
import type { Vitals } from './soapVitals';
import type { PeExamState } from '../components/soap/peTemplate';
import { PRE_EXAM_CHECKIN_NOT_FILLED, hasPreVisitAnswersBlock } from './roomLoaderSubjectiveText';

const SECTION_HEADER = /(?:^|\n)\s*(Case summary:|Clinician pre-visit notes:|Visit discussion:)/i;

function plainText(value: string | null | undefined): string {
  if (value == null) return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

/** Subjective minus the auto-filled check-in block. */
export function subjectiveWrittenText(history: string | null | undefined): string {
  let text = plainText(history);
  if (!text) return '';
  const headers = new RegExp(SECTION_HEADER.source, 'gi');
  if (text.toLowerCase().startsWith(PRE_EXAM_CHECKIN_NOT_FILLED.toLowerCase())) {
    text = text.slice(PRE_EXAM_CHECKIN_NOT_FILLED.length);
    return text.replace(headers, '\n').trim();
  }
  if (!hasPreVisitAnswersBlock(text)) return text;
  const at = text.search(SECTION_HEADER);
  return at < 0 ? '' : text.slice(at).replace(headers, '\n').trim();
}

export type SoapDraftForSwitch = {
  subjective: string;
  vitals: Vitals;
  exam: PeExamState;
  objectiveNotes: string;
  reasoning: string;
  planNotes: string;
};

export function soapHasEnteredContent(d: SoapDraftForSwitch): boolean {
  if (subjectiveWrittenText(d.subjective)) return true;
  const v = d.vitals;
  if (v.weightNotTaken) return true;
  if ([v.tempF, v.weight, v.hr, v.rr, v.bcs, v.painScore].some((x) => String(x ?? '').trim()))
    return true;
  if (
    Object.values(d.exam ?? {}).some(
      (f) => (f?.status && f.status !== 'normal') || Boolean(f?.note?.trim())
    )
  )
    return true;
  return [d.objectiveNotes, d.reasoning, d.planNotes].some((t) => Boolean(plainText(t)));
}

/** A medical note's chart note belongs to its encounter by date (the page dates it that way). */
export function chartNoteBelongsToEncounter(
  noteDate: string | null | undefined,
  encounterCreated: string | null | undefined
): boolean {
  if (!noteDate || !encounterCreated) return false;
  const a = Date.parse(noteDate);
  const b = Date.parse(encounterCreated);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1000;
}
