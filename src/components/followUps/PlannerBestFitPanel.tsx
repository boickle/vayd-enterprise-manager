import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  bestFitQualities,
  bestFitReason,
  NO_BEST_FIT_PREFS,
  searchPlannerBestFit,
  type BestFitPlace,
  type BestFitPrefs,
  type BestFitRequest,
  type BestFitSlot,
} from './plannerBestFit';

export type BestFitBookOutcome = { ok: true; warnings: string[] } | { ok: false; error: string };

type Props = {
  /** Card title, e.g. "In 1 year". */
  cardLabel: string;
  /** The card's target date, e.g. "Nov 3, 2027". */
  targetLabel: string;
  request: BestFitRequest;
  tz: string;
  /** "What does <pet> need?" per pet id (the visit's Description). */
  needs: Record<number, string>;
  onNeedChange: (petId: number, text: string) => void;
  /** Book the slot (no calendar). */
  onBook: (
    slot: BestFitSlot,
    ctx: { request: BestFitRequest; place: BestFitPlace }
  ) => Promise<BestFitBookOutcome>;
  /** After the booked confirmation: back to the plan. */
  onBooked: () => void;
  /** The calendar in a new tab at this slot (day, doctor, the proposed visit in place). */
  onReview: (slot: BestFitSlot, ctx: { request: BestFitRequest; place: BestFitPlace }) => void;
  /** The normal calendar page, in a new tab. */
  onOpenFull: () => void;
  onClose: () => void;
  /** How long the booked confirmation shows before the plan comes back. */
  confirmMs?: number;
};

const TIMES: { key: BestFitPrefs['timeOfDay']; label: string; title: string }[] = [
  { key: null, label: 'Any time', title: 'Any time of day' },
  { key: 'first', label: 'Mornings', title: 'Early in the day (Get Best Route: Early)' },
  { key: 'end', label: 'Afternoons', title: 'Later in the day (Get Best Route: End of day)' },
];
// Get Best Route's day chips (ISO weekday numbers).
const DAYS = [
  { n: 1, label: 'M', title: 'Monday' },
  { n: 2, label: 'T', title: 'Tuesday' },
  { n: 3, label: 'W', title: 'Wednesday' },
  { n: 4, label: 'Th', title: 'Thursday' },
  { n: 5, label: 'F', title: 'Friday' },
  { n: 6, label: 'Sa', title: 'Saturday' },
  { n: 7, label: 'Su', title: 'Sunday' },
];

function slotDay(slot: BestFitSlot): string {
  return DateTime.fromISO(slot.date).toFormat('ccc, LLL d, yyyy');
}

/** "9:00–11:00 AM arrival" (or the visit's own times when there is no window). */
function slotTimes(slot: BestFitSlot, minutes: number, tz: string): string {
  const fmt = (a: DateTime, b: DateTime) =>
    a.toFormat('a') === b.toFormat('a')
      ? `${a.toFormat('h:mm')}–${b.toFormat('h:mm a')}`
      : `${a.toFormat('h:mm a')}–${b.toFormat('h:mm a')}`;
  const at = (iso: string) => DateTime.fromISO(iso).setZone(tz);
  if (slot.windowStartIso && slot.windowEndIso && slot.windowStartIso !== slot.windowEndIso) {
    return `${fmt(at(slot.windowStartIso), at(slot.windowEndIso))} arrival`;
  }
  const start = at(slot.suggestedStartIso);
  return fmt(start, start.plus({ minutes }));
}

/**
 * "Find a time now" on a Schedule follow-ups card: best-route matches near the card's
 * target date, with the owner's preferences, booked straight from the list.
 */
