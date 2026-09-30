import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, ExternalLink, Mail, MessageSquare, X } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import {
  getEuthanasiaConsentStatus,
  sendEuthanasiaConsent,
  type EuthanasiaConsentStatus,
} from '../../api/consent';
import { fetchAppointmentById } from '../../api/appointments';
import { fetchPatientByIdStaff } from '../../api/patients';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';
import {
  ensureEstimateForAppointment,
  estimateHasCard,
  markEstimateSent,
  type VisitEstimate,
} from '../../api/visitEstimates';
import EstimateWorkspace from '../estimates/EstimateWorkspace';
import EstimateCardModal from '../estimates/EstimateCardModal';
import { notifyEuthanasiaConsentStatusChanged } from '../../utils/euthanasiaConsentSettings';
import {
  AFTERCARE_STAFF_LABELS,
  parseAftercareNotConfirmedNote,
} from '../../utils/aftercare';
import ConsentWeightAlert from '../consent/ConsentWeightAlert';
import {
  parseConsentWeightChange,
  parseWeightChangedNote,
  type ConsentWeightChange,
} from '../../utils/consentWeightAlert';
import {
  membershipCancelLineNote,
  syncMembershipCancelLinesOnEstimate,
} from '../../utils/membershipCancelEstimateLine';
import type { MembershipCancelPreview } from '../../api/memberships';
import './EuthanasiaEstimateModal.css';

type Props = {
  appointmentId: number;
  patientId: number;
  patientName?: string | null;
  clientId?: number | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  /** Wording changes for a form that already went out once. */
  isResend?: boolean;
  onClose: () => void;
  onSent?: (result: { sentTo: string; formUrl: string }) => void;
};

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function pickStr(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return null;
}

function formatPetWeight(patient: Record<string, unknown> | null): string | null {
  if (!patient) return null;
  const raw = pickStr(
    patient.weight,
    patient.lastWeight,
    patient.weightLbs,
    patient.lastWeightLbs,
    patient.lastRecordedWeight
  );
  if (!raw) return null;
  const hasUnit = /\b(kg|lbs?)\b/i.test(raw) || raw.includes('/');
  const weightPart = hasUnit ? raw : `${raw} lbs`;
  const dateRaw = pickStr(patient.lastWeightDate, patient.weightDate);
  if (!dateRaw) return weightPart;
  const d = new Date(dateRaw);
  if (Number.isNaN(d.getTime())) return weightPart;
  return `${weightPart} (${d.toLocaleDateString('en-US')})`;
}

/**
 * Price the visit, then send the consent — in that order, because the consent form
 * quotes the total and asks for a card against it.
 *
 * Everything the client sees downstream is one number. Staff see the lines here so
 * the family never has to read an itemized bill for their pet's last visit.
 */
