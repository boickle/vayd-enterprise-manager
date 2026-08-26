import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { fetchAppointmentById } from '../api/appointments';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { createForwardBooking, type ForwardBookingEntry } from '../api/forwardBooking';
import { fetchPatientAppointmentsStaff, clientIdFromAppointment } from '../api/pimsAppointments';
import { fetchPatientByIdStaff, searchPatientsStaff, type PatientSearchRow } from '../api/patients';
import type { Appointment } from '../api/roomLoader';
import {
  buildCreateForwardBookingPayloadFromAppointment,
  buildCreateForwardBookingPayloadFromPatient,
  FORWARD_BOOKING_AMOUNT_OPTIONS,
  FORWARD_BOOKING_UNIT_OPTIONS,
  type ForwardBookingIntervalUnit,
} from '../utils/forwardBookingFromAppointment';
import type { CreateForwardBookingPrefill } from '../utils/forwardBookingCreateLink';
import { clientsForPatientSearchRow, primaryClientLabelForPatientRow } from '../utils/pimsPatientSearchRow';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import '../pages/Scheduler.css';
import '../pages/Settings.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

/** Select value when staff adds forward booking without a linked source visit. */
const NO_ASSOCIATED_VISIT = '__no_source_visit__';

type Props = {
  practiceId?: number;
  prefill?: CreateForwardBookingPrefill | null;
  onClose: () => void;
  onCreated: (entry: ForwardBookingEntry) => void;
};

type PatientPick = { id: number; label: string };

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientSearchLabel(row: Record<string, unknown>): string {
  const joined = [pickStr(row.firstName), pickStr(row.lastName)].filter(Boolean).join(' ').trim();
  const name = pickStr(row.name) ?? (joined || 'Patient');
  const owner = primaryClientLabelForPatientRow(row as PatientSearchRow);
  return owner ? `${name} (${owner})` : name;
}

function formatSourceApptOption(a: Appointment, practiceTz: string): string {
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const end = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).setZone(practiceTz);
  const datePart = start.isValid ? start.toFormat('EEE, MMM d, yyyy') : '—';
  const timePart =
    start.isValid && end.isValid
      ? `${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`
      : start.isValid
        ? start.toFormat('h:mm a')
        : '—';
  const typeName =
    pickStr(a.appointmentType?.name) ?? pickStr(a.appointmentType?.prettyName) ?? '';
  const desc = pickStr(a.description);
  return [datePart, timePart, typeName, desc].filter(Boolean).join(' · ');
}

