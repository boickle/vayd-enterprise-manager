import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CalendarClock, CalendarPlus, Check } from 'lucide-react';
import type { ForwardBookingDisposition } from '../../api/forwardBookingDisposition';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { listPracticeBranches } from '../../api/branchInventory';
import type { VisitWrapUpPet } from '../../api/visitWrapUp';
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
import {
  saveForwardBookingDecision,
  type ForwardBookingDecisionResult,
} from '../forwardBooking/saveForwardBookingDecision';
import { startFollowUpBooking } from '../forwardBooking/bookFollowUpNow';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

const LABS_TASK_TITLE_DEFAULT = 'Review labs and set follow-up timing';

function defaultFormState(pet: VisitWrapUpPet): ForwardBookingDispositionFormState {
  return forwardBookingFormStateFromDisposition(pet.forwardBookingDisposition, {
    labsTaskTitle: LABS_TASK_TITLE_DEFAULT,
    labsTaskStartLocal: toDatetimeLocalValue(new Date().toISOString()),
  });
}

/** A settled choice is the record of what was agreed at the visit, so it is never re-edited. */
function isFollowUpSaved(pet: VisitWrapUpPet): boolean {
  return forwardBookingDispositionIsComplete(pet.forwardBookingDisposition);
}

/**
 * Build per-pet forms. When applying one choice to the remaining pets, copy a
 * complete sibling form (saved checkout choice first) onto unfinished pets so
 * Save does not persist empty interval fields.
 */
function seedForms(
  pets: VisitWrapUpPet[],
  prev?: Record<number, ForwardBookingDispositionFormState>,
  sameForRemaining = false
): Record<number, ForwardBookingDispositionFormState> {
  const next = Object.fromEntries(
    pets.map((p) => [p.patientId, prev?.[p.patientId] ?? defaultFormState(p)])
  ) as Record<number, ForwardBookingDispositionFormState>;
  if (!sameForRemaining) return next;

  const remaining = pets.filter((p) => !isFollowUpSaved(p));
  const saved = pets.find((p) => isFollowUpSaved(p));
  const source =
    remaining.map((p) => next[p.patientId]).find((f) => forwardBookingFormStateIsComplete(f)) ??
    (saved ? defaultFormState(saved) : null);
  if (!source) return next;
  for (const pet of remaining) {
    if (!forwardBookingFormStateIsComplete(next[pet.patientId])) {
      next[pet.patientId] = { ...source };
    }
  }
  return next;
}

type Props = {
  pets: VisitWrapUpPet[];
  clientId: number | null;
  providerId: number | null;
  disabled?: boolean;
  /** Where Routing should come back to after "Book it now". */
  returnTo: string;
  /** Refresh the wrap-up after a disposition lands so the gate re-evaluates. */
  onSaved: () => void | Promise<void>;
};

/**
 * Forward booking for the whole household, at the point in the visit where the
 * client is still standing there — the same requirement End Visit enforces on the
 * scheduler, but reachable from the SOAP flow (where AI Scribe mode previously had
 * no forward-booking UI at all despite completion requiring one).
 *
 * Unlike the old in-SOAP gate, this holds itself to
 * `forwardBookingFormStateIsComplete`: "Not appropriate" needs its reason and
 * "Labs pending" needs a real assignee and start date before it counts, so a
 * chart can't be closed on a disposition that says nothing.
 *
 * Each disposition is written to both the appointment and the encounter. Those are
 * two independent stores in this codebase and only the encounter one gates chart
 * completion, so writing one and not the other is how a visit ends up looking
 * booked on the calendar and unbooked in the chart.
 */
