/** Scout Epiphany — voice notes, callbacks, huddles, and visit prep. */

export const BRIEF_KIND_VALUES = ['visit', 'previsit', 'callback', 'huddle', 'review'] as const;
export type BriefKind = (typeof BRIEF_KIND_VALUES)[number];

export const BRIEF_STATUS_VALUES = ['draft', 'recorded', 'injected', 'archived'] as const;
export type BriefStatus = (typeof BRIEF_STATUS_VALUES)[number];

export type BriefSession = {
  id: string;
  kind: BriefKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Local calendar date YYYY-MM-DD */
  date: string;
  employeeId?: string | null;
  patientId?: string | number | null;
  patientName?: string | null;
  clientId?: string | number | null;
  clientName?: string | null;
  clientPhone?: string | null;
  appointmentId?: number | null;
  soapEncounterId?: string | null;
  transcript: string;
  /** Unfiltered recording, kept so the doctor can compare after chit-chat is dropped. */
  rawTranscript?: string | null;
  status: BriefStatus;
  injectedAt?: string | null;
  audioFileName?: string | null;
};

export const BRIEF_KIND_LABEL: Record<BriefKind, string> = {
  visit: 'Visit SOAP',
  previsit: 'Prep notes',
  callback: 'Callback',
  huddle: 'Staff huddle',
  review: 'Record review',
};

export const BRIEF_KIND_HINT: Record<BriefKind, string> = {
  visit: 'Open the visit chart for an upcoming or unfinished appointment.',
  previsit:
    'Talk through history before you walk in. Injected into SOAP, separate from the visit discussion.',
  callback: 'Call the client on Quo and transcribe the conversation.',
  huddle: 'Meeting notes with no patient. Email the transcript when you are done.',
  review: 'Upload previous records and summarize them for prep.',
};

export function isBriefKind(value: string): value is BriefKind {
  return (BRIEF_KIND_VALUES as readonly string[]).includes(value);
}

export function defaultBriefTitle(kind: BriefKind, dateLabel: string): string {
  if (kind === 'huddle') return `Staff huddle ${dateLabel}`;
  return BRIEF_KIND_LABEL[kind];
}
