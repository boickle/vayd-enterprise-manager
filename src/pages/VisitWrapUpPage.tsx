import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lock,
  Mail,
  MailX,
  PawPrint,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Syringe,
  X,
} from 'lucide-react';
import './SoapEncounterPage.css';
import './VisitWrapUpPage.css';
import {
  completeEncounter,
  createEncounter,
  getEncounter,
  updateEncounter,
  VISIT_WORKFLOW_PRACTICE_ID,
} from '../api/visitWorkflow';
import {
  generateClientRecap,
  getVisitReminders,
  getVisitWrapUp,
  persistClientRecapDraft,
  prefetchClientRecap,
  recordClientEmailDecision,
  type PastDueReminder,
  type VisitReminderPet,
  type VisitWrapUp,
  type VisitWrapUpPet,
} from '../api/visitWrapUp';
import { declineReminder, formatDeclinedDate } from '../api/declinedTreatments';
import { patchReminder } from '../api/careOutreach';
import { appConfirm, appPrompt } from '../utils/appDialog';
import { createTask } from '../api/tasks';
import { listPracticeBranches } from '../api/branchInventory';
import {
  fetchGmailMailboxes,
  fetchGmailSendAs,
  fetchGmailSendAsAlias,
  sendGmailMessage,
  type GmailSendAsAlias,
} from '../api/gmail';
import {
  plainTextFromHtml,
  signatureHtmlForFromAlias,
} from '../components/gmail/gmailCompose';
import { sanitizeCommunicationHtml } from '../utils/sanitizeCommunicationHtml';
import {
  formatSendAsLabel,
  isFallbackSender,
  ensureRecapFarewell,
  recapHasFarewell,
  RECAP_FAREWELL,
  parseRecapRecipients,
  resolveRecapFromAddress,
  resolveRecapMailbox,
} from '../utils/visitRecapSender';
import WrapUpCallbacks from '../components/soap/WrapUpCallbacks';
import WrapUpChronicReview from '../components/soap/WrapUpChronicReview';
import SoapRichTextField, {
  soapTextToEditorHtml,
} from '../components/soap/SoapRichTextField';
import { soapHtmlToPlainText } from '../utils/sanitizeCommunicationHtml';
import { commitSoapChronicDraft, readSoapChronicDraft } from '../utils/soapChronicDraft';
import { isWeightAddressed, vitalsFromValue } from '../utils/soapVitals';
import { useAuth } from '../auth/useAuth';
import ScribePromptOverridesModal from '../components/soap/ScribePromptOverridesModal';

/** `Name <a@b.com>` → `a@b.com`, for the address we hand back to the recorder. */
function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

/**
 * The chart's signature: who locked it and when. Shown on every signed chart because an
 * attributable, timestamped lock is the point of signing — eVet leaves records silently
 * editable, so "who wrote this and when was it final" is unanswerable there.
 */