export default function WrapUpForwardBooking({
  pets,
  clientId,
  providerId,
  disabled,
  returnTo,
  onSaved,
}: Props) {
  const navigate = useNavigate();
  const remainingPets = useMemo(() => pets.filter((p) => !isFollowUpSaved(p)), [pets]);
  const savedPets = useMemo(() => pets.filter((p) => isFollowUpSaved(p)), [pets]);

  const [forms, setForms] = useState<Record<number, ForwardBookingDispositionFormState>>(() =>
    seedForms(pets, undefined, pets.filter((p) => !isFollowUpSaved(p)).length > 1)
  );
  const [sameForAll, setSameForAll] = useState(remainingPets.length > 1);
  const [savingPatientId, setSavingPatientId] = useState<number | null>(null);
  /** Guards against a second submit while a save (and its side effects) is in flight;
   * a ref rather than the state above so the "save for all" loop can hold one lock. */
  const savingRef = useRef(false);
  const [errors, setErrors] = useState<Record<number, string | null>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [labsMetaLoading, setLabsMetaLoading] = useState(false);

  // Re-seed when the saved dispositions change underneath us (e.g. after a save).
  // Remaining pets inherit a saved sibling's choice when "same for remaining" is on,
  // so Save does not write empty interval/mode onto the unfinished pets.
  useEffect(() => {
    setForms((prev) => seedForms(pets, prev, sameForAll));
  }, [pets, sameForAll]);

  useEffect(() => {
    if (remainingPets.length <= 1 && sameForAll) setSameForAll(false);
  }, [remainingPets.length, sameForAll]);

  const needsLabsMeta = useMemo(
    () => Object.values(forms).some((f) => f.mode === 'labs_pending'),
    [forms]
  );

  // Only fetched when a labs-pending task is actually on the table — most visits
  // never touch it and this is two extra round trips.
  useEffect(() => {
    if (!needsLabsMeta || employees.length > 0) return;
    let on = true;
    setLabsMetaLoading(true);
    void (async () => {
      try {
        const [branchList, employeeList] = await Promise.all([
          listPracticeBranches(PRACTICE_ID),
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
        if (on) setLabsMetaLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [needsLabsMeta, employees.length]);

  const set = useCallback(
    (patientId: number, patch: Partial<ForwardBookingDispositionFormState>) => {
      setForms((prev) => {
        if (sameForAll) {
          const remainingIds = new Set(remainingPets.map((p) => p.patientId));
          return Object.fromEntries(
            Object.entries(prev).map(([id, form]) =>
              remainingIds.has(Number(id)) ? [id, { ...form, ...patch }] : [id, form]
            )
          );
        }
        return { ...prev, [patientId]: { ...prev[patientId], ...patch } };
      });
    },
    [remainingPets, sameForAll]
  );

  /**
   * Persists one pet's disposition, including its side effects: "Forward book"
   * adds a row to the forward-booking queue, "Labs pending" creates the task that
   * chases the result.
   */
  const persist = useCallback(
    async (
      pet: VisitWrapUpPet,
      formOverride?: ForwardBookingDispositionFormState
    ): Promise<ForwardBookingDecisionResult | null> => {
      const form = formOverride ?? forms[pet.patientId];
      if (!form) return null;
      setSavingPatientId(pet.patientId);
      setErrors((e) => ({ ...e, [pet.patientId]: null }));
      try {
        const result = await saveForwardBookingDecision(
          {
            appointmentId: pet.appointmentId,
            patientId: pet.patientId,
            patientName: pet.patientName,
            clientId,
            soapEncounterId: pet.soapEncounterId,
            providerId,
          },
          form,
          {
            practiceId: PRACTICE_ID,
            branchIds,
            labsTaskTitleFallback: LABS_TASK_TITLE_DEFAULT,
          }
        );
        await onSaved();
        return result;
      } catch (e) {
        setErrors((prev) => ({
          ...prev,
          [pet.patientId]: e instanceof Error ? e.message : 'Could not save the follow-up choice',
        }));
        return null;
      } finally {
        setSavingPatientId(null);
      }
    },
    [branchIds, clientId, forms, onSaved, providerId]
  );

  /** Sequential: every save can create a booking entry or a task, so overlapping
   * them risks duplicates, and a failure should leave later pets untouched. */
  const save = useCallback(
    async (pet: VisitWrapUpPet): Promise<ForwardBookingDecisionResult[]> => {
      if (savingRef.current) return [];
      savingRef.current = true;
      try {
        const results: ForwardBookingDecisionResult[] = [];
        // Skip pets that already have a settled choice: re-saving would duplicate the
        // queue row or the labs task, and the API refuses to overwrite it anyway.
        const targets = (sameForAll ? remainingPets : [pet]).filter((p) => !isFollowUpSaved(p));
        const sharedForm = sameForAll
          ? forms[pet.patientId] ?? remainingPets.map((p) => forms[p.patientId]).find(Boolean)
          : undefined;
        for (const target of targets) {
          const result = await persist(target, sharedForm);
          if (result) results.push(result);
        }
        return results;
      } finally {
        savingRef.current = false;
      }
    },
    [forms, persist, remainingPets, sameForAll]
  );

  /**
   * Save, then take the queue row straight to Routing so the follow-up can go on
   * the calendar now. Booking is a slot search on this practice's zones, so it
   * happens there rather than here; the saved row means an abandoned search still
   * leaves the follow-up on the list to be called about.
   */
  const bookNow = useCallback(
    async (pet: VisitWrapUpPet) => {
      const entries = (await save(pet))
        .map((r) => r.entry)
        .filter((e): e is NonNullable<typeof e> => e != null);
      if (entries.length === 0) return;
      if (!startFollowUpBooking(entries, returnTo)) {
        setErrors((prev) => ({
          ...prev,
          [pet.patientId]:
            'Saved to the forward booking list, but this visit is missing the client or interval details Routing needs.',
        }));
        return;
      }
      navigate('/schedule/routing');
    },
    [navigate, returnTo, save]
  );

  const editorPetId = remainingPets[0]?.patientId ?? null;
  const remainingNames = remainingPets.map((p) => p.patientName).join(', ');
  const savedNames = savedPets.map((p) => p.patientName).join(', ');

  return (
    <div className="soap-wrapup-fb">
      {savedPets.length > 0 && remainingPets.length > 0 && (
        <p className="soap-wrapup-hint soap-wrapup-fb-already">
          {savedNames} already {savedPets.length === 1 ? 'has' : 'have'} a follow-up
          {savedPets.length === 1 && savedPets[0].forwardBookingDisposition
            ? ` (${dispositionLabel(savedPets[0].forwardBookingDisposition)})`
            : ''}
          . {remainingPets.length === 1
            ? `Set follow-up for ${remainingNames}.`
            : sameForAll
              ? `The choice below applies to the remaining ${remainingPets.length}.`
              : `Set follow-up for each of the remaining ${remainingPets.length}.`}
        </p>
      )}

      {remainingPets.length > 1 && (
        <label className="soap-wrapup-fb-sameforall">
          <input
            type="checkbox"
            checked={sameForAll}
            disabled={disabled}
            onChange={(e) => setSameForAll(e.target.checked)}
          />
          Same follow-up for remaining {remainingPets.length} pets
        </label>
      )}

      {pets.map((pet) => {
        const form = forms[pet.patientId];
        if (!form) return null;
        const saved = pet.forwardBookingDisposition;
        const complete = forwardBookingFormStateIsComplete(form);
        const savedComplete = isFollowUpSaved(pet);
        const showEditor = !savedComplete && (!sameForAll || pet.patientId === editorPetId);

        return (
          <div className="soap-wrapup-fb-pet" key={pet.patientId}>
            <div className="soap-wrapup-fb-pet-head">
              <strong>{pet.patientName}</strong>
              {savedComplete ? (
                <span className="soap-wrapup-fb-ok">
                  <Check size={13} /> {dispositionLabel(saved)}
                </span>
              ) : (
                <span className="soap-wrapup-fb-todo">Follow-up needed</span>
              )}
            </div>

            {savedComplete && (
              <p className="soap-hint">Saved for this visit — this choice cannot be changed.</p>
            )}

            {showEditor && (
              <>
                <ForwardBookingDecisionFields
                  radioGroupName={`wrapup-forward-booking-${pet.patientId}`}
                  value={form}
                  onChange={(patch) => set(pet.patientId, patch)}
                  disabled={disabled}
                  metaLoading={labsMetaLoading}
                  employees={employees}
                  multiPetLabsTasks={sameForAll && remainingPets.length > 1}
                />

                {errors[pet.patientId] && <div className="soap-error">{errors[pet.patientId]}</div>}

                {!disabled && (
                  <div className="soap-wrapup-fb-actions">
                    <button
                      type="button"
                      className="soap-btn"
                      disabled={!complete || savingPatientId != null}
                      onClick={() => void save(pet)}
                    >
                      <CalendarClock size={14} />{' '}
                      {savingPatientId != null
                        ? 'Saving…'
                        : sameForAll && remainingPets.length > 1
                          ? `Save follow-up for remaining ${remainingPets.length} pets`
                          : 'Save follow-up'}
                    </button>
                    {form.mode === 'forward_book_fields' && (
                      <button
                        type="button"
                        className="soap-btn primary"
                        disabled={!complete || savingPatientId != null}
                        title="Save this, then find a slot and book it now"
                        onClick={() => void bookNow(pet)}
                      >
                        <CalendarPlus size={14} /> Book it now
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function dispositionLabel(disposition: ForwardBookingDisposition | null | undefined): string {
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