function providerSelectLabel(p: Provider): string {
  const name =
    [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim() ||
    pickStr(p.name) ||
    `Provider #${p.id}`;
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function defaultProviderIdFromAppointment(appt: Appointment | null): string {
  const id = appt?.primaryProvider?.id;
  if (id == null || !Number.isFinite(Number(id))) return '';
  return String(id);
}

function errMsg(e: unknown): string {
  const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = ax?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string' && m.trim()) return m;
  if (ax?.message) return ax.message;
  return 'Could not create forward booking.';
}

export function CreateForwardBookingModal({
  practiceId = PRACTICE_ID,
  prefill = null,
  onClose,
  onCreated,
}: Props) {
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<PatientPick[]>([]);
  const [patientOpen, setPatientOpen] = useState(false);
  const [patientSearching, setPatientSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientPick | null>(null);
  const patientWrapRef = useRef<HTMLDivElement>(null);
  const patientSeq = useRef(0);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState('');
  const [forwardAmount, setForwardAmount] = useState('');
  const [forwardUnit, setForwardUnit] = useState<ForwardBookingIntervalUnit | ''>('');
  const [bookingNotes, setBookingNotes] = useState('');
  const [forwardBookingProviderId, setForwardBookingProviderId] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [appointmentTypes, setAppointmentTypes] = useState<
    Awaited<ReturnType<typeof fetchAllAppointmentTypes>>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAppointment = useMemo(
    () => appointments.find((a) => String(a.id) === selectedAppointmentId) ?? null,
    [appointments, selectedAppointmentId]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const types = await fetchAllAppointmentTypes(practiceId, { activeOnly: false });
        if (!cancelled) setAppointmentTypes(Array.isArray(types) ? types : []);
      } catch {
        if (!cancelled) setAppointmentTypes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  useEffect(() => {
    let cancelled = false;
    setProvidersLoading(true);
    void (async () => {
      try {
        const rows = await fetchPrimaryProviders();
        if (!cancelled) setProviders(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setProviders([]);
      } finally {
        if (!cancelled) setProvidersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedAppointmentId === NO_ASSOCIATED_VISIT || !selectedAppointmentId) {
      setForwardBookingProviderId('');
      return;
    }
    const appt = appointments.find((a) => String(a.id) === selectedAppointmentId) ?? null;
    setForwardBookingProviderId(defaultProviderIdFromAppointment(appt));
  }, [selectedAppointmentId, appointments]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (patientWrapRef.current && !patientWrapRef.current.contains(e.target as Node)) {
        setPatientOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const q = patientQuery.trim();
    if (selectedPatient && q === selectedPatient.label) {
      setPatientResults([]);
      return;
    }
    if (!q) {
      setPatientResults([]);
      return;
    }
    const id = ++patientSeq.current;
    const timer = window.setTimeout(async () => {
      setPatientSearching(true);
      try {
        const rows = await searchPatientsStaff(q, { practiceId, activeOnly: true });
        if (patientSeq.current !== id) return;
        setPatientResults(
          rows
            .filter((r) => r && typeof r === 'object')
            .slice(0, 8)
            .map((r) => {
              const row = r as Record<string, unknown>;
              const idRaw = row.id ?? row.patientId;
              return {
                id: Number(idRaw),
                label: patientSearchLabel(row),
              };
            })
            .filter((x) => Number.isFinite(x.id) && x.id > 0)
        );
        setPatientOpen(true);
      } catch {
        if (patientSeq.current === id) setPatientResults([]);
      } finally {
        if (patientSeq.current === id) setPatientSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [patientQuery, practiceId, selectedPatient]);

  const loadAppointments = useCallback(
    async (patientId: number, preferredAppointmentId?: number) => {
      setAppointmentsLoading(true);
      setError(null);
      setAppointments([]);
      setSelectedAppointmentId('');
      try {
        const rows = await fetchPatientAppointmentsStaff(patientId, { practiceId });
        const sorted = [...rows].sort(
          (a, b) =>
            DateTime.fromISO(b.appointmentStart).toMillis() -
            DateTime.fromISO(a.appointmentStart).toMillis()
        );
        let list = sorted.slice(0, 50);
        if (
          preferredAppointmentId != null &&
          !list.some((a) => a.id === preferredAppointmentId)
        ) {
          try {
            const appt = await fetchAppointmentById(preferredAppointmentId, { practiceId });
            if (appt) list = [appt, ...list].slice(0, 50);
          } catch {
            /* ignore */
          }
        }
        setAppointments(list);
        const preferred =
          preferredAppointmentId != null && list.some((a) => a.id === preferredAppointmentId)
            ? String(preferredAppointmentId)
            : list.length === 1 && list[0]?.id != null
              ? String(list[0].id)
              : '';
        if (preferred) setSelectedAppointmentId(preferred);
      } catch (e: unknown) {
        setError(errMsg(e));
      } finally {
        setAppointmentsLoading(false);
      }
    },
    [practiceId]
  );

  useEffect(() => {
    if (!prefill?.patientId || prefill.patientId <= 0) return;
    let cancelled = false;
    void (async () => {
      let label = prefill.patientLabel?.trim() || '';
      if (!label) {
        try {
          const data = await fetchPatientByIdStaff(prefill.patientId);
          if (data && typeof data === 'object') {
            label = patientSearchLabel(data as Record<string, unknown>);
          }
        } catch {
          /* ignore */
        }
      }
      if (!label) label = `Patient #${prefill.patientId}`;
      if (cancelled) return;
      const pick = { id: prefill.patientId, label };
      setSelectedPatient(pick);
      setPatientQuery(label);
      await loadAppointments(
        prefill.patientId,
        prefill.appointmentId > 0 ? prefill.appointmentId : undefined
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [prefill, loadAppointments]);

  const pickPatient = (pick: PatientPick) => {
    setSelectedPatient(pick);
    setPatientQuery(pick.label);
    setPatientOpen(false);
    void loadAppointments(pick.id);
  };

  const submit = async () => {
    if (!selectedPatient) {
      setError('Select a patient.');
      return;
    }
    if (!selectedAppointmentId) {
      setError('Select a source visit or choose No associated visit.');
      return;
    }
    const noAssociatedVisit = selectedAppointmentId === NO_ASSOCIATED_VISIT;
    if (!noAssociatedVisit && !selectedAppointment) {
      setError('Select the source visit to forward book from.');
      return;
    }
    const amount = Number(forwardAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !forwardUnit) {
      setError('Select how far out to forward book (number and days, weeks, or months).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let clientId = NaN;
      if (noAssociatedVisit) {
        try {
          const patientData = await fetchPatientByIdStaff(selectedPatient.id);
          const owners = clientsForPatientSearchRow(patientData as PatientSearchRow);
          const ownerId = owners[0]?.id;
          if (ownerId != null) clientId = Number(ownerId);
        } catch {
          /* ignore */
        }
        if (!Number.isFinite(clientId)) {
          setError('Could not resolve the client for this patient.');
          return;
        }
        const providerId = Number(forwardBookingProviderId);
        const payload = buildCreateForwardBookingPayloadFromPatient(
          selectedPatient.id,
          clientId,
          { amount, unit: forwardUnit },
          practiceId,
          {
            bookingNotes: bookingNotes.trim() || null,
            ...(Number.isFinite(providerId) && providerId > 0
              ? { primaryProviderId: providerId }
              : {}),
          }
        );
        if (!payload) {
          setError('Could not create forward booking for this patient.');
          return;
        }
        const created = await createForwardBooking({
          ...payload,
          createdVia: 'manual',
        });
        onCreated(created);
        onClose();
        return;
      }

      const fullAppt =
        (await fetchAppointmentById(selectedAppointment!.id, { practiceId })) ?? selectedAppointment!;
      const apptForPayload: Appointment = { ...selectedAppointment!, ...fullAppt };

      clientId = Number(clientIdFromAppointment(apptForPayload));
      if (!Number.isFinite(clientId)) {
        try {
          const patientData = await fetchPatientByIdStaff(selectedPatient.id);
          const owners = clientsForPatientSearchRow(patientData as PatientSearchRow);
          const ownerId = owners[0]?.id;
          if (ownerId != null) clientId = Number(ownerId);
        } catch {
          /* ignore */
        }
      }

      const providerId = Number(forwardBookingProviderId);
      const payload = buildCreateForwardBookingPayloadFromAppointment(
        apptForPayload,
        { amount, unit: forwardUnit },
        practiceId,
        {
          bookingNotes: bookingNotes.trim() || null,
          appointmentTypes,
          patientId: selectedPatient.id,
          clientId: Number.isFinite(clientId) ? clientId : undefined,
          ...(Number.isFinite(providerId) && providerId > 0
            ? { primaryProviderId: providerId }
            : {}),
        }
      );
      if (!payload) {
        setError('This visit cannot create a forward booking (needs client and patient).');
        return;
      }
      const created = await createForwardBooking({
        ...payload,
        createdVia: 'end_visit',
      });
      onCreated(created);
      onClose();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="scheduler-modal scheduler-modal--edit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-forward-booking-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Forward booking</p>
            <h2 id="create-forward-booking-title">Add forward booking</h2>
            <p className="scheduler-modal-subtitle">
              Choose a source visit (or none) and how far out to schedule the follow-up.
            </p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          {error ? <p className="scheduler-edit-error">{error}</p> : null}

          <label className="scheduler-edit-field" style={{ display: 'block' }}>
            <span>Patient *</span>
            <div ref={patientWrapRef} style={{ position: 'relative' }}>
              <input
                type="search"
                className="settings-input"
                value={patientQuery}
                onChange={(e) => {
                  setPatientQuery(e.target.value);
                  setSelectedPatient(null);
                  setAppointments([]);
                  setSelectedAppointmentId('');
                }}
                disabled={busy}
                autoComplete="off"
                placeholder="Enter patient"
                style={{ width: '100%' }}
              />
              {patientSearching ? (
                <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  Searching…
                </p>
              ) : null}
              {patientOpen && patientResults.length > 0 ? (
                <ul
                  className="scheduler-book-dropdown"
                  style={{ position: 'absolute', left: 0, right: 0, zIndex: 20, marginTop: 4 }}
                >
                  {patientResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="scheduler-book-dd-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickPatient(p);
                        }}
                      >
                        {p.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </label>

          <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 12 }}>
            <span>Source visit *</span>
            {appointmentsLoading ? (
              <p className="settings-muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                Loading visits…
              </p>
            ) : !selectedPatient ? (
              <p className="settings-muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
                Select a patient to load their visits.
              </p>
            ) : (
              <select
                className="settings-input"
                value={selectedAppointmentId}
                onChange={(e) => setSelectedAppointmentId(e.target.value)}
                disabled={busy}
                style={{ width: '100%' }}
              >
                <option value="">Select…</option>
                <option value={NO_ASSOCIATED_VISIT}>No associated visit</option>
                {appointments.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {formatSourceApptOption(a, practiceTz)}
                  </option>
                ))}
              </select>
            )}
            {selectedPatient && !appointmentsLoading && appointments.length === 0 ? (
              <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                No visits on file for this patient — choose No associated visit above.
              </p>
            ) : null}
          </label>

          <div className="scheduler-edit-two-col" style={{ marginTop: 12 }}>
            <label className="scheduler-edit-field">
              <span>Forward book *</span>
              <select
                value={forwardAmount}
                onChange={(e) => setForwardAmount(e.target.value)}
                disabled={busy}
              >
                <option value="">Select…</option>
                {FORWARD_BOOKING_AMOUNT_OPTIONS.map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="scheduler-edit-field">
              <span>Unit *</span>
              <select
                value={forwardUnit}
                onChange={(e) => setForwardUnit(e.target.value as ForwardBookingIntervalUnit | '')}
                disabled={busy}
              >
                <option value="">Select…</option>
                {FORWARD_BOOKING_UNIT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 10 }}>
            <span>Forward booking with</span>
            <select
              className="settings-input"
              value={forwardBookingProviderId}
              onChange={(e) => setForwardBookingProviderId(e.target.value)}
              disabled={busy || providersLoading}
              aria-label="Forward booking provider"
              style={{ width: '100%' }}
            >
              <option value="">Select provider…</option>
              {providers.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {providerSelectLabel(p)}
                </option>
              ))}
            </select>
          </label>

          <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 10 }}>
            <span>Forward booking note</span>
            <p className="settings-muted" style={{ fontSize: 13, margin: '4px 0 8px', fontWeight: 400 }}>
              Optional — shown on the forward booking list and prefilled when booking the follow-up visit.
            </p>
            <textarea
              className="settings-input"
              rows={2}
              value={bookingNotes}
              onChange={(e) => setBookingNotes(e.target.value)}
              disabled={busy}
              placeholder="e.g. Prefers AM slots, same provider"
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
            />
          </label>
        </div>

        <div className="scheduler-edit-footer">
          <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Add to list'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
