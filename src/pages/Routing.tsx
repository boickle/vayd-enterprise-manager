import { FormEvent, useEffect, useRef, useState } from 'react'
import { http } from '../api/http'
import { Field } from '../components/Field'
import { KeyValue } from '../components/KeyValue'

// =========================
// Types
// =========================

type RouteRequest = {
  doctorId: string
  startDate: string
  endDate: string
  newAppt: {
    serviceMinutes: number
    lat?: number
    lon?: number
    address?: string
    clientId?: string
  }
}

type Winner = {
  date: string
  insertionIndex: number
  addedDriveSeconds: number
  currentDriveSeconds: number
  projectedDriveSeconds: number
  suggestedStartSec: number
  suggestedStartIso: string
  beforeEdgeSeconds: number
  withXSeconds: number
  addedDrivePretty?: string
  currentDrivePretty?: string
  projectedDrivePretty?: string
}

type Result = {
  status: string
  winner?: Winner
  estimatedCost?: any
  alternates?: Winner[]

  // Any-doctor extras (server may include some/all)
  selectedDoctorPimsId?: string
  selectedDoctorDisplayName?: string
  selectedDoctor?: {
    pimsId?: string
    firstName?: string
    lastName?: string
    name?: string
  }
  underThreshold?: boolean
  // (server may also return `searched`, we don't rely on it here)
}

type Client = {
  id: string
  firstName: string
  lastName: string
  address1?: string
  city?: string
  state?: string
  zip?: string
  lat?: number | string
  lon?: number | string
}

type Doctor = {
  id?: string | number
  pimsId?: string
  firstName?: string
  lastName?: string
  name?: string
  employeeId?: string | number
  employee?: {
    id?: string | number
    pimsId?: string
    firstName?: string
    lastName?: string
  }
}

// =========================
// Constants & helpers
// =========================

const DOCTORS_SEARCH_URL = '/employees/search'

// Display-friendly doc name
function localDoctorDisplayName(d: Doctor) {
  const fn = d.employee?.firstName ?? d.firstName
  const ln = d.employee?.lastName ?? d.lastName
  return d.name || [fn, ln].filter(Boolean).join(' ') || 'Unknown'
}

// PIMS id safely extracted from doctor search record
function doctorPimsIdOf(d: Doctor): string {
  const pid = d.employee?.pimsId ?? d.pimsId
  if (pid) return String(pid)
  const maybePims = d.employeeId
  return maybePims ? String(maybePims) : ''
}

function fmtUsd(v: any): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return `$${n.toFixed(2)}`
}

function secsToPretty(s?: number) {
  if (!s && s !== 0) return '-'
  const m = Math.round(s / 60)
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h > 0) return `${h}h ${mm}m`
  return `${mm}m`
}

function isoToTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function colorForAddedDrive(seconds?: number): string {
  if (seconds == null) return 'inherit'
  const mins = seconds / 60
  if (mins < 10) return 'green'
  if (mins <= 20) return 'orange'
  return 'red'
}

function colorForProjectedDrive(seconds?: number): string {
  if (seconds == null) return 'inherit'
  const mins = seconds / 60
  if (mins <= 90) return 'green'
  if (mins <= 120) return 'orange'
  return 'red'
}

function formatClientAddress(c: Partial<Client>): string {
  const line = [c.address1, c.city, c.state].filter(Boolean).join(', ')
  return [line, c.zip].filter(Boolean).join(' ').trim()
}

// =========================
// Component
// =========================

