import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSubmitOnce } from '../../hooks/useSubmitOnce';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { CalendarPlus, X } from 'lucide-react';
import { fetchAllEmployees, fetchEmployee, type Employee } from '../../api/appointmentSettings';
import { getEmployeeBranches, listPracticeBranches } from '../../api/branchInventory';
import { getToken } from '../../api/http';
import { resolveEmployeeIdFromToken } from '../../utils/practiceIdFromToken';
import type { ForwardBookingDisposition } from '../../api/forwardBookingDisposition';
import {
  dismissRoutingForwardBookingWorkspace,
  readRoutingForwardBookingIntent,
  routingCalendarHandoffUrl,
  stashRoutingCalendarHandoffForNewTab,
  writeRoutingForwardBookingIntent,
  type RoutingCalendarHandoff,
} from '../../utils/routingForwardBookingIntent';
import { FORWARD_BOOKING_ROUTE_PATH } from '../../utils/forwardBookingWorkspaceGuard';
import { notifySchedulingToolsNavCountsRefresh } from '../../hooks/useSchedulingToolsNavCounts';
import { forwardBookingRoutingSearchDateRange } from '../../utils/forwardBookingFromAppointment';
import { ClientContactComposeModal } from '../ClientContactComposeModal';
import { applySystemTemplateIfCustom } from '../../utils/messageTemplateCache';
import { withClinicDefaults } from '../../utils/messageTemplateFields';
import {
  forwardBookingModeOption,
  StaffMultiPick,
} from '../forwardBooking/ForwardBookingDecisionFields';
import { suggestLabsTaskPeople } from '../forwardBooking/labsTaskPeople';
import {
  addPetsToUpcomingVisit,
  bookingFromAppointments,
  createLabsTask,
  createPlannerForwardBookings,
  findBookedAppointments,
  removePlannerForwardBookings,
  removePlannerForwardBookingsOnUnload,
  savePetDisposition,
  sendPlannerConfirmationText,
  SourceVisitLinks,
  startPlannerSlotSearch,
  undoPlannerBooking,
  type PetDisposition,
  type PlannerBooking,
} from './plannerActions';
import {
  householdArrivalWindow,
  loadFollowUpPlannerData,
  type FollowUpPlannerData,
  type PlannerVisitInput,
  type PlannerPet,
  type UpcomingVisit,
} from './plannerData';
import { subscribeFollowUpPlannerBooked, type FollowUpPlannerBookedDetail } from './plannerEvents';
import {
  addToVisitClNote,
  BOOKING_UNDO_MS,
  bookingUndoOpen,
  buildFollowUpConfirmationText,
  confirmationTextParts,
  tidyMergedText,
  confirmationSendProvider,
  dispositionModeForOutcomes,
  joinNames,
  plannerIntervalForApi,
  plannerIntervalLabel,
  plannerTargetDate,
  PLANNER_PRESETS,
  providerTextLabel,
  reminderFit,
  smsSegmentCount,
  type ConfirmationBooking,
  type PlacementOutcome,
  type PlannerCustomUnit,
  type PlannerInterval,
  type PlannerProvider,
  type ReminderFit,
} from './plannerModel';
import { loadAddPetImpact, type AddPetImpact } from './visitImpact';
import PlannerBestFitPanel, { type BestFitBookOutcome } from './PlannerBestFitPanel';
import {
  bestFitPreviewPayload,
  bookBestFitSlot,
  doctorShortName,
  internalDoctorIdForPims,
  type BestFitPlace,
  type BestFitRequest,
  type BestFitSlot,
} from './plannerBestFit';
import {
  appointmentTypeStaffName,
  createProviderStatsCache,
  estimateAddedMinutes,
  estimateVisitMinutes,
  type MinutesEstimate,
} from './plannerTiming';
import { premedsHistoryVisitReason, usePremedsHistory } from '../../utils/premedsHistory';
import { premedsWindowSpanLabel, usePracticePremedsWindowMinutes } from '../../utils/premedsWindow';
import { patientsForAppointment } from '../../utils/schedulerAddPet';
import './ScheduleFollowUpsPlanner.css';

const PRACTICE_NAME = 'Vet At Your Door';
const AVATAR_COLORS = ['#c0562f', '#2f7fc0', '#3d9a5b', '#8a52c4', '#c08a1f', '#3a8f8f', '#b0476b'];
const NONE_REASONS = [
  'Hospice / comfort care',
  'Client declined',
  'Seen at another clinic',
  'Moving away',
];
const LABS_REMIND = [
  { key: '1', label: 'Tomorrow', days: 1 },
  { key: '3', label: 'In 3 days', days: 3 },
  { key: '7', label: 'In 1 week', days: 7 },
];

// ---------------------------------------------------------------------------
// State shapes
// ---------------------------------------------------------------------------

type NewCard = {
  key: string;
  interval: PlannerInterval;
  keepToday: boolean;
  providerId: number | null;
  status: 'draft' | 'cl' | 'searching' | 'booked';
  /** Rows created for an in-progress slot search. */
  searchEntryIds: number[];
  booking: PlannerBooking | null;
};

type UpcomingState = {
  booking: PlannerBooking | null;
  adding: boolean;
  impact: AddPetImpact | null;
  impactLoading: boolean;
  impactError: string | null;
  /** History-based extra time for the pets being added. */
  added: MinutesEstimate | null;
  /**
   * "Send to CLs": the added pets are not put on the visit here; at Done each gets a
   * forward-booking row telling the CLs to add them to this visit.
   */
  clSend: boolean;
};

/**
 * Find a time now: the card's best-fit slots, booked from the panel. Any calendar opens in
 * a new tab; this tab never leaves the planner.
 */
type Layer = { kind: 'fit'; cardKey: string; request: BestFitRequest };

const LABS = 'labs';
const NONE = 'none';
const newKey = (n: number) => `new:${n}`;
const upKey = (visitKey: string) => `up:${visitKey}`;
const noteKey = (petId: number, card: string) => `${petId}@${card}`;

function fmtDay(d: DateTime) {
  return d.toFormat(d.year === DateTime.now().year ? 'ccc, LLL d' : 'ccc, LLL d, yyyy');
}
function fmtWindow(a: DateTime, b: DateTime) {
  return `${a.toFormat('h:mm')}–${b.toFormat('h:mm a')}`;
}

export type PlannerSaveResult = {
  /**
   * One line per pet the planner was opened for (e.g. a labs-pending task), saying
   * what was done: used as the task's resolution note. Null when there were none.
   */
  focusSummary: string | null;
};

type Props = {
  open: boolean;
  /** Build with plannerVisitFromWrapUp / plannerVisitFromAppointments / plannerVisitForClient. */
  visit: PlannerVisitInput;
  practiceId: number;
  tz: string;
  onClose: () => void;
  /** After Done saved the choices, so the checkout reloads the wrap-up. */
  onSaved: (result: PlannerSaveResult) => void | Promise<void>;
};

/**
 * Schedule follow-ups (docs/follow-up-scheduler-plan.md). One window for the whole
 * household: pets go onto cards, each card is one future visit. Appointments go on the
 * calendar as soon as they are booked and lock after a 10-second undo; everything else
 * (follow-up choices, CL rows, labs tasks) saves at Done.
 */
