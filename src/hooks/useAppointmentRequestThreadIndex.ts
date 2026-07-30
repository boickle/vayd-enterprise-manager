import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  fetchAllAppointmentRequestSubmissions,
  fetchAppointmentRequestGmailLink,
  type AppointmentRequestSubmissionItem,
} from '../api/appointmentRequestSubmissions';
import {
  appointmentRequestIdFromNotificationSubject,
  clientDisplayNameFromRequestData,
  clientNameFromAppointmentRequestSubject,
  isAppointmentRequestNotificationSubject,
  petListsMatchForSubmission,
  petSummaryFromAppointmentRequestSubject,
  requestDataEmail,
  requestDataPetSummary,
} from '../utils/appointmentRequestDisplay';
import type { GmailMessageSummary } from '../api/gmail';
import { extractEmailsFromText, normalizeEmail } from '../utils/gmailEmailExtract';

/** How far back to load submissions when building the reverse (thread → submission) index. */
const LOOKBACK_DAYS = 180;

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function normalizeThreadId(id: string | null | undefined): string | null {
  const t = (id ?? '').trim();
  return t || null;
}

function messageCandidateEmails(message: GmailMessageSummary): string[] {
  const out: string[] = [];
  const from = normalizeEmail(message.from?.email);
  if (from) out.push(from);
  for (const to of message.to ?? []) {
    const e = normalizeEmail(to.email);
    if (e) out.push(e);
  }
  return out;
}

function normalizeName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return n || null;
}

/** From candidates sharing an email/name, choose the submission closest in time. */
function pickClosest(
  list: AppointmentRequestSubmissionItem[] | undefined,
  messageTime: number
): AppointmentRequestSubmissionItem | null {
  if (!list || list.length === 0) return null;
  if (list.length === 1 || !Number.isFinite(messageTime)) return list[0]!;
  let best = list[0]!;
  let bestDelta = Math.abs(new Date(best.submittedAt).getTime() - messageTime);
  for (const item of list.slice(1)) {
    const delta = Math.abs(new Date(item.submittedAt).getTime() - messageTime);
    if (delta < bestDelta) {
      best = item;
      bestDelta = delta;
    }
  }
  return best;
}

export type AppointmentRequestThreadIndex = {
  loading: boolean;
  ready: boolean;
  /**
   * Resolve the linked submission for an open Gmail thread, or null.
   * `extraEmails` lets callers pass emails scraped from the thread body — the
   * request notification is sent from/to info@, so the requester's real address
   * only appears in the body, not the headers.
   */
  resolve: (
    message: GmailMessageSummary | null | undefined,
    extraEmails?: readonly string[]
  ) => AppointmentRequestSubmissionItem | null;
  /**
   * Resolve and persist gmailThreadId for one submission (server Gmail search).
   * Called on demand for the open thread — not bulk-backfilled on inbox load.
   */
  ensureGmailLink: (submissionId: number) => void;
  /** Merge an updated submission back into the index after an action. */
  applyLocalUpdate: (item: AppointmentRequestSubmissionItem) => void;
  /**
   * When a liaison notification is open but not linked yet, resolve heuristically and
   * lazily persist gmailThreadId via the server Gmail search.
   */
  proactivelyLinkNotification: (
    message: GmailMessageSummary | null | undefined,
    extraEmails?: readonly string[],
  ) => void;
  refresh: () => void;
};

/**
 * Loads recent appointment-request submissions and indexes them by `gmailThreadId`
 * (primary). Gmail thread ids are resolved lazily via GET …/gmail-link for the
 * submission tied to the open thread only. Email/subject heuristics are legacy fallback.
 */