export default function Routing() {
  // -------- Form state --------
  const [form, setForm] = useState<RouteRequest>({
    doctorId: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString().slice(0, 10), // +7 days
    newAppt: { serviceMinutes: 45, address: '' },
  })
  const [multiDoctor, setMultiDoctor] = useState<boolean>(false)
  const [maxAddedDriveMinutes, setMaxAddedDriveMinutes] = useState<number>(20)

  // -------- UX state --------
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  // -------- Client search --------
  const [clientQuery, setClientQuery] = useState('')
  const [clientResults, setClientResults] = useState<Client[]>([])
  const [clientSearching, setClientSearching] = useState(false)
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const clientBoxRef = useRef<HTMLDivElement | null>(null)
  const latestClientQueryRef = useRef('')

  // -------- Doctor search --------
  const [doctorQuery, setDoctorQuery] = useState('')
  const [doctorResults, setDoctorResults] = useState<Doctor[]>([])
  const [doctorSearching, setDoctorSearching] = useState(false)
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false)
  const doctorBoxRef = useRef<HTMLDivElement | null>(null)
  const latestDoctorQueryRef = useRef('')

  // -------- Winner doctor name cache (pimsId -> name) --------
  const [doctorNames, setDoctorNames] = useState<Record<string, string>>({})
  const doctorNameReqs = useRef<Record<string, Promise<string>>>({})

  // =========================
  // Effects: search & dropdown closing
  // =========================

  // Client search (debounced)
  useEffect(() => {
    const q = (clientQuery ?? '').trim()
    latestClientQueryRef.current = q
    if (!q) {
      setClientResults([])
      setShowClientDropdown(false)
      return
    }
    const t = setTimeout(async () => {
      setClientSearching(true)
      try {
        const { data } = await http.get('/clients/search', { params: { q } })
        if (latestClientQueryRef.current === q) {
          setClientResults(Array.isArray(data) ? data : [])
          setShowClientDropdown(true)
        }
      } catch (e) {
        console.error('Client search failed', e)
      } finally {
        setClientSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [clientQuery])

  // Doctor search (debounced)
  useEffect(() => {
    const q = doctorQuery.trim()
    latestDoctorQueryRef.current = q
    if (!q) {
      setDoctorResults([])
      setShowDoctorDropdown(false)
      return
    }
    const t = setTimeout(async () => {
      setDoctorSearching(true)
      try {
        const { data } = await http.get(DOCTORS_SEARCH_URL, { params: { q } })
        if (latestDoctorQueryRef.current === q) {
          setDoctorResults(Array.isArray(data) ? data : [])
          setShowDoctorDropdown(true)
        }
      } catch (e) {
        console.error('Doctor search failed', e)
      } finally {
        setDoctorSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [doctorQuery])

  // Close dropdowns on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (clientBoxRef.current && !clientBoxRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false)
      }
      if (doctorBoxRef.current && !doctorBoxRef.current.contains(e.target as Node)) {
        setShowDoctorDropdown(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // When a result arrives (any-doctor) fetch that winner doctor’s name
  useEffect(() => {
    const pid = result?.selectedDoctorPimsId
    if (!pid) return
    if (doctorNames[pid]) return

    if (!doctorNameReqs.current[pid]) {
      doctorNameReqs.current[pid] = (async () => {
        try {
          const { data } = await http.get(`/employees/pims/${encodeURIComponent(pid)}`)
          const emp = Array.isArray(data) ? data[0] : data
          const name =
            [emp?.firstName, emp?.lastName].filter(Boolean).join(' ') ||
            [emp?.employee?.firstName, emp?.employee?.lastName].filter(Boolean).join(' ') ||
            `Doctor ${pid}`
          setDoctorNames((m) => ({ ...m, [pid]: name }))
          return name
        } catch {
          const fallback = `Doctor ${pid}`
          setDoctorNames((m) => ({ ...m, [pid]: fallback }))
          return fallback
        } finally {
          delete doctorNameReqs.current[pid]
        }
      })()
    }
  }, [result, doctorNames])

  // =========================
  // Event handlers
  // =========================

  function onChange<K extends keyof RouteRequest>(key: K, value: RouteRequest[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function onNewApptChange<K extends keyof RouteRequest['newAppt']>(key: K, value: any) {
    setForm((f) => ({ ...f, newAppt: { ...f.newAppt, [key]: value } }))
  }

  function pickClient(c: Client) {
    const addr = formatClientAddress(c)
    const latNum = typeof c.lat === 'string' ? parseFloat(c.lat) : c.lat
    const lonNum = typeof c.lon === 'string' ? parseFloat(c.lon) : c.lon

    setForm((f) => ({
      ...f,
      newAppt: {
        ...f.newAppt,
        clientId: String(c.id),
        address: addr,
        lat: Number.isFinite(latNum as number) ? (latNum as number) : undefined,
        lon: Number.isFinite(lonNum as number) ? (lonNum as number) : undefined,
      },
    }))

    setClientQuery(`${c.lastName}, ${c.firstName}`)
    setClientResults([])
    setShowClientDropdown(false)
  }

  function pickDoctor(d: Doctor) {
    const pimsId = doctorPimsIdOf(d)
    if (!pimsId) {
      console.warn('No pimsId on doctor record', d)
      return
    }
    setForm((f) => ({ ...f, doctorId: pimsId }))
    setDoctorQuery(localDoctorDisplayName(d))
    setDoctorResults([])
    setShowDoctorDropdown(false)
  }

  function diffDaysInclusive(aISO: string, bISO: string) {
    const a = new Date(aISO + 'T00:00:00')
    const b = new Date(bISO + 'T00:00:00')
    const ms = b.getTime() - a.getTime()
    const days = Math.floor(ms / (1000 * 60 * 60 * 24))
    return days + 1 // inclusive
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (new Date(form.endDate) < new Date(form.startDate)) {
      setError('End date must be on or after the start date.')
      return
    }

    const numDays = Math.max(1, diffDaysInclusive(form.startDate, form.endDate))
    const endpoint = multiDoctor ? '/routing/any-doctor' : '/routing'

    const payload = multiDoctor
      ? {
          primaryDoctorPimsId: form.doctorId,
          startDate: form.startDate,
          numDays,
          newAppt: form.newAppt,
          useTraffic: false,
          maxAddedDriveMinutes, // threshold
        }
      : {
          doctorId: form.doctorId,
          startDate: form.startDate,
          numDays,
          newAppt: form.newAppt,
          useTraffic: false,
        }

    setLoading(true)
    try {
      const { data } = await http.post<Result>(endpoint, payload)
      setResult(data)
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  // =========================
  // Render
  // =========================

  const winnerDoctorName =
    result?.selectedDoctorPimsId
      ? doctorNames[result.selectedDoctorPimsId] ?? `Doctor ${result.selectedDoctorPimsId}`
      : '' // single-doctor mode leaves this empty (we already show chosen doctor in input)

  return (
    <div className="grid" style={{ alignItems: 'start' }}>
      {/* ------- Form ------- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Get Best Route</h2>
        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Doctor picker */}
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
                      e.preventDefault()
                      pickDoctor(doctorResults[0])
                    }
                  }}
                  required
                />
                {doctorSearching && <div className="muted" style={{ marginTop: 6 }}>Searching...</div>}
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
                  >
                    {doctorResults.map((d) => (
                      <li
                        key={doctorPimsIdOf(d) || String(d.id ?? localDoctorDisplayName(d))}
                        onMouseDown={() => pickDoctor(d)}
                        style={{
                          padding: '10px 12px',
                          borderBottom: '1px solid #eee',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f6fbf9')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        {localDoctorDisplayName(d)}
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

          {/* Multi-doctor toggle & threshold */}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
            <Field label="Multi-doctor">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={multiDoctor}
                  onChange={(e) => setMultiDoctor(e.target.checked)}
                />
                <span>Try other doctors if added drive ≤ threshold</span>
              </label>
            </Field>
            {multiDoctor && (
              <Field label="Max Added Drive (minutes)">
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={maxAddedDriveMinutes}
                  onChange={(e) => setMaxAddedDriveMinutes(Math.max(1, Number(e.target.value || 20)))}
                />
              </Field>
            )}
          </div>

          {/* Appt + client */}
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

            {/* Client search */}
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
                      e.preventDefault()
                      pickClient(clientResults[0])
                    }
                  }}
                />
                {clientSearching && <div className="muted" style={{ marginTop: 6 }}>Searching...</div>}
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
                  >
                    {clientResults.map((c) => (
                      <li
                        key={c.id}
                        onMouseDown={() => pickClient(c)}
                        style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f6fbf9')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {c.lastName}, {c.firstName}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {formatClientAddress(c) || '—'}
                        </div>
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

            <Field label="Client ID (optional)">
              <input
                className="input"
                value={form.newAppt.clientId ?? ''}
                onChange={(e) => onNewApptChange('clientId', e.target.value || undefined)}
              />
            </Field>
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

        {result && (
          <div className="grid">
            {/* For any-doctor responses, show winner doctor */}
            {(multiDoctor || result.selectedDoctorPimsId || result.selectedDoctor) && (
              <div className="pill">
                Doctor:{' '}
                {result.selectedDoctorPimsId
                  ? winnerDoctorName
                  : (result.selectedDoctor?.name ||
                     [result.selectedDoctor?.firstName, result.selectedDoctor?.lastName].filter(Boolean).join(' ') ||
                     form.doctorId ||
                     '—')}
              </div>
            )}

            {/* Winner */}
            {result.winner && (
              <div className="card win">
                <div className="pill">Winner</div>
                <h3 style={{ margin: '6px 0 8px 0' }}>
                  Suggested Day: {result.winner.date}
                </h3>
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <KeyValue
                    k="Doctor"
                    v={
                      result.selectedDoctorPimsId
                        ? winnerDoctorName
                        : (result.selectedDoctor?.name ||
                           [result.selectedDoctor?.firstName, result.selectedDoctor?.lastName].filter(Boolean).join(' ') ||
                           form.doctorId ||
                           '—')
                    }
                  />
                  <KeyValue k="Insertion Index" v={String(result.winner.insertionIndex)} />
                  <KeyValue k="Start Time" v={isoToTime(result.winner.suggestedStartIso)} />
                  <KeyValue
                    k="Added Drive"
                    v={result.winner.addedDrivePretty ?? secsToPretty(result.winner.addedDriveSeconds)}
                    color={colorForAddedDrive(result.winner.addedDriveSeconds)}
                  />
                  <KeyValue
                    k="Projected Daily Drive"
                    v={result.winner.projectedDrivePretty ?? secsToPretty(result.winner.projectedDriveSeconds)}
                    color={colorForProjectedDrive(result.winner.projectedDriveSeconds)}
                  />
                  <KeyValue
                    k="Current Drive"
                    v={result.winner.currentDrivePretty ?? secsToPretty(result.winner.currentDriveSeconds)}
                    color="inherit"
                  />
                </div>
              </div>
            )}

            {/* Alternates */}
            {Array.isArray(result.alternates) && result.alternates.length > 0 && (
              <div>
                <h4>Alternates</h4>
                <div className="grid">
                  {result.alternates.map((a, idx) => (
                    <div className="card" key={`${a.date}-${idx}`}>
                      <div className="pill">Option</div>
                      <h3 style={{ margin: '6px 0 8px 0' }}>Day: {a.date}</h3>
                      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <KeyValue k="Insertion Index" v={String(a.insertionIndex)} />
                        <KeyValue k="Start Time" v={isoToTime(a.suggestedStartIso)} />
                        <KeyValue
                          k="Added Drive"
                          v={a.addedDrivePretty ?? secsToPretty(a.addedDriveSeconds)}
                          color={colorForAddedDrive(a.addedDriveSeconds)}
                        />
                        <KeyValue
                          k="Projected Drive"
                          v={a.projectedDrivePretty ?? secsToPretty(a.projectedDriveSeconds)}
                          color={colorForProjectedDrive(a.projectedDriveSeconds)}
                        />
                        <KeyValue
                          k="Current Drive"
                          v={a.currentDrivePretty ?? secsToPretty(a.currentDriveSeconds)}
                          color="inherit"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Estimated Cost (optional) */}
            {/* {result.estimatedCost && (
              <div className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="pill cost-tag">Estimated API Cost</div>
                </div>
                <table className="table">
                  <thead>
                    <tr><th>Element</th><th>Count</th><th>USD</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Distance Matrix elements</td>
                      <td>{result.estimatedCost.dmElements}</td>
                      <td>{fmtUsd(result.estimatedCost.dmCost)}</td>
                    </tr>
                    <tr>
                      <td>Directions requests</td>
                      <td>{result.estimatedCost.dirRequests}</td>
                      <td>{fmtUsd(result.estimatedCost.dirCost)}</td>
                    </tr>
                    <tr>
                      <td><strong>Total</strong></td>
                      <td></td>
                      <td><strong>{fmtUsd(result.estimatedCost.totalCostUSD)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )} */}
          </div>
        )}
      </div>
    </div>
  )
}
