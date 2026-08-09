import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lock,
  Mail,
  MailX,
  PawPrint,
  Pencil,
  RefreshCw,
  Send,
  Syringe,
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
  getVisitWrapUp,
  recordClientEmailDecision,
  type VisitWrapUp,
  type VisitWrapUpPet,
} from '../api/visitWrapUp';
import { fetchGmailMailboxes, fetchGmailSendAs, sendGmailMessage } from '../api/gmail';
import { forwardBookingDispositionIsComplete } from '../utils/forwardBookingDisposition';
import {
  isFallbackSender,
  resolveRecapFromAddress,
  resolveRecapMailbox,
} from '../utils/visitRecapSender';
import WrapUpForwardBooking from '../components/soap/WrapUpForwardBooking';
import { reconcileBookedFollowUp } from '../components/forwardBooking/bookFollowUpNow';
import { isWeightAddressed, vitalsFromValue } from './SoapEncounterPage';

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

/** Persist the wrap-up recap onto the encounter so reopening wrap-up keeps the doctor's draft. */
async function persistRecapDraft(
  encounterId: string,
  draft: { subject: string; body: string }
): Promise<void> {
  const enc = await getEncounter(encounterId);
  const prev =
    enc.subjective && typeof enc.subjective === 'object'
      ? (enc.subjective as Record<string, unknown>)
      : {};
  await updateEncounter(encounterId, {
    subjective: {
      ...prev,
      clientEmailSubject: draft.subject.trim() ? draft.subject : null,
      clientEmailBody: draft.body.trim() ? draft.body : null,
    },
  });
}

