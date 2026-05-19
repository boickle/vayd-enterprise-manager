import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, ChevronDown, X } from 'lucide-react';
import './PimsExamDetailModal.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function employeeName(e: unknown): string {
  const o = asObj(e);
  if (!o) return '—';
  const fn = pickStr(o.firstName);
  const ln = pickStr(o.lastName);
  const joined = [fn, ln].filter(Boolean).join(' ').trim();
  return joined || pickStr(o.name) || '—';
}

function employeeInitials(e: unknown): string {
  const o = asObj(e);
  if (!o) return '—';
  const fn = (pickStr(o.firstName) ?? '').charAt(0);
  const ln = (pickStr(o.lastName) ?? '').charAt(0);
  const s = `${fn}${ln}`.toUpperCase();
  return s || '—';
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isNormalSelection(sel: string | null): boolean {
  if (!sel) return false;
  const s = sel.toLowerCase();
  return (
    s.includes('normal') ||
    s.includes('wnl') ||
    s.includes('ideal') ||
    s === 'yes' ||
    s.includes('normal condition')
  );
}

function isNotEvaluated(sel: string | null): boolean {
  if (!sel) return false;
  const s = sel.toLowerCase();
  return s.includes('not eval') || s.includes('n/e') || s === 'ne';
}

type WeightPoint = { examId: number | string | null; serviceDate: string; weight: number; weightUnitValue?: number; isWeightEstimate?: boolean };

function parseWeightHistory(raw: unknown[]): WeightPoint[] {
  const out: WeightPoint[] = [];
  for (const row of raw) {
    const o = asObj(row);
    if (!o) continue;
    const w = Number(o.weight);
    const sd = pickStr(o.serviceDate);
    if (!sd || !Number.isFinite(w)) continue;
    out.push({
      examId: o.examId != null ? (typeof o.examId === 'number' ? o.examId : String(o.examId)) : null,
      serviceDate: sd,
      weight: w,
      weightUnitValue: typeof o.weightUnitValue === 'number' ? o.weightUnitValue : undefined,
      isWeightEstimate: o.isWeightEstimate === true,
    });
  }
  out.sort((a, b) => Date.parse(a.serviceDate) - Date.parse(b.serviceDate));
  return out;
}

type Props = {
  exam: Record<string, unknown>;
  weightHistory: unknown[];
  patientAgeLabel: string | null;
  patientWeightDisplay: string | null;
  onClose: () => void;
};

export function PimsExamDetailModal({
  exam,
  weightHistory,
  patientAgeLabel,
  patientWeightDisplay,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const formName = pickStr(exam.formName) ?? 'Exam';
  const serviceDate = pickStr(exam.serviceDate);
  const comments = pickStr(exam.comments);
  const vital = asObj(exam.vitalSign);
  const responses = Array.isArray(exam.responses) ? (exam.responses as unknown[]) : [];
  const examId = exam.id != null ? String(exam.id) : '';

  const points = parseWeightHistory(weightHistory);
  const trendRows = points.map((p, i) => {
    const prev = i > 0 ? points[i - 1].weight : null;
    let trend: 'up' | 'down' | 'same' | null = null;
    if (prev != null && Number.isFinite(prev)) {
      if (p.weight > prev) trend = 'up';
      else if (p.weight < prev) trend = 'down';
      else trend = 'same';
    }
    return { ...p, trend, idx: i };
  });

  const vitalsWeight = vital ? Number(vital.weight) : NaN;
  const vitalsWeightLabel =
    Number.isFinite(vitalsWeight) && vital ? `${vitalsWeight}${pickStr(vital.weightUnit) ? ` ${pickStr(vital.weightUnit)}` : ''}` : null;

  const bodyConditionResponse = responses
    .map((r) => asObj(r))
    .find((ro) => ro && /body\s*condition/i.test(pickStr(ro.componentName) ?? ''));

  const bodyConditionLabel = bodyConditionResponse
    ? pickStr(bodyConditionResponse.selectedOptions) ?? pickStr(bodyConditionResponse.comment)
    : null;

  const modal = (
    <div className="pims-exam-modal" role="dialog" aria-modal aria-labelledby="pims-exam-modal-title">
      <button type="button" className="pims-exam-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-exam-modal__card">
        <div className="pims-exam-modal__toolbar">
          <div className="pims-exam-modal__toolbar-icons">
            <button type="button" className="pims-exam-modal__icon-btn" title="Edit (not wired)" disabled>
              <Pencil size={16} aria-hidden />
            </button>
            <span className="pims-exam-modal__chev" aria-hidden>
              <ChevronDown size={18} />
            </span>
          </div>
          <div className="pims-exam-modal__toolbar-main">
            <h2 id="pims-exam-modal-title" className="pims-exam-modal__title">
              {formName}
            </h2>
            <div className="pims-exam-modal__toolbar-meta">
              <span>
                <span className="pims-exam-modal__meta-k">Provider</span> {employeeName(exam.employee)}
                <span className="pims-exam-modal__meta-initials"> ({employeeInitials(exam.employee)})</span>
              </span>
              <span>
                <span className="pims-exam-modal__meta-k">Service date</span> {formatWhen(serviceDate)}
              </span>
            </div>
          </div>
          <button type="button" className="pims-exam-modal__icon-btn pims-exam-modal__icon-btn--danger" title="Delete (not wired)" disabled>
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="pims-exam-modal__scroll">
          {comments ? (
            <section className="pims-exam-modal__fieldset">
              <h3 className="pims-exam-modal__fieldset-legend">Summary</h3>
              <p className="pims-exam-modal__summary-text">{comments}</p>
            </section>
          ) : null}

          <section className="pims-exam-modal__fieldset">
            <h3 className="pims-exam-modal__fieldset-legend">Vital signs</h3>
            <div className="pims-exam-modal__vitals-grid">
              <div className="pims-exam-modal__vitals-left">
                {patientAgeLabel ? (
                  <p>
                    <strong>Patient age:</strong> {patientAgeLabel}
                  </p>
                ) : null}
                {vitalsWeightLabel ? (
                  <p>
                    <strong>Weight (this exam):</strong> {vitalsWeightLabel}
                  </p>
                ) : patientWeightDisplay ? (
                  <p>
                    <strong>Weight (profile):</strong> {patientWeightDisplay}
                  </p>
                ) : null}
                {bodyConditionLabel ? (
                  <p>
                    <strong>Body condition:</strong> {bodyConditionLabel}
                  </p>
                ) : null}
                {vital && (
                  <dl className="pims-exam-modal__vitals-dl">
                    {vital.temperature != null ? (
                      <>
                        <dt>Temperature</dt>
                        <dd>{String(vital.temperature)}</dd>
                      </>
                    ) : null}
                    {vital.heartRate != null ? (
                      <>
                        <dt>Heart rate</dt>
                        <dd>{String(vital.heartRate)}</dd>
                      </>
                    ) : null}
                    {vital.respiratoryRate != null ? (
                      <>
                        <dt>Respiratory rate</dt>
                        <dd>{String(vital.respiratoryRate)}</dd>
                      </>
                    ) : null}
                  </dl>
                )}
              </div>
              <div className="pims-exam-modal__vitals-right">
                <h4 className="pims-exam-modal__trend-title">Weight trend</h4>
                {trendRows.length === 0 ? (
                  <p className="pims-exam-modal__muted">No weight history points on this chart.</p>
                ) : (
                  <table className="pims-exam-modal__trend-table">
                    <thead>
                      <tr>
                        <th>Exam</th>
                        <th>Date</th>
                        <th>Trend</th>
                        <th>Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendRows.map((row) => (
                        <tr key={`${row.serviceDate}-${row.idx}`}>
                          <td>{row.examId != null && String(row.examId) === examId ? formName : 'Exam'}</td>
                          <td>{formatWhen(row.serviceDate)}</td>
                          <td className="pims-exam-modal__trend-cell">
                            {row.trend === 'up' && <span className="pims-exam-modal__trend-up" title="Up" />}
                            {row.trend === 'down' && <span className="pims-exam-modal__trend-down" title="Down" />}
                            {row.trend === 'same' && <span className="pims-exam-modal__trend-flat">—</span>}
                            {!row.trend && '—'}
                          </td>
                          <td>
                            {row.weight}
                            {row.isWeightEstimate ? <span className="pims-exam-modal__estimate"> (estimate)</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>

          <section className="pims-exam-modal__fieldset">
            <h3 className="pims-exam-modal__fieldset-legend">Exam responses</h3>
            {responses.length === 0 ? (
              <p className="pims-exam-modal__muted">No structured responses on this exam.</p>
            ) : (
              <div className="pims-exam-modal__responses">
                {responses.map((raw, idx) => {
                  const ro = asObj(raw);
                  if (!ro) return null;
                  const cn = pickStr(ro.componentName) ?? 'Field';
                  const sel = pickStr(ro.selectedOptions);
                  const cm = pickStr(ro.comment);
                  const normal = isNormalSelection(sel);
                  const ne = isNotEvaluated(sel);
                  return (
                    <div key={String(ro.id ?? ro.pimsId ?? idx)} className="pims-exam-modal__response-block">
                      <div className="pims-exam-modal__response-head">
                        <span className="pims-exam-modal__response-label">{cn}</span>
                        {normal && <span className="pims-exam-modal__badge-normal">Normal condition</span>}
                        {ne && !normal && <span className="pims-exam-modal__badge-ne">Not evaluated</span>}
                      </div>
                      {sel && !normal && !ne ? <div className="pims-exam-modal__response-sel">{sel}</div> : null}
                      {sel && normal ? <div className="pims-exam-modal__response-sel-muted">{sel}</div> : null}
                      {cm ? (
                        <p className="pims-exam-modal__response-comments">
                          <strong>Comments:</strong> {cm}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="pims-exam-modal__footer">
          <button type="button" className="pims-exam-modal__close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
