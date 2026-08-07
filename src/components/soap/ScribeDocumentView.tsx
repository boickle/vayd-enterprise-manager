import type { ReactNode } from 'react';

type SoapField = {
  value: string;
  onChange: (text: string) => void;
  onBlur: () => void;
};

type Props = {
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
};

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
}: Props) {
  return (
    <div className="soap-doc-view">
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
    </div>
  );
}