export default function ScheduleFollowUpsPlanner({
  open,
  visit,
  practiceId,
  tz,
  onClose,
  onSaved,
}: Props) {
  const [data, setData] = useState<FollowUpPlannerData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [placements, setPlacements] = useState<Record<number, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<NewCard[]>([]);
  const [upcoming, setUpcoming] = useState<Record<string, UpcomingState>>({});
  /** Who does the labs task: the visit doctor and their techs by default (SCH-E); editable. */
  const [labsAssignees, setLabsAssignees] = useState<number[]>([]);
  const [labsWatchers, setLabsWatchers] = useState<number[]>([]);
  /** Staff changed the people; a late suggestion must not overwrite them. */
  const labsPeopleEdited = useRef(false);
  const [labsRemind, setLabsRemind] = useState('3');
  const [noneReason, setNoneReason] = useState('');
  const [clNote, setClNote] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  /** Labs task branches: the practice's active ones and the signed-in staff member's. */
  const [practiceBranchIds, setPracticeBranchIds] = useState<number[]>([]);
  const [staffBranchIds, setStaffBranchIds] = useState<number[]>([]);
  const [menu, setMenu] = useState<{
    petId: number;
    from: string | null;
    x: number;
    y: number;
  } | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  /** "What does <pet> need?" in the Find a time panel (pet id → visit reason). */
  const [fitNeeds, setFitNeeds] = useState<Record<number, string>>({});
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'plan' | 'review'>('plan');
  const [leaveWarn, setLeaveWarn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reviewText, setReviewText] = useState('');
  const [textEdited, setTextEdited] = useState(false);
  const [mention, setMention] = useState({ cl: true, labs: true });
  const [emailOpen, setEmailOpen] = useState(false);
  /** Reminder lists opened past the first few "after this visit" items (key: petId@card). */
  const [expandedRems, setExpandedRems] = useState<Record<string, boolean>>({});
  const [savedOnce, setSavedOnce] = useState(false);
  const seq = useRef(1);
  /** Read once per opening: callers may rebuild `visit` on every render. */
  const visitRef = useRef(visit);
  visitRef.current = visit;
  const links = useRef(new SourceVisitLinks());
  const statsFor = useRef(createProviderStatsCache()).current;
  /** Visit length per new card, from the card's provider history. */
  const [cardMinutes, setCardMinutes] = useState<Record<string, MinutesEstimate>>({});
  /** Visit type each pet was given on a card or housemate visit (key: petId@card). */
  const [petTypes, setPetTypes] = useState<Record<string, number>>({});
  /** "Needs pre-meds" each pet was given on a card or housemate visit (key: petId@card). */
  const [petPremeds, setPetPremeds] = useState<Record<string, boolean>>({});
  /** Cards where staff tried to book or send without picking every pet's type. */
  const [typeErrorCards, setTypeErrorCards] = useState<Record<string, boolean>>({});
  /** Pets whose last visit (or chart) needed pre-meds; their box starts checked. */
  const premedsHistory = usePremedsHistory(
    practiceId,
    data?.pets.map((p) => p.patientId) ?? [],
    open && data != null
  );
  const premedsSpan = premedsWindowSpanLabel(usePracticePremedsWindowMinutes());
  const dragRef = useRef<{ petId: number; from: string | null } | null>(null);

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!open || data) return;
    let on = true;
    setLoadError(null);
    loadFollowUpPlannerData({ visit: visitRef.current, practiceId, tz })
      .then((d) => {
        if (!on) return;
        setData(d);
        const init: Record<number, string[]> = {};
        for (const p of d.pets) init[p.patientId] = [];
        const ups: Record<string, UpcomingState> = {};
        for (const v of d.upcoming) {
          ups[v.key] = {
            added: null,
            clSend: false,
            booking: null,
            adding: false,
            impact: null,
            impactLoading: false,
            impactError: null,
          };
          for (const id of v.petIds) if (init[id]) init[id].push(upKey(v.key));
        }
        setPlacements(init);
        setUpcoming(ups);
        setCards([blankCard(1, { kind: 'preset', key: '1y' }, d)]);
        seq.current = 2;
        labsPeopleEdited.current = false;
        setLabsAssignees(d.todayProviderId ? [d.todayProviderId] : []);
        setLabsWatchers([]);
      })
      .catch(
        (e) => on && setLoadError(e instanceof Error ? e.message : 'Could not load follow-ups.')
      );
    return () => {
      on = false;
    };
  }, [open, data, practiceId, tz]);

  // SCH-E: who the labs task starts with (the doctor and their techs). Its own effect: the load
  // effect above re-runs (and cancels) as soon as it stores `data`, which used to drop this answer.
  const todayProviderId = data?.todayProviderId ?? null;
  useEffect(() => {
    if (!open || todayProviderId == null) return;
    let on = true;
    void suggestLabsTaskPeople(todayProviderId).then((people) => {
      if (!on || labsPeopleEdited.current || people.assignees.length === 0) return;
      setLabsAssignees(people.assignees);
      setLabsWatchers(people.watchers);
    });
    return () => {
      on = false;
    };
  }, [open, todayProviderId]);

  // Staff and branches only when labs pending is used.
  const usesLabs = Object.values(placements).some((p) => p.includes(LABS));
  useEffect(() => {
    if (!usesLabs || employees.length) return;
    const me = resolveEmployeeIdFromToken(getToken());
    void Promise.all([
      fetchAllEmployees(),
      listPracticeBranches(practiceId),
      me != null ? getEmployeeBranches(practiceId, me).catch(() => []) : Promise.resolve([]),
    ])
      .then(([emps, branches, mine]) => {
        setEmployees(Array.isArray(emps) ? emps : []);
        setPracticeBranchIds(
          (Array.isArray(branches) ? branches : [])
            .filter((b) => b.isActive !== false)
            .map((b) => b.id)
        );
        setStaffBranchIds(
          (Array.isArray(mine) ? mine : [])
            .map((b) => Number(b.branchId))
            .filter((id) => Number.isInteger(id) && id > 0)
        );
      })
      .catch(() => undefined);
  }, [usesLabs, employees.length, practiceId]);

  // Tick while any booking is inside its undo window, so the card locks on time.
  const anyUndoOpen =
    cards.some((c) => c.booking && bookingUndoOpen(c.booking.bookedAtMs, now)) ||
    Object.values(upcoming).some((u) => u.booking && bookingUndoOpen(u.booking.bookedAtMs, now));
  useEffect(() => {
    if (!anyUndoOpen) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [anyUndoOpen]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.undo ? BOOKING_UNDO_MS : 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // A slot search left open must not leave its rows on the forward booking list: clean
  // up when the planner goes away (any route) or the tab closes.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  useEffect(() => {
    const searchIds = () =>
      cardsRef.current.filter((c) => c.status === 'searching').flatMap((c) => c.searchEntryIds);
    const onPageHide = () => {
      const ids = searchIds();
      if (ids.length) removePlannerForwardBookingsOnUnload(ids, practiceId);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      const ids = searchIds();
      if (ids.length) {
        void removePlannerForwardBookings(ids, practiceId);
        dismissRoutingForwardBookingWorkspace();
      }
    };
  }, [practiceId]);

  // Reload or close the tab with unsaved work: the browser's own prompt.
  useEffect(() => {
    if (!open || !dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [open, dirty]);

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------
  const pets = useMemo(() => data?.pets ?? [], [data?.pets]);
  const petById = useMemo(() => new Map(pets.map((p) => [p.patientId, p])), [pets]);
  const colorOf = useCallback(
    (id: number) =>
      AVATAR_COLORS[
        Math.max(
          0,
          pets.findIndex((p) => p.patientId === id)
        ) % AVATAR_COLORS.length
      ],
    [pets]
  );
  const providerById = useMemo(
    () => new Map((data?.providers ?? []).map((p) => [p.id, p])),
    [data?.providers]
  );
  const todayProvider =
    data?.todayProviderId != null ? (providerById.get(data.todayProviderId) ?? null) : null;
  const petsIn = useCallback(
    (card: string) => pets.filter((p) => placements[p.patientId]?.includes(card)),
    [pets, placements]
  );
  const visitByKey = useMemo(
    () => new Map((data?.upcoming ?? []).map((v) => [v.key, v])),
    [data?.upcoming]
  );
  const cardByKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);

  const isLockedBooking = (b: PlannerBooking | null | undefined) =>
    !!b && !bookingUndoOpen(b.bookedAtMs, now);

  /** What a placement means for the pet's saved follow-up choice (null = not settled yet). */
  const outcomeAt = useCallback(
    (pet: PlannerPet, card: string): PlacementOutcome | null => {
      if (card === LABS) return 'labs_pending';
      if (card === NONE) return noneReason.trim() ? 'none' : null;
      if (card.startsWith('up:')) {
        const v = visitByKey.get(card.slice(3));
        if (v?.petIds.includes(pet.patientId)) return 'already_booked';
        const st = upcoming[card.slice(3)];
        if (st?.booking) return 'booked';
        return st?.clSend ? 'send_to_cls' : null;
      }
      const c = cardByKey.get(card);
      if (c?.status === 'booked') return 'booked';
      if (c?.status === 'cl') return 'send_to_cls';
      return null;
    },
    [noneReason, visitByKey, upcoming, cardByKey]
  );
  const outcomesFor = (pet: PlannerPet) =>
    (placements[pet.patientId] ?? [])
      .map((c) => outcomeAt(pet, c))
      .filter((o): o is PlacementOutcome => o != null);
  const todayPets = pets.filter((p) => p.onTodaysVisit);
  /** Opened for these pets (e.g. labs are back): they need a plan too. */
  const focusPets = pets.filter((p) => p.focusReason);
  const mustPlan = [...todayPets, ...focusPets];
  const openPets = mustPlan.filter((p) => !p.savedMode && outcomesFor(p).length === 0);
  const readOnly =
    todayPets.length > 0 && todayPets.every((p) => p.savedMode) && !savedOnce ? true : false;

  const targetFor = (card: string): DateTime | null => {
    if (!data) return null;
    if (card.startsWith('up:')) return visitByKey.get(card.slice(3))?.start ?? null;
    const c = cardByKey.get(card);
    return c ? plannerTargetDate(c.interval, data.today) : null;
  };
  const cardProvider = (c: NewCard): PlannerProvider | null =>
    (c.keepToday ? todayProvider : c.providerId != null ? providerById.get(c.providerId) : null) ??
    null;
  /** A pet's visit type on a card: its own pick, else the card's (or housemate visit's) type. */
  const typeFor = (pet: PlannerPet, card: string): number | null => {
    const own = petTypes[noteKey(pet.patientId, card)];
    if (own != null) return own;
    if (card.startsWith('up:')) {
      const id = Number(visitByKey.get(card.slice(3))?.appointments[0]?.appointmentType?.id);
      return Number.isFinite(id) ? id : null;
    }
    // New follow-up cards start at "Choose…": staff must pick each pet's type.
    return null;
  };
  /** A pet's "needs pre-meds" on a card: its own choice, else checked when history says so. */
  const premedsFor = (pet: PlannerPet, card: string): boolean =>
    petPremeds[noteKey(pet.patientId, card)] ?? premedsHistory.has(String(pet.patientId));
  /** Pets on a card still missing a visit type. */
  const untypedIn = (card: string) => petsIn(card).filter((p) => typeFor(p, card) == null);
  /** False (and the pets' pickers flagged) when any pet on the card has no visit type yet. */
  const requireTypes = (card: string): boolean => {
    const missing = untypedIn(card);
    if (!missing.length) return true;
    setTypeErrorCards((m) => ({ ...m, [card]: true }));
    setError(`Pick a visit type for ${joinNames(missing.map((p) => p.name))}`);
    return false;
  };
  const cardLabel = (card: string): string => {
    if (card === LABS) return 'Labs pending';
    if (card === NONE) return 'No follow-up';
    if (card.startsWith('up:')) {
      const v = visitByKey.get(card.slice(3));
      return v ? `${v.start.toFormat('LLL d')} visit` : 'Upcoming visit';
    }
    const c = cardByKey.get(card);
    return c && data
      ? plannerIntervalLabel(c.interval, data.today).replace(/^In /, '')
      : 'Follow-up';
  };

  /** "Nov 17 visit" for a household visit, "1 year visit" for a card. */
  const visitLabel = (card: string) =>
    card.startsWith('up:') ? cardLabel(card) : `${cardLabel(card)} visit`;

  // -------------------------------------------------------------------------
  // Moving pets
  // -------------------------------------------------------------------------
  function blankCard(
    n: number,
    interval: PlannerInterval,
    d: Pick<FollowUpPlannerData, 'todayProviderId' | 'bookableTypes'> | null
  ): NewCard {
    return {
      key: newKey(n),
      interval,
      keepToday: d?.todayProviderId != null,
      providerId: null,
      status: 'draft',
      searchEntryIds: [],
      booking: null,
    };
  }
  function addCard(interval: PlannerInterval): string {
    const card = blankCard(seq.current++, interval, data);
    setCards((cs) => [...cs, card]);
    return card.key;
  }
  /** A pet on a booked visit is locked to it once the undo window closes. */
  function lockedAt(petId: number, card: string): boolean {
    if (card.startsWith('up:')) {
      const v = visitByKey.get(card.slice(3));
      if (v?.petIds.includes(petId)) return true;
      return isLockedBooking(upcoming[card.slice(3)]?.booking);
    }
    const c = cardByKey.get(card);
    return c?.status === 'searching' || isLockedBooking(c?.booking);
  }
  function canDropOn(card: string): string | null {
    if (card.startsWith('up:')) {
      const st = upcoming[card.slice(3)];
      if (st?.booking || st?.adding)
        return 'Those pets were already added. Start a new card for anyone else.';
      return null;
    }
    const c = cardByKey.get(card);
    if (c && (c.status === 'booked' || c.status === 'searching')) {
      return 'That visit is booked. Start a new card, or change it on the calendar.';
    }
    return null;
  }

  function place(petId: number, target: string, from: string | null, mode: 'add' | 'move') {
    const pet = petById.get(petId);
    if (!pet || pet.savedMode) return;
    let card = target;
    // A pet already booked on a visit stays on it. Taking it off is done on the
    // calendar; putting it on another card books it for that visit as well.
    let pinnedNote: string | null = null;
    if (from && mode === 'move' && lockedAt(petId, from)) {
      if (target === '__tray' || target === NONE) {
        setToast({
          text: `${pet.name} is booked on that visit. Change it on the calendar (View appointment).`,
        });
        return;
      }
      mode = 'add';
      pinnedNote = `${pet.name} stays on the ${visitLabel(from)} and is added here too.`;
    }
    if (target !== '__tray' && target !== '__new') {
      const blocked = canDropOn(target);
      if (blocked) return setToast({ text: blocked });
    }
    if (target === '__new') card = addCard({ kind: 'preset', key: '1m' });
    if (pinnedNote) setToast({ text: pinnedNote });
    setPlacements((prev) => {
      let list = [...(prev[petId] ?? [])];
      if (from && mode === 'move') list = list.filter((c) => c !== from);
      if (card === '__tray') return { ...prev, [petId]: list };
      if (list.includes(card)) return prev;
      if (card === NONE)
        list = list.filter(
          (c) => c.startsWith('up:') && visitByKey.get(c.slice(3))?.petIds.includes(petId)
        );
      else list = list.filter((c) => c !== NONE);
      return { ...prev, [petId]: [...list, card] };
    });
    // A CL card that gains or loses a pet goes back to draft so it is re-confirmed.
    setCards((cs) =>
      cs.map((c) =>
        c.status === 'cl' && (c.key === card || c.key === from) ? { ...c, status: 'draft' } : c
      )
    );
    // Same for a visit marked "Send to CLs".
    const touched = [card, from].filter(
      (k): k is string => !!k && k.startsWith('up:') && !!upcoming[k.slice(3)]?.clSend
    );
    if (touched.length) {
      setUpcoming((u) => {
        const next = { ...u };
        for (const k of touched) next[k.slice(3)] = { ...next[k.slice(3)], clSend: false };
        return next;
      });
    }
    setDirty(true);
  }

  // -------------------------------------------------------------------------
  // Find a time (Routing + calendar in a side layer)
  // -------------------------------------------------------------------------
  const notesFor = (card: string) => (pet: PlannerPet) => {
    const own = notes[noteKey(pet.patientId, card)]?.trim() ?? '';
    const base = own || `${cardLabel(card)} follow-up`;
    return clNote.trim() ? `${base}\nHousehold: ${clNote.trim()}` : base;
  };

  /** History-based length for a card's pets, loaded fresh at the moment of booking. */
  async function minutesForCard(card: NewCard): Promise<number> {
    const typeIds = petsIn(card.key)
      .map((p) => typeFor(p, card.key))
      .filter((id): id is number => id != null);
    if (!data || !typeIds.length) return 45;
    const rows = await statsFor(cardProvider(card)?.id);
    return estimateVisitMinutes(typeIds, rows, data.appointmentTypes).minutes;
  }
  const typeName = (id: number | null) => {
    const t = data?.appointmentTypes.find((x) => Number(x.id) === Number(id));
    return t ? appointmentTypeStaffName(t) : '';
  };

  async function findTime(card: NewCard) {
    if (!data) return;
    const cardPets = petsIn(card.key);
    if (!cardPets.length || untypedIn(card.key).length) return;
    // Routing searches with the first pet's type; each pet's row keeps its own type.
    const anchorTypeId = typeFor(cardPets[0]!, card.key)!;
    setBusy(card.key);
    setError(null);
    try {
      const serviceMinutes = await minutesForCard(card);
      const { entries } = await createPlannerForwardBookings({
        practiceId,
        clientId: data.clientId,
        pets: cardPets,
        interval: card.interval,
        today: data.today,
        providerId: cardProvider(card)?.id ?? null,
        typeIdFor: (p) => typeFor(p, card.key)!,
        premedsFor: (p) => premedsFor(p, card.key),
        serviceMinutes,
        notesFor: notesFor(card.key),
        links: links.current,
      });
      if (
        !startPlannerSlotSearch(entries, {
          appointmentTypeId: anchorTypeId,
          appointmentTypeName: typeName(anchorTypeId),
          serviceMinutes,
        })
      ) {
        await removePlannerForwardBookings(
          entries.map((e) => Number(e.id)),
          practiceId
        );
        cardPets.forEach((p) => links.current.release(p.patientId));
        throw new Error('Could not start the slot search for this card.');
      }
      setCards((cs) =>
        cs.map((c) =>
          c.key === card.key
            ? { ...c, status: 'searching', searchEntryIds: entries.map((e) => Number(e.id)) }
            : c
        )
      );
      // Prefilled from the pet's note on this card, e.g. "annual exam".
      setFitNeeds(
        Object.fromEntries(
          cardPets.map((p) => [p.patientId, notes[noteKey(p.patientId, card.key)]?.trim() ?? ''])
        )
      );
      setLayer({
        kind: 'fit',
        cardKey: card.key,
        request: bestFitRequestFor(card, anchorTypeId, serviceMinutes),
      });
      setDirty(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the slot search.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * What the best-fit panel searches with: the same client, doctor, type, minutes,
   * pre-meds and date window Routing would get from this card's forward-booking intent.
   */
  function bestFitRequestFor(
    card: NewCard,
    anchorTypeId: number,
    serviceMinutes: number
  ): BestFitRequest {
    const cardPets = petsIn(card.key);
    const intent = readRoutingForwardBookingIntent();
    // Routing's window for this intent (target due date ±7 days, never before today);
    // without an intent, the same window around the card's own target date.
    const target = plannerTargetDate(card.interval, data!.today);
    const todayStart = data!.today.startOf('day');
    const window = (intent
      ? forwardBookingRoutingSearchDateRange({
          intervalAmount: intent.intervalAmount,
          intervalUnit: intent.intervalUnit,
          targetDueDateIso: intent.targetDueDate ?? null,
          practiceTz: tz,
        })
      : null) ?? {
      startDate: DateTime.max(todayStart, target.minus({ days: 7 })).toISODate()!,
      endDate: DateTime.max(todayStart, target.plus({ days: 7 })).toISODate()!,
    };
    const anchorType = data!.appointmentTypes.find((t) => Number(t.id) === anchorTypeId);
    const typeLabels = [
      ...new Set(cardPets.map((p) => typeName(typeFor(p, card.key))).filter(Boolean)),
    ];
    const provider = cardProvider(card);
    return {
      clientId: data!.clientId,
      clientLabel: data!.clientName ?? null,
      providerId: provider?.id ?? null,
      doctorPimsId: intent?.primaryDoctorPimsId?.trim() || null,
      providerName: provider?.name ?? 'Doctor',
      providerLabel: provider?.lastName
        ? `Dr. ${provider.lastName}`
        : provider
          ? doctorShortName(provider.name)
          : 'Doctor',
      appointmentTypeId: anchorTypeId,
      statsTypeKey: String(anchorType?.name ?? '').trim() || typeName(anchorTypeId),
      typeLabel: typeLabels.join(' + '),
      serviceMinutes,
      needsPremeds: cardPets.some((p) => premedsFor(p, card.key)),
      pets: cardPets.map((p) => ({ id: p.patientId, name: p.name })),
      window,
    };
  }

  /**
   * Book a best-fit slot from the panel, with no calendar: the same appointments and
   * forward-booking links the calendar's Book sends (bookBestFitSlot), then the card
   * shows as booked with Undo, exactly as after a calendar booking.
   */
  async function bookFromPanel(
    cardKey: string,
    slot: BestFitSlot,
    ctx: { request: BestFitRequest; place: BestFitPlace }
  ): Promise<BestFitBookOutcome> {
    const card = cards.find((c) => c.key === cardKey);
    const cardPets = petsIn(cardKey);
    if (!data || !card || !cardPets.length) return { ok: false, error: 'This card has no pets.' };
    const household = clNote.trim();
    try {
      const res = await bookBestFitSlot({
        practiceId,
        slot,
        req: ctx.request,
        place: ctx.place,
        tz,
        intent: readRoutingForwardBookingIntent(),
        visits: cardPets.map((p) => {
          const need = (fitNeeds[p.patientId] ?? '').trim();
          return {
            patientId: p.patientId,
            appointmentTypeId: typeFor(p, cardKey)!,
            needsPremeds: premedsFor(p, cardKey),
            // As the Book modal fills it from the row's notes (with the household note).
            description: household ? `${need}\nHousehold: ${household}` : need,
          };
        }),
      });
      dismissRoutingForwardBookingWorkspace();
      notifySchedulingToolsNavCountsRefresh();
      await applyBooked(
        cardKey,
        {
          appointmentId: res.appointmentIds[0]!,
          startIso: res.startIso,
          endIso: res.endIso,
          primaryProviderId: res.providerId,
        },
        { closePanel: false, appointmentIds: res.appointmentIds }
      );
      return { ok: true, warnings: res.warnings };
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (e instanceof Error ? e.message : '') ||
        'Could not book this time.';
      return { ok: false, error: String(msg) };
    }
  }

  /**
   * Every calendar the planner offers opens in another tab (the normal calendar page),
   * through a one-time handoff the calendar page picks up. The planner stays open here,
   * and a booking made there comes back to the open card.
   */
  function openCalendarTab(handoff: RoutingCalendarHandoff, tab?: Window | null) {
    const url = routingCalendarHandoffUrl(
      FORWARD_BOOKING_ROUTE_PATH,
      stashRoutingCalendarHandoffForNewTab(handoff)
    );
    if (tab) {
      tab.location.href = url;
      return;
    }
    // Never navigates this tab: a blocked pop-up just says so.
    if (!window.open(url, '_blank')) setPopupBlocked();
  }
  const setPopupBlocked = () =>
    setError('The browser blocked the new tab. Allow pop-ups for Scout and try again.');

  /** The card's forward booking, searching the panel's dates. */
  function writeSearchWindow(request: BestFitRequest) {
    const intent = readRoutingForwardBookingIntent();
    if (intent) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { v: _v, appliedToRoutingForm: _applied, ...rest } = intent;
      writeRoutingForwardBookingIntent({ ...rest, routingSearch: request.window });
    }
  }

  /** "Open the full calendar in a new tab": the calendar page with this forward booking. */
  function openFullCalendarInNewTab(request: BestFitRequest) {
    writeSearchWindow(request);
    openCalendarTab({});
  }

  /**
   * Review on a best-fit slot: the calendar in a new tab, on that day and doctor, with the
   * proposed visit drawn in place (Routing's "View placement" preview). Book there books
   * it the normal way and this card updates.
   */
  async function reviewSlotInNewTab(
    slot: BestFitSlot,
    ctx: { request: BestFitRequest; place: BestFitPlace }
  ): Promise<void> {
    // Opened now, while the click still allows a pop-up; pointed at the slot once the
    // doctor's calendar id is known.
    const tab = window.open('', '_blank');
    if (!tab) return setPopupBlocked();
    const internalId = await internalDoctorIdForPims(slot.doctorPimsId);
    if (!internalId) {
      tab.close();
      setError(`Could not find ${slot.doctorName} in the provider list.`);
      return;
    }
    writeSearchWindow(ctx.request);
    openCalendarTab(
      {
        calendarPreview: bestFitPreviewPayload({
          slot,
          req: ctx.request,
          place: ctx.place,
          internalDoctorId: internalId,
        }),
      },
      tab
    );
  }

  const closeLayer = useCallback(async () => {
    const current = layer;
    setLayer(null);
    if (!current) return;
    dismissRoutingForwardBookingWorkspace();
    const card = cards.find((c) => c.key === current.cardKey);
    if (card?.status === 'searching') {
      // Abandoned without booking: take the rows back off the list.
      await removePlannerForwardBookings(card.searchEntryIds, practiceId);
      petsIn(card.key).forEach((p) => links.current.release(p.patientId));
      setCards((cs) =>
        cs.map((c) => (c.key === card.key ? { ...c, status: 'draft', searchEntryIds: [] } : c))
      );
    }
  }, [layer, cards, practiceId, petsIn]);

  /** A booking for a card (from the panel, or the full calendar in another tab). */
  async function applyBooked(
    cardKey: string,
    d: FollowUpPlannerBookedDetail,
    opts: { closePanel: boolean; appointmentIds?: number[] }
  ) {
    const card = cards.find((c) => c.key === cardKey);
    if (!data || !card) return;
    const cardPets = petsIn(cardKey);
    const provider =
      (d.primaryProviderId != null ? providerById.get(d.primaryProviderId) : null) ??
      cardProvider(card);
    let rows: Awaited<ReturnType<typeof findBookedAppointments>> = [];
    try {
      rows = d.startIso
        ? await findBookedAppointments({
            practiceId,
            clientId: data.clientId,
            startIso: d.startIso,
            petIds: cardPets.map((p) => p.patientId),
            tz,
          })
        : [];
    } catch {
      rows = [];
    }
    const booking = bookingFromAppointments(rows, {
      tz,
      provider,
      entryIds: card.searchEntryIds,
      fallbackStartIso: d.startIso ?? DateTime.now().toISO()!,
    });
    // Undo removes every appointment the booking made, even ones the reload missed.
    for (const id of [d.appointmentId, ...(opts.appointmentIds ?? [])].reverse()) {
      if (!booking.appointmentIds.includes(id)) booking.appointmentIds.unshift(id);
    }
    setCards((cs) =>
      cs.map((c) =>
        c.key === cardKey ? { ...c, status: 'booked', booking, searchEntryIds: [] } : c
      )
    );
    if (opts.closePanel) setLayer(null);
    setNow(Date.now());
    setToast({
      text: `Booked ${joinNames(cardPets.map((p) => p.name))} · ${fmtDay(booking.start)}`,
      undo: () => void undoCard(cardKey, booking),
    });
  }

  // The full calendar (in another tab) reports a booking for the open card.
  useEffect(() => {
    if (!open || layer?.kind !== 'fit' || !data) return;
    const cardKey = layer.cardKey;
    return subscribeFollowUpPlannerBooked((d) => {
      if (cards.find((c) => c.key === cardKey)?.status === 'booked') return;
      // That tab cleared its own copy; this tab's search is finished too.
      dismissRoutingForwardBookingWorkspace();
      void applyBooked(cardKey, d, { closePanel: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, layer, data, cards, placements]);

  async function undoCard(cardKey: string, booking: PlannerBooking) {
    if (!bookingUndoOpen(booking.bookedAtMs, Date.now())) return;
    setToast(null);
    try {
      await undoPlannerBooking(booking, practiceId);
      petsIn(cardKey).forEach((p) => links.current.release(p.patientId));
      setCards((cs) =>
        cs.map((c) => (c.key === cardKey ? { ...c, status: 'draft', booking: null } : c))
      );
      setToast({ text: 'Booking undone. The slot is free again.' });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not undo. Change it on the calendar instead.'
      );
    }
  }

  /**
   * View in calendar / View appointment: the calendar in a new tab on the visit's day and
   * doctor, the visit highlighted; with `preview`, its longer end time drawn dashed.
   */
  function viewOnCalendar(
    appointmentId: number,
    start: DateTime,
    providerId: number | null,
    label: string,
    preview?: { endIso: string; originalEndIso: string }
  ) {
    openCalendarTab({
      intent: false,
      focusVisit: {
        appointmentId,
        startIso: start.toUTC().toISO()!,
        practiceDateKey: start.setZone(tz).toISODate()!,
        providerId,
        label,
        ...(preview
          ? { previewEndIso: preview.endIso, originalEndIso: preview.originalEndIso }
          : {}),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Add to a housemate's upcoming visit
  // -------------------------------------------------------------------------
  // Each card's expected length, refreshed when its pets, type or provider change.
  const cardSig = cards
    .map(
      (c) =>
        `${c.key}|${cardProvider(c)?.id}|${petsIn(c.key)
          .map((p) => typeFor(p, c.key))
          .join(',')}`
    )
    .join(';');
  useEffect(() => {
    if (!data) return;
    let on = true;
    void (async () => {
      const next: Record<string, MinutesEstimate> = {};
      for (const c of cards) {
        const typeIds = petsIn(c.key)
          .map((p) => typeFor(p, c.key))
          .filter((id): id is number => id != null);
        if (!typeIds.length) continue;
        const rows = await statsFor(cardProvider(c)?.id);
        next[c.key] = estimateVisitMinutes(typeIds, rows, data.appointmentTypes);
      }
      if (on) setCardMinutes(next);
    })();
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardSig, data]);

  const addedTo = (v: UpcomingVisit) =>
    petsIn(upKey(v.key)).filter((p) => !v.petIds.includes(p.patientId));
  const addedTypeFor = (v: UpcomingVisit, pet: PlannerPet) => typeFor(pet, upKey(v.key));
  const addedSig = (data?.upcoming ?? [])
    .map(
      (v) =>
        `${v.key}:${addedTo(v)
          .map((p) => `${p.patientId}=${addedTypeFor(v, p)}`)
          .join(',')}`
    )
    .join('|');
  useEffect(() => {
    if (!data) return;
    for (const v of data.upcoming) {
      const st = upcoming[v.key];
      const n = addedTo(v).length;
      if (!st || st.booking || st.adding) continue;
      if (n === 0) {
        if (st.impact || st.impactError)
          setUpcoming((u) => ({ ...u, [v.key]: { ...u[v.key], impact: null, impactError: null } }));
        continue;
      }
      setUpcoming((u) => ({
        ...u,
        [v.key]: { ...u[v.key], impactLoading: true, impactError: null },
      }));
      const existingTypes = v.appointments
        .map((a) => Number(a.appointmentType?.id))
        .filter((id) => Number.isFinite(id));
      const addedTypeIds = addedTo(v)
        .map((p) => addedTypeFor(v, p))
        .filter((id): id is number => id != null);
      statsFor(v.provider?.id)
        .then((rows) => {
          const added = estimateAddedMinutes(
            existingTypes,
            addedTypeIds,
            rows,
            data.appointmentTypes
          );
          setUpcoming((u) => ({ ...u, [v.key]: { ...u[v.key], added } }));
          return loadAddPetImpact({ visit: v, addedMinutes: added.minutes, tz });
        })
        .then((impact) =>
          setUpcoming((u) => ({ ...u, [v.key]: { ...u[v.key], impact, impactLoading: false } }))
        )
        .catch(() =>
          setUpcoming((u) => ({
            ...u,
            [v.key]: {
              ...u[v.key],
              impactLoading: false,
              impactError: 'Could not check the rest of that day.',
            },
          }))
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addedSig, data]);

  async function confirmAdd(v: UpcomingVisit) {
    if (!data) return;
    const pets = addedTo(v);
    setUpcoming((u) => ({ ...u, [v.key]: { ...u[v.key], adding: true } }));
    setError(null);
    try {
      const booking = await addPetsToUpcomingVisit({
        practiceId,
        clientId: data.clientId,
        visit: v,
        pets,
        notesFor: (p) => notes[noteKey(p.patientId, upKey(v.key))]?.trim() ?? '',
        typeIdFor: (p) => addedTypeFor(v, p)!,
        premedsFor: (p) => premedsFor(p, upKey(v.key)),
        addedMinutes: upcoming[v.key]?.added?.minutes ?? 20,
      });
      setUpcoming((u) => ({ ...u, [v.key]: { ...u[v.key], adding: false, booking } }));
      setNow(Date.now());
      setDirty(true);
      setToast({
        text: `Added ${joinNames(pets.map((p) => p.name))} to the ${v.start.toFormat('LLL d')} visit`,
        undo: () => void undoAdd(v.key, booking),
      });
    } catch (e) {
      setUpcoming((u) => ({ ...u, [v.key]: { ...u[v.key], adding: false } }));
      setError(e instanceof Error ? e.message : 'Could not add to that visit.');
    }
  }
  /** The household's arrival window when an added pet brings pre-meds to the visit. */
  function premedsWindowFor(v: UpcomingVisit): { start: DateTime; end: DateTime } | null {
    const nowPremeds = addedTo(v).some((p) => premedsFor(p, upKey(v.key)));
    const already = v.appointments.some((a) => a.needsPremeds === true);
    const first = v.appointments[0];
    if (!nowPremeds || already || !first) return null;
    const win = householdArrivalWindow(first, [{ needsPremeds: true }], tz);
    return win
      ? {
          start: DateTime.fromISO(win.startIso, { zone: 'utc' }).setZone(tz),
          end: DateTime.fromISO(win.endIso, { zone: 'utc' }).setZone(tz),
        }
      : null;
  }

  /** "Send to CLs": nothing changes on the visit; the rows are made at Done. */
  function markAddForCls(v: UpcomingVisit) {
    const missing = addedTo(v).filter((p) => addedTypeFor(v, p) == null);
    if (missing.length) {
      setError(`Pick a visit type for ${joinNames(missing.map((p) => p.name))}`);
      return;
    }
    setUpcoming((u) => ({ ...u, [v.key]: { ...u[v.key], clSend: true } }));
    setDirty(true);
    setToast({ text: 'Marked for the CLs. Saved when you press Done.' });
  }
  function unmarkAddForCls(visitKey: string) {
    setUpcoming((u) => ({ ...u, [visitKey]: { ...u[visitKey], clSend: false } }));
  }

  /** The forward-booking note: which visit to add the pet to, what it needs, the impact. */
  /** The signed-in staff member's name for the CL note ("Dr. Dana Demo", "Casey Demo"), or null. */
  async function myStaffName(): Promise<string | null> {
    const me = resolveEmployeeIdFromToken(getToken());
    if (me == null) return null;
    try {
      const e = await fetchEmployee(Number(me));
      const name = [e?.firstName, e?.lastName].filter(Boolean).join(' ').trim();
      if (!name) return null;
      return /\b(dr|dvm|vmd)\b/i.test(e?.title ?? '') ? `Dr. ${name}` : name;
    } catch {
      return null;
    }
  }
  function clNoteForAdd(v: UpcomingVisit, pet: PlannerPet, suggestedBy: string | null = null): string {
    const st = upcoming[v.key];
    const added = addedTo(v);
    const nameParts = (data?.clientName ?? '').trim().split(/\s+/).filter(Boolean);
    const firstId = Number(v.appointments[0]?.id);
    const note = addToVisitClNote({
      petName: pet.name,
      otherPetNames: added.filter((p) => p.patientId !== pet.patientId).map((p) => p.name),
      suggestedBy,
      visitPetNames: v.petIds
        .map((id) => data?.pets.find((p) => p.patientId === id)?.name)
        .filter((n): n is string => Boolean(n)),
      householdName: nameParts.length ? nameParts[nameParts.length - 1]! : null,
      visitStart: v.start,
      windowStart: v.windowStart,
      windowEnd: v.windowEnd,
      provider: v.provider,
      appointmentId: Number.isFinite(firstId) ? firstId : null,
      needs: typeName(addedTypeFor(v, pet)),
      petNote: notes[noteKey(pet.patientId, upKey(v.key))],
      needsPremeds: premedsFor(pet, upKey(v.key)),
      addedMinutes: st?.added?.minutes ?? null,
      premedsWindow: premedsWindowFor(v),
      lateStops: (st?.impact?.laterStops ?? [])
        .filter((x) => x.warns)
        .map((x) => ({ client: x.client, minutesPastWindow: x.minutesPastWindow })),
    });
    return clNote.trim() ? `${note}\nHousehold: ${clNote.trim()}` : note;
  }
  /** A visit's day as a CL row's target (the row's target date is that day). */
  const visitInterval = (v: UpcomingVisit): PlannerInterval => ({
    kind: 'date',
    date: v.start.setZone(tz).toISODate()!,
  });

  async function undoAdd(visitKey: string, booking: PlannerBooking) {
    if (!bookingUndoOpen(booking.bookedAtMs, Date.now())) return;
    setToast(null);
    try {
      await undoPlannerBooking(booking, practiceId);
      setUpcoming((u) => ({ ...u, [visitKey]: { ...u[visitKey], booking: null } }));
      setToast({ text: 'Undone. Nothing was added to that visit.' });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not undo. Change it on the calendar instead.'
      );
    }
  }
  function moveAddedElsewhere(v: UpcomingVisit) {
    const key = addCard({ kind: 'preset', key: '1m' });
    const moving = addedTo(v);
    setPlacements((prev) => {
      const next = { ...prev };
      for (const p of moving)
        next[p.patientId] = [...(next[p.patientId] ?? []).filter((c) => c !== upKey(v.key)), key];
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // Done → save → review → text
  // -------------------------------------------------------------------------
  const bookings: (ConfirmationBooking & { petIds: number[] })[] = useMemo(() => {
    const out: (ConfirmationBooking & { petIds: number[] })[] = [];
    for (const c of cards) {
      if (c.status !== 'booked' || !c.booking) continue;
      const ps = petsIn(c.key);
      out.push({
        start: c.booking.start,
        windowStart: c.booking.windowStart,
        windowEnd: c.booking.windowEnd,
        petNames: ps.map((p) => p.name),
        petIds: ps.map((p) => p.patientId),
        provider: c.booking.provider,
      });
    }
    for (const v of data?.upcoming ?? []) {
      const b = upcoming[v.key]?.booking;
      if (!b) continue;
      const ps = addedTo(v);
      out.push({
        start: b.start,
        windowStart: b.windowStart,
        windowEnd: b.windowEnd,
        petNames: ps.map((p) => p.name),
        petIds: ps.map((p) => p.patientId),
        provider: b.provider,
        joiningPetNames: v.petIds
          .map((id) => petById.get(id)?.name)
          .filter((n): n is string => !!n),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, upcoming, placements, data]);

  const clCards = cards.filter((c) => c.status === 'cl' && petsIn(c.key).length > 0);
  /** Housemate visits whose added pets go to the CLs to add (Send to CLs). */
  const clVisits = (data?.upcoming ?? []).filter(
    (v) => upcoming[v.key]?.clSend && !upcoming[v.key]?.booking && addedTo(v).length > 0
  );
  const labsPets = petsIn(LABS);

  const buildText = useCallback(() => {
    const args = {
      clientFirstName: data?.clientFirstName ?? null,
      practiceName: PRACTICE_NAME,
      bookings,
      clMentions: mention.cl
        ? [
            ...clCards.map((c) => ({
              petNames: petsIn(c.key).map((p) => p.name),
              around: plannerTargetDate(c.interval, data!.today),
            })),
            ...clVisits.map((v) => ({
              petNames: addedTo(v).map((p) => p.name),
              around: v.start.startOf('day'),
            })),
          ]
        : [],
      labsPetNames: mention.labs ? labsPets.map((p) => p.name) : [],
    };
    const parts = confirmationTextParts(args);
    // Wording edited in Settings → message templates wins over the built-in text.
    return tidyMergedText(
      applySystemTemplateIfCustom(
        'follow_up_booked_confirmation_sms',
        withClinicDefaults({
          client_first_name: args.clientFirstName ?? '',
          booked_visits: parts.bookedVisits,
          other_follow_ups: parts.otherFollowUps,
        }),
        buildFollowUpConfirmationText(args)
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, mention, clCards.length, clVisits.length, labsPets.length, data]);
  useEffect(() => {
    if (step === 'review' && !textEdited) setReviewText(buildText());
  }, [step, textEdited, buildText]);

  function doneBlocker(): string | null {
    if (openPets.length)
      return `Still needs a follow-up: ${joinNames(openPets.map((p) => p.name))}`;
    const draftWithPets = cards.filter(
      (c) => (c.status === 'draft' || c.status === 'searching') && petsIn(c.key).length
    );
    if (draftWithPets.length) {
      return `Book or send to the CLs: ${draftWithPets.map((c) => `"${cardLabel(c.key)}" card`).join(', ')}`;
    }
    for (const v of data?.upcoming ?? []) {
      if (addedTo(v).length && !upcoming[v.key]?.booking && !upcoming[v.key]?.clSend) {
        return `Press Add on the ${v.start.toFormat('LLL d')} visit, or take the pets off it`;
      }
    }
    for (const v of data?.upcoming ?? []) {
      const missing = addedTo(v).filter((p) => addedTypeFor(v, p) == null);
      if (missing.length) return `Pick a visit type for ${joinNames(missing.map((p) => p.name))}`;
    }
    for (const c of clCards) {
      const missing = untypedIn(c.key);
      if (missing.length) return `Pick a visit type for ${joinNames(missing.map((p) => p.name))}`;
    }
    if (petsIn(NONE).length && !noneReason.trim()) return 'Pick a reason for "No follow-up needed"';
    if (labsPets.length && labsAssignees.length === 0) return 'Pick who reviews the labs';
    return null;
  }

  /** What was done for each pet the planner was opened for, in plain words. */
  function focusSummary(): string | null {
    if (!focusPets.length || !data) return null;
    return focusPets
      .map((pet) => {
        const parts = (placements[pet.patientId] ?? []).flatMap((card) => {
          if (card === NONE) return [`no follow-up needed (${noneReason.trim()})`];
          if (card.startsWith('up:')) {
            const v = visitByKey.get(card.slice(3));
            if (v && upcoming[card.slice(3)]?.clSend && !v.petIds.includes(pet.patientId)) {
              return [`sent to the CLs to add to the ${v.start.toFormat('LLL d')} visit`];
            }
            return upcoming[card.slice(3)]?.booking && v
              ? [
                  `added to the ${fmtDay(v.start)} visit${v.provider ? ` with ${providerTextLabel(v.provider)}` : ''}`,
                ]
              : [];
          }
          const c = cardByKey.get(card);
          if (c?.status === 'booked' && c.booking) {
            return [
              `booked ${fmtDay(c.booking.start)}${c.booking.provider ? ` with ${providerTextLabel(c.booking.provider)}` : ''}`,
            ];
          }
          if (c?.status === 'cl') {
            return [
              `sent to the CLs (around ${plannerTargetDate(c.interval, data.today).toFormat('LLL d, yyyy')})`,
            ];
          }
          return [];
        });
        return `${pet.name}: ${parts.join('; ') || 'no change'}.`;
      })
      .join(' ');
  }

  async function saveAll() {
    if (!data) return;
    const blocker = doneBlocker();
    if (blocker) return setError(blocker);
    setBusy('done');
    setError(null);
    try {
      // 1. CL rows (one per pet per card), with each pet's note and the household note.
      const entryByPet = new Map<number, number>();
      for (const c of clCards) {
        const { entries } = await createPlannerForwardBookings({
          practiceId,
          clientId: data.clientId,
          pets: petsIn(c.key),
          interval: c.interval,
          today: data.today,
          providerId: cardProvider(c)?.id ?? null,
          typeIdFor: (p) => typeFor(p, c.key)!,
          premedsFor: (p) => premedsFor(p, c.key),
          serviceMinutes: await minutesForCard(c),
          notesFor: notesFor(c.key),
          links: links.current,
        });
        entries.forEach(
          (e) =>
            !entryByPet.has(Number(e.patientId)) &&
            entryByPet.set(Number(e.patientId), Number(e.id))
        );
      }
      // "Send to CLs" on a housemate visit: one row per added pet, aimed at that visit's
      // day and provider, its note saying where to add the pet and what it needs.
      const clNoteByPet = new Map<number, { interval: PlannerInterval; note: string }>();
      const suggestedBy = clVisits.length ? await myStaffName() : null;
      for (const v of clVisits) {
        const added = addedTo(v);
        const { entries } = await createPlannerForwardBookings({
          practiceId,
          clientId: data.clientId,
          pets: added,
          interval: visitInterval(v),
          today: data.today,
          providerId: v.provider?.id ?? null,
          typeIdFor: (p) => addedTypeFor(v, p)!,
          premedsFor: (p) => premedsFor(p, upKey(v.key)),
          serviceMinutes: upcoming[v.key]?.added?.minutes ?? 20,
          notesFor: (p) => clNoteForAdd(v, p, suggestedBy),
          links: links.current,
        });
        entries.forEach(
          (e) =>
            !entryByPet.has(Number(e.patientId)) &&
            entryByPet.set(Number(e.patientId), Number(e.id))
        );
        for (const p of added) {
          if (!clNoteByPet.has(p.patientId))
            clNoteByPet.set(p.patientId, { interval: visitInterval(v), note: clNoteForAdd(v, p, suggestedBy) });
        }
      }
      // 2. Labs tasks, one per pet.
      const taskByPet = new Map<number, number>();
      const remindDays = LABS_REMIND.find((r) => r.key === labsRemind)?.days ?? 3;
      for (const p of labsPets) {
        if (p.savedMode || !p.onTodaysVisit) continue;
        taskByPet.set(
          p.patientId,
          await createLabsTask({
            pet: p,
            clientId: data.clientId,
            practiceId,
            staffBranchIds,
            practiceBranchIds,
            assigneeIds: labsAssignees,
            watcherIds: labsWatchers,
            startAt: data.today
              .plus({ days: remindDays })
              .set({ hour: 9, minute: 0 })
              .toUTC()
              .toISO()!,
            note: notes[noteKey(p.patientId, LABS)]?.trim() ?? '',
          })
        );
      }
      // 3. One follow-up choice per pet on today's visit.
      for (const pet of todayPets) {
        if (pet.savedMode) continue;
        const mode = dispositionModeForOutcomes(outcomesFor(pet));
        if (!mode) continue;
        const disposition: ForwardBookingDisposition = { mode };
        if (mode === 'forward_book_fields') {
          const c = clCards.find((x) => petsIn(x.key).some((p) => p.patientId === pet.patientId));
          const toVisit = clNoteByPet.get(pet.patientId);
          if (c) {
            Object.assign(disposition, plannerIntervalForApi(c.interval, data.today), {
              bookingNotes: notesFor(c.key)(pet),
            });
          } else if (toVisit) {
            Object.assign(disposition, plannerIntervalForApi(toVisit.interval, data.today), {
              bookingNotes: toVisit.note,
            });
          }
        }
        if (mode === 'not_appropriate') disposition.bookingNotes = noneReason.trim();
        if (mode === 'labs_pending') {
          disposition.labsPendingTask = {
            assignedToEmployeeId: labsAssignees[0] ?? null,
            assignedToEmployeeIds: labsAssignees,
            watcherEmployeeIds: labsWatchers.filter((id) => !labsAssignees.includes(id)),
            title: `Forward book ${pet.name} once labs are back`,
            startAt: data.today
              .plus({ days: remindDays })
              .set({ hour: 9, minute: 0 })
              .toUTC()
              .toISO(),
            dueAt: null,
          };
        }
        const d: PetDisposition = {
          pet,
          disposition,
          entryId: entryByPet.get(pet.patientId) ?? null,
          taskId: taskByPet.get(pet.patientId) ?? null,
        };
        await savePetDisposition(d, practiceId);
      }
      setDirty(false);
      setSavedOnce(true);
      await onSaved({ focusSummary: focusSummary() });
      if (bookings.length) {
        setTextEdited(false);
        setStep('review');
      } else {
        finish('Follow-ups saved');
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save follow-ups. Nothing after the error was saved.'
      );
    } finally {
      setBusy(null);
    }
  }

  const canText = !!data?.clientPhone && !data?.doNotSms;
  const sendProvider = confirmationSendProvider(bookings);

  async function sendTextImpl() {
    if (!data) return;
    setBusy('send');
    setError(null);
    try {
      await sendPlannerConfirmationText({
        clientId: data.clientId,
        message: reviewText,
        sendProvider,
        patientIds: [...new Set(bookings.flatMap((b) => b.petIds))],
        practiceId,
      });
      finish(`Text sent to ${data.clientFirstName ?? 'the owner'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The text did not send.');
    } finally {
      setBusy(null);
    }
  }

  const sendText = useSubmitOnce(sendTextImpl);

  function finish(message: string) {
    setStep('plan');
    setToast({ text: message });
    onClose();
  }

  function requestClose() {
    if (layer) return void closeLayer();
    if (dirty && !readOnly) return setLeaveWarn(true);
    onClose();
  }

  if (!open) return null;

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  const avatar = (p: PlannerPet) => (
    <span className="fup-avatar" style={{ background: colorOf(p.patientId) }} aria-hidden="true">
      {p.name.slice(0, 1)}
    </span>
  );

  const remList = (
    pet: PlannerPet,
    card: string | null,
    opts?: { withHead?: boolean; canCopy?: boolean }
  ) => {
    if (!data) return null;
    const rows = data.remindersByPet[pet.patientId] ?? [];
    if (!rows.length) return null;
    const target = card ? targetFor(card) : null;
    const scored = rows.map((r) => ({
      ...r,
      fit: reminderFit(r.due, target, data.today) as ReminderFit,
    }));
    // On a card: everything due before or around the visit, plus the next two later ones.
    const expandKey = card ? noteKey(pet.patientId, card) : null;
    const expanded = expandKey ? expandedRems[expandKey] : false;
    const laterKeep = new Set(
      scored
        .filter((r) => r.fit === 'later')
        .slice(0, 2)
        .map((r) => r.key)
    );
    const shown = !card
      ? scored.slice(0, 3)
      : expanded
        ? scored
        : scored.filter((r) => r.fit !== 'later' || laterKeep.has(r.key));
    const hiddenCount = scored.length - shown.length;
    const fits = scored.filter((r) => r.fit === 'fits');
    const nothingNear = !!card && !scored.some((r) => ['fits', 'early', 'overdue'].includes(r.fit));
    const text = (r: (typeof scored)[number]) => {
      const due = r.due.toFormat(r.due.year === data.today.year ? 'LLL d' : 'LLL yyyy');
      switch (r.fit) {
        case 'overdue':
          return `Overdue since ${due}`;
        case 'early':
          return `Due ${due}, before this visit`;
        case 'fits':
          return 'Can be done at this visit';
        case 'later':
          return card ? `Due ${due}, after this visit` : `Due ${due}`;
        default:
          return `Due ${due}`;
      }
    };
    return (
      <>
        {opts?.withHead ? (
          <div className="fup-rems-head">
            <span>Reminders</span>
            {opts.canCopy && fits.length && card ? (
              <button
                type="button"
                className="fup-link"
                onClick={() => {
                  const k = noteKey(pet.patientId, card);
                  const cur = notes[k]?.trim() ?? '';
                  const add = fits.map((f) => f.name).filter((n) => !cur.includes(n));
                  setNotes((n) => ({ ...n, [k]: [cur, ...add].filter(Boolean).join(', ') }));
                  setDirty(true);
                }}
              >
                Add these to notes
              </button>
            ) : null}
          </div>
        ) : null}
        <ul className="fup-rems">
          {shown.map((r) => (
            <li key={r.key} className={`fup-rem fup-rem--${r.fit}`}>
              <span>
                {r.name}
                {r.fromToday ? <span className="fup-src">from today</span> : null}
              </span>
              <span className="fup-rem__when">{text(r)}</span>
            </li>
          ))}
          {hiddenCount > 0 && !card ? (
            <li className="fup-rem fup-rem--later">+ {hiddenCount} more</li>
          ) : null}
          {hiddenCount > 0 && expandKey ? (
            <li>
              <button
                type="button"
                className="fup-link"
                onClick={() => setExpandedRems((m) => ({ ...m, [expandKey]: true }))}
              >
                Show {hiddenCount} more
              </button>
            </li>
          ) : null}
          {nothingNear ? (
            <li className="fup-rem fup-rem--later">Nothing due around this visit</li>
          ) : null}
        </ul>
      </>
    );
  };

  const openMenu = (petId: number, from: string | null, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ petId, from, x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 6 });
  };

  /** Re-confirm a CL card whose pets' details changed. */
  const markCardDraft = (card: string) =>
    setCards((cs) =>
      cs.map((c) => (c.key === card && c.status === 'cl' ? { ...c, status: 'draft' } : c))
    );

  /** Visit type (staff name) and "Needs pre-meds" for one pet on one card. */
  const petVisitFields = (pet: PlannerPet, card: string) => {
    const k = noteKey(pet.patientId, card);
    const history = premedsHistory.get(String(pet.patientId));
    const premeds = premedsFor(pet, card);
    const missingType = typeErrorCards[card] === true && typeFor(pet, card) == null;
    return (
      <div className="fup-petfields">
        <label className={`fup-typepick${missingType ? ' is-invalid' : ''}`}>
          Visit type{' '}
          <select
            value={typeFor(pet, card) ?? ''}
            aria-label={`Visit type for ${pet.name}`}
            aria-invalid={missingType || undefined}
            onChange={(e) => {
              const id = Number(e.target.value);
              setPetTypes((t) => {
                const next = { ...t };
                if (id) next[k] = id;
                else delete next[k];
                return next;
              });
              markCardDraft(card);
              setDirty(true);
            }}
          >
            <option value="">Choose…</option>
            {(data?.bookableTypes ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {appointmentTypeStaffName(t)}
              </option>
            ))}
          </select>
        </label>
        {missingType ? (
          <div className="fup-field-error">Pick a visit type for {pet.name}</div>
        ) : null}
        <label className="fup-premeds">
          <input
            type="checkbox"
            checked={premeds}
            aria-label={`${pet.name} needs pre-meds`}
            onChange={(e) => {
              setPetPremeds((m) => ({ ...m, [k]: e.target.checked }));
              markCardDraft(card);
              setDirty(true);
            }}
          />{' '}
          Needs pre-meds
        </label>
        {history && premeds && petPremeds[k] === undefined ? (
          <div className="fup-muted fup-petfields__why">
            {premedsHistoryVisitReason(history, pet.name)}
          </div>
        ) : null}
      </div>
    );
  };

  /** "Echo needs pre-meds, so every pet on this visit gets the 1-hour arrival window." */
  const householdPremedsNote = (names: string[], total: number) => {
    if (!names.length) return null;
    return (
      <div className="fup-premeds-note">
        {joinNames(names)} {names.length > 1 ? 'need' : 'needs'} pre-meds, so{' '}
        {total > 1 ? 'every pet on this visit gets' : 'this visit gets'} the {premedsSpan} arrival
        window.
      </div>
    );
  };

  const inPlan = (
    pet: PlannerPet,
    card: string,
    opts?: { fixed?: boolean; noNotes?: boolean; readOnly?: boolean; visitFields?: boolean }
  ) => {
    const k = noteKey(pet.patientId, card);
    const locked = opts?.fixed || lockedAt(pet.patientId, card);
    // Locked pets can't leave this visit, but can still be added to another card.
    const canAddElsewhere = !opts?.readOnly && !pet.savedMode;
    const others = (placements[pet.patientId] ?? [])
      .filter((c) => c !== card && c !== NONE)
      .map(cardLabel);
    return (
      <div
        key={k}
        className={`fup-inplan${locked ? ' is-locked' : ''}`}
        draggable={!locked || canAddElsewhere}
        onDragStart={() => (dragRef.current = { petId: pet.patientId, from: card })}
      >
        <div className="fup-inplan__top">
          {locked && !canAddElsewhere ? (
            <>
              {avatar(pet)}
              <div>
                <div className="fup-pet-name">{pet.name}</div>
                <div className="fup-pet-meta">
                  {opts?.fixed ? 'Already booked' : 'Booked · change it on the calendar'}
                </div>
              </div>
            </>
          ) : locked ? (
            <button
              type="button"
              className="fup-who"
              aria-label={`${pet.name}: add another visit`}
              onClick={(e) => openMenu(pet.patientId, card, e.currentTarget)}
            >
              {avatar(pet)}
              <span>
                <span className="fup-pet-name">{pet.name}</span>
                <span className="fup-pet-meta">
                  {opts?.fixed ? 'Already booked' : 'Booked · change it on the calendar'}
                  {others.length ? ` · Also: ${others.join(', ')}` : ' · Tap to add another visit'}
                </span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="fup-who"
              aria-label={`${pet.name}: move or add another visit`}
              onClick={(e) => openMenu(pet.patientId, card, e.currentTarget)}
            >
              {avatar(pet)}
              <span>
                <span className="fup-pet-name">{pet.name}</span>
                <span className="fup-pet-meta">
                  {others.length
                    ? `Also: ${others.join(', ')}`
                    : 'Tap to move or add another visit'}
                </span>
              </span>
            </button>
          )}
          {!locked && !opts?.readOnly ? (
            <button
              type="button"
              className="fup-x"
              aria-label={`Take ${pet.name} off this card`}
              onClick={() => place(pet.patientId, '__tray', card, 'move')}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        {opts?.visitFields && !locked && !opts.readOnly ? petVisitFields(pet, card) : null}
        {remList(pet, card, { withHead: true, canCopy: !locked && !opts?.noNotes })}
        {opts?.noNotes ? null : (
          <input
            type="text"
            className="fup-input"
            value={notes[k] ?? ''}
            disabled={locked}
            placeholder={`What does ${pet.name} need? e.g. annual exam + vaccines`}
            aria-label={`What ${pet.name} needs`}
            onChange={(e) => {
              setNotes((n) => ({ ...n, [k]: e.target.value }));
              setDirty(true);
            }}
          />
        )}
      </div>
    );
  };

  const dropProps = (card: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragRef.current) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const d = dragRef.current;
      dragRef.current = null;
      if (d && d.from !== card) place(d.petId, card, d.from, d.from ? 'move' : 'add');
    },
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const trayToday = todayPets.filter(
    (p) => !p.savedMode && !(placements[p.patientId] ?? []).length
  );
  const savedToday = todayPets.filter((p) => p.savedMode);
  const trayOther = pets.filter(
    (p) => !p.onTodaysVisit && !p.focusReason && !(placements[p.patientId] ?? []).length
  );
  const trayFocus = focusPets.filter((p) => !(placements[p.patientId] ?? []).length);
  const flagged = trayOther
    .map((p) => {
      const urgent = (data?.remindersByPet[p.patientId] ?? []).filter((r) => {
        const f = reminderFit(r.due, null, data!.today);
        return f === 'overdue' || f === 'soon';
      });
      return urgent.length ? { pet: p, urgent } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const blocker = data ? doneBlocker() : null;

  const body = (
    <div className="fup-root" role="presentation">
      <button
        type="button"
        className="fup-overlay"
        aria-label="Close follow-ups"
        onClick={requestClose}
      />
      <section className="fup-planner" role="dialog" aria-modal="true" aria-labelledby="fup-title">
        <header className="fup-head">
          <div>
            <h2 id="fup-title">
              {step === 'review'
                ? 'Text the owner'
                : readOnly
                  ? 'Follow-ups'
                  : 'Schedule follow-ups'}
              {(data?.clientName ?? visit.clientName)
                ? ` · ${data?.clientName ?? visit.clientName}`
                : ''}
            </h2>
            <div className="fup-muted">
              {readOnly
                ? 'Saved for this visit. To change a booked visit, use the calendar.'
                : 'Group pets that should be seen together. One card is one future visit.'}
            </div>
          </div>
          <button type="button" className="fup-btn fup-btn--ghost" onClick={requestClose}>
            Close
          </button>
        </header>

        {!data ? (
          <div className="fup-body fup-body--center">{loadError ?? 'Loading the household…'}</div>
        ) : readOnly ? (
          <div className="fup-body fup-body--single">
            <ul className="fup-sum">
              {todayPets.map((p) => (
                <li key={p.patientId} className="fup-sum__item">
                  {avatar(p)}
                  <span>
                    <b>{p.name}</b> · {forwardBookingModeOption(p.savedMode!)?.label ?? p.savedMode}
                  </span>
                </li>
              ))}
            </ul>
            {data.upcoming.length ? (
              <>
                <h3 className="fup-group">On the calendar for this household</h3>
                <ul className="fup-sum">
                  {data.upcoming.map((v) => (
                    <li key={v.key} className="fup-sum__item">
                      <span>
                        <b>{fmtDay(v.start)}</b> ·{' '}
                        {joinNames(
                          v.petIds.map((id) => petById.get(id)?.name ?? '').filter(Boolean)
                        )}{' '}
                        · {v.provider ? v.provider.name : ''}
                      </span>
                      <button
                        type="button"
                        className="fup-btn fup-btn--sm"
                        onClick={() =>
                          viewOnCalendar(
                            Number(v.appointments[0].id),
                            v.start,
                            v.provider?.id ?? null,
                            fmtDay(v.start)
                          )
                        }
                      >
                        View appointment
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : step === 'review' ? (
          <div className="fup-body fup-review">
            <section>
              <h3>What was set up today</h3>
              <ul className="fup-sum">
                {[...bookings]
                  .sort((a, b) => a.start.toMillis() - b.start.toMillis())
                  .map((b, i) => (
                    <li key={i} className="fup-sum__item fup-sum__item--booked">
                      <span className="fup-sum__k">✓</span>
                      <span>
                        <b>{joinNames(b.petNames)}</b> · booked
                        <span className="fup-muted fup-block">
                          {fmtDay(b.start)}, arrive {fmtWindow(b.windowStart, b.windowEnd)} ·{' '}
                          {b.provider?.name ?? ''}
                          {b.joiningPetNames?.length
                            ? ` · with ${joinNames(b.joiningPetNames)}`
                            : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                {clCards.length ? (
                  <li className="fup-sum__item">
                    <span className="fup-sum__k">→</span>
                    <span>
                      <b>{joinNames(clCards.flatMap((c) => petsIn(c.key).map((p) => p.name)))}</b> ·
                      sent to the CLs
                      {clNote.trim() ? (
                        <span className="fup-muted fup-block">Note: {clNote.trim()}</span>
                      ) : null}
                      <label className="fup-check">
                        <input
                          type="checkbox"
                          checked={mention.cl}
                          onChange={(e) => setMention((m) => ({ ...m, cl: e.target.checked }))}
                        />{' '}
                        Mention in the text
                      </label>
                    </span>
                  </li>
                ) : null}
                {labsPets.length ? (
                  <li className="fup-sum__item">
                    <span className="fup-sum__k">⚗</span>
                    <span>
                      <b>{joinNames(labsPets.map((p) => p.name))}</b> · labs pending
                      <label className="fup-check">
                        <input
                          type="checkbox"
                          checked={mention.labs}
                          onChange={(e) => setMention((m) => ({ ...m, labs: e.target.checked }))}
                        />{' '}
                        Mention in the text
                      </label>
                    </span>
                  </li>
                ) : null}
              </ul>
            </section>
            <section className="fup-phone">
              <h3>Confirmation text</h3>
              {canText ? (
                <>
                  <div className="fup-muted">
                    To <b>{data.clientName ?? 'owner'}</b> · {data.clientPhone} ·{' '}
                    {sendProvider
                      ? `from ${providerTextLabel(sendProvider)}'s line`
                      : 'from the practice main line'}{' '}
                    <button type="button" className="fup-link" onClick={() => setTextEdited(false)}>
                      Reset wording
                    </button>
                  </div>
                  <textarea
                    className="fup-bubble"
                    value={reviewText}
                    aria-label="Text message to the owner"
                    onChange={(e) => {
                      setReviewText(e.target.value);
                      setTextEdited(true);
                    }}
                  />
                  <div className="fup-muted">
                    {reviewText.length} characters · sends as {smsSegmentCount(reviewText)} text
                    {smsSegmentCount(reviewText) > 1 ? 's' : ''}
                  </div>
                  <div className="fup-muted">
                    Turn the screen around so the owner can check dates and pet names before you
                    send.
                  </div>
                </>
              ) : (
                <div className="fup-warnbox">
                  {data.textsOffReason
                    ? `${data.textsOffReason}.`
                    : data.doNotSms
                    ? 'This client is marked do-not-text.'
                    : 'No mobile number on file.'}{' '}
                  {data.clientEmails.length
                    ? 'Send the confirmation by email instead.'
                    : 'No email on file either, so nothing can be sent.'}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="fup-body">
            <aside className="fup-tray">
              {todayPets.length ? (
                <div className="fup-tray__sec" {...dropProps('__tray')}>
                  <h3>Today&apos;s visit · needs a plan</h3>
                  {trayToday.length ? (
                    trayToday.map((p) => (
                      <button
                        key={p.patientId}
                        type="button"
                        className="fup-pet"
                        draggable
                        onDragStart={() => (dragRef.current = { petId: p.patientId, from: null })}
                        onClick={(e) => openMenu(p.patientId, null, e.currentTarget)}
                      >
                        {avatar(p)}
                        <span className="fup-pet__txt">
                          <span className="fup-pet-name">{p.name}</span>
                          <span className="fup-pet-meta">{p.species ?? 'Tap to choose'}</span>
                        </span>
                        <span className="fup-grip" aria-hidden="true">
                          ⋮⋮
                        </span>
                        <span className="fup-pet__rems">{remList(p, null)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="fup-ok">✓ Every pet on today&apos;s visit has a card</div>
                  )}
                  {savedToday.map((p) => (
                    <div key={p.patientId} className="fup-pet is-saved">
                      {avatar(p)}
                      <span className="fup-pet__txt">
                        <span className="fup-pet-name">{p.name}</span>
                        <span className="fup-pet-meta">
                          Saved: {forwardBookingModeOption(p.savedMode!)?.label}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {focusPets.length ? (
                <div className="fup-tray__sec">
                  <h3>{focusPets[0].focusReason} · needs a plan</h3>
                  {trayFocus.length ? (
                    trayFocus.map((p) => (
                      <button
                        key={p.patientId}
                        type="button"
                        className="fup-pet"
                        draggable
                        onDragStart={() => (dragRef.current = { petId: p.patientId, from: null })}
                        onClick={(e) => openMenu(p.patientId, null, e.currentTarget)}
                      >
                        {avatar(p)}
                        <span className="fup-pet__txt">
                          <span className="fup-pet-name">{p.name}</span>
                          <span className="fup-pet-meta">
                            {p.inactive ? 'Marked inactive · check the chart' : 'Tap to choose'}
                          </span>
                        </span>
                        <span className="fup-grip" aria-hidden="true">
                          ⋮⋮
                        </span>
                        <span className="fup-pet__rems">{remList(p, null)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="fup-ok">
                      ✓ {joinNames(focusPets.map((p) => p.name))} has a card
                    </div>
                  )}
                </div>
              ) : null}
              <div className="fup-tray__sec">
                <h3>
                  {todayPets.length || focusPets.length
                    ? 'Rest of household · optional'
                    : 'Household'}
                </h3>
                {trayOther.length ? (
                  trayOther.map((p) => (
                    <button
                      key={p.patientId}
                      type="button"
                      className="fup-pet"
                      draggable
                      onDragStart={() => (dragRef.current = { petId: p.patientId, from: null })}
                      onClick={(e) => openMenu(p.patientId, null, e.currentTarget)}
                    >
                      {avatar(p)}
                      <span className="fup-pet__txt">
                        <span className="fup-pet-name">{p.name}</span>
                        <span className="fup-pet-meta">
                          {todayPets.length ? "Not on today's visit" : 'Tap to choose'}
                        </span>
                      </span>
                      <span className="fup-grip" aria-hidden="true">
                        ⋮⋮
                      </span>
                      <span className="fup-pet__rems">{remList(p, null)}</span>
                    </button>
                  ))
                ) : data.householdError ? (
                  <div className="fup-error" role="alert">
                    {data.householdError}
                  </div>
                ) : pets.some((p) => !p.onTodaysVisit && !p.focusReason) ? (
                  <div className="fup-muted">Everyone else is booked or planned.</div>
                ) : (
                  <div className="fup-muted">No other pets in this household.</div>
                )}
              </div>
            </aside>

            <main className="fup-lanes">
              {flagged.length ? (
                <div className="fup-headsup">
                  {flagged.map(({ pet, urgent }) => (
                    <div key={pet.patientId}>
                      <b>{pet.name}</b> has nothing booked and is{' '}
                      {urgent
                        .map((r) =>
                          r.due < data.today.startOf('day')
                            ? `overdue for ${r.name} (since ${r.due.toFormat('LLL d')})`
                            : `due for ${r.name} (${r.due.toFormat('LLL d')})`
                        )
                        .join(' and ')}
                      . Add {pet.name} to a card below?
                    </div>
                  ))}
                </div>
              ) : null}

              {data.upcoming.length ? (
                <h3 className="fup-group">Already on the calendar for this household</h3>
              ) : null}
              <div className="fup-cards">
                {data.upcoming.map((v) => {
                  const st = upcoming[v.key];
                  const added = addedTo(v);
                  const fixed = v.petIds
                    .map((id) => petById.get(id))
                    .filter((p): p is PlannerPet => !!p);
                  const booking = st?.booking;
                  const lateStops = st?.impact?.laterStops.filter((s) => s.warns) ?? [];
                  return (
                    <article
                      key={v.key}
                      className={`fup-card fup-card--existing${booking ? ' fup-card--booked' : ''}`}
                      {...dropProps(upKey(v.key))}
                    >
                      <div className="fup-card__head">
                        <div>
                          <div className="fup-card__title">{fmtDay(v.start)}</div>
                          <div className="fup-muted">
                            {v.typeName} · {v.provider?.name ?? 'No provider'} · arrive{' '}
                            {fmtWindow(v.windowStart, v.windowEnd)}
                          </div>
                        </div>
                        <span className="fup-tag">Upcoming</span>
                      </div>
                      {fixed.map((p) => inPlan(p, upKey(v.key), { fixed: true, noNotes: true }))}
                      {added.map((p) => (
                        <div key={p.patientId} className="fup-added">
                          {inPlan(p, upKey(v.key), { visitFields: !booking })}
                        </div>
                      ))}
                      {added.length && !booking
                        ? householdPremedsNote(
                            [
                              ...fixed
                                .filter((f) =>
                                  v.appointments.some(
                                    (a) =>
                                      a.needsPremeds === true &&
                                      patientsForAppointment(a).some(
                                        (x) => Number(x.id) === f.patientId
                                      )
                                  )
                                )
                                .map((f) => f.name),
                              ...added
                                .filter((p) => premedsFor(p, upKey(v.key)))
                                .map((p) => p.name),
                            ],
                            fixed.length + added.length
                          )
                        : null}
                      {!booking && !st?.adding ? (
                        <div className="fup-drop">Drop a pet here to add them to this visit</div>
                      ) : null}
                      {added.length && !booking ? (
                        <>
                          <div className="fup-small">
                            <b>
                              Adds about {st?.added ? st.added.minutes : '…'} min
                              {st?.added?.source === 'stats'
                                ? ` (${v.provider ? providerTextLabel(v.provider) : 'provider'}'s last 30 days)`
                                : st?.added
                                  ? ' (type default length)'
                                  : ''}
                              .
                            </b>{' '}
                            {(() => {
                              const win = premedsWindowFor(v);
                              return win
                                ? `Arrival window narrows to ${fmtWindow(
                                    win.start,
                                    win.end
                                  )} for every pet (pre-meds).`
                                : `Arrival window stays ${fmtWindow(v.windowStart, v.windowEnd)}.`;
                            })()}
                            {st?.impactLoading
                              ? ' Checking the rest of the day…'
                              : st?.impactError
                                ? ` ${st.impactError}`
                                : st?.impact
                                  ? ' Later stops that day:'
                                  : ''}
                          </div>
                          {st?.impact?.laterStops.length ? (
                            <ul className="fup-impact">
                              {st.impact.laterStops.map((s) => (
                                <li key={s.key} className={s.warns ? 'is-bad' : 'is-ok'}>
                                  <span>{s.warns ? '⚠' : '✓'}</span>
                                  <span>
                                    {s.client}
                                    {s.windowStart && s.windowEnd
                                      ? ` · window ${fmtWindow(s.windowStart, s.windowEnd)}`
                                      : ''}
                                    {s.etaAfter
                                      ? ` · arrives ~${s.etaAfter.toFormat('h:mm a')}`
                                      : ''}
                                    {s.warns ? (
                                      <b>
                                        {s.minutesPastWindow > 0
                                          ? `, ${s.minutesPastWindow} min past their window`
                                          : ', at the edge of their window'}
                                      </b>
                                    ) : null}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : st?.impact ? (
                            <div className="fup-small">
                              No other visits after this one that day.
                            </div>
                          ) : null}
                          {st?.clSend ? (
                            <div className="fup-status-row">
                              <div className="fup-status fup-status--cl">
                                Goes to the CLs when you press Done: add{' '}
                                {joinNames(added.map((p) => p.name))} to this visit.
                              </div>
                              <button
                                type="button"
                                className="fup-btn fup-btn--sm"
                                onClick={() => unmarkAddForCls(v.key)}
                              >
                                Undo
                              </button>
                            </div>
                          ) : (
                            <div className="fup-actions">
                              <button
                                type="button"
                                className="fup-btn fup-btn--primary"
                                disabled={st?.adding}
                                onClick={() => void confirmAdd(v)}
                              >
                                {st?.adding
                                  ? 'Adding…'
                                  : lateStops.length
                                    ? 'Add anyway'
                                    : `Add ${joinNames(added.map((p) => p.name))}`}
                              </button>
                              {lateStops.length ? (
                                <button
                                  type="button"
                                  className="fup-btn"
                                  disabled={st?.adding}
                                  title="Leave the visit as it is; the CLs add the pets at Done"
                                  onClick={() => markAddForCls(v)}
                                >
                                  Send to CLs
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="fup-btn"
                                onClick={() =>
                                  viewOnCalendar(
                                    Number(v.appointments[0].id),
                                    v.start,
                                    v.provider?.id ?? null,
                                    fmtDay(v.start),
                                    st?.impact
                                      ? {
                                          endIso: st.impact.newEnd.toUTC().toISO()!,
                                          originalEndIso: v.appointments[0].appointmentEnd,
                                        }
                                      : undefined
                                  )
                                }
                              >
                                View in calendar
                              </button>
                              {lateStops.length ? (
                                <button
                                  type="button"
                                  className="fup-btn fup-btn--ghost"
                                  onClick={() => moveAddedElsewhere(v)}
                                >
                                  Find a different time
                                </button>
                              ) : null}
                            </div>
                          )}
                        </>
                      ) : null}
                      {booking ? (
                        <div className="fup-status-row">
                          <div
                            className={`fup-status ${lateStops.length ? 'fup-status--warn' : 'fup-status--ok'}`}
                          >
                            ✓ {joinNames(added.map((p) => p.name))} added.
                            {lateStops.length
                              ? ` ${lateStops.map((s) => s.client).join(', ')} may arrive past their window. Scheduling will see the warning.`
                              : ''}
                          </div>
                          <button
                            type="button"
                            className="fup-btn fup-btn--sm"
                            onClick={() =>
                              viewOnCalendar(
                                booking.appointmentIds[0],
                                v.start,
                                v.provider?.id ?? null,
                                fmtDay(v.start)
                              )
                            }
                          >
                            View appointment
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <h3 className="fup-group">New follow-up visits</h3>
              <div className="fup-cards">
                {cards.map((c) => {
                  const ps = petsIn(c.key);
                  const draft = c.status === 'draft' || c.status === 'cl';
                  const target = plannerTargetDate(c.interval, data.today);
                  const prov = cardProvider(c);
                  return (
                    <article
                      key={c.key}
                      className={`fup-card${c.status === 'booked' ? ' fup-card--booked' : ''}`}
                      {...dropProps(c.key)}
                    >
                      <div className="fup-card__head">
                        <div>
                          <div className="fup-card__title">
                            {plannerIntervalLabel(c.interval, data.today)}
                          </div>
                          <div className="fup-muted">
                            Target around {target.toFormat('LLL d, yyyy')}
                          </div>
                        </div>
                        {c.status === 'draft' ? (
                          <button
                            type="button"
                            className="fup-btn fup-btn--ghost fup-btn--sm"
                            onClick={() => {
                              setPlacements((prev) =>
                                Object.fromEntries(
                                  Object.entries(prev).map(([k, v]) => [
                                    k,
                                    v.filter((x) => x !== c.key),
                                  ])
                                )
                              );
                              setCards((cs) => cs.filter((x) => x.key !== c.key));
                            }}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      {draft ? (
                        <>
                          <IntervalPicker
                            value={c.interval}
                            onChange={(interval) => {
                              setCards((cs) =>
                                cs.map((x) =>
                                  x.key === c.key
                                    ? {
                                        ...x,
                                        interval,
                                        status: 'draft',
                                      }
                                    : x
                                )
                              );
                              setDirty(true);
                            }}
                          />
                          {/* Doctor is for the whole household, so it sits with the timing. */}
                          <div className="fup-opts fup-opts--provider">
                            {todayProvider ? (
                              <label>
                                <input
                                  type="checkbox"
                                  checked={c.keepToday}
                                  onChange={(e) =>
                                    setCards((cs) =>
                                      cs.map((x) =>
                                        x.key === c.key
                                          ? {
                                              ...x,
                                              keepToday: e.target.checked,
                                              status: 'draft',
                                              providerId:
                                                x.providerId ??
                                                data.providers.find(
                                                  (p) => p.id !== data.todayProviderId
                                                )?.id ??
                                                null,
                                            }
                                          : x
                                      )
                                    )
                                  }
                                />{' '}
                                Keep {providerTextLabel(todayProvider)}
                              </label>
                            ) : null}
                            {!c.keepToday ? (
                              <label>
                                With{' '}
                                <select
                                  value={c.providerId ?? ''}
                                  aria-label="Provider for this visit"
                                  onChange={(e) =>
                                    setCards((cs) =>
                                      cs.map((x) =>
                                        x.key === c.key
                                          ? {
                                              ...x,
                                              providerId: Number(e.target.value) || null,
                                              status: 'draft',
                                            }
                                          : x
                                      )
                                    )
                                  }
                                >
                                  <option value="">Choose…</option>
                                  {data.providers
                                    .filter((p) => p.id !== data.todayProviderId || !todayProvider)
                                    .map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                </select>
                              </label>
                            ) : null}
                          </div>
                          {cardMinutes[c.key] ? (
                            <div className="fup-muted">
                              About {cardMinutes[c.key].minutes} min
                              {cardMinutes[c.key].source === 'stats'
                                ? ` · from ${providerTextLabel(cardProvider(c))}'s last 30 days`
                                : ' · type default length'}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {ps.length ? (
                        ps.map((p) => inPlan(p, c.key, { visitFields: draft }))
                      ) : (
                        <div className="fup-drop">Drag pets here</div>
                      )}
                      {draft && ps.length
                        ? householdPremedsNote(
                            ps.filter((p) => premedsFor(p, c.key)).map((p) => p.name),
                            ps.length
                          )
                        : null}
                      {c.status === 'draft' ? (
                        <div className="fup-actions">
                          <button
                            type="button"
                            className="fup-btn fup-btn--primary"
                            disabled={
                              !ps.length || busy === c.key || (!c.keepToday && !c.providerId)
                            }
                            onClick={() => {
                              if (!requireTypes(c.key)) return;
                              void findTime(c);
                            }}
                          >
                            {busy === c.key ? 'Starting…' : 'Find a time now'}
                          </button>
                          <button
                            type="button"
                            className="fup-btn"
                            disabled={!ps.length}
                            onClick={() => {
                              if (!requireTypes(c.key)) return;
                              setCards((cs) =>
                                cs.map((x) => (x.key === c.key ? { ...x, status: 'cl' } : x))
                              );
                              setDirty(true);
                              setToast({ text: 'Marked for the CLs. Saved when you press Done.' });
                            }}
                          >
                            Send to CLs to book
                          </button>
                        </div>
                      ) : null}
                      {c.status === 'cl' ? (
                        <div className="fup-status-row">
                          <div className="fup-status fup-status--cl">
                            Goes to the CLs when you press Done. Target{' '}
                            {target.toFormat('LLL d, yyyy')}
                            {prov ? ` with ${providerTextLabel(prov)}` : ''}.
                          </div>
                          <button
                            type="button"
                            className="fup-btn fup-btn--sm"
                            onClick={() =>
                              setCards((cs) =>
                                cs.map((x) => (x.key === c.key ? { ...x, status: 'draft' } : x))
                              )
                            }
                          >
                            Undo
                          </button>
                        </div>
                      ) : null}
                      {c.status === 'searching' ? (
                        <div className="fup-status fup-status--cl">
                          Finding a time in the calendar…
                        </div>
                      ) : null}
                      {c.status === 'booked' && c.booking ? (
                        <div className="fup-status-row">
                          <div className="fup-status fup-status--ok">
                            ✓ Booked · {fmtDay(c.booking.start)} · arrive{' '}
                            {fmtWindow(c.booking.windowStart, c.booking.windowEnd)}
                            {c.booking.provider ? ` · ${c.booking.provider.name}` : ''}
                          </div>
                          <button
                            type="button"
                            className="fup-btn fup-btn--sm"
                            onClick={() =>
                              viewOnCalendar(
                                c.booking!.appointmentIds[0],
                                c.booking!.start,
                                c.booking!.provider?.id ?? null,
                                fmtDay(c.booking!.start)
                              )
                            }
                          >
                            View appointment
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                <div className="fup-newcard" {...dropProps('__new')}>
                  <p>Another visit at a different time?</p>
                  <div className="fup-chips">
                    {PLANNER_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        className="fup-chip"
                        onClick={() => addCard({ kind: 'preset', key: p.key })}
                      >
                        + {p.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="fup-chip"
                      onClick={() => addCard({ kind: 'custom', amount: 10, unit: 'weeks' })}
                    >
                      + Custom
                    </button>
                  </div>
                  <div className="fup-muted">Or drop a pet here to start a new card.</div>
                </div>
              </div>

              {cards.some((c) => c.status === 'cl') ? (
                <div className="fup-clnote">
                  <label htmlFor="fup-clnote">
                    <b>Note for the CLs about this household</b>
                  </label>
                  <textarea
                    id="fup-clnote"
                    className="fup-input"
                    value={clNote}
                    placeholder="e.g. Owner prefers Tuesdays, call the cell, gate code 4412"
                    onChange={(e) => {
                      setClNote(e.target.value);
                      setDirty(true);
                    }}
                  />
                  <div className="fup-muted">
                    Saved with every forward booking row for this household when you press Done.
                  </div>
                </div>
              ) : null}

              <h3 className="fup-group">Not booking today</h3>
              <div className="fup-cards">
                <article className="fup-card fup-card--labs" {...dropProps(LABS)}>
                  <div className="fup-card__head">
                    <div>
                      <div className="fup-card__title">Labs pending</div>
                      <div className="fup-muted">
                        Book once results are back. Creates a task for each pet.
                      </div>
                    </div>
                  </div>
                  {labsPets.length ? (
                    labsPets.map((p) => inPlan(p, LABS))
                  ) : (
                    <div className="fup-drop">Drag pets here</div>
                  )}
                  {labsPets.length ? (
                    <div className="fup-opts">
                      <div className="fup-labs-people">
                        <StaffMultiPick
                          label="Who reviews"
                          hint="Starts with the visit's doctor and the techs who work with them. Each person gets their own linked copy."
                          employees={employees}
                          selectedIds={labsAssignees}
                          ariaLabel="Who reviews the labs"
                          onToggle={(id, checked) => {
                            labsPeopleEdited.current = true;
                            setLabsAssignees((cur) =>
                              checked
                                ? [...cur.filter((n) => n !== id), id]
                                : cur.filter((n) => n !== id)
                            );
                            if (checked) setLabsWatchers((cur) => cur.filter((n) => n !== id));
                          }}
                        />
                        <StaffMultiPick
                          label="Watching"
                          hint="Optional. Notified, but not doing the work."
                          employees={employees}
                          selectedIds={labsWatchers}
                          ariaLabel="Who watches the labs task"
                          onToggle={(id, checked) => {
                            labsPeopleEdited.current = true;
                            setLabsWatchers((cur) =>
                              checked
                                ? [...cur.filter((n) => n !== id), id]
                                : cur.filter((n) => n !== id)
                            );
                            if (checked) setLabsAssignees((cur) => cur.filter((n) => n !== id));
                          }}
                        />
                      </div>
                      <label>
                        Remind{' '}
                        <select value={labsRemind} onChange={(e) => setLabsRemind(e.target.value)}>
                          {LABS_REMIND.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </article>
                <article className="fup-card fup-card--none" {...dropProps(NONE)}>
                  <div className="fup-card__head">
                    <div>
                      <div className="fup-card__title">No follow-up needed</div>
                      <div className="fup-muted">A reason is required.</div>
                    </div>
                  </div>
                  {petsIn(NONE).length ? (
                    petsIn(NONE).map((p) => inPlan(p, NONE, { noNotes: true }))
                  ) : (
                    <div className="fup-drop">Drag pets here</div>
                  )}
                  {petsIn(NONE).length ? (
                    <>
                      <div className="fup-chips">
                        {NONE_REASONS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            className={`fup-chip${noneReason === r ? ' is-on' : ''}`}
                            onClick={() => setNoneReason(r)}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      <input
                        className="fup-input"
                        value={NONE_REASONS.includes(noneReason) ? '' : noneReason}
                        placeholder="Or type a reason"
                        aria-label="Reason no follow-up is needed"
                        onChange={(e) => setNoneReason(e.target.value)}
                      />
                    </>
                  ) : null}
                </article>
              </div>
            </main>
          </div>
        )}

        {error ? (
          <div className="fup-error" role="alert">
            {error}
          </div>
        ) : null}

        {data && !readOnly ? (
          <footer className="fup-foot">
            {step === 'review' ? (
              <>
                <button
                  type="button"
                  className="fup-btn fup-btn--ghost"
                  onClick={() => finish('Follow-ups saved. No text sent.')}
                >
                  Finish without texting
                </button>
                {canText ? (
                  <button
                    type="button"
                    className="fup-btn fup-btn--primary fup-btn--big"
                    disabled={busy === 'send' || !reviewText.trim()}
                    onClick={() => void sendText()}
                  >
                    {busy === 'send' ? 'Sending…' : 'Send text & finish'}
                  </button>
                ) : data.clientEmails.length ? (
                  <button
                    type="button"
                    className="fup-btn fup-btn--primary fup-btn--big"
                    onClick={() => setEmailOpen(true)}
                  >
                    Email instead
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <div className="fup-progress">
                  {mustPlan.map((p) => {
                    const done = !!p.savedMode || outcomesFor(p).length > 0;
                    const labels = (placements[p.patientId] ?? [])
                      .filter((c) => outcomeAt(p, c))
                      .map(cardLabel);
                    return (
                      <span key={p.patientId} className={`fup-dot${done ? ' is-done' : ''}`}>
                        {done ? '✓' : '○'} {p.name}
                        {p.savedMode ? ' · saved' : labels.length ? ` · ${labels.join(' + ')}` : ''}
                      </span>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="fup-btn fup-btn--primary fup-btn--big"
                  disabled={busy === 'done'}
                  title={blocker ?? undefined}
                  onClick={() => void saveAll()}
                >
                  {busy === 'done'
                    ? 'Saving…'
                    : blocker
                      ? 'Done'
                      : bookings.length
                        ? 'Done · next: text the owner'
                        : 'Done'}
                </button>
              </>
            )}
          </footer>
        ) : null}
      </section>

      {menu && data ? (
        <MoveMenu
          pet={petById.get(menu.petId)!}
          from={menu.from}
          pinned={menu.from != null && lockedAt(menu.petId, menu.from)}
          fromLabel={menu.from ? visitLabel(menu.from) : null}
          x={menu.x}
          y={menu.y}
          placements={placements[menu.petId] ?? []}
          options={[
            ...data.upcoming
              .filter((v) => !upcoming[v.key]?.booking && !v.petIds.includes(menu.petId))
              .map((v) => ({
                card: upKey(v.key),
                label: `${joinNames(v.petIds.map((id) => petById.get(id)?.name ?? '').filter(Boolean)) || 'Household'} visit · ${fmtDay(v.start)}`,
              })),
            ...cards
              .filter((c) => c.status === 'draft' || c.status === 'cl')
              .map((c) => {
                const others = petsIn(c.key).filter((p) => p.patientId !== menu.petId);
                return {
                  card: c.key,
                  label: `"${plannerIntervalLabel(c.interval, data.today)}" card${others.length ? ` (with ${joinNames(others.map((p) => p.name))})` : ''}`,
                };
              }),
            { card: '__new', label: 'A new follow-up card' },
            ...(petById.get(menu.petId)?.onTodaysVisit
              ? [{ card: LABS, label: 'Labs pending' }]
              : []),
          ]}
          onPick={(card, mode) => {
            place(menu.petId, card, menu.from, mode);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {layer?.kind === 'fit' ? (
        <PlannerBestFitPanel
          key={layer.cardKey}
          cardLabel={(() => {
            const c = cards.find((x) => x.key === layer.cardKey);
            return c && data ? plannerIntervalLabel(c.interval, data.today) : 'Follow-up';
          })()}
          targetLabel={(() => {
            const t = targetFor(layer.cardKey);
            return t ? t.toFormat('LLL d, yyyy') : '';
          })()}
          request={layer.request}
          tz={tz}
          needs={fitNeeds}
          onNeedChange={(petId, text) => {
            setFitNeeds((n) => ({ ...n, [petId]: text }));
            setNotes((n) => ({ ...n, [noteKey(petId, layer.cardKey)]: text }));
          }}
          onBook={(slot, ctx) => bookFromPanel(layer.cardKey, slot, ctx)}
          onBooked={() => setLayer(null)}
          onReview={(slot, ctx) => void reviewSlotInNewTab(slot, ctx)}
          onOpenFull={() => openFullCalendarInNewTab(layer.request)}
          onClose={() => void closeLayer()}
        />
      ) : null}

      {leaveWarn ? (
        <div
          className="fup-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="fup-leave-title"
        >
          <div className="fup-confirm__card">
            <h3 id="fup-leave-title">Follow-ups aren&apos;t finished</h3>
            <LeaveSummary
              notSaved={[
                ...clCards.map(
                  (c) => `${joinNames(petsIn(c.key).map((p) => p.name))} → forward booking list`
                ),
                ...clVisits.map(
                  (v) =>
                    `${joinNames(addedTo(v).map((p) => p.name))} → CLs, to add to the ${v.start.toFormat('LLL d')} visit`
                ),
                ...(labsPets.length
                  ? [`${joinNames(labsPets.map((p) => p.name))} → labs pending task`]
                  : []),
                ...(petsIn(NONE).length
                  ? [`${joinNames(petsIn(NONE).map((p) => p.name))} → no follow-up`]
                  : []),
              ]}
              open={openPets.map((p) => p.name)}
              onCalendar={bookings.map((b) => `${joinNames(b.petNames)} · ${fmtDay(b.start)}`)}
            />
            <div className="fup-actions fup-actions--end">
              <button
                type="button"
                className="fup-btn"
                onClick={() => {
                  setLeaveWarn(false);
                  setDirty(false);
                  onClose();
                }}
              >
                Leave without saving
              </button>
              <button
                type="button"
                className="fup-btn fup-btn--primary"
                ref={(el) => el?.focus()}
                onClick={() => setLeaveWarn(false)}
              >
                Keep working
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fup-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo ? (
            <button type="button" onClick={toast.undo}>
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      {emailOpen && data ? (
        <ClientContactComposeModal
          open
          clientId={data.clientId}
          clientLabel={data.clientName ?? 'Client'}
          initialSmsMessage={reviewText || buildText()}
          emailFormat="forward_booking"
          canText={false}
          smsSource="follow_up_confirmation"
          patientIds={data.pets.map((p) => p.patientId)}
          onClose={() => setEmailOpen(false)}
          onSent={() => {
            setEmailOpen(false);
            finish('Email sent · follow-ups saved');
          }}
        />
      ) : null}
    </div>
  );

  return createPortal(body, document.body);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function IntervalPicker({
  value,
  onChange,
}: {
  value: PlannerInterval;
  onChange: (v: PlannerInterval) => void;
}) {
  const isCustom = value.kind !== 'preset';
  const [amount, setAmount] = useState(value.kind === 'custom' ? value.amount : 10);
  const [unit, setUnit] = useState<PlannerCustomUnit>(
    value.kind === 'custom' ? value.unit : 'weeks'
  );
  return (
    <div className="fup-interval">
      <div className="fup-chips" role="group" aria-label="How soon">
        {PLANNER_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`fup-chip${value.kind === 'preset' && value.key === p.key ? ' is-on' : ''}`}
            onClick={() => onChange({ kind: 'preset', key: p.key })}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`fup-chip${isCustom ? ' is-on' : ''}`}
          onClick={() => onChange({ kind: 'custom', amount, unit })}
        >
          Custom
        </button>
      </div>
      {isCustom ? (
        <div className="fup-custom">
          <span>In</span>
          <input
            type="number"
            min={1}
            max={60}
            value={value.kind === 'custom' ? amount : ''}
            aria-label="How many"
            onChange={(e) => {
              const n = Math.max(1, Number(e.target.value) || 1);
              setAmount(n);
              onChange({ kind: 'custom', amount: n, unit });
            }}
          />
          <select
            value={unit}
            aria-label="Unit"
            onChange={(e) => {
              const u = e.target.value as PlannerCustomUnit;
              setUnit(u);
              onChange({ kind: 'custom', amount, unit: u });
            }}
          >
            {(['days', 'weeks', 'months', 'years'] as const).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <span>or on</span>
          <input
            type="date"
            value={value.kind === 'date' ? value.date : ''}
            aria-label="Specific date"
            onChange={(e) => e.target.value && onChange({ kind: 'date', date: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  );
}

function MoveMenu(props: {
  pet: PlannerPet;
  from: string | null;
  /** Booked on `from`: it can be added elsewhere but not moved off. */
  pinned?: boolean;
  fromLabel?: string | null;
  x: number;
  y: number;
  placements: string[];
  options: { card: string; label: string }[];
  onPick: (card: string, mode: 'add' | 'move') => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [props]);
  const avail = props.options.filter((o) => !props.placements.includes(o.card));
  const top = Math.max(8, Math.min(props.y, window.innerHeight - 380));
  return (
    <div ref={ref} className="fup-menu" role="menu" style={{ left: Math.max(8, props.x), top }}>
      <div className="fup-menu__h">{props.pet.name}</div>
      {props.from && props.pinned ? (
        <>
          <div className="fup-menu__h">
            Stays on the {props.fromLabel ?? 'booked visit'}. Also book {props.pet.name} in…
          </div>
          {avail.map((o) => (
            <button
              key={`a${o.card}`}
              type="button"
              role="menuitem"
              onClick={() => props.onPick(o.card, 'add')}
            >
              <CalendarPlus size={14} /> {o.label}
            </button>
          ))}
        </>
      ) : props.from ? (
        <>
          <div className="fup-menu__h">Also book {props.pet.name} in…</div>
          {avail.map((o) => (
            <button
              key={`a${o.card}`}
              type="button"
              role="menuitem"
              onClick={() => props.onPick(o.card, 'add')}
            >
              <CalendarPlus size={14} /> {o.label}
            </button>
          ))}
          <div className="fup-menu__h">Move {props.pet.name} to…</div>
          {avail.map((o) => (
            <button
              key={`m${o.card}`}
              type="button"
              role="menuitem"
              onClick={() => props.onPick(o.card, 'move')}
            >
              {o.label}
            </button>
          ))}
          {props.pet.onTodaysVisit || props.pet.focusReason ? (
            <button type="button" role="menuitem" onClick={() => props.onPick(NONE, 'move')}>
              No follow-up needed
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => props.onPick('__tray', 'move')}>
            Take off this card
          </button>
        </>
      ) : (
        <>
          <div className="fup-menu__h">Where does {props.pet.name} go?</div>
          {avail.map((o) => (
            <button
              key={o.card}
              type="button"
              role="menuitem"
              onClick={() => props.onPick(o.card, 'add')}
            >
              {o.label}
            </button>
          ))}
          {props.pet.onTodaysVisit || props.pet.focusReason ? (
            <button type="button" role="menuitem" onClick={() => props.onPick(NONE, 'add')}>
              No follow-up needed
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function LeaveSummary({
  notSaved,
  open,
  onCalendar,
}: {
  notSaved: string[];
  open: string[];
  onCalendar: string[];
}) {
  return (
    <div className="fup-small">
      {notSaved.length ? (
        <>
          <p>
            <b>Not saved yet</b> (saved when you press Done):
          </p>
          <ul>
            {notSaved.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      ) : null}
      {open.length ? (
        <p>
          <b>Still need a follow-up:</b> {joinNames(open)}
        </p>
      ) : null}
      {onCalendar.length ? (
        <>
          <p>
            <b>Already on the calendar</b> (stays booked):
          </p>
          <ul>
            {onCalendar.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="fup-muted">No confirmation text has been sent.</p>
    </div>
  );
}
