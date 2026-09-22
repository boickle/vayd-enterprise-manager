import { useEffect, useState } from 'react';
import { Eye, X } from 'lucide-react';
import type { FormField } from '../../api/forms';
import FormOwnerField from './FormOwnerField';
import {
  applyFormMergePreview,
  formPreviewSampleNames,
} from '../../utils/formMergePreview';
import {
  loadPracticeLetterhead,
  type PracticeLetterhead,
} from '../../utils/practiceLetterhead';
import '../../pages/FormSignPage.css';

type Props = {
  formName: string;
  fields: FormField[];
  onClose: () => void;
};

/**
 * Modal: what the owner sees when they open the form link (sample merge data).
 */
export default function FormOwnerPreview({ formName, fields, onClose }: Props) {
  const [letterhead, setLetterhead] = useState<PracticeLetterhead | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  useEffect(() => {
    void loadPracticeLetterhead()
      .then(setLetterhead)
      .catch(() => setLetterhead(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const merged = applyFormMergePreview(fields, letterhead);
  const names = formPreviewSampleNames(letterhead);

  return (
    <div
      className="forms-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Owner form preview"
      onClick={onClose}
    >
      <div className="forms-preview-panel" onClick={(e) => e.stopPropagation()}>
        <div className="forms-preview-bar">
          <div className="forms-preview-bar__title">
            <Eye size={15} aria-hidden />
            <div>
              <strong>Owner preview</strong>
              <span>
                Sample client &amp; patient — merge fields filled like a real send. Nothing is
                submitted.
              </span>
            </div>
          </div>
          <button type="button" className="forms-btn ghost small" onClick={onClose}>
            <X size={14} /> Close
          </button>
        </div>

        <div className="forms-preview-scroll">
          <div className="fsign-shell fsign-shell--preview">
            <div className="fsign-card">
              <div className="fsign-header">
                {names.practiceName ? (
                  <p className="fsign-practice">{names.practiceName}</p>
                ) : null}
                <h1 className="fsign-title">{formName.trim() || 'Untitled form'}</h1>
                <p className="fsign-subtitle">
                  {names.clientName} · Patient: {names.patientName}
                </p>
              </div>

              <div className="fsign-fields">
                {merged.map((field) => (
                  <FormOwnerField
                    key={field.key}
                    field={field}
                    answers={answers}
                    onChange={(key, value) =>
                      setAnswers((prev) => ({ ...prev, [key]: value }))
                    }
                    error={null}
                    preview
                  />
                ))}
              </div>

              <div className="fsign-sign-section">
                <div className="fsign-field">
                  <label htmlFor="preview-signed-name">
                    Type your full name to confirm <span className="fsign-required">*</span>
                  </label>
                  <input
                    type="text"
                    id="preview-signed-name"
                    placeholder="Full name"
                    disabled
                  />
                </div>
                <button type="button" className="fsign-submit-btn" disabled>
                  Submit signed form
                </button>
                <p className="fsign-legal">
                  By submitting this form you acknowledge that your typed name and drawn
                  signature above constitute your electronic signature.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
