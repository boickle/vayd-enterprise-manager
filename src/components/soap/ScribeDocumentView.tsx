import type { ReactNode } from 'react';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

type SoapField = {
  value: string;
  onChange: (text: string) => void;
  onBlur: () => void;
};

type Props = {
  patientName: string;
  visitDate: string;
  disabled: boolean;
  subjective: string;
  onSubjectiveChange: (text: string) => void;
  onSubjectiveBlur: () => void;
  objectiveNotes: string;
  onObjectiveNotesChange: (text: string) => void;
  onObjectiveNotesBlur: () => void;
  assessment: string;
  onAssessmentChange: (text: string) => void;
  onAssessmentBlur: () => void;
  planNotes: string;
  onPlanNotesChange: (text: string) => void;
  onPlanNotesBlur: () => void;
  /** Rendered directly under the Plan field — the itemized "match to catalog" plan-items UI
   * (docs/ai-scribe.md) lives here since it needs order/pricing APIs this view doesn't own. */
  planItemsSlot?: ReactNode;
  emailSubject: string;
  emailBody: string;
  onEmailSubjectChange: (text: string) => void;
  onEmailBodyChange: (text: string) => void;
  onEmailBlur: () => void;
};

function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1800);
    } catch {
      /* clipboard may be unavailable (e.g. insecure context); nothing to fall back to */
    }
  };
  return { copiedKey, copy };
}

function SoapField({
  letter,
  label,
  placeholder,
  field,
  disabled,
  rows = 14,
}: {
  letter: string;
  label: string;
  placeholder: string;
  field: SoapField;
  disabled: boolean;
  rows?: number;
}) {
  return (
    <section className="soap-doc-section">
      <div className="soap-doc-section-head">
        <h3>
          <span className="soap-doc-letter">{letter}</span> {label}
        </h3>
      </div>
      <textarea
        className="soap-doc-textarea"
        rows={rows}
        placeholder={placeholder}
        value={field.value}
        disabled={disabled}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
      />
    </section>
  );
}

/**
 * Editable "Document view" alternative to the tabbed SOAP form (docs/ai-scribe.md): four
 * plain-text S/O/A/P fields that are the SAME underlying encounter fields shown in the Tabs
 * view (subjective / objectiveNotes / assessmentReasoning / planNotes) — editing here saves
 * through the same path, so changes show up in both views. The AI scribe pre-fills them
 * (Subjective/Assessment via the live per-cycle suggestions, Objective/Plan via the one-shot
 * narrative generated when recording stops or a transcript is pasted), but nothing here is
 * read-only — the doctor can freely edit before/after AI content lands.
 */
export default function ScribeDocumentView({
  patientName,
  visitDate,
  disabled,
  subjective,
  onSubjectiveChange,
  onSubjectiveBlur,
  objectiveNotes,
  onObjectiveNotesChange,
  onObjectiveNotesBlur,
  assessment,
  onAssessmentChange,
  onAssessmentBlur,
  planNotes,
  onPlanNotesChange,
  onPlanNotesBlur,
  planItemsSlot,
  emailSubject,
  emailBody,
  onEmailSubjectChange,
  onEmailBodyChange,
  onEmailBlur,
}: Props) {
  const { copiedKey, copy } = useCopy();

  const fullEmail =
    emailSubject.trim() || emailBody.trim()
      ? `Subject: ${emailSubject}\n\n${emailBody}`
      : '';

  return (
    <div className="soap-doc-view">
      <div className="soap-doc-head">
        <div>
          <div className="soap-doc-patient">{patientName}</div>
          <div className="soap-doc-date">Date: {visitDate}</div>
        </div>
      </div>

      <SoapField
        letter="S"
        label="Subjective"
        placeholder={`Presenting Complaint: …\n\nPatient History:\n- …`}
        field={{ value: subjective, onChange: onSubjectiveChange, onBlur: onSubjectiveBlur }}
        disabled={disabled}
        rows={16}
      />
      <SoapField
        letter="O"
        label="Objective"
        placeholder="Vital signs, physical exam findings…"
        field={{
          value: objectiveNotes,
          onChange: onObjectiveNotesChange,
          onBlur: onObjectiveNotesBlur,
        }}
        disabled={disabled}
        rows={16}
      />
      <SoapField
        letter="A"
        label="Assessment"
        placeholder={`Problem List:\n- …\n- … - r/o …`}
        field={{ value: assessment, onChange: onAssessmentChange, onBlur: onAssessmentBlur }}
        disabled={disabled}
        rows={12}
      />
      <SoapField
        letter="P"
        label="Plan"
        placeholder={`Diagnostics:\n- …\nTreatment Plan/Medications:\n- …\nClient Communication:\n- …`}
        field={{ value: planNotes, onChange: onPlanNotesChange, onBlur: onPlanNotesBlur }}
        disabled={disabled}
        rows={14}
      />

      {planItemsSlot}

      <section className="soap-doc-section">
        <div className="soap-doc-section-head">
          <h3>Email to client</h3>
          {fullEmail ? (
            <button
              type="button"
              className="soap-btn small ghost"
              onClick={() => void copy('email', fullEmail)}
            >
              {copiedKey === 'email' ? <Check size={12} /> : <Copy size={12} />}
              {copiedKey === 'email' ? 'Copied' : 'Copy'}
            </button>
          ) : null}
        </div>
        <label className="soap-email-label">
          Subject
          <input
            className="soap-input"
            type="text"
            placeholder="Follow-up from today's visit…"
            value={emailSubject}
            disabled={disabled}
            onChange={(e) => onEmailSubjectChange(e.target.value)}
            onBlur={onEmailBlur}
          />
        </label>
        <textarea
          className="soap-doc-textarea soap-textarea--email"
          rows={12}
          placeholder={`Hello,\n\nI wanted to provide a summary of our conversation today…`}
          value={emailBody}
          disabled={disabled}
          onChange={(e) => onEmailBodyChange(e.target.value)}
          onBlur={onEmailBlur}
        />
      </section>
    </div>
  );
}
