// src/pages/PostAppointmentSurvey.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getSurveyForm,
  submitSurvey,
  type SurveyFormResponse,
  type SurveyFormQuestion,
  type SurveyFormSection,
  type SurveyAnswerInput,
  type SurveyQuestionConfigShowWhen,
} from '../api/survey';
import { apiBaseUrl } from '../api/http';
import './PostAppointmentSurvey.css';

/** Fallback when an image_choice option has no image or the image fails to load. */
const FALLBACK_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="#e4efe9"/><circle cx="40" cy="32" r="14" fill="#4b7c6a"/><path d="M20 80c0-14 9-24 20-24s20 10 20 24z" fill="#4b7c6a"/></svg>'
  );

type Block = { order: number; type: 'section'; section: SurveyFormSection } | { order: number; type: 'question'; question: SurveyFormQuestion };

/** True if question has no showWhen, or the referenced question's answer equals showWhen.value. */
function isQuestionVisible(
  question: SurveyFormQuestion,
  answers: Record<string, string | string[]>
): boolean {
  const showWhen = (question.config as { showWhen?: SurveyQuestionConfigShowWhen })?.showWhen;
  if (!showWhen) return true;
  const ref = answers[showWhen.questionKey];
  if (ref == null) return false;
  const refStr = Array.isArray(ref) ? ref[0] : ref;
  return String(refStr).trim() === String(showWhen.value).trim();
}

function buildOrderedBlocks(sections: SurveyFormSection[], questions: SurveyFormQuestion[]): Block[] {
  const blocks: Block[] = [
    ...sections.map((s) => ({ order: s.order, type: 'section' as const, section: s })),
    ...questions.map((q) => ({ order: q.order, type: 'question' as const, question: q })),
  ];
  blocks.sort((a, b) => a.order - b.order);
  return blocks;
}

