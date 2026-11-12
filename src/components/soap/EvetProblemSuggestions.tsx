import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, X as XIcon } from 'lucide-react';
import {
  acceptEvetProblemSuggestion,
  dismissEvetProblemSuggestion,
  listEvetProblemSuggestions,
  type EvetProblemSuggestion,
  type PatientProblem,
} from '../../api/visitWorkflow';
import './EvetProblemSuggestions.css';

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "Mar 2025" */
function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * "From eVet: Hyperthyroidism (Dr. Ada Quill, Mar 2025)" or
 * "From eVet master problems: Iris Stage 2 … (Onset, Sep 2024)".
 */
export function evetSuggestionText(s: EvetProblemSuggestion): string {
  const when = monthYear(s.date);
  const detail =
    s.source === 'master_problem'
      ? [s.statusLabel, when].filter(Boolean).join(', ')
      : [s.doctorName, when].filter(Boolean).join(', ');
  const prefix = s.source === 'master_problem' ? 'From eVet master problems' : 'From eVet';
  return `${prefix}: ${s.label}${detail ? ` (${detail})` : ''}`;
}

type Props = {
  patientId: number;
  /** The pet's current problems: a name already on the list is never shown. */
  problems: PatientProblem[];
  /** Set on the SOAP so an accepted problem records the visit it was accepted on. */
  encounterId?: string | null;
  disabled?: boolean;
  onAccepted: (problem: PatientProblem) => void;
  /** Extra class for where the cards sit (SOAP box or chart header). */
  className?: string;
};

/**
 * Active eVet diagnoses and eVet master problems not yet on the pet's problem list, offered as
 * chronic problems (owner decision Nov 4, 2026). Styled like the AI Scribe suggestion cards.
 * Accept adds a Chronic, Active problem (switch to Acute in the problem list); X dismisses it for
 * good. Ignoring a card is fine: it stays until someone decides. Staff only — the endpoint is
 * refused for client logins, and the cards hide when it fails.
 */
export default function EvetProblemSuggestions({
  patientId,
  problems,
  encounterId,
  disabled,
  onAccepted,
  className,
}: Props) {
  const [rows, setRows] = useState<EvetProblemSuggestion[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let canceled = false;
    listEvetProblemSuggestions(patientId)
      .then((list) => {
        if (!canceled) setRows(list);
      })
      .catch(() => {
        if (!canceled) setRows([]);
      });
    return () => {
      canceled = true;
    };
  }, [patientId]);

  useEffect(() => load(), [load]);

  const onList = useMemo(() => new Set(problems.map((p) => normName(p.label))), [problems]);
  const visible = rows.filter((s) => !onList.has(normName(s.label)) && !onList.has(s.key));

  const decide = async (s: EvetProblemSuggestion, action: 'accept' | 'dismiss') => {
    if (busyKey) return;
    setBusyKey(s.key);
    setError(null);
    try {
      if (action === 'accept') {
        const created = await acceptEvetProblemSuggestion({
          patientId,
          key: s.key,
          ...(encounterId ? { createdInEncounterId: encounterId } : {}),
        });
        onAccepted(created);
      } else {
        await dismissEvetProblemSuggestion({ patientId, key: s.key });
      }
      setRows((prev) => prev.filter((r) => r.key !== s.key));
    } catch {
      setError('Could not save that. Try again.');
      load();
    } finally {
      setBusyKey(null);
    }
  };

  if (visible.length === 0) return null;

  return (
    <div
      className={['soap-scribe-suggestions', 'soap-evet-suggestions', className]
        .filter(Boolean)
        .join(' ')}
      aria-label="Suggestions from eVet"
      data-testid="evet-problem-suggestions"
    >
      {visible.map((s) => (
        <div className="soap-scribe-card soap-evet-suggestion" key={s.key}>
          <div className="soap-scribe-card-head">Suggested chronic problem</div>
          <div className="soap-evet-suggestion-text">{evetSuggestionText(s)}</div>
          {s.comments ? <div className="soap-evet-suggestion-comments">{s.comments}</div> : null}
          <div className="soap-scribe-card-actions">
            <button
              type="button"
              className="soap-btn small primary"
              disabled={disabled || busyKey != null}
              aria-label={`Accept ${s.label} as a chronic problem`}
              onClick={() => void decide(s, 'accept')}
            >
              <Check size={12} /> Accept
            </button>
            <button
              type="button"
              className="soap-btn small ghost"
              disabled={disabled || busyKey != null}
              title="Dismiss — don't suggest this again for this pet"
              aria-label={`Dismiss ${s.label}`}
              onClick={() => void decide(s, 'dismiss')}
            >
              <XIcon size={12} />
            </button>
          </div>
        </div>
      ))}
      {error ? <div className="soap-evet-suggestion-error">{error}</div> : null}
    </div>
  );
}
