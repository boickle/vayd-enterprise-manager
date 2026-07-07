import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchGmailLabels,
  fetchGmailThread,
  appointmentListGmailPickerLabels,
  flattenUserLabels,
  getMessageLabelsForAppointmentList,
  prepareSidebarLabels,
  threadLabelIds,
  type GmailLabelNode,
  type GmailThreadMessage,
} from '../api/gmail';
import {
  fetchAppointmentRequestGmailLink,
  type AppointmentRequestSubmissionItem,
} from '../api/appointmentRequestSubmissions';
import {
  APPOINTMENT_REQUEST_MAILBOX,
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

function labelContextKey(
  items: readonly AppointmentRequestSubmissionItem[],
  ctx?: AppointmentRequestGmailLabelContext,
): string {
  const meta = ctx?.bookedApptMeta;
  const metaPart = meta
    ? [...meta.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, s]) => `${id}:${s.points}`)
        .join(',')
    : '';
  return `${items.map((i) => `${i.id}:${i.linkedVisitPoints ?? ''}`).join('|')}|${metaPart}`;
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

async function resolveGmailLinkWithRetry(
  submissionId: number,
  attempt: number,
): Promise<{ threadId: string | null; mailbox: string }> {
  const mailbox = APPOINTMENT_REQUEST_MAILBOX;
  try {
    const link = await fetchAppointmentRequestGmailLink(submissionId);
    const threadId = link.threadId?.trim() || null;
    if (threadId) {
      return { threadId, mailbox: link.mailbox?.trim() || mailbox };
    }
  } catch {
    /* retry below */
  }

  const delay = GMAIL_LINK_RETRY_MS[attempt];
  if (delay == null) {
    return { threadId: null, mailbox };
  }
  await sleep(delay);
  return resolveGmailLinkWithRetry(submissionId, attempt + 1);
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
  const onGmailLinkResolvedRef = useRef(onGmailLinkResolved);
  const labelContextRef = useRef(labelContext);
  onGmailLinkResolvedRef.current = onGmailLinkResolved;
  labelContextRef.current = labelContext;

  const fetchItems = useMemo(
    () => items.filter((item) => item.kind !== 'abandoned'),
    [items],
  );

  const itemKeys = useMemo(
    () => fetchItems.map((item) => `${item.id}:${itemSyncKey(item)}`).join('|'),
    [fetchItems],
  );

  const managedLabelContextKey = useMemo(
    () => labelContextKey(fetchItems, labelContext),
    [fetchItems, labelContext],
  );

  const commit = useCallback((submissionId: number, entry: SubmissionGmailThreadLabels, syncKey: string) => {
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
    cacheRef.current.delete(submissionId);
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
        userLabels,
        bookedApptMeta: ctx?.bookedApptMeta,
        typeCatalog: ctx?.typeCatalog,
      });
      return synced ?? labelIds;
    },
    [userLabels],
  );

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

    const labelById = labelByIdRef.current;
    let cancelled = false;

    for (const item of fetchItems) {
      void (async () => {
        const submissionId = item.id;
        const syncKey = itemSyncKey(item);

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
          const resolved = await resolveGmailLinkWithRetry(submissionId, 0);
          if (cancelled) return;
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

        const resolvedSyncKey = `${threadId}:${item.updated ?? ''}:${item.linkedVisitPoints ?? ''}`;

        try {
          const thread = await fetchGmailThread(mailbox, threadId);
          if (cancelled) return;
          const messages = thread.messages ?? [];
          let labelIds = threadLabelIds(messages);
          const latest = latestThreadMessage(messages);
          const messageId = latest?.id ?? '';

          if (messageId) {
            labelIds = await applyManagedLabels(item, mailbox, threadId, messageId, labelIds);
          }

          if (cancelled) return;
          const labels = getMessageLabelsForAppointmentList(labelIds, labelById);
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
          if (cancelled) return;
          commit(
            submissionId,
            { mailbox, threadId, messageId: '', labelIds: [], labels: [] },
            resolvedSyncKey,
          );
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [enabled, catalogReady, itemKeys, fetchItems, commit, applyManagedLabels]);

  /** Re-apply managed labels when hold metadata hydrates after the thread was first linked. */
  useEffect(() => {
    if (!enabled || !catalogReady || fetchItems.length === 0) return;

    const labelById = labelByIdRef.current;
    let cancelled = false;

    for (const item of fetchItems) {
      const cached = cacheRef.current.get(item.id);
      if (!cached?.threadId || !cached.messageId) continue;

      void (async () => {
        const labelIds = await applyManagedLabels(
          item,
          cached.mailbox,
          cached.threadId,
          cached.messageId,
          cached.labelIds,
        );
        if (cancelled) return;
        if (labelIds.join(',') === cached.labelIds.join(',')) return;

        const labels = getMessageLabelsForAppointmentList(labelIds, labelById);
        const syncKey =
          syncKeyRef.current.get(item.id) ??
          `${cached.threadId}:${item.updated ?? ''}:${item.linkedVisitPoints ?? ''}`;
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
      cancelled = true;
    };
  }, [enabled, catalogReady, managedLabelContextKey, fetchItems, commit, applyManagedLabels]);

  const labelById = useMemo(() => new Map(labelByIdRef.current), [catalogReady, userLabels]);

  return {
    bySubmissionId,
    userLabels,
    labelById,
    patchSubmission,
    invalidateSubmission,
  };
}
