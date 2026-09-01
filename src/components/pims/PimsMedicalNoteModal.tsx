import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  looksLikeHtmlFragment,
  sanitizeCommunicationHtml,
} from '../../utils/sanitizeCommunicationHtml';
import './PimsExamDetailModal.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function employeeName(e: unknown): string {
  const o = asObj(e);
  if (!o) return '—';
  const fn = pickStr(o.firstName);
  const ln = pickStr(o.lastName);
  const joined = [fn, ln].filter(Boolean).join(' ').trim();
  return joined || pickStr(o.name) || '—';
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function NoteRichText({ value, className }: { value: string; className?: string }) {
  if (looksLikeHtmlFragment(value)) {
    return (
      <div
        className={className}
        dangerouslySetInnerHTML={{ __html: sanitizeCommunicationHtml(value) }}
      />
    );
  }
  return <div className={className}>{value}</div>;
}

type Props = {
  title: string;
  record: Record<string, unknown>;
  onClose: () => void;
};

/**
 * History form or EVET chart note — same chrome as the exam modal, without vitals.
 */
export function PimsMedicalNoteModal({ title, record, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const formName =
    pickStr(record.formName) ?? pickStr(record.name) ?? pickStr(record.recordLabel) ?? title;
  const serviceDate = pickStr(record.serviceDate) ?? pickStr(record.createdAt);
  const body =
    pickStr(record.noteText) ??
    pickStr(record.documentText) ??
    pickStr(record.comments) ??
    pickStr(record.description) ??
    '';
  const fileMeta = [
    pickStr(record.extension) && `File type: ${pickStr(record.extension)}`,
    pickStr(record.contentType) && `Content: ${pickStr(record.contentType)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const responses = Array.isArray(record.responses) ? (record.responses as unknown[]) : [];

  const modal = (
    <div className="pims-exam-modal" role="dialog" aria-modal aria-labelledby="pims-note-modal-title">
      <button
        type="button"
        className="pims-exam-modal__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="pims-exam-modal__card">
        <div className="pims-exam-modal__toolbar">
          <div className="pims-exam-modal__toolbar-main">
            <h2 id="pims-note-modal-title" className="pims-exam-modal__title">
              {formName}
            </h2>
            <div className="pims-exam-modal__toolbar-meta">
              <span>
                <span className="pims-exam-modal__meta-k">Provider</span> {employeeName(record.employee)}
              </span>
              <span>
                <span className="pims-exam-modal__meta-k">Service date</span> {formatWhen(serviceDate)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="pims-exam-modal__icon-btn"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="pims-exam-modal__scroll">
          {body ? (
            <section className="pims-exam-modal__fieldset">
              <h3 className="pims-exam-modal__fieldset-legend">Note</h3>
              <NoteRichText value={body} className="pims-exam-modal__summary-text" />
            </section>
          ) : null}

          {responses.length > 0 ? (
            <section className="pims-exam-modal__fieldset">
              <h3 className="pims-exam-modal__fieldset-legend">Responses</h3>
              <div className="pims-exam-modal__responses">
                {responses.map((raw, idx) => {
                  const ro = asObj(raw);
                  if (!ro) return null;
                  const cn = pickStr(ro.componentName) ?? 'Field';
                  const sel = pickStr(ro.selectedOptions);
                  const cm = pickStr(ro.comment);
                  if (!cn && !sel && !cm) return null;
                  return (
                    <div
                      key={String(ro.id ?? ro.pimsId ?? idx)}
                      className="pims-exam-modal__response-block"
                    >
                      <div className="pims-exam-modal__response-head">
                        <span className="pims-exam-modal__response-label">{cn}</span>
                      </div>
                      {sel ? (
                        <NoteRichText value={sel} className="pims-exam-modal__response-sel" />
                      ) : null}
                      {cm ? (
                        <div className="pims-exam-modal__response-comments">
                          <strong className="pims-exam-modal__response-comments-k">Comments:</strong>
                          <NoteRichText value={cm} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {!body && responses.length === 0 ? (
            <p className="pims-exam-modal__muted">
              {fileMeta
                ? `${fileMeta}. The file itself is not stored in Scout yet — this is the chart entry from the import.`
                : 'No note text on this record.'}
            </p>
          ) : null}
        </div>

        <div className="pims-exam-modal__footer">
          <button type="button" className="pims-exam-modal__close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
