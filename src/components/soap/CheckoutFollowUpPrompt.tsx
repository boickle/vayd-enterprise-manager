import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CalendarClock, CalendarPlus, Check } from 'lucide-react';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { listPracticeBranches } from '../../api/branchInventory';
import type { ForwardBookingDisposition } from '../../api/forwardBookingDisposition';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';
import {
  forwardBookingDispositionIsComplete,
  forwardBookingFormStateFromDisposition,
  forwardBookingFormStateIsComplete,
  type ForwardBookingDispositionFormState,
} from '../../utils/forwardBookingDisposition';
import { toDatetimeLocalValue } from '../../utils/taskDateTime';
import ForwardBookingDecisionFields, {
  forwardBookingModeOption,
} from '../forwardBooking/ForwardBookingDecisionFields';
import { saveForwardBookingDecision } from '../forwardBooking/saveForwardBookingDecision';
import { reconcileBookedFollowUp, startFollowUpBooking } from '../forwardBooking/bookFollowUpNow';

const LABS_TASK_TITLE_DEFAULT = 'Review labs and set follow-up timing';

type Props = {
  appointmentId: number;
  patientId: number;
  patientName?: string | null;
  clientId: number | null;
  soapEncounterId: string | null;
  providerId: number | null;
  disposition: ForwardBookingDisposition | null;
  /** Queue row this visit created, so a follow-up booked through "Book it now"
   * can be recognised on the way back. */
  forwardBookingEntryId: number | null;
  disabled?: boolean;
  /** Where Routing returns to after "Book it now". */
  returnTo: string;
  onSaved: (disposition: ForwardBookingDisposition) => void;
};

/**
 * The follow-up question at checkout — the same prompt End Visit asks, in the one
 * place where the client is reliably still standing there.
 *
 * Checkout deliberately runs before the doctor has finished the chart, so this is
 * the last moment anyone can say "do you want the recheck on the books now, or
 * should our scheduler call you?" out loud. Whatever is recorded here satisfies the
 * wrap-up's gate; if checkout skips it, the doctor still cannot complete the record
 * without answering.
 */
