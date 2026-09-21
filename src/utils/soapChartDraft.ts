/**
 * Last-resort copy of an in-progress SOAP, for the laptop-left-in-the-truck case.
 *
 * The live chart still auto-saves to the server on a timer. This is only for when
 * that PATCH never left the device (no signal, tab killed mid-flight). On the next
 * open, a draft newer than the server row is put back on screen and saved.
 */

import type { PeExamState } from '../components/soap/peTemplate';
import type { Vitals } from './soapVitals';

export type SoapChartDraft = {
  subjective: string;
  emailSubject: string;
  emailBody: string;
  objectiveNotes: string;
  reasoning: string;
  planNotes: string;
  vitals: Vitals;
  exam: PeExamState;
  linkedProblemIds: string[];
  at: string;
};

const PREFIX = 'scout.soap.chartDraft:';

export function soapChartDraftKey(encounterId: string): string {
  return `${PREFIX}${encounterId}`;
}

export function readSoapChartDraft(encounterId: string): SoapChartDraft | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(soapChartDraftKey(encounterId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SoapChartDraft;
    if (!parsed || typeof parsed.at !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSoapChartDraft(encounterId: string, draft: SoapChartDraft): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(soapChartDraftKey(encounterId), JSON.stringify(draft));
  } catch {
    /* quota — the server save is the real one */
  }
}

export function clearSoapChartDraft(encounterId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(soapChartDraftKey(encounterId));
  } catch {
    /* ignore */
  }
}

/** True when the draft was written after the server last stored this chart. */
export function soapChartDraftIsNewer(
  draft: SoapChartDraft,
  serverUpdatedAt: string | null | undefined
): boolean {
  const draftAt = Date.parse(draft.at);
  if (!Number.isFinite(draftAt)) return false;
  if (!serverUpdatedAt) return true;
  const serverAt = Date.parse(serverUpdatedAt);
  if (!Number.isFinite(serverAt)) return true;
  return draftAt > serverAt + 500;
}