function signatureLine(pet: VisitWrapUpPet): string {
  const who = pet.completedByName?.trim() || 'Unknown user';
  if (!pet.completedAt) return `Signed & locked by ${who}`;
  const when = new Date(pet.completedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `Signed & locked by ${who} — ${when}`;
}

function petSummaryLine(pet: VisitWrapUpPet): string {
  const charted = [
    pet.subjectiveHistory,
    pet.objectiveNotes,
    pet.assessmentReasoning,
    pet.planNotes,
  ].filter((t) => t?.trim()).length;
  if (charted === 0) return 'Nothing charted yet';
  return `${charted} of 4 sections charted`;
}

/**
 * Visit wrap-up — the step after the SOAP, where the doctor reviews the household's
 * finished charts and sends (or deliberately declines) the client recap. Follow-up
 * is settled on End Visit and checkout.
 *
 * The client recap starts blank. The first time wrap-up opens with an empty draft, it
 * generates from the finished charts and saves that draft. Later visits keep the saved
 * draft (so SOAP edits never silently overwrite a long email); use Regenerate to rebuild.
 */
export default function VisitWrapUpPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const appointmentId = Number(params.appointmentId);
  const patientId = Number(params.patientId);
  const clientIdParam = searchParams.get('clientId');

  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [wrapUp, setWrapUp] = useState<VisitWrapUp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-pet card expand state
  const [expandedSoaps, setExpandedSoaps] = useState<Set<number>>(new Set());
  const [expandedReminders, setExpandedReminders] = useState<Set<number>>(new Set());

  // Inline SOAP editing — keyed by patientId
  type SoapDraft = { S: string; O: string; A: string; P: string };
  const [soapDrafts, setSoapDrafts] = useState<Map<number, SoapDraft>>(new Map());
  const [soapSaving, setSoapSaving] = useState<Set<number>>(new Set());
  const [soapSaveError, setSoapSaveError] = useState<Map<number, string>>(new Map());

  // Reminder data (past-due, proposed, declined items) — one fetch covers the household
  const [reminderPets, setReminderPets] = useState<VisitReminderPet[]>([]);
  const [pastDueBusyId, setPastDueBusyId] = useState<number | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);

  // Email state
  const [selectedPetIds, setSelectedPetIds] = useState<Set<number>>(new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [showSkip, setShowSkip] = useState(false);
  /** Reopen the composer after a recap was already sent or skipped, to correct a mistake. */
  const [redoingEmail, setRedoingEmail] = useState(false);

  const [mailbox, setMailbox] = useState<string | null>(null);
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  const [sendAsOptions, setSendAsOptions] = useState<GmailSendAsAlias[]>([]);
  /** True after the initial wrap-up email hydrate/generate finishes — gates draft autosave. */
  const [emailHydrated, setEmailHydrated] = useState(false);

  const [completing, setCompleting] = useState(false);
  const [showPromptOverrides, setShowPromptOverrides] = useState(false);

  const { employeeId, role } = useAuth() as {
    employeeId?: string | null;
    role?: string | string[] | null;
  };
  const scribeEnabled = String(import.meta.env.VITE_ENABLE_SCRIBE ?? '').toLowerCase() === 'true';
  const rolesLower = (Array.isArray(role) ? role : []).map((r) => String(r).toLowerCase());
  const isAdmin = rolesLower.some((r) => r === 'admin' || r === 'superadmin');
  const selfEmployeeId = employeeId != null && employeeId !== '' ? Number(employeeId) : NaN;

  const loadWrapUp = useCallback(async (id: string) => {
    const data = await getVisitWrapUp(id);
    setWrapUp(data);
    return data;
  }, []);

  useEffect(() => {
    if (!Number.isFinite(appointmentId) || !Number.isFinite(patientId)) {
      setError('Missing appointment or patient.');
      setLoading(false);
      return;
    }
    let canceled = false;
    setLoading(true);
    setEmailError(null);
    setEmailHydrated(false);
    void (async () => {
      try {
        // Idempotent — returns the encounter the SOAP page has been writing to.
        const enc = await createEncounter({
          appointmentId,
          patientId,
          ...(clientIdParam ? { clientId: Number(clientIdParam) } : {}),
        });
        if (canceled) return;
        setEncounterId(enc.id);
        // Load reminder data in parallel — past-due, proposed, declined items
        void getVisitReminders(enc.id)
          .then(({ pets: rp }) => { if (!canceled) setReminderPets(rp); })
          .catch(() => { /* non-critical; actions still work */ });
        const data = await loadWrapUp(enc.id);
        if (canceled) return;
        const petIds = data.pets.map((p) => p.patientId);
        setSelectedPetIds(new Set(petIds));
        setRecipients(data.clientEmails.join(', '));
        setLoading(false);

        if (data.clientEmailDelivery?.status) {
          setSubject(data.emailDraft.subject);
          setBody(data.emailDraft.body);
          setEmailHydrated(true);
          return;
        }

        const hasDraft =
          Boolean(data.emailDraft.subject.trim()) || Boolean(data.emailDraft.body.trim());
        if (hasDraft) {
          setSubject(data.emailDraft.subject);
          setBody(data.emailDraft.body);
          setEmailHydrated(true);
          return;
        }

        setRegenerating(true);
        try {
          const draft = await prefetchClientRecap(enc.id, petIds);
          if (canceled) return;
          if (draft) {
            setSubject(draft.subject);
            setBody(draft.body);
          } else {
            setSubject('');
            setBody('');
            setEmailError('Could not write the recap from the charts.');
          }
        } finally {
          if (!canceled) {
            setRegenerating(false);
            setEmailHydrated(true);
          }
        }
      } catch (e) {
        if (!canceled) {
          setError(e instanceof Error ? e.message : 'Could not load the visit wrap-up.');
          setLoading(false);
          setEmailHydrated(true);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [appointmentId, patientId, clientIdParam, loadWrapUp]);

  // Keep manual edits on the encounter so leaving wrap-up and coming back does not lose them.
  useEffect(() => {
    if (!emailHydrated || !encounterId || regenerating) return;
    if (wrapUp?.clientEmailDelivery?.status) return;
    const t = window.setTimeout(() => {
      void persistClientRecapDraft(encounterId, { subject, body }).catch(() => {
        /* Autosave is best-effort; Send still records the final message. */
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [subject, body, encounterId, emailHydrated, regenerating, wrapUp?.clientEmailDelivery?.status]);
  // Which mailbox and which From the recap will use. Defaults to the visit
  // provider's send-as alias on the field inbox; the doctor can switch aliases.
  useEffect(() => {
    if (!wrapUp) return;
    let canceled = false;
    void (async () => {
      try {
        const { mailboxes } = await fetchGmailMailboxes();
        const resolved = resolveRecapMailbox(mailboxes);
        if (canceled || !resolved) return;
        setMailbox(resolved);
        const { aliases } = await fetchGmailSendAs(resolved).catch(() => ({ aliases: [] as GmailSendAsAlias[] }));
        if (canceled) return;
        setSendAsOptions(aliases);
        setFromAddress(resolveRecapFromAddress(aliases, resolved, wrapUp.provider?.email ?? null));
      } catch {
        /* Sending surfaces its own error; the recap can still be skipped. */
      }
    })();
    return () => {
      canceled = true;
    };
  }, [wrapUp]);

  const signatureHtml = useMemo(
    () => (fromAddress ? signatureHtmlForFromAlias(sendAsOptions, fromAddress) : ''),
    [fromAddress, sendAsOptions]
  );

  // The list endpoint sometimes omits the HTML signature; fetch the alias if we
  // still don't have one for the chosen From.
  useEffect(() => {
    if (!mailbox || !fromAddress || signatureHtml.trim()) return;
    const email = bareAddress(fromAddress);
    if (!email) return;
    let canceled = false;
    void fetchGmailSendAsAlias(mailbox, email)
      .then((detail) => {
        if (canceled || !detail.signature?.trim()) return;
        setSendAsOptions((prev) =>
          prev.map((a) =>
            a.sendAsEmail.toLowerCase() === email ? { ...a, ...detail } : a
          )
        );
      })
      .catch(() => {
        /* Signature is optional; the recap still sends. */
      });
    return () => {
      canceled = true;
    };
  }, [mailbox, fromAddress, signatureHtml]);

  const pets = useMemo(() => wrapUp?.pets ?? [], [wrapUp]);
  const selectedPets = useMemo(
    () => pets.filter((p) => selectedPetIds.has(p.patientId)),
    [pets, selectedPetIds]
  );

  const emailDecided = Boolean(wrapUp?.clientEmailDelivery?.status);
  const allLocked = pets.length > 0 && pets.every((p) => p.status === 'completed');
  const clinicalComplete = useMemo(
    () =>
      pets.length > 0 &&
      pets.every((p) => {
        const o = p.outstandingClinical;
        if (!o) return true;
        return o.missingMeds.length === 0 && o.missingVaccines.length === 0;
      }),
    [pets]
  );
  const outstandingClinicalLabels = useMemo(() => {
    const names: string[] = [];
    for (const p of pets) {
      const o = p.outstandingClinical;
      if (!o) continue;
      for (const m of o.missingMeds) names.push(`${p.patientName}: ${m.name}`);
      for (const v of o.missingVaccines) names.push(`${p.patientName}: ${v.name}`);
    }
    return names;
  }, [pets]);
  const weightComplete = useMemo(
    () =>
      pets.length > 0 &&
      pets.every((p) => isWeightAddressed(vitalsFromValue(p.objectiveVitals))),
    [pets]
  );
  const missingWeightPets = useMemo(
    () =>
      pets
        .filter((p) => !isWeightAddressed(vitalsFromValue(p.objectiveVitals)))
        .map((p) => p.patientName),
    [pets]
  );
  const canComplete = emailDecided && clinicalComplete && weightComplete && !allLocked;

  const toggleSoap = useCallback((pet: VisitWrapUpPet) => {
    const { patientId } = pet;
    setExpandedSoaps((prev) => {
      const next = new Set(prev);
      if (next.has(patientId)) next.delete(patientId);
      else next.add(patientId);
      return next;
    });
    // Initialise the local draft on first open so textareas have something to bind
    setSoapDrafts((prev) => {
      if (prev.has(patientId)) return prev;
      const next = new Map(prev);
      next.set(patientId, {
        S: pet.subjectiveHistory ?? '',
        O: pet.objectiveNotes ?? '',
        A: pet.assessmentReasoning ?? '',
        P: pet.planNotes ?? '',
      });
      return next;
    });
  }, []);

  const toggleReminders = useCallback((patientId: number) => {
    setExpandedReminders((prev) => {
      const next = new Set(prev);
      if (next.has(patientId)) next.delete(patientId);
      else next.add(patientId);
      return next;
    });
  }, []);

  const saveSoapField = useCallback(
    async (pet: VisitWrapUpPet, field: 'S' | 'O' | 'A' | 'P', value: string) => {
      if (!encounterId) return;
      setSoapSaving((prev) => new Set(prev).add(pet.patientId));
      setSoapSaveError((prev) => { const n = new Map(prev); n.delete(pet.patientId); return n; });
      try {
        if (field === 'S') {
          // subjectiveHistory lives inside enc.subjective.history (JSON object)
          const enc = await getEncounter(pet.soapEncounterId);
          const prev =
            enc.subjective && typeof enc.subjective === 'object'
              ? (enc.subjective as Record<string, unknown>)
              : {};
          await updateEncounter(pet.soapEncounterId, { subjective: { ...prev, history: value } });
        } else if (field === 'O') {
          await updateEncounter(pet.soapEncounterId, { objectiveNotes: value || null });
        } else if (field === 'A') {
          await updateEncounter(pet.soapEncounterId, { assessmentReasoning: value || null });
        } else {
          await updateEncounter(pet.soapEncounterId, { planNotes: value || null });
        }
        // Refresh wrapUp so petSummaryLine / recap-generate sees the new text
        await loadWrapUp(encounterId);
      } catch (e) {
        setSoapSaveError((prev) => {
          const n = new Map(prev);
          n.set(pet.patientId, e instanceof Error ? e.message : 'Could not save that note.');
          return n;
        });
      } finally {
        setSoapSaving((prev) => { const n = new Set(prev); n.delete(pet.patientId); return n; });
      }
    },
    [encounterId, loadWrapUp]
  );

  const handleDeclinePastDue = useCallback(async (reminder: PastDueReminder) => {
    const proceed = await appConfirm({
      title: 'Owner declined this?',
      message: `Record "${reminder.description}" under Declined on the chart.`,
      confirmLabel: 'Record decline',
      cancelLabel: 'Cancel',
    });
    if (!proceed) return;
    const note = await appPrompt({
      title: 'Decline note (optional)',
      message: 'Why was this declined?',
      placeholder: 'Optional',
      confirmLabel: 'Save',
      cancelLabel: 'Skip note',
    });
    setPastDueBusyId(reminder.id);
    setReminderError(null);
    try {
      await declineReminder(reminder.id, note);
      setReminderPets((prev) =>
        prev.map((p) => ({
          ...p,
          pastDueReminders: (p.pastDueReminders ?? []).filter((r) => r.id !== reminder.id),
        }))
      );
    } catch (e) {
      setReminderError(e instanceof Error ? e.message : 'Could not decline that reminder.');
    } finally {
      setPastDueBusyId(null);
    }
  }, []);

  const handleDeletePastDue = useCallback(async (reminder: PastDueReminder) => {
    const proceed = await appConfirm({
      title: 'Remove this reminder?',
      message: `"${reminder.description}" will leave the reminder list (not recorded as declined).`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
    });
    if (!proceed) return;
    setPastDueBusyId(reminder.id);
    setReminderError(null);
    try {
      await patchReminder(reminder.id, { isHidden: true });
      setReminderPets((prev) =>
        prev.map((p) => ({
          ...p,
          pastDueReminders: (p.pastDueReminders ?? []).filter((r) => r.id !== reminder.id),
        }))
      );
    } catch (e) {
      setReminderError(e instanceof Error ? e.message : 'Could not remove that reminder.');
    } finally {
      setPastDueBusyId(null);
    }
  }, []);

  const backToSoap = (pet: VisitWrapUpPet) => {
    const qs = clientIdParam ? `?clientId=${encodeURIComponent(clientIdParam)}` : '';
    navigate(`/schedule/soap/${pet.appointmentId}/${pet.patientId}${qs}`);
  };

  const goToClinicalGap = (pet: VisitWrapUpPet) => {
    const first =
      pet.outstandingClinical?.missingMeds[0] ?? pet.outstandingClinical?.missingVaccines[0];
    if (!first) return;
    const qs = new URLSearchParams();
    if (clientIdParam) qs.set('clientId', clientIdParam);
    qs.set('focusOrder', first.orderId);
    navigate(`/schedule/soap/${pet.appointmentId}/${pet.patientId}?${qs.toString()}`);
  };

  const goToWeight = (pet: VisitWrapUpPet) => {
    const qs = new URLSearchParams();
    if (clientIdParam) qs.set('clientId', clientIdParam);
    qs.set('focus', 'weight');
    navigate(`/schedule/soap/${pet.appointmentId}/${pet.patientId}?${qs.toString()}`);
  };

  const togglePet = (id: number) => {
    setSelectedPetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onRegenerate = async () => {
    if (!encounterId || regenerating) return;
    setRegenerating(true);
    setEmailError(null);
    try {
      const petIds =
        selectedPets.length > 0
          ? selectedPets.map((p) => p.patientId)
          : pets.map((p) => p.patientId);
      const draft = await generateClientRecap(encounterId, petIds);
      setSubject(draft.subject);
      setBody(draft.body);
      await persistClientRecapDraft(encounterId, draft);
    } catch (e) {
      setEmailError(
        e instanceof Error ? e.message : 'Could not rewrite the recap from the charts.'
      );
    } finally {
      setRegenerating(false);
    }
  };

  const onSend = async () => {
    if (!encounterId || sending) return;
    const to = parseRecapRecipients(recipients);
    if (to.length === 0) {
      setEmailError('Add at least one recipient address. Separate multiple emails with commas.');
      return;
    }
    if (!mailbox || !fromAddress) {
      setEmailError(
        'No practice mailbox is connected for sending. Connect the field inbox under Email, or choose not to email.'
      );
      return;
    }
    if (selectedPets.length === 0) {
      setEmailError('Choose at least one pet for the recap.');
      return;
    }
    setSending(true);
    setEmailError(null);
    try {
      // The recap carries bold on the things the client has to do or watch for, so it
      // goes out as HTML. The Gmail send-as signature (Dr. Heather, practice block, etc.)
      // is attached here, not stored in the draft, so switching From swaps it cleanly.
      const closed = ensureRecapFarewell({
        html: soapTextToEditorHtml(body),
        text: soapHtmlToPlainText(body),
      });
      const sigHtml = fromAddress
        ? signatureHtmlForFromAlias(sendAsOptions, fromAddress).trim()
        : '';
      const sent = await sendGmailMessage(mailbox, {
        from: bareAddress(fromAddress),
        to,
        subject,
        // Blank line between "Take care," and the Gmail signature, the way a
        // person would space a letter. The farewell is added here if the draft
        // skipped it, so a missing closing never reaches the client.
        bodyText: sigHtml
          ? `${closed.text}\n\n${plainTextFromHtml(sigHtml)}`
          : closed.text,
        bodyHtml: sigHtml ? `${closed.html}<br><br>${sigHtml}` : closed.html,
      });
      const updated = await recordClientEmailDecision(encounterId, {
        status: 'sent',
        patientIds: selectedPets.map((p) => p.patientId),
        recipients: to,
        subject,
        body,
        fromAddress: bareAddress(fromAddress),
        mailbox,
        gmailMessageId: sent.id,
        gmailThreadId: sent.threadId,
      });
      setWrapUp(updated);
      setRedoingEmail(false);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Could not send the recap.');
    } finally {
      setSending(false);
    }
  };

  const onSkip = async () => {
    if (!encounterId || skipping) return;
    if (!skipReason.trim()) {
      setEmailError('Add a short reason so the record shows why no recap was sent.');
      return;
    }
    setSkipping(true);
    setEmailError(null);
    try {
      const updated = await recordClientEmailDecision(encounterId, {
        status: 'skipped',
        skipReason: skipReason.trim(),
      });
      setWrapUp(updated);
      setShowSkip(false);
      setRedoingEmail(false);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Could not record that decision.');
    } finally {
      setSkipping(false);
    }
  };

  const onSignAndLock = async () => {
    if (!encounterId || completing) return;
    setCompleting(true);
    setError(null);
    try {
      // Sequential so a failure leaves the remaining charts untouched.
      let branchIds: number[] = [];
      try {
        branchIds = (await listPracticeBranches(VISIT_WORKFLOW_PRACTICE_ID)).map((b) => b.id);
      } catch {
        branchIds = [];
      }
      for (const pet of pets) {
        if (pet.status === 'completed') continue;
        try {
          const { pets: reminderPets } = await getVisitReminders(pet.soapEncounterId);
          const plan = reminderPets.find((p) => p.soapEncounterId === pet.soapEncounterId)?.plan;
          for (const cb of plan?.callbacks ?? []) {
            if (!cb.title.trim() || branchIds.length === 0) continue;
            const links: { entityType: 'patient' | 'client'; entityId: number }[] = [
              { entityType: 'patient', entityId: pet.patientId },
            ];
            if (wrapUp?.clientId != null) {
              links.push({ entityType: 'client', entityId: wrapUp.clientId });
            }
            await createTask({
              title: cb.title.trim(),
              body: cb.body?.trim() || null,
              kind: 'callback',
              branchIds,
              assignedToEmployeeId: cb.assignedToEmployeeId ?? null,
              ...(cb.dueAt ? { dueAt: cb.dueAt } : {}),
              links,
              idempotencyKey: `soap-cb-${pet.soapEncounterId}-${cb.key}`,
            });
          }
        } catch {
          /* reminder drafts still persist; staff can add the callback on wrap-up */
        }
        await commitSoapChronicDraft(
          pet.soapEncounterId,
          pet.patientId,
          readSoapChronicDraft(pet.soapEncounterId),
        );
        await completeEncounter(pet.soapEncounterId);
      }
      await loadWrapUp(encounterId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign the medical record.');
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return <div className="soap-page soap-loading">Loading visit wrap-up…</div>;
  }
  if (error && !wrapUp) {
    return <div className="soap-page soap-error-page">{error}</div>;
  }

  const delivery = wrapUp?.clientEmailDelivery ?? null;
  const currentPet = pets.find((p) => p.patientId === patientId) ?? pets[0];

  return (
    <div className="soap-page soap-wrapup">
      <header className="soap-header">
        <div className="soap-header-main">
          <CheckCircle2 size={20} />
          <div>
            <h1>Wrap up visit</h1>
            <span className="soap-header-sub">
              {wrapUp?.clientName ?? `Visit #${appointmentId}`} ·{' '}
              {pets.length === 1 ? pets[0]?.patientName : `${pets.length} pets`}
            </span>
          </div>
        </div>
        <div className="soap-header-actions">
          {scribeEnabled &&
            wrapUp?.provider?.id != null &&
            (isAdmin ||
              (Number.isFinite(selfEmployeeId) && selfEmployeeId === wrapUp.provider.id)) && (
              <button
                type="button"
                className="soap-provider-prompt-btn"
                onClick={() => setShowPromptOverrides(true)}
                title={`Edit provider-wide AI instructions for ${
                  wrapUp.provider.name ?? `Provider #${wrapUp.provider.id}`
                }`}
              >
                <SlidersHorizontal size={13} /> Scribe prompt
              </button>
            )}
          {currentPet && (
            <Link
              className="soap-btn"
              to={`/schedule/soap/${currentPet.appointmentId}/${currentPet.patientId}${
                clientIdParam ? `?clientId=${encodeURIComponent(clientIdParam)}` : ''
              }`}
            >
              <ArrowLeft size={14} /> Back to SOAP
            </Link>
          )}
          {allLocked ? (
            <span className="soap-locked-badge">
              <Lock size={14} /> SOAP signed &amp; locked
            </span>
          ) : (
            <button
              type="button"
              className="soap-btn primary"
              disabled={!canComplete || completing}
              title={
                !weightComplete
                  ? `Record weight (or No weight taken) first: ${missingWeightPets.join(', ')}`
                  : !clinicalComplete
                    ? `Record prescription/dose details first: ${outstandingClinicalLabels.join(', ')}`
                    : !emailDecided
                        ? 'Send the client recap, or choose not to email'
                        : 'Sign and lock the medical record for every pet on this visit'
              }
              onClick={onSignAndLock}
            >
              <CheckCircle2 size={15} /> {completing ? 'Signing…' : 'Sign & lock SOAP'}
            </button>
          )}
        </div>
      </header>

      {showPromptOverrides && wrapUp?.provider?.id != null && (
        <ScribePromptOverridesModal
          providerId={wrapUp.provider.id}
          providerName={wrapUp.provider.name?.trim() || `Provider #${wrapUp.provider.id}`}
          onClose={() => setShowPromptOverrides(false)}
        />
      )}

      {error && <div className="soap-error soap-error-banner">{error}</div>}

      <div className="soap-wrapup-body">
        {/* ── Per-pet cards — SOAP · chronic · declined · past-due · reminders going in · callbacks ── */}
        {pets.map((pet) => {
          const remPet = reminderPets.find((r) => r.patientId === pet.patientId);
          const soapOpen = expandedSoaps.has(pet.patientId);
          const remOpen = expandedReminders.has(pet.patientId);
          const pastDues = remPet?.pastDueReminders ?? [];
          const goingIn = (remPet?.reminders ?? []).filter((r) => !r.removed);
          const declinedItems = (remPet?.declinedItems ?? []).filter(
            (d) => d.onChart !== false
          );

          return (
            <section key={pet.patientId} className="soap-wrapup-section soap-wrapup-pet-card">
              {/* ── Sticky combined header: pet name + SOAP toggle (one row, sticks together) ── */}
              <div className="soap-wrapup-pet-head">
                <button
                  type="button"
                  className="soap-wrapup-pet-head-toggle"
                  onClick={() => toggleSoap(pet)}
                >
                  <PawPrint size={14} className="soap-wrapup-pet-paw" />
                  <strong className="soap-wrapup-pet-name">{pet.patientName}</strong>
                  {soapOpen ? <ChevronDown size={13} className="soap-wrapup-pet-chevron" /> : <ChevronRight size={13} className="soap-wrapup-pet-chevron" />}
                  <span className="soap-wrapup-chart-meta soap-wrapup-pet-soap-meta">{petSummaryLine(pet)}</span>
                </button>
                <span className="soap-wrapup-pet-head-right">
                  {pet.status === 'completed' ? (
                    <span className="soap-wrapup-chart-locked">
                      <Lock size={12} /> Signed
                    </span>
                  ) : (
                    <>
                      {((pet.outstandingClinical?.missingMeds.length ?? 0) > 0 ||
                        (pet.outstandingClinical?.missingVaccines.length ?? 0) > 0) && (
                        <button
                          type="button"
                          className="soap-wrapup-chart-pending soap-wrapup-chart-pending--link"
                          onClick={() => goToClinicalGap(pet)}
                        >
                          {(pet.outstandingClinical?.missingVaccines[0]
                            ? `Dose needed: ${pet.outstandingClinical.missingVaccines[0].name}`
                            : pet.outstandingClinical?.missingMeds[0]
                              ? `Rx needed: ${pet.outstandingClinical.missingMeds[0].name}`
                              : 'Rx/dose details needed')}
                        </button>
                      )}
                      {!isWeightAddressed(vitalsFromValue(pet.objectiveVitals)) && (
                        <button
                          type="button"
                          className="soap-wrapup-chart-pending soap-wrapup-chart-pending--link"
                          onClick={() => goToWeight(pet)}
                        >
                          Weight needed
                        </button>
                      )}
                      <button
                        type="button"
                        className="soap-wrapup-pet-edit-link"
                        title="Open full SOAP (orders, Rx, vitals)"
                        onClick={() => backToSoap(pet)}
                      >
                        Full SOAP
                      </button>
                    </>
                  )}
                </span>
              </div>
                {soapOpen && (
                  <div className="soap-wrapup-chart-body soap-wrapup-pet-soap-body">
                    {(
                      [
                        ['Subjective', 'S', pet.subjectiveHistory],
                        ['Objective', 'O', pet.objectiveNotes],
                        ['Assessment', 'A', pet.assessmentReasoning],
                        ['Plan', 'P', pet.planNotes],
                      ] as [string, 'S' | 'O' | 'A' | 'P', string | null][]
                    ).map(([label, field, serverText]) => {
                      const draft = soapDrafts.get(pet.patientId);
                      const value = draft ? draft[field] : (serverText ?? '');
                      const locked = pet.status === 'completed';
                      return (
                        <div className="soap-wrapup-chart-section" key={label}>
                          <h4>{label}</h4>
                          {locked ? (
                            serverText?.trim() ? (
                              <div
                                className="soap-wrapup-soap-read"
                                dangerouslySetInnerHTML={{
                                  __html: soapTextToEditorHtml(serverText),
                                }}
                              />
                            ) : (
                              <p className="soap-wrapup-hint">—</p>
                            )
                          ) : (
                            <SoapRichTextField
                              className="soap-wrapup-soap-rich"
                              value={value}
                              minHeightPx={64}
                              disabled={soapSaving.has(pet.patientId)}
                              placeholder={`${label}…`}
                              onChange={(next) => {
                                setSoapDrafts((prev) => {
                                  const n = new Map(prev);
                                  const cur = n.get(pet.patientId) ?? { S: '', O: '', A: '', P: '' };
                                  n.set(pet.patientId, { ...cur, [field]: next });
                                  return n;
                                });
                              }}
                              onBlur={(next) => {
                                if (next !== (serverText ?? '')) {
                                  void saveSoapField(pet, field, next);
                                }
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                    {soapSaveError.get(pet.patientId) && (
                      <p className="soap-error soap-wrapup-hint">{soapSaveError.get(pet.patientId)}</p>
                    )}
                    {soapSaving.has(pet.patientId) && (
                      <p className="soap-wrapup-hint soap-wrapup-soap-saving">Saving…</p>
                    )}
                    {pet.status === 'completed' && (
                      <p className="soap-wrapup-signature">
                        <Lock size={13} /> {signatureLine(pet)}
                      </p>
                    )}
                  </div>
                )}

              {/* ── Chronic problems & medications ── */}
              <WrapUpChronicReview pets={[pet]} noWrapper />

              {/* ── Declined this visit ── */}
              {declinedItems.length > 0 && (
                <div className="soap-wrapup-pet-row">
                  <span className="soap-wrapup-pet-sub-label">Declined this visit</span>
                  <div className="soap-wrapup-pet-chips">
                    {declinedItems.map((d) => (
                      <span key={d.id} className="soap-wrapup-pet-chip soap-wrapup-pet-chip--declined">
                        {d.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Past-due reminders that won't be cleared ── */}
              {pastDues.length > 0 && (
                <div className="soap-wrapup-pet-row soap-wrapup-pet-row--pastdue">
                  <span className="soap-wrapup-pet-sub-label soap-wrapup-pet-sub-label--warn">
                    ⚠ Past-due — won&apos;t be cleared
                  </span>
                  {reminderError && <div className="soap-error">{reminderError}</div>}
                  {pastDues.map((reminder) => {
                    const busy = pastDueBusyId === reminder.id;
                    return (
                      <div key={reminder.id} className="soap-wrapup-rem-pastdue-row">
                        <div className="soap-wrapup-rem-pastdue-text">
                          <strong>{reminder.description}</strong>
                          <span>
                            Due{' '}
                            {reminder.dueDate ? formatDeclinedDate(reminder.dueDate) : '—'}
                          </span>
                        </div>
                        <div className="soap-wrapup-rem-pastdue-actions">
                          <button
                            type="button"
                            className="soap-btn ghost small"
                            disabled={Boolean(busy || allLocked)}
                            title="Owner declined — stays on the chart as declined"
                            onClick={() => void handleDeclinePastDue(reminder)}
                          >
                            🚫 Decline
                          </button>
                          <button
                            type="button"
                            className="soap-btn ghost small danger"
                            disabled={Boolean(busy || allLocked)}
                            title="Remove from the reminder list only"
                            onClick={() => void handleDeletePastDue(reminder)}
                          >
                            <X size={13} /> Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Reminders going in — collapsed summary, expandable ── */}
              {goingIn.length > 0 && (
                <div className="soap-wrapup-pet-row soap-wrapup-pet-row--accordion">
                  <button
                    type="button"
                    className="soap-wrapup-pet-accordion-toggle soap-wrapup-pet-accordion-toggle--minor"
                    onClick={() => toggleReminders(pet.patientId)}
                  >
                    {remOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <BellRing size={13} />
                    <span>Reminders going in ({goingIn.length})</span>
                  </button>
                  {remOpen && (
                    <ul className="soap-wrapup-pet-rem-list">
                      {goingIn.map((r) => (
                        <li key={r.key}>
                          <Syringe size={11} className="soap-wrapup-pet-rem-icon" />
                          <span>{r.description}</span>
                          {r.dueDate && (
                            <span className="soap-wrapup-chart-meta">
                              {' '}— due {formatDeclinedDate(r.dueDate)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* ── Callbacks ── */}
              {encounterId && (
                <div className="soap-wrapup-pet-row soap-wrapup-pet-row--accordion soap-wrapup-pet-row--callbacks">
                  <WrapUpCallbacks
                    encounterId={encounterId}
                    pets={[pet]}
                    clientId={wrapUp?.clientId ?? null}
                    defaultAssigneeEmployeeId={wrapUp?.provider?.id ?? null}
                    disabled={allLocked}
                    filterPatientId={pet.patientId}
                  />
                </div>
              )}
            </section>
          );
        })}

        <section className="soap-wrapup-section">
          <h2>
            Client recap
            {emailDecided && <Check className="soap-wrapup-done" size={16} />}
          </h2>

          {delivery?.status === 'sent' && (
            <div className="soap-wrapup-sent">
              <Mail size={14} /> Sent{' '}
              {delivery.decidedAt
                ? new Date(delivery.decidedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : ''}{' '}
              to {delivery.recipients.join(', ')}
              {delivery.fromAddress ? ` from ${delivery.fromAddress}` : ''}. Filed on each
              covered pet&apos;s EMR under Communications.
            </div>
          )}
          {delivery?.status === 'skipped' && (
            <div className="soap-wrapup-skipped">
              <MailX size={14} /> No recap sent — {delivery.skipReason}
            </div>
          )}

          {/* A recap that went out with a mistake in it needs a correction sent, not a
              locked card. Reopening keeps the original on the EMR and files the new one
              alongside it, so the client's inbox and the chart still agree. */}
          {emailDecided && !redoingEmail && (
            <div className="soap-wrapup-email-actions">
              <button
                type="button"
                className="soap-btn subtle"
                onClick={() => {
                  setEmailError(null);
                  setShowSkip(false);
                  setRedoingEmail(true);
                }}
              >
                <RefreshCw size={14} />{' '}
                {delivery?.status === 'sent' ? 'Redo client email' : 'Write a recap after all'}
              </button>
            </div>
          )}

          {(!emailDecided || redoingEmail) && (
            <>
              {pets.length > 1 && (
                <div className="soap-wrapup-petpick">
                  <span className="soap-wrapup-petpick-label">Cover which pets?</span>
                  {pets.map((pet) => (
                    <label key={pet.patientId}>
                      <input
                        type="checkbox"
                        checked={selectedPetIds.has(pet.patientId)}
                        onChange={() => togglePet(pet.patientId)}
                      />
                      {pet.patientName}
                    </label>
                  ))}
                </div>
              )}

              <label className="soap-wrapup-field">
                To
                <input
                  className="soap-input"
                  value={recipients}
                  placeholder="owner@example.com, other@example.com"
                  onChange={(e) => setRecipients(e.target.value)}
                />
                <span className="soap-wrapup-field-hint">
                  Both owners when two are on file. Separate more addresses with commas.
                </span>
              </label>

              {mailbox && (
                <label className="soap-wrapup-field">
                  Send as
                  {sendAsOptions.length > 0 ? (
                    <select
                      className="soap-input"
                      value={fromAddress ?? ''}
                      onChange={(e) => setFromAddress(e.target.value)}
                    >
                      {sendAsOptions.map((alias) => {
                        const label = formatSendAsLabel(alias);
                        return (
                          <option key={alias.sendAsEmail} value={label}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <input className="soap-input" value={fromAddress ?? mailbox} readOnly />
                  )}
                  <span className="soap-wrapup-from-hint">
                    Through {mailbox}.
                    {fromAddress &&
                      isFallbackSender(fromAddress, mailbox) &&
                      ' Your work alias is not set up on this inbox, so the shared address is used.'}
                  </span>
                </label>
              )}

              <label className="soap-wrapup-field">
                Subject
                <input
                  className="soap-input"
                  value={subject}
                  disabled={regenerating}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>

              <div className="soap-wrapup-field">
                Message
                <SoapRichTextField
                  value={body}
                  minHeightPx={340}
                  disabled={regenerating}
                  placeholder="The recap the client will receive…"
                  onChange={setBody}
                  onBlur={setBody}
                />
                {!recapHasFarewell(body) ? (
                  <p className="soap-wrapup-farewell">{RECAP_FAREWELL}</p>
                ) : null}
                {signatureHtml.trim() ? (
                  <div
                    className="soap-wrapup-sendas-sig"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeCommunicationHtml(signatureHtml),
                    }}
                  />
                ) : null}
              </div>

              {regenerating && (
                <p className="soap-hint">Writing the recap from the charts as they read now…</p>
              )}

              {emailError && <div className="soap-error">{emailError}</div>}

              <div className="soap-wrapup-email-actions">
                <button
                  type="button"
                  className="soap-btn primary"
                  onClick={() => void onSend()}
                  disabled={sending || regenerating || !subject.trim() || !body.trim()}
                >
                  <Send size={14} /> {sending ? 'Sending…' : 'Send to client'}
                </button>
                <button
                  type="button"
                  className="soap-btn subtle"
                  onClick={() => void onRegenerate()}
                  disabled={regenerating || sending}
                >
                  <RefreshCw size={14} /> {regenerating ? 'Writing…' : 'Regenerate from charts'}
                </button>
                <button
                  type="button"
                  className="soap-btn subtle"
                  onClick={() => setShowSkip((s) => !s)}
                  disabled={regenerating}
                >
                  <MailX size={14} /> Don&apos;t email
                </button>
                {redoingEmail && (
                  <button
                    type="button"
                    className="soap-btn subtle"
                    onClick={() => {
                      setEmailError(null);
                      setShowSkip(false);
                      setRedoingEmail(false);
                    }}
                    disabled={sending || regenerating}
                  >
                    <X size={14} /> Cancel
                  </button>
                )}
              </div>

              {showSkip && (
                <div className="soap-wrapup-skip">
                  <label className="soap-wrapup-field">
                    Why no recap?
                    <input
                      className="soap-input"
                      value={skipReason}
                      placeholder="e.g. client asked for a phone call instead"
                      onChange={(e) => setSkipReason(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="soap-btn"
                    onClick={() => void onSkip()}
                    disabled={skipping}
                  >
                    {skipping ? 'Saving…' : 'Record: no recap'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {!allLocked && (
          <div className="soap-wrapup-footer">
            <div className="soap-wrapup-gate">
              <span className={emailDecided ? 'ok' : ''}>
                {emailDecided ? <Check size={14} /> : <Mail size={14} />} Client recap
              </span>
              <span className={clinicalComplete ? 'ok' : ''}>
                {clinicalComplete ? <Check size={14} /> : <Syringe size={14} />} Dose &amp; Rx
              </span>
              <span className={weightComplete ? 'ok' : ''}>
                {weightComplete ? <Check size={14} /> : <PawPrint size={14} />} Weight
              </span>
            </div>
            <button
              type="button"
              className="soap-btn primary"
              disabled={!canComplete || completing}
              onClick={onSignAndLock}
            >
              <CheckCircle2 size={15} />{' '}
              {completing
                ? 'Signing…'
                : `Sign & lock SOAP${pets.length > 1 ? ` (${pets.length} charts)` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
