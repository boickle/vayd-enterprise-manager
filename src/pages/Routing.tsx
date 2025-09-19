import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { http } from '../api/http';
import { Field } from '../components/Field';
import { KeyValue } from '../components/KeyValue';
import { DateTime } from 'luxon';

// =========================
// Types
// =========================

type RouteRequest = {
  doctorId: string;
  startDate: string;
  endDate: string;
  newAppt: {
    serviceMinutes: number;
    lat?: number;
    lon?: number;
    address?: string;
    clientId?: string;
  };
};

type Slot = 'early' | 'mid' | 'late';

type Winner = {
  date: string;
  insertionIndex: number;
  addedDriveSeconds: number;
  currentDriveSeconds: number;
  projectedDriveSeconds: number;
  suggestedStartSec: number;
  suggestedStartIso: string;
  beforeEdgeSeconds: number;
  withXSeconds: number;
  addedDrivePretty?: string;
  currentDrivePretty?: string;
  projectedDrivePretty?: string;

  // NEW — preference metadata from backend
  prefScore?: number;
  slot?: Slot | null;
  isFirstEdge?: boolean;
  isLastEdge?: boolean;
};

type EstimatedCost = {
  dmElements: number;
  dirRequests: number;
  dmCost: number;
  dirCost: number;
  totalCostUSD: number;
};

type Result = {
  status: string;
  winner?: Winner;
  estimatedCost?: EstimatedCost;
  alternates?: Winner[];

  // Any-doctor extras
  doctorPimsId?: string;
  selectedDoctorPimsId?: string;
  selectedDoctorDisplayName?: string;
  selectedDoctor?: {
    pimsId?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
  };
  underThreshold?: boolean;
  doctors?: Array<{
    pimsId: string;
    name?: string;
    top: Winner[];
  }>;
};

type Client = {
  id: string;
  firstName: string;
  lastName: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number | string;
  lon?: number | string;
};

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

// =========================
// Helpers
// =========================

const DOCTORS_SEARCH_URL = '/employees/search';

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

function secsToPretty(s?: number) {
  if (s == null) return '-';
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function isoToTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function colorForAddedDrive(seconds?: number): string {
  if (seconds == null) return 'inherit';
  const mins = seconds / 60;
  if (mins < 10) return 'green';
  if (mins <= 20) return 'orange';
  return 'red';
}

function colorForProjectedDrive(seconds?: number): string {
  if (seconds == null) return 'inherit';
  const mins = seconds / 60;
  if (mins <= 90) return 'green';
  if (mins <= 120) return 'orange';
  return 'red';
}

function formatClientAddress(c: Partial<Client>): string {
  const line = [c.address1, c.city, c.state].filter(Boolean).join(', ');
  return [line, c.zip].filter(Boolean).join(' ').trim();
}

const DOCTOR_PALETTE = [
  '#93c5fd',
  '#7dd3fc',
  '#67e8f9',
  '#5eead4',
  '#6ee7b7',
  '#a5b4fc',
  '#c4b5fd',
  '#d8b4fe',
  '#f0abfc',
  '#cbd5e1',
  '#d6d3d1',
];
function colorForDoctor(pimsId: string | undefined): string {
  if (!pimsId) return '#0ea5e9';
  let h = 0;
  for (let i = 0; i < pimsId.length; i++) h = (h * 31 + pimsId.charCodeAt(i)) >>> 0;
  return DOCTOR_PALETTE[h % DOCTOR_PALETTE.length];
}

function DoctorIcon({ color = 'white' }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Z" stroke={color} strokeWidth="2" />
      <path d="M4 21a8 8 0 0 1 16 0" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const maybe = err as { response?: { data?: { message?: string } }; message?: string };
    return maybe.response?.data?.message ?? maybe.message ?? 'Request failed';
  }
  return 'Request failed';
}

