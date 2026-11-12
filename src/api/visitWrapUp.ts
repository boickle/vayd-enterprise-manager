// src/api/visitWrapUp.ts
// Visit wrap-up: the step after the SOAP where the household's charts are reviewed
// and the client recap email is sent (or deliberately skipped). Follow-up is
// settled on End Visit and checkout. Mirrors the backend wrap-up endpoints.
import { http } from './http';
import type { ForwardBookingDisposition } from './forwardBookingDisposition';
import {
  type HouseholdRosterEntry,
  type SoapEncounterMode,
  type SoapEncounterStatus,
} from './visitWorkflow';
import { currentPracticeId } from '../utils/practiceIdFromToken';

const pid = () => currentPracticeId();

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
  /** Record type; decides who may sign it (EMR-07). Older servers omit it: treat as a full SOAP. */
  mode?: SoapEncounterMode;
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
  /** An owner on this visit is marked "Do not email" (EMR-A4). Older servers omit it. */
  clientDoNotEmail?: boolean;
  provider: { id: number; name: string | null; email: string | null } | null;
  emailDraft: { subject: string; body: string };
  /**
   * The saved draft was written from the charts, and chart text, vitals, doses, sigs or follow-up
   * changed since (SCR-02). Older servers omit it: treat as fresh.
   */
  emailDraftStale?: boolean;
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
  if (!data || typeof data !== 'object') throw new Error('Could not load the visit wrap-up.');
  // Missing lists/draft from an odd response become empty ones instead of crashing the screen.
  return {
    ...data,
    clientEmails: Array.isArray(data.clientEmails) ? data.clientEmails : [],
    pets: Array.isArray(data.pets) ? data.pets : [],
    emailDraftStale: data.emailDraftStale === true,
    emailDraft: {
      subject: typeof data.emailDraft?.subject === 'string' ? data.emailDraft.subject : '',
      body: typeof data.emailDraft?.body === 'string' ? data.emailDraft.body : '',
    },
  };
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
  /** Applied when the chart is signed — drafts never create a task. */
  assignedToEmployeeId?: number | null;
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
  const { data } = await http.post<unknown>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/scribe/client-recap`,
    { practiceId: pid(), ...(patientIds?.length ? { patientIds } : {}) }
  );
  return normalizeClientRecap(data);
}

/**
 * The AI writer's answer is not trusted to have a shape: a missing or non-text subject/body
 * would otherwise land in page state and crash the screen. Anything unusable is an error the
 * caller shows, never a half-filled draft. Extra fields (pet breakdowns, usage) are ignored.
 */
export function normalizeClientRecap(data: unknown): { subject: string; body: string } {
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const subject = typeof obj?.subject === 'string' ? obj.subject : '';
  const body = typeof obj?.body === 'string' ? obj.body : '';
  if (!subject.trim() && !body.trim()) {
    throw new Error('The recap writer returned nothing usable. Try Regenerate again, or write the recap by hand.');
  }
  return { subject, body };
}

/**
 * Saves the recap draft. Goes to its own endpoint (not the SOAP PATCH) so a draft typed after
 * the chart is signed is kept: the recap is correspondence, not the medical record.
 */
export async function persistClientRecapDraft(
  encounterId: string,
  draft: { subject: string; body: string },
  /** `fromCharts`: the draft was just written from the charts (not a hand edit), so the server notes what they said. */
  opts?: { fromCharts?: boolean }
): Promise<void> {
  await http.put(`/soap-encounters/${encodeURIComponent(encounterId)}/recap-draft`, {
    practiceId: pid(),
    subject: draft.subject,
    body: draft.body,
    ...(opts?.fromCharts ? { fromCharts: true } : {}),
  });
}

const recapPrefetch = new Map<string, Promise<{ subject: string; body: string } | null>>();

/** Start (or reuse) recap generation so wrap-up is not waiting on a cold LLM call. */
export function prefetchClientRecap(
  encounterId: string,
  patientIds?: number[]
): Promise<{ subject: string; body: string } | null> {
  const existing = recapPrefetch.get(encounterId);
  if (existing) return existing;
  const run = (async () => {
    try {
      const data = await getVisitWrapUp(encounterId);
      if (data.clientEmailDelivery?.status) return data.emailDraft;
      if (data.emailDraft.subject.trim() || data.emailDraft.body.trim()) return data.emailDraft;
      const ids = patientIds?.length ? patientIds : data.pets.map((p) => p.patientId);
      const draft = await generateClientRecap(encounterId, ids);
      await persistClientRecapDraft(encounterId, draft, { fromCharts: true });
      return draft;
    } catch {
      recapPrefetch.delete(encounterId);
      return null;
    }
  })();
  recapPrefetch.set(encounterId, run);
  return run;
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
    /** Chronic meds whose "order from our store" block went out inside this recap. */
    storeMedRxIds?: number[];
    /** No recap, and the doctor unticked the separate ordering email for these meds. */
    storeMedsDeclinedRxIds?: number[];
  }
): Promise<VisitWrapUp> {
  const { data } = await http.post<VisitWrapUp>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/client-email`,
    { practiceId: pid(), ...body }
  );
  return data;
}

/** The recap's "order from our store" block for chronic meds added to these pets. */
export type StoreMedsBlock = { rxIds: number[]; html: string; text: string };

/** Null when none of these pets has a new chronic med we sell online. */
export async function fetchStoreMedsBlock(
  encounterId: string,
  patientIds: number[]
): Promise<StoreMedsBlock | null> {
  const { data } = await http.post<StoreMedsBlock | null | ''>(
    `/soap-encounters/${encodeURIComponent(encounterId)}/store-meds-block`,
    { practiceId: pid(), patientIds }
  );
  return data && typeof data === 'object' && Array.isArray(data.rxIds) && data.rxIds.length ? data : null;
}
