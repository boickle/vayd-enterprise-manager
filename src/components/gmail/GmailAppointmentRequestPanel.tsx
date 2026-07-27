import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  patchAppointmentRequestSubmission,
  sendAppointmentRequestSubmissionSms,
  type AppointmentRequestSubmissionItem,
  type AppointmentRequestSubmissionStatus,
} from '../../api/appointmentRequestSubmissions';
import { fetchAppointmentById } from '../../api/appointments';
import { fetchAllAppointmentTypes } from '../../api/appointmentSettings';
import { type GmailLabelNode, type GmailMessageSummary } from '../../api/gmail';
import { ClientSmsComposeModal } from '../ClientSmsComposeModal';
import { ClientMessagesHistoryModal } from '../ClientMessagesHistoryModal';
import { appointmentRequestHasSmsPhone } from '../AppointmentRequestManualBookModal';
import {
  clientDisplayNameFromRequestData,
  appointmentRequestListTabForSubmission,
  requestDataAppointmentTypeLabel,
  requestDataCanText,
  requestDataClientId,
  requestDataClientType,
  requestDataPetSummary,
  requestDataPhone,
} from '../../utils/appointmentRequestDisplay';
import { resolveRequestDataClientIdStaff } from '../../utils/resolveRequestDataClientId';
import { resolveAppointmentRequestSmsMessage } from '../../utils/appointmentRequestSmsMessage';
import {
  appointmentRequestSubmissionGmailOnHold,
  appointmentRequestBookedVisitLabels,
  appointmentRequestBookedSummaryFromAppointment,
  appointmentRequestSubmissionCountsAsBooked,
  type AppointmentRequestBookedApptSummary,
} from '../../utils/appointmentRequestOnHold';
import { appointmentRequestNeedsStaffConfirmation } from '../../utils/appointmentRequestStaffConfirm';
import {
  buildRoutingAppointmentRequestIntentFromSubmission,
  writeRoutingAppointmentRequestIntent,
} from '../../utils/routingAppointmentRequestIntent';
import { dismissRoutingRescheduleWorkspace } from '../../utils/routingRescheduleIntent';
import { dismissRoutingForwardBookingWorkspace } from '../../utils/routingForwardBookingIntent';
import { startRescheduleFromBookedAppointmentRequest } from '../../utils/appointmentRequestReschedule';
import { appointmentRequestSchedulerViewHints } from '../../utils/appointmentRequestSchedulerFocus';
import {
  appointmentRecordHasActiveLinkedVisit,
  appointmentRequestBookedSummaryMatchesSubmission,
} from '../../utils/appointmentRequestLinkedCalendarVisit';
import { beginAppointmentRequestNotBookedFlow } from '../../utils/appointmentRequestNotBookedFlow';
import { beginAppointmentRequestStaffConfirmFlow } from '../../utils/appointmentRequestStaffConfirmFlow';
import { buildGmailInboxReturnPath } from '../../utils/routingAppointmentRequestIntent';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusSession,
  writeSchedulerFocusReturnSession,
} from '../../utils/schedulerFocusAppointment';
import { practiceTimeZoneOrDefault } from '../../utils/practiceTimezone';
import { buildAppointmentTypeCatalogFromTypes, opsPointsForAppointment } from '../../utils/forwardBookingListVisibility';
import type { AppointmentTypeCatalog } from '../../utils/appointmentTypeSettings';
import { appointmentRequestsPathForTab } from '../../appointments-nav';
import type { AppointmentsListLocationState } from '../../utils/appointmentRequestListReturnTab';
import { notifySchedulingToolsNavCountsRefresh } from '../../hooks/useSchedulingToolsNavCounts';
import {
  applyApptRequestGmailOnHoldLabel,
  applyApptRequestGmailOutcomeLabel,
  apptRequestGmailOnHoldSyncSignature,
  resolveApptRequestGmailOutcome,
  resolveApptRequestLabelIds,
  type ApptRequestOutcome,
} from '../../utils/gmailAppointmentRequestLabels';
import type { GmailLabelApplyUpdate } from './GmailBulkToolbar';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