function SlotChip({ slot }: { slot?: Slot | null }) {
  if (!slot) return null;
  const text = slot === 'early' ? 'Early' : slot === 'mid' ? 'Mid' : 'Late';
  const bg = slot === 'early' ? '#e0f2fe' : slot === 'mid' ? '#e0ffe7' : '#fef3c7';
  const fg = slot === 'early' ? '#0369a1' : slot === 'mid' ? '#065f46' : '#92400e';
  return (
    <span
      style={{
        background: bg,
        color: fg,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  );
}

function EdgeChip({ first, last }: { first?: boolean; last?: boolean }) {
  if (!first && !last) return null;
  const text = first ? 'First of day' : 'Last of day';
  return (
    <span
      style={{
        background: '#eef2ff',
        color: '#3730a3',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  );
}

// =========================
// Component
// =========================

export default function Routing() {
  // -------- Form state --------
  const [form, setForm] = useState<RouteRequest>({
    doctorId: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    newAppt: { serviceMinutes: 45, address: '' },
  });

  // Preferences
  const [preferredWeekday, setPreferredWeekday] = useState<number | null>(null); // 1..7
  const [preferredTimeOfDay, setPreferredTimeOfDay] = useState<'first' | 'middle' | 'end' | null>(
    null
  ); // send exactly these
  const [edgeFirst, setEdgeFirst] = useState(false);
  const [edgeLast, setEdgeLast] = useState(false);

  // Toggles
  const [multiDoctor, setMultiDoctor] = useState(false);
  const [useTraffic, setUseTraffic] = useState(false);
  const [maxAddedDriveMinutes] = useState(20);
  const [ignoreEmergencyBlocks, setIgnoreEmergencyBlocks] = useState(false);

  // -------- UX state --------
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // -------- Client search --------
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientBoxRef = useRef<HTMLDivElement | null>(null);
  const latestClientQueryRef = useRef('');

  // -------- Doctor search --------
  const [doctorQuery, setDoctorQuery] = useState('');
  const [doctorResults, setDoctorResults] = useState<Doctor[]>([]);
  const [doctorSearching, setDoctorSearching] = useState(false);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const doctorBoxRef = useRef<HTMLDivElement | null>(null);
  const latestDoctorQueryRef = useRef('');

  // -------- Winner doctor name cache --------
  const [doctorNames, setDoctorNames] = useState<Record<string, string>>({});
  const doctorNameReqs = useRef<Record<string, Promise<string>>>({});

  // =========================
  // Effects
  // =========================

  // Client search
  useEffect(() => {
    const q = (clientQuery ?? '').trim();
    latestClientQueryRef.current = q;
    if (!q) {
      setClientResults([]);
      setShowClientDropdown(false);
      return;
    }
    const t = setTimeout(async () => {
      setClientSearching(true);
      try {
        const { data } = await http.get('/clients/search', { params: { q } });
        if (latestClientQueryRef.current === q) {
          setClientResults(Array.isArray(data) ? data : []);
          setShowClientDropdown(true);
        }
      } catch (e) {
        console.error('Client search failed', e);
      } finally {
        setClientSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [clientQuery]);

  // Doctor search
  useEffect(() => {
    const q = doctorQuery.trim();
    latestDoctorQueryRef.current = q;
    if (!q) {
      setDoctorResults([]);
      setShowDoctorDropdown(false);
      return;
    }
    const t = setTimeout(async () => {
      setDoctorSearching(true);
      try {
        const { data } = await http.get(DOCTORS_SEARCH_URL, { params: { q } });
        if (latestDoctorQueryRef.current === q) {
          setDoctorResults(Array.isArray(data) ? data : []);
          setShowDoctorDropdown(true);
        }
      } catch (e) {
        console.error('Doctor search failed', e);
      } finally {
        setDoctorSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [doctorQuery]);

  // Close dropdowns
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (clientBoxRef.current && !clientBoxRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
      if (doctorBoxRef.current && !doctorBoxRef.current.contains(e.target as Node)) {
        setShowDoctorDropdown(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Fetch doctor name if missing
  useEffect(() => {
    const pid = result?.selectedDoctorPimsId || result?.doctorPimsId;
    if (!pid || doctorNames[pid]) return;
    if (!doctorNameReqs.current[pid]) {
      doctorNameReqs.current[pid] = (async () => {
        try {
          const { data } = await http.get(`/employees/pims/${encodeURIComponent(pid)}`);
          const emp = Array.isArray(data) ? data[0] : data;
          const name =
            [emp?.firstName, emp?.lastName].filter(Boolean).join(' ') ||
            [emp?.employee?.firstName, emp?.employee?.lastName].filter(Boolean).join(' ') ||
            `Doctor ${pid}`;
          setDoctorNames((m) => ({ ...m, [pid]: name }));
          return name;
        } catch {
          const fallback = `Doctor ${pid}`;
          setDoctorNames((m) => ({ ...m, [pid]: fallback }));
          return fallback;
        } finally {
          delete doctorNameReqs.current[pid];
        }
      })();
    }
  }, [result, doctorNames]);

  // =========================
  // Handlers
  // =========================

  function onChange<K extends keyof RouteRequest>(key: K, value: RouteRequest[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onNewApptChange<K extends keyof RouteRequest['newAppt']>(
    key: K,
    value: RouteRequest['newAppt'][K]
  ) {
    setForm((f) => ({ ...f, newAppt: { ...f.newAppt, [key]: value } }));
  }

  function pickClient(c: Client) {
    const addr = formatClientAddress(c);
    const latNum = typeof c.lat === 'string' ? parseFloat(c.lat) : c.lat;
    const lonNum = typeof c.lon === 'string' ? parseFloat(c.lon) : c.lon;

    setForm((f) => ({
      ...f,
      newAppt: {
        ...f.newAppt,
        clientId: String(c.id),
        address: addr,
        lat: Number.isFinite(latNum as number) ? (latNum as number) : undefined,
        lon: Number.isFinite(lonNum as number) ? (lonNum as number) : undefined,
      },
    }));

    setClientQuery(`${c.lastName}, ${c.firstName}`);
    setClientResults([]);
    setShowClientDropdown(false);
  }

  function pickDoctor(d: Doctor) {
    const pimsId = doctorPimsIdOf(d);
    if (!pimsId) {
      console.warn('No pimsId on doctor record', d);
      return;
    }
    setForm((f) => ({ ...f, doctorId: pimsId }));
    setDoctorQuery(localDoctorDisplayName(d));
    setDoctorResults([]);
    setShowDoctorDropdown(false);
  }

  function diffDaysInclusive(aISO: string, bISO: string) {
    const a = new Date(aISO + 'T00:00:00');
    const b = new Date(bISO + 'T00:00:00');
    const ms = b.getTime() - a.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return days + 1;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (new Date(form.endDate) < new Date(form.startDate)) {
      setError('End date must be on or after the start date.');
      return;
    }

    const numDays = Math.max(1, diffDaysInclusive(form.startDate, form.endDate));
    const endpoint = multiDoctor ? '/routing/any-doctor' : '/routing';

    // If both edge boxes are selected, cancel the preference.
    const preferEdge: 'first' | 'last' | null =
      edgeFirst && !edgeLast ? 'first' : edgeLast && !edgeFirst ? 'last' : null;

    const base = {
      startDate: form.startDate,
      numDays,
      newAppt: form.newAppt,
      useTraffic,
      ignoreEmergencyBlocks,
      preferredWeekday,
      preferredTimeOfDay, // 'first' | 'middle' | 'end' | null
      preferEdge, // 'first' | 'last' | null
    };

    const payload = multiDoctor
      ? { primaryDoctorPimsId: form.doctorId, ...base, maxAddedDriveMinutes }
      : { doctorId: form.doctorId, ...base };

    setLoading(true);
    try {
      const { data } = await http.post<Result>(endpoint, payload);
      setResult(data);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // Build unified options
  // =========================

  type UnifiedOption = Winner & { doctorPimsId: string; doctorName: string };
  const displayOptions: UnifiedOption[] = useMemo(() => {
    const rows: UnifiedOption[] = [];

    if (multiDoctor && result?.doctors) {
      for (const d of result.doctors) {
        const pid = d.pimsId;
        const name = d.name || doctorNames[pid] || `Doctor ${pid}`;
        for (const w of d.top || []) rows.push({ ...w, doctorPimsId: pid, doctorName: name });
      }
    } else if (result) {
      const pid = result.selectedDoctorPimsId || form.doctorId;
      const name =
        result.selectedDoctor?.name ||
        doctorNames[pid] ||
        [result.selectedDoctor?.firstName, result.selectedDoctor?.lastName]
          .filter(Boolean)
          .join(' ') ||
        `Doctor ${pid}`;
      if (result.winner) rows.push({ ...result.winner, doctorPimsId: pid, doctorName: name });
      if (result.alternates)
        for (const w of result.alternates) rows.push({ ...w, doctorPimsId: pid, doctorName: name });
    }

    // 🔑 Sort by preference score first (desc), then low added drive, then earlier time, then date.
    rows.sort((a, b) => {
      const ap = a.prefScore ?? 0;
      const bp = b.prefScore ?? 0;
      if (bp !== ap) return bp - ap;
      if (a.addedDriveSeconds !== b.addedDriveSeconds)
        return a.addedDriveSeconds - b.addedDriveSeconds;
      if (a.suggestedStartSec !== b.suggestedStartSec)
        return a.suggestedStartSec - b.suggestedStartSec;
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.insertionIndex - b.insertionIndex;
    });

    return rows;
  }, [multiDoctor, result, doctorNames, form.doctorId]);

  // =========================
  // Render
  // =========================

  const weekdayLabels: Array<{ n: number; label: string }> = [
    { n: 1, label: 'Mon' },
    { n: 2, label: 'Tue' },
    { n: 3, label: 'Wed' },
    { n: 4, label: 'Thu' },
    { n: 5, label: 'Fri' },
    { n: 6, label: 'Sat' },
    { n: 7, label: 'Sun' },
  ];

  return (
    <div className="grid" style={{ alignItems: 'start' }}>
      {/* ------- Form ------- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Get Best Route</h2>
        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          {/* Doctor picker */}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Doctor">
              <div ref={doctorBoxRef} style={{ position: 'relative' }}>
                <input
                  className="input"
                  value={doctorQuery}
                  onChange={(e) => setDoctorQuery(e.target.value)}
                  placeholder="Type doctor name..."
                  onFocus={() => doctorResults.length && setShowDoctorDropdown(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && doctorResults[0]) {
                      e.preventDefault();
                      pickDoctor(doctorResults[0]);
                    }
                  }}
                  required
                />
                {doctorSearching && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Searching...
                  </div>
                )}
                {showDoctorDropdown && doctorResults.length > 0 && (
                  <ul
                    className="dropdown"
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
                    role="listbox"
                  >
                    {doctorResults.map((d) => (
                      <li
                        key={doctorPimsIdOf(d) || String(d.id ?? localDoctorDisplayName(d))}
                        role="option"
                        aria-selected="false"
                        style={{ padding: 0, borderBottom: '1px solid #eee' }}
                      >
                        <button
                          type="button"
                          onClick={() => pickDoctor(d)}
                          className="dropdown-btn"
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            borderRadius: 10,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f6fbf9')}
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = 'transparent')
                          }
                        >
                          {localDoctorDisplayName(d)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Field>
          </div>

          {/* Dates */}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Start Date">
              <input
                className="date"
                type="date"
                value={form.startDate}
                onChange={(e) => onChange('startDate', e.target.value)}
                required
              />
            </Field>
            <Field label="End Date">
              <input
                className="date"
                type="date"
                value={form.endDate}
                onChange={(e) => onChange('endDate', e.target.value)}
                required
              />
            </Field>
          </div>

          {/* Appointment & client */}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Service minutes">
              <input
                className="input"
                type="number"
                min={1}
                value={form.newAppt.serviceMinutes}
                onChange={(e) => onNewApptChange('serviceMinutes', Number(e.target.value))}
              />
            </Field>

            <Field label="Search Client (last name)">
              <div ref={clientBoxRef} style={{ position: 'relative' }}>
                <input
                  className="input"
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                  placeholder="Type last name..."
                  onFocus={() => clientResults.length && setShowClientDropdown(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && clientResults[0]) {
                      e.preventDefault();
                      pickClient(clientResults[0]);
                    }
                  }}
                />
                {clientSearching && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Searching...
                  </div>
                )}
                {showClientDropdown && clientResults.length > 0 && (
                  <ul
                    className="dropdown"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      marginTop: 6,
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #ccc',
                      borderRadius: 8,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      maxHeight: 260,
                      overflowY: 'auto',
                      zIndex: 1000,
                    }}
                    role="listbox"
                  >
                    {clientResults.map((c) => (
                      <li key={c.id} role="option" aria-selected="false" style={{ padding: 0 }}>
                        <button
                          type="button"
                          onClick={() => pickClient(c)}
                          className="dropdown-btn"
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            borderRadius: 10,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f6fbf9')}
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = 'transparent')
                          }
                        >
                          <div style={{ fontWeight: 600 }}>
                            {c.lastName}, {c.firstName}
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {formatClientAddress(c) || '—'}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Field>

            <Field label="Address (optional)">
              <input
                className="input"
                value={form.newAppt.address ?? ''}
                onChange={(e) => onNewApptChange('address', e.target.value)}
                placeholder="123 Main St, Portland ME"
              />
            </Field>
          </div>

          {/* Preferences */}
          <div className="card" style={{ padding: 12, background: '#f8fafc' }}>
            <h4 style={{ margin: '4px 0 10px 0' }}>Preferences (optional)</h4>

            {/* Toggles */}
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Emergency booking">
                <label
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    padding: '4px 8px',
                    borderRadius: 6,
                  }}
                  className={ignoreEmergencyBlocks ? 'field-red' : ''}
                >
                  <input
                    type="checkbox"
                    checked={ignoreEmergencyBlocks}
                    onChange={(e) => setIgnoreEmergencyBlocks(e.target.checked)}
                  />
                  <span>Ignore reserve blocks</span>
                </label>
              </Field>

              <Field label="Multi-doctor">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={multiDoctor}
                    onChange={(e) => setMultiDoctor(e.target.checked)}
                  />
                  <span>Try other doctors for best fit</span>
                </label>
              </Field>
            </div>

            {/* Preferred weekday */}
            <Field label="Preferred Day of Week">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {weekdayLabels.map(({ n, label }) => (
                  <label key={n} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={preferredWeekday === n}
                      onChange={() => setPreferredWeekday((cur) => (cur === n ? null : n))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
                <label
                  style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={preferredWeekday === null}
                    onChange={() => setPreferredWeekday(null)}
                  />
                  <span>None</span>
                </label>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Only one day can be selected. Click again to unselect.
              </div>
            </Field>

            {/* Preferred time of day */}
            <Field label="Preferred Time of Day">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  { key: 'first', label: 'First part of day' },
                  { key: 'middle', label: 'Middle of day' },
                  { key: 'end', label: 'End of day' },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={preferredTimeOfDay === (key as 'first' | 'middle' | 'end')}
                      onChange={() =>
                        setPreferredTimeOfDay((cur) => (cur === key ? null : (key as any)))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
                <label
                  style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={preferredTimeOfDay === null}
                    onChange={() => setPreferredTimeOfDay(null)}
                  />
                  <span>None</span>
                </label>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Only one time window can be selected. Click again to unselect.
              </div>
            </Field>

            {/* Edge preference
            <Field label="Edge Preference">
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={edgeFirst}
                    onChange={(e) => setEdgeFirst(e.target.checked)}
                  />
                  <span>Prefer first appointment of the day</span>
                </label>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={edgeLast}
                    onChange={(e) => setEdgeLast(e.target.checked)}
                  />
                  <span>Prefer last appointment of the day</span>
                </label>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Selecting both cancels the edge preference.
              </div> */}
            {/* </Field> */}
          </div>

          {error && <div className="danger">{error}</div>}
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Calculating…' : 'Get Best Route'}
          </button>
        </form>
      </div>

      {/* ------- Results ------- */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Results</h3>

        {!result && <p className="muted">Run a search to see winner and alternates here.</p>}

        {result && displayOptions.length === 0 && <p>no results found</p>}

        {result && displayOptions.length > 0 && (
          <div className="grid" style={{ gap: 14 }}>
            {displayOptions.map((opt, idx) => {
              const headerColor = colorForDoctor(opt.doctorPimsId);
              return (
                <div
                  key={`${opt.doctorPimsId}-${opt.date}-${opt.insertionIndex}-${idx}`}
                  className="card"
                  style={{ position: 'relative', paddingTop: 48 }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 10,
                      left: 10,
                      right: 10,
                      height: 28,
                      borderRadius: 10,
                      padding: '0 12px',
                      background: `linear-gradient(135deg, ${headerColor}, ${headerColor}cc)`,
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      fontWeight: 700,
                      letterSpacing: 0.2,
                      gap: 10,
                    }}
                  >
                    <span
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {opt.doctorName}
                    </span>
                    <span style={{ marginLeft: 'auto' }}>
                      <DoctorIcon />
                    </span>
                  </div>

                  <h3 style={{ margin: '6px 0 8px 0' }}>
                    {DateTime.fromISO(opt.date).toFormat('cccc LL-dd-yyyy')} @{' '}
                    {isoToTime(opt.suggestedStartIso)}
                  </h3>

                  <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                    <SlotChip slot={opt.slot ?? null} />
                    <EdgeChip first={opt.isFirstEdge} last={opt.isLastEdge} />
                    {typeof opt.prefScore === 'number' && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        Pref score: {opt.prefScore}
                      </span>
                    )}
                  </div>

                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <KeyValue k="Insertion Index" v={String(opt.insertionIndex)} />
                    <KeyValue k="Start Time" v={isoToTime(opt.suggestedStartIso)} />
                    <KeyValue
                      k="Added Drive"
                      v={opt.addedDrivePretty ?? secsToPretty(opt.addedDriveSeconds)}
                      color={colorForAddedDrive(opt.addedDriveSeconds)}
                    />
                    <KeyValue
                      k="Projected Drive"
                      v={opt.projectedDrivePretty ?? secsToPretty(opt.projectedDriveSeconds)}
                      color={colorForProjectedDrive(opt.projectedDriveSeconds)}
                    />
                    <KeyValue
                      k="Current Drive"
                      v={opt.currentDrivePretty ?? secsToPretty(opt.currentDriveSeconds)}
                      color="inherit"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