export default function EuthanasiaEstimateModal({
  appointmentId,
  patientId,
  patientName,
  clientId,
  clientName,
  clientEmail,
  clientPhone,
  isResend,
  onClose,
  onSent,
}: Props) {
  const [estimate, setEstimate] = useState<VisitEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [visitNotes, setVisitNotes] = useState<string | null>(null);
  const [petWeight, setPetWeight] = useState<string | null>(null);
  const [quotedAftercare, setQuotedAftercare] =
    useState<EuthanasiaConsentStatus['quotedAftercare']>(null);
  const [consentWeightChange, setConsentWeightChange] = useState<ConsentWeightChange | null>(
    null,
  );
  const [membershipCancels, setMembershipCancels] = useState<MembershipCancelPreview[]>([]);
  const [resolvedEmail, setResolvedEmail] = useState<string | null>(clientEmail ?? null);
  const [resolvedPhone, setResolvedPhone] = useState<string | null>(clientPhone ?? null);
  const [sendingChannel, setSendingChannel] = useState<'email' | 'sms' | null>(null);

  /**
   * The family confirms the aftercare on the quote rather than picking one, so
   * staff have to see what they are about to be asked. Re-checked whenever the
   * lines change, which is the moment the answer can change.
   */
  const lineItemKey = useMemo(
    () =>
      (estimate?.lines ?? [])
        .map((line) => `${line.catalogItemType ?? ''}:${line.catalogItemId ?? ''}`)
        .sort()
        .join(','),
    [estimate],
  );

  useEffect(() => {
    let cancelled = false;
    void getEuthanasiaConsentStatus(appointmentId, patientId)
      .then((status) => {
        if (cancelled) return;
        setQuotedAftercare(status.quotedAftercare ?? null);
        setConsentWeightChange(parseConsentWeightChange(status.response?.answers ?? null));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appointmentId, patientId, lineItemKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      ensureEstimateForAppointment({
        appointmentId,
        patientId,
        clientId: clientId ?? null,
        title: patientName ? `Euthanasia visit — ${patientName}` : 'Euthanasia visit',
      }),
      fetchAppointmentById(appointmentId, {
        practiceId: VISIT_WORKFLOW_PRACTICE_ID,
      }).catch(() => null),
      fetchPatientByIdStaff(patientId).catch(() => null),
    ])
      .then(async ([next, appt, patient]) => {
        if (cancelled) return;
        let estimate = next;
        try {
          const synced = await syncMembershipCancelLinesOnEstimate(next, patientId);
          if (cancelled) return;
          estimate = synced.estimate;
          setMembershipCancels(synced.previews);
        } catch {
          if (!cancelled) setMembershipCancels([]);
        }
        if (cancelled) return;
        setEstimate(estimate);
        setVisitNotes(pickStr(appt?.description));
        const apptClient = appt?.client as {
          email?: string | null;
          phone1?: string | null;
          phone2?: string | null;
        } | undefined;
        setResolvedEmail(clientEmail ?? pickStr(apptClient?.email) ?? null);
        setResolvedPhone(
          clientPhone ??
            pickStr(apptClient?.phone1) ??
            pickStr(apptClient?.phone2) ??
            null,
        );
        const fromPatient =
          patient && typeof patient === 'object'
            ? formatPetWeight(patient as Record<string, unknown>)
            : null;
        const fromAppt =
          appt?.patient && typeof appt.patient === 'object'
            ? formatPetWeight(appt.patient as unknown as Record<string, unknown>)
            : null;
        setPetWeight(fromPatient ?? fromAppt);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, patientId, clientId, patientName, clientEmail, clientPhone]);

  const total = Number(estimate?.total ?? 0);
  const aftercareReady = quotedAftercare?.unresolved == null && Boolean(quotedAftercare?.type);
  const canSend = !loading && !sending && total > 0 && aftercareReady;
  const aftercareDispute = parseAftercareNotConfirmedNote(visitNotes);
  const noteWeightChange = parseWeightChangedNote(
    aftercareDispute ? aftercareDispute.otherNotes : visitNotes,
  );
  const weightChange = consentWeightChange ?? (noteWeightChange
    ? { previousLbs: noteWeightChange.previousLbs, nextLbs: noteWeightChange.nextLbs }
    : null);
  const otherVisitNotes = noteWeightChange
    ? noteWeightChange.otherNotes
    : aftercareDispute
      ? aftercareDispute.otherNotes
      : visitNotes;
  const aftercarePlanLabel =
    quotedAftercare?.type && quotedAftercare.type in AFTERCARE_STAFF_LABELS
      ? AFTERCARE_STAFF_LABELS[quotedAftercare.type]
      : quotedAftercare?.itemName || quotedAftercare?.label || null;

  const send = useCallback(async (channel: 'email' | 'sms') => {
    if (!estimate) return;
    setSending(true);
    setSendingChannel(channel);
    setError(null);
    try {
      setEstimate(await markEstimateSent(estimate.id));
      const result = await sendEuthanasiaConsent({
        appointmentId,
        patientId,
        clientId: clientId ?? undefined,
        channel,
      });
      notifyEuthanasiaConsentStatusChanged();
      await navigator.clipboard.writeText(result.formUrl).catch(() => undefined);
      setSentNote(
        `${channel === 'sms' ? 'Texted' : 'Emailed'} to ${result.sentTo}. Link copied.`,
      );
      onSent?.({ sentTo: result.sentTo, formUrl: result.formUrl });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSending(false);
      setSendingChannel(null);
    }
  }, [appointmentId, clientId, estimate, onSent, patientId]);

  /** Open the consent form on this computer or tablet — no email. */
  const signHere = useCallback(async () => {
    if (!estimate) return;
    setSending(true);
    setError(null);
    try {
      setEstimate(await markEstimateSent(estimate.id));
      const existing = await getEuthanasiaConsentStatus(appointmentId, patientId).catch(
        () => null
      );
      const existingUrl =
        existing?.invite && !existing.response ? existing.invite.formUrl : null;
      const result = existingUrl
        ? { formUrl: existingUrl, sentTo: existing?.invite?.email ?? '' }
        : await sendEuthanasiaConsent({
            appointmentId,
            patientId,
            clientId: clientId ?? undefined,
            skipEmail: true,
          });
      const opened = window.open(result.formUrl, '_blank', 'noopener');
      if (!opened) {
        await navigator.clipboard.writeText(result.formUrl).catch(() => undefined);
        setSentNote('Pop-up blocked. The form link was copied — paste it in a browser.');
        return;
      }
      setSentNote('Consent form opened. Hand this screen to the family to sign.');
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSending(false);
    }
  }, [appointmentId, clientId, estimate, patientId]);

  return createPortal(
    <div className="scheduler-modal-backdrop" onClick={onClose}>
      <div
        className="scheduler-modal euth-estimate-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="soap-modal-head">
          <h3>
            Estimate for {patientName?.trim() || 'this visit'}
          </h3>
          <button type="button" className="soap-icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <p className="euth-estimate-sub">
          The consent form quotes one total and asks for a card against it. Nothing is
          charged until after the visit.
        </p>

        {!loading && weightChange ? <ConsentWeightAlert change={weightChange} /> : null}

        {!loading && membershipCancels.length > 0 ? (
          <div className="euth-estimate-membership" role="status">
            <strong>Membership cancellation on this quote</strong>
            {membershipCancels.map((row) => (
              <p key={row.membershipId}>{membershipCancelLineNote(row)}</p>
            ))}
          </div>
        ) : null}

        {!loading && aftercareDispute ? (
          <div className="euth-estimate-dispute" role="status">
            <strong>Aftercare was not confirmed</strong>
            <p>
              They asked for: {aftercareDispute.askedFor || 'a change'}
              {aftercareDispute.quoted ? `. We had quoted ${aftercareDispute.quoted}` : ''}.
              Nothing is signed.
            </p>
            <p>Update the estimate if needed, then re-send the consent.</p>
          </div>
        ) : null}

        {!loading && (
          <div className="euth-estimate-facts">
            <div className={`euth-estimate-fact${weightChange ? ' euth-estimate-fact--alert' : ''}`}>
              <span>Weight</span>
              <strong>
                {weightChange
                  ? `${weightChange.nextLbs} lbs (owner changed from ${
                      weightChange.previousLbs != null ? `${weightChange.previousLbs} lbs` : 'none on file'
                    })`
                  : petWeight || 'Not on file'}
              </strong>
            </div>
            <div
              className={`euth-estimate-fact${aftercareReady ? '' : ' euth-estimate-fact--alert'}`}
            >
              <span>Aftercare the family will confirm</span>
              <strong>
                {aftercareReady
                  ? aftercarePlanLabel
                  : quotedAftercare?.unresolved === 'conflict'
                    ? `Two plans quoted: ${(quotedAftercare.conflictingItems ?? []).join(', ')}`
                    : 'Waiting on the estimate'}
              </strong>
              {aftercareReady &&
              quotedAftercare?.itemName &&
              quotedAftercare.itemName !== aftercarePlanLabel ? (
                <p className="euth-estimate-fact-extra">{quotedAftercare.itemName}</p>
              ) : null}
            </div>
            <div className="euth-estimate-fact euth-estimate-fact--notes">
              <span>Appointment notes</span>
              {otherVisitNotes ? (
                <p>{otherVisitNotes}</p>
              ) : (
                <p className="is-empty">None on this visit</p>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <p className="estimate-empty">Loading…</p>
        ) : estimate ? (
          <EstimateWorkspace
            estimate={estimate}
            onChange={setEstimate}
            patientId={patientId}
            clientId={clientId}
            disabled={sending}
            clientName={clientName}
            allowEmail
            lockPatient
            pets={
              patientId
                ? [{ id: patientId, name: patientName?.trim() || `Pet #${patientId}` }]
                : []
            }
          />
        ) : null}

        {error && <div className="soap-error">{error}</div>}
        {sentNote && <div className="euth-estimate-sent">{sentNote}</div>}

        <div className="euth-estimate-footer">
          <div className="euth-estimate-quote">
            <span>Quoted to the family</span>
            <strong>{money(total)}</strong>
          </div>
          {total <= 0 && !loading && (
            <p className="euth-estimate-hint">
              Add at least one charge before sending the consent.
            </p>
          )}
          {total > 0 && !loading && !aftercareReady && quotedAftercare?.unresolved === 'conflict' && (
            <p className="euth-estimate-hint">
              This estimate quotes more than one aftercare plan. Remove the ones that do not apply.
            </p>
          )}
          {total > 0 && aftercareReady && (
            <p className="euth-estimate-dest">
              {resolvedEmail ? `Email ${resolvedEmail}` : 'No email on file'}
              {' · '}
              {resolvedPhone ? `Text ${resolvedPhone}` : 'No mobile on file'}
            </p>
          )}
        </div>

        <div className="soap-modal-actions euth-estimate-actions">
          <button
            type="button"
            className="soap-btn ghost"
            onClick={onClose}
            disabled={sending}
          >
            Save estimate
          </button>
          <button
            type="button"
            className="soap-btn ghost"
            onClick={() => setCardModalOpen(true)}
            disabled={!estimate || sending}
          >
            <CreditCard size={15} />
            {estimateHasCard(estimate) ? 'Replace card on file' : 'Take card by phone'}
          </button>
          <button
            type="button"
            className="soap-btn ghost"
            onClick={() => void signHere()}
            disabled={!canSend}
            title="Opens the consent form here so the family can sign on this tablet or computer. Does not send."
          >
            <ExternalLink size={15} /> Have them sign here
          </button>
          <button
            type="button"
            className="soap-btn"
            onClick={() => void send('email')}
            disabled={!canSend || sending}
            title={resolvedEmail ? `Email ${resolvedEmail}` : 'Email the consent link'}
          >
            <Mail size={15} />
            {sendingChannel === 'email'
              ? 'Sending…'
              : isResend
                ? 'Email again'
                : 'Email consent'}
          </button>
          <button
            type="button"
            className="soap-btn"
            onClick={() => void send('sms')}
            disabled={!canSend || sending}
            title={resolvedPhone ? `Text ${resolvedPhone}` : 'Text the consent link'}
          >
            <MessageSquare size={15} />
            {sendingChannel === 'sms'
              ? 'Sending…'
              : isResend
                ? 'Text again'
                : 'Text consent'}
          </button>
        </div>

        {cardModalOpen && estimate && (
          <EstimateCardModal
            estimateId={estimate.id}
            clientName={clientName}
            clientEmail={clientEmail}
            onClose={() => setCardModalOpen(false)}
            onSaved={setEstimate}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
