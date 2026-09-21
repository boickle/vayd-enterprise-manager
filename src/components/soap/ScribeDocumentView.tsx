import { useState } from 'react';
import type { ReactNode } from 'react';
import { Activity, ArrowLeft, ArrowRight, ClipboardList, ListChecks, Receipt } from 'lucide-react';
import SoapRichTextField from './SoapRichTextField';
import { soapHtmlToPlainText } from '../../utils/sanitizeCommunicationHtml';

type SoapField = {
  value: string;
  onChange: (text: string) => void;
  onBlur: (value: string) => void;
};

/** SoapEncounter column behind each tab, so co-editing presence can name where you are. */
const ENCOUNTER_FIELD_BY_TAB: Record<string, string> = {
  subjective: 'subjective',
  objective: 'objectiveNotes',
  assessment: 'assessmentReasoning',
  plan: 'planNotes',
};

function formatFullSoap(s: string, o: string, a: string, p: string): string {
  return [
    `S:\n${soapHtmlToPlainText(s).trim()}`,
    `O:\n${soapHtmlToPlainText(o).trim()}`,
    `A:\n${soapHtmlToPlainText(a).trim()}`,
    `P:\n${soapHtmlToPlainText(p).trim()}`,
  ].join('\n\n');
}

function hasContent(html: string): boolean {
  return Boolean(soapHtmlToPlainText(html).trim());
}

export type DocTabId = 'subjective' | 'objective' | 'assessment' | 'plan' | 'checkout-prep';

type Props = {
  disabled: boolean;
  subjective: string;
  onSubjectiveChange: (text: string) => void;
  onSubjectiveBlur: (value: string) => void;
  objectiveNotes: string;
  onObjectiveNotesChange: (text: string) => void;
  onObjectiveNotesBlur: (value: string) => void;
  assessment: string;
  onAssessmentChange: (text: string) => void;
  onAssessmentBlur: (value: string) => void;
  planNotes: string;
  onPlanNotesChange: (text: string) => void;
  onPlanNotesBlur: (value: string) => void;
  /** Vitals, above the Objective narrative — the tech's weight confirmation lives here. */
  vitalsSlot?: ReactNode;
  /** True while the weight still needs a tech, so the O tab can say so. */
  objectiveNeedsAttention?: boolean;
  /** Checkout prep body (match transcript items to catalog). Not part of the signed chart. */
  checkoutPrepSlot?: ReactNode;
  /** Unmatched checkout-prep rows — badge + attention styling on that tab. */
  checkoutPrepPendingCount?: number;
  /** Controlled tab (so Wrap up / Checkout can jump here). */
  activeTab?: DocTabId;
  onActiveTabChange?: (tab: DocTabId) => void;
};

type SoapDocTabId = 'subjective' | 'objective' | 'assessment' | 'plan';

const SOAP_TABS: {
  id: SoapDocTabId;
  letter: string;
  label: string;
  icon: typeof ClipboardList;
  placeholder: string;
  minHeightPx: number;
}[] = [
  {
    id: 'subjective',
    letter: 'S',
    label: 'Subjective',
    icon: ClipboardList,
    placeholder: `Presenting Complaint: …\n\nPatient History:\n- …`,
    minHeightPx: 360,
  },
  {
    id: 'objective',
    letter: 'O',
    label: 'Objective',
    icon: Activity,
    placeholder: 'Vital signs, physical exam findings… Use Bold for abnormals.',
    minHeightPx: 320,
  },
  {
    id: 'assessment',
    letter: 'A',
    label: 'Assessment',
    icon: ListChecks,
    placeholder: `Problem List:\n- …\n- … - r/o …`,
    minHeightPx: 340,
  },
  {
    id: 'plan',
    letter: 'P',
    label: 'Plan',
    icon: ClipboardList,
    placeholder: `Diagnostics:\n- …\nTreatment Plan/Medications:\n- …\nClient Communication:\n- …`,
    minHeightPx: 320,
  },
];

