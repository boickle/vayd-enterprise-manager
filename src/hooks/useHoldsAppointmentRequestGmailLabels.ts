import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HoldListItem } from '../api/holds';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import {
  fetchAppointmentRequestSubmission,
  type AppointmentRequestSubmissionItem,
} from '../api/appointmentRequestSubmissions';
import { buildAppointmentTypeCatalogFromTypes } from '../utils/forwardBookingListVisibility';
import { buildAppointmentRequestBookedMetaByAppointmentIds } from '../utils/appointmentRequestHouseholdHold';
import type { AppointmentRequestBookedApptSummary } from '../utils/appointmentRequestOnHold';
import { resolveHoldSubmissionId } from '../utils/holdsOpenInScheduler';
import type { AppointmentTypeCatalog } from '../utils/appointmentTypeSettings';
import { useAppointmentRequestGmailThreadLabels } from './useAppointmentRequestGmailThreadLabels';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const SUBMISSION_FETCH_CONCURRENCY = 6;

async function fetchSubmissionsByIds(
  ids: readonly number[],
): Promise<AppointmentRequestSubmissionItem[]> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return [];

  const results: AppointmentRequestSubmissionItem[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const id = unique[cursor++]!;
      try {
        results.push(await fetchAppointmentRequestSubmission(id));
      } catch {
        /* submission may have been removed */
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SUBMISSION_FETCH_CONCURRENCY, unique.length) }, () =>
      worker(),
    ),
  );
  return results;
}

/** Gmail label state for appointment-request holds on the Holds board. */
export function useHoldsAppointmentRequestGmailLabels(args: {
  holds: HoldListItem[];
  enabled: boolean;
}) {
  const { holds, enabled } = args;
  const [submissions, setSubmissions] = useState<AppointmentRequestSubmissionItem[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [typeCatalog, setTypeCatalog] = useState<AppointmentTypeCatalog | null>(null);
  const [bookedApptMeta, setBookedApptMeta] = useState<
    Map<number, AppointmentRequestBookedApptSummary>
  >(new Map());
  const fetchGenRef = useRef(0);

  const submissionIds = useMemo(() => {
    const ids = new Set<number>();
    for (const hold of holds) {
      const id = resolveHoldSubmissionId(hold);
      if (id != null) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  }, [holds]);

  const holdAppointmentIds = useMemo(
    () => [...new Set(holds.map((hold) => hold.id))].sort((a, b) => a - b),
    [holds],
  );

  useEffect(() => {
    if (!enabled || submissionIds.length === 0) {
      setSubmissions([]);
      setSubmissionsLoading(false);
      return;
    }

    const gen = ++fetchGenRef.current;
    setSubmissionsLoading(true);
    void fetchSubmissionsByIds(submissionIds)
      .then((items) => {
        if (gen !== fetchGenRef.current) return;
        setSubmissions(items);
      })
      .finally(() => {
        if (gen === fetchGenRef.current) setSubmissionsLoading(false);
      });
  }, [enabled, submissionIds.join(',')]);

  useEffect(() => {
    if (!enabled) {
      setTypeCatalog(null);
      return;
    }
    let cancelled = false;
    void fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false })
      .then((types) => {
        if (!cancelled) setTypeCatalog(buildAppointmentTypeCatalogFromTypes(types));
      })
      .catch(() => {
        if (!cancelled) setTypeCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !typeCatalog || holdAppointmentIds.length === 0) {
      setBookedApptMeta(new Map());
      return;
    }
    let cancelled = false;
    void buildAppointmentRequestBookedMetaByAppointmentIds({
      appointmentIds: holdAppointmentIds,
      practiceId: PRACTICE_ID,
      typeCatalog,
    }).then((meta) => {
      if (!cancelled) setBookedApptMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, typeCatalog, holdAppointmentIds.join(',')]);

  const gmailLabelContext = useMemo(
    () => ({ typeCatalog, bookedApptMeta }),
    [typeCatalog, bookedApptMeta],
  );

  const gmail = useAppointmentRequestGmailThreadLabels(
    submissions,
    enabled && submissions.length > 0,
    undefined,
    gmailLabelContext,
  );

  const submissionById = useMemo(() => {
    const map = new Map<number, AppointmentRequestSubmissionItem>();
    for (const item of submissions) map.set(item.id, item);
    return map;
  }, [submissions]);

  const gmailLabelsLoadingIds = useMemo(() => {
    if (!enabled) return new Set<number>();
    const pending = new Set<number>();
    for (const item of submissions) {
      if (!gmail.bySubmissionId.has(item.id)) pending.add(item.id);
    }
    return pending;
  }, [enabled, submissions, gmail.bySubmissionId]);

  const groupSubmissionIds = useCallback((holdsInGroup: HoldListItem[]): number[] => {
    const ids = new Set<number>();
    for (const hold of holdsInGroup) {
      const id = resolveHoldSubmissionId(hold);
      if (id != null) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  }, []);

  return {
    ...gmail,
    submissionById,
    submissionsLoading,
    gmailLabelsLoadingIds,
    groupSubmissionIds,
    typeCatalog,
    bookedApptMeta,
  };
}
