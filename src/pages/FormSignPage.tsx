import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  getPublicForm,
  submitPublicForm,
  type PublicFormPayload,
} from '../api/forms';
import FormOwnerField from '../components/forms/FormOwnerField';
import './FormSignPage.css';

export default function FormSignPage() {
  const { token } = useParams<{ token: string }>();
  const [payload, setPayload] = useState<PublicFormPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [signature, setSignature] = useState('');
  const [signedName, setSignedName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstErrorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Invalid form link.');
      setLoading(false);
      return;
    }
    getPublicForm(token)
      .then((data) => {
        setPayload(data);
        const sigField = data.fields.find((f) => f.type === 'signature');
        if (sigField) setAnswers((a) => ({ ...a, [sigField.key]: '' }));
      })
      .catch(() => setError('This form link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  function setAnswer(key: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    const sigField = payload?.fields.find((f) => f.type === 'signature');
    if (sigField && key === sigField.key) setSignature(value as string);
  }

  function validate(): boolean {
    if (!payload) return false;
    const errors: Record<string, string> = {};
    for (const field of payload.fields) {
      if (!field.required) continue;
      if (field.type === 'heading' || field.type === 'paragraph') continue;
      if (field.type === 'signature') {
        if (!signature) errors[field.key] = 'Please draw your signature above';
        continue;
      }
      if (field.type === 'checkbox') {
        if (!answers[field.key]) errors[field.key] = 'This checkbox is required';
        continue;
      }
      if (!String(answers[field.key] ?? '').trim()) {
        errors[field.key] = `${field.label} is required`;
      }
    }
    if (!signedName.trim()) errors['__signedName'] = 'Please type your full name';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !payload) return;
    if (!validate()) {
      setTimeout(() => {
        firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitPublicForm(token, { answers, signatureDataUrl: signature, signedName });
      setDone(true);
    } catch (err: unknown) {
      const axiosMsg =
        err &&
        typeof err === 'object' &&
        'response' in err &&
        (err as { response?: { data?: { message?: string | string[] } } }).response?.data
          ?.message;
      const detail = Array.isArray(axiosMsg)
        ? axiosMsg.join(', ')
        : typeof axiosMsg === 'string'
          ? axiosMsg
          : null;
      setSubmitError(
        detail ||
          (err instanceof Error ? err.message : 'Something went wrong. Please try again.'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="fsign-shell">
        <p className="fsign-loading">Loading form…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fsign-shell">
        <div className="fsign-card">
          <p className="fsign-error-banner">{error}</p>
        </div>
      </div>
    );
  }

  if (payload?.expired) {
    return (
      <div className="fsign-shell">
        <div className="fsign-card">
          <h1 className="fsign-title">{payload.formName}</h1>
          <p className="fsign-error-banner">This form link has expired. Please contact the practice.</p>
        </div>
      </div>
    );
  }

  if (done || payload?.alreadySubmitted) {
    return (
      <div className="fsign-shell">
        <div className="fsign-card fsign-done">
          <div className="fsign-done-icon">✓</div>
          <h1 className="fsign-title">
            {payload?.alreadySubmitted && !done ? 'Already submitted' : 'Thank you!'}
          </h1>
          <p>
            {payload?.alreadySubmitted && !done
              ? 'This form has already been completed.'
              : 'Your form has been submitted successfully. You may close this window.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fsign-shell">
      <div className="fsign-card">
        <div className="fsign-header">
          {payload?.practiceName && (
            <p className="fsign-practice">{payload.practiceName}</p>
          )}
          <h1 className="fsign-title">{payload?.formName}</h1>
          {(payload?.clientName || payload?.patientName) && (
            <p className="fsign-subtitle">
              {[payload.clientName, payload.patientName && `Patient: ${payload.patientName}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="fsign-fields" ref={firstErrorRef}>
            {payload?.fields.map((field) => (
              <FormOwnerField
                key={field.key}
                field={field}
                answers={answers}
                onChange={setAnswer}
                error={fieldErrors[field.key] ?? null}
              />
            ))}
          </div>

          <div className="fsign-sign-section">
            <div className={`fsign-field${fieldErrors['__signedName'] ? ' fsign-field--error' : ''}`}>
              <label htmlFor="signed-name">
                Type your full name to confirm <span className="fsign-required">*</span>
              </label>
              <input
                type="text"
                id="signed-name"
                value={signedName}
                onChange={(e) => {
                  setSignedName(e.target.value);
                  if (fieldErrors['__signedName']) {
                    setFieldErrors((prev) => {
                      const n = { ...prev };
                      delete n['__signedName'];
                      return n;
                    });
                  }
                }}
                placeholder="Full name"
                autoComplete="name"
              />
              {fieldErrors['__signedName'] && (
                <span className="fsign-field-error-msg">{fieldErrors['__signedName']}</span>
              )}
            </div>

            {submitError && (
              <p className="fsign-error-banner" role="alert">
                {submitError}
              </p>
            )}

            <button type="submit" className="fsign-submit-btn" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit signed form'}
            </button>

            <p className="fsign-legal">
              By submitting this form you acknowledge that your typed name and drawn signature
              above constitute your electronic signature.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