/**
 * Editable "Document view" alternative to the tabbed SOAP form (docs/ai-scribe.md): four
 * rich-text S/O/A/P fields plus Checkout prep (billing match, not chart text).
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
  vitalsSlot,
  objectiveNeedsAttention,
  checkoutPrepSlot,
  checkoutPrepPendingCount = 0,
  activeTab: controlledTab,
  onActiveTabChange,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [uncontrolledTab, setUncontrolledTab] = useState<DocTabId>('subjective');
  const activeTab = controlledTab ?? uncontrolledTab;
  const setActiveTab = (tab: DocTabId) => {
    onActiveTabChange?.(tab);
    if (controlledTab == null) setUncontrolledTab(tab);
  };

  const fields: Record<SoapDocTabId, SoapField> = {
    subjective: {
      value: subjective,
      onChange: onSubjectiveChange,
      onBlur: onSubjectiveBlur,
    },
    objective: {
      value: objectiveNotes,
      onChange: onObjectiveNotesChange,
      onBlur: onObjectiveNotesBlur,
    },
    assessment: {
      value: assessment,
      onChange: onAssessmentChange,
      onBlur: onAssessmentBlur,
    },
    plan: { value: planNotes, onChange: onPlanNotesChange, onBlur: onPlanNotesBlur },
  };

  const soapIndex = SOAP_TABS.findIndex((t) => t.id === activeTab);
  const activeSoap = soapIndex >= 0 ? SOAP_TABS[soapIndex] : null;
  const previous =
    activeTab === 'checkout-prep'
      ? SOAP_TABS[SOAP_TABS.length - 1]!
      : soapIndex > 0
        ? SOAP_TABS[soapIndex - 1]!
        : null;
  const next =
    activeTab === 'checkout-prep'
      ? null
      : soapIndex >= 0 && soapIndex < SOAP_TABS.length - 1
        ? SOAP_TABS[soapIndex + 1]!
        : activeTab === 'plan'
          ? { id: 'checkout-prep' as const, label: 'Checkout prep' }
          : null;

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
      <div className="soap-doc-tabbar">
        <div className="soap-tabs" role="tablist" aria-label="SOAP sections">
          {SOAP_TABS.map((tab) => {
            const Icon = tab.icon;
            const filled = hasContent(fields[tab.id].value);
            const flagged = tab.id === 'objective' && objectiveNeedsAttention;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={[
                  'soap-tab',
                  activeTab === tab.id ? 'active' : '',
                  filled ? 'is-filled' : '',
                  flagged ? 'needs-attention' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={
                  flagged
                    ? 'Weight still needs confirming'
                    : filled
                      ? `${tab.label} — written`
                      : `${tab.label} — empty`
                }
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={15} aria-hidden />
                <span className="soap-tab-label">{tab.label}</span>
                <span className="soap-tab-short">{tab.letter}</span>
              </button>
            );
          })}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'checkout-prep'}
            className={[
              'soap-tab',
              activeTab === 'checkout-prep' ? 'active' : '',
              checkoutPrepPendingCount > 0 ? 'needs-attention' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={
              checkoutPrepPendingCount > 0
                ? `${checkoutPrepPendingCount} item${checkoutPrepPendingCount === 1 ? '' : 's'} still to match`
                : 'Match transcript items to charges — not part of the signed chart'
            }
            onClick={() => setActiveTab('checkout-prep')}
          >
            <Receipt size={15} aria-hidden />
            <span className="soap-tab-label">Checkout prep</span>
            <span className="soap-tab-short">$</span>
            {checkoutPrepPendingCount > 0 ? (
              <span className="soap-tab-badge">{checkoutPrepPendingCount}</span>
            ) : null}
          </button>
        </div>
        <button
          type="button"
          className={`soap-btn ghost small soap-doc-copy-all${copied ? ' ok' : ''}`}
          onClick={() => void copyAllSoap()}
        >
          {copied ? 'Copied' : 'Copy all'}
        </button>
      </div>

      <section
        className="soap-doc-section"
        role="tabpanel"
        aria-label="Checkout prep"
        hidden={activeTab !== 'checkout-prep'}
      >
        <div className="soap-doc-section-head">
          <h3>
            <span className="soap-doc-letter">$</span> Checkout prep
          </h3>
        </div>
        <p className="soap-section-hint">
          Optional — match today&apos;s plan to catalog charges. This step is not saved as part of
          the medical record when you wrap up.
        </p>
        {checkoutPrepSlot}
        <div className="soap-doc-nav">
          {previous ? (
            <button
              type="button"
              className="soap-btn ghost"
              onClick={() => setActiveTab(previous.id)}
            >
              <ArrowLeft size={14} /> {previous.label}
            </button>
          ) : (
            <span />
          )}
          <span />
        </div>
      </section>

      {activeTab !== 'checkout-prep' && activeSoap ? (
        <section className="soap-doc-section" role="tabpanel" aria-label={activeSoap.label}>
          {activeTab === 'objective' && vitalsSlot}

          <div className="soap-doc-section-head">
            <h3>
              <span className="soap-doc-letter">{activeSoap.letter}</span> {activeSoap.label}
              {activeTab === 'objective' ? ' notes' : ''}
            </h3>
          </div>
          <SoapRichTextField
            key={activeSoap.id}
            value={fields[activeSoap.id].value}
            onChange={fields[activeSoap.id].onChange}
            onBlur={fields[activeSoap.id].onBlur}
            disabled={disabled}
            placeholder={activeSoap.placeholder}
            minHeightPx={activeSoap.minHeightPx}
            dataField={ENCOUNTER_FIELD_BY_TAB[activeSoap.id]}
          />

          <div className="soap-doc-nav">
            {previous ? (
              <button
                type="button"
                className="soap-btn ghost"
                onClick={() => setActiveTab(previous.id)}
              >
                <ArrowLeft size={14} /> {previous.label}
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button type="button" className="soap-btn" onClick={() => setActiveTab(next.id)}>
                {next.label} <ArrowRight size={14} />
              </button>
            ) : (
              <span />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
