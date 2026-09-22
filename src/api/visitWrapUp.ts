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

export type ReminderSourceType = 'inventory' | 'procedure' | 'lab';

/** One reminder this visit will create, as it stands after the wrap-up's edits. */
export type ProposedReminder = {
  /** Stable key — proposals are recomputed on every load, edits are merged over them. */
  key: string;
  description: string;
  reminderType: string;
  startReminding: string | null;
  dueDate: string | null;
  stopReminding: string | null;
  sourceCatalogItemType: ReminderSourceType | null;
  sourceCatalogItemId: number | null;
  sourceDefinitionId: number | null;
  /** What on the visit produced it, e.g. "Rabies 1yr". */
  sourceLabel: string | null;
  origin: 'catalog' | 'manual';
  removed: boolean;
  edited: boolean;
};

export type VisitReminderPet = {
  patientId: number;
  patientName: string;
  soapEncounterId: string;
  /** Chart signed — reminders already created, no longer editable here. */
  locked: boolean;
  reminders: ProposedReminder[];
  /** The stored edits behind `reminders`, which is what the UI mutates and saves back. */
  plan: {
    overrides: Record<string, ReminderPlanOverride>;
    extras: ReminderPlanExtra[];
    callbacks?: ReminderPlanCallback[];
  };
  declinedItems?: import('./declinedTreatments').DeclinedTreatmentItem[];
  /** Existing chart reminders already past due — cleanup targets. */
  pastDueReminders?: PastDueReminder[];
};

export type PastDueReminder = {
  id: number;
  description: string;
  reminderType?: string | null;
  dueDate: string | null;
  startReminding?: string | null;
};

export type ReminderPlanOverride = {
  description?: string;
  startReminding?: string | null;
  dueDate?: string | null;
  stopReminding?: string | null;
  removed?: boolean;
};

export type ReminderPlanExtra = {
  key: string;
  description: string;
  reminderType?: string;
  startReminding?: string | null;
  dueDate?: string | null;
  stopReminding?: string | null;
  sourceCatalogItemType?: ReminderSourceType | null;
  sourceCatalogItemId?: number | null;
};

export type ReminderPlanCallback = {
  key: string;
  title: string;
  body?: string | null;
  dueAt?: string | null;
};

/**
 * What the visit is about to remind this household about — a preview, nothing written
 * until the charts are signed.
 */
export async function getVisitReminders(
  encounterId: string
): Promise<{ pets: VisitReminderPet[] }> {
  const { data } = await http.get<{ pets: VisitReminderPet[] }>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/reminders`,
    { params: { practiceId: pid() } }
  );
  return data;
}

/**
 * Save one pet's reminder edits. `encounterId` is that pet's own encounter, and the
 * response is the refreshed household preview.
 */
export async function appendCheckoutPrepDrafts(
  encounterId: string,
  patch: {
    extra?: ReminderPlanExtra;
    callback?: ReminderPlanCallback;
  }
): Promise<{ pets: VisitReminderPet[] }> {
  const { pets } = await getVisitReminders(encounterId);
  const pet = pets.find((p) => p.soapEncounterId === encounterId) ?? pets[0];
  if (!pet) throw new Error('Could not load this visit’s reminder plan.');
  return saveReminderPlan(pet.soapEncounterId, {
    overrides: pet.plan.overrides ?? {},
    extras: patch.extra ? [...(pet.plan.extras ?? []), patch.extra] : pet.plan.extras ?? [],
    callbacks: patch.callback
      ? [...(pet.plan.callbacks ?? []), patch.callback]
      : pet.plan.callbacks ?? [],
  });
}

export async function saveReminderPlan(
  encounterId: string,
  plan: {
    overrides?: Record<string, ReminderPlanOverride>;
    extras?: ReminderPlanExtra[];
    callbacks?: ReminderPlanCallback[];
  }
): Promise<{ pets: VisitReminderPet[] }> {
  const { data } = await http.put<{ pets: VisitReminderPet[] }>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/reminders/plan`,
    { practiceId: pid(), ...plan }
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
