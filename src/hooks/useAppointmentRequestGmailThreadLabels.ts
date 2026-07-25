import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchGmailLabels,
  fetchGmailThread,
  appointmentListGmailPickerLabels,
  flattenUserLabels,
  getMessageLabelsForAppointmentList,
  prepareSidebarLabels,
  threadLabelIds,
  threadLabelIdsUnion,
  type GmailLabelNode,
  type GmailThreadMessage,
} from '../api/gmail';
import {
  fetchAppointmentRequestGmailLink,
  type AppointmentRequestSubmissionItem,
} from '../api/appointmentRequestSubmissions';
import {
  APPOINTMENT_REQUEST_MAILBOX,
  resolveApptRequestLabelIds,
  syncManagedApptRequestGmailLabels,
} from '../utils/gmailAppointmentRequestLabels';
import type {
  AppointmentRequestBookedApptSummary,
} from '../utils/appointmentRequestOnHold';
import type { AppointmentTypeCatalog } from '../utils/appointmentTypeSettings';

export type SubmissionGmailThreadLabels = {
  mailbox: string;
  threadId: string;
  messageId: string;
  labelIds: string[];
  labels: GmailLabelNode[];
};

export type AppointmentRequestGmailLabelContext = {
  typeCatalog?: AppointmentTypeCatalog | null;
  bookedApptMeta?: ReadonlyMap<number, AppointmentRequestBookedApptSummary>;
};

export type AppointmentRequestGmailThreadLabelsState = {
  bySubmissionId: Map<number, SubmissionGmailThreadLabels>;
  userLabels: GmailLabelNode[];
  labelById: Map<string, GmailLabelNode>;
  patchSubmission: (submissionId: number, entry: SubmissionGmailThreadLabels) => void;
  invalidateSubmission: (submissionId: number) => void;
};

/** Retry liaison-thread lookup while the notification email is still arriving in info@. */
const GMAIL_LINK_RETRY_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;

/** Only retry linking for submissions this recent (notification still in flight). */
const GMAIL_LINK_RETRY_MAX_AGE_MS = 30 * 60_000;

/** Cap parallel gmail-link + thread fetches so the list cannot flood the API. */
const GMAIL_LINK_MAX_CONCURRENT = 4;

/** Once lazy-linked (success or fail) this session — do not re-hit on metadata refresh. */
const gmailLinkAttemptedSession = new Set<number>();

/** Survives effect cleanup so in-flight fetches are not repeated on re-render. */
const gmailThreadCacheSession = new Map<number, SubmissionGmailThreadLabels>();
const gmailThreadSyncKeySession = new Map<number, string>();
const gmailManagedLabelSyncKeySession = new Map<number, string>();

let gmailLinkActive = 0;
const gmailLinkWaiters: Array<() => void> = [];

async function withGmailLinkConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  while (gmailLinkActive >= GMAIL_LINK_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => gmailLinkWaiters.push(resolve));
  }
  gmailLinkActive += 1;
  try {
    return await fn();
  } finally {
    gmailLinkActive -= 1;
    const next = gmailLinkWaiters.shift();
    if (next) next();
  }
}

function shouldRetryGmailLink(submittedAt: string | undefined, attempt: number): boolean {
  if (GMAIL_LINK_RETRY_MS[attempt] == null) return false;
  if (!submittedAt?.trim()) return attempt === 0;
  const ageMs = Date.now() - Date.parse(submittedAt);
  if (!Number.isFinite(ageMs)) return attempt === 0;
  return ageMs <= GMAIL_LINK_RETRY_MAX_AGE_MS;
}

async function resolveGmailLinkWithRetry(
  submissionId: number,
  attempt: number,
  submittedAt?: string,
): Promise<{ threadId: string | null; mailbox: string }> {
  const mailbox = APPOINTMENT_REQUEST_MAILBOX;
  try {
    const link = await withGmailLinkConcurrency(() =>
      fetchAppointmentRequestGmailLink(submissionId),
    );
    const threadId = link.threadId?.trim() || null;
    if (threadId) {
      return { threadId, mailbox: link.mailbox?.trim() || mailbox };
    }
  } catch {
    /* retry below for very recent submissions only */
  }

  if (!shouldRetryGmailLink(submittedAt, attempt)) {
    return { threadId: null, mailbox };
  }
  await sleep(GMAIL_LINK_RETRY_MS[attempt]!);
  return resolveGmailLinkWithRetry(submissionId, attempt + 1, submittedAt);
}

function walkLabelTree(nodes: readonly GmailLabelNode[], into: Map<string, GmailLabelNode>): void {
  for (const node of nodes) {
    into.set(node.id, node);
    if (node.children?.length) walkLabelTree(node.children, into);
  }
}

