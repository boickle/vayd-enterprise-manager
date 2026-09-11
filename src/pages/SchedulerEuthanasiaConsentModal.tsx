import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Appointment } from '../api/roomLoader';
import {
  formatMemorialItemLine,
  getEuthanasiaConsentStatus,
  parseMemorialItems,
  type EuthanasiaConsentStatus,
} from '../api/consent';
import { apiErrorMessage } from '../api/http';
import { patientsForAppointment } from '../utils/schedulerAddPet';
import './Scheduler.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientsLabel(appt: Appointment): string {
  const names = patientsForAppointment(appt)
    .map((p) => pickStr(p.name))
    .filter(Boolean);
  return names.length ? names.join(', ') : '—';
}

function answerStr(answers: Record<string, unknown>, key: string): string {
  const v = answers[key];
  return typeof v === 'string' ? v.trim() : '';
}

export function SchedulerEuthanasiaConsentModal({
  appt,
  accentColor,
  onClose,
}: {
  appt: Appointment;
  accentColor: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EuthanasiaConsentStatus | null>(null);

  useEffect(() => {
    const apptId = Number(appt.id);
    const patientId = patientsForAppointment(appt)[0]?.id;
    if (!Number.isFinite(apptId) || patientId == null) {
      setError('No patient on this appointment.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    void getEuthanasiaConsentStatus(apptId, Number(patientId))
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appt]);

  const clientName = useMemo(() => {
    const c = appt.client;
    if (!c) return '—';
    return [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() || '—';
  }, [appt.client]);

  const response = status?.response;
  const answers = response?.answers ?? {};
  const nameplate = [answers.nameplateLine1, answers.nameplateLine2, answers.nameplateLine3]
    .filter((line) => typeof line === 'string' && line.trim())
    .join(' / ');

  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="scheduler-modal scheduler-modal--edit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-euthanasia-consent-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Forms</p>
            <h2 id="scheduler-euthanasia-consent-title">View Euthanasia Consent</h2>
            <p className="scheduler-modal-subtitle">
              {clientName}
              <span className="scheduler-modal-subtitle-sep">·</span>
              {patientsLabel(appt)}
            </p>
          </div>
          <button type="button" className="scheduler-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="scheduler-modal-body" style={{ padding: 20 }}>
          {loading ? <p>Loading consent…</p> : null}
          {error ? <p>{error}</p> : null}
          {!loading && !error && !response ? <p>No signed consent yet.</p> : null}
          {response ? (
            <div style={{ display: 'grid', gap: 10, fontSize: 14, lineHeight: 1.45 }}>
              <p>
                <strong>Signed by</strong> {response.signedName || '—'}
              </p>
              {Array.isArray(answers.consentLanguage) ? (
                <div>
                  <strong>Consent language</strong>
                  {(answers.consentLanguage as unknown[]).map((para, idx) =>
                    typeof para === 'string' ? <p key={idx}>{para}</p> : null,
                  )}
                </div>
              ) : null}
              <p>
                <strong>Aftercare</strong> {response.aftercareLabel || '—'}
              </p>
              {nameplate ? (
                <p>
                  <strong>Nameplate</strong> {nameplate}
                </p>
              ) : null}
              <p>
                <strong>Paw print</strong> {response.pawPrintLabel || '—'}
              </p>
              {parseMemorialItems(answers.memorialItems).length ? (
                <div>
                  <p>
                    <strong>MEMORIAL ITEMS PURCHASED</strong>
                    {answers.memorialPayment && typeof answers.memorialPayment === 'object'
                      ? ' — already paid'
                      : ''}
                  </p>
                  {parseMemorialItems(answers.memorialItems).map((item) => (
                    <p key={`${item.listingId}-${item.procedureId ?? item.inventoryItemId ?? item.name}`}>
                      {formatMemorialItemLine(item)}
                      {answers.memorialPayment ? ' · already paid' : ''}
                    </p>
                  ))}
                </div>
              ) : null}
              {answerStr(answers, 'vetsToNotify') ? (
                <p>
                  <strong>Notify</strong> {answerStr(answers, 'vetsToNotify')}
                  {answerStr(answers, 'otherVetsToNotify')
                    ? `; ${answerStr(answers, 'otherVetsToNotify')}`
                    : ''}
                </p>
              ) : null}
              {answers.clayChargePayment && typeof answers.clayChargePayment === 'object' ? (
                <p>
                  <strong>Clay print paid</strong>{' '}
                  {typeof (answers.clayChargePayment as { amount?: number }).amount === 'number'
                    ? (answers.clayChargePayment as { amount: number }).amount.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                      })
                    : ''}
                </p>
              ) : null}
              {answerStr(answers, 'additionalInfo') ? (
                <p>
                  <strong>Notes</strong> {answerStr(answers, 'additionalInfo')}
                </p>
              ) : null}
              {response.signatureDataUrl ? (
                <img
                  src={response.signatureDataUrl}
                  alt="Client signature"
                  style={{ maxWidth: '100%', height: 80, objectFit: 'contain', background: '#fff' }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
