import { useCallback, useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  searchPlannerBestFit,
  type BestFitPlace,
  type BestFitRequest,
  type BestFitSlot,
  type BestFitWindow,
} from './plannerBestFit';

type Props = {
  /** Card title, e.g. "In 2 weeks". */
  cardLabel: string;
  request: BestFitRequest;
  tz: string;
  /** A slot was picked: book it through the calendar. */
  onPick: (
    slot: BestFitSlot,
    ctx: { request: BestFitRequest; place: BestFitPlace }
    /** False: the slot could not be put on the calendar (the panel says so). */
  ) => Promise<boolean | void> | boolean | void;
  /** The full Find a time view (Get Best Route + calendar) with this window. */
  onOpenFull: (window: BestFitWindow) => void;
  onClose: () => void;
};

function secsToPretty(s: number | null): string {
  if (s == null) return '-';
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function slotTimes(slot: BestFitSlot, minutes: number, tz: string): string {
  const at = (iso: string) => DateTime.fromISO(iso).setZone(tz).toFormat('h:mm a');
  if (slot.windowStartIso && slot.windowEndIso && slot.windowStartIso !== slot.windowEndIso) {
    return `${at(slot.windowStartIso)} – ${at(slot.windowEndIso)} arrival`;
  }
  const start = DateTime.fromISO(slot.suggestedStartIso);
  return `${at(slot.suggestedStartIso)} – ${at(start.plus({ minutes }).toISO()!)}`;
}

function scoreText(score: number | null): string | null {
  if (score == null) return null;
  return `Score ${Number.isInteger(score) ? score : score.toFixed(2)}`;
}

/**
 * "Find a time now" on a Schedule follow-ups card: the card's best-fit slots in a
 * compact panel on the right. Picking one shows it on the calendar to book.
 */
export default function PlannerBestFitPanel({
  cardLabel,
  request,
  tz,
  onPick,
  onOpenFull,
  onClose,
}: Props) {
  const [win, setWin] = useState<BestFitWindow>(request.window);
  const [asap, setAsap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<BestFitSlot[]>([]);
  const [place, setPlace] = useState<BestFitPlace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (window: BestFitWindow, asapAll: boolean) => {
      const n = ++seq.current;
      setLoading(true);
      setError(null);
      const res = await searchPlannerBestFit({
        req: { ...request, window },
        tz,
        asap: asapAll,
      });
      if (n !== seq.current) return;
      setSlots(res.slots);
      setPlace(res.place);
      setError(res.error);
      setLoading(false);
    },
    [request, tz]
  );

  useEffect(() => {
    void run(request.window, false);
    // Search once on open; later searches come from the controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const windowValid = !!win.startDate && !!win.endDate && win.endDate >= win.startDate;
  const pets = request.pets.map((p) => p.name).join(', ');

  return (
    <aside className="fup-fit" role="dialog" aria-modal="true" aria-label="Best fit">
      <div className="fup-fit__head">
        <div>
          <b>Best fit · {cardLabel}</b>
          <div className="fup-muted">
            {[
              request.clientLabel,
              pets,
              request.typeLabel,
              `${request.serviceMinutes} min`,
              asap ? 'All doctors in zone' : request.providerName,
              request.needsPremeds ? 'Needs pre-meds' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <button type="button" className="fup-btn" onClick={onClose}>
          Back to follow-ups
        </button>
      </div>

      <form
        className="fup-fit__controls"
        onSubmit={(e) => {
          e.preventDefault();
          if (windowValid) void run(win, asap);
        }}
      >
        <label>
          From
          <input
            type="date"
            value={win.startDate}
            onChange={(e) => setWin((w) => ({ ...w, startDate: e.target.value }))}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={win.endDate}
            min={win.startDate}
            onChange={(e) => setWin((w) => ({ ...w, endDate: e.target.value }))}
          />
        </label>
        <button type="submit" className="fup-btn" disabled={!windowValid || loading}>
          Search
        </button>
        <label className="fup-fit__asap">
          <input
            type="checkbox"
            checked={asap}
            onChange={(e) => {
              setAsap(e.target.checked);
              if (windowValid) void run(win, e.target.checked);
            }}
          />
          ASAP all doctors in zone
        </label>
      </form>

      <div className="fup-fit__list" aria-busy={loading}>
        {loading ? <div className="fup-muted">Finding the best times…</div> : null}
        {!loading && error ? (
          <div className="fup-error" role="alert">
            {error}
          </div>
        ) : null}
        {!loading && !error && !slots.length ? (
          <div className="fup-muted">
            No openings in this window. Widen the dates, try ASAP all doctors in zone, or open the
            full calendar.
          </div>
        ) : null}
        {!loading &&
          slots.map((s) => (
            <button
              key={s.key}
              type="button"
              className="fup-fit__slot"
              disabled={picking != null || !place}
              aria-label={`Book ${DateTime.fromISO(s.date).toFormat('ccc, LLL d')} with ${s.doctorName}`}
              onClick={() => {
                if (!place) return;
                setPicking(s.key);
                void Promise.resolve(onPick(s, { request: { ...request, window: win }, place }))
                  .then((ok) => {
                    if (ok === false && mounted.current)
                      setError(
                        'Could not open that slot on the calendar. Try another, or open the full calendar.'
                      );
                  })
                  .finally(() => {
                    if (mounted.current) setPicking(null);
                  });
              }}
            >
              <span className="fup-fit__when">
                <b>{DateTime.fromISO(s.date).toFormat('ccc, LLL d')}</b>{' '}
                {slotTimes(s, request.serviceMinutes, tz)}
              </span>
              <span className="fup-fit__who">
                {s.doctorName}
                {s.isFallbackDoctor ? ' · not the requested doctor' : ''}
                {s.emptyDay ? ' · empty day' : ''}
              </span>
              <span className="fup-fit__meta">
                {[
                  scoreText(s.score),
                  `Added drive ${secsToPretty(s.addedDriveSeconds)}`,
                  s.projectedDriveSeconds != null
                    ? `Day drive ${secsToPretty(s.projectedDriveSeconds)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          ))}
      </div>

      <div className="fup-fit__foot">
        <button
          type="button"
          className="fup-link"
          onClick={() => onOpenFull(windowValid ? win : request.window)}
        >
          Open full calendar
        </button>
      </div>
    </aside>
  );
}
