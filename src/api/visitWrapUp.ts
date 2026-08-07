// src/api/visitWrapUp.ts
// Visit wrap-up: the step after the SOAP where the household's charts are reviewed,
// forward booking is settled, and the client recap email is sent (or deliberately
// skipped). Mirrors the backend wrap-up endpoints on the visitWorkflow/scribe modules.
import { http } from './http';
import type { ForwardBookingDisposition } from './forwardBookingDisposition';
import type { HouseholdRosterEntry, SoapEncounterStatus } from './visitWorkflow';

const pid = () => Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export type ClientRecapEmailStatus = 'sent' | 'skipped';

/** What was recorded about the recap email, on every pet it covered. */
export type ClientEmailDelivery = {
  status: ClientRecapEmailStatus;
  decidedAt: string | null;
  decidedByEmployeeId: number | null;
  patientIds: number[];
  recipients: string[];
  subject: string | null;
  fromAddress: string | null;
  mailbox: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  skipReason: string | null;
};

/** One pet's finished chart, read-only for the wrap-up review. */
export type VisitWrapUpPet = HouseholdRosterEntry & {
  status: SoapEncounterStatus;
  /** Signature on a locked chart: who signed it and when. */
  completedAt: string | null;
  completedByName: string | null;
  subjectiveHistory: string | null;
  objectiveVitals: Record<string, unknown> | null;
  objectiveNotes: string | null;
  assessmentReasoning: string | null;
  planNotes: string | null;
  forwardBookingDisposition: ForwardBookingDisposition | null;
  /** Queue row this visit created, when "Forward book" was chosen. */
  forwardBookingEntryId: number | null;
  /** Meds / vaccines still missing clinical details — blocks Complete visit. */
  outstandingClinical?: {
    missingMeds: { orderId: string; name: string }[];
    missingVaccines: { orderId: string; name: string }[];
  };
};

export type VisitWrapUp = {
  appointmentId: number;
  clientId: number | null;
  clientName: string | null;
  clientEmails: string[];
  provider: { id: number; name: string | null; email: string | null } | null;
  emailDraft: { subject: string; body: string };
  clientEmailDelivery: ClientEmailDelivery | null;
  pets: VisitWrapUpPet[];
};

/**
 * Everything the wrap-up renders, in one call — a partial load would let a recap
 * go out that silently omitted one of the pets seen.
 */
export async function getVisitWrapUp(encounterId: string): Promise<VisitWrapUp> {
  const { data } = await http.get<VisitWrapUp>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/wrap-up`,
    { params: { practiceId: pid() } }
  );
  return data;
}

/**
 * Rebuilds the recap from the doctor's edited charts (not the raw transcript), so
 * regenerating after chart edits describes the visit as it was actually recorded.
 */
export async function generateClientRecap(
  encounterId: string,
  patientIds?: number[]
): Promise<{ subject: string; body: string }> {
  const { data } = await http.post<{ subject: string; body: string }>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/scribe/client-recap`,
    { practiceId: pid(), ...(patientIds?.length ? { patientIds } : {}) }
  );
  return data;
}

/**
 * Records the recap outcome. Sending happens through Gmail from the client, so
 * this is called after a successful send — or instead of one, when the doctor
 * chooses not to email.
 */
export async function recordClientEmailDecision(
  encounterId: string,
  body: {
    status: ClientRecapEmailStatus;
    patientIds?: number[];
    recipients?: string[];
    subject?: string;
    body?: string;
    fromAddress?: string;
    mailbox?: string;
    gmailMessageId?: string;
    gmailThreadId?: string;
    skipReason?: string;
  }
): Promise<VisitWrapUp> {
  const { data } = await http.post<VisitWrapUp>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/client-email`,
    { practiceId: pid(), ...body }
  );
  return data;
}
