// src/pages/SurveyResults.tsx – Post-appointment survey results (same UI as previously in Settings)
import { useState, useEffect, useMemo } from 'react';
import {
  listSurveyResponses,
  getSurveyResponse,
  getSurveyReportSummary,
  type SurveyResponseListItem,
  type SurveyResponseDetail,
  type SurveyReportSummary,
  type SurveyReportQuestionScale,
  type SurveyReportQuestionChoice,
  type SurveyReportQuestionText,
} from '../api/survey';
import { fetchAllEmployees, type Employee } from '../api/appointmentSettings';
import './Settings.css';

const SURVEY_SLUG = 'post-appointment';

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

function formatDoctorName(emp: Employee): string {
  const parts: string[] = [];
  if (emp.title) parts.push(emp.title);
  if (emp.firstName) parts.push(emp.firstName);
  if (emp.lastName) parts.push(emp.lastName);
  if (emp.designation) parts.push(emp.designation);
  return parts.length > 0
    ? parts.join(' ')
    : `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || `Employee ${emp.id}`;
}

const ALL_DOCTORS_VALUE = '';

export default function SurveyResults() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [surveyFrom, setSurveyFrom] = useState(() =>
    surveyDateFrom(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
  );
  const [surveyTo, setSurveyTo] = useState(() => surveyDateTo(new Date()));
  /** '' = All Doctors, number = specific employee id */
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(ALL_DOCTORS_VALUE);
  const [surveyReport, setSurveyReport] = useState<SurveyReportSummary | null>(null);
  const [surveyResponses, setSurveyResponses] = useState<SurveyResponseListItem[]>([]);
  const [surveyDetailId, setSurveyDetailId] = useState<number | null>(null);
  const [surveyDetail, setSurveyDetail] = useState<SurveyResponseDetail | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [surveyDetailLoading, setSurveyDetailLoading] = useState(false);
  /** Modal showing all text responses for a question (when there are more than 5). */
  const [textResponsesModal, setTextResponsesModal] = useState<{
    questionText: string;
    entries: [string, number][];
  } | null>(null);

  const doctors = useMemo(() => {
    return [...employees]
      .filter((e) => e.isProvider === true)
      .sort((a, b) => formatDoctorName(a).localeCompare(formatDoctorName(b)));
  }, [employees]);

  const employeeIdParam =
    selectedDoctorId === ALL_DOCTORS_VALUE ? undefined : Number(selectedDoctorId);

  useEffect(() => {
    let alive = true;
    fetchAllEmployees()
      .then((list) => {
        if (!alive) return;
        setEmployees(list);
      })
      .catch(() => {
        if (!alive) return;
        setEmployees([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!surveyFrom || !surveyTo) return;
    let alive = true;
    setSurveyLoading(true);
    const reportParams = {
      surveySlug: SURVEY_SLUG,
      from: surveyFrom,
      to: surveyTo,
      ...(employeeIdParam != null && { employeeId: employeeIdParam }),
    };
    const listParams = {
      surveySlug: SURVEY_SLUG,
      from: surveyFrom,
      to: surveyTo,
      page: 1,
      limit: 50,
      ...(employeeIdParam != null && { employeeId: employeeIdParam }),
    };
    Promise.all([
      getSurveyReportSummary(reportParams),
      listSurveyResponses(listParams),
    ])
      .then(([report, list]) => {
        if (!alive) return;
        setSurveyReport(report);
        setSurveyResponses(list.items);
      })
      .catch(() => {
        if (!alive) return;
        setSurveyReport(null);
        setSurveyResponses([]);
      })
      .finally(() => {
        if (!alive) return;
        setSurveyLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [surveyFrom, surveyTo, employeeIdParam]);

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
        View per-question summary and individual responses for the post-appointment survey. Filter
        by date range and doctor.
      </p>

      <div
        className="settings-form-group"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}
      >
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
          Doctor
          <select
            className="settings-input"
            value={selectedDoctorId}
            onChange={(e) => setSelectedDoctorId(e.target.value)}
            style={{ width: '200px', minHeight: '34px' }}
          >
            <option value={ALL_DOCTORS_VALUE}>All Doctors</option>
            {doctors.map((emp) => (
              <option key={emp.id} value={String(emp.id)}>
                {formatDoctorName(emp)}
              </option>
            ))}
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
          </h3>
          {surveyReport?.questions?.length ? (
            <div className="settings-survey-report">
              {surveyReport.questions.map((q) => (
                <div key={q.questionKey} className="settings-survey-report-item">
                  <strong className="settings-survey-report-question">{q.questionText}</strong>
                  {q.type === 'scale' && (
                    <div className="settings-survey-report-stats">
                      <span>
                        Average:{' '}
                        <strong>
                          {(q as SurveyReportQuestionScale).stats.average?.toFixed(2) ?? '—'}
                        </strong>
                      </span>
                      <span>
                        Total responses:{' '}
                        <strong>
                          {(q as SurveyReportQuestionScale).stats.totalResponses ?? 0}
                        </strong>
                      </span>
                      {(q as SurveyReportQuestionScale).stats.distribution &&
                        Object.keys((q as SurveyReportQuestionScale).stats.distribution).length >
                          0 && (
                          <span className="settings-muted">
                            Distribution:{' '}
                            {Object.entries(
                              (q as SurveyReportQuestionScale).stats.distribution
                            )
                              .sort((a, b) => Number(a[0]) - Number(b[0]))
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(', ')}
                          </span>
                        )}
                    </div>
                  )}
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
          {surveyResponses.length > 0 ? (
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
                  {surveyResponses.map((r) => (
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