export default function CheckoutFollowUpPrompt({
  appointmentId,
  patientId,
  patientName,
  clientId,
  soapEncounterId,
  providerId,
  disposition,
  forwardBookingEntryId,
  disabled,
  returnTo,
  onSaved,
}: Props) {
  const navigate = useNavigate();
  const [form, setForm] = useState<ForwardBookingDispositionFormState>(() =>
    forwardBookingFormStateFromDisposition(disposition, {
      labsTaskTitle: LABS_TASK_TITLE_DEFAULT,
      labsTaskStartLocal: toDatetimeLocalValue(new Date().toISOString()),
    })
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);
  /** One reconcile attempt per mount, so re-renders can't fire duplicate patches. */
  const reconciledRef = useRef(false);

  const settled = forwardBookingDispositionIsComplete(disposition);
  const complete = forwardBookingFormStateIsComplete(form);

  /** Coming back from "Book it now" with a visit on the calendar, the choice is no
   * longer "add to the list" — it's booked. */
  useEffect(() => {
    if (disposition?.mode !== 'forward_book_fields') return;
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    let on = true;
    void reconcileBookedFollowUp(
      { appointmentId, patientId, clientId, soapEncounterId },
      forwardBookingEntryId,
      { practiceId: VISIT_WORKFLOW_PRACTICE_ID, currentMode: disposition.mode }
    )
      .then((changed) => {
        if (changed && on) onSaved({ mode: 'booked_at_appointment' });
      })
      .catch(() => {
        /* the queue row is still correct; leave the disposition alone */
      });
    return () => {
      on = false;
    };
  }, [
    appointmentId,
    clientId,
    disposition?.mode,
    forwardBookingEntryId,
    onSaved,
    patientId,
    soapEncounterId,
  ]);

  // Two extra requests that only "Labs pending" needs, so they wait until it's picked.
  useEffect(() => {
    if (form.mode !== 'labs_pending' || employees.length > 0) return;
    let on = true;
    setMetaLoading(true);
    void (async () => {
      try {
        const [branchList, employeeList] = await Promise.all([
          listPracticeBranches(VISIT_WORKFLOW_PRACTICE_ID),
          fetchAllEmployees(),
        ]);
        if (!on) return;
        setBranchIds(
          (Array.isArray(branchList) ? branchList : [])
            .filter((b) => b.isActive !== false)
            .map((b) => b.id)
        );
        setEmployees(Array.isArray(employeeList) ? employeeList : []);
      } catch {
        if (!on) return;
        setBranchIds([]);
        setEmployees([]);
      } finally {
        if (on) setMetaLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [form.mode, employees.length]);

  const save = useCallback(async () => {
    if (saving) return null;
    setSaving(true);
    setError(null);
    try {
      const result = await saveForwardBookingDecision(
        {
          appointmentId,
          patientId,
          patientName,
          clientId,
          soapEncounterId,
          providerId,
        },
        form,
        {
          practiceId: VISIT_WORKFLOW_PRACTICE_ID,
          branchIds,
          labsTaskTitleFallback: LABS_TASK_TITLE_DEFAULT,
        }
      );
      onSaved(result.disposition);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the follow-up choice');
      return null;
    } finally {
      setSaving(false);
    }
  }, [
    appointmentId,
    branchIds,
    clientId,
    form,
    onSaved,
    patientId,
    patientName,
    providerId,
    saving,
    soapEncounterId,
  ]);

  const bookNow = useCallback(async () => {
    const result = await save();
    if (!result?.entry) return;
    if (!startFollowUpBooking([result.entry], returnTo)) {
      setError(
        'Saved to the forward booking list, but this visit is missing the client or interval details Routing needs.'
      );
      return;
    }
    navigate('/schedule/routing');
  }, [navigate, returnTo, save]);

  /* Settled is final: the follow-up choice is what was agreed with the client standing
     there, so there is no "Change" here or anywhere else. */
  if (settled) {
    return (
      <div className="soap-checkout-followup">
        <div className="soap-checkout-followup-head">
          <CalendarClock size={15} />
          <span>Follow-up</span>
        </div>
        <div className="soap-checkout-followup-saved">
          <Check size={13} /> {summarize(disposition)}
        </div>
        <p className="soap-hint">Saved for this visit — this choice cannot be changed.</p>
      </div>
    );
  }

  return (
    <div className="soap-checkout-followup">
      <div className="soap-checkout-followup-head">
        <CalendarClock size={15} />
        <span>Follow-up{patientName ? ` — ${patientName}` : ''}</span>
      </div>
      <p className="soap-hint">
        Ask before the client leaves. Required to complete the record either way.
      </p>

      <ForwardBookingDecisionFields
        radioGroupName={`checkout-forward-booking-${patientId}`}
        value={form}
        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        disabled={disabled || saving}
        metaLoading={metaLoading}
        employees={employees}
      />

      {error && <div className="soap-error">{error}</div>}

      {!disabled && (
        <div className="soap-checkout-followup-actions">
          <button
            type="button"
            className="soap-btn"
            disabled={!complete || saving}
            onClick={() => void save()}
          >
            <CalendarClock size={14} /> {saving ? 'Saving…' : 'Save follow-up'}
          </button>
          {form.mode === 'forward_book_fields' && (
            <button
              type="button"
              className="soap-btn primary"
              disabled={!complete || saving}
              title="Save this, then find a slot and book it now"
              onClick={() => void bookNow()}
            >
              <CalendarPlus size={14} /> Book it now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function summarize(disposition: ForwardBookingDisposition | null): string {
  if (!disposition?.mode) return '';
  const label = forwardBookingModeOption(disposition.mode)?.label ?? disposition.mode;
  if (
    disposition.mode === 'forward_book_fields' &&
    disposition.intervalAmount &&
    disposition.intervalUnit
  ) {
    return `${label} — ${disposition.intervalAmount} ${disposition.intervalUnit}`;
  }
  return label;
}