/**
 * Visit wrap-up — the step after the SOAP, where the doctor reviews the household's
 * finished charts, settles forward booking, and sends (or deliberately declines) the
 * client recap.
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
  const [expandedPetId, setExpandedPetId] = useState<number | null>(null);

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

  const [mailbox, setMailbox] = useState<string | null>(null);
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  /** True after the initial wrap-up email hydrate/generate finishes — gates draft autosave. */
  const [emailHydrated, setEmailHydrated] = useState(false);

  const [completing, setCompleting] = useState(false);

  const wrapUpPath = `/schedule/soap/${appointmentId}/${patientId}/wrap-up${
    clientIdParam ? `?clientId=${encodeURIComponent(clientIdParam)}` : ''
  }`;

  /**
   * Promote "Forward book" to "Booked at appointment" for any pet whose follow-up
   * was actually booked through "Book it now", so the chart records what happened
   * at the visit rather than the intention we started with.
   */
  const loadWrapUp = useCallback(async (id: string) => {
    let data = await getVisitWrapUp(id);
    const promoted = await Promise.all(
      data.pets.map((pet) =>
        reconcileBookedFollowUp(
          {
            appointmentId: pet.appointmentId,
            patientId: pet.patientId,
            clientId: data.clientId,
            soapEncounterId: pet.soapEncounterId,
          },
          pet.forwardBookingEntryId,
          {
            practiceId: VISIT_WORKFLOW_PRACTICE_ID,
            currentMode: pet.forwardBookingDisposition?.mode,
          }
        ).catch(() => false)
      )
    );
    if (promoted.some(Boolean)) data = await getVisitWrapUp(id);
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
        const data = await loadWrapUp(enc.id);
        if (canceled) return;
        const petIds = data.pets.map((p) => p.patientId);
        setSelectedPetIds(new Set(petIds));
        setRecipients(data.clientEmails.join(', '));

        // Already sent or deliberately skipped — leave that decision alone.
        if (data.clientEmailDelivery?.status) {
          setSubject(data.emailDraft.subject);
          setBody(data.emailDraft.body);
          return;
        }

        const hasDraft =
          Boolean(data.emailDraft.subject.trim()) || Boolean(data.emailDraft.body.trim());
        if (hasDraft) {
          // Keep the doctor's saved draft — do not overwrite when returning after SOAP edits.
          setSubject(data.emailDraft.subject);
          setBody(data.emailDraft.body);
          return;
        }

        // First wrap-up with a blank email: generate once from the finished charts and save.
        setRegenerating(true);
        try {
          const draft = await generateClientRecap(enc.id, petIds);
          if (canceled) return;
          setSubject(draft.subject);
          setBody(draft.body);
          await persistRecapDraft(enc.id, draft);
        } catch (e) {
          if (canceled) return;
          setSubject('');
          setBody('');
          setEmailError(
            e instanceof Error ? e.message : 'Could not write the recap from the charts.'
          );
        } finally {
          if (!canceled) setRegenerating(false);
        }
      } catch (e) {
        if (!canceled) {
          setError(e instanceof Error ? e.message : 'Could not load the visit wrap-up.');
        }
      } finally {
        if (!canceled) {
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
      void persistRecapDraft(encounterId, { subject, body }).catch(() => {
        /* Autosave is best-effort; Send still records the final message. */
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [subject, body, encounterId, emailHydrated, regenerating, wrapUp?.clientEmailDelivery?.status]);
  // Which mailbox and which From the recap will use. Resolved up front so the
  // doctor can see it before sending rather than discovering it in the sent folder.
  useEffect(() => {
    if (!wrapUp) return;
    let canceled = false;
    void (async () => {
      try {
        const { mailboxes } = await fetchGmailMailboxes();
        const resolved = resolveRecapMailbox(mailboxes);
        if (canceled || !resolved) return;
        setMailbox(resolved);
        const { aliases } = await fetchGmailSendAs(resolved).catch(() => ({ aliases: [] }));
        if (canceled) return;
        setFromAddress(resolveRecapFromAddress(aliases, resolved, wrapUp.provider?.email ?? null));
      } catch {
        /* Sending surfaces its own error; the recap can still be skipped. */
      }
    })();
    return () => {
      canceled = true;
    };
  }, [wrapUp]);

  const pets = useMemo(() => wrapUp?.pets ?? [], [wrapUp]);
  const selectedPets = useMemo(
    () => pets.filter((p) => selectedPetIds.has(p.patientId)),
    [pets, selectedPetIds]
  );

  const followUpComplete = useMemo(
    () =>
      pets.length > 0 &&
      pets.every((p) => forwardBookingDispositionIsComplete(p.forwardBookingDisposition)),
    [pets]
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
  const canComplete =
    followUpComplete && emailDecided && clinicalComplete && weightComplete && !allLocked;

  const backToSoap = (pet: VisitWrapUpPet) => {
    const qs = clientIdParam ? `?clientId=${encodeURIComponent(clientIdParam)}` : '';
    navigate(`/schedule/soap/${pet.appointmentId}/${pet.patientId}${qs}`);
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
      await persistRecapDraft(encounterId, draft);
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
    const to = recipients
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    if (to.length === 0) {
      setEmailError('Add at least one recipient address.');
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
      const sent = await sendGmailMessage(mailbox, {
        from: bareAddress(fromAddress),
        to,
        subject,
        bodyText: body,
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
      for (const pet of pets) {
        if (pet.status === 'completed') continue;
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
                    : !followUpComplete
                      ? 'Every pet needs a complete follow-up choice first'
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

      {error && <div className="soap-error soap-error-banner">{error}</div>}

      <div className="soap-wrapup-body">
        <section className="soap-wrapup-section">
          <h2>
            <span className="soap-wrapup-step">1</span> Review the charts
          </h2>
          <p className="soap-wrapup-hint">
            Read what you actually recorded before the recap goes out — the recap is written from
            these notes.
          </p>
          {pets.map((pet) => {
            const open = expandedPetId === pet.patientId;
            return (
              <div className="soap-wrapup-chart" key={pet.patientId}>
                <button
                  type="button"
                  className="soap-wrapup-chart-head"
                  onClick={() => setExpandedPetId(open ? null : pet.patientId)}
                >
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <PawPrint size={14} />
                  <strong>{pet.patientName}</strong>
                  <span className="soap-wrapup-chart-meta">{petSummaryLine(pet)}</span>
                  {((pet.outstandingClinical?.missingMeds.length ?? 0) > 0 ||
                    (pet.outstandingClinical?.missingVaccines.length ?? 0) > 0) &&
                    pet.status !== 'completed' && (
                      <span className="soap-wrapup-chart-pending">Rx/dose details needed</span>
                    )}
                  {!isWeightAddressed(vitalsFromValue(pet.objectiveVitals)) &&
                    pet.status !== 'completed' && (
                      <span className="soap-wrapup-chart-pending">Weight needed</span>
                    )}
                  {pet.status === 'completed' && (
                    <span className="soap-wrapup-chart-locked">
                      <Lock size={12} /> Signed
                    </span>
                  )}
                </button>
                {open && (
                  <div className="soap-wrapup-chart-body">
                    {(
                      [
                        ['Subjective', pet.subjectiveHistory],
                        ['Objective', pet.objectiveNotes],
                        ['Assessment', pet.assessmentReasoning],
                        ['Plan', pet.planNotes],
                      ] as const
                    ).map(([label, text]) => (
                      <div className="soap-wrapup-chart-section" key={label}>
                        <h4>{label}</h4>
                        <pre>{text?.trim() || '—'}</pre>
                      </div>
                    ))}
                    {pet.status === 'completed' ? (
                      <p className="soap-wrapup-signature">
                        <Lock size={13} /> {signatureLine(pet)}
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="soap-btn small"
                        onClick={() => backToSoap(pet)}
                      >
                        <Pencil size={13} /> Edit in SOAP
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="soap-wrapup-section">
          <h2>
            <span className="soap-wrapup-step">2</span> Follow-up
            {followUpComplete && <Check className="soap-wrapup-done" size={16} />}
          </h2>
          <p className="soap-wrapup-hint">
            Required for every pet, same as End Visit on the schedule.
          </p>
          {encounterId && wrapUp && (
            <WrapUpForwardBooking
              pets={pets}
              clientId={wrapUp.clientId}
              providerId={wrapUp.provider?.id ?? null}
              disabled={allLocked}
              returnTo={wrapUpPath}
              onSaved={async () => {
                await loadWrapUp(encounterId);
              }}
            />
          )}
        </section>

        <section className="soap-wrapup-section">
          <h2>
            <span className="soap-wrapup-step">3</span> Client recap
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
              {delivery.fromAddress ? ` from ${delivery.fromAddress}` : ''}. Filed on the chart
              under Communications.
            </div>
          )}
          {delivery?.status === 'skipped' && (
            <div className="soap-wrapup-skipped">
              <MailX size={14} /> No recap sent — {delivery.skipReason}
            </div>
          )}

          {!emailDecided && (
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
                  placeholder="client@example.com"
                  onChange={(e) => setRecipients(e.target.value)}
                />
              </label>

              {mailbox && fromAddress && (
                <p className="soap-wrapup-from">
                  Sending as <strong>{fromAddress}</strong> through {mailbox}.
                  {isFallbackSender(fromAddress, mailbox) &&
                    ' Your work alias is not set up on this inbox, so the shared address is used.'}
                </p>
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

              <label className="soap-wrapup-field">
                Message
                <textarea
                  className="soap-doc-textarea"
                  rows={16}
                  value={body}
                  disabled={regenerating}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>

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
              <span className={followUpComplete ? 'ok' : ''}>
                {followUpComplete ? <Check size={14} /> : <CalendarClock size={14} />} Follow-up
              </span>
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