const NOT_BOOKED_REASON_OPTIONS = [
  'Aggression concerns',
  'Client Never Wrote back',
  'Found Another Practice',
  'Not appropriate for house call',
  'Not needed anymore',
  'Not ready to schedule',
  'Out of Area',
  'No availability during desired timeframe',
  'Test/Fake Request',
  'Too Expensive',
  'Wanted outside of Business hours',
] as const;
const NOT_BOOKED_REASON_OTHER = 'other';

const EMPTY_META = new Map<number, never>();

type Props = {
  mailbox: string;
  message: GmailMessageSummary;
  submission: AppointmentRequestSubmissionItem;
  userLabels: GmailLabelNode[];
  onSubmissionUpdated: (item: AppointmentRequestSubmissionItem) => void;
  onLabelsApplied: (updates: GmailLabelApplyUpdate[]) => void;
  onError: (message: string) => void;
  /** After booking in routing, open the text-client modal once. */
  autoOpenSms?: boolean;
  onAutoOpenSmsConsumed?: () => void;
  /** After removing a linked visit for not booked, open the reason modal once. */
  autoOpenNotBooked?: boolean;
  onAutoOpenNotBookedConsumed?: () => void;
};

export default function GmailAppointmentRequestPanel({
  mailbox,
  message,
  submission,
  userLabels,
  onSubmissionUpdated,
  onLabelsApplied,
  onError,
  autoOpenSms,
  onAutoOpenSmsConsumed,
  autoOpenNotBooked,
  onAutoOpenNotBookedConsumed,
}: Props) {
  const navigate = useNavigate();
  const practiceTz = practiceTimeZoneOrDefault(undefined);

  const [busy, setBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState(submission.notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const [smsOpen, setSmsOpen] = useState(false);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [messagesClientId, setMessagesClientId] = useState<number | null>(null);
  const [messagesClientLabel, setMessagesClientLabel] = useState('');
  const [messagesFromLine, setMessagesFromLine] = useState<string | null>(null);

  const [notBookedOpen, setNotBookedOpen] = useState(false);
  const [notBookedChoice, setNotBookedChoice] = useState('');
  const [notBookedOther, setNotBookedOther] = useState('');
  const [notBookedSaving, setNotBookedSaving] = useState(false);
  const [notBookedError, setNotBookedError] = useState<string | null>(null);
  const [bookedApptSummary, setBookedApptSummary] =
    useState<AppointmentRequestBookedApptSummary | null>(null);
  const [typeCatalog, setTypeCatalog] = useState<AppointmentTypeCatalog | null>(null);
  const bookedApptSummaryRef = useRef<AppointmentRequestBookedApptSummary | null>(null);
  bookedApptSummaryRef.current = bookedApptSummary;

  useEffect(() => {
    let cancelled = false;
    void fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: false }).then((types) => {
      if (cancelled) return;
      setTypeCatalog(buildAppointmentTypeCatalogFromTypes(types));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setBookedApptSummary(null);
    const apptId = submission.bookedAppointmentId;
    if (apptId == null) return;
    let cancelled = false;
    void fetchAppointmentById(Number(apptId), { practiceId: PRACTICE_ID })
      .then((appt) => {
        if (cancelled || !appt) return;
        let points: number;
        if (
          submission.linkedVisitPoints != null &&
          Number.isFinite(submission.linkedVisitPoints)
        ) {
          points = submission.linkedVisitPoints;
        } else if (typeCatalog) {
          points = opsPointsForAppointment(appt, typeCatalog);
        } else {
          return;
        }
        setBookedApptSummary(appointmentRequestBookedSummaryFromAppointment(appt, points));
      })
      .catch(() => {
        /* view hints fall back to request payload slot */
      });
    return () => {
      cancelled = true;
    };
  }, [submission.bookedAppointmentId, submission.linkedVisitPoints, typeCatalog]);

  const bookedApptMeta = useMemo(() => {
    const apptId = submission.bookedAppointmentId;
    if (apptId == null || !bookedApptSummary) return EMPTY_META;
    return new Map<number, AppointmentRequestBookedApptSummary>([
      [Number(apptId), bookedApptSummary],
    ]);
  }, [submission.bookedAppointmentId, bookedApptSummary]);

  useEffect(() => {
    setNotesDraft(submission.notes ?? '');
  }, [submission.id, submission.notes]);

  useEffect(() => {
    if (!autoOpenNotBooked) return;
    setNotBookedChoice('');
    setNotBookedOther('');
    setNotBookedError(null);
    setNotBookedOpen(true);
    onAutoOpenNotBookedConsumed?.();
  }, [autoOpenNotBooked, onAutoOpenNotBookedConsumed]);

  const openNotBookedFlow = useCallback(() => {
    void (async () => {
      try {
        const result = await beginAppointmentRequestNotBookedFlow({
          submission,
          returnPath: buildGmailInboxReturnPath(mailbox, message.threadId),
          practiceTz,
          navigate,
          mailbox,
          threadId: message.threadId,
          bookedApptSummary: bookedApptSummaryRef.current,
        });
        if (result.kind === 'scheduler_remove') {
          onError('Remove this visit from the calendar, then mark the request as not booked.');
          return;
        }
        if (result.kind === 'already_dismissed') return;
      } catch {
        onError('Could not verify the linked calendar visit. Try again.');
        return;
      }
      setNotBookedChoice('');
      setNotBookedOther('');
      setNotBookedError(null);
      setNotBookedOpen(true);
    })();
  }, [
    submission,
    mailbox,
    message.threadId,
    practiceTz,
    navigate,
    onError,
  ]);

  const status: AppointmentRequestSubmissionStatus = submission.status ?? 'new';
  const rd = useMemo(() => submission.requestData ?? {}, [submission.requestData]);
  const clientName = clientDisplayNameFromRequestData(rd);
  const petSummary = requestDataPetSummary(rd);
  const apptType = requestDataAppointmentTypeLabel(rd);
  const clientType = requestDataClientType(rd);
  const hasLinkedAppointment =
    submission.bookedAppointmentId != null &&
    appointmentRequestBookedSummaryMatchesSubmission(submission, bookedApptSummary);
  const isOnHold =
    hasLinkedAppointment &&
    appointmentRequestSubmissionGmailOnHold(submission, bookedApptMeta, typeCatalog);
  const isDismissed = status === 'dismissed';
  const needsStaffConfirmation =
    hasLinkedAppointment && appointmentRequestNeedsStaffConfirmation(submission);
  const isBooked =
    hasLinkedAppointment &&
    appointmentRequestSubmissionCountsAsBooked(submission, bookedApptMeta, typeCatalog);
  const hasSms = appointmentRequestHasSmsPhone(submission);

  const bookedVisit = useMemo(
    () =>
      appointmentRequestBookedVisitLabels({
        requestData: rd,
        bookedSummary: bookedApptSummary,
        practiceTz,
        typeCatalog,
        isOnHold,
      }),
    [rd, bookedApptSummary, practiceTz, typeCatalog, isOnHold]
  );

  /** Push a Gmail label change for this thread and propagate the new labelIds up. */
  const applyOutcomeLabel = useCallback(
    async (outcome: ApptRequestOutcome): Promise<boolean> => {
      const result = await applyApptRequestGmailOutcomeLabel({
        mailbox,
        message,
        outcome,
        userLabels,
      });
      if (result.ok && result.labelIds) {
        onLabelsApplied([
          { messageId: message.id, threadId: message.threadId, labelIds: result.labelIds },
        ]);
      }
      return result.ok;
    },
    [mailbox, message, userLabels, onLabelsApplied]
  );

  // Reconcile Gmail outcome labels whenever submission status changes (e.g. after Book → return).
  const reconciledOutcomeRef = useRef<string | null>(null);
  useEffect(() => {
    const outcome = resolveApptRequestGmailOutcome(submission);
    if (!outcome) return;

    const ids = resolveApptRequestLabelIds(userLabels);
    const labelKey =
      outcome === 'booked'
        ? ids.booked
        : outcome === 'not_booked'
          ? ids.notBooked
          : ids.contacted;
    if (!labelKey) return;

    const sig = `${submission.id}:${message.threadId}:${outcome}:${labelKey}:${submission.updated ?? ''}:${submission.staffConfirmedAt ?? ''}:${submission.linkedVisitPoints ?? ''}:${submission.status ?? ''}`;
    if (reconciledOutcomeRef.current === sig) return;

    void applyOutcomeLabel(outcome).then((ok) => {
      if (ok) reconciledOutcomeRef.current = sig;
    });
  }, [
    submission,
    message.threadId,
    applyOutcomeLabel,
    userLabels,
  ]);

  /** Mirror the linked visit's hold state to the ON HOLD Gmail label (bidirectional). */
  const applyOnHoldLabel = useCallback(
    async (isHold: boolean): Promise<boolean> => {
      const result = await applyApptRequestGmailOnHoldLabel({
        mailbox,
        message,
        isOnHold: isHold,
        userLabels,
      });
      if (result.ok && result.labelIds) {
        onLabelsApplied([
          { messageId: message.id, threadId: message.threadId, labelIds: result.labelIds },
        ]);
      }
      return result.ok;
    },
    [mailbox, message, userLabels, onLabelsApplied],
  );

  // Add/remove the ON HOLD label as the linked visit moves in and out of hold.
  const reconciledOnHoldRef = useRef<string | null>(null);
  useEffect(() => {
    const ids = resolveApptRequestLabelIds(userLabels);
    if (!ids.onHold) return;

    // Only trust the hold state once we can actually compute it: no linked visit,
    // server-provided points, or the fetched appointment summary is loaded.
    const hasLinkedAppt = submission.bookedAppointmentId != null;
    const pointsKnown =
      submission.linkedVisitPoints != null && Number.isFinite(submission.linkedVisitPoints);
    const onHoldReady =
      !hasLinkedAppt || pointsKnown || bookedApptSummary != null || needsStaffConfirmation;
    if (!onHoldReady) return;

    const sig = `${message.threadId}:${apptRequestGmailOnHoldSyncSignature(submission, isOnHold)}`;
    if (reconciledOnHoldRef.current === sig) return;

    void applyOnHoldLabel(isOnHold).then((ok) => {
      if (ok) reconciledOnHoldRef.current = sig;
    });
  }, [
    submission,
    message.threadId,
    isOnHold,
    bookedApptSummary,
    needsStaffConfirmation,
    applyOnHoldLabel,
    userLabels,
  ]);

  const patchSubmission = useCallback(
    async (body: Parameters<typeof patchAppointmentRequestSubmission>[1]) => {
      const updated = await patchAppointmentRequestSubmission(submission.id, body);
      onSubmissionUpdated({ ...updated, kind: 'submission' });
      return updated;
    },
    [submission.id, onSubmissionUpdated]
  );

  const onBook = () => {
    // Book must open a new discrete visit. Leftover reschedule / forward-booking
    // session state would make Routing PATCH an existing household appointment.
    dismissRoutingRescheduleWorkspace();
    dismissRoutingForwardBookingWorkspace();
    const intent = buildRoutingAppointmentRequestIntentFromSubmission(submission);
    writeRoutingAppointmentRequestIntent({
      ...intent,
      workspaceActive: true,
      returnToListAfterBook: false,
      returnToGmail: {
        mailbox,
        threadId: message.threadId,
      },
    });
    navigate('/schedule/routing');
  };

  const onReschedule = () => {
    setBusy(true);
    void startRescheduleFromBookedAppointmentRequest({
      submission,
      practiceTz,
      navigate,
      returnToGmail: {
        mailbox,
        threadId: message.threadId,
      },
    })
      .then((result) => {
        if (result.error) onError(result.error);
      })
      .finally(() => setBusy(false));
  };

  const onViewAppointment = () => {
    const apptId = submission.bookedAppointmentId;
    if (apptId == null) return;
    const { dateKey, providerId } = appointmentRequestSchedulerViewHints(
      submission,
      bookedApptSummaryRef.current,
      practiceTz,
    );
    writeSchedulerFocusSession({
      appointmentId: Number(apptId),
      dateHint: dateKey,
      providerHint: providerId ?? null,
    });
    writeSchedulerFocusReturnSession(mailbox, message.threadId);
    navigate(
      buildSchedulerFocusAppointmentUrl(Number(apptId), {
        date: dateKey ?? undefined,
        providerId,
      }),
    );
  };

  const openConfirmPreview = () => {
    if (!appointmentRequestNeedsStaffConfirmation(submission)) return;
    void beginAppointmentRequestStaffConfirmFlow({
      submission,
      practiceTz,
      navigate,
      typeCatalog,
      bookedApptSummary: bookedApptSummaryRef.current,
      mailbox,
      threadId: message.threadId,
    })
      .then((result) => {
        if (result.kind === 'scheduler_review') return;
        if (result.kind === 'needs_relink') {
          onError(
            'The linked calendar visit changed. Use Re-link appointment on the appointment request to pick the correct one.',
          );
          return;
        }
        if (result.kind === 'needs_not_booked') {
          onError(
            'No calendar visit found for this request. Use Not booked if it was cancelled or never booked.',
          );
          return;
        }
        if (result.kind === 'error') {
          onError(result.message);
          return;
        }
        // already_confirmed
        onSubmissionUpdated({
          ...submission,
          staffConfirmedAt: submission.staffConfirmedAt?.trim() || new Date().toISOString(),
        });
        notifySchedulingToolsNavCountsRefresh();
      })
      .catch(() => {
        onError('Could not confirm this appointment request.');
      });
  };

  const openSms = () => {
    if (!hasSms) return;
    setSmsError(null);
    setSmsOpen(true);
    setSmsMessage('');
    setSmsLoading(true);
    void resolveAppointmentRequestSmsMessage(submission, practiceTz, { practiceId: PRACTICE_ID })
      .then(setSmsMessage)
      .finally(() => setSmsLoading(false));
  };

  useEffect(() => {
    if (!autoOpenSms) return;
    onAutoOpenSmsConsumed?.();
    openSms();
  }, [autoOpenSms, onAutoOpenSmsConsumed, submission.id]);

  const handleSendSms = async (opts: { overrideNonProd: boolean }) => {
    if (!smsMessage.trim()) return;
    setSmsSending(true);
    setSmsError(null);
    try {
      await sendAppointmentRequestSubmissionSms(submission.id, {
        message: smsMessage.trim(),
        ...(opts.overrideNonProd ? { overrideNonProd: true } : {}),
      });
      setSmsOpen(false);
      await markContacted();
    } catch (e: unknown) {
      setSmsError(errorMessage(e, 'Failed to send text message.'));
    } finally {
      setSmsSending(false);
    }
  };

  const openMessagesHistoryFromSms = () => {
    const label = clientName;
    const phone = requestDataPhone(rd);
    const syncId = requestDataClientId(rd);
    if (syncId) {
      setMessagesClientId(Number(syncId));
      setMessagesClientLabel(label);
      setMessagesFromLine(phone);
      return;
    }
    void resolveRequestDataClientIdStaff(rd, PRACTICE_ID).then((id) => {
      if (!id) {
        setSmsError('Could not find this client in the system to load message history.');
        return;
      }
      setMessagesClientId(Number(id));
      setMessagesClientLabel(label);
      setMessagesFromLine(phone);
    });
  };

  /** After a successful reach-out, move a still-new request to Contacted + label the thread. */
  const markContacted = useCallback(async () => {
    if ((submission.status ?? 'new') === 'new') {
      try {
        await patchSubmission({ status: 'contacted' });
      } catch {
        /* non-blocking */
      }
    }
    await applyOutcomeLabel('contacted');
  }, [submission.status, patchSubmission, applyOutcomeLabel]);

  const confirmNotBooked = async () => {
    const reason =
      notBookedChoice === NOT_BOOKED_REASON_OTHER ? notBookedOther.trim() : notBookedChoice.trim();
    if (!reason) {
      setNotBookedError('Please select or enter a reason.');
      return;
    }
    const apptId = submission.bookedAppointmentId;
    if (apptId != null) {
      try {
        const appt = await fetchAppointmentById(Number(apptId), { practiceId: PRACTICE_ID });
        if (appointmentRecordHasActiveLinkedVisit(appt)) {
          setNotBookedError(
            'This visit is still on the calendar. Remove it before marking the request as not booked.',
          );
          return;
        }
      } catch {
        setNotBookedError('Could not verify the linked calendar visit. Try again.');
        return;
      }
    }
    setNotBookedSaving(true);
    setNotBookedError(null);
    try {
      await patchSubmission({ status: 'dismissed', notBookedReason: reason });
      await applyOutcomeLabel('not_booked');
      setNotBookedOpen(false);
      setNotBookedChoice('');
      setNotBookedOther('');
    } catch (e: unknown) {
      setNotBookedError(errorMessage(e, 'Could not mark as not booked.'));
    } finally {
      setNotBookedSaving(false);
    }
  };

  const saveNotes = async () => {
    setNotesSaving(true);
    setNotesError(null);
    try {
      await patchSubmission({ notes: notesDraft.trim() ? notesDraft : '' });
    } catch (e: unknown) {
      setNotesError(errorMessage(e, 'Could not save note.'));
    } finally {
      setNotesSaving(false);
    }
  };

  const notesDirty = (submission.notes ?? '') !== notesDraft;

  const scoutListTab = appointmentRequestListTabForSubmission(submission);
  const scoutListPath = appointmentRequestsPathForTab(scoutListTab, {
    highlightId: submission.id,
  });

  return (
    <div className="gmail-appt-panel">
      <div className="gmail-appt-panel__head">
        <div className="gmail-appt-panel__title">
          <span className="gmail-appt-panel__badge">
            {needsStaffConfirmation ? 'Online booking' : 'Appointment request'}
          </span>
          <strong>{clientName}</strong>
        </div>
        <a
          className="gmail-appt-panel__link"
          href={scoutListPath}
          onClick={(e) => {
            e.preventDefault();
            navigate(scoutListPath, {
              state: { appointmentsTab: scoutListTab } satisfies AppointmentsListLocationState,
            });
          }}
        >
          Open in Scout
        </a>
      </div>

      <div className="gmail-appt-panel__summary">
        {petSummary ? <span>{petSummary}</span> : null}
        {apptType ? <span> · {apptType}</span> : null}
        {bookedVisit.bookedLabel ? (
          <div
            className={`gmail-appt-panel__visit${isOnHold ? ' gmail-appt-panel__visit--hold' : ''}`}
          >
            {bookedVisit.bookedLabel}
            {bookedVisit.providerLabel ? ` · ${bookedVisit.providerLabel}` : ''}
          </div>
        ) : null}
        {isDismissed && submission.notBookedReason ? (
          <div className="gmail-appt-panel__muted">Not booked: {submission.notBookedReason}</div>
        ) : null}
      </div>

      <div className="gmail-appt-panel__actions">
        {hasSms ? (
          <button type="button" className="btn secondary" disabled={busy} onClick={openSms}>
            Text client
          </button>
        ) : null}
        {needsStaffConfirmation ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={openConfirmPreview}
          >
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        ) : null}
        {!isBooked && !hasLinkedAppointment ? (
          <button type="button" className="btn primary" disabled={busy} onClick={onBook}>
            Book
          </button>
        ) : null}
        {hasLinkedAppointment && !needsStaffConfirmation ? (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={onViewAppointment}
          >
            View appointment
          </button>
        ) : null}
        {isBooked ? (
          <button type="button" className="btn secondary" disabled={busy} onClick={onReschedule}>
            Reschedule
          </button>
        ) : null}
        {!isDismissed ? (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => openNotBookedFlow()}
          >
            Not booked
          </button>
        ) : null}
      </div>

      <div className="gmail-appt-panel__notes">
        <div className="gmail-appt-panel__notes-head">
          <label htmlFor={`gmail-appt-note-${submission.id}`}>Notes</label>
          <button
            type="button"
            className="btn secondary"
            style={{ fontSize: 12, padding: '3px 10px' }}
            disabled={!notesDirty || notesSaving}
            onClick={() => void saveNotes()}
          >
            {notesSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <textarea
          id={`gmail-appt-note-${submission.id}`}
          className="settings-input gmail-appt-panel__notes-input"
          rows={2}
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          placeholder="e.g. Left voicemail; will try again tomorrow."
        />
        {notesError ? <span className="gmail-appt-panel__error">{notesError}</span> : null}
      </div>

      {smsOpen ? (
        <ClientSmsComposeModal
          open
          clientLabel={clientName}
          message={smsLoading ? 'Loading message…' : smsMessage}
          onMessageChange={setSmsMessage}
          onClose={() => setSmsOpen(false)}
          onSend={(opts) => void handleSendSms(opts)}
          onOpenMessagesHistory={openMessagesHistoryFromSms}
          sending={smsSending || smsLoading}
          sendError={smsError}
          title="Text requester"
          subtitle={`Message goes to the phone on the request${
            requestDataCanText(rd) === 'Yes' ? ' (client consented to texts)' : ''
          }.`}
        />
      ) : null}

      <ClientMessagesHistoryModal
        open={messagesClientId != null}
        clientId={messagesClientId}
        clientLabel={messagesClientLabel}
        openPhoneLine={messagesFromLine}
        onClose={() => {
          setMessagesClientId(null);
          setMessagesClientLabel('');
          setMessagesFromLine(null);
        }}
      />

      {notBookedOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gmail-appt-not-booked-title"
          onClick={() => (notBookedSaving ? null : setNotBookedOpen(false))}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(480px, 90vw)', padding: 24, borderRadius: 12, background: '#fff' }}
          >
            <h3
              id="gmail-appt-not-booked-title"
              style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}
            >
              Mark as not booked
            </h3>
            <p className="settings-muted" style={{ marginTop: 0, marginBottom: 16 }}>
              {clientName}
            </p>
            <label
              htmlFor="gmail-appt-not-booked-reason"
              style={{ display: 'block', marginBottom: 6 }}
            >
              Reason <span style={{ color: '#b91c1c' }}>*</span>
            </label>
            <select
              id="gmail-appt-not-booked-reason"
              className="settings-input"
              value={notBookedChoice}
              onChange={(e) => {
                setNotBookedChoice(e.target.value);
                setNotBookedError(null);
              }}
              style={{ width: '100%', marginBottom: 12 }}
            >
              <option value="">Select a reason…</option>
              {NOT_BOOKED_REASON_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={NOT_BOOKED_REASON_OTHER}>Other…</option>
            </select>
            {notBookedChoice === NOT_BOOKED_REASON_OTHER ? (
              <textarea
                className="settings-input"
                rows={3}
                value={notBookedOther}
                onChange={(e) => {
                  setNotBookedOther(e.target.value);
                  setNotBookedError(null);
                }}
                placeholder="Describe why this request was not booked"
                style={{ width: '100%', marginBottom: 12 }}
              />
            ) : null}
            {notBookedError ? (
              <p style={{ color: '#b91c1c', fontSize: 13, margin: '0 0 12px' }}>{notBookedError}</p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn secondary"
                disabled={notBookedSaving}
                onClick={() => setNotBookedOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={notBookedSaving}
                onClick={() => void confirmNotBooked()}
              >
                {notBookedSaving ? 'Saving…' : 'Mark not booked'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function errorMessage(e: unknown, fallback: string): string {
  return (
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    (e as Error)?.message ??
    fallback
  );
}