function buildLabelCatalog(labels: GmailLabelNode[]): {
  labelById: Map<string, GmailLabelNode>;
  userLabels: GmailLabelNode[];
} {
  const labelById = new Map<string, GmailLabelNode>();
  walkLabelTree(labels, labelById);
  const sidebar = prepareSidebarLabels(labels);
  walkLabelTree(sidebar.navigation, labelById);
  walkLabelTree(sidebar.userLabels, labelById);
  return {
    labelById,
    userLabels: appointmentListGmailPickerLabels(flattenUserLabels(sidebar.userLabels), labelById),
  };
}

function itemSyncKey(item: AppointmentRequestSubmissionItem): string {
  return `${item.gmailThreadId ?? ''}:${item.updated ?? ''}:${item.linkedVisitPoints ?? ''}`;
}

/** Drives thread fetch/link only — excludes linkedVisitPoints so metadata hydration does not re-fetch Gmail. */
function itemThreadFetchKey(item: AppointmentRequestSubmissionItem): string {
  return `${item.id}:${item.gmailThreadId ?? ''}:${item.updated ?? ''}`;
}

function itemManagedLabelKey(
  item: AppointmentRequestSubmissionItem,
  ctx?: AppointmentRequestGmailLabelContext,
): string {
  const apptId = item.bookedAppointmentId;
  const metaPoints =
    apptId != null ? ctx?.bookedApptMeta?.get(Number(apptId))?.points : undefined;
  return [
    item.id,
    item.status ?? 'new',
    item.linkedVisitPoints ?? '',
    metaPoints ?? '',
    item.gmailThreadId ?? '',
  ].join(':');
}

function latestThreadMessage(messages: readonly GmailThreadMessage[]): GmailThreadMessage | null {
  if (messages.length === 0) return null;
  let latest = messages[0]!;
  let latestTs = Date.parse(latest.date ?? '') || 0;
  for (const message of messages.slice(1)) {
    const ts = Date.parse(message.date ?? '') || 0;
    if (ts >= latestTs) {
      latest = message;
      latestTs = ts;
    }
  }
  return latest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** The Scout-managed outcome/hold label ids (BOOKED / NOT BOOKED / Contacted / ON HOLD). */
function managedLabelIdSet(userLabels: GmailLabelNode[]): Set<string> {
  const ids = resolveApptRequestLabelIds(userLabels);
  return new Set(
    [ids.booked, ids.notBooked, ids.contacted, ids.onHold].filter(
      (id): id is string => Boolean(id),
    ),
  );
}

/**
 * Labels to show on the Scout card: non-managed labels come from the whole
 * conversation (union across messages), while managed outcome/hold labels follow
 * the newest message so ON HOLD / NOT BOOKED stay accurate instead of showing a
 * stale copy left on an older message.
 */
function buildDisplayLabelIds(
  nonManagedSourceIds: readonly string[],
  latestLabelIds: readonly string[],
  managedIds: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const id of nonManagedSourceIds) {
    if (!managedIds.has(id)) out.add(id);
  }
  for (const id of latestLabelIds) {
    if (managedIds.has(id)) out.add(id);
  }
  return [...out];
}

