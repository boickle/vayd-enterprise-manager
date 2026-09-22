import type {
  MultiPatientScribeSuggestion,
  ScribeSession,
  ScribeSuggestion,
} from '../api/soapScribe';
import { soapTextIsBlank } from './soapChartDraft';
import { formatSoapSectionSpacing } from './soapSectionSpacing';

export type SoapNarratives = {
  objectiveNotes: string;
  reasoning: string;
  planNotes: string;
};

function isMultiPatientSuggestion(
  value: ScribeSuggestion | MultiPatientScribeSuggestion
): value is MultiPatientScribeSuggestion {
  return Array.isArray((value as MultiPatientScribeSuggestion).patients);
}

export function latestScribeSuggestion(
  sessions: ScribeSession[]
): ScribeSuggestion | MultiPatientScribeSuggestion | null {
  const recent = [...sessions].sort((a, b) =>
    (b.updated || b.created || '').localeCompare(a.updated || a.created || '')
  );
  return (recent.find((s) => s.lastSuggestion)?.lastSuggestion ?? null) as
    | ScribeSuggestion
    | MultiPatientScribeSuggestion
    | null;
}

export function narrativesFromScribeSuggestion(
  last: ScribeSuggestion | MultiPatientScribeSuggestion | null | undefined,
  patientId: number
): SoapNarratives {
  const empty = { objectiveNotes: '', reasoning: '', planNotes: '' };
  if (!last) return empty;
  if (isMultiPatientSuggestion(last)) {
    const entry = last.patients.find((p) => Number(p.patientId) === Number(patientId));
    if (!entry) return empty;
    return {
      objectiveNotes: formatSoapSectionSpacing(entry.objectiveNotes ?? ''),
      reasoning: formatSoapSectionSpacing(entry.assessmentReasoning ?? ''),
      planNotes: formatSoapSectionSpacing(entry.planNotes ?? ''),
    };
  }
  return {
    objectiveNotes: formatSoapSectionSpacing(last.narrativeObjective ?? ''),
    reasoning: formatSoapSectionSpacing(last.assessmentReasoning ?? ''),
    planNotes: formatSoapSectionSpacing(last.narrativePlan ?? ''),
  };
}

export function fillEmptySoapNarratives(
  current: SoapNarratives,
  fromScribe: SoapNarratives
): { next: SoapNarratives; changed: boolean } {
  const next = { ...current };
  let changed = false;
  if (soapTextIsBlank(current.objectiveNotes) && !soapTextIsBlank(fromScribe.objectiveNotes)) {
    next.objectiveNotes = fromScribe.objectiveNotes;
    changed = true;
  }
  if (soapTextIsBlank(current.reasoning) && !soapTextIsBlank(fromScribe.reasoning)) {
    next.reasoning = fromScribe.reasoning;
    changed = true;
  }
  if (soapTextIsBlank(current.planNotes) && !soapTextIsBlank(fromScribe.planNotes)) {
    next.planNotes = fromScribe.planNotes;
    changed = true;
  }
  return { next, changed };
}
