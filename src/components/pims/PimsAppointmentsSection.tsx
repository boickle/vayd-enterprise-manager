import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { Calendar } from 'lucide-react';
import type { Appointment } from '../../api/roomLoader';
import {
  appointmentMatchesPatientId,
  fetchClientAppointmentsStaff,
  fetchPatientAppointmentsStaff,
  isPatientRowActiveForListing,
} from '../../api/pimsAppointments';
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

/** Modal: show both display name and internal type name when they differ. */
function appointmentTypeDetail(a: Appointment): string {
  const t = a.appointmentType;
  if (!t || typeof t !== 'object') return '—';
  const o = t as { prettyName?: unknown; name?: unknown };
  const pretty = pickStr(o.prettyName);
  const name = pickStr(o.name);
  if (pretty && name && pretty !== name) return `${pretty} (${name})`;
  return pretty ?? name ?? '—';
}

function clientLine(a: Appointment): string {
  const c = a.client;
  if (!c) return '—';
  const o = c as Record<string, unknown>;
  const parts = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean);
  return parts.length ? parts.join(' ') : '—';
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

function formatDetailTimestamp(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const d = DateTime.fromISO(iso);
  if (!d.isValid) return iso.trim();
  return d.toLocaleString(DateTime.DATETIME_SHORT);
}

function treatmentSummary(a: Appointment): string | null {
  const tr = a.treatment;
  if (!tr || typeof tr !== 'object') return null;
  const o = tr as Record<string, unknown>;
  const pims = pickStr(o.pimsId);
  if (pims) return pims;
  if (o.id != null && String(o.id).trim()) return `#${String(o.id)}`;
  return null;
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

function PimsAppointmentDetailModal({
  appt,
  practiceTz,
  onClose,
}: {
  appt: Appointment;
  practiceTz: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const extra = appt as Record<string, unknown>;
  const lastSync = formatDetailTimestamp(extra.lastPimsSyncedAt);
  const created = formatDetailTimestamp(appt.created);
  const updated = formatDetailTimestamp(appt.updated);
  const extCreated = formatDetailTimestamp(extra.externalCreated);
  const extUpdated = formatDetailTimestamp(extra.externalUpdated);
  const booked = formatDetailTimestamp(appt.bookedDate);
  const treatment = treatmentSummary(appt);
  const meds = pickStr(appt.medications);
  const equip = pickStr(appt.equipment);
  const pimsType = pickStr(appt.pimsType);
  const apptPimsId = pickStr(appt.pimsId);

  const rows: { label: string; value: string }[] = [
    { label: 'When', value: formatApptRange(appt, practiceTz) },
    { label: 'Appointment type', value: appointmentTypeDetail(appt) },
    { label: 'Status', value: pickStr(appt.statusName) ?? '—' },
    { label: 'Confirm status', value: pickStr(appt.confirmStatusName) ?? '—' },
    { label: 'Provider', value: providerLine(appt) },
    { label: 'Client', value: clientLine(appt) },
    { label: 'Patient', value: patientLine(appt) },
    { label: 'Description', value: pickStr(appt.description) ?? '—' },
    { label: 'Instructions', value: pickStr(appt.instructions) ?? '—' },
  ];
  if (equip) rows.push({ label: 'Equipment', value: equip });
  if (meds) rows.push({ label: 'Medications', value: meds });
  rows.push({
    label: 'Visit',
    value: [appt.isComplete ? 'Complete' : 'Not complete', appt.allDay ? 'All day' : null].filter(Boolean).join(' · '),
  });
  if (booked) rows.push({ label: 'Booked', value: booked });
  if (treatment) rows.push({ label: 'Treatment (PIMS id)', value: treatment });
  if (lastSync) rows.push({ label: 'Last PIMS sync', value: lastSync });
  if (extCreated) rows.push({ label: 'External created', value: extCreated });
  if (extUpdated) rows.push({ label: 'External updated', value: extUpdated });
  if (created) rows.push({ label: 'Record created', value: created });
  if (updated) rows.push({ label: 'Record updated', value: updated });
  rows.push({ label: 'Appointment id (Vayd)', value: String(appt.id) });
  if (apptPimsId) rows.push({ label: 'Appointment PIMS id', value: apptPimsId });
  if (pimsType) rows.push({ label: 'PIMS type', value: pimsType });

  const modal = (
    <div
      className="pims-appts-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pims-appts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pims-appt-detail-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="pims-appt-detail-title" className="pims-appts-modal__title">
          Appointment details
        </h2>
        <div className="pims-appts-modal__rows">
          {rows.map((r) => (
            <div key={r.label} className="pims-appts-modal__row">
              <div className="pims-appts-modal__label">{r.label}</div>
              <div className="pims-appts-modal__value">{r.value}</div>
            </div>
          ))}
        </div>
        <div className="pims-appts-modal__actions">
          <button type="button" className="pims-appts-modal__close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default function PimsAppointmentsSection(props: PimsAppointmentsSectionProps) {
  const practiceTz = props.practiceTz ?? DEFAULT_PRACTICE_TZ;
  const [includeInactivePatients, setIncludeInactivePatients] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<Appointment[]>([]);
  const [detail, setDetail] = useState<Appointment | null>(null);

  const currentPatientActive =
    props.variant === 'patient' ? isPatientRowActiveForListing(props.patientRecord) : true;

  const fetchKey =
    props.variant === 'patient'
      ? `patient:${props.patientId}`
      : `client:${props.clientId}`;

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
        (a, b) => Date.parse(b.appointmentStart) - Date.parse(a.appointmentStart),
      );
    }
    return [...raw].sort(
      (a, b) => Date.parse(b.appointmentStart) - Date.parse(a.appointmentStart),
    );
  }, [raw, props, includeInactivePatients, currentPatientActive]);

  const showPatientCol = props.variant === 'client';

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
        Only appointments for this {props.variant === 'patient' ? 'patient' : 'client (all pets)'} are requested from
        the server. Turn on the checkbox to ask for visits linked to inactive patients as well (when the API
        supports that flag).
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
                      onClick={() => setDetail(a)}
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
      {detail ? (
        <PimsAppointmentDetailModal appt={detail} practiceTz={practiceTz} onClose={() => setDetail(null)} />
      ) : null}
    </section>
  );
}
