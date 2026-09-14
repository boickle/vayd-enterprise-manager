import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FilePlus2, Lock, PenLine, X } from 'lucide-react';
import { Link } from 'react-router';
import SoapAddendaSection from '../soap/SoapAddendaSection';
import type { SoapEncounter } from '../../api/visitWorkflow';
import './PimsSoapNoteModal.css';

type Props = {
  encounter: SoapEncounter;
  patientName: string | null;
  onClose: () => void;
};

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function subjectiveHistory(enc: SoapEncounter): string | null {
  const h = enc.subjective?.history;
  return typeof h === 'string' && h.trim() ? h : null;
}

/** Vitals are stored as a loose record; render whatever has a value. */
function vitalsPairs(enc: SoapEncounter): { label: string; value: string }[] {
  const v = enc.objectiveVitals;
  if (!v || typeof v !== 'object') return [];
  const labels: Record<string, string> = {
    tempF: 'Temperature (F)',
    hr: 'Heart rate',
    rr: 'Respiratory rate',
    bcs: 'BCS',
    fas: 'FAS',
    painScore: 'FAS',
  };
  const out: { label: string; value: string }[] = [];
  const weightNotTaken =
    (v as Record<string, unknown>).weightNotTaken === true ||
    (v as Record<string, unknown>).weightNotTaken === 'true';
  if (weightNotTaken) {
    out.push({ label: 'Weight', value: 'No weight taken' });
  } else {
    const weightRaw = (v as Record<string, unknown>).weight;
    const weight = weightRaw == null ? '' : String(weightRaw).trim();
    if (weight) {
      const unitRaw = String((v as Record<string, unknown>).weightUnit ?? 'lb').toLowerCase();
      const unit = unitRaw === 'kg' ? 'kg' : 'lb';
      out.push({ label: 'Weight', value: `${weight} ${unit}` });
    }
  }
  for (const [key, label] of Object.entries(labels)) {
    const raw = (v as Record<string, unknown>)[key];
    const s = raw == null ? '' : String(raw).trim();
    if (s) out.push({ label, value: s });
  }
  return out;
}

/**
 * Read-only view of a Scout SOAP note from the patient chart, with the signed /
 * open state and (once signed) the append-only addenda composer.
 *
 * The SOAP itself is never editable here — editing happens on the SOAP page while
 * the chart is still open, and after signing only addenda may be added.
 */
export default function PimsSoapNoteModal({ encounter, patientName, onClose }: Props) {
  const [writingAddendum, setWritingAddendum] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const locked = encounter.status === 'completed';
  const history = subjectiveHistory(encounter);
  const vitals = vitalsPairs(encounter);

  const soapHref = `/schedule/soap/${encounter.appointmentId}/${encounter.patientId}${
    encounter.clientId ? `?clientId=${encounter.clientId}` : ''
  }`;

  const modal = (
    <div className="pims-soap-modal" role="dialog" aria-modal aria-labelledby="pims-soap-modal-title">
      <button
        type="button"
        className="pims-soap-modal__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="pims-soap-modal__card">
        <div className="pims-soap-modal__head">
          <div className="pims-soap-modal__head-main">
            <h2 id="pims-soap-modal-title" className="pims-soap-modal__title">
              {encounter.mode === 'quick' ? 'Quick SOAP' : 'Comprehensive SOAP'}
              {patientName ? ` — ${patientName}` : ''}
            </h2>
            <div className="pims-soap-modal__meta">
              <span>Visit #{encounter.appointmentId}</span>
              <span>
                {locked
                  ? `Signed ${formatWhen(encounter.completedAt ?? null)}`
                  : `Started ${formatWhen(encounter.created ?? null)}`}
              </span>
            </div>
          </div>
          <div className="pims-soap-modal__head-actions">
            {locked ? (
              <span className="pims-soap-modal__badge pims-soap-modal__badge--locked">
                <Lock size={13} /> Signed &amp; locked
              </span>
            ) : (
              <span className="pims-soap-modal__badge pims-soap-modal__badge--open">
                <PenLine size={13} /> Open
              </span>
            )}
            {locked && !writingAddendum && (
              <button
                type="button"
                className="pims-soap-modal__btn"
                onClick={() => setWritingAddendum(true)}
              >
                <FilePlus2 size={14} /> Write addendum
              </button>
            )}
            <Link className="pims-soap-modal__btn" to={soapHref} onClick={onClose}>
              <ExternalLink size={14} /> {locked ? 'View SOAP' : 'Continue SOAP'}
            </Link>
            <button
              type="button"
              className="pims-soap-modal__icon-btn"
              title="Close"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        </div>

        <div className="pims-soap-modal__scroll">
          {!locked && (
            <p className="pims-soap-modal__notice">
              This chart is still open, so it can change. Addenda become available once
              it is signed.
            </p>
          )}

          <section className="pims-soap-modal__section">
            <h3 className="pims-soap-modal__section-title">Subjective</h3>
            {history ? (
              <p className="pims-soap-modal__text">{history}</p>
            ) : (
              <p className="pims-soap-modal__muted">Nothing recorded.</p>
            )}
          </section>

          <section className="pims-soap-modal__section">
            <h3 className="pims-soap-modal__section-title">Objective</h3>
            {vitals.length > 0 && (
              <dl className="pims-soap-modal__vitals">
                {vitals.map((v) => (
                  <div key={v.label} className="pims-soap-modal__vital">
                    <dt>{v.label}</dt>
                    <dd>{v.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {encounter.objectiveNotes?.trim() ? (
              <p className="pims-soap-modal__text">{encounter.objectiveNotes}</p>
            ) : vitals.length === 0 ? (
              <p className="pims-soap-modal__muted">Nothing recorded.</p>
            ) : null}
          </section>

          <section className="pims-soap-modal__section">
            <h3 className="pims-soap-modal__section-title">Assessment</h3>
            {encounter.assessmentReasoning?.trim() ? (
              <p className="pims-soap-modal__text">{encounter.assessmentReasoning}</p>
            ) : (
              <p className="pims-soap-modal__muted">Nothing recorded.</p>
            )}
          </section>

          <section className="pims-soap-modal__section">
            <h3 className="pims-soap-modal__section-title">Plan</h3>
            {encounter.planNotes?.trim() ? (
              <p className="pims-soap-modal__text">{encounter.planNotes}</p>
            ) : (
              <p className="pims-soap-modal__muted">Nothing recorded.</p>
            )}
          </section>

          {locked && (
            <SoapAddendaSection
              encounterId={encounter.id}
              writing={writingAddendum}
              onWritingChange={setWritingAddendum}
            />
          )}
        </div>

        <div className="pims-soap-modal__footer">
          <button type="button" className="pims-soap-modal__btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