/** Insert virtual section blocks from question.pageSection when API omits sections array */
function addPageSectionBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let lastPageSection: string | null = null;
  for (const block of blocks) {
    if (block.type === 'question' && block.question.pageSection != null && block.question.pageSection.trim() !== '') {
      const pageSection = block.question.pageSection.trim();
      if (pageSection !== lastPageSection) {
        lastPageSection = pageSection;
        const id = pageSection.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        out.push({
          order: block.order - 0.5,
          type: 'section',
          section: { id: id || 'section', title: pageSection, order: block.order - 0.5 },
        });
      }
    } else if (block.type === 'section') {
      lastPageSection = block.section.title ?? null;
    } else if (block.type === 'question') {
      lastPageSection = null;
    }
    out.push(block);
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

/** Sections that should be collapsible and collapsed by default. (Currently none; Veterinary Nurses is always expanded.) */
function isCollapsibleSection(_section: SurveyFormSection): boolean {
  return false;
}

type DisplayNode =
  | { type: 'single'; block: Block }
  | { type: 'collapsible'; section: SurveyFormSection; contentBlocks: Block[] };

function buildDisplayNodes(blocks: Block[]): DisplayNode[] {
  const nodes: DisplayNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'section' && isCollapsibleSection(block.section)) {
      const section = block.section;
      const contentBlocks: Block[] = [];
      let j = i + 1;
      while (j < blocks.length && blocks[j].type !== 'section') {
        contentBlocks.push(blocks[j]);
        j++;
      }
      nodes.push({ type: 'collapsible', section, contentBlocks });
      i = j;
    } else {
      nodes.push({ type: 'single', block });
      i++;
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Question renderers
// ---------------------------------------------------------------------------

function QuestionScale({
  question,
  value,
  onChange,
}: {
  question: SurveyFormQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const config = question.config as { scaleFrom?: number; scaleTo?: number; fromText?: string; toText?: string } | undefined;
  const from = config?.scaleFrom ?? 1;
  const to = config?.scaleTo ?? 5;
  const fromText = config?.fromText ?? '';
  const toText = config?.toText ?? '';
  const options = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <div className="survey-q survey-q-scale">
      <p className="survey-q-label">
        {question.questionText}
        {question.required && <span className="survey-required"> *</span>}
      </p>
      {(fromText || toText) && (
        <div className="survey-scale-labels-row" aria-hidden>
          <span className="survey-scale-label-end">{fromText}</span>
          <span className="survey-scale-label-end">{toText}</span>
        </div>
      )}
      <div
        className="survey-scale-row"
        style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
        role="group"
        aria-label={question.questionText}
      >
        {options.map((n) => (
          <div key={n} className="survey-scale-cell">
            <label className="survey-scale-option">
              <input
                type="radio"
                name={question.questionKey}
                value={String(n)}
                checked={value === String(n)}
                onChange={() => onChange(String(n))}
              />
              <span>{n}</span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestionRadio({
  question,
  value,
  onChange,
}: {
  question: SurveyFormQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const config = question.config as { options?: string[] } | undefined;
  const options = config?.options ?? [];

  return (
    <div className="survey-q survey-q-radio">
      <p className="survey-q-label">
        {question.questionText}
        {question.required && <span className="survey-required"> *</span>}
      </p>
      <div className="survey-radio-list" role="group" aria-label={question.questionText}>
        {options.map((opt) => (
          <label key={opt} className="survey-radio-option">
            <input
              type="radio"
              name={question.questionKey}
              value={opt}
              checked={value === opt}
              onChange={() => onChange(opt)}
            />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function QuestionDropdown({
  question,
  value,
  onChange,
}: {
  question: SurveyFormQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const config = question.config as { options?: string[] } | undefined;
  const options = config?.options ?? [];

  return (
    <div className="survey-q survey-q-dropdown">
      <label className="survey-q-label">
        {question.questionText}
        {question.required && <span className="survey-required"> *</span>}
      </label>
      <select
        className="survey-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={question.required}
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function QuestionImageChoice({
  question,
  value,
  onChange,
}: {
  question: SurveyFormQuestion;
  value: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  const config = question.config as {
    options?: { value: string; label: string; imageUrl?: string; employeeId?: number }[];
    multiple?: boolean;
  } | undefined;
  const options = config?.options ?? [];
  const multiple = config?.multiple === true;

  const selectedSet = multiple
    ? new Set(Array.isArray(value) ? value : value ? [value] : [])
    : new Set(typeof value === 'string' && value ? [value] : []);

  const imageSrc = (opt: { imageUrl?: string; employeeId?: number }) => {
    if (opt.employeeId != null) {
      return `${apiBaseUrl}/employees/${opt.employeeId}/image`;
    }
    return opt.imageUrl?.trim() || FALLBACK_IMAGE;
  };

  const handleOptionClick = (optValue: string) => {
    if (multiple) {
      const next = new Set(selectedSet);
      if (next.has(optValue)) next.delete(optValue);
      else next.add(optValue);
      onChange(Array.from(next));
    } else {
      onChange(optValue);
    }
  };

  return (
    <div className="survey-q survey-q-image-choice">
      <p className="survey-q-label">
        {question.questionText}
        {question.required && <span className="survey-required"> *</span>}
      </p>
      <div className="survey-image-grid" role="group" aria-label={question.questionText}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`survey-image-option ${selectedSet.has(opt.value) ? 'selected' : ''}`}
            onClick={() => handleOptionClick(opt.value)}
          >
            <img
              src={imageSrc(opt)}
              alt=""
              onError={(e) => {
                e.currentTarget.src = FALLBACK_IMAGE;
              }}
            />
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


function QuestionTextarea({
  question,
  value,
  onChange,
}: {
  question: SurveyFormQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="survey-q survey-q-textarea">
      <label className="survey-q-label">
        {question.questionText}
        {question.required && <span className="survey-required"> *</span>}
      </label>
      <textarea
        className="survey-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Your comments..."
        aria-required={question.required}
      />
    </div>
  );
}

function QuestionTextbox({
  question,
  value,
  onChange,
}: {
  question: SurveyFormQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="survey-q survey-q-textbox">
      <label className="survey-q-label">
        {question.questionText}
        {question.required && <span className="survey-required"> *</span>}
      </label>
      <input
        type="text"
        className="survey-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional"
        aria-required={question.required}
      />
    </div>
  );
}

function SurveyQuestion({
  question,
  value,
  onChange,
}: {
  question: SurveyFormQuestion;
  value: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  const valueStr = typeof value === 'string' ? value : (Array.isArray(value) ? value[0] : '') ?? '';
  switch (question.questionType) {
    case 'scale':
      return <QuestionScale question={question} value={valueStr} onChange={(v) => onChange(v)} />;
    case 'radio':
      return <QuestionRadio question={question} value={valueStr} onChange={(v) => onChange(v)} />;
    case 'dropdown':
      return <QuestionDropdown question={question} value={valueStr} onChange={(v) => onChange(v)} />;
    case 'image_choice':
      return <QuestionImageChoice question={question} value={value} onChange={onChange} />;
    case 'textarea':
      return <QuestionTextarea question={question} value={valueStr} onChange={(v) => onChange(v)} />;
    case 'textbox':
      return <QuestionTextbox question={question} value={valueStr} onChange={(v) => onChange(v)} />;
    default:
      return (
        <div className="survey-q">
          <p className="survey-q-label">{question.questionText}</p>
          <input
            type="text"
            className="survey-input"
            value={valueStr}
            onChange={(e) => onChange(e.target.value)}
            aria-required={question.required}
          />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PostAppointmentSurvey() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<
    'loading' | 'invalid' | 'form' | 'submitting' | 'success' | 'error'
  >('loading');
  const [formData, setFormData] = useState<SurveyFormResponse | null>(null);
  /** Single value (string) or multiple values (string[]) for image_choice multiple */
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    let cancelled = false;
    setState('loading');
    getSurveyForm(token)
      .then((data) => {
        if (!cancelled) {
          setFormData(data);
          setState('form');
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        const status = err?.response?.status;
        const message = err?.response?.data?.message ?? err?.message;
        if (status === 400 || status === 404) {
          setState('invalid');
        } else {
          setSubmitError(message || 'Unable to load the survey.');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const blocks = useMemo(() => {
    if (!formData) return [];
    const raw = buildOrderedBlocks(formData.sections ?? [], formData.questions ?? []);
    return addPageSectionBlocks(raw);
  }, [formData]);

  /** Group blocks by each question's page (API page is 1-based). Section blocks use the next question's page. */
  const pageBlocks = useMemo(() => {
    if (blocks.length === 0) return [[]];
    const pageNumbers: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type === 'question') {
        pageNumbers[i] = block.question.page ?? 1;
      } else {
        let nextPage = 1;
        for (let j = i + 1; j < blocks.length; j++) {
          if (blocks[j].type === 'question') {
            nextPage = (blocks[j] as Block & { type: 'question'; question: SurveyFormQuestion }).question.page ?? 1;
            break;
          }
        }
        pageNumbers[i] = nextPage;
      }
    }
    const maxPage = Math.max(1, ...pageNumbers);
    const byPage: Block[][] = Array.from({ length: maxPage }, () => []);
    blocks.forEach((block, i) => {
      const p = pageNumbers[i];
      if (p >= 1 && p <= maxPage) byPage[p - 1].push(block);
    });
    return byPage;
  }, [blocks]);

  const [currentPage, setCurrentPage] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  /** Current page blocks and display nodes (for collapsible sections). Must be called unconditionally. */
  const blocksForCurrentPage = useMemo(() => pageBlocks[currentPage] ?? [], [pageBlocks, currentPage]);
  const displayNodes = useMemo(() => buildDisplayNodes(blocksForCurrentPage), [blocksForCurrentPage]);

  const setAnswer = (questionKey: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [questionKey]: value }));
  };

  /** Required question keys on a given page's blocks (only for visible questions). */
  const getRequiredOnPage = (pageBlks: Block[], ans: Record<string, string | string[]>) => {
    return pageBlks
      .filter((b): b is Block & { type: 'question'; question: SurveyFormQuestion } => b.type === 'question' && b.question.required && isQuestionVisible(b.question, ans))
      .map((b) => b.question.questionKey);
  };

  const isAnswered = (key: string): boolean => {
    const raw = answers[key];
    if (raw == null) return false;
    if (Array.isArray(raw)) return raw.some((v) => String(v).trim() !== '');
    return String(raw).trim() !== '';
  };

  const validatePage = (pageIndex: number): boolean => {
    const required = getRequiredOnPage(pageBlocks[pageIndex] ?? [], answers);
    return required.every((key) => isAnswered(key));
  };

  const validateAll = (): boolean => {
    if (!formData) return false;
    for (const q of formData.questions) {
      if (q.required && isQuestionVisible(q, answers) && !isAnswered(q.questionKey)) return false;
    }
    return true;
  };

  const handleNext = () => {
    if (!validatePage(currentPage)) {
      setSubmitError('Please answer all required questions on this page.');
      return;
    }
    setSubmitError(null);
    // Defer so the click finishes on the Next button; otherwise the same click can fire on the newly rendered Submit button
    setTimeout(() => setCurrentPage((p) => Math.min(pageBlocks.length - 1, p + 1)), 0);
  };

  const handleBack = () => {
    setSubmitError(null);
    setCurrentPage((p) => Math.max(0, p - 1));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !formData) return;
    if (!validateAll()) {
      setSubmitError('Please answer all required questions.');
      return;
    }
    const answerList: SurveyAnswerInput[] = formData.questions
      .filter((q) => isQuestionVisible(q, answers))
      .flatMap((q) => {
        const raw = answers[q.questionKey];
        if (raw == null) return [];
        const values = Array.isArray(raw) ? raw : [raw];
        const trimmed = values.map((v) => String(v).trim()).filter(Boolean);
        return trimmed.map((value) => ({ questionKey: q.questionKey, value }));
      });

    setState('submitting');
    setSubmitError(null);
    submitSurvey(token, answerList)
      .then(() => setState('success'))
      .catch((err: any) => {
        const message = err?.response?.data?.message ?? err?.message ?? 'Something went wrong. Please try again.';
        setSubmitError(message);
        setState('form');
      });
  };

  if (!token) {
    return (
      <div className="survey-page">
        <div className="survey-card survey-invalid">
          <h1>Survey link missing</h1>
          <p>This survey requires a link from your appointment follow-up email. If you lost the link, please contact us.</p>
        </div>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="survey-page">
        <div className="survey-card">
          <p className="survey-loading">Loading survey…</p>
        </div>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div className="survey-page">
        <div className="survey-card survey-invalid">
          <h1>This link has expired or is invalid</h1>
          <p>This survey link may have already been used or has expired. If you have questions, please contact us.</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="survey-page">
        <div className="survey-card survey-invalid">
          <h1>Something went wrong</h1>
          <p>{submitError ?? 'Unable to load the survey. Please try again later.'}</p>
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="survey-page">
        <div className="survey-card survey-success">
          <h1>Thank you for your feedback</h1>
          <p>Your responses have been submitted. You can close this window.</p>
        </div>
      </div>
    );
  }

  // state === 'form' || state === 'submitting'
  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const renderBlock = (block: Block, keyPrefix: string) => {
    if (block.type === 'section') {
      const { section } = block;
      if (section.pageInfo) {
        return (
          <div key={`${keyPrefix}-section-${section.id}`} className="survey-section survey-page-break">
            <h2 className="survey-section-title">{section.pageInfo}</h2>
          </div>
        );
      }
      return (
        <div key={`${keyPrefix}-section-${section.id}`} className="survey-section">
          {section.title && <h2 className="survey-section-title">{section.title}</h2>}
          {section.subHeader && <p className="survey-section-sub">{section.subHeader}</p>}
        </div>
      );
    }
    if (!isQuestionVisible(block.question, answers)) return null;
    return (
      <SurveyQuestion
        key={`${keyPrefix}-q-${block.question.id}`}
        question={block.question}
        value={
          answers[block.question.questionKey] ??
          (block.question.questionType === 'image_choice' && (block.question.config as { multiple?: boolean })?.multiple ? [] : '')
        }
        onChange={(v) => setAnswer(block.question.questionKey, v)}
      />
    );
  };

  return (
    <div className="survey-page">
      <div className="survey-card">
        <form onSubmit={handleSubmit} className="survey-form">
          {formData?.survey?.name && (
            <h1 className="survey-title">{formData.survey.name}</h1>
          )}
          <div className="survey-page-indicator">
            Page {currentPage + 1} of {pageBlocks.length}
          </div>
          {displayNodes.map((node, idx) => {
            if (node.type === 'single') {
              return renderBlock(node.block, `p${currentPage}-${idx}`);
            }
            const { section, contentBlocks } = node;
            const isExpanded = expandedSections.has(section.id);
            return (
              <div key={`collapsible-${section.id}-${currentPage}`} className="survey-collapsible">
                <button
                  type="button"
                  className="survey-collapsible-trigger"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="survey-collapsible-title">{section.title ?? 'Section'}</span>
                  <span className={`survey-collapsible-chevron ${isExpanded ? 'expanded' : ''}`} aria-hidden>
                    ▼
                  </span>
                </button>
                {isExpanded && (
                  <div className="survey-collapsible-content">
                    {section.subHeader && <p className="survey-section-sub">{section.subHeader}</p>}
                    {contentBlocks.map((b, bi) => renderBlock(b, `p${currentPage}-c-${idx}-${bi}`))}
                  </div>
                )}
              </div>
            );
          })}
          {submitError && <p className="survey-error">{submitError}</p>}
          <div className="survey-actions survey-actions-paged">
            {currentPage > 0 ? (
              <button type="button" className="btn secondary" onClick={handleBack}>
                Back
              </button>
            ) : (
              <span />
            )}
            {currentPage < pageBlocks.length - 1 ? (
              <button type="button" className="btn" onClick={handleNext}>
                Next
              </button>
            ) : (
              <button type="submit" className="btn" disabled={state === 'submitting'}>
                {state === 'submitting' ? 'Submitting…' : 'Submit survey'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
