// src/pages/SurveyResults.tsx – Post-appointment survey results (same UI as previously in Settings)
import { useState, useEffect, useMemo } from 'react';
import {
  listSurveyResponses,
  getSurveyResponse,
  getSurveyReportSummary,
  getSurveyReportQuestions,
  type SurveyResponseListItem,
  type SurveyResponseDetail,
  type SurveyReportSummary,
  type SurveyReportQuestionScale,
  type SurveyReportQuestionChoice,
  type SurveyReportQuestionText,
  type SurveyReportQuestionsResponse,
} from '../api/survey';
import './Settings.css';

/** Surveys available in Admin → Survey Results (slug must match the API). Add entries when new surveys go live. */
const ADMIN_SURVEY_OPTIONS: { slug: string; label: string }[] = [
  { slug: 'post-appointment', label: 'Post-appointment' },
  { slug: 'exit-interview', label: 'Exit interview' },
];

function surveyDateFrom(d: Date) {
  return d.toISOString().slice(0, 10);
}

function surveyDateTo(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatSurveyDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const ALL_QUESTIONS_VALUE = '';
const ALL_ANSWERS_VALUE = '';

export default function SurveyResults() {
  const [surveySlug, setSurveySlug] = useState(() => ADMIN_SURVEY_OPTIONS[0]?.slug ?? 'post-appointment');
  const [surveyFrom, setSurveyFrom] = useState(() =>
    surveyDateFrom(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  );
  const [surveyTo, setSurveyTo] = useState(() => surveyDateTo(new Date()));
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | ''>('');
  const [selectedAnswerValue, setSelectedAnswerValue] = useState<string>(ALL_ANSWERS_VALUE);
  const [reportQuestions, setReportQuestions] = useState<SurveyReportQuestionsResponse | null>(null);
  const [surveyReport, setSurveyReport] = useState<SurveyReportSummary | null>(null);
  const [allSurveyResponses, setAllSurveyResponses] = useState<SurveyResponseListItem[]>([]);
  const [surveyDetailId, setSurveyDetailId] = useState<number | null>(null);
  const [surveyDetail, setSurveyDetail] = useState<SurveyResponseDetail | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [surveyDetailLoading, setSurveyDetailLoading] = useState(false);
  /** Modal showing all text responses for a question (when there are more than 5). */
  const [textResponsesModal, setTextResponsesModal] = useState<{
    questionText: string;
    entries: [string, number][];
  } | null>(null);

  // Filterable questions from GET /survey/reports/questions (exclude text fields for filter dropdown)
  const filterableQuestions = useMemo(() => {
    if (!reportQuestions?.questions) return [];
    return reportQuestions.questions.filter(
      (q) => q.questionType !== 'textarea' && q.questionType !== 'textbox'
    );
  }, [reportQuestions]);

  const selectedQuestion = useMemo(
    () =>
      typeof selectedQuestionId === 'number'
        ? filterableQuestions.find((q) => q.id === selectedQuestionId) ?? null
        : null,
    [filterableQuestions, selectedQuestionId]
  );

  const filterActive = Boolean(
    selectedQuestionId !== '' &&
      selectedAnswerValue &&
      selectedAnswerValue !== ALL_ANSWERS_VALUE
  );

  // Load questions for filter dropdowns when survey changes
  useEffect(() => {
    let alive = true;
    getSurveyReportQuestions(surveySlug)
      .then((data) => {
        if (alive) setReportQuestions(data);
      })
      .catch(() => {
        if (alive) setReportQuestions(null);
      });
    return () => {
      alive = false;
    };
  }, [surveySlug]);

  // Reset answer when question changes
  useEffect(() => {
    setSelectedAnswerValue(ALL_ANSWERS_VALUE);
  }, [selectedQuestionId]);

  // Fetch report summary (with optional question/answer filter) and response list when dates or filter change
  useEffect(() => {
    if (!surveyFrom || !surveyTo) return;
    let alive = true;
    setSurveyLoading(true);
    const reportParams = {
      surveySlug,
      from: surveyFrom,
      to: surveyTo,
      questionId:
        typeof selectedQuestionId === 'number' && selectedAnswerValue && selectedAnswerValue !== ALL_ANSWERS_VALUE
          ? selectedQuestionId
          : undefined,
      answerValue:
        typeof selectedQuestionId === 'number' && selectedAnswerValue && selectedAnswerValue !== ALL_ANSWERS_VALUE
          ? selectedAnswerValue
          : undefined,
    };
    const listParams = {
      surveySlug,
      from: surveyFrom,
      to: surveyTo,
      page: 1,
      limit: 50,
    };
    Promise.all([
      getSurveyReportSummary(reportParams),
      listSurveyResponses(listParams),
    ])
      .then(([report, list]) => {
        if (!alive) return;
        setSurveyReport(report);
        setAllSurveyResponses(list.items);
      })
      .catch(() => {
        if (!alive) return;
        setSurveyReport(null);
        setAllSurveyResponses([]);
      })
      .finally(() => {
        if (!alive) return;
        setSurveyLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [surveySlug, surveyFrom, surveyTo, selectedQuestionId, selectedAnswerValue]);

  useEffect(() => {
    if (surveyDetailId == null) {
      setSurveyDetail(null);
      return;
    }
    let alive = true;
    setSurveyDetailLoading(true);
    getSurveyResponse(surveyDetailId)
      .then((data) => {
        if (!alive) return;
        setSurveyDetail(data);
      })
      .catch(() => {
        if (!alive) return;
        setSurveyDetail(null);
      })
      .finally(() => {
        if (!alive) return;
        setSurveyDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [surveyDetailId]);

  return (
    <div className="container">
      <h1 className="settings-title">Survey Results</h1>
      <p className="settings-section-description">
        View per-question summary and individual responses. Pick a survey, then filter by date range,
        question, and answer.
      </p>

      <div
        className="settings-form-group"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}
      >
        <label className="settings-label" style={{ flexDirection: 'column', display: 'flex', gap: '4px' }}>
          Survey
          <select
            className="settings-input"
            value={surveySlug}
            onChange={(e) => {
              setSurveySlug(e.target.value);
              setSelectedQuestionId('');
              setSelectedAnswerValue(ALL_ANSWERS_VALUE);
            }}
            style={{ width: '260px', minHeight: '34px' }}
            aria-label="Survey"
          >
            {ADMIN_SURVEY_OPTIONS.map((opt) => (
              <option key={opt.slug} value={opt.slug}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label" style={{ flexDirection: 'column', display: 'flex', gap: '4px' }}>
          From
          <input
            type="date"
            className="settings-input"
            value={surveyFrom}
            onChange={(e) => setSurveyFrom(e.target.value)}
            style={{ width: '160px' }}
          />
        </label>
        <label className="settings-label" style={{ flexDirection: 'column', display: 'flex', gap: '4px' }}>
          To
          <input
            type="date"
            className="settings-input"
            value={surveyTo}
            onChange={(e) => setSurveyTo(e.target.value)}
            style={{ width: '160px' }}
          />
        </label>
        <label className="settings-label" style={{ flexDirection: 'column', display: 'flex', gap: '4px' }}>
          Question
          <select
            className="settings-input"
            value={selectedQuestionId === '' ? ALL_QUESTIONS_VALUE : String(selectedQuestionId)}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedQuestionId(v === ALL_QUESTIONS_VALUE ? '' : parseInt(v, 10));
            }}
            style={{ width: '280px', minHeight: '34px' }}
            disabled={surveyLoading || !filterableQuestions.length}
          >
            <option value={ALL_QUESTIONS_VALUE}>All Questions</option>
            {filterableQuestions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.questionText}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label" style={{ flexDirection: 'column', display: 'flex', gap: '4px' }}>
          Answer
          <select
            className="settings-input"
            value={selectedAnswerValue}
            onChange={(e) => setSelectedAnswerValue(e.target.value)}
            style={{ width: '200px', minHeight: '34px' }}
            disabled={!selectedQuestion || !selectedQuestion.options?.length}
          >
            <option value={ALL_ANSWERS_VALUE}>All Answers</option>
            {selectedQuestion?.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            )) ?? null}
          </select>
        </label>
      </div>

      {surveyLoading ? (
        <div className="settings-loading">
          <div className="settings-spinner" />
          <span>Loading survey results…</span>
        </div>
      ) : (
        <>
          <h3 className="settings-card-title" style={{ marginTop: '24px', marginBottom: '12px' }}>
            Report summary
            {filterActive && (
              <span className="settings-muted" style={{ fontWeight: 'normal', fontSize: '14px', marginLeft: '8px' }}>
                (filtered to answer “{selectedAnswerValue}”)
              </span>
            )}
          </h3>
          {surveyReport?.questions?.length ? (
            <div
              className="settings-survey-report"
              key={`report-${surveySlug}-${selectedQuestionId}-${selectedAnswerValue}`}
            >
              {surveyReport.questions.map((q) => (
                <div key={q.questionKey} className="settings-survey-report-item">
                  <strong className="settings-survey-report-question">{q.questionText}</strong>
                  {q.type === 'scale' && (() => {
                    const scaleQ = q as SurveyReportQuestionScale;
                    const distribution = scaleQ.stats.distribution || {};
                    const scaleKeys = Object.keys(distribution).map(Number).filter((n) => !isNaN(n));
                    const maxScale = 5; // Scale is always 1-5
                    const avg = scaleQ.stats.average;
                    const pct = avg != null ? ((avg / maxScale) * 100).toFixed(0) : null;
                    return (
                      <div className="settings-survey-report-stats">
                        <span>
                          Average:{' '}
                          <strong>
                            {pct != null ? `${pct}%` : '—'}
                          </strong>
                        </span>
                        <span>
                          Total responses:{' '}
                          <strong>
                            {scaleQ.stats.totalResponses ?? 0}
                          </strong>
                        </span>
                        {scaleKeys.length > 0 && (
                          <span className="settings-muted">
                            Distribution:{' '}
                            {Object.entries(distribution)
                              .sort((a, b) => Number(a[0]) - Number(b[0]))
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(', ')}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {(q.type === 'image_choice' ||
                    q.type === 'radio' ||
                    q.type === 'dropdown') && (
                    <div className="settings-survey-report-stats">
                      <span>
                        Total responses:{' '}
                        <strong>
                          {(q as SurveyReportQuestionChoice).stats.totalResponses ?? 0}
                        </strong>
                      </span>
                      {(q as SurveyReportQuestionChoice).stats.counts &&
                        Object.keys((q as SurveyReportQuestionChoice).stats.counts).length > 0 && (
                          <ul className="settings-survey-report-counts">
                            {Object.entries(
                              (q as SurveyReportQuestionChoice).stats.counts
                            )
                              .sort((a, b) => b[1] - a[1])
                              .map(([label, count]) => (
                                <li key={label}>
                                  <strong>{label}:</strong> {count}
                                </li>
                              ))}
                          </ul>
                        )}
                    </div>
                  )}
                  {(q.type === 'textarea' || q.type === 'textbox') && (() => {
                    const textQ = q as SurveyReportQuestionText;
                    const entries =
                      textQ.stats?.counts &&
                      Object.keys(textQ.stats.counts).length > 0
                        ? Object.entries(textQ.stats.counts).sort((a, b) => b[1] - a[1])
                        : [];
                    const showCount = 5;
                    const visible = entries.slice(0, showCount);
                    const hasMore = entries.length > showCount;
                    return (
                      <div className="settings-survey-report-stats settings-survey-report-text">
                        <span>
                          Total responses:{' '}
                          <strong>
                            {textQ.stats?.totalResponses ?? 0}
                          </strong>
                        </span>
                        {entries.length > 0 && (
                          <>
                            <ul className="settings-survey-report-text-responses">
                              {visible.map(([text, count]) => (
                                <li key={text || '(empty)'} className="settings-survey-report-text-item">
                                  <span className="settings-survey-report-text-value">
                                    {text.trim() || '(no response)'}
                                  </span>
                                  {count > 1 && (
                                    <span className="settings-muted"> (×{count})</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                            {hasMore && (
                              <button
                                type="button"
                                className="btn secondary settings-survey-view-all-text"
                                onClick={() =>
                                  setTextResponsesModal({
                                    questionText: textQ.questionText,
                                    entries,
                                  })
                                }
                              >
                                View all ({entries.length} responses)
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-muted">No report data for this date range.</p>
          )}

          <h3 className="settings-card-title" style={{ marginTop: '28px', marginBottom: '12px' }}>
            Responses
          </h3>
          {allSurveyResponses.length > 0 ? (
            <div className="settings-table-container">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Submitted</th>
                    <th>Appointment ID</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allSurveyResponses.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{formatSurveyDate(r.submittedAt)}</td>
                      <td>{r.appointmentId ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setSurveyDetailId(r.id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="settings-muted">No responses in this date range.</p>
          )}
        </>
      )}

      {surveyDetailId != null && (
        <div
          className="settings-modal-overlay"
          onClick={() => setSurveyDetailId(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Response detail"
        >
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>Response #{surveyDetailId}</h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={() => setSurveyDetailId(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body">
              {surveyDetailLoading ? (
                <p className="settings-muted">Loading…</p>
              ) : surveyDetail ? (
                <>
                  <p className="settings-muted" style={{ marginBottom: '16px' }}>
                    Submitted: {formatSurveyDate(surveyDetail.submittedAt)}
                    {surveyDetail.appointmentId != null &&
                      ` · Appointment: ${surveyDetail.appointmentId}`}
                  </p>
                  <div className="settings-survey-detail-answers">
                    {surveyDetail.answers.map((a) => (
                      <div key={a.questionKey} className="settings-survey-detail-answer">
                        <div className="settings-survey-detail-question">{a.questionText}</div>
                        <div className="settings-survey-detail-value">{a.value}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="settings-muted">Could not load response.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {textResponsesModal != null && (
        <div
          className="settings-modal-overlay"
          onClick={() => setTextResponsesModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label="All text responses"
        >
          <div className="settings-modal settings-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-header">
              <h3>All responses</h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={() => setTextResponsesModal(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body">
              <p className="settings-survey-modal-question">{textResponsesModal.questionText}</p>
              <ul className="settings-survey-report-text-responses settings-survey-modal-list">
                {textResponsesModal.entries.map(([text, count]) => (
                  <li key={text || '(empty)'} className="settings-survey-report-text-item">
                    <span className="settings-survey-report-text-value">
                      {text.trim() || '(no response)'}
                    </span>
                    {count > 1 && (
                      <span className="settings-muted"> (×{count})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