export function useAppointmentRequestThreadIndex(enabled: boolean): AppointmentRequestThreadIndex {
  const [items, setItems] = useState<AppointmentRequestSubmissionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const localOverrides = useRef<Map<number, AppointmentRequestSubmissionItem>>(new Map());
  const gmailLinkAttemptedRef = useRef<Set<number>>(new Set());
  const gmailLinkInFlightRef = useRef<Set<number>>(new Set());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setReady(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const from = DateTime.now().minus({ days: LOOKBACK_DAYS }).toISODate() ?? undefined;
    // Omit `to` — passing today's ISO date makes the API treat it as midnight, which
    // excludes submissions created later the same day (the common local-test case).
    fetchAllAppointmentRequestSubmissions({ practiceId: PRACTICE_ID, from })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items ?? []);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setReady(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  const patchGmailLink = useCallback((item: AppointmentRequestSubmissionItem, link: {
    threadId: string;
    mailbox?: string | null;
    linkedAt?: string | null;
  }) => {
    const patch: AppointmentRequestSubmissionItem = {
      ...item,
      gmailThreadId: link.threadId.trim(),
      gmailMailbox: link.mailbox ?? item.gmailMailbox ?? null,
      gmailLinkedAt: link.linkedAt ?? item.gmailLinkedAt ?? null,
    };
    localOverrides.current.set(item.id, patch);
    setItems((prev) => prev.map((it) => (it.id === item.id ? patch : it)));
  }, []);

  const ensureGmailLink = useCallback(
    (submissionId: number) => {
      if (!enabled || !ready) return;
      if (
        gmailLinkAttemptedRef.current.has(submissionId) ||
        gmailLinkInFlightRef.current.has(submissionId)
      ) {
        return;
      }

      const item =
        localOverrides.current.get(submissionId) ??
        itemsRef.current.find((it) => it.id === submissionId);
      if (!item || item.kind === 'abandoned' || normalizeThreadId(item.gmailThreadId)) {
        return;
      }

      gmailLinkAttemptedRef.current.add(submissionId);
      gmailLinkInFlightRef.current.add(submissionId);

      void (async () => {
        try {
          const link = await fetchAppointmentRequestGmailLink(submissionId);
          if (!link.threadId?.trim()) return;
          const latest =
            localOverrides.current.get(submissionId) ??
            itemsRef.current.find((it) => it.id === submissionId) ??
            item;
          patchGmailLink(latest, {
            threadId: link.threadId,
            mailbox: link.mailbox,
            linkedAt: link.linkedAt,
          });
        } catch {
          /* server may not have Gmail search wired yet */
        } finally {
          gmailLinkInFlightRef.current.delete(submissionId);
        }
      })();
    },
    [enabled, ready, patchGmailLink],
  );

  const mergedItems = useMemo(() => {
    if (localOverrides.current.size === 0) return items;
    return items.map((it) => localOverrides.current.get(it.id) ?? it);
  }, [items]);

  const { byId, byThread, byEmail, byName } = useMemo(() => {
    const idMap = new Map<number, AppointmentRequestSubmissionItem>();
    const threadMap = new Map<string, AppointmentRequestSubmissionItem[]>();
    const emailMap = new Map<string, AppointmentRequestSubmissionItem[]>();
    const nameMap = new Map<string, AppointmentRequestSubmissionItem[]>();
    for (const item of mergedItems) {
      if (item.kind === 'abandoned') continue;
      idMap.set(Number(item.id), item);
      const threadId = normalizeThreadId(item.gmailThreadId);
      if (threadId) {
        const list = threadMap.get(threadId) ?? [];
        list.push(item);
        threadMap.set(threadId, list);
      }
      const email = normalizeEmail(requestDataEmail(item.requestData ?? {}));
      if (email) {
        const list = emailMap.get(email) ?? [];
        list.push(item);
        emailMap.set(email, list);
      }
      const name = normalizeName(clientDisplayNameFromRequestData(item.requestData ?? {}));
      if (name) {
        const list = nameMap.get(name) ?? [];
        list.push(item);
        nameMap.set(name, list);
      }
    }
    const newestFirst = (
      a: AppointmentRequestSubmissionItem,
      b: AppointmentRequestSubmissionItem
    ) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    for (const list of emailMap.values()) list.sort(newestFirst);
    for (const list of nameMap.values()) list.sort(newestFirst);
    for (const list of threadMap.values()) list.sort(newestFirst);
    return { byId: idMap, byThread: threadMap, byEmail: emailMap, byName: nameMap };
  }, [mergedItems]);

  const resolve = useCallback(
    (
      message: GmailMessageSummary | null | undefined,
      extraEmails?: readonly string[]
    ): AppointmentRequestSubmissionItem | null => {
      if (!message) return null;
      // New liaison subjects carry the submission id, making this association
      // exact even when Gmail groups repeated client/pet requests together.
      const subjectSubmissionId = appointmentRequestIdFromNotificationSubject(message.subject);
      if (subjectSubmissionId != null) {
        return byId.get(subjectSubmissionId) ?? null;
      }

      const threadId = normalizeThreadId(message.threadId);
      const messageTime = new Date(message.date).getTime();
      const candidates = new Map<number, AppointmentRequestSubmissionItem>();
      for (const item of (threadId ? byThread.get(threadId) : undefined) ?? []) {
        candidates.set(Number(item.id), item);
      }

      // Legacy fallback while older rows lack gmailThreadId — remove once linking is reliable.
      // Never borrow a submission already linked to a different Gmail thread.
      const candidatesForThisThread = (
        rows: AppointmentRequestSubmissionItem[] | undefined,
      ) =>
        rows?.filter((item) => {
          const linkedThread = normalizeThreadId(item.gmailThreadId);
          return !linkedThread || linkedThread === threadId;
        });
      const emails = [
        ...messageCandidateEmails(message),
        ...(extraEmails ?? []).map((e) => normalizeEmail(e)).filter((e): e is string => !!e),
      ];
      for (const email of emails) {
        for (const item of candidatesForThisThread(byEmail.get(email)) ?? []) {
          candidates.set(Number(item.id), item);
        }
      }
      const subjectClient = clientNameFromAppointmentRequestSubject(message.subject);
      if (subjectClient) {
        const subjectPet = petSummaryFromAppointmentRequestSubject(message.subject);
        let nameCandidates = candidatesForThisThread(byName.get(subjectClient));
        if (nameCandidates && subjectPet) {
          const filtered = nameCandidates.filter((item) =>
            petListsMatchForSubmission(subjectPet, requestDataPetSummary(item.requestData ?? {})),
          );
          if (filtered.length > 0) {
            nameCandidates = filtered;
          } else if (nameCandidates.length === 1) {
            // Trust a unique name match when pet strings differ only by formatting.
            nameCandidates = nameCandidates;
          }
        }
        for (const item of nameCandidates ?? []) {
          candidates.set(Number(item.id), item);
        }
      }
      return pickClosest([...candidates.values()], messageTime);
    },
    [byId, byThread, byEmail, byName]
  );

  const proactivelyLinkNotification = useCallback(
    (
      message: GmailMessageSummary | null | undefined,
      extraEmails?: readonly string[],
    ) => {
      if (!enabled || !ready || !message) return;
      const matched = resolve(message, extraEmails);
      if (matched) {
        if (!normalizeThreadId(matched.gmailThreadId)) {
          ensureGmailLink(matched.id);
        }
        return;
      }
      if (!isAppointmentRequestNotificationSubject(message.subject)) return;
      const subjectClient = clientNameFromAppointmentRequestSubject(message.subject);
      if (!subjectClient) return;
      const candidates = byName.get(subjectClient);
      if (!candidates?.length) return;
      for (const item of candidates) {
        if (!normalizeThreadId(item.gmailThreadId)) {
          ensureGmailLink(item.id);
        }
      }
    },
    [enabled, ready, resolve, ensureGmailLink, byName],
  );

  const applyLocalUpdate = useCallback((item: AppointmentRequestSubmissionItem) => {
    localOverrides.current.set(item.id, item);
    setItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
  }, []);

  const refresh = useCallback(() => {
    localOverrides.current.clear();
    // Keep gmailLinkAttemptedRef — avoid re-hitting gmail-link for rows already tried.
    setReloadKey((k) => k + 1);
  }, []);

  return {
    loading,
    ready,
    resolve,
    ensureGmailLink,
    applyLocalUpdate,
    proactivelyLinkNotification,
    refresh,
  };
}
