// src/pages/FillDay.tsx
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { http } from '../api/http';
import {
  fetchFillDayCandidates,
  type FillDayCandidate,
  type FillDayReminder,
  type FillDayRequest,
  type FillDayResponse,
  type FillDayStats,
} from '../api/routing';
import { patchReminder } from '../api/careOutreach';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { useAuth } from '../auth/useAuth';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import {
  buildRoutingForwardBookingIntentFromEntries,
  buildRoutingForwardBookingIntentFromEntry,
  writeRoutingForwardBookingIntent,
} from '../utils/routingForwardBookingIntent';
import { workingNotesFromReminders } from '../utils/reminderWorkingNotes';
import {
  createForwardBookingsFromScheduleLoader,
  scheduleLoaderCandidateHasPastDueReminders,
  scheduleLoaderRoutingSearchDateRange,
} from '../utils/scheduleLoaderForwardBooking';
import {
  readScheduleLoaderReturnSession,
  clearScheduleLoaderReturnSession,
} from '../utils/scheduleLoaderReturnSession';
import {
  buildScheduleLoaderBookedSmsMessage,
  providerLastNameFromDisplayName,
  resolveScheduleLoaderSmsBookedSlot,
} from '../utils/scheduleLoaderSmsMessage';
import { holdReleaseOptsForAppointment } from '../utils/forwardBookingSmsMessage';
import { careOutreachSmsToEmail } from '../utils/clientOutreachEmailMessage';
import { ClientEmailComposeModal } from '../components/ClientEmailComposeModal';
import { useGmailInboxAccess } from '../hooks/useGmailInboxAccess';
import {
  readAuthDoctorCache,
  writeAuthDoctorCache,
} from '../utils/routingUiSnapshot';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { fetchClientMessagesCached } from '../utils/clientMessagesCache';
import { fetchSchedulingOutreachSmsFrom } from '../api/clientSms';
import { BookPatientChartButton } from '../components/BookPatientChartButton';
import { ClientMessagesHistoryModal } from '../components/ClientMessagesHistoryModal';
import { ClientEmailHistoryModal } from '../components/ClientEmailHistoryModal';
import { SCHEDULING_TOOLS_PAGE_REFRESH_EVENT } from '../hooks/useSchedulingToolsNavCounts';
import SchedulingToolsListPagination, {
  paginateSchedulingToolsList,
  schedulingToolsListTotalPages,
} from '../components/SchedulingToolsListPagination';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const FILL_DAY_OUTREACH_NOTES_DEBOUNCE_MS = 750;
const FILL_DAY_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const FILL_DAY_PRACTICE_TZ = practiceTimeZoneOrDefault(undefined);