/** Load Gmail user labels for appointment-request threads shown in Scout. */
export function useAppointmentRequestGmailThreadLabels(
  items: AppointmentRequestSubmissionItem[],
  enabled: boolean,
  onGmailLinkResolved?: (submissionId: number, patch: { gmailThreadId: string; gmailMailbox: string }) => void,
  labelContext?: AppointmentRequestGmailLabelContext,
): AppointmentRequestGmailThreadLabelsState {
  const [bySubmissionId, setBySubmissionId] = useState<Map<number, SubmissionGmailThreadLabels>>(
    () => new Map(),
  );
  const [catalogReady, setCatalogReady] = useState(false);
  const [userLabels, setUserLabels] = useState<GmailLabelNode[]>([]);
  const labelByIdRef = useRef<Map<string, GmailLabelNode>>(new Map());
  const cacheRef = useRef<Map<number, SubmissionGmailThreadLabels>>(new Map());
  const syncKeyRef = useRef<Map<number, string>>(new Map());
  const managedLabelSyncKeyRef = useRef<Map<number, string>>(new Map());
  const threadFetchGenerationRef = useRef(0);
  const managedLabelGenerationRef = useRef(0);
  const onGmailLinkResolvedRef = useRef(onGmailLinkResolved);
  const labelContextRef = useRef(labelContext);
  const userLabelsRef = useRef(userLabels);
  onGmailLinkResolvedRef.current = onGmailLinkResolved;
  labelContextRef.current = labelContext;
  userLabelsRef.current = userLabels;

  const fetchItems = useMemo(
    () => items.filter((item) => item.kind !== 'abandoned'),
    [items],
  );

  const itemThreadFetchKeys = useMemo(
    () => fetchItems.map((item) => itemThreadFetchKey(item)).join('|'),
    [fetchItems],
  );

  const commit = useCallback((submissionId: number, entry: SubmissionGmailThreadLabels, syncKey: string) => {
    gmailThreadCacheSession.set(submissionId, entry);
    gmailThreadSyncKeySession.set(submissionId, syncKey);
    cacheRef.current.set(submissionId, entry);
    syncKeyRef.current.set(submissionId, syncKey);
    setBySubmissionId(new Map(cacheRef.current));
  }, []);

  const patchSubmission = useCallback(
    (submissionId: number, entry: SubmissionGmailThreadLabels) => {
      const syncKey = syncKeyRef.current.get(submissionId) ?? `${entry.threadId}:`;
      commit(submissionId, entry, syncKey);
    },
    [commit],
  );

  const invalidateSubmission = useCallback((submissionId: number) => {
    syncKeyRef.current.delete(submissionId);
    managedLabelSyncKeyRef.current.delete(submissionId);
    gmailThreadSyncKeySession.delete(submissionId);
    gmailManagedLabelSyncKeySession.delete(submissionId);
    gmailThreadCacheSession.delete(submissionId);
    cacheRef.current.delete(submissionId);
    gmailLinkAttemptedSession.delete(submissionId);
    setBySubmissionId(new Map(cacheRef.current));
  }, []);

  const applyManagedLabels = useCallback(
    async (
      item: AppointmentRequestSubmissionItem,
      mailbox: string,
      threadId: string,
      messageId: string,
      labelIds: string[],
    ): Promise<string[]> => {
      const ctx = labelContextRef.current;
      const synced = await syncManagedApptRequestGmailLabels({
        mailbox,
        message: { id: messageId, threadId, labelIds },
        submission: item,
        userLabels: userLabelsRef.current,
        bookedApptMeta: ctx?.bookedApptMeta,
        typeCatalog: ctx?.typeCatalog,
      });
      return synced ?? labelIds;
    },
    [],
  );
  const applyManagedLabelsRef = useRef(applyManagedLabels);
  applyManagedLabelsRef.current = applyManagedLabels;

  useEffect(() => {
    if (!enabled) {
      setCatalogReady(false);
      setUserLabels([]);
      labelByIdRef.current = new Map();
      return;
    }

    let cancelled = false;
    void fetchGmailLabels(APPOINTMENT_REQUEST_MAILBOX)
      .then(({ labels }) => {
        if (cancelled) return;
        const catalog = buildLabelCatalog(labels);
        labelByIdRef.current = catalog.labelById;
        setUserLabels(catalog.userLabels);
        setCatalogReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          labelByIdRef.current = new Map();
          setUserLabels([]);
          setCatalogReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !catalogReady || fetchItems.length === 0) return;

    const generation = ++threadFetchGenerationRef.current;
    const labelById = labelByIdRef.current;
    const isStale = () => generation !== threadFetchGenerationRef.current;

    for (const item of fetchItems) {
      void (async () => {
        const submissionId = item.id;
        const syncKey = itemSyncKey(item);

        const sessionCached = gmailThreadCacheSession.get(submissionId);
        if (sessionCached && !cacheRef.current.has(submissionId)) {
          cacheRef.current.set(submissionId, sessionCached);
          const sessionSync = gmailThreadSyncKeySession.get(submissionId);
          if (sessionSync) syncKeyRef.current.set(submissionId, sessionSync);
        }

        if (syncKeyRef.current.get(submissionId) === syncKey && cacheRef.current.has(submissionId)) {
          return;
        }

        const itemThreadId = item.gmailThreadId?.trim() || '';
        const cached = cacheRef.current.get(submissionId);
        if (
          cached?.threadId &&
          itemThreadId &&
          cached.threadId === itemThreadId &&
          syncKeyRef.current.get(submissionId) === syncKey
        ) {
          return;
        }

        let threadId = item.gmailThreadId?.trim() || null;
        let mailbox = item.gmailMailbox?.trim() || APPOINTMENT_REQUEST_MAILBOX;

        if (!threadId) {
          if (gmailLinkAttemptedSession.has(submissionId)) {
            if (syncKeyRef.current.get(submissionId) !== syncKey) {
              syncKeyRef.current.set(submissionId, syncKey);
            }
            return;
          }
          gmailLinkAttemptedSession.add(submissionId);
          const resolved = await resolveGmailLinkWithRetry(
            submissionId,
            0,
            item.submittedAt,
          );
          if (isStale()) return;
          threadId = resolved.threadId;
          mailbox = resolved.mailbox;
          if (threadId) {
            onGmailLinkResolvedRef.current?.(submissionId, {
              gmailThreadId: threadId,
              gmailMailbox: mailbox,
            });
          } else {
            commit(
              submissionId,
              { mailbox, threadId: '', messageId: '', labelIds: [], labels: [] },
              syncKey,
            );
            return;
          }
        }

        if (cached?.threadId === threadId && cached.messageId) {
          if (syncKeyRef.current.get(submissionId) !== syncKey) {
            syncKeyRef.current.set(submissionId, syncKey);
          }
          return;
        }

        const resolvedSyncKey = itemSyncKey({ ...item, gmailThreadId: threadId ?? undefined });

        try {
          const thread = await withGmailLinkConcurrency(() =>
            fetchGmailThread(mailbox, threadId!),
          );
          if (isStale()) return;
          const messages = thread.messages ?? [];
          let labelIds = threadLabelIds(messages);
          const unionLabelIds = threadLabelIdsUnion(messages);
          const latest = latestThreadMessage(messages);
          const messageId = latest?.id ?? '';

          if (messageId) {
            labelIds = await applyManagedLabelsRef.current(
              item,
              mailbox,
              threadId,
              messageId,
              labelIds,
            );
          }

          if (isStale()) return;
          const displayLabelIds = buildDisplayLabelIds(
            unionLabelIds,
            labelIds,
            managedLabelIdSet(userLabelsRef.current),
          );
          const labels = getMessageLabelsForAppointmentList(displayLabelIds, labelById);
          commit(
            submissionId,
            {
              mailbox,
              threadId,
              messageId,
              labelIds,
              labels,
            },
            resolvedSyncKey,
          );
        } catch {
          if (isStale()) return;
          commit(
            submissionId,
            { mailbox, threadId, messageId: '', labelIds: [], labels: [] },
            resolvedSyncKey,
          );
        }
      })();
    }

    return () => {
      threadFetchGenerationRef.current += 1;
    };
  }, [enabled, catalogReady, itemThreadFetchKeys, commit]);

  const managedLabelItemKeys = useMemo(
    () => fetchItems.map((item) => itemManagedLabelKey(item, labelContext)).join('|'),
    [fetchItems, labelContext],
  );

  /** Re-apply managed labels when hold metadata hydrates after the thread was first linked. */
  useEffect(() => {
    if (!enabled || !catalogReady || fetchItems.length === 0) return;

    const generation = ++managedLabelGenerationRef.current;
    const labelById = labelByIdRef.current;
    const ctx = labelContextRef.current;
    const isStale = () => generation !== managedLabelGenerationRef.current;

    for (const item of fetchItems) {
      const cached = cacheRef.current.get(item.id);
      if (!cached?.threadId || !cached.messageId) continue;

      const managedKey = itemManagedLabelKey(item, ctx);
      const priorManagedKey = managedLabelSyncKeyRef.current.get(item.id);
      const sessionManagedKey = gmailManagedLabelSyncKeySession.get(item.id);
      if (priorManagedKey === managedKey || sessionManagedKey === managedKey) continue;

      void (async () => {
        const labelIds = await applyManagedLabelsRef.current(
          item,
          cached.mailbox,
          cached.threadId,
          cached.messageId,
          cached.labelIds,
        );
        if (isStale()) return;
        managedLabelSyncKeyRef.current.set(item.id, managedKey);
        gmailManagedLabelSyncKeySession.set(item.id, managedKey);

        if (labelIds.join(',') === cached.labelIds.join(',')) return;

        const managedIds = managedLabelIdSet(userLabelsRef.current);
        // Keep the conversation's non-managed chips that were already resolved.
        const priorNonManaged = cached.labels.map((label) => label.id);
        const displayLabelIds = buildDisplayLabelIds(priorNonManaged, labelIds, managedIds);
        const labels = getMessageLabelsForAppointmentList(displayLabelIds, labelById);
        const syncKey =
          syncKeyRef.current.get(item.id) ??
          itemSyncKey({ ...item, gmailThreadId: cached.threadId });
        commit(
          item.id,
          {
            ...cached,
            labelIds,
            labels,
          },
          syncKey,
        );
      })();
    }

    return () => {
      managedLabelGenerationRef.current += 1;
    };
  }, [
    enabled,
    catalogReady,
    managedLabelItemKeys,
    commit,
  ]);

  const labelById = useMemo(() => new Map(labelByIdRef.current), [catalogReady, userLabels]);

  return {
    bySubmissionId,
    userLabels,
    labelById,
    patchSubmission,
    invalidateSubmission,
  };
}
