import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { searchPatientsStaff, type PatientSearchRow } from '../../api/patients';
import { clientsForPatientSearchRow } from '../../utils/pimsPatientSearchRow';
import { DEFAULT_PRACTICE_TIMEZONE } from '../../utils/practiceTimezone';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import ScheduleFollowUpsPlanner from './ScheduleFollowUpsPlanner';
import { plannerVisitForClient } from './plannerData';
import './ScheduleFollowUpsPlanner.css';

type Pick = { clientId: number; clientName: string };

function petName(row: PatientSearchRow): string {
  return (
    String(row.name ?? '').trim() ||
    [row.firstName, row.lastName].filter(Boolean).join(' ').trim() ||
    `Patient ${row.id}`
  );
}

/**
 * Left-nav "+ Forward Booking": find a pet or owner, then open Schedule follow-ups for
 * that household. There is no visit being wrapped up, so every pet is optional.
 */
export default function ScheduleFollowUpsLauncher({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  /** After Done saved anything, so lists can refresh. */
  onSaved?: () => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<PatientSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Pick | null>(null);
  const practiceId = currentPracticeId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRows([]);
      return;
    }
    let on = true;
    setSearching(true);
    const t = window.setTimeout(() => {
      searchPatientsStaff(q, { practiceId, activeOnly: true })
        .then((r) => on && setRows(r.slice(0, 12)))
        .catch(() => on && setRows([]))
        .finally(() => on && setSearching(false));
    }, 250);
    return () => {
      on = false;
      window.clearTimeout(t);
    };
  }, [query, practiceId]);

  const options = useMemo(
    () =>
      rows.flatMap((row) => {
        const owner = clientsForPatientSearchRow(row)[0];
        const id = Number(owner?.id);
        if (!owner || !Number.isFinite(id)) return [];
        return [
          { key: `${row.id}:${id}`, pet: petName(row), clientId: id, clientName: owner.name },
        ];
      }),
    [rows]
  );

  const visit = useMemo(
    () => (picked ? plannerVisitForClient(picked.clientId, picked.clientName) : null),
    [picked]
  );

  if (picked && visit) {
    return (
      <ScheduleFollowUpsPlanner
        open
        visit={visit}
        practiceId={practiceId}
        tz={DEFAULT_PRACTICE_TIMEZONE}
        onClose={onClose}
        onSaved={() => onSaved?.()}
      />
    );
  }

  return createPortal(
    <div className="fup-root">
      <button type="button" className="fup-overlay" aria-label="Close" onClick={onClose} />
      <section
        className="fup-confirm__card fup-launcher"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
      >
        <h3 id={`${inputId}-title`}>Schedule follow-ups</h3>
        <label htmlFor={inputId} className="fup-muted">
          Find a pet or owner. You will see the whole household.
        </label>
        <input
          id={inputId}
          className="fup-input"
          value={query}
          placeholder="e.g. Fluffy or Okafor"
          ref={(el) => el?.focus()}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="fup-launcher__list" aria-live="polite">
          {query.trim().length >= 2 && !searching && options.length === 0 ? (
            <li className="fup-muted">No match for “{query.trim()}”</li>
          ) : null}
          {options.map((o) => (
            <li key={o.key}>
              <button
                type="button"
                onClick={() => setPicked({ clientId: o.clientId, clientName: o.clientName })}
              >
                <b>{o.pet}</b> <span className="fup-muted">· {o.clientName}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="fup-actions fup-actions--end">
          <button type="button" className="fup-btn fup-btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
