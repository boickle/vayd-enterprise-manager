import SignaturePad from '../SignaturePad';
import type { FormField } from '../../api/forms';
import { sanitizeFormTemplateHtml } from '../../utils/sanitizeCommunicationHtml';
import '../../pages/FormSignPage.css';

type Props = {
  field: FormField;
  answers: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  error: string | null;
  /** Staff preview — signature is a static placeholder, no submit. */
  preview?: boolean;
};

/**
 * One field as the owner sees it on the public sign page.
 */
export default function FormOwnerField({
  field,
  answers,
  onChange,
  error,
  preview = false,
}: Props) {
  const id = `field-${field.key}${preview ? '-preview' : ''}`;
  const hasError = !!error;

  switch (field.type) {
    case 'heading':
      return (
        <h2
          className="fsign-field-heading"
          dangerouslySetInnerHTML={{ __html: sanitizeFormTemplateHtml(field.label) }}
        />
      );

    case 'paragraph':
      return (
        <div
          className="fsign-field-para"
          dangerouslySetInnerHTML={{ __html: sanitizeFormTemplateHtml(field.label) }}
        />
      );

    case 'checkbox':
      return (
        <label className={`fsign-field-checkbox${hasError ? ' fsign-field--error' : ''}`}>
          <input
            type="checkbox"
            id={id}
            checked={Boolean(answers[field.key])}
            onChange={(e) => onChange(field.key, e.target.checked)}
          />
          <span className="fsign-field-checkbox__text">
            <span
              dangerouslySetInnerHTML={{
                __html: sanitizeFormTemplateHtml(field.checkboxLabel || field.label),
              }}
            />
            {field.required && <span className="fsign-required">*</span>}
          </span>
          {hasError && <span className="fsign-field-error-msg">{error}</span>}
        </label>
      );

    case 'text':
      return (
        <div className={`fsign-field${hasError ? ' fsign-field--error' : ''}`}>
          <label htmlFor={id}>
            {field.label}
            {field.required && <span className="fsign-required"> *</span>}
          </label>
          <input
            type="text"
            id={id}
            value={String(answers[field.key] ?? '')}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.hint}
          />
          {hasError && <span className="fsign-field-error-msg">{error}</span>}
        </div>
      );

    case 'textarea':
      return (
        <div className={`fsign-field${hasError ? ' fsign-field--error' : ''}`}>
          <label htmlFor={id}>
            {field.label}
            {field.required && <span className="fsign-required"> *</span>}
          </label>
          <textarea
            id={id}
            rows={4}
            value={String(answers[field.key] ?? '')}
            onChange={(e) => onChange(field.key, e.target.value)}
            placeholder={field.hint}
          />
          {hasError && <span className="fsign-field-error-msg">{error}</span>}
        </div>
      );

    case 'signature':
      return (
        <div className={`fsign-field${hasError ? ' fsign-field--error' : ''}`}>
          <label>
            {field.label || 'Signature'}
            {field.required && <span className="fsign-required"> *</span>}
          </label>
          {preview ? (
            <div className="fsign-sig-placeholder" aria-hidden>
              Signature pad
            </div>
          ) : (
            <SignaturePad onChange={(dataUrl) => onChange(field.key, dataUrl)} />
          )}
          {hasError && <span className="fsign-field-error-msg">{error}</span>}
        </div>
      );

    default:
      return null;
  }
}
