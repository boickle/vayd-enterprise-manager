import { useState } from 'react';
import type { ReactNode } from 'react';
import SoapRichTextField from './SoapRichTextField';
import { soapHtmlToPlainText } from '../../utils/sanitizeCommunicationHtml';

type SoapField = {
  value: string;
  onChange: (text: string) => void;
  onBlur: () => void;
};

function formatFullSoap(s: string, o: string, a: string, p: string): string {
  return [
    `S:\n${soapHtmlToPlainText(s).trim()}`,
    `O:\n${soapHtmlToPlainText(o).trim()}`,
    `A:\n${soapHtmlToPlainText(a).trim()}`,
    `P:\n${soapHtmlToPlainText(p).trim()}`,
  ].join('\n\n');
}

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

function SoapSection({
  letter,
  label,
  placeholder,
  field,
  disabled,
  minHeightPx,
  headerAction,
}: {
  letter: string;
  label: string;
  placeholder: string;
  field: SoapField;
  disabled: boolean;
  minHeightPx: number;
  headerAction?: ReactNode;
}) {
  return (
    <section className="soap-doc-section">
      <div className="soap-doc-section-head">
        <h3>
          <span className="soap-doc-letter">{letter}</span> {label}
        </h3>
        {headerAction}
      </div>
      <SoapRichTextField
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        disabled={disabled}
        placeholder={placeholder}
        minHeightPx={minHeightPx}
      />
    </section>
  );
}

/**
 * Editable "Document view" alternative to the tabbed SOAP form (docs/ai-scribe.md): four
 * rich-text S/O/A/P fields (bold for significant Objective findings) that are the SAME
 * underlying encounter fields shown in the Tabs view.
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
  const [copied, setCopied] = useState(false);

  async function copyAllSoap() {
    const text = formatFullSoap(subjective, objectiveNotes, assessment, planNotes);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="soap-doc-view">
      <SoapSection
        letter="S"
        label="Subjective"
        placeholder={`Presenting Complaint: …\n\nPatient History:\n- …`}
        field={{ value: subjective, onChange: onSubjectiveChange, onBlur: onSubjectiveBlur }}
        disabled={disabled}
        minHeightPx={260}
        headerAction={
          <button
            type="button"
            className={`soap-btn ghost small soap-doc-copy-all${copied ? ' ok' : ''}`}
            onClick={() => void copyAllSoap()}
          >
            {copied ? 'Copied' : 'Copy all'}
          </button>
        }
      />
      <SoapSection
        letter="O"
        label="Objective"
        placeholder="Vital signs, physical exam findings… Use Bold for abnormals."
        field={{
          value: objectiveNotes,
          onChange: onObjectiveNotesChange,
          onBlur: onObjectiveNotesBlur,
        }}
        disabled={disabled}
        minHeightPx={260}
      />
      <SoapSection
        letter="A"
        label="Assessment"
        placeholder={`Problem List:\n- …\n- … - r/o …`}
        field={{ value: assessment, onChange: onAssessmentChange, onBlur: onAssessmentBlur }}
        disabled={disabled}
        minHeightPx={200}
      />
      <SoapSection
        letter="P"
        label="Plan"
        placeholder={`Diagnostics:\n- …\nTreatment Plan/Medications:\n- …\nClient Communication:\n- …`}
        field={{ value: planNotes, onChange: onPlanNotesChange, onBlur: onPlanNotesBlur }}
        disabled={disabled}
        minHeightPx={240}
      />

      {planItemsSlot}
    </div>
  );
}
