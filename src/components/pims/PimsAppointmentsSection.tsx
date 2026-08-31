import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { DateTime } from 'luxon';
import { Calendar } from 'lucide-react';
import type { Appointment } from '../../api/roomLoader';
import {
  appointmentMatchesPatientId,
  fetchClientAppointmentsStaff,
  fetchPatientAppointmentsStaff,
  isPatientRowActiveForListing,
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

/** Primary line for tables: pretty name, else type name. */
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
  const base = parts.length ? parts.join(' ') : '—';
  const des = pickStr(pp.designation);
  if (des && base !== '—') return `${base}, ${des}`;
  return base;
}

function patientLine(a: Appointment): string {
  if (a.patient?.name) return a.patient.name;
  const r = a as Record<string, unknown>;
  return pickStr(r.patientName) ?? '—';
}

/** Practice-local date + provider hints for scheduler focus (same as appointment search). */
export function schedulerHintsForPimsAppointment(
  appt: Appointment,
  practiceTz: string
): { dateKey: string | null; providerId: string | undefined } {
  const dateKey =
    DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz).toISODate() ??
    null;
  const providerId = appt.primaryProvider?.id != null ? String(appt.primaryProvider.id) : undefined;
  return { dateKey, providerId };
}

type BaseProps = { practiceId: number; practiceTz?: string };

export type PimsAppointmentsSectionPatientProps = BaseProps & {
  variant: 'patient';
  patientId: string;
  patientRecord: Record<string, unknown>;
};

export type PimsAppointmentsSectionClientProps = BaseProps & {
  variant: 'client';
  clientId: string;
  patients: Record<string, unknown>[];
};

export type PimsAppointmentsSectionProps =
  | PimsAppointmentsSectionPatientProps
  | PimsAppointmentsSectionClientProps;

export default function PimsAppointmentsSection(props: PimsAppointmentsSectionProps) {
  const navigate = useNavigate();
  const practiceTz = props.practiceTz ?? DEFAULT_PRACTICE_TZ;
  const [includeInactivePatients, setIncludeInactivePatients] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<Appointment[]>([]);

  const currentPatientActive =
    props.variant === 'patient' ? isPatientRowActiveForListing(props.patientRecord) : true;

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

  const filtered = useMemo(() => {
    if (props.variant === 'patient') {
      if (!includeInactivePatients && !currentPatientActive) return [];
      const list = raw.filter((a) => appointmentMatchesPatientId(a, props.patientId));
      return [...list].sort(
        (a, b) => Date.parse(b.appointmentStart) - Date.parse(a.appointmentStart)
      );
    }
    return [...raw].sort((a, b) => Date.parse(b.appointmentStart) - Date.parse(a.appointmentStart));
  }, [raw, props, includeInactivePatients, currentPatientActive]);

  const showPatientCol = props.variant === 'client';

  const openOnSchedule = (appt: Appointment) => {
    const apptId = Number(appt.id);
    if (!Number.isFinite(apptId) || apptId <= 0) return;
    const { dateKey, providerId } = schedulerHintsForPimsAppointment(appt, practiceTz);
    writeSchedulerFocusSession({
      appointmentId: apptId,
      dateHint: dateKey,
      providerHint: providerId ?? null,
    });
    navigate(
      buildSchedulerFocusAppointmentUrl(apptId, {
        date: dateKey ?? undefined,
        providerId,
      })
    );
  };

  return (
    <section className="pims-appts-section" aria-labelledby="pims-appts-heading">
      <div className="pims-appts-section__head">
        <h2 id="pims-appts-heading" className="pims-appts-section__title">
          <Calendar size={20} aria-hidden />
          Appointments ({filtered.length})
        </h2>
        <div className="pims-appts-section__controls">
          <label>
            <input
              type="checkbox"
              checked={includeInactivePatients}
              onChange={(e) => setIncludeInactivePatients(e.target.checked)}
            />
            Include inactive patients
          </label>
        </div>
      </div>
      <p className="pims-appts-section__hint">
        Click an appointment time to open that day on the schedule (edit visit, add pets, etc.).
        Only appointments for this {props.variant === 'patient' ? 'patient' : 'client (all pets)'}{' '}
        are requested from the server. Turn on the checkbox to ask for visits linked to inactive
        patients as well (when the API supports that flag).
      </p>
      {error ? (
        <p className="pims-appts-section__error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="pims-appts-section__loading">Loading appointments…</p>
      ) : filtered.length === 0 ? (
        <p className="pims-appts-section__empty">
          {props.variant === 'patient' && !includeInactivePatients && !currentPatientActive
            ? 'This patient is inactive. Turn on “Include inactive patients” to see their appointments.'
            : 'No appointments found for this filter.'}
        </p>
      ) : (
        <div className="pims-appts-section__table-wrap">
          <table className="pims-appts-section__table">
            <thead>
              <tr>
                <th>When</th>
                {showPatientCol ? <th>Patient</th> : null}
                <th>Type</th>
                <th>Status</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={String(a.id)}>
                  <td>
                    <button
                      type="button"
                      className="pims-appts-section__row-btn"
                      title="Open on schedule"
                      aria-label={`Open ${formatApptRange(a, practiceTz)} on schedule`}
                      onClick={() => openOnSchedule(a)}
                    >
                      {formatApptRange(a, practiceTz)}
                    </button>
                  </td>
                  {showPatientCol ? (
                    <td>
                      <span className="pims-appts-section__muted">{patientLine(a)}</span>
                    </td>
                  ) : null}
                  <td>{appointmentTypeLabel(a)}</td>
                  <td>{pickStr(a.statusName) ?? pickStr(a.confirmStatusName) ?? '—'}</td>
                  <td>{providerLine(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
