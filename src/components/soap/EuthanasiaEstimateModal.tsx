import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, ExternalLink, Send, X } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import { getEuthanasiaConsentStatus, sendEuthanasiaConsent } from '../../api/consent';
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
import './EuthanasiaEstimateModal.css';

type Props = {
  appointmentId: number;
  patientId: number;
  patientName?: string | null;
  clientId?: number | null;
  clientName?: string | null;
  clientEmail?: string | null;
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
      .then(([next, appt, patient]) => {
        if (cancelled) return;
        setEstimate(next);
        setVisitNotes(pickStr(appt?.description));
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
  }, [appointmentId, patientId, clientId, patientName]);

  const total = Number(estimate?.total ?? 0);
  const canSend = !loading && !sending && total > 0;

  const send = useCallback(async () => {
    if (!estimate) return;
    setSending(true);
    setError(null);
    try {
      setEstimate(await markEstimateSent(estimate.id));
      const result = await sendEuthanasiaConsent({
        appointmentId,
        patientId,
        clientId: clientId ?? undefined,
      });
      notifyEuthanasiaConsentStatusChanged();
      await navigator.clipboard.writeText(result.formUrl).catch(() => undefined);
      setSentNote(`Sent to ${result.sentTo}. Link copied.`);
      onSent?.({ sentTo: result.sentTo, formUrl: result.formUrl });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSending(false);
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

        {!loading && (
          <div className="euth-estimate-facts">
            <div className="euth-estimate-fact">
              <span>Weight</span>
              <strong>{petWeight || 'Not on file'}</strong>
            </div>
            <div className="euth-estimate-fact euth-estimate-fact--notes">
              <span>Appointment notes</span>
              {visitNotes ? (
                <p>{visitNotes}</p>
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
            title="Opens the consent form here so the family can sign on this tablet or computer. Does not email."
          >
            <ExternalLink size={15} /> Have them sign here
          </button>
          <button
            type="button"
            className="soap-btn"
            onClick={() => void send()}
            disabled={!canSend}
          >
            <Send size={15} />
            {sending
              ? 'Sending…'
              : isResend
                ? 'Resend consent'
                : 'Send consent'}
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
