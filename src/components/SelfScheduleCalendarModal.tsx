// src/components/SelfScheduleCalendarModal.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DateTime } from 'luxon';
import { apiBaseUrl } from '../api/http';
import {
  fetchPublicVeterinarians,
  fetchPublicMonthAvailability,
  type PublicProvider,
  type MonthAvailabilityCandidate,
  type SelfScheduledSlot,
} from '../api/publicAppointments';
import { fetchVeterinarians } from '../api/employee';
import {
  findVeterinarianById,
  isDoctorAcceptingNewPatientsOnSlotDate,
  isOnlineBookingUnavailableError,
  ONLINE_BOOKING_UNAVAILABLE_MESSAGE,
  type VeterinarianWithAppointmentTypes,
} from '../utils/onlineBooking';

// ─── Fallback avatar ─────────────────────────────────────────────────────────
const FALLBACK_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='32' fill='%23e5e7eb'/%3E%3Ccircle cx='32' cy='25' r='12' fill='%239ca3af'/%3E%3Cellipse cx='32' cy='56' rx='20' ry='14' fill='%239ca3af'/%3E%3C/svg%3E";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props {
  practiceId: number;
  /** Full address string for routing */
  address: string;
  /** Optional pre-geocoded coords */
  lat?: number;
  lon?: number;
  serviceMinutes: number;
  onConfirm: (slot: SelfScheduledSlot) => void;
  onClose: () => void;
  /** Whether this is a new (unauthenticated) client request */
  isNewClient?: boolean;
  /** New patient appointment request — filters slots to doctor workdays accepting new patients */
  isNewPatientRequest?: boolean;
  /** Raw veterinarian rows (with weeklySchedules) for new-patient day filtering */
  rawVeterinarians?: VeterinarianWithAppointmentTypes[];
  /** Appointment type id — required for online booking availability validation */
  appointmentTypeId?: number;
  /** Pre-select doctor from the appointment form (database employee id) */
  initialDoctorId?: string | number;
  /**
   * Pre-loaded doctor list from the form (avoids a second API call).
   * When provided the modal skips its own fetchPublicVeterinarians call.
   * Each entry needs at least { id, name }; imageUrl / employeeId are optional.
   */
  preloadedDoctors?: PublicProvider[];
  /** Shown when the picked slot was taken during submit — availability will refresh */
  slotPickerError?: string | null;
}

// ─── Colour tokens ────────────────────────────────────────────────────────────
const teal = '#0d9488';
const tealLight = '#ccfbf1';
const tealDark = '#0f766e';
const grey50 = '#f9fafb';
const grey100 = '#f3f4f6';
const grey200 = '#e5e7eb';
const grey400 = '#9ca3af';
const grey700 = '#374151';
const grey800 = '#1f2937';
const white = '#ffffff';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build all calendar cells for a month (leading/trailing blanks included). */
function buildCalendarCells(month: DateTime): Array<DateTime | null> {
  const firstDay = month.startOf('month');
  const daysInMonth = month.daysInMonth ?? 30;
  // Sunday = 0, Monday = 1 … Saturday = 6 (Luxon weekday: Mon=1…Sun=7)
  const leadingBlanks = firstDay.weekday % 7; // Sun=0, Mon=1, …
  const cells: Array<DateTime | null> = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(firstDay.set({ day: d }));
  return cells;
}

