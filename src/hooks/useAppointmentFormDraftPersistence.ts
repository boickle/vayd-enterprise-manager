import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import {
  APPOINTMENT_FORM_DRAFTS_ENABLED,
  abandonAppointmentFormDraft,
  getAppointmentFormAbandonIdleMs,
  keepaliveAppointmentFormAbandon,
  toAbandonReason,
  upsertAppointmentFormDraft,
  type AppointmentFormDraftAbandonReason,
} from '../api/appointmentFormDrafts';
import {
  buildAppointmentFormDraftSnapshot,
  getAppointmentFormClientType,
  shouldPersistAppointmentFormDraft,
  type AppointmentFormDraftSnapshotInput,
} from '../utils/appointmentFormDraftSnapshot';

const APPOINTMENT_FORM_PATH = '/client-portal/request-appointment';

export function createAppointmentFormSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `appt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type UseAppointmentFormDraftPersistenceArgs = {
  practiceId: number;
  currentPage: string;
  getSnapshotInput: () => AppointmentFormDraftSnapshotInput;
  getStepName: (step: string) => string;
  trackGaAbandon: (reason: string) => void;
};

/**
 * Appointment form draft PUT (debounced) + abandon per API integration doc.
 */
export function useAppointmentFormDraftPersistence({
  practiceId,
  currentPage,
  getSnapshotInput,
  getStepName,
  trackGaAbandon,
}: UseAppointmentFormDraftPersistenceArgs) {
  const location = useLocation();
  const formSessionIdRef = useRef(createAppointmentFormSessionId());
  const formCompletedRef = useRef(false);
  const abandonApiSentRef = useRef(false);
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleAbandonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageRef = useRef(currentPage);
  const pathnameRef = useRef(location.pathname);
  currentPageRef.current = currentPage;

  const shouldPersistDraft = useCallback(() => {
    return shouldPersistAppointmentFormDraft(currentPageRef.current, getSnapshotInput());
  }, [getSnapshotInput]);

  const buildDraftData = useCallback(
    () => buildAppointmentFormDraftSnapshot(getSnapshotInput()),
    [getSnapshotInput]
  );

  const buildUpsertBody = useCallback(() => {
    const page = currentPageRef.current;
    const input = getSnapshotInput();
    return {
      formSessionId: formSessionIdRef.current,
      practiceId,
      currentStep: page,
      currentStepName: getStepName(page),
      clientType: getAppointmentFormClientType(input.haveUsedServicesBefore, !!input.isLoggedIn),
      isLoggedIn: !!input.isLoggedIn,
      draftData: buildDraftData(),
    };
  }, [practiceId, getSnapshotInput, getStepName, buildDraftData]);

  const buildAbandonBody = useCallback(
    (reason: AppointmentFormDraftAbandonReason) => {
      const page = currentPageRef.current;
      const input = getSnapshotInput();
      return {
        formSessionId: formSessionIdRef.current,
        practiceId,
        abandonReason: reason,
        currentStep: page,
        currentStepName: getStepName(page),
        clientType: getAppointmentFormClientType(input.haveUsedServicesBefore, !!input.isLoggedIn),
        isLoggedIn: !!input.isLoggedIn,
        draftData: buildDraftData(),
      };
    },
    [practiceId, getSnapshotInput, getStepName, buildDraftData]
  );

  const flushDraftSave = useCallback(async () => {
    if (!APPOINTMENT_FORM_DRAFTS_ENABLED || formCompletedRef.current) return;
    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current);
      draftSaveTimeoutRef.current = null;
    }
    if (!shouldPersistDraft()) return;
    try {
      await upsertAppointmentFormDraft(buildUpsertBody());
    } catch (err) {
      console.warn('[AppointmentForm] Failed to save draft:', err);
    }
  }, [shouldPersistDraft, buildUpsertBody]);

  const scheduleDraftSave = useCallback(() => {
    if (!APPOINTMENT_FORM_DRAFTS_ENABLED) return;
    if (!shouldPersistDraft()) return;
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
    draftSaveTimeoutRef.current = setTimeout(() => {
      void flushDraftSave();
    }, 4000);
  }, [flushDraftSave, shouldPersistDraft]);

  const clearIdleAbandonTimer = useCallback(() => {
    if (idleAbandonTimeoutRef.current) {
      clearTimeout(idleAbandonTimeoutRef.current);
      idleAbandonTimeoutRef.current = null;
    }
  }, []);

  const postAbandonXhr = useCallback(async (body: ReturnType<typeof buildAbandonBody>) => {
    const res = await abandonAppointmentFormDraft(body);
    if (import.meta.env.DEV) {
      console.info('[AppointmentForm] abandon response', res);
    }
    return res;
  }, []);

  const sendAbandon = useCallback(
    async (reason: string, options?: { awaitPutThenPost?: boolean }) => {
      if (!APPOINTMENT_FORM_DRAFTS_ENABLED || formCompletedRef.current || abandonApiSentRef.current) {
        return;
      }
      if (!shouldPersistDraft()) return;

      clearIdleAbandonTimer();
      abandonApiSentRef.current = true;
      const apiReason = toAbandonReason(reason);
      trackGaAbandon(reason);

      if (options?.awaitPutThenPost) {
        await flushDraftSave();
        const body = buildAbandonBody(apiReason);
        try {
          await postAbandonXhr(body);
        } catch (err) {
          abandonApiSentRef.current = false;
          console.warn('[AppointmentForm] Failed to report abandon:', err);
        }
        return;
      }

      const body = buildAbandonBody(apiReason);

      if (reason === 'page_hide') {
        keepaliveAppointmentFormAbandon(body);
        void postAbandonXhr(body).catch((err) => {
          console.warn('[AppointmentForm] Failed to report abandon (page_hide xhr):', err);
        });
        return;
      }

      void postAbandonXhr(body).catch((err) => {
        abandonApiSentRef.current = false;
        console.warn('[AppointmentForm] Failed to report abandon:', err);
      });
    },
    [
      shouldPersistDraft,
      trackGaAbandon,
      flushDraftSave,
      buildAbandonBody,
      postAbandonXhr,
      clearIdleAbandonTimer,
    ]
  );

  const scheduleIdleAbandon = useCallback(() => {
    const idleMs = getAppointmentFormAbandonIdleMs();
    if (!APPOINTMENT_FORM_DRAFTS_ENABLED || idleMs <= 0) return;
    if (formCompletedRef.current || abandonApiSentRef.current) return;
    if (!shouldPersistDraft()) {
      clearIdleAbandonTimer();
      return;
    }
    clearIdleAbandonTimer();
    idleAbandonTimeoutRef.current = setTimeout(() => {
      void sendAbandon('idle_timeout', { awaitPutThenPost: true });
    }, idleMs);
  }, [shouldPersistDraft, clearIdleAbandonTimer, sendAbandon]);

  const markFormCompleted = useCallback(() => {
    formCompletedRef.current = true;
    if (draftSaveTimeoutRef.current) {
      clearTimeout(draftSaveTimeoutRef.current);
      draftSaveTimeoutRef.current = null;
    }
    clearIdleAbandonTimer();
  }, [clearIdleAbandonTimer]);

  // Tab close / refresh — do NOT call abandon from React cleanup (Strict Mode fires fake unmount on mount).
  useEffect(() => {
    const onPageHide = () => {
      void sendAbandon('page_hide');
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [sendAbandon]);

  // SPA navigation away from the form route (visible POST in Network tab).
  useEffect(() => {
    const prev = pathnameRef.current;
    const next = location.pathname;
    pathnameRef.current = next;
    if (
      prev.includes(APPOINTMENT_FORM_PATH) &&
      !next.includes(APPOINTMENT_FORM_PATH) &&
      !formCompletedRef.current &&
      !abandonApiSentRef.current
    ) {
      void sendAbandon('component_unmount', { awaitPutThenPost: true });
    }
  }, [location.pathname, sendAbandon]);

  // PUT on step change when there is something to save.
  useEffect(() => {
    if (!APPOINTMENT_FORM_DRAFTS_ENABLED) return;
    if (!shouldPersistDraft()) return;
    void flushDraftSave();
  }, [currentPage, flushDraftSave, shouldPersistDraft]);

  // Debounced PUT while typing; reset idle abandon timer on activity.
  useEffect(() => {
    if (!APPOINTMENT_FORM_DRAFTS_ENABLED) return;
    scheduleDraftSave();
    scheduleIdleAbandon();
    return () => {
      if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current);
      clearIdleAbandonTimer();
    };
  }, [scheduleDraftSave, scheduleIdleAbandon, clearIdleAbandonTimer, currentPage, getSnapshotInput]);

  return {
    formSessionIdRef,
    markFormCompleted,
    flushDraftSave,
    sendAbandon,
    shouldPersistDraft,
  };
}
