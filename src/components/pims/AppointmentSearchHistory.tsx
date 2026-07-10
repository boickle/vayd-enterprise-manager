import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DateTime } from 'luxon';
import type { Appointment } from '../../api/roomLoader';
import {
  appointmentMatchesPatientId,
  fetchClientAppointmentsStaff,
  fetchPatientAppointmentsStaff,
} from '../../api/pimsAppointments';
import {
  buildSchedulerFocusAppointmentUrl,
  writeSchedulerFocusSession,
} from '../../utils/schedulerFocusAppointment';
import './PimsAppointmentsSection.css';

const DEFAULT_PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function formatApptRange(appt: Appointment, tz: string): string {
  const s = DateTime.fromISO(appt.appointmentStart).setZone(tz);
  const e = DateTime.fromISO(appt.appointmentEnd).setZone(tz);
  if (!s.isValid) return appt.appointmentStart;
  const datePart = s.toLocaleString(DateTime.DATE_MED);
  const t1 = s.toLocaleString(DateTime.TIME_SIMPLE);
  const t2 = e.isValid ? e.toLocaleString(DateTime.TIME_SIMPLE) : '—';
  return `${datePart} · ${t1}–${t2}`;
}

function appointmentTypeLabel(a: Appointment): string {
  const t = a.appointmentType;
  if (t && typeof t === 'object') {
    const o = t as { prettyName?: unknown; name?: unknown };
    return pickStr(o.prettyName) ?? pickStr(o.name) ?? '—';
  }
  return '—';
}

function providerLine(a: Appointment): string {
  const pp = a.primaryProvider;
  if (!pp) return '—';
  const parts = [pickStr(pp.title), pickStr(pp.firstName), pickStr(pp.lastName)].filter(Boolean);
  return parts.length ? parts.join(' ') : '—';
}

function patientLine(a: Appointment): string {
  if (a.patient?.name) return a.patient.name;
  const r = a as Record<string, unknown>;
  return pickStr(r.patientName) ?? '—';
}

function isCancelledOrDeleted(appt: Appointment): boolean {
  if (appt.isDeleted) return true;
  const status = pickStr(appt.statusName)?.toLowerCase() ?? '';
  return status.includes('cancel');
}

function appointmentStartMs(appt: Appointment): number {
  return Date.parse(appt.appointmentStart);
}

function schedulerHintsForAppointment(
  appt: Appointment,
  practiceTz: string,
): { dateKey: string | null; providerId: string | undefined } {
  const dateKey =
    DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz).toISODate() ??
    null;
  const providerId =
    appt.primaryProvider?.id != null ? String(appt.primaryProvider.id) : undefined;
  return { dateKey, providerId };
}

/** One row per appointment — same slot → adjacent rows, sorted earliest to latest. */
export function sortAppointmentsForSearchList(
  appointments: readonly Appointment[],
): Appointment[] {
  return [...appointments]
    .filter((a) => a.appointmentStart && !isCancelledOrDeleted(a))
    .sort((a, b) => {
      const startDiff = appointmentStartMs(a) - appointmentStartMs(b);
      if (startDiff !== 0) return startDiff;
      const endDiff = Date.parse(a.appointmentEnd ?? '') - Date.parse(b.appointmentEnd ?? '');
      if (endDiff !== 0) return endDiff;
      return patientLine(a).localeCompare(patientLine(b), undefined, { sensitivity: 'base' });
    });
}

function splitPastAndFuture(
  rows: Appointment[],
  practiceTz: string,
): { past: Appointment[]; future: Appointment[] } {
  const todayStartMs = DateTime.now().setZone(practiceTz).startOf('day').toMillis();
  const past: Appointment[] = [];
  const future: Appointment[] = [];
  for (const appt of rows) {
    if (appointmentStartMs(appt) >= todayStartMs) future.push(appt);
    else past.push(appt);
  }
  return { past, future };
}

function slotKey(appt: Appointment): string {
  const providerId = appt.primaryProvider?.id ?? '';
  return `${appt.appointmentStart}|${providerId}`;
}