/** YYYY-MM-DD → Set<string> for O(1) lookup. */
function slotsToAvailableDays(candidates: MonthAvailabilityCandidate[]): Set<string> {
  const s = new Set<string>();
  candidates.forEach((c) => s.add(c.date));
  return s;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 20, color = teal }: { size?: number; color?: string }) {
  return (
    <>
      <div
        style={{
          width: size,
          height: size,
          border: `3px solid ${color}33`,
          borderTop: `3px solid ${color}`,
          borderRadius: '50%',
          animation: 'ssm-spin 0.8s linear infinite',
          flexShrink: 0,
        }}
      />
      <style>{`@keyframes ssm-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
    </>
  );
}

// ─── Doctor headshot ──────────────────────────────────────────────────────────
function DoctorAvatar({
  doctor,
  selected,
  onClick,
}: {
  doctor: PublicProvider;
  selected: boolean;
  onClick: () => void;
}) {
  // Prefer the stored imageUrl (already a full URL), then fall back to the
  // dynamic endpoint (requires the DB integer id), then the inline SVG fallback.
  const imgSrc = doctor.imageUrl?.trim()
    || (doctor.employeeId != null ? `${apiBaseUrl}/employees/${doctor.employeeId}/image` : null)
    || FALLBACK_AVATAR;

  const [failed, setFailed] = useState(false);
  const src = failed ? FALLBACK_AVATAR : imgSrc;

  const firstName = doctor.name.replace(/^Dr\.?\s*/i, '').split(' ')[0];

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '10px 12px',
        border: `2px solid ${selected ? teal : grey200}`,
        borderRadius: 12,
        background: selected ? tealLight : white,
        cursor: 'pointer',
        transition: 'all 0.15s',
        outline: 'none',
        minWidth: 72,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          overflow: 'hidden',
          border: `3px solid ${selected ? teal : grey200}`,
          flexShrink: 0,
          backgroundColor: grey100,
        }}
      >
        <img
          src={src}
          alt={doctor.name}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: selected ? 700 : 500,
          color: selected ? tealDark : grey700,
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: 72,
          wordBreak: 'break-word',
        }}
      >
        {firstName}
      </span>
    </button>
  );
}

// ─── Month calendar ───────────────────────────────────────────────────────────
const DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function MonthCalendar({
  month,
  availableDays,
  selectedDay,
  onDayClick,
  onPrev,
  onNext,
  loading,
}: {
  month: DateTime;
  availableDays: Set<string>;
  selectedDay: string | null;
  onDayClick: (date: string) => void;
  onPrev: () => void;
  onNext: () => void;
  loading: boolean;
}) {
  const today = DateTime.now().startOf('day');
  const cells = buildCalendarCells(month);

  return (
    <div style={{ userSelect: 'none' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button
          type="button"
          onClick={onPrev}
          style={{
            background: 'none',
            border: `1px solid ${grey200}`,
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            color: grey700,
          }}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span style={{ fontWeight: 700, fontSize: 15, color: grey800 }}>
          {month.toFormat('LLLL yyyy')}
        </span>
        <button
          type="button"
          onClick={onNext}
          style={{
            background: 'none',
            border: `1px solid ${grey200}`,
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            color: grey700,
          }}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Day-of-week labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DOW_LABELS.map((d) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: grey400, padding: '2px 0' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, position: 'relative' }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.75)',
              zIndex: 2,
              borderRadius: 8,
            }}
          >
            <Spinner size={28} />
          </div>
        )}
        {cells.map((day, idx) => {
          if (!day) return <div key={`blank-${idx}`} />;

          const dateStr = day.toISODate() as string;
          const isPast = day < today;
          const isAvailable = !isPast && availableDays.has(dateStr);
          const isSelected = dateStr === selectedDay;
          const isToday = dateStr === (today.toISODate() as string);

          let bg = white;
          let border = grey200;
          let color = grey700;
          let cursor = 'default';
          let opacity = 1;

          if (isPast) {
            opacity = 0.35;
          } else if (isSelected) {
            bg = teal;
            border = teal;
            color = white;
            cursor = 'pointer';
          } else if (isAvailable) {
            bg = tealLight;
            border = teal;
            color = tealDark;
            cursor = 'pointer';
          } else {
            opacity = 0.45;
          }

          return (
            <button
              key={dateStr}
              type="button"
              disabled={!isAvailable}
              onClick={() => isAvailable && onDayClick(dateStr)}
              style={{
                padding: '6px 2px',
                border: `1px solid ${border}`,
                borderRadius: 6,
                background: bg,
                color,
                fontSize: 13,
                fontWeight: isToday ? 700 : 400,
                cursor,
                opacity,
                textAlign: 'center',
                transition: 'all 0.12s',
                boxShadow: isSelected ? `0 0 0 2px ${teal}` : 'none',
              }}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Time slot pill ───────────────────────────────────────────────────────────
function TimeSlotPill({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 16px',
        borderRadius: 20,
        border: `2px solid ${selected ? teal : grey200}`,
        background: selected ? teal : white,
        color: selected ? white : grey700,
        fontSize: 13,
        fontWeight: selected ? 700 : 400,
        cursor: 'pointer',
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export function SelfScheduleCalendarModal({
  practiceId,
  address,
  lat,
  lon,
  serviceMinutes,
  onConfirm,
  onClose,
  isNewClient = false,
  isNewPatientRequest = false,
  rawVeterinarians,
  appointmentTypeId,
  initialDoctorId,
  preloadedDoctors,
  slotPickerError,
}: Props) {
  const [doctors, setDoctors] = useState<PublicProvider[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const [selectedDoctorId, setSelectedDoctorId] = useState<string | number | null>(null);
  const [currentMonth, setCurrentMonth] = useState<DateTime>(DateTime.now().startOf('month'));

  // candidates for the currently displayed month
  const [monthCandidates, setMonthCandidates] = useState<MonthAvailabilityCandidate[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(false);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // slots for the selected day (derived from monthCandidates)
  const [dayCandidates, setDayCandidates] = useState<MonthAvailabilityCandidate[]>([]);
  const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);

  // Track in-flight month fetch so we can cancel stale results
  const monthFetchKey = useRef(0);

  // ── 1. Load doctors ──────────────────────────────────────────────────────
  useEffect(() => {
    // Use pre-loaded list when provided (avoids a redundant API call).
    if (preloadedDoctors && preloadedDoctors.length > 0) {
      setDoctors(preloadedDoctors);
      const initial =
        initialDoctorId != null &&
        preloadedDoctors.some((d) => String(d.id) === String(initialDoctorId))
          ? initialDoctorId
          : preloadedDoctors[0].id;
      setSelectedDoctorId(initial);
      setLoadingDoctors(false);
      return;
    }

    let cancelled = false;
    setLoadingDoctors(true);
    setDoctorError(null);

    const load = async () => {
      try {
        let vets: PublicProvider[];

        if (!isNewClient) {
          // Existing/logged-in client — use the authenticated endpoint so zone
          // and scheduling rules match what the rest of the app sees.
          const result = await fetchVeterinarians(address || undefined, lat, lon);
          // Only show vets who are actually seeing clients in this zone.
          const inZone = result.providers.filter(
            p => p.seeingClientsInClientZone !== false,
          );
          // Fall back to all providers if none pass the zone filter (e.g. no
          // location context was available).
          const source = inZone.length > 0 ? inZone : result.providers;
          vets = source.map(p => ({
            id: p.id,
            name: p.name,
            email: p.email || undefined,
            imageUrl: p.imageUrl ?? null,
            employeeId: typeof p.id === 'number' ? p.id
              : p.pimsId != null ? Number(p.pimsId) : null,
          }));
        } else {
          // New client — use the public endpoint with new-patient filtering.
          vets = await fetchPublicVeterinarians(practiceId, address, lat, lon, true);
        }

        if (cancelled) return;
        setDoctors(vets);
        if (vets.length > 0) {
          const initial =
            initialDoctorId != null && vets.some((d) => String(d.id) === String(initialDoctorId))
              ? initialDoctorId
              : vets[0].id;
          setSelectedDoctorId(initial);
        }
      } catch {
        if (!cancelled) setDoctorError('Unable to load available doctors. Please try again.');
      } finally {
        if (!cancelled) setLoadingDoctors(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [practiceId, address, lat, lon, isNewClient, preloadedDoctors, initialDoctorId]);

  // ── 2. Load month availability when doctor or month changes ──────────────
  const loadMonthAvailability = useCallback(async (doctorId: string | number, month: DateTime) => {
    const key = ++monthFetchKey.current;
    setLoadingMonth(true);
    setAvailabilityError(null);
    setSelectedDay(null);
    setDayCandidates([]);
    setSelectedSlotIso(null);

    try {
      const startDate = month.toISODate() as string;
      // Fetch the entire month + a few days to cover partial weeks
      const numDays = (month.daysInMonth ?? 31) + 3;

      let candidates = await fetchPublicMonthAvailability({
        practiceId,
        startDate,
        numDays,
        serviceMinutes,
        address,
        ...(lat != null && lon != null ? { lat, lon, allowOtherDoctors: false } : {}),
        doctorId,
        ...(appointmentTypeId != null ? { appointmentTypeId } : {}),
      });

      if (isNewPatientRequest && rawVeterinarians && rawVeterinarians.length > 0) {
        const vet = findVeterinarianById(rawVeterinarians, doctorId);
        candidates = candidates.filter((c) => isDoctorAcceptingNewPatientsOnSlotDate(vet, c.iso));
      }

      if (key !== monthFetchKey.current) return;
      setMonthCandidates(candidates);
    } catch (err: unknown) {
      if (key !== monthFetchKey.current) return;
      setMonthCandidates([]);
      const ax = err as { response?: { status?: number; data?: { message?: string } } };
      const message = ax?.response?.data?.message;
      if (isOnlineBookingUnavailableError(ax?.response?.status, message)) {
        setAvailabilityError(ONLINE_BOOKING_UNAVAILABLE_MESSAGE);
      } else {
        setAvailabilityError('Unable to load availability. Please try again or submit your preferred times.');
      }
    } finally {
      if (key === monthFetchKey.current) setLoadingMonth(false);
    }
  }, [practiceId, address, lat, lon, serviceMinutes, appointmentTypeId, isNewPatientRequest, rawVeterinarians]);

  useEffect(() => {
    if (selectedDoctorId == null) return;
    loadMonthAvailability(selectedDoctorId, currentMonth);
  }, [selectedDoctorId, currentMonth, loadMonthAvailability]);

  // ── 3. Derive day slots ──────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDay) {
      setDayCandidates([]);
      setSelectedSlotIso(null);
      return;
    }
    const forDay = monthCandidates.filter((c) => c.date === selectedDay);
    setDayCandidates(forDay);
    setSelectedSlotIso(null);
  }, [selectedDay, monthCandidates]);

  const slotMatchesSelection = (c: MonthAvailabilityCandidate, selected: string) =>
    c.suggestedStartIso === selected || c.iso === selected;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleDoctorSelect = (id: string | number) => {
    setSelectedDoctorId(id);
  };

  const handlePrevMonth = () => {
    const prev = currentMonth.minus({ months: 1 });
    const today = DateTime.now().startOf('month');
    if (prev >= today) setCurrentMonth(prev);
  };

  const handleNextMonth = () => {
    setCurrentMonth(currentMonth.plus({ months: 1 }));
  };

  const handleConfirm = () => {
    if (!selectedSlotIso || !selectedDoctorId) return;
    const doctor = doctors.find((d) => String(d.id) === String(selectedDoctorId));
    if (!doctor) return;
    const slot =
      monthCandidates.find((c) => c.suggestedStartIso === selectedSlotIso) ??
      monthCandidates.find((c) => c.iso === selectedSlotIso);
    if (!slot) return;
    onConfirm({
      doctorId: selectedDoctorId,
      doctorName: doctor.name,
      appointmentStart: slot.suggestedStartIso,
      display: slot.display,
      serviceMinutes,
    });
  };

  const availableDays = slotsToAvailableDays(monthCandidates);
  const selectedDoctor = doctors.find((d) => String(d.id) === String(selectedDoctorId));
  const canConfirm = !!selectedSlotIso;

  const isPrevDisabled = currentMonth <= DateTime.now().startOf('month');

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Self-schedule an appointment"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'relative',
          background: white,
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '28px 28px 24px',
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 22,
            color: grey400,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <h2 style={{ fontSize: 20, fontWeight: 700, color: grey800, margin: '0 0 6px' }}>
          Pick a Date &amp; Time
        </h2>
        <p style={{ fontSize: 13, color: grey400, margin: '0 0 20px' }}>
          Select a doctor, then choose a day and time that works for you.
        </p>

        {/* ── Doctor row ─────────────────────────────────────────────────── */}
        {loadingDoctors ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <Spinner />
            <span style={{ fontSize: 13, color: grey400 }}>Loading available doctors…</span>
          </div>
        ) : doctorError ? (
          <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 20 }}>{doctorError}</div>
        ) : doctors.length === 0 ? (
          <div
            style={{
              padding: 16,
              background: grey50,
              borderRadius: 8,
              fontSize: 13,
              color: grey700,
              marginBottom: 20,
            }}
          >
            No doctors are currently available in your area. A Client Liaison will reach out after you submit your request.
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: grey700, marginBottom: 10 }}>
              Choose a doctor
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              {doctors.map((doc) => (
                <DoctorAvatar
                  key={doc.id}
                  doctor={doc}
                  selected={String(doc.id) === String(selectedDoctorId)}
                  onClick={() => handleDoctorSelect(doc.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Calendar ───────────────────────────────────────────────────── */}
        {!loadingDoctors && doctors.length > 0 && (
          <>
            {selectedDoctor && (
              <div
                style={{
                  fontSize: 13,
                  color: grey700,
                  marginBottom: 10,
                  padding: '8px 12px',
                  background: tealLight,
                  borderRadius: 8,
                  border: `1px solid ${teal}`,
                }}
              >
                Showing availability for{' '}
                <strong>{selectedDoctor.name}</strong> — times are based on drive time to your address.
              </div>
            )}

            {(slotPickerError || availabilityError) && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#991b1b',
                }}
              >
                {slotPickerError || availabilityError}
              </div>
            )}

            <MonthCalendar
              month={currentMonth}
              availableDays={availableDays}
              selectedDay={selectedDay}
              onDayClick={setSelectedDay}
              onPrev={handlePrevMonth}
              onNext={handleNextMonth}
              loading={loadingMonth}
            />

            {/* Disabled prev-month hint */}
            {isPrevDisabled && currentMonth <= DateTime.now().startOf('month') && (
              <div style={{ fontSize: 11, color: grey400, textAlign: 'center', marginTop: 6 }}>
                Showing from this month forward
              </div>
            )}
          </>
        )}

        {/* ── Time slots ─────────────────────────────────────────────────── */}
        {selectedDay && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: grey700, marginBottom: 10 }}>
              Available times on{' '}
              <span style={{ color: tealDark }}>
                {DateTime.fromISO(selectedDay).toFormat('cccc, LLLL d')}
              </span>
            </div>

            {dayCandidates.length === 0 && !loadingMonth ? (
              <div style={{ fontSize: 13, color: grey400, fontStyle: 'italic' }}>
                No times available on this day.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {dayCandidates.map((c) => (
                  <TimeSlotPill
                    key={c.suggestedStartIso}
                    label={DateTime.fromISO(c.iso).toFormat('h:mm a')}
                    selected={slotMatchesSelection(c, selectedSlotIso ?? '')}
                    onClick={() => setSelectedSlotIso(c.suggestedStartIso)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Confirm ────────────────────────────────────────────────────── */}
        <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: `1px solid ${grey200}`,
              background: white,
              color: grey700,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              background: canConfirm ? teal : grey200,
              color: canConfirm ? white : grey400,
              fontSize: 14,
              fontWeight: 700,
              cursor: canConfirm ? 'pointer' : 'not-allowed',
              transition: 'all 0.12s',
            }}
          >
            Confirm This Time
          </button>
        </div>

        {selectedSlotIso && selectedDoctor && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              background: tealLight,
              borderRadius: 8,
              border: `1px solid ${teal}`,
              fontSize: 13,
              color: tealDark,
              textAlign: 'center',
            }}
          >
            <strong>Selected:</strong>{' '}
            {DateTime.fromISO(selectedSlotIso).toFormat("cccc, LLLL d 'at' h:mm a")} with{' '}
            {selectedDoctor.name}
          </div>
        )}
      </div>
    </div>
  );
}