/** JSON often sends reminder ids as strings; normalize for state keys and PATCH. */
function fillDayReminderNumericId(r: FillDayReminder | Record<string, unknown>): number | null {
  const o = r as Record<string, unknown>;
  const raw = o.id ?? o.reminderId;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function initialFillDayReminderOutreachNotes(r: FillDayReminder): string {
  const any = r as Record<string, unknown>;
  const snake = typeof any.outreach_notes === 'string' ? any.outreach_notes : null;
  return String(r.outreachNotes ?? snake ?? r.notes ?? '') || '';
}

function fillDayReminderIsHidden(r: FillDayReminder | Record<string, unknown>): boolean {
  const o = r as Record<string, unknown>;
  if (typeof o.is_hidden === 'boolean') return o.is_hidden;
  return (r as FillDayReminder).isHidden === true;
}

function reminderPatchIsHidden(u: { isHidden?: boolean | null; [key: string]: unknown }): boolean | undefined {
  const any = u as Record<string, unknown>;
  if (typeof any.is_hidden === 'boolean') return any.is_hidden;
  if (typeof u.isHidden === 'boolean') return u.isHidden;
  return undefined;
}

function hasFillDayDeepLinkParams(searchParams: URLSearchParams): boolean {
  return Boolean(searchParams.get('doctorId')?.trim() && searchParams.get('targetDate')?.trim());
}

function mergeReminderFieldsIntoCandidates(
  list: FillDayCandidate[],
  reminderId: number,
  fields: Partial<{ outreachNotes: string; isHidden: boolean }>
): FillDayCandidate[] {
  return list.map((c) => ({
    ...c,
    reminders: (c.reminders ?? []).map((r) => {
      if (fillDayReminderNumericId(r) !== reminderId) return r;
      return { ...r, ...fields };
    }),
    patients: c.patients?.map((p) => ({
      ...p,
      reminders: (p.reminders ?? []).map((r) => {
        if (fillDayReminderNumericId(r) !== reminderId) return r;
        return { ...r, ...fields };
      }),
    })),
  }));
}

function findFillDayReminderInCandidates(
  list: FillDayCandidate[],
  reminderId: number
): FillDayReminder | undefined {
  for (const c of list) {
    for (const r of c.reminders ?? []) {
      if (fillDayReminderNumericId(r) === reminderId) return r;
    }
    for (const p of c.patients ?? []) {
      for (const r of p.reminders ?? []) {
        if (fillDayReminderNumericId(r) === reminderId) return r;
      }
    }
  }
  return undefined;
}

function findProviderForFillDoctorId(
  providers: Provider[],
  doctorId: string,
): Provider | undefined {
  const raw = doctorId.trim();
  if (!raw) return undefined;
  return providers.find((p) => String(p.id) === raw || String(p.pimsId ?? '') === raw);
}

function fillDoctorIdForProvider(provider: Provider): string {
  return provider.pimsId ? String(provider.pimsId) : String(provider.id);
}

function fillDayCacheUserId(userId: string | null | undefined): string | null {
  const uid = userId?.trim();
  if (uid) return uid;
  if (typeof localStorage === 'undefined') return null;
  try {
    const id = localStorage.getItem('vayd_clientId');
    return id?.trim() || null;
  } catch {
    return null;
  }
}

function persistFillDayDoctorCache(provider: Provider, userId: string | null | undefined): void {
  const cacheUserId = fillDayCacheUserId(userId);
  if (!cacheUserId) return;
  writeAuthDoctorCache(cacheUserId, fillDoctorIdForProvider(provider), provider.name);
}

function applyFillDayDoctorSelection(
  provider: Provider,
  cachedQuery?: string | null,
): { doctorId: string; name: string; query: string } {
  const doctorId = fillDoctorIdForProvider(provider);
  return {
    doctorId,
    name: provider.name,
    query: cachedQuery?.trim() || provider.name,
  };
}

function fillDayPreviewPatients(candidate: FillDayCandidate): { id: number; name: string }[] {
  if (candidate.patientIds.length > 0) {
    return candidate.patientIds.map((id, i) => ({
      id,
      name:
        candidate.patientNames[i]?.trim() ||
        candidate.patients?.find((p) => p.id === id)?.name?.trim() ||
        `Pet ${id}`,
    }));
  }
  if (candidate.patientId != null) {
    return [
      {
        id: candidate.patientId,
        name: candidate.patientName?.trim() || `Pet ${candidate.patientId}`,
      },
    ];
  }
  return [];
}

export default function FillDayPage() {
  const { userEmail, userId, doctorId: userDoctorId } = useAuth() as {
    userEmail?: string;
    userId?: string | null;
    doctorId?: string | null;
  };
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Doctor selection
  const [doctorQuery, setDoctorQuery] = useState('');
  const [allProviders, setAllProviders] = useState<Provider[]>([]);
  const [doctorResults, setDoctorResults] = useState<Provider[]>([]);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const [doctorActiveIdx, setDoctorActiveIdx] = useState(-1);
  const doctorBoxRef = useRef<HTMLDivElement | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedDoctorName, setSelectedDoctorName] = useState<string>('');

  // Date selection
  const [targetDate, setTargetDate] = useState<string>(
    DateTime.local().toISODate() || ''
  );

  // Options
  const [ignoreEmergencyBlocks, setIgnoreEmergencyBlocks] = useState(true);
  /** When false (default), reminders with isHidden are omitted from cards and SMS text. */
  const [showHiddenReminders, setShowHiddenReminders] = useState(false);

  // Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<FillDayCandidate[]>([]);
  const [listPage, setListPage] = useState(1);
  const [stats, setStats] = useState<FillDayStats | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [outreachNoteDrafts, setOutreachNoteDrafts] = useState<Record<number, string>>({});
  const [outreachNoteSaving, setOutreachNoteSaving] = useState<Record<number, boolean>>({});
  const [outreachNoteError, setOutreachNoteError] = useState<Record<number, string | null>>({});
  const outreachNoteDebounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const [reminderHiddenSaving, setReminderHiddenSaving] = useState<Record<number, boolean>>({});
  const [reminderHiddenError, setReminderHiddenError] = useState<Record<number, string | null>>({});

  // SMS sending state
  const [sendingSms, setSendingSms] = useState<Record<number, boolean>>({});
  const [smsError, setSmsError] = useState<Record<number, string | null>>({});
  const [smsSuccess, setSmsSuccess] = useState<Record<number, boolean>>({});
  
  // SMS confirmation modal state
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [pendingSmsCandidate, setPendingSmsCandidate] = useState<FillDayCandidate | null>(null);
  const [smsMessagePreview, setSmsMessagePreview] = useState<string>('');
  const [sendWithOverride, setSendWithOverride] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [pendingEmailCandidate, setPendingEmailCandidate] = useState<FillDayCandidate | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBodyText, setEmailBodyText] = useState('');
  const { allowed: canAccessGmailInbox } = useGmailInboxAccess();

  // Check if we're in production
  // Vite provides:
  // - import.meta.env.PROD (boolean) - true when building with 'vite build' (default mode=production)
  // - import.meta.env.MODE (string) - 'development', 'production', or custom mode set via --mode flag
  // - Custom VITE_IS_PROD env variable (must be set in .env file or build environment)
  // 
  // To show the "Send to Actual Client" button on QA/staging:
  // - Build with: npm run build -- --mode qa (or --mode staging, --mode development)
  // - Or set VITE_IS_PROD=false in .env file or build environment
  const viteIsProd = import.meta.env.VITE_IS_PROD === 'true';
  const viteProd = import.meta.env.PROD === true;
  const viteMode = import.meta.env.MODE;
  const isProductionMode = viteMode === 'production';
  
  // Consider it production if:
  // 1. VITE_IS_PROD is explicitly set to 'true', OR
  // 2. MODE is explicitly 'production' (most reliable check)
  // Note: We don't check PROD boolean alone because it can be inconsistent with custom modes
  const isProd = viteIsProd || isProductionMode;
  
  // Debug logging - always log to help debug QA issues
  console.log('[FillDay] Environment check:', {
    VITE_IS_PROD: import.meta.env.VITE_IS_PROD,
    PROD: import.meta.env.PROD,
    MODE: import.meta.env.MODE,
    viteIsProd,
    viteProd,
    isProductionMode,
    finalIsProd: isProd,
  });

  const [viewPlacementClientId, setViewPlacementClientId] = useState<number | null>(null);
  const [highlightClientId, setHighlightClientId] = useState<number | null>(null);


  // Messages / email history
  const [messagesClientId, setMessagesClientId] = useState<number | null>(null);
  const [messagesClientLabel, setMessagesClientLabel] = useState('');
  const [emailHistoryClientId, setEmailHistoryClientId] = useState<number | null>(null);
  const [emailHistoryClientLabel, setEmailHistoryClientLabel] = useState('');
  const [smsFromLine, setSmsFromLine] = useState<string | null>(null);
  const [messageCounts, setMessageCounts] = useState<Record<number, number>>({});

  // PDF export
  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const [exportingPDF, setExportingPDF] = useState(false);

  // Track if we've already processed URL params to avoid re-processing
  const hasProcessedUrlParamsRef = useRef(false);
  const didDefaultDoctorFromAuth = useRef(false);
  const scheduleLoaderReturnHandledRef = useRef(false);

  // Load providers
  useEffect(() => {
    let alive = true;
    if (!userEmail) return;
    (async () => {
      try {
        const providers = await fetchPrimaryProviders();
        if (alive) {
          setAllProviders(providers);
        }
      } catch (e: any) {
        if (alive) {
          setError(e?.message || 'Failed to load providers');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [userEmail]);

  useEffect(() => {
    void fetchSchedulingOutreachSmsFrom().then((phone) => {
      if (phone) setSmsFromLine(phone);
    });
  }, []);

  const flushOutreachNotesSave = useCallback(async (reminderId: number, value: string) => {
    setOutreachNoteSaving((s) => ({ ...s, [reminderId]: true }));
    setOutreachNoteError((e) => ({ ...e, [reminderId]: null }));
    try {
      const updated = await patchReminder(reminderId, { outreachNotes: value });
      const persisted =
        String(updated.outreachNotes ?? updated.notes ?? value ?? '') || '';
      setOutreachNoteDrafts((d) => ({ ...d, [reminderId]: persisted }));
      const hidden = reminderPatchIsHidden(updated);
      setCandidates((prev) =>
        mergeReminderFieldsIntoCandidates(prev, reminderId, {
          outreachNotes: persisted,
          ...(typeof hidden === 'boolean' ? { isHidden: hidden } : {}),
        })
      );
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not save notes';
      setOutreachNoteError((er) => ({ ...er, [reminderId]: String(msg) }));
    } finally {
      setOutreachNoteSaving((s) => ({ ...s, [reminderId]: false }));
    }
  }, []);

  const setReminderIsHidden = useCallback(async (reminderId: number, isHidden: boolean) => {
    setReminderHiddenSaving((s) => ({ ...s, [reminderId]: true }));
    setReminderHiddenError((e) => ({ ...e, [reminderId]: null }));
    try {
      const updated = await patchReminder(reminderId, { isHidden });
      const nextHidden = reminderPatchIsHidden(updated) ?? isHidden;
      const persistedNotes = updated.outreachNotes ?? updated.notes;
      setCandidates((prev) =>
        mergeReminderFieldsIntoCandidates(prev, reminderId, {
          isHidden: nextHidden,
          ...(persistedNotes !== undefined && persistedNotes !== null
            ? { outreachNotes: String(persistedNotes) }
            : {}),
        })
      );
      if (persistedNotes !== undefined && persistedNotes !== null) {
        setOutreachNoteDrafts((d) => ({ ...d, [reminderId]: String(persistedNotes) }));
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not update reminder';
      setReminderHiddenError((er) => ({ ...er, [reminderId]: String(msg) }));
    } finally {
      setReminderHiddenSaving((s) => ({ ...s, [reminderId]: false }));
    }
  }, []);

  const scheduleOutreachNotesSave = useCallback(
    (reminderId: number, value: string) => {
      const prevTimer = outreachNoteDebounceTimers.current.get(reminderId);
      if (prevTimer) clearTimeout(prevTimer);
      const t = setTimeout(() => {
        outreachNoteDebounceTimers.current.delete(reminderId);
        void flushOutreachNotesSave(reminderId, value);
      }, FILL_DAY_OUTREACH_NOTES_DEBOUNCE_MS);
      outreachNoteDebounceTimers.current.set(reminderId, t);
    },
    [flushOutreachNotesSave]
  );

  function onOutreachNotesChange(reminderId: number, value: string) {
    setOutreachNoteDrafts((d) => ({ ...d, [reminderId]: value }));
    scheduleOutreachNotesSave(reminderId, value);
  }

  async function onOutreachNotesBlur(reminderId: number, valueFromDom: string) {
    const t = outreachNoteDebounceTimers.current.get(reminderId);
    if (t) {
      clearTimeout(t);
      outreachNoteDebounceTimers.current.delete(reminderId);
    }
    const value = valueFromDom;
    setOutreachNoteDrafts((d) => ({ ...d, [reminderId]: value }));
    const row = findFillDayReminderInCandidates(candidates, reminderId);
    const serverVal = row ? initialFillDayReminderOutreachNotes(row) : '';
    if (value !== serverVal) {
      await flushOutreachNotesSave(reminderId, value);
    }
  }

  useEffect(() => {
    const drafts: Record<number, string> = {};
    for (const c of candidates) {
      for (const r of c.reminders ?? []) {
        const id = fillDayReminderNumericId(r);
        if (id != null) drafts[id] = initialFillDayReminderOutreachNotes(r);
      }
      for (const p of c.patients ?? []) {
        for (const r of p.reminders ?? []) {
          const id = fillDayReminderNumericId(r);
          if (id != null) drafts[id] = initialFillDayReminderOutreachNotes(r);
        }
      }
    }
    setOutreachNoteDrafts(drafts);
    setOutreachNoteSaving({});
    setOutreachNoteError({});
    setReminderHiddenSaving({});
    setReminderHiddenError({});
  }, [candidates]);

  useEffect(() => {
    const m = outreachNoteDebounceTimers.current;
    return () => {
      for (const timer of m.values()) clearTimeout(timer);
      m.clear();
    };
  }, []);

  // Handle URL parameters: doctorId and targetDate, and auto-fetch
  useEffect(() => {
    const urlDoctorId = searchParams.get('doctorId')?.trim() ?? '';
    const urlTargetDate = searchParams.get('targetDate')?.trim() ?? '';

    if (!urlDoctorId || !urlTargetDate || hasProcessedUrlParamsRef.current) {
      return;
    }

    // Wait for providers to be loaded before matching doctor
    if (allProviders.length === 0) {
      return;
    }

    const matchingDoctor = findProviderForFillDoctorId(allProviders, urlDoctorId);

    if (matchingDoctor) {
      const doctorId = fillDoctorIdForProvider(matchingDoctor);
      setSelectedDoctorId(doctorId);
      setSelectedDoctorName(matchingDoctor.name);
      setDoctorQuery(matchingDoctor.name);
      setTargetDate(urlTargetDate);
      didDefaultDoctorFromAuth.current = true;
      hasProcessedUrlParamsRef.current = true;

      (async () => {
        setLoading(true);
        setError(null);
        setCandidates([]);
        setStats(null);
        setMessage(null);

        try {
          const request: FillDayRequest = {
            doctorId,
            targetDate: urlTargetDate,
            ignoreEmergencyBlocks,
            returnToDepot: 'optional' as const,
            tailOvertimeMinutes: 0 as const,
          };

          const response = await fetchFillDayCandidates(request);
          setCandidates(response.candidates);
          setStats(response.stats);
          if (response.message) {
            setMessage(response.message);
          }
        } catch (e: any) {
          setError(e?.response?.data?.message || e?.message || 'Failed to fetch candidates');
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    setError(`Doctor with ID "${urlDoctorId}" not found`);
    hasProcessedUrlParamsRef.current = true;
  }, [searchParams, allProviders, ignoreEmergencyBlocks]);

  // After returning from calendar preview, scroll to the client card.
  useEffect(() => {
    const scrollClientRaw = searchParams.get('scrollClientId')?.trim() ?? '';
    if (!scrollClientRaw || loading || candidates.length === 0) return;

    const clientId = Number(scrollClientRaw);
    if (!Number.isFinite(clientId)) return;

    const raf = window.requestAnimationFrame(() => {
      const el = document.getElementById(`fill-day-client-${clientId}`);
      if (!el) return;

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightClientId(clientId);
      window.setTimeout(() => setHighlightClientId((cur) => (cur === clientId ? null : cur)), 2400);

      const next = new URLSearchParams(searchParams);
      next.delete('scrollClientId');
      setSearchParams(next, { replace: true });
    });

    return () => window.cancelAnimationFrame(raf);
  }, [searchParams, loading, candidates.length, setSearchParams]);

  // After booking from calendar preview, open text modal with care outreach wording.
  useEffect(() => {
    const pending = readScheduleLoaderReturnSession();
    if (!pending?.openSms || scheduleLoaderReturnHandledRef.current) return;
    if (loading || candidates.length === 0) return;

    const candidate = candidates.find((c) => c.clientId === pending.clientId);
    if (!candidate) return;

    scheduleLoaderReturnHandledRef.current = true;
    clearScheduleLoaderReturnSession();

    void (async () => {
      try {
        const petNames =
          pending.petNames.length > 0
            ? pending.petNames
            : fillDayPreviewPatients(candidate).map((p) => p.name);
        const bookedSlot = await resolveScheduleLoaderSmsBookedSlot(
          pending.bookedAppointmentId,
          FILL_DAY_PRACTICE_ID,
          FILL_DAY_PRACTICE_TZ,
          {
            startIso: pending.bookedAppointmentStart,
            endIso: pending.bookedAppointmentEnd ?? pending.bookedAppointmentStart,
          }
        );
        const holdRelease = holdReleaseOptsForAppointment(
          pending.bookedAppointmentStart,
          FILL_DAY_PRACTICE_TZ,
        );
        const message = buildScheduleLoaderBookedSmsMessage({
          petNames,
          clientDisplayName: pending.clientDisplayName ?? candidate.clientName,
          providerLastName: pending.providerLastName,
          ...(bookedSlot ? { bookedSlot } : {}),
          holdRelease,
        });
        setSmsError((prev) => ({ ...prev, [candidate.clientId]: null }));
        setSmsMessagePreview(message);
        setPendingSmsCandidate(candidate);
        setSendWithOverride(false);
        setSmsModalOpen(true);
        setHighlightClientId(candidate.clientId);
      } catch {
        scheduleLoaderReturnHandledRef.current = false;
        setError('Could not prepare text message after booking.');
      }
    })();
  }, [loading, candidates, searchParams]);

  // Default Doctor / One Team: last selection (cached), else logged-in user's assigned employee
  useEffect(() => {
    if (didDefaultDoctorFromAuth.current || allProviders.length === 0) return;
    if (selectedDoctorId !== '') return;
    if (hasFillDayDeepLinkParams(searchParams) || hasProcessedUrlParamsRef.current) return;

    const cached = readAuthDoctorCache();
    if (cached) {
      const match = findProviderForFillDoctorId(allProviders, cached.pimsId);
      if (match) {
        const applied = applyFillDayDoctorSelection(match, cached.doctorQuery);
        setSelectedDoctorId(applied.doctorId);
        setSelectedDoctorName(applied.name);
        setDoctorQuery(applied.query);
        didDefaultDoctorFromAuth.current = true;
        return;
      }
    }

    const uid = userDoctorId != null ? String(userDoctorId).trim() : '';
    const matchByAuth =
      uid !== ''
        ? allProviders.find(
            (p) =>
              String(p.id) === uid || String(p.pimsId ?? '') === uid
          )
        : null;

    if (matchByAuth) {
      const id = fillDoctorIdForProvider(matchByAuth);
      setSelectedDoctorId(id);
      setSelectedDoctorName(matchByAuth.name);
      setDoctorQuery(matchByAuth.name);
      didDefaultDoctorFromAuth.current = true;
      return;
    }

    // Resolve employee by API when userDoctorId didn't match (e.g. backend stores different id format)
    if (uid !== '') {
      let cancelled = false;
      (async () => {
        try {
          const byPims = await http.get(`/employees/pims/${encodeURIComponent(uid)}`);
          const emp = Array.isArray(byPims.data) ? (byPims.data as any)[0] : (byPims.data as any);
          const resolvedId =
            emp?.id != null ? String(emp.id) : emp?.employee?.id != null ? String(emp.employee.id) : null;
          const resolvedPims =
            emp?.pimsId != null ? String(emp.pimsId) : emp?.employee?.pimsId != null ? String(emp.employee.pimsId) : null;
          if (cancelled || hasFillDayDeepLinkParams(searchParams) || hasProcessedUrlParamsRef.current) return;
          const match = allProviders.find(
            (p) =>
              (resolvedId != null && String(p.id) === resolvedId) ||
              (resolvedPims != null && String(p.pimsId ?? '') === resolvedPims)
          );
          if (match && !didDefaultDoctorFromAuth.current) {
            const id = fillDoctorIdForProvider(match);
            setSelectedDoctorId(id);
            setSelectedDoctorName(match.name);
            setDoctorQuery(match.name);
            didDefaultDoctorFromAuth.current = true;
          }
        } catch {
          // Not found by pims; try by internal id
          try {
            const byId = await http.get(`/employees/${encodeURIComponent(uid)}`);
            const emp = (byId.data as any)?.employee ?? byId.data;
            const resolvedId = emp?.id != null ? String(emp.id) : null;
            const resolvedPims = emp?.pimsId != null ? String(emp.pimsId) : null;
            if (cancelled || hasFillDayDeepLinkParams(searchParams) || hasProcessedUrlParamsRef.current) return;
            const match = allProviders.find(
              (p) =>
                (resolvedId != null && String(p.id) === resolvedId) ||
                (resolvedPims != null && String(p.pimsId ?? '') === resolvedPims)
            );
            if (match && !didDefaultDoctorFromAuth.current) {
              const id = fillDoctorIdForProvider(match);
              setSelectedDoctorId(id);
              setSelectedDoctorName(match.name);
              setDoctorQuery(match.name);
              didDefaultDoctorFromAuth.current = true;
            }
          } catch {
            /* ignore */
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // Fallback when no assigned doctorId: match by logged-in user email (same as My Week "me")
    if (uid === '' && userEmail) {
      const me = allProviders.find(
        (p) => (p?.email || '').toLowerCase() === userEmail.toLowerCase()
      );
      if (me) {
        const id = fillDoctorIdForProvider(me);
        setSelectedDoctorId(id);
        setSelectedDoctorName(me.name);
        setDoctorQuery(me.name);
        didDefaultDoctorFromAuth.current = true;
      }
    }
  }, [allProviders, userDoctorId, selectedDoctorId, userEmail, searchParams]);

  // Filter doctors based on query
  useEffect(() => {
    if (!doctorQuery.trim()) {
      setDoctorResults([]);
      return;
    }
    const query = doctorQuery.toLowerCase();
    const filtered = allProviders.filter((d) =>
      d.name.toLowerCase().includes(query)
    );
    setDoctorResults(filtered);
  }, [doctorQuery, allProviders]);

  // Fetch candidates
  async function handleFetchCandidates() {
    if (!selectedDoctorId || !targetDate) {
      setError('Please select a doctor and date');
      return;
    }

    setLoading(true);
    setError(null);
    setCandidates([]);
    setStats(null);
    setMessage(null);

    try {
      const request: FillDayRequest = {
        doctorId: selectedDoctorId,
        targetDate,
        ignoreEmergencyBlocks,
        returnToDepot: 'optional' as const,
        tailOvertimeMinutes: 0 as const,
      };

      const response = await fetchFillDayCandidates(request);
      setCandidates(response.candidates);
      setStats(response.stats);
      if (response.message) {
        setMessage(response.message);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to fetch candidates');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onPageRefresh = () => {
      if (!selectedDoctorId || !targetDate) return;
      if (candidates.length === 0 && stats === null) return;
      void handleFetchCandidates();
    };
    window.addEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onPageRefresh);
    return () => window.removeEventListener(SCHEDULING_TOOLS_PAGE_REFRESH_EVENT, onPageRefresh);
  }, [selectedDoctorId, targetDate, candidates.length, stats]);

  const candidatesForDisplay = useMemo(
    () => paginateSchedulingToolsList(candidates, listPage),
    [candidates, listPage],
  );

  useEffect(() => {
    setListPage(1);
  }, [selectedDoctorId, targetDate]);

  useEffect(() => {
    const totalPages = schedulingToolsListTotalPages(candidates.length);
    if (listPage > totalPages) setListPage(totalPages);
  }, [listPage, candidates.length]);

  const changeCandidatePage = useCallback((page: number) => {
    setListPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Format time
  function formatTime(iso: string): string {
    return DateTime.fromISO(iso).toLocaleString(DateTime.TIME_SIMPLE);
  }

  // Format date
  function formatDate(dateStr: string): string {
    const dt = DateTime.fromISO(dateStr);
    if (!dt.isValid) {
      return dateStr;
    }
    return dt.toFormat('EEE, MMM dd, yyyy');
  }

  // Calculate age from DOB (returns just the number for compact display)
  function calculateAge(dob: string): number | null {
    const dobDate = DateTime.fromISO(dob);
    if (!dobDate.isValid) {
      return null;
    }
    const now = DateTime.now();
    const ageInYears = Math.floor(now.diff(dobDate, 'years').years);
    return ageInYears >= 0 ? ageInYears : null;
  }

  // Format patient info in compact format: "15 yo Burmese (Feline) 25 lbs"
  function formatPatientInfo(patient: any): string {
    const parts: string[] = [];
    
    if (patient?.dob) {
      const age = calculateAge(patient.dob);
      if (age !== null) {
        parts.push(`${age} yo`);
      }
    }
    
    if (patient?.breed) {
      parts.push(patient.breed);
    }
    
    if (patient?.species) {
      parts.push(`(${patient.species})`);
    }
    
    if (patient?.weight) {
      parts.push(`${patient.weight} lbs`);
    }
    
    return parts.join(' ');
  }

  function buildFillDayOutreachSmsMessage(candidate: FillDayCandidate): string {
    const petNames =
      candidate.patientNames?.length > 0
        ? candidate.patientNames
        : fillDayPreviewPatients(candidate).map((p) => p.name);
    return buildScheduleLoaderBookedSmsMessage({
      petNames,
      clientDisplayName: candidate.clientName,
      providerLastName: providerLastNameFromDisplayName(selectedDoctorName),
      anyPastDue: scheduleLoaderCandidateHasPastDueReminders(candidate),
    });
  }

  function handleOpenEmailModal(candidate: FillDayCandidate) {
    const providerLastName = providerLastNameFromDisplayName(selectedDoctorName);
    const sms = smsMessagePreview.trim() || buildFillDayOutreachSmsMessage(candidate);
    const email = careOutreachSmsToEmail(sms, providerLastName);
    setEmailSubject(email.subject);
    setEmailBodyText(email.bodyText);
    setPendingEmailCandidate(candidate);
    setEmailModalOpen(true);
  }

  function handleCloseEmailModal() {
    setEmailModalOpen(false);
    setPendingEmailCandidate(null);
    setEmailSubject('');
    setEmailBodyText('');
  }

  function handleOpenSmsModal(candidate: FillDayCandidate, withOverride: boolean = false) {
    setSmsMessagePreview('');
    setPendingSmsCandidate(candidate);
    setSendWithOverride(withOverride);
    setSmsModalOpen(true);
  }

  // Handle closing SMS confirmation modal
  function handleCloseSmsModal() {
    setSmsModalOpen(false);
    setPendingSmsCandidate(null);
    setSmsMessagePreview('');
    setSendWithOverride(false);
  }

  // Handle sending SMS to client (after approval)
  async function handleSendSms(
    candidate: FillDayCandidate,
    overrideNonProd: boolean = false,
    customMessage?: string
  ) {
    const clientId = candidate.clientId;
    const smsMessage = customMessage?.trim();
    if (!smsMessage) {
      setSmsError((prev) => ({ ...prev, [clientId]: 'Enter a message before sending.' }));
      return;
    }
    setSendingSms((prev) => ({ ...prev, [clientId]: true }));
    setSmsError((prev) => ({ ...prev, [clientId]: null }));
    setSmsSuccess((prev) => ({ ...prev, [clientId]: false }));

    try {
      const payload: { message: string; overrideNonProd?: boolean; useRemindersFrom?: boolean } = {
        message: smsMessage,
        useRemindersFrom: true,
      };

      if (overrideNonProd) {
        payload.overrideNonProd = true;
      }

      await http.post(`/sms/client/${clientId}`, payload);

      setSmsSuccess((prev) => ({ ...prev, [clientId]: true }));
      handleCloseSmsModal();
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSmsSuccess((prev) => {
          const updated = { ...prev };
          delete updated[clientId];
          return updated;
        });
      }, 3000);
    } catch (e: any) {
      const errorMsg = e?.response?.data?.message || e?.message || 'Failed to send text message';
      setSmsError((prev) => ({ ...prev, [clientId]: errorMsg }));
    } finally {
      setSendingSms((prev) => {
        const updated = { ...prev };
        delete updated[clientId];
        return updated;
      });
    }
  }

  // Handle approve and send
  function handleApproveAndSend() {
    if (pendingSmsCandidate) {
      handleSendSms(pendingSmsCandidate, sendWithOverride, smsMessagePreview);
    }
  }

  async function handleViewPlacement(candidate: FillDayCandidate) {
    if (!selectedDoctorId?.trim() || !targetDate?.trim()) {
      setError('Select a doctor and target date first.');
      return;
    }

    const provider = findProviderForFillDoctorId(allProviders, selectedDoctorId);
    const internalProviderId =
      provider?.id != null && Number.isFinite(Number(provider.id)) ? Number(provider.id) : undefined;
    const doctorPimsId = provider ? fillDoctorIdForProvider(provider) : selectedDoctorId.trim();

    setError(null);
    try {
      const forwardBookingEntries = await createForwardBookingsFromScheduleLoader(
        candidate,
        FILL_DAY_PRACTICE_ID,
        { primaryProviderId: internalProviderId ?? null }
      );
      const anchor = forwardBookingEntries[0];
      if (!anchor) {
        setError('Could not create forward booking rows for this client.');
        return;
      }
      const baseIntent =
        forwardBookingEntries.length > 1
          ? buildRoutingForwardBookingIntentFromEntries(anchor, forwardBookingEntries)
          : buildRoutingForwardBookingIntentFromEntry(anchor);
      if (!baseIntent) {
        setError('This client is missing data needed for routing.');
        return;
      }

      const searchDate = targetDate.trim();
      const returnHref =
        `/schedule/scheduling-tools/schedule-loader?targetDate=${encodeURIComponent(searchDate)}` +
        (internalProviderId != null
          ? `&doctorId=${encodeURIComponent(String(internalProviderId))}`
          : '') +
        `&scrollClientId=${encodeURIComponent(String(candidate.clientId))}`;

      writeRoutingForwardBookingIntent({
        ...baseIntent,
        reminderOutreachNotes: workingNotesFromReminders(candidate.reminders ?? []),
        returnToListAfterBook: true,
        workspaceActive: true,
        origin: 'schedule_loader',
        scheduleLoaderAnyPastDue: scheduleLoaderCandidateHasPastDueReminders(candidate),
        serviceMinutes: Math.max(1, Math.round(candidate.requiredDuration / 60)),
        ...(internalProviderId != null
          ? { primaryProviderInternalId: String(internalProviderId) }
          : {}),
        primaryDoctorPimsId: doctorPimsId,
        primaryDoctorDisplayName: selectedDoctorName?.trim() || provider?.name,
        routingSearch: scheduleLoaderRoutingSearchDateRange(searchDate),
        reserveOption: ignoreEmergencyBlocks ? 'reserve-only' : null,
        scheduleLoaderReturn: {
          clientId: candidate.clientId,
          returnHref,
        },
      });
      navigate('/schedule/routing');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not start routing.';
      setError(String(msg));
    }
  }

  function handleOpenEmailHistoryModal(clientId: number, clientLabel?: string) {
    setEmailHistoryClientId(clientId);
    setEmailHistoryClientLabel(clientLabel?.trim() ?? '');
  }

  function handleCloseEmailHistoryModal() {
    setEmailHistoryClientId(null);
    setEmailHistoryClientLabel('');
  }

  function handleOpenMessagesModal(clientId: number, clientLabel?: string) {
    setMessagesClientId(clientId);
    setMessagesClientLabel(clientLabel?.trim() ?? '');
    if (messageCounts[clientId] !== undefined) return;
    void fetchClientMessagesCached(clientId)
      .then((data) => {
        setMessageCounts((prev) => ({ ...prev, [clientId]: data.totalMessages }));
      })
      .catch(() => {
        /* badge optional */
      });
  }

  function handleCloseMessagesModal() {
    setMessagesClientId(null);
    setMessagesClientLabel('');
  }

  const canSendPendingSms =
    pendingSmsCandidate != null && smsMessagePreview.trim().length > 0;

  // Handle PDF export
  async function handleExportToPDF() {
    if (!resultsContainerRef.current) {
      setError('No results to export');
      return;
    }

    setExportingPDF(true);
    try {
      const element = resultsContainerRef.current;

      // Use html2canvas to capture the results container
      const canvas = await html2canvas(element, {
        scale: 2, // Higher quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: element.scrollWidth,
        height: element.scrollHeight,
      });

      // Calculate PDF dimensions (letter size: 8.5 x 11 inches)
      const imgWidth = 8.5;
      const pageHeight = 11;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;

      // Create PDF
      const pdf = new jsPDF('portrait', 'in', 'letter');
      let position = 0;

      // Add image to PDF
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add additional pages if content is taller than one page
      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Generate filename
      const dateStr = formatDate(targetDate);
      const filename = `Schedule_Loader_Results_${selectedDoctorName.replace(/\s+/g, '_')}_${dateStr.replace(/[,\s]/g, '_')}.pdf`;
      
      // Save the PDF
      pdf.save(filename);
    } catch (error) {
      console.error('Error generating PDF:', error);
      setError('Failed to generate PDF. Please try again.');
    } finally {
      setExportingPDF(false);
    }
  }

  return (
    <div className="container" style={{ padding: '24px', maxWidth: 1400 }}>
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: 700 }}>
            Fill
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            Find patients with overdue reminders to fill scheduling holes
          </p>
        </div>
        {candidates.length > 0 && (
          <button
            onClick={handleExportToPDF}
            disabled={exportingPDF}
            style={{
              padding: '10px 20px',
              background: exportingPDF ? '#ccc' : '#4FB128',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: exportingPDF ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {exportingPDF ? 'Exporting...' : 'Export Results to PDF'}
          </button>
        )}
      </div>

      {/* Controls */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'grid', gap: '20px' }}>
          {/* Doctor Selection */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              Doctor / One Team
            </label>
            <div ref={doctorBoxRef} style={{ position: 'relative' }}>
              <input
                type="text"
                value={doctorQuery}
                onChange={(e) => {
                  setDoctorQuery(e.target.value);
                  setShowDoctorDropdown(true);
                }}
                onFocus={() => setShowDoctorDropdown(true)}
                placeholder="Search for doctor..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #ccc',
                  borderRadius: '8px',
                  fontSize: '16px',
                }}
              />
              {showDoctorDropdown && doctorResults.length > 0 && (
                <ul
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: '#fff',
                    border: '1px solid #ccc',
                    borderRadius: '8px',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    maxHeight: 260,
                    overflowY: 'auto',
                    zIndex: 1000,
                  }}
                >
                  {doctorResults.map((d, i) => {
                    const selected = i === doctorActiveIdx;
                    // Use pimsId if available, otherwise fall back to id
                    const pimsId = d.pimsId ? String(d.pimsId) : String(d.id);
                    return (
                      <li key={pimsId} role="presentation" style={{ padding: 0 }}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Use pimsId if available, otherwise fall back to id
                            const doctorPimsId = d.pimsId ? String(d.pimsId) : String(d.id);
                            setSelectedDoctorId(doctorPimsId);
                            setSelectedDoctorName(d.name);
                            setDoctorQuery(d.name);
                            persistFillDayDoctorCache(d, userId);
                            setShowDoctorDropdown(false);
                          }}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            background: selected ? '#f0f7f4' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            borderRadius: 0,
                          }}
                        >
                          {d.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {selectedDoctorName && (
              <div style={{ marginTop: '8px', fontSize: '14px', color: '#4FB128' }}>
                Selected: <strong>{selectedDoctorName}</strong>
              </div>
            )}
          </div>

          {/* Date Selection */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              Target Date
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #ccc',
                borderRadius: '8px',
                fontSize: '16px',
              }}
            />
          </div>

          {/* Options */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={ignoreEmergencyBlocks}
                onChange={(e) => setIgnoreEmergencyBlocks(e.target.checked)}
              />
              <span>Ignore Reserve Blocks</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={showHiddenReminders}
                onChange={(e) => setShowHiddenReminders(e.target.checked)}
              />
              <span>Show hidden reminders</span>
            </label>
          </div>

          {/* Fetch Button */}
          <button
            onClick={handleFetchCandidates}
            disabled={loading || !selectedDoctorId || !targetDate}
            style={{
              padding: '12px 24px',
              background: loading || !selectedDoctorId || !targetDate ? '#ccc' : '#4FB128',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 600,
              cursor: loading || !selectedDoctorId || !targetDate ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Loading...' : 'Find Candidates'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: '16px',
            border: '1px solid #dc2626',
            borderRadius: '8px',
            background: '#fef2f2',
            color: '#dc2626',
            marginBottom: '24px',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results Container for PDF Export */}
      <div ref={resultsContainerRef}>
        {/* Stats */}
        {stats && (
          <div
            style={{
              padding: '16px',
              background: '#f0f7f4',
              borderRadius: '8px',
              marginBottom: '24px',
              display: 'flex',
              gap: '24px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <strong>Holes Found:</strong> {stats.holesFound}
            </div>
            <div>
              <strong>Candidates Evaluated:</strong> {stats.candidatesEvaluated}
            </div>
            <div>
              <strong>Shortlist Size:</strong> {stats.shortlistSize}
            </div>
            <div>
              <strong>Final Results:</strong> {stats.finalResults}
            </div>
          </div>
        )}

        {/* Message */}
        {message && (
          <div
            style={{
              padding: '16px',
              background: '#fef2f2',
              borderRadius: '8px',
              marginBottom: '24px',
              color: '#dc2626',
            }}
          >
            {message}
          </div>
        )}

        {/* Candidates List */}
      {candidates.length === 0 && !loading && !error && stats && (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            background: '#f9fafb',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
          }}
        >
          <p className="muted" style={{ margin: 0, fontSize: '16px' }}>
            No candidates found to fill scheduling holes.
          </p>
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{ display: 'grid', gap: '24px' }}>
          <SchedulingToolsListPagination
            listPage={listPage}
            totalItems={candidates.length}
            onPageChange={changeCandidatePage}
            itemLabel="candidates"
          />
          {candidatesForDisplay.map((candidate, idx) => {
            return (
            <div
              id={`fill-day-client-${candidate.clientId}`}
              key={`${candidate.clientId}-${candidate.holeIndex}-${idx}`}
              style={{
                background: highlightClientId === candidate.clientId ? '#f0fdf4' : '#fff',
                border:
                  highlightClientId === candidate.clientId
                    ? '2px solid #4FB128'
                    : '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '24px',
                boxShadow:
                  highlightClientId === candidate.clientId
                    ? '0 0 0 3px rgba(79, 177, 40, 0.2)'
                    : '0 1px 3px rgba(0,0,0,0.1)',
                transition: 'background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease',
              }}
            >
              {/* Client Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {(() => {
                      const clientPimsId = (candidate.client as any)?.pimsId || (candidate as any)?.clientPimsId;
                      const clientHref = clientPimsId ? evetClientLink(clientPimsId) : undefined;
                      return clientHref ? (
                        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                          <a
                            href={clientHref}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: 'inherit', textDecoration: 'none' }}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                          >
                            {candidate.clientName}
                          </a>
                        </h3>
                      ) : (
                        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                          {candidate.clientName}
                        </h3>
                      );
                    })()}
                    {candidate.client?.alerts && (
                      <div style={{
                        padding: '4px 8px',
                        background: '#fef3c7',
                        border: '1px solid #fbbf24',
                        borderRadius: '4px',
                        fontSize: '12px',
                        color: '#92400e',
                        fontWeight: 600,
                      }}>
                        ⚠️ {candidate.client.alerts}
                      </div>
                    )}
                  </div>
                  {candidate.address?.fullAddress && (
                    <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                      {candidate.address.fullAddress}
                    </div>
                  )}
                  {candidate.petCount > 0 && (
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      <strong>{candidate.petCount}</strong> {candidate.petCount === 1 ? 'pet' : 'pets'} with overdue reminders
                    </div>
                  )}
                </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                    Hole #{candidate.holeIndex}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#4FB128', marginBottom: '8px' }}>
                    Score: {candidate.finalScore.toFixed(1)}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenEmailHistoryModal(candidate.clientId, candidate.clientName);
                    }}
                    style={{
                      fontSize: '14px',
                      color: '#4FB128',
                      background: 'transparent',
                      border: '1px solid #4FB128',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f0f7f4';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    Email history
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenMessagesModal(candidate.clientId, candidate.clientName);
                    }}
                    style={{
                      fontSize: '14px',
                      color: '#4FB128',
                      background: 'transparent',
                      border: '1px solid #4FB128',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f0f7f4';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    Messages history
                    {messageCounts[candidate.clientId] !== undefined && (
                      <span style={{ marginLeft: '6px', fontWeight: 600 }}>
                        ({messageCounts[candidate.clientId]})
                      </span>
                    )}
                  </button>
                  </div>
                  </div>
              </div>

              {/* Pets and Reminders */}
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                  Pets & Overdue Reminders
                </h4>
                <div style={{ display: 'grid', gap: '12px' }}>
                  {candidate.patientNames.map((petName, petIdx) => {
                    const patientId = candidate.patientIds[petIdx];
                    // Get full patient object if available
                    const patient = candidate.patients?.[petIdx];
                    
                    // Get reminders directly from patient object (new structure)
                    // Fallback to candidate.reminders if patient.reminders not available
                    const rawReminders =
                      patient?.reminders && patient.reminders.length > 0
                        ? patient.reminders
                        : candidate.reminders.filter((reminder) => {
                            const reminderIdx = candidate.reminderIds.findIndex(
                              (id) => Number(id) === Number(reminder.id)
                            );
                            if (candidate.patientIds.length === 1) {
                              return petIdx === 0;
                            }
                            return reminderIdx === petIdx || (reminderIdx < 0 && petIdx === 0);
                          });
                    const reminderToShow = rawReminders.filter(
                      (r) => showHiddenReminders || !fillDayReminderIsHidden(r)
                    );
                    
                    return (
                      <div
                        key={`${patientId}-${petIdx}`}
                        style={{
                          padding: '16px',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '8px',
                        }}
                      >
                        {/* Patient Name and Info */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                            {(() => {
                              const patientPimsId = patient?.pimsId || (patient as any)?.pimsId;
                              const patientHref = patientPimsId ? evetPatientLink(patientPimsId) : undefined;
                              return patientHref ? (
                                <div style={{ fontWeight: 600, fontSize: '18px', color: '#111827' }}>
                                  <a
                                    href={patientHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: 'inherit', textDecoration: 'none' }}
                                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                                  >
                                    {petName}
                                  </a>
                                </div>
                              ) : (
                                <div style={{ fontWeight: 600, fontSize: '18px', color: '#111827' }}>
                                  {petName}
                                </div>
                              );
                            })()}
                            {(patient && formatPatientInfo(patient)) ||
                            (patientId != null && Number.isFinite(Number(patientId))) ? (
                              <div
                                style={{
                                  fontSize: '14px',
                                  color: '#6b7280',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                {patient && formatPatientInfo(patient) ? (
                                  <span>{formatPatientInfo(patient)}</span>
                                ) : null}
                                {patientId != null && Number.isFinite(Number(patientId)) ? (
                                  <BookPatientChartButton
                                    patientId={String(patientId)}
                                    patientName={petName}
                                    practiceId={FILL_DAY_PRACTICE_ID}
                                    practiceTz={FILL_DAY_PRACTICE_TZ}
                                    label="View details"
                                    showAlerts
                                  />
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          
                          {/* Patient Alerts */}
                          {patient?.alerts && (
                            <div style={{
                              padding: '4px 8px',
                              background: '#fef3c7',
                              border: '1px solid #fbbf24',
                              borderRadius: '4px',
                              fontSize: '12px',
                              color: '#92400e',
                              fontWeight: 600,
                              marginBottom: '8px',
                            }}>
                              ⚠️ {patient.alerts}
                            </div>
                          )}
                          
                          {/* Last Seen Date */}
                          {patient?.lastSeenDate && (
                            <div style={{
                              fontSize: '14px',
                              color: '#6b7280',
                              marginTop: '8px',
                            }}>
                              Last Seen: {(() => {
                                const dt = DateTime.fromISO(patient.lastSeenDate);
                                const formattedDate = dt.isValid ? dt.toFormat('MMM dd, yyyy') : patient.lastSeenDate;
                                const appointmentType = patient.lastSeenAppointmentType ? ` - ${patient.lastSeenAppointmentType}` : '';
                                return `${formattedDate}${appointmentType}`;
                              })()}
                            </div>
                          )}
                        </div>
                        
                        {/* Reminders */}
                        {rawReminders.length > 0 && (
                          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #fecaca' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Overdue Reminders:
                            </div>
                            {reminderToShow.length === 0 ? (
                              <div style={{ fontSize: '13px', color: '#6b7280', paddingLeft: '8px' }}>
                                All reminders for this pet are hidden. Turn on{' '}
                                <strong>Show hidden reminders</strong> above to view or unhide them.
                              </div>
                            ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {reminderToShow.map((reminder, reminderIdx) => {
                                const rid = fillDayReminderNumericId(reminder);
                                const isHidden = fillDayReminderIsHidden(reminder);
                                const dueDateFormatted = reminder.dueDate
                                  ? (() => {
                                      const dt = DateTime.fromISO(reminder.dueDate);
                                      return dt.isValid ? dt.toFormat('MMM dd, yyyy') : reminder.dueDate;
                                    })()
                                  : null;
                                return (
                                  <div
                                    key={rid != null ? rid : `norid-${petIdx}-${reminderIdx}`}
                                    style={{
                                      fontSize: '14px',
                                      color: '#111827',
                                      paddingLeft: '8px',
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        alignItems: 'flex-start',
                                        justifyContent: 'space-between',
                                        gap: '8px',
                                      }}
                                    >
                                      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                                        <span>• {reminder.description}</span>
                                        {dueDateFormatted && (
                                          <span style={{ color: '#6b7280', marginLeft: '8px' }}>
                                            (Due: {dueDateFormatted})
                                          </span>
                                        )}
                                        {isHidden && showHiddenReminders && (
                                          <span
                                            style={{
                                              marginLeft: '8px',
                                              fontSize: '11px',
                                              fontWeight: 700,
                                              textTransform: 'uppercase',
                                              color: '#92400e',
                                              background: '#fef3c7',
                                              border: '1px solid #fbbf24',
                                              borderRadius: '4px',
                                              padding: '2px 6px',
                                              verticalAlign: 'middle',
                                            }}
                                          >
                                            Hidden
                                          </span>
                                        )}
                                      </div>
                                      {rid != null && (
                                        <button
                                          type="button"
                                          disabled={Boolean(reminderHiddenSaving[rid])}
                                          onClick={() => void setReminderIsHidden(rid, !isHidden)}
                                          style={{
                                            flexShrink: 0,
                                            padding: '6px 12px',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            borderRadius: '6px',
                                            border: '1px solid #cbd5e1',
                                            background: isHidden ? '#ecfdf5' : '#f9fafb',
                                            color: '#111827',
                                            cursor: reminderHiddenSaving[rid] ? 'not-allowed' : 'pointer',
                                          }}
                                        >
                                          {reminderHiddenSaving[rid]
                                            ? 'Saving…'
                                            : isHidden
                                              ? 'Unhide reminder'
                                              : 'Hide reminder'}
                                        </button>
                                      )}
                                    </div>
                                    {rid != null && reminderHiddenError[rid] && (
                                      <div style={{ color: '#b91c1c', fontSize: '12px', marginTop: '4px' }}>
                                        {reminderHiddenError[rid]}
                                      </div>
                                    )}
                                    {rid != null ? (
                                      <div
                                        style={{
                                          marginTop: '10px',
                                          padding: '10px',
                                          background: '#fff',
                                          border: '1px solid #e5e7eb',
                                          borderRadius: '8px',
                                        }}
                                      >
                                        <label
                                          style={{
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            color: '#374151',
                                            display: 'block',
                                            marginBottom: '6px',
                                          }}
                                          htmlFor={`fill-day-outreach-${rid}`}
                                        >
                                          Contact log
                                        </label>
                                        <p
                                          className="settings-muted"
                                          style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.35 }}
                                        >
                                          Shared across care outreach, schedule loader, on hold, and
                                          the scheduler.
                                        </p>
                                        <textarea
                                          id={`fill-day-outreach-${rid}`}
                                          rows={3}
                                          value={
                                            outreachNoteDrafts[rid] ??
                                            initialFillDayReminderOutreachNotes(reminder)
                                          }
                                          onChange={(e) => onOutreachNotesChange(rid, e.target.value)}
                                          onBlur={(e) => void onOutreachNotesBlur(rid, e.currentTarget.value)}
                                          placeholder="e.g. 11/14/2026 DF – LMOM"
                                          aria-label={`Contact log for ${reminder.description}`}
                                          style={{
                                            display: 'block',
                                            width: '100%',
                                            minHeight: '4.5rem',
                                            resize: 'vertical',
                                            fontFamily: 'inherit',
                                            fontSize: '14px',
                                            lineHeight: 1.4,
                                            padding: '10px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid #cbd5e1',
                                            background: '#f9fafb',
                                            boxSizing: 'border-box',
                                          }}
                                        />
                                        {outreachNoteSaving[rid] && (
                                          <span style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px', display: 'inline-block' }}>
                                            Saving…
                                          </span>
                                        )}
                                        {outreachNoteError[rid] && (
                                          <div style={{ color: '#b91c1c', fontSize: '12px', marginTop: '6px' }}>
                                            {outreachNoteError[rid]}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div
                                        style={{
                                          marginTop: '8px',
                                          fontSize: '12px',
                                          color: '#92400e',
                                        }}
                                      >
                                        Outreach notes are unavailable (reminder has no id in the API payload).
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Proposed Time</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {formatTime(candidate.proposedStartIso)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Arrival Window</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {formatTime(candidate.arrivalWindow.start)} - {formatTime(candidate.arrivalWindow.end)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Added Drive Time</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {candidate.addedDriveMinutes} minutes
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Duration</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {Math.round(candidate.requiredDuration / 60)} minutes
                  </div>
                </div>
              </div>

              {/* SMS Status Messages */}
              {smsError[candidate.clientId] && (
                <div
                  style={{
                    padding: '12px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    color: '#dc2626',
                    fontSize: '14px',
                    marginBottom: '12px',
                  }}
                >
                  <strong>Error:</strong> {smsError[candidate.clientId]}
                </div>
              )}
              {smsSuccess[candidate.clientId] && (
                <div
                  style={{
                    padding: '12px',
                    background: '#ecfdf5',
                    border: '1px solid #4FB128',
                    borderRadius: '8px',
                    color: '#4FB128',
                    fontSize: '14px',
                    marginBottom: '12px',
                    fontWeight: 600,
                  }}
                >
                  ✓ Text message sent successfully!
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setViewPlacementClientId(candidate.clientId);
                    void handleViewPlacement(candidate).finally(() => setViewPlacementClientId(null));
                  }}
                  disabled={viewPlacementClientId === candidate.clientId}
                  style={{
                    padding: '10px 20px',
                    background: '#fff',
                    color: '#4FB128',
                    border: '2px solid #4FB128',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: viewPlacementClientId === candidate.clientId ? 'wait' : 'pointer',
                    opacity: viewPlacementClientId === candidate.clientId ? 0.7 : 1,
                  }}
                >
                  {viewPlacementClientId === candidate.clientId ? 'Routing…' : 'Route'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleOpenSmsModal(candidate, false);
                  }}
                  disabled={Boolean(sendingSms[candidate.clientId])}
                  style={{
                    padding: '10px 20px',
                    background: sendingSms[candidate.clientId] ? '#ccc' : '#4FB128',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: sendingSms[candidate.clientId] ? 'not-allowed' : 'pointer',
                  }}
                >
                  {sendingSms[candidate.clientId] ? 'Sending…' : 'Text client'}
                </button>
                {canAccessGmailInbox ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleOpenEmailModal(candidate);
                    }}
                    style={{
                      padding: '10px 20px',
                      background: '#fff',
                      color: '#4FB128',
                      border: '2px solid #4FB128',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Email client
                  </button>
                ) : null}
                {!isProd && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleOpenSmsModal(candidate, true);
                    }}
                    disabled={Boolean(sendingSms[candidate.clientId])}
                    style={{
                      padding: '10px 20px',
                      background: sendingSms[candidate.clientId] ? '#ccc' : '#f59e0b',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: sendingSms[candidate.clientId] ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {sendingSms[candidate.clientId] ? 'Sending…' : 'Send to actual client'}
                  </button>
                )}
              </div>
            </div>
            );
          })}
          <SchedulingToolsListPagination
            listPage={listPage}
            totalItems={candidates.length}
            onPageChange={changeCandidatePage}
            itemLabel="candidates"
          />
        </div>
      )}
      </div>

      {/* SMS Confirmation Modal */}
      {smsModalOpen && pendingSmsCandidate && typeof document !== 'undefined' && document.body && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onClick={handleCloseSmsModal}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(600px, 90vw)',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: '24px',
              borderRadius: '12px',
              background: '#fff',
            }}
          >
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600 }}>
                Text client
              </h3>
              <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
                {pendingSmsCandidate.clientName}
              </p>
              {sendWithOverride && (
                <p style={{ margin: '8px 0 0', color: '#f59e0b', fontSize: '14px', fontWeight: 600 }}>
                  ⚠️ This will send to the actual client (overrideNonProd: true)
                </p>
              )}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                Message:
              </label>
              <textarea
                value={smsMessagePreview}
                onChange={(e) => setSmsMessagePreview(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '200px',
                  padding: '12px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  color: '#111827',
                  resize: 'vertical',
                  whiteSpace: 'pre-wrap',
                }}
                placeholder="Write your message…"
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCloseSmsModal}
                disabled={sendingSms[pendingSmsCandidate.clientId]}
                style={{
                  padding: '10px 20px',
                  background: '#fff',
                  color: '#6b7280',
                  border: '2px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: sendingSms[pendingSmsCandidate.clientId] ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleApproveAndSend}
                disabled={sendingSms[pendingSmsCandidate.clientId] || !canSendPendingSms}
                style={{
                  padding: '10px 20px',
                  background:
                    sendingSms[pendingSmsCandidate.clientId] || !canSendPendingSms ? '#ccc' : '#4FB128',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor:
                    sendingSms[pendingSmsCandidate.clientId] || !canSendPendingSms
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {sendingSms[pendingSmsCandidate.clientId] ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {emailModalOpen && pendingEmailCandidate ? (
        <ClientEmailComposeModal
          open
          clientId={pendingEmailCandidate.clientId}
          clientLabel={pendingEmailCandidate.clientName}
          initialSubject={emailSubject}
          initialBodyText={emailBodyText}
          onClose={handleCloseEmailModal}
        />
      ) : null}

      <ClientMessagesHistoryModal
        open={messagesClientId != null}
        clientId={messagesClientId}
        clientLabel={messagesClientLabel}
        openPhoneLine={smsFromLine}
        onClose={handleCloseMessagesModal}
      />

      <ClientEmailHistoryModal
        open={emailHistoryClientId != null}
        clientId={emailHistoryClientId}
        clientLabel={emailHistoryClientLabel}
        onClose={handleCloseEmailHistoryModal}
      />
    </div>
  );
}

