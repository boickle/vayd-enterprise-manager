import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Filter, Mic, Phone, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { DateTime } from 'luxon';
import { useAuth } from '../auth/useAuth';
import {
  fetchAppointmentsRange,
  fetchDoctorDay,
  isBlockEntry,
  isPracticeCalendarBlockAppointment,
  localDayUtcRange,
  type DoctorDayAppt,
} from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { fetchPatientByIdStaff, searchPatientsStaff, type PatientSearchRow } from '../api/patients';
import { fetchSoapCalendarLockIndex, VISIT_WORKFLOW_PRACTICE_ID } from '../api/visitWorkflow';
import { saveBrief } from '../api/briefs';
import { DEFAULT_PRACTICE_TIMEZONE, practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import { appointmentIsCalendarOnlyStaffItem } from '../utils/calendarOnlyStaffAppointment';
import { listLocalBriefsForDate, getLocalBrief } from '../utils/briefStore';
import type { BriefSession } from '../utils/briefTypes';
import { BRIEF_KIND_LABEL, isBriefKind } from '../utils/briefTypes';
import {
  clientIdFromPatientRow,
  clientNameFromPatientRow,
  clientPhoneFromRecord,
  formatBriefWhen,
  initialsFromName,
  patientDisplayName,
  patientIdFromDoctorDay,
  pickStr,
} from '../utils/briefDisplay';
import BriefStartModal, { type BriefStartPayload } from '../components/brief/BriefStartModal';
import BriefSessionView from '../components/brief/BriefSessionView';
import BriefPatientPanel, { type BriefPatientTab } from '../components/brief/BriefPatientPanel';
import ScribePromptOverridesModal from '../components/soap/ScribePromptOverridesModal';
import './BriefWorkspacePage.css';

function rangeApptToDayRow(a: Appointment): DoctorDayAppt {
  const client = a.client as Record<string, unknown> | undefined;
  const clientName = client
    ? [pickStr(client.firstName), pickStr(client.lastName)].filter(Boolean).join(' ').trim() ||
      pickStr(client.name) ||
      ''
    : '';
  return {
    id: a.id,
    clientName,
    patientName: a.patient?.name,
    patient: a.patient ? (a.patient as unknown as Record<string, unknown>) : null,
    startIso: a.appointmentStart,
    appointmentStart: a.appointmentStart,
    appointmentType: a.appointmentType?.prettyName ?? a.appointmentType?.name,
    isComplete: a.isComplete,
    isBlock: Boolean((a as { isBlock?: boolean }).isBlock),
    isPersonalBlock: Boolean((a as { isPersonalBlock?: boolean }).isPersonalBlock),
    type: (a as { type?: 'appointment' | 'block' }).type,
    description: a.description ?? undefined,
  };
}

function asTypeLabel(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const o = value as { prettyName?: string; name?: string };
    return String(o.prettyName || o.name || '').trim();
  }
  return String(value).trim();
}

function visitTypeLabel(appt: DoctorDayAppt): string {
  return asTypeLabel(appt.appointmentType) || asTypeLabel(appt.blockLabel) || asTypeLabel(appt.title);
}

function isStaffCalendarLabel(value: unknown): boolean {
  const t = asTypeLabel(value).toLowerCase();
  if (!t) return false;
  if (t.includes('zone assignment')) return true;
  if (t.includes('note to staff')) return true;
  if (t.includes('vacation') || t.includes('sick time') || t.includes('sick day')) return true;
  if (t === 'block' || t.includes('personal block') || t.includes('flex block')) return true;
  return false;
}

/** Real patient visits only — not vacation, staff notes, zone assignment, or personal blocks. */
function isEpiphanyTodayVisit(appt: DoctorDayAppt): boolean {
  if (isBlockEntry(appt)) return false;
  if (appointmentIsCalendarOnlyStaffItem(appt)) return false;
  const staffFields = [
    visitTypeLabel(appt),
    appt.patientName,
    appt.clientName,
    appt.blockLabel,
    appt.title,
  ];
  if (staffFields.some((v) => isStaffCalendarLabel(v))) return false;
  const pet = (appt.patientName?.trim() || pickStr(appt.patient?.name) || '').trim();
  if (!pet || isStaffCalendarLabel(pet) || pet.toLowerCase() === 'client') return false;
  return true;
}

function visitListTitle(appt: DoctorDayAppt): string {
  const pet = appt.patientName?.trim() || pickStr(appt.patient?.name) || '';
  const owner = appt.clientName?.trim() && appt.clientName.trim() !== 'Client' ? appt.clientName.trim() : '';
  if (pet && owner) return `${pet} · ${owner}`;
  if (pet) return pet;
  return owner || 'Visit';
}

