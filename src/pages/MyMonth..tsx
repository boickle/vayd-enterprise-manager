// src/pages/MyMonth.tsx
import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { DateTime } from 'luxon';
import { http } from '../api/http';
import { PreviewMyDayModal } from '../components/PreviewMyDayModal';

// Doctor-month API (with zones)
import {
  fetchDoctorMonth,
  type DoctorMonthResponse,
  type DoctorMonthDay,
  type DoctorMonthAppt,
  type MiniZone,
} from '../api/appointments';

// Patients API (provider's patient mix by zone)
import { getZonePercentagesForProvider } from '../api/patients';

// ===== Types =====
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

type ZonePatientStat = {
  zoneId: string | null;
  zoneName: string | null;
  count: number;
  percent: number; // 0..100
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

// Merge intervals and return total covered seconds (no double counting)
function mergedSeconds(intervals: Array<{ start: number; end: number }>): number {
  if (!intervals.length) return 0;
  const sorted = intervals
    .filter((x) => x.end > x.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let total = 0;
  let curS = sorted[0].start;
  let curE = sorted[0].end;

  for (let i = 1; i < sorted.length; i++) {
    const { start, end } = sorted[i];
    if (start <= curE) {
      // overlaps/contiguous -> extend
      curE = Math.max(curE, end);
    } else {
      total += curE - curS;
      curS = start;
      curE = end;
    }
  }
  total += curE - curS;
  return total;
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

// Build a working window for the day from schedule or payload times.
// No 8–17 fallback — zero window means "Off".
function computeWindow(d: DoctorMonthDay) {
  const tz = d.timezone || 'America/New_York';

  const ws = hmsToSec((d as any).workStartLocal);
  const we = hmsToSec((d as any).workEndLocal);
  const hasSchedule = ws != null && we != null && we > ws;

  if (hasSchedule) {
    return { tz, startSec: ws!, endSec: we!, windowSec: we! - ws!, hasSchedule: true };
  }

  const secs: number[] = [];
  (d.appts || []).forEach((a) => {
    if (a.startIso) secs.push(minSinceMidnight(a.startIso, tz));
    if (a.endIso) secs.push(minSinceMidnight(a.endIso, tz));
  });

  if (secs.length >= 2) {
    const startSec = Math.min(...secs);
    const endSec = Math.max(...secs);
    if (endSec > startSec) {
      return { tz, startSec, endSec, windowSec: endSec - startSec, hasSchedule: false };
    }
  }

  return { tz, startSec: 0, endSec: 0, windowSec: 0, hasSchedule: false };
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
function groupedAppointmentSeconds(d: DoctorMonthDay, clampToWindow: (iso: string) => number) {
  const groups = new Map<string, { start: number; end: number; maxServiceSec: number }>();
  for (const a of d.appts || []) {
    if (!a.startIso || !a.endIso) continue;
    const s = clampToWindow(a.startIso);
    const e = clampToWindow(a.endIso);
    if (!(e > s)) continue;

    const keyBase = locationKey(a) ?? 'slot';
    {
      // preserve same-slot grouping
    }
    const slot = `${s}|${e}`;
    const key = `${keyBase}|${slot}`;

    const serviceSec =
      typeof a.serviceMinutes === 'number' && a.serviceMinutes > 0
        ? Math.floor(a.serviceMinutes * 60)
        : e - s;

    const prev = groups.get(key);
    if (prev) {
      prev.start = Math.min(prev.start, s);
      prev.end = Math.max(prev.end, e);
      prev.maxServiceSec = Math.max(prev.maxServiceSec, serviceSec);
    } else {
      groups.set(key, { start: s, end: e, maxServiceSec: serviceSec });
    }
  }

  let total = 0;
  for (const g of groups.values()) {
    const union = Math.max(0, g.end - g.start);
    total += Math.min(g.maxServiceSec, union);
  }
  return total;
}

// ===== Zones aggregation helpers =====
type ZoneKey = string; // `${id}|${name ?? ''}`
type ZoneStat = { id: string | number | null; name: string | null; minutes: number; count: number };

function zoneOf(a: DoctorMonthAppt): MiniZone | null {
  return a.effectiveZone ?? a.clientZone ?? null;
}
function zoneKeyFrom(z: MiniZone | null): ZoneKey {
  if (!z) return 'none|';
  return `${z.id}|${z.name ?? ''}`;
}
function zoneFromKey(k: ZoneKey): { id: string | number | null; name: string | null } {
  if (k === 'none|') return { id: null, name: 'No Zone' };
  const [id, ...rest] = k.split('|');
  const name = rest.join('|') || null;
  return { id: id ?? null, name };
}
function apptMinutes(a: DoctorMonthAppt): number {
  if (typeof a.serviceMinutes === 'number' && a.serviceMinutes > 0)
    return Math.floor(a.serviceMinutes);
  if (a.startIso && a.endIso) {
    const d = DateTime.fromISO(a.endIso).diff(DateTime.fromISO(a.startIso), 'minutes').minutes;
    return Math.max(1, Math.round(d || 0));
  }
  return 0;
}
function pct(n: number, d: number): string {
  if (!d || d <= 0) return '0%';
  return `${Math.round((n / d) * 100)}%`;
}

// Colors
const APPT_COLOR = '#93c5fd';
const BLOCK_COLOR = '#e5e7eb';

export default function MyMonth() {
  // doctor search
  const [doctorQuery, setDoctorQuery] = useState('');
  const [doctorResults, setDoctorResults] = useState<Doctor[]>([]);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const [doctorActiveIdx, setDoctorActiveIdx] = useState(-1);
  const doctorBoxRef = useRef<HTMLDivElement | null>(null);

  // Selected doctor identifiers
  const [doctorId, setDoctorId] = useState<string>(''); // PIMS id (input)
  const [doctorName, setDoctorName] = useState<string>('');
  const [providerInternalId, setProviderInternalId] = useState<string | null>(null); // resolved internal id

  // pims -> internal id cache
  const [doctorIdByPims, setDoctorIdByPims] = useState<Record<string, string>>({});

  // month nav (cursor is month/year only)
  const now = DateTime.local();
  const [cursor, setCursor] = useState<DateTime>(now.startOf('month'));

  // data
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthResp, setMonthResp] = useState<DoctorMonthResponse | null>(null);

  // patient zone mix
  const [patientZoneMix, setPatientZoneMix] = useState<ZonePatientStat[] | null>(null);
  const [patientZoneMixLoading, setPatientZoneMixLoading] = useState(false);
  const [patientZoneMixErr, setPatientZoneMixErr] = useState<string | null>(null);

  // modal state
  const [myDayOpen, setMyDayOpen] = useState(false);
  const [previewOpt, setPreviewOpt] = useState<any | null>(null);

  // Resolve internal provider id when doctorId (PIMS) changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!doctorId) {
        if (!cancelled) setProviderInternalId(null);
        return;
      }
      const cached = doctorIdByPims[doctorId];
      if (cached) {
        if (!cancelled) setProviderInternalId(cached);
        return;
      }
      try {
        const { data } = await http.get(`/employees/pims/${encodeURIComponent(doctorId)}`);
        const emp = Array.isArray(data) ? data[0] : data;
        const internalId =
          (emp?.id != null ? String(emp.id) : undefined) ??
          (emp?.employee?.id != null ? String(emp.employee.id) : undefined);
        if (internalId && !cancelled) {
          setDoctorIdByPims((m) => ({ ...m, [doctorId]: internalId }));
          setProviderInternalId(internalId);
        } else if (!cancelled) {
          setProviderInternalId(null);
        }
      } catch {
        if (!cancelled) setProviderInternalId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doctorId, doctorIdByPims]);

  // Fetch patient zone mix for provider (internal id)
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!providerInternalId) {
        setPatientZoneMix(null);
        return;
      }
      setPatientZoneMixLoading(true);
      setPatientZoneMixErr(null);
      try {
        const { data } = await getZonePercentagesForProvider(providerInternalId, {
          includeUnzoned: true,
          activeOnly: true,
          // practiceId: monthResp?.practiceId,
        });
        if (!cancelled) setPatientZoneMix(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (!cancelled) {
          setPatientZoneMixErr(e?.message ?? 'Failed to load patient zone mix');
          setPatientZoneMix(null);
        }
      } finally {
        if (!cancelled) setPatientZoneMixLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [providerInternalId, cursor]);

  // Doctor search effect
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

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (doctorBoxRef.current && !doctorBoxRef.current.contains(e.target as Node)) {
        setShowDoctorDropdown(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Fetch month via new API
  useEffect(() => {
    async function run() {
      if (!doctorId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDoctorMonth(cursor.year, cursor.month, doctorId);
        setMonthResp(data);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load month schedule');
        setMonthResp(null);
      } finally {
        setLoading(false);
      }
    }
    run();
  }, [doctorId, cursor]);

  // timezone for calendar math
  const tz = monthResp?.timezone || monthResp?.days?.[0]?.timezone || 'America/New_York';

  // calendar cells (Mon–Sun) in DOCTOR TZ
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

  // chunk into weeks of 7 days each
  const weeks = useMemo(() => {
    const rows: DateTime[][] = [];
    for (let i = 0; i < calendarCells.length; i += 7) {
      rows.push(calendarCells.slice(i, i + 7));
    }
    return rows;
  }, [calendarCells]);

  // map day data for quick lookup
  const dayMap = useMemo(() => {
    const m = new Map<string, DoctorMonthDay>();
    (monthResp?.days || []).forEach((d) => m.set(d.date, d));
    return m;
  }, [monthResp]);

  // compute free time & prepared layout per day (appts only; blocks optional)
  function computeDayLayout(dayDT: DateTime) {
    const iso = dayDT.setZone(tz).toISODate()!;
    const d = dayMap.get(iso);

    if (!d) {
      return {
        items: [] as LaneItem[],
        laneCount: 1,
        freeSeconds: undefined,
        off: true,
        windowSec: 0,
      };
    }

    const { tz: dayTz, startSec, endSec, windowSec } = computeWindow(d);
    if (windowSec <= 0) {
      return { items: [], laneCount: 1, freeSeconds: undefined, off: true, windowSec: 0 };
    }

    const clampToWindow = (isoStr: string) => {
      const abs = minSinceMidnight(isoStr, dayTz);
      const rel = abs - startSec;
      return clamp(rel, 0, windowSec);
    };

    const items: LaneItem[] = [];
    const busyIntervals: Array<{ start: number; end: number }> = [];

    // blocks
    for (const b of ((d as any).blocks || []) as Array<{
      id: any;
      startIso: string;
      endIso: string;
      title?: string;
    }>) {
      if (!b.startIso || !b.endIso) continue;
      const s = clampToWindow(b.startIso);
      const e = clampToWindow(b.endIso);
      if (e > s) {
        items.push({ id: b.id, start: s, end: e, type: 'block', title: b.title });
        busyIntervals.push({ start: s, end: e });
      }
    }

    // appointments
    for (const a of d.appts || []) {
      if (!a.startIso || !a.endIso) continue;
      const s = clampToWindow(a.startIso);
      const e = clampToWindow(a.endIso);
      if (e > s) {
        items.push({ id: a.id, start: s, end: e, type: 'appt', title: a.title });
        busyIntervals.push({ start: s, end: e });
      }
    }

    const { items: packed, laneCount } = packLanes(items);

    // union of all busy time (appts + blocks) so overlaps are only counted once
    const busySec = mergedSeconds(busyIntervals);

    // If your backend’s driveSeconds is already represented by blocks or gaps,
    // consider setting this to 0 to avoid double-subtraction.
    const driveSec = Math.max(0, Math.floor((d as any).driveSeconds ?? 0));

    const freeSeconds = Math.max(0, windowSec - busySec - driveSec);

    return { items: packed, laneCount, freeSeconds, off: false, windowSec };
  }

  // open Doctor Day modal for a given date (uses INTERNAL id)
  function openDoctorDay(dateIso: string) {
    if (!providerInternalId) return;
    setPreviewOpt({
      doctorPimsId: providerInternalId,
      doctorName: doctorName || 'Doctor',
      date: dateIso,
      insertionIndex: 0,
      suggestedStartIso: `${dateIso}T08:00:00`,
    });
    setMyDayOpen(true);
  }

  function closeMyDay() {
    setMyDayOpen(false);
    setPreviewOpt(null);
  }

  // ===== ZONE STATS (month-wide) from appts =====
  const monthAppts: DoctorMonthAppt[] = useMemo(
    () => (monthResp?.days || []).flatMap((d) => d.appts || []),
    [monthResp]
  );

  const monthStats = useMemo(() => {
    const byZone = new Map<string, { minutes: number; count: number }>();
    let totalMinutes = 0;
    let totalCount = 0;

    for (const a of monthAppts) {
      const key = zoneKeyFrom(zoneOf(a));
      const prev = byZone.get(key) ?? { minutes: 0, count: 0 };
      const mins = apptMinutes(a);
      if (mins > 0) {
        prev.minutes += mins;
        totalMinutes += mins;
      } else {
        prev.count += 1;
        totalCount += 1;
      }
      byZone.set(key, prev);
    }

    const useMinutes = totalMinutes > 0;
    const denom = useMinutes ? totalMinutes : totalCount;

    const stats: ZoneStat[] = Array.from(byZone.entries()).map(([k, v]) => {
      const z = zoneFromKey(k);
      return { id: z.id, name: z.name, minutes: v.minutes, count: v.count };
    });

    stats.sort((a, b) => {
      const aShare = useMinutes ? a.minutes : a.count;
      const bShare = useMinutes ? b.minutes : b.count;
      return bShare - aShare;
    });

    return { stats, useMinutes, denom };
  }, [monthAppts]);

  // ---- helper to compute weekly zone stats for a specific week of 7 DateTimes ----
  function zoneStatsForWeek(weekDays: DateTime[]) {
    const byZone = new Map<string, { minutes: number; count: number }>();
    let totalMinutes = 0;
    let totalCount = 0;

    for (const dt of weekDays) {
      const iso = dt.setZone(tz).toISODate()!;
      const d = dayMap.get(iso);
      if (!d?.appts?.length) continue;

      for (const a of d.appts) {
        const key = zoneKeyFrom(zoneOf(a));
        const prev = byZone.get(key) ?? { minutes: 0, count: 0 };
        const mins = apptMinutes(a);
        if (mins > 0) {
          prev.minutes += mins;
          totalMinutes += mins;
        } else {
          prev.count += 1;
          totalCount += 1;
        }
        byZone.set(key, prev);
      }
    }

    const useMinutes = totalMinutes > 0;
    const denom = useMinutes ? totalMinutes : totalCount;

    const stats: ZoneStat[] = Array.from(byZone.entries()).map(([k, v]) => {
      const z = zoneFromKey(k);
      return { id: z.id, name: z.name, minutes: v.minutes, count: v.count };
    });

    stats.sort((a, b) => (useMinutes ? b.minutes - a.minutes : b.count - a.count));

    const first = weekDays[0];
    const last = weekDays[weekDays.length - 1];
    const label =
      first.hasSame(last, 'month') && first.hasSame(last, 'year')
        ? `${first.toFormat('LLL d')} – ${last.toFormat('LLL d')}`
        : `${first.toFormat('LLL d')} – ${last.toFormat('LLL d')}`;

    return { stats, useMinutes, denom, label };
  }

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

        {/* Patients zone mix (all patients for selected provider) */}
        {doctorId && (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <h3>
              {doctorName || 'Provider'} <span className="muted">— Patients by Zone</span>
            </h3>

            {!providerInternalId && (
              <div className="muted" style={{ marginBottom: 8 }}>
                Loading provider…
              </div>
            )}

            {providerInternalId && (
              <>
                {patientZoneMixLoading && (
                  <div className="muted" style={{ marginBottom: 8 }}>
                    Loading…
                  </div>
                )}
                {patientZoneMixErr && (
                  <div className="danger" style={{ marginBottom: 8 }}>
                    {patientZoneMixErr}
                  </div>
                )}
                {!patientZoneMixLoading && !patientZoneMixErr && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {!patientZoneMix || patientZoneMix.length === 0 ? (
                      <span className="muted">No patient data</span>
                    ) : (
                      patientZoneMix
                        .slice()
                        .sort((a, b) => b.percent - a.percent)
                        .map((z) => (
                          <span
                            key={`${z.zoneId ?? 'none'}|${z.zoneName ?? ''}`}
                            className="pill"
                            style={{
                              padding: '4px 10px',
                              borderRadius: 999,
                              background: '#f5f3ff',
                            }}
                            title={`${z.count} patient${z.count === 1 ? '' : 's'}`}
                          >
                            <strong>{z.zoneName ?? 'No Zone'}</strong> — {z.percent.toFixed(1)}% (
                            {z.count})
                          </span>
                        ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ⭐ MONTH ZONE STATS (appointment mix this month) */}
        {monthResp && (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <h3>
              {DateTime.fromObject({ year: monthResp.year, month: monthResp.month }).toFormat(
                'LLLL yyyy'
              )}{' '}
              <span className="muted">— Zone Mix</span>
            </h3>
            <div className="muted" style={{ marginBottom: 8 }}>
              Total appts:{' '}
              <strong>{monthResp.days.reduce((s, d) => s + (d.appts?.length || 0), 0)}</strong>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {monthStats.stats.length === 0 ? (
                <span className="muted">No zone data</span>
              ) : (
                monthStats.stats.map((s) => {
                  const share = monthStats.useMinutes ? s.minutes : s.count;
                  return (
                    <span
                      key={`${s.id}|${s.name ?? ''}`}
                      className="pill"
                      style={{ padding: '4px 10px', borderRadius: 999, background: '#eef2ff' }}
                    >
                      <strong>{s.name ?? 'No Zone'}</strong> — {pct(share, monthStats.denom)}
                      {monthStats.useMinutes ? ` (${s.minutes}m)` : ` (${s.count})`}
                    </span>
                  );
                })
              )}
            </div>
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

        {/* Calendar grid: 7 day columns + 1 weekly stats column */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr)) 240px',
            gap: 8,
            alignItems: 'stretch', // ensure grid items fill the row height
          }}
        >
          {/* Headers (Mon–Sun + Week Zones) */}
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week Zones'].map((w) => (
            <div key={w} className="muted" style={{ fontWeight: 700, padding: '6px 4px' }}>
              {w}
            </div>
          ))}

          {/* Week rows */}
          {weeks.map((week, wi) => {
            const weekStats = zoneStatsForWeek(week);

            return (
              <Fragment key={`week-${wi}`}>
                {/* The 7 day cells */}
                {week.map((d) => {
                  const inMonth = d.month === cursor.month;
                  const { items, laneCount, freeSeconds, off, windowSec } = computeDayLayout(d);
                  const isoDate = d.setZone(tz).toISODate()!;

                  return (
                    <div
                      key={isoDate}
                      className="card"
                      onClick={() => providerInternalId && openDoctorDay(isoDate)}
                      style={{
                        opacity: inMonth ? 1 : 0.55,
                        padding: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        alignSelf: 'stretch', // fill row height
                        cursor: providerInternalId ? 'pointer' : 'default',
                        minHeight: 0, // allow inner flex to grow/shrink
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

                      {/* Timeline that stretches to fill leftover space; items positioned via % of work window */}
                      <div
                        style={{
                          position: 'relative',
                          marginTop: 6,
                          border: off ? '1px dashed #e5e7eb' : '1px solid #e5e7eb',
                          borderRadius: 8,
                          background: off ? '#fafafa' : '#fff',
                          flex: 1, // take all remaining height
                          overflow: 'hidden',
                          minHeight: 40, // tiny days still visible
                          display: 'flex',
                          alignItems: off ? 'center' : 'stretch',
                          justifyContent: off ? 'center' : 'stretch',
                        }}
                      >
                        {off || windowSec <= 0 ? (
                          <div className="muted" style={{ fontStyle: 'italic' }}>
                            Off
                          </div>
                        ) : (
                          items.map((it) => {
                            // % positions relative to the work window
                            const startPct = (it.start / windowSec) * 100;
                            const durPct = ((it.end - it.start) / windowSec) * 100;

                            const leftPct = (it.lane! / laneCount) * 100;
                            const colWidthPct = (1 / laneCount) * 100 - 2; // small gap

                            const bg = it.type === 'appt' ? APPT_COLOR : BLOCK_COLOR;
                            const border =
                              it.type === 'appt' ? '1px solid #60a5fa' : '1px solid #d1d5db';

                            return (
                              <div
                                key={`${it.type}-${it.id}`}
                                title={it.title || (it.type === 'appt' ? 'Appointment' : 'Block')}
                                style={{
                                  position: 'absolute',
                                  top: `${startPct}%`,
                                  height: `${Math.max(0.8, durPct)}%`,
                                  left: `${leftPct}%`,
                                  width: `calc(${colWidthPct}% - 2px)`,
                                  background: bg,
                                  border,
                                  borderRadius: 6,
                                  boxSizing: 'border-box',
                                  overflow: 'hidden',
                                }}
                              />
                            );
                          })
                        )}
                      </div>

                      {/* Show work window if provided */}
                      {(() => {
                        const sched = dayMap.get(isoDate) as any;
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

                {/* Week zone stats column (fills row; scrolls if long) */}
                <div
                  className="card"
                  style={{
                    padding: 12,
                    alignSelf: 'stretch',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                  }}
                >
                  <div className="muted" style={{ marginBottom: 6, fontWeight: 700 }}>
                    {weekStats.label}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignContent: 'flex-start',
                      overflowY: 'auto', // prevents this column from ballooning the row
                    }}
                  >
                    {weekStats.stats.length === 0 ? (
                      <span className="muted">No zone data</span>
                    ) : (
                      weekStats.stats.map((s) => {
                        const share = weekStats.useMinutes ? s.minutes : s.count;
                        const denom = weekStats.denom || 0;
                        return (
                          <span
                            key={`${s.id}|${s.name ?? ''}`}
                            className="pill"
                            style={{
                              padding: '4px 10px',
                              borderRadius: 999,
                              background: '#ecfeff',
                            }}
                          >
                            <strong>{s.name ?? 'No Zone'}</strong> — {pct(share, denom)}
                            {weekStats.useMinutes ? ` (${s.minutes}m)` : ` (${s.count})`}
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {myDayOpen && previewOpt && (
        <PreviewMyDayModal
          option={previewOpt}
          onClose={closeMyDay}
          serviceMinutes={0}
          newApptMeta={{}}
        />
      )}
    </div>
  );
}
