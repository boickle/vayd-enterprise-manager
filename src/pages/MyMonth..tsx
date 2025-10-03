// src/pages/MyMonth.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { fetchDoctorMonthSchedule, DaySchedule } from '../api/schedule';
import { http } from '../api/http';
import { PreviewMyDayModal } from '../components/PreviewMyDayModal';

// Basic types reused from your app’s pattern
type Doctor = {
  id?: string | number;
  pimsId?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  employeeId?: string | number;
  employee?: {
    id?: string | number;
    pimsId?: string;
    firstName?: string;
    lastName?: string;
  };
};

const DOCTORS_SEARCH_URL = '/employees/search';

// ---- helpers ----
function localDoctorDisplayName(d: Doctor) {
  const fn = d.employee?.firstName ?? d.firstName;
  const ln = d.employee?.lastName ?? d.lastName;
  return d.name || [fn, ln].filter(Boolean).join(' ') || 'Unknown';
}
function doctorPimsIdOf(d: Doctor): string {
  const pid = d.employee?.pimsId ?? d.pimsId;
  if (pid) return String(pid);
  const maybePims = d.employeeId;
  return maybePims ? String(maybePims) : '';
}
function hmsToSec(hms?: string): number | undefined {
  if (!hms) return undefined;
  const [hh = 0, mm = 0, ss = 0] = hms.split(':').map(Number);
  if ([hh, mm, ss].some((n) => Number.isNaN(n))) return undefined;
  return hh * 3600 + mm * 60 + ss;
}
function secsPretty(s?: number) {
  if (s == null) return '—';
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function minSinceMidnight(iso: string, tz: string): number {
  const dt = DateTime.fromISO(iso, { zone: tz });
  if (!dt.isValid) return 0;
  return dt.hour * 3600 + dt.minute * 60 + dt.second;
}

// Layout lanes for overlapping intervals (appointments + blocks)
type LaneItem = {
  id: string | number;
  start: number; // seconds since windowStart
  end: number; // seconds since windowStart
  type: 'appt' | 'block';
  title?: string;
  lane?: number;
};
function packLanes(items: LaneItem[]): { items: LaneItem[]; laneCount: number } {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = []; // end time per lane (seconds)
  for (const it of sorted) {
    let placed = false;
    for (let li = 0; li < laneEnds.length; li++) {
      if (it.start >= laneEnds[li]) {
        it.lane = li;
        laneEnds[li] = it.end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      it.lane = laneEnds.length;
      laneEnds.push(it.end);
    }
  }
  return { items: sorted, laneCount: Math.max(1, laneEnds.length) };
}

// Build a working window for the day from schedule or from payload times
function computeWindow(d: DaySchedule) {
  const tz = d.timezone || 'America/New_York';

  const ws = hmsToSec(d.workStartLocal);
  const we = hmsToSec(d.workEndLocal);
  const hasSchedule = ws != null && we != null && we > ws;

  if (hasSchedule) {
    return { tz, startSec: ws!, endSec: we!, windowSec: we! - ws!, hasSchedule: true };
  }

  // Derive from appts/blocks if no schedule
  const secs: number[] = [];
  (d.appts || []).forEach((a) => {
    secs.push(minSinceMidnight(a.startIso, tz), minSinceMidnight(a.endIso, tz));
  });
  (d.blocks || []).forEach((b) => {
    secs.push(minSinceMidnight(b.startIso, tz), minSinceMidnight(b.endIso, tz));
  });

  if (secs.length >= 2) {
    const startSec = Math.min(...secs);
    const endSec = Math.max(...secs);
    if (endSec > startSec) {
      return { tz, startSec, endSec, windowSec: endSec - startSec, hasSchedule: false };
    }
  }

  // Fallback (8–17) only if absolutely nothing else
  const startSec = 8 * 3600;
  const endSec = 17 * 3600;
  return { tz, startSec, endSec, windowSec: endSec - startSec, hasSchedule: false };
}
// ---- multipet grouping helpers (for FREE calculation only) ----
function round5(n: number) {
  return Math.round(n * 1e5) / 1e5;
}
function norm(s?: string) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function addrKey(a: any) {
  const addr1 = norm(a?.address1);
  const city = norm(a?.city);
  const state = norm(a?.state);
  const zip = (a?.zip ?? '').toString().trim().toLowerCase();
  const joined = [addr1, city, state, zip].filter(Boolean).join('|');
  return joined || null;
}
function locationKey(a: any) {
  const lat = typeof a?.lat === 'number' ? a.lat : undefined;
  const lon = typeof a?.lon === 'number' ? a.lon : undefined;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `geo:${round5(lat!)},${round5(lon!)}`;
  }
  const ak = addrKey(a);
  if (ak) return `addr:${ak}`;
  const t = norm(a?.title);
  return t ? `title:${t}` : null;
}

/** Sum appointment seconds counting multi-pet at the same household & slot ONCE. */
function groupedAppointmentSeconds(d: DaySchedule, clampToWindow: (iso: string) => number) {
  const groups = new Map<string, { start: number; end: number; maxServiceSec: number }>();

  for (const a of d.appts || []) {
    const s = clampToWindow(a.startIso);
    const e = clampToWindow(a.endIso);
    if (!(e > s)) continue;

    // Group by location (lat/lon or address if present), otherwise by title,
    // and always by the exact time slot (s|e).
    const keyBase = locationKey(a) ?? 'slot';
    const slot = `${s}|${e}`;
    const key = `${keyBase}|${slot}`;

    const serviceSec =
      typeof a.serviceMinutes === 'number' && a.serviceMinutes > 0
        ? Math.floor(a.serviceMinutes * 60)
        : e - s;

    const prev = groups.get(key);
    if (prev) {
      // Keep union time and the maximum service seconds among the grouped appts.
      prev.start = Math.min(prev.start, s);
      prev.end = Math.max(prev.end, e);
      prev.maxServiceSec = Math.max(prev.maxServiceSec, serviceSec);
    } else {
      groups.set(key, { start: s, end: e, maxServiceSec: serviceSec });
    }
  }

  // Count each group once. Use the max serviceSec but cap at the group's union duration.
  let total = 0;
  for (const g of groups.values()) {
    const union = Math.max(0, g.end - g.start);
    total += Math.min(g.maxServiceSec, union);
  }
  return total;
}

export default function MyMonth() {
  // doctor search
  const [doctorQuery, setDoctorQuery] = useState('');
  const [doctorResults, setDoctorResults] = useState<Doctor[]>([]);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const [doctorActiveIdx, setDoctorActiveIdx] = useState(-1);
  const doctorBoxRef = useRef<HTMLDivElement | null>(null);
  const [doctorId, setDoctorId] = useState<string>(''); // pimsId
  const [doctorName, setDoctorName] = useState<string>('');

  // pims -> internal id cache
  const [doctorIdByPims, setDoctorIdByPims] = useState<Record<string, string>>({});

  // month nav (cursor is month/year only)
  const now = DateTime.local();
  const [cursor, setCursor] = useState<DateTime>(now.startOf('month'));

  // data
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<DaySchedule[]>([]);
  const [error, setError] = useState<string | null>(null);

  // modal state for Doctor Day
  const [myDayOpen, setMyDayOpen] = useState(false);
  const [previewOpt, setPreviewOpt] = useState<any | null>(null);

  // doctor search effect
  useEffect(() => {
    const q = doctorQuery.trim();
    if (!q) {
      setDoctorResults([]);
      setShowDoctorDropdown(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { data } = await http.get(DOCTORS_SEARCH_URL, { params: { q } });
        setDoctorResults(Array.isArray(data) ? data : []);
        setShowDoctorDropdown(true);
      } catch {
        setDoctorResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [doctorQuery]);

  // close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (doctorBoxRef.current && !doctorBoxRef.current.contains(e.target as Node)) {
        setShowDoctorDropdown(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // fetch month schedule
  useEffect(() => {
    async function run() {
      if (!doctorId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDoctorMonthSchedule(doctorId, cursor.year, cursor.month);
        setDays(data || []);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load month schedule');
        setDays([]);
      } finally {
        setLoading(false);
      }
    }
    run();
  }, [doctorId, cursor]);

  // timezone for calendar math (from payload; fallback to NY)
  const tz = days?.[0]?.timezone || 'America/New_York';

  // calendar matrix (Monday → Sunday) built in DOCTOR TZ
  const calendarCells = useMemo(() => {
    const monthStart = DateTime.fromObject(
      { year: cursor.year, month: cursor.month, day: 1 },
      { zone: tz }
    );
    const start = monthStart.minus({ days: (monthStart.weekday + 6) % 7 }).startOf('day'); // Monday start
    const monthEnd = monthStart.endOf('month');
    const end = monthEnd.plus({ days: (7 - monthEnd.weekday) % 7 }).startOf('day'); // Sunday end

    const cells: DateTime[] = [];
    for (let d = start; d <= end; d = d.plus({ days: 1 })) cells.push(d);
    return cells;
  }, [cursor.year, cursor.month, tz]);

  // map day data for quick lookup
  const dayMap = useMemo(() => {
    const m = new Map<string, DaySchedule>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  // compute free time & prepared layout per day
  function computeDayLayout(dayDT: DateTime) {
    const iso = dayDT.setZone(tz).toISODate()!;
    const d = dayMap.get(iso);

    if (!d) {
      // No payload at all for this date → show Off
      return {
        items: [] as LaneItem[],
        laneCount: 1,
        freeSeconds: undefined as number | undefined,
        off: true,
        windowSec: 0,
      };
    }

    const { tz: dayTz, startSec, endSec, windowSec, hasSchedule } = computeWindow(d);
    const hasPayload = (d.appts?.length ?? 0) > 0 || (d.blocks?.length ?? 0) > 0;

    // Off only if no payload and no provided schedule
    const off = !hasPayload && !hasSchedule;

    const clampToWindow = (isoStr: string) => {
      const abs = minSinceMidnight(isoStr, dayTz);
      const rel = abs - startSec;
      return clamp(rel, 0, windowSec);
    };

    const items: LaneItem[] = [];

    // blocks (grey)
    for (const b of d.blocks || []) {
      const s = clampToWindow(b.startIso);
      const e = clampToWindow(b.endIso);
      if (e > s) items.push({ id: b.id, start: s, end: e, type: 'block', title: b.title });
    }
    // appointments (blue)
    for (const a of d.appts || []) {
      const s = clampToWindow(a.startIso);
      const e = clampToWindow(a.endIso);
      if (e > s) items.push({ id: a.id, start: s, end: e, type: 'appt', title: a.title });
    }

    const { items: packed, laneCount } = packLanes(items);

    // available = work window - blocks - appt service - drive
    const blockSec = (d.blocks || []).reduce((sum, b) => {
      const s = clampToWindow(b.startIso);
      const e = clampToWindow(b.endIso);
      return sum + Math.max(0, e - s);
    }, 0);

    const apptSec = groupedAppointmentSeconds(d, clampToWindow);

    const driveSec = Math.max(0, Math.floor(d.driveSeconds ?? 0));
    const freeSeconds = Math.max(0, windowSec - blockSec - apptSec - driveSec);

    return { items: packed, laneCount, freeSeconds, off, windowSec };
  }

  // resolve internal employee id from a PIMS id (cached)
  async function resolveInternalDoctorId(pimsId: string): Promise<string | undefined> {
    if (!pimsId) return undefined;
    const cached = doctorIdByPims[pimsId];
    if (cached) return cached;

    try {
      const { data } = await http.get(`/employees/pims/${encodeURIComponent(pimsId)}`);
      const emp = Array.isArray(data) ? data[0] : data;
      const internalId =
        (emp?.id != null ? String(emp.id) : undefined) ??
        (emp?.employee?.id != null ? String(emp.employee.id) : undefined);
      if (internalId) {
        setDoctorIdByPims((m) => ({ ...m, [pimsId]: internalId }));
        return internalId;
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  // open Doctor Day modal for a given date (uses internal id)
  async function openDoctorDay(dateIso: string) {
    if (!doctorId) return;
    const internalId = await resolveInternalDoctorId(doctorId);
    if (!internalId) return;

    // The PreviewMyDayModal expects an "option" object; it only needs date + doctor id.
    setPreviewOpt({
      doctorPimsId: internalId, // INTERNAL id as expected by DoctorDay/Preview
      doctorName: doctorName || 'Doctor',
      date: dateIso,
      // extras that the modal safely ignores if not used
      insertionIndex: 0,
      suggestedStartIso: `${dateIso}T08:00:00`,
    });
    setMyDayOpen(true);
  }

  function closeMyDay() {
    setMyDayOpen(false);
    setPreviewOpt(null);
  }

  // styling
  const CELL_BODY_HEIGHT = 140; // px height for the in-day timeline
  const APPT_COLOR = '#93c5fd'; // blue
  const BLOCK_COLOR = '#e5e7eb'; // grey

  return (
    <div className="grid" style={{ alignItems: 'start' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>My Month</h2>

        {/* Controls */}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {/* Doctor picker */}
          <div>
            <label className="label">Doctor</label>
            <div ref={doctorBoxRef} style={{ position: 'relative' }}>
              <input
                className="input"
                placeholder="Type doctor name..."
                value={doctorQuery}
                onChange={(e) => {
                  setDoctorQuery(e.target.value);
                  setDoctorActiveIdx(-1);
                }}
                onFocus={() => doctorResults.length && setShowDoctorDropdown(true)}
                onKeyDown={(e) => {
                  if (!doctorResults.length) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setShowDoctorDropdown(true);
                    setDoctorActiveIdx((i) => (i < doctorResults.length - 1 ? i + 1 : 0));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setShowDoctorDropdown(true);
                    setDoctorActiveIdx((i) => (i <= 0 ? doctorResults.length - 1 : i - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const pick =
                      doctorActiveIdx >= 0 ? doctorResults[doctorActiveIdx] : doctorResults[0];
                    if (pick) {
                      const pid = doctorPimsIdOf(pick);
                      setDoctorId(pid);
                      const name = localDoctorDisplayName(pick);
                      setDoctorName(name);
                      setDoctorQuery(name);
                      setShowDoctorDropdown(false);
                      setDoctorResults([]);
                    }
                  } else if (e.key === 'Escape') {
                    setShowDoctorDropdown(false);
                  }
                }}
              />
              {showDoctorDropdown && doctorResults.length > 0 && (
                <ul
                  className="dropdown"
                  role="listbox"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: '#fff',
                    border: '1px solid #ccc',
                    borderRadius: 8,
                    boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    maxHeight: 260,
                    overflowY: 'auto',
                    zIndex: 1000,
                  }}
                >
                  {doctorResults.map((d, i) => {
                    const selected = i === doctorActiveIdx;
                    const key = doctorPimsIdOf(d) || String(d.id ?? localDoctorDisplayName(d));
                    return (
                      <li key={key} role="presentation" style={{ padding: 0 }}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const pid = doctorPimsIdOf(d);
                            setDoctorId(pid);
                            const name = localDoctorDisplayName(d);
                            setDoctorName(name);
                            setDoctorQuery(name);
                            setShowDoctorDropdown(false);
                            setDoctorResults([]);
                          }}
                          className="dropdown-btn"
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            background: selected ? '#f0f7f4' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            borderRadius: 10,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f6fbf9')}
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = selected
                              ? '#f0f7f4'
                              : 'transparent')
                          }
                        >
                          {localDoctorDisplayName(d)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {doctorId && (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                TZ: {tz}
              </div>
            )}
          </div>

          {/* Month nav */}
          <div>
            <label className="label">Month</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                type="button"
                onClick={() => setCursor((c) => c.minus({ months: 1 }))}
              >
                ◀ {cursor.minus({ months: 1 }).toFormat('LLLL yyyy')}
              </button>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                }}
              >
                {cursor.toFormat('LLLL yyyy')}
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => setCursor((c) => c.plus({ months: 1 }))}
              >
                {cursor.plus({ months: 1 }).toFormat('LLLL yyyy')} ▶
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="danger" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        {loading && (
          <div className="muted" style={{ marginBottom: 12 }}>
            Loading…
          </div>
        )}

        {/* Legend */}
        <div
          className="muted"
          style={{ marginBottom: 10, display: 'flex', gap: 16, alignItems: 'center' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                background: '#93c5fd',
                borderRadius: 3,
                display: 'inline-block',
              }}
            />{' '}
            Appointment
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                background: '#e5e7eb',
                borderRadius: 3,
                display: 'inline-block',
              }}
            />{' '}
            Block / Not working
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                background: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: 3,
                display: 'inline-block',
              }}
            />{' '}
            Free
          </span>
        </div>

        {/* Calendar grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          {/* Weekday headers (Mon–Sun) */}
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
            <div key={w} className="muted" style={{ fontWeight: 700, padding: '6px 4px' }}>
              {w}
            </div>
          ))}

          {/* Day cells */}
          {calendarCells.map((d) => {
            const inMonth = d.month === cursor.month;
            const { items, laneCount, freeSeconds, off, windowSec } = computeDayLayout(d);
            const pxPerSec = windowSec > 0 ? 140 / windowSec : 0; // 140 == CELL_BODY_HEIGHT
            const isoDate = d.setZone(tz).toISODate()!;

            return (
              <div
                key={isoDate}
                className="card"
                onClick={() => doctorId && openDoctorDay(isoDate)}
                style={{
                  opacity: inMonth ? 1 : 0.55,
                  padding: 8,
                  minHeight: 140 + 48,
                  display: 'flex',
                  flexDirection: 'column',
                  cursor: doctorId ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>{d.setZone(tz).day}</div>
                  {typeof freeSeconds === 'number' && !off && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Free: {secsPretty(freeSeconds)}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    position: 'relative',
                    marginTop: 6,
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    height: 140,
                    overflow: 'hidden',
                    background: '#fff',
                  }}
                >
                  {/* "Off" label */}
                  {off && (
                    <div
                      className="muted"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontStyle: 'italic',
                      }}
                    >
                      Off
                    </div>
                  )}

                  {/* Timeline items */}
                  {!off &&
                    items.map((it) => {
                      const top = Math.round(clamp(it.start * pxPerSec, 0, 140 - 1));
                      const h = Math.max(2, Math.round((it.end - it.start) * pxPerSec));
                      const leftPct = (it.lane! / laneCount) * 100;
                      const widthPct = (1 / laneCount) * 100 - 2; // small gap
                      const bg = it.type === 'appt' ? APPT_COLOR : BLOCK_COLOR;
                      const border = it.type === 'appt' ? '1px solid #60a5fa' : '1px solid #d1d5db';

                      return (
                        <div
                          key={`${it.type}-${it.id}`}
                          title={it.title || (it.type === 'appt' ? 'Appointment' : 'Block')}
                          style={{
                            position: 'absolute',
                            top,
                            left: `${leftPct}%`,
                            width: `calc(${widthPct}% - 2px)`,
                            height: h,
                            background: bg,
                            border,
                            borderRadius: 6,
                            boxSizing: 'border-box',
                            overflow: 'hidden',
                          }}
                        />
                      );
                    })}
                </div>

                {/* Show work window if provided */}
                {(() => {
                  const sched = dayMap.get(isoDate);
                  const ws = sched?.workStartLocal;
                  const we = sched?.workEndLocal;
                  if (ws && we) {
                    return (
                      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                        {ws}–{we}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {myDayOpen && previewOpt && (
        <PreviewMyDayModal
          option={previewOpt}
          onClose={closeMyDay}
          // Provide safe defaults; modal ignores if not creating a new appt
          serviceMinutes={0}
          newApptMeta={{}}
        />
      )}
    </div>
  );
}