type AppointmentSlotGroup = {
  key: string;
  appointments: Appointment[];
};

/** Group all appointments sharing the same start + provider, preserving list order. */
function groupAppointmentsBySlot(rows: Appointment[]): AppointmentSlotGroup[] {
  const byKey = new Map<string, Appointment[]>();
  for (const appt of rows) {
    const key = slotKey(appt);
    const batch = byKey.get(key);
    if (batch) batch.push(appt);
    else byKey.set(key, [appt]);
  }

  const groups: AppointmentSlotGroup[] = [];
  const seen = new Set<string>();
  for (const appt of rows) {
    const key = slotKey(appt);
    if (seen.has(key)) continue;
    seen.add(key);
    const appointments = byKey.get(key)!;
    groups.push({
      key: `${key}::${appointments.map((a) => a.id).join(',')}`,
      appointments,
    });
  }
  return groups;
}

function sharedProviderInSlot(appointments: Appointment[]): string | null {
  if (appointments.length <= 1) return null;
  const first = providerLine(appointments[0]!);
  if (first === '—') return null;
  return appointments.every((a) => providerLine(a) === first) ? first : null;
}

function AppointmentTable({
  rows,
  practiceTz,
  showPatient,
  onViewAppointment,
}: {
  rows: Appointment[];
  practiceTz: string;
  showPatient: boolean;
  onViewAppointment: (appt: Appointment) => void;
}) {
  if (rows.length === 0) {
    return <p className="pims-appts-section__empty">No appointments in this section.</p>;
  }

  const slotGroups = groupAppointmentsBySlot(rows);

  return (
    <div className="appt-search-history__list">
      {slotGroups.map((group) => {
        const multi = group.appointments.length > 1;
        const sharedProvider = sharedProviderInSlot(group.appointments);
        const whenLabel = formatApptRange(group.appointments[0]!, practiceTz);

        return (
          <article
            key={group.key}
            className={[
              'appt-search-history__visit',
              multi ? 'appt-search-history__visit--multi' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <header className="appt-search-history__visit-head">
              <span className="appt-search-history__visit-when">{whenLabel}</span>
              {multi ? (
                <span className="appt-search-history__visit-pets-badge">
                  {group.appointments.length} pets
                </span>
              ) : null}
              {sharedProvider ? (
                <span className="appt-search-history__visit-provider">{sharedProvider}</span>
              ) : !multi ? (
                <span className="appt-search-history__visit-provider">
                  {providerLine(group.appointments[0]!)}
                </span>
              ) : null}
            </header>

            <ul className="appt-search-history__visit-rows">
              {group.appointments.map((appt) => (
                <li
                  key={String(appt.id)}
                  className={[
                    'appt-search-history__visit-row',
                    showPatient ? 'appt-search-history__visit-row--with-patient' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {showPatient ? (
                    <span className="appt-search-history__visit-patient">{patientLine(appt)}</span>
                  ) : null}
                  <div className="appt-search-history__visit-details">
                    <span className="appt-search-history__visit-type">{appointmentTypeLabel(appt)}</span>
                    <span className="appt-search-history__visit-status">
                      {pickStr(appt.statusName) ?? pickStr(appt.confirmStatusName) ?? '—'}
                    </span>
                    {!sharedProvider && multi ? (
                      <span className="appt-search-history__visit-provider-inline">
                        {providerLine(appt)}
                      </span>
                    ) : null}
                  </div>
                  <span className="appt-search-history__visit-action">
                    <button
                      type="button"
                      className="btn secondary appt-search-history__view-btn"
                      onClick={() => onViewAppointment(appt)}
                    >
                      View appointment
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

function AppointmentSection({
  title,
  count,
  defaultOpen,
  rows,
  practiceTz,
  showPatient,
  onViewAppointment,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  rows: Appointment[];
  practiceTz: string;
  showPatient: boolean;
  onViewAppointment: (appt: Appointment) => void;
}) {
  if (count === 0) return null;

  return (
    <details className="appt-search-history__section" open={defaultOpen}>
      <summary className="appt-search-history__section-summary">
        <span className="appt-search-history__section-title">{title}</span>
        <span className="appt-search-history__section-count">({count})</span>
      </summary>
      <div className="appt-search-history__section-body">
        <AppointmentTable
          rows={rows}
          practiceTz={practiceTz}
          showPatient={showPatient}
          onViewAppointment={onViewAppointment}
        />
      </div>
    </details>
  );
}

export type AppointmentSearchHistoryProps =
  | {
      variant: 'client';
      clientId: string;
      practiceId: number;
      practiceTz?: string;
    }
  | {
      variant: 'patient';
      patientId: string;
      practiceId: number;
      practiceTz?: string;
    };

export default function AppointmentSearchHistory(props: AppointmentSearchHistoryProps) {
  const navigate = useNavigate();
  const practiceTz = props.practiceTz ?? DEFAULT_PRACTICE_TZ;
  const [includeInactivePatients, setIncludeInactivePatients] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<Appointment[]>([]);

  const fetchKey =
    props.variant === 'patient' ? `patient:${props.patientId}` : `client:${props.clientId}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (props.variant === 'patient') {
          const rows = await fetchPatientAppointmentsStaff(props.patientId, {
            practiceId: props.practiceId,
            includeInactivePatient: includeInactivePatients,
          });
          if (!cancelled) setRaw(rows);
        } else {
          const rows = await fetchClientAppointmentsStaff(props.clientId, {
            practiceId: props.practiceId,
            activePatientsOnly: !includeInactivePatients,
          });
          if (!cancelled) setRaw(rows);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load appointments.');
          setRaw([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.practiceId, includeInactivePatients, fetchKey, props.variant]);

  const { past, future } = useMemo(() => {
    let list =
      props.variant === 'patient'
        ? raw.filter((a) => appointmentMatchesPatientId(a, props.patientId))
        : raw;
    const sorted = sortAppointmentsForSearchList(list);
    const { past, future } = splitPastAndFuture(sorted, practiceTz);
    return { past: [...past].reverse(), future };
  }, [raw, props, practiceTz]);

  const showPatientCol = props.variant === 'client';
  const totalCount = past.length + future.length;

  const viewAppointment = (appt: Appointment) => {
    const apptId = Number(appt.id);
    if (!Number.isFinite(apptId) || apptId <= 0) return;
    const { dateKey, providerId } = schedulerHintsForAppointment(appt, practiceTz);
    writeSchedulerFocusSession({
      appointmentId: apptId,
      dateHint: dateKey,
      providerHint: providerId ?? null,
    });
    navigate(
      buildSchedulerFocusAppointmentUrl(apptId, {
        date: dateKey ?? undefined,
        providerId,
      }),
    );
  };

  return (
    <div className="appt-search-history">
      <div className="pims-appts-section__controls appt-search-history__controls">
        <label>
          <input
            type="checkbox"
            checked={includeInactivePatients}
            onChange={(e) => setIncludeInactivePatients(e.target.checked)}
          />
          Include inactive patients
        </label>
      </div>

      {error ? (
        <p className="pims-appts-section__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="pims-appts-section__loading">Loading appointments…</p>
      ) : totalCount === 0 ? (
        <p className="pims-appts-section__empty">No appointments found.</p>
      ) : (
        <div className="appt-search-history__sections">
          <AppointmentSection
            title="Future appointments"
            count={future.length}
            defaultOpen
            rows={future}
            practiceTz={practiceTz}
            showPatient={showPatientCol}
            onViewAppointment={viewAppointment}
          />
          <AppointmentSection
            title="Past appointments"
            count={past.length}
            defaultOpen={false}
            rows={past}
            practiceTz={practiceTz}
            showPatient={showPatientCol}
            onViewAppointment={viewAppointment}
          />
        </div>
      )}
    </div>
  );
}