function visitStartMs(appt: DoctorDayAppt): number {
  const iso = appt.startIso ?? appt.appointmentStart;
  if (!iso) return Number.POSITIVE_INFINITY;
  const d = DateTime.fromISO(iso);
  return d.isValid ? d.toMillis() : Number.POSITIVE_INFINITY;
}

function epiphanyDayVisits(rows: DoctorDayAppt[]): DoctorDayAppt[] {
  return rows.filter(isEpiphanyTodayVisit).sort((a, b) => visitStartMs(a) - visitStartMs(b));
}

type BriefPatientPrefill = {
  id: string | number;
  name: string;
  clientId?: string | number | null;
  clientName?: string | null;
  clientPhone?: string | null;
};

function isPatientTab(v: string | null): v is BriefPatientTab {
  return (
    v === 'info' ||
    v === 'sessions' ||
    v === 'calls' ||
    v === 'review' ||
    v === 'history' ||
    v === 'merge'
  );
}

type WorkspaceView = 'today' | 'patients';

export default function BriefWorkspacePage() {
  const { employeeId, doctorId, role } = useAuth() as {
    employeeId?: string | null;
    doctorId?: string | null;
    role?: string[];
  };
  const [params, setParams] = useSearchParams();
  const practiceTz = practiceTimeZoneOrDefault(DEFAULT_PRACTICE_TIMEZONE);

  const view: WorkspaceView = params.get('view') === 'patients' ? 'patients' : 'today';
  const date =
    params.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(params.get('date')!)
      ? params.get('date')!
      : DateTime.now().setZone(practiceTz).toFormat('yyyy-LL-dd');
  const patientId = params.get('patientId');
  const sessionId = params.get('sessionId');
  const patientTab: BriefPatientTab = isPatientTab(params.get('patientTab'))
    ? (params.get('patientTab') as BriefPatientTab)
    : 'info';
  const callsOnly = params.get('filter') === 'calls';
  const newOpen = params.get('new') === '1';
  const kindParam = params.get('kind');
  const startKind = kindParam && isBriefKind(kindParam) ? kindParam : null;

  const patchParams = useCallback(
    (next: Record<string, string | null>) => {
      const copy = new URLSearchParams(params);
      for (const [k, v] of Object.entries(next)) {
        if (v == null || v === '') copy.delete(k);
        else copy.set(k, v);
      }
      setParams(copy, { replace: true });
    },
    [params, setParams]
  );

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PatientSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [archived, setArchived] = useState(false);
  const [dayAppts, setDayAppts] = useState<DoctorDayAppt[]>([]);
  const [briefs, setBriefs] = useState<BriefSession[]>(() => listLocalBriefsForDate(date));
  const [lockedIds, setLockedIds] = useState<Set<number>>(new Set());
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerFilter, setProviderFilter] = useState<'me' | 'all'>('me');
  const [filterOpen, setFilterOpen] = useState(false);
  const [session, setSession] = useState<BriefSession | null>(null);
  const [startPatient, setStartPatient] = useState<BriefPatientPrefill | null>(null);
  const [showPromptOverrides, setShowPromptOverrides] = useState(false);

  const selfId = employeeId || doctorId || '';
  const selfEmployeeNum = selfId !== '' ? Number(selfId) : NaN;
  const rolesLower = (Array.isArray(role) ? role : []).map((r) => String(r).toLowerCase());
  const isAdmin = rolesLower.some((r) => r === 'admin' || r === 'superadmin');
  const selfIsProvider =
    Number.isFinite(selfEmployeeNum) &&
    providers.some((p) => Number(p.id) === selfEmployeeNum);
  const canManageAiPrompt = selfIsProvider || isAdmin;
  const promptProviderOptions = useMemo(
    () =>
      providers
        .map((p) => ({
          id: Number(p.id),
          name: p.name?.trim() || `Provider #${p.id}`,
        }))
        .filter((p) => Number.isFinite(p.id) && p.id > 0),
    [providers]
  );
  const defaultPromptProviderId = selfIsProvider
    ? selfEmployeeNum
    : promptProviderOptions[0]?.id ?? null;
  const defaultPromptProviderName =
    promptProviderOptions.find((p) => p.id === defaultPromptProviderId)?.name ??
    'Provider';

  useEffect(() => {
    if (!newOpen || !patientId || startPatient) return;
    let canceled = false;
    void fetchPatientByIdStaff(patientId)
      .then((payload) => {
        if (canceled || !payload || typeof payload !== 'object') return;
        const rec = payload as Record<string, unknown>;
        setStartPatient({
          id: patientId,
          name: patientDisplayName(rec),
          clientId: clientIdFromPatientRow(rec),
          clientName: clientNameFromPatientRow(rec),
          clientPhone: clientPhoneFromRecord(rec),
        });
      })
      .catch(() => {
        /* modal still works without a prefill */
      });
    return () => {
      canceled = true;
    };
  }, [newOpen, patientId, startPatient]);

  useEffect(() => {
    void fetchPrimaryProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
    void fetchSoapCalendarLockIndex()
      .then((idx) => setLockedIds(new Set(idx.lockedAppointmentIds)))
      .catch(() => setLockedIds(new Set()));
  }, []);

  const quoFromLine = useMemo(() => {
    const match = providers.find((p) => String(p.id) === String(selfId));
    return match?.quoLinePhone ?? null;
  }, [providers, selfId]);

  useEffect(() => {
    setBriefs(listLocalBriefsForDate(date));
  }, [date, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    setSession(getLocalBrief(sessionId));
  }, [sessionId, briefs]);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        if (providerFilter === 'all') {
          const { start, end } = localDayUtcRange(date, practiceTz);
          const rows = await fetchAppointmentsRange({
            practiceId: VISIT_WORKFLOW_PRACTICE_ID,
            start,
            end,
          });
          if (!canceled) {
            setDayAppts(
              epiphanyDayVisits(
                rows.filter((a) => !isPracticeCalendarBlockAppointment(a)).map(rangeApptToDayRow)
              )
            );
          }
          return;
        }
        const res = await fetchDoctorDay(date, selfId || undefined);
        if (!canceled) setDayAppts(epiphanyDayVisits(res.appointments ?? []));
      } catch {
        if (!canceled) setDayAppts([]);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [date, providerFilter, selfId, practiceTz]);

  useEffect(() => {
    const q = query.trim();
    if (view !== 'patients' || !q) {
      setHits([]);
      return;
    }
    let canceled = false;
    const t = window.setTimeout(() => {
      setSearching(true);
      void searchPatientsStaff(q, {
        practiceId: VISIT_WORKFLOW_PRACTICE_ID,
        activeOnly: !archived,
      })
        .then((rows) => {
          if (!canceled) setHits(rows);
        })
        .catch(() => {
          if (!canceled) setHits([]);
        })
        .finally(() => {
          if (!canceled) setSearching(false);
        });
    }, 280);
    return () => {
      canceled = true;
      window.clearTimeout(t);
    };
  }, [query, view, archived]);

  const shiftDate = (days: number) => {
    const next = DateTime.fromISO(date, { zone: practiceTz }).plus({ days }).toFormat('yyyy-LL-dd');
    patchParams({ date: next });
  };

  const todayLabel = useMemo(() => {
    const d = DateTime.fromISO(date, { zone: practiceTz });
    const now = DateTime.now().setZone(practiceTz);
    const pretty = d.toFormat('LLL d');
    if (d.hasSame(now, 'day')) return `Today (${pretty})`;
    if (d.hasSame(now.minus({ days: 1 }), 'day')) return `Yesterday (${pretty})`;
    if (d.hasSame(now.plus({ days: 1 }), 'day')) return `Tomorrow (${pretty})`;
    return pretty;
  }, [date, practiceTz]);

  const startBrief = async (payload: BriefStartPayload) => {
    if (payload.kind === 'visit' && payload.appointmentId && payload.patientId) {
      patchParams({ new: null });
      window.location.assign(
        `/schedule/soap/${payload.appointmentId}/${payload.patientId}${
          payload.clientId ? `?clientId=${payload.clientId}` : ''
        }`
      );
      return;
    }
    const created = await saveBrief({
      kind: payload.kind,
      title: payload.title,
      date,
      employeeId: selfId || null,
      patientId: payload.patientId ?? null,
      patientName: payload.patientName ?? null,
      clientId: payload.clientId ?? null,
      clientName: payload.clientName ?? null,
      clientPhone: payload.clientPhone ?? null,
      appointmentId: payload.appointmentId ?? null,
    });
    setBriefs(listLocalBriefsForDate(date));
    patchParams({
      new: null,
      sessionId: created.id,
      patientId: payload.patientId != null ? String(payload.patientId) : null,
      view: payload.kind === 'huddle' ? 'today' : view,
    });
  };

  const openAppt = (appt: DoctorDayAppt) => {
    const pid = patientIdFromDoctorDay(appt);
    if (!pid) return;
    const apptId = typeof appt.id === 'number' ? appt.id : Number(appt.id);
    if (!Number.isFinite(apptId)) {
      patchParams({ view: 'patients', patientId: pid, sessionId: null });
      return;
    }
    window.location.assign(`/schedule/soap/${apptId}/${pid}`);
  };

  const visibleBriefs = callsOnly ? briefs.filter((b) => b.kind === 'callback') : briefs;
  const visibleAppts = callsOnly ? [] : dayAppts.filter(isEpiphanyTodayVisit);

  return (
    <div className="brief-app">
      <aside className="brief-app__list">
        <div className="brief-app__views">
          <button
            type="button"
            className={`brief-pill${view === 'today' ? ' is-active' : ''}`}
            onClick={() => patchParams({ view: 'today', patientId: null })}
          >
            Today
          </button>
          <button
            type="button"
            className={`brief-pill${view === 'patients' ? ' is-active' : ''}`}
            onClick={() => patchParams({ view: 'patients' })}
          >
            Patients
          </button>
          {canManageAiPrompt && defaultPromptProviderId != null ? (
            <button
              type="button"
              className="brief-pill"
              title="Edit AI scribe / Epiphany note instructions"
              onClick={() => setShowPromptOverrides(true)}
            >
              <SlidersHorizontal size={13} /> AI instructions
            </button>
          ) : null}
        </div>

        {view === 'today' ? (
          <>
            <div className="brief-date-nav">
              <button
                type="button"
                className="brief-icon-btn"
                onClick={() => shiftDate(-1)}
                aria-label="Previous day"
              >
                <ChevronLeft size={18} />
              </button>
              <span>{todayLabel}</span>
              <button
                type="button"
                className="brief-icon-btn"
                onClick={() => shiftDate(1)}
                aria-label="Next day"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="brief-toolbar">
              <button
                type="button"
                className="brief-btn primary"
                onClick={() => patchParams({ new: '1' })}
              >
                <Plus size={15} /> New
              </button>
              <button
                type="button"
                className={`brief-icon-btn round${callsOnly ? ' is-on' : ''}`}
                aria-pressed={callsOnly}
                title="Calls only"
                onClick={() => patchParams({ filter: callsOnly ? null : 'calls' })}
              >
                <Phone size={16} />
              </button>
              <button type="button" className="brief-btn" onClick={() => setFilterOpen((v) => !v)}>
                <Filter size={14} /> Filter
              </button>
            </div>
            {callsOnly ? (
              <button
                type="button"
                className="brief-chip"
                onClick={() => patchParams({ filter: null })}
              >
                <Phone size={12} /> Calls only <X size={12} />
              </button>
            ) : null}
            {filterOpen ? (
              <div className="brief-filter-card">
                <label className="brief-field">
                  <span className="brief-field-label">Provider</span>
                  <select
                    className="brief-input"
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value === 'all' ? 'all' : 'me')}
                  >
                    <option value="me">Me</option>
                    <option value="all">Everybody</option>
                  </select>
                </label>
              </div>
            ) : null}

            <ul className="brief-day-list">
              {visibleAppts.length === 0 && visibleBriefs.length === 0 ? (
                <li className="brief-empty-inline">Nothing on this day yet.</li>
              ) : null}
              {visibleAppts.map((appt) => {
                const name = visitListTitle(appt);
                const avatarName = appt.patientName?.trim() || name;
                const start = appt.startIso ?? appt.appointmentStart;
                const apptNum = typeof appt.id === 'number' ? appt.id : Number(appt.id);
                const locked = Number.isFinite(apptNum) && lockedIds.has(apptNum);
                const type = visitTypeLabel(appt);
                const status = locked ? 'SOAP signed' : appt.isComplete ? 'complete' : '';
                return (
                  <li key={`appt-${appt.id}`}>
                    <button type="button" className="brief-day-item" onClick={() => openAppt(appt)}>
                      <span className="brief-avatar">{initialsFromName(avatarName)}</span>
                      <span className="brief-day-item__main">
                        <strong>{name}</strong>
                        <em>
                          {[formatBriefWhen(start, practiceTz), type, status].filter(Boolean).join(' · ')}
                        </em>
                      </span>
                    </button>
                  </li>
                );
              })}
              {visibleBriefs.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={`brief-day-item${sessionId === b.id ? ' is-active' : ''}`}
                    onClick={() =>
                      patchParams({
                        sessionId: b.id,
                        patientId: b.patientId != null ? String(b.patientId) : null,
                      })
                    }
                  >
                    <span className="brief-avatar">
                      {initialsFromName(b.patientName || b.title)}
                    </span>
                    <span className="brief-day-item__main">
                      <strong>{b.patientName || b.title}</strong>
                      <em>
                        {BRIEF_KIND_LABEL[b.kind]}
                        {b.transcript.trim()
                          ? ` · ${b.transcript.trim().slice(0, 48)}`
                          : ' · No recordings yet'}
                      </em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <label className="brief-search">
              <Search size={16} aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patients"
              />
              {query ? (
                <button
                  type="button"
                  className="brief-search-clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear"
                >
                  <X size={14} />
                </button>
              ) : null}
            </label>
            <div className="brief-pills brief-pills--compact">
              <button
                type="button"
                className={`brief-pill${archived ? '' : ' is-active'}`}
                onClick={() => setArchived(false)}
              >
                Active
              </button>
              <button
                type="button"
                className={`brief-pill${archived ? ' is-active' : ''}`}
                onClick={() => setArchived(true)}
              >
                Inactive
              </button>
            </div>
            <p className="brief-hint">
              Search a pet or client, then start an Epiphany from their profile.
            </p>
            {query.trim() ? (
              <>
                <div className="brief-result-head">
                  <span>{query.trim()}</span>
                  <button
                    type="button"
                    className="brief-text-btn"
                    onClick={() => {
                      setStartPatient(null);
                      patchParams({ new: '1' });
                    }}
                  >
                    + Add new
                  </button>
                </div>
                <ul className="brief-day-list">
                  {searching && hits.length === 0 ? (
                    <li className="brief-empty-inline">Searching…</li>
                  ) : null}
                  {!searching && hits.length === 0 ? (
                    <li className="brief-empty-inline">No matches.</li>
                  ) : null}
                  {hits.map((row) => {
                    const id = String(row.id);
                    const name = patientDisplayName(row);
                    const owner = clientNameFromPatientRow(row);
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className={`brief-day-item${patientId === id ? ' is-active' : ''}`}
                          onClick={() =>
                            patchParams({
                              patientId: id,
                              sessionId: null,
                              patientTab: 'info',
                            })
                          }
                        >
                          <span className="brief-avatar">{initialsFromName(name)}</span>
                          <span className="brief-day-item__main">
                            <strong>
                              {name}
                              {owner ? ` · ${owner}` : ''}
                            </strong>
                            <em>
                              {pickStr((row as Record<string, unknown>).species) ?? 'Patient'}
                            </em>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="brief-empty-inline">Type a name to find a chart.</p>
            )}
          </>
        )}
      </aside>

      <section className="brief-app__main">
        {session ? (
          <BriefSessionView
            session={session}
            quoFromLine={quoFromLine}
            onChange={(next) => {
              setSession(next);
              setBriefs(listLocalBriefsForDate(date));
            }}
            onDeleted={() => {
              setSession(null);
              setBriefs(listLocalBriefsForDate(date));
              patchParams({ sessionId: null });
            }}
          />
        ) : patientId ? (
          <BriefPatientPanel
            patientId={patientId}
            tab={patientTab}
            onTab={(t) => patchParams({ patientTab: t })}
            practiceTz={practiceTz}
            onOpenSession={(id) => patchParams({ sessionId: id })}
            onNew={(prefill) => {
              setStartPatient(prefill);
              patchParams({ new: '1' });
            }}
          />
        ) : (
          <div className="brief-welcome">
            <p className="brief-welcome__hello">Ready when you are</p>
            <h2>Epiphany</h2>
            <p>
              Capture prep notes before a visit, transcribe callbacks, or jot a staff huddle. Prep
              notes land in SOAP history as clinician notes — separate from what you talk through
              with the client.
            </p>
            <button
              type="button"
              className="brief-btn primary"
              onClick={() => patchParams({ new: '1' })}
            >
              <Mic size={15} /> Start an Epiphany
            </button>
            <p className="brief-welcome__foot">
              Need the full chart? <Link to="/schedule/patients">Open Patients</Link>
            </p>
          </div>
        )}
      </section>

      <BriefStartModal
        open={newOpen}
        practiceTz={practiceTz}
        initialPatient={startPatient}
        initialKind={startKind}
        onClose={() => {
          setStartPatient(null);
          patchParams({ new: null, kind: null });
        }}
        onStart={(payload) => void startBrief(payload)}
      />

      {showPromptOverrides && defaultPromptProviderId != null ? (
        <ScribePromptOverridesModal
          providerId={defaultPromptProviderId}
          providerName={defaultPromptProviderName}
          providerOptions={isAdmin ? promptProviderOptions : undefined}
          onClose={() => setShowPromptOverrides(false)}
        />
      ) : null}
    </div>
  );
}