export default function PlannerBestFitPanel({
  cardLabel,
  targetLabel,
  request,
  tz,
  needs,
  onNeedChange,
  onBook,
  onBooked,
  onReview,
  onOpenFull,
  onClose,
  confirmMs = 1500,
}: Props) {
  const [prefs, setPrefs] = useState<BestFitPrefs>(NO_BEST_FIT_PREFS);
  const [asap, setAsap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<BestFitSlot[]>([]);
  const [place, setPlace] = useState<BestFitPlace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ text: string; warnings: string[] } | null>(null);
  const [fullOpened, setFullOpened] = useState(false);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (nextPrefs: BestFitPrefs, nextAsap: boolean) => {
      const n = ++seq.current;
      setLoading(true);
      setError(null);
      const res = await searchPlannerBestFit({
        req: request,
        tz,
        asap: nextAsap,
        prefs: nextPrefs,
      });
      if (n !== seq.current || !mounted.current) return;
      setSlots(res.slots);
      setPlace(res.place);
      setError(res.error);
      setLoading(false);
    },
    [request, tz]
  );

  useEffect(() => {
    void run(NO_BEST_FIT_PREFS, false);
    // Search once on open; later searches come from the preferences.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Any preference change searches again with the same routing call. */
  const change = (next: Partial<BestFitPrefs>, nextAsap = asap) => {
    const p = { ...prefs, ...next };
    setPrefs(p);
    setAsap(nextAsap);
    void run(p, nextAsap);
  };

  // The planner re-renders every half second during Undo; keep the timer steady.
  const onBookedRef = useRef(onBooked);
  onBookedRef.current = onBooked;
  useEffect(() => {
    if (!booked) return;
    const t = window.setTimeout(() => onBookedRef.current(), confirmMs);
    return () => window.clearTimeout(t);
  }, [booked, confirmMs]);

  const qualities = useMemo(() => bestFitQualities(slots), [slots]);
  const petNames = request.pets.map((p) => p.name);
  const missingNeeds = request.pets.filter((p) => !(needs[p.id] ?? '').trim());
  const canBook = !missingNeeds.length && !booking && !booked && !!place;
  const doctor = asap ? 'Any doctor in zone' : (request.providerLabel ?? request.providerName);
  const needWord = missingNeeds.length > 1 ? 'need' : 'needs';
  const missingText = missingNeeds.map((p) => p.name).join(' and ');

  async function book(slot: BestFitSlot) {
    if (!place || !canBook) return;
    setBooking(slot.key);
    setError(null);
    const res = await onBook(slot, { request, place });
    if (!mounted.current) return;
    setBooking(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBooked({
      text: `Booked ${petNames.join(' & ')} · ${slotDay(slot)} · ${slotTimes(
        slot,
        request.serviceMinutes,
        tz
      )}`,
      warnings: res.warnings,
    });
  }

  return (
    <aside className="fup-fit" role="dialog" aria-modal="true" aria-label="Find a time">
      <div className="fup-fit__head">
        <div>
          <h2 className="fup-fit__title">Find a time · {petNames.join(', ')}</h2>
          <div className="fup-muted fup-fit__sub">
            {[
              cardLabel,
              `about ${request.serviceMinutes} min`,
              `target ${targetLabel}`,
              doctor,
              request.needsPremeds ? 'needs pre-meds' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <button type="button" className="fup-btn fup-fit__back" onClick={onClose}>
          Back to plan
        </button>
      </div>

      <div className="fup-fit__body" aria-busy={loading}>
        {booked ? (
          <div className="fup-fit__booked" role="status">
            <b>✓ {booked.text}</b>
            {booked.warnings.map((w) => (
              <div key={w} className="fup-muted">
                {w}
              </div>
            ))}
            <div className="fup-muted">Back to the plan…</div>
          </div>
        ) : null}

        <div className="fup-fit__needs">
          {request.pets.map((p) => (
            <label key={p.id} className="fup-fit__need">
              <b>What does {p.name} need?</b>
              <input
                type="text"
                value={needs[p.id] ?? ''}
                placeholder="e.g. annual exam and vaccines"
                onChange={(e) => onNeedChange(p.id, e.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="fup-fit__prefs">
          <b>What works for the owner?</b>
          <div className="fup-chips" role="group" aria-label="Time of day">
            {TIMES.map((t) => (
              <button
                key={t.label}
                type="button"
                title={t.title}
                className={`fup-chip${prefs.timeOfDay === t.key ? ' is-on' : ''}`}
                aria-pressed={prefs.timeOfDay === t.key}
                onClick={() => prefs.timeOfDay !== t.key && change({ timeOfDay: t.key })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="fup-chips" role="group" aria-label="Days">
            <button
              type="button"
              className={`fup-chip${prefs.weekdays.length ? '' : ' is-on'}`}
              aria-pressed={!prefs.weekdays.length}
              onClick={() => prefs.weekdays.length && change({ weekdays: [] })}
            >
              Any day
            </button>
            {DAYS.map((d) => {
              const on = prefs.weekdays.includes(d.n);
              return (
                <button
                  key={d.n}
                  type="button"
                  title={d.title}
                  aria-label={d.title}
                  aria-pressed={on}
                  className={`fup-chip fup-chip--day${on ? ' is-on' : ''}`}
                  onClick={() =>
                    change({
                      weekdays: on
                        ? prefs.weekdays.filter((x) => x !== d.n)
                        : [...prefs.weekdays, d.n].sort((a, b) => a - b),
                    })
                  }
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <div className="fup-chips" role="group" aria-label="More options">
            <button
              type="button"
              className={`fup-chip${prefs.earliest ? ' is-on' : ''}`}
              aria-pressed={prefs.earliest}
              title="Get Best Route: Force earliest available (may reduce routing efficiency)"
              onClick={() => change({ earliest: !prefs.earliest })}
            >
              Earliest available
            </button>
            <button
              type="button"
              className={`fup-chip${asap ? ' is-on' : ''}`}
              aria-pressed={asap}
              title="Get Best Route: ASAP, best fit across the doctors seeing this zone"
              onClick={() => change({}, !asap)}
            >
              Any doctor in zone
            </button>
          </div>
        </div>

        <p className="fup-muted fup-fit__explain">
          Best route matches near the target date, ranked by drive time and how full that day is.
        </p>

        {missingNeeds.length > 0 && slots.length > 0 && !loading ? (
          <div className="fup-fit__hint">
            Say what {missingText} {needWord} to book.
          </div>
        ) : null}

        {loading ? <div className="fup-muted">Finding the best times…</div> : null}
        {!loading && error ? (
          <div className="fup-error" role="alert">
            {error}
          </div>
        ) : null}
        {!loading && !error && !slots.length ? (
          <div className="fup-muted">
            No openings near the target date with these choices. Try other days or times, or open
            the full calendar.
          </div>
        ) : null}

        {!loading && slots.length > 0 ? (
          <ul className="fup-fit__list">
            {slots.map((s) => {
              const quality = qualities.get(s.key) ?? 'Good';
              return (
                <li key={s.key} className="fup-fit__slot">
                  <div className="fup-fit__slot-txt">
                    <b className="fup-fit__when">
                      {slotDay(s)} · {slotTimes(s, request.serviceMinutes, tz)}
                    </b>
                    <div className="fup-fit__why">
                      <span
                        className={`fup-fit__tag fup-fit__tag--${quality
                          .toLowerCase()
                          .replace(/\s+/g, '-')}`}
                      >
                        {quality}
                      </span>{' '}
                      {bestFitReason(s)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="fup-btn fup-fit__review"
                    disabled={!place || !!booking || !!booked}
                    title="Open the calendar in a new tab at this time"
                    aria-label={`Review ${slotDay(s)} with ${s.doctorName} in the calendar`}
                    onClick={() => {
                      if (!place) return;
                      setReviewed(s.key);
                      setFullOpened(true);
                      onReview(s, { request, place });
                    }}
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    className="fup-btn fup-btn--primary fup-fit__book"
                    disabled={!canBook}
                    title={
                      missingNeeds.length ? `Say what ${missingText} ${needWord} first` : undefined
                    }
                    aria-label={`Book ${slotDay(s)} with ${s.doctorName}`}
                    onClick={() => void book(s)}
                  >
                    {booking === s.key ? 'Booking…' : 'Book'}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="fup-fit__foot">
          <button
            type="button"
            className="fup-btn fup-btn--sm"
            onClick={() => {
              setReviewed(null);
              setFullOpened(true);
              onOpenFull();
            }}
          >
            Open the full calendar in a new tab
          </button>
          {fullOpened ? (
            <div className="fup-muted fup-fit__note">
              {reviewed
                ? 'That time is open in the calendar in another tab. Book there and this card updates.'
                : 'The calendar is open in another tab. Book there and this card updates.'}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
