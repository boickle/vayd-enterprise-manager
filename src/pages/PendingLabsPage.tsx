import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { AlertTriangle, Check, Clock, FlaskConical, X } from 'lucide-react';
import {
  isLabValueAbnormal,
  listPendingLabResults,
  resultedByLabel,
  type LabResult,
} from '../api/inHouseLabs';
import LabResultForm from '../components/labs/LabResultForm';
import '../components/labs/LabResultsPanel.css';
import './PendingLabsPage.css';

type Filter = 'pending' | 'recent';

function dayLabel(raw: string | null): string {
  if (!raw) return 'No date';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'No date';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function abnormalCount(result: LabResult): number {
  if (result.templateMode === 'summary') return 0;
  return (result.elementsSnapshot ?? []).filter((el) =>
    isLabValueAbnormal(el, result.values?.[el.key]?.value)
  ).length;
}

/**
 * Everything ordered in-house that still needs running.
 *
 * Deliberately practice-wide and not tied to a visit: a snap test ordered
 * yesterday afternoon is usually run by whoever is in the building today.
 */
export default function PendingLabsPage() {
  const [rows, setRows] = useState<LabResult[]>([]);
  const [filter, setFilter] = useState<Filter>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<LabResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listPendingLabResults());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the in-house lab worklist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The worklist returns both states, so "recent" lets whoever ran a lab
  // double-check what they just saved without going chart by chart.
  const pending = useMemo(() => rows.filter((r) => r.status === 'pending'), [rows]);
  const recent = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'complete')
        .sort((a, b) => String(b.resultedAt ?? '').localeCompare(String(a.resultedAt ?? ''))),
    [rows]
  );

  const shown = filter === 'pending' ? pending : recent;

  const grouped = useMemo(() => {
    const map = new Map<string, LabResult[]>();
    for (const r of shown) {
      const key = dayLabel(r.serviceDate);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()];
  }, [shown]);

  return (
    <div className="pending-labs">
      <header className="pending-labs__head">
        <h1 className="pending-labs__title">
          <FlaskConical size={20} aria-hidden /> In-house labs
        </h1>
        <div className="pending-labs__tabs" role="tablist" aria-label="Lab worklist filter">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'pending'}
            className={filter === 'pending' ? 'is-active' : undefined}
            onClick={() => setFilter('pending')}
          >
            Waiting to run{pending.length ? ` (${pending.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'recent'}
            className={filter === 'recent' ? 'is-active' : undefined}
            onClick={() => setFilter('recent')}
          >
            Recently resulted
          </button>
        </div>
      </header>

      {error ? (
        <p className="lab-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="lab-panel__muted">Loading…</p>
      ) : !shown.length ? (
        <p className="pending-labs__empty">
          {filter === 'pending'
            ? 'Nothing waiting — every in-house lab that was ordered has been run.'
            : 'Nothing resulted yet.'}
        </p>
      ) : (
        grouped.map(([day, group]) => (
          <section key={day} className="pending-labs__group">
            <h2 className="pending-labs__day">{day}</h2>
            <ul className="lab-panel__list">
              {group.map((r) => {
                const flagged = abnormalCount(r);
                return (
                  <li key={r.id}>
                    <div className="pending-labs__row">
                      <button
                        type="button"
                        className="lab-panel__row pending-labs__row-btn"
                        onClick={() => setOpen(r)}
                      >
                        <span className="lab-panel__row-main">
                          <span className="lab-panel__row-name">
                            {r.patient?.name ? `${r.patient.name} — ` : ''}
                            {r.templateName}
                          </span>
                          <span className="lab-panel__row-meta">
                            {/* Once it is run, who ran it matters more than where it was ordered. */}
                            {resultedByLabel(r) || r.lab?.name || 'Entered by hand'}
                          </span>
                        </span>
                        {r.status === 'pending' ? (
                          <span className="lab-panel__tag lab-panel__tag--pending">
                            <Clock size={12} aria-hidden /> Not run
                          </span>
                        ) : flagged ? (
                          <span className="lab-panel__tag lab-panel__tag--flag">
                            <AlertTriangle size={12} aria-hidden /> {flagged} abnormal
                          </span>
                        ) : (
                          <span className="lab-panel__tag lab-panel__tag--ok">
                            <Check size={12} aria-hidden /> Normal
                          </span>
                        )}
                      </button>
                      <Link
                        className="pending-labs__chart-link"
                        to={`/schedule/patients?patientId=${r.patientId}`}
                      >
                        Chart
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {open
        ? createPortal(
            <div
              className="lab-panel__overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`${open.templateName} results`}
            >
              <div className="lab-panel__sheet">
                <div className="lab-panel__sheet-head">
                  <h3>
                    {open.patient?.name ? `${open.patient.name} — ` : ''}
                    lab results
                  </h3>
                  <button type="button" aria-label="Close" onClick={() => setOpen(null)}>
                    <X size={16} aria-hidden />
                  </button>
                </div>
                <LabResultForm
                  result={open}
                  onCancel={() => setOpen(null)}
                  onSaved={() => {
                    setOpen(null);
                    void load();
                  }}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
