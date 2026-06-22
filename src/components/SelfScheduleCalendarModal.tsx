// src/components/SelfScheduleCalendarModal.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import {
  formatClientArrivalWindowMessage,
  resolveClientArrivalWindowForScheduledStart,
  type AppointmentTypeWindowSource,
} from '../utils/appointmentArrivalWindow';
import { DEFAULT_PRACTICE_TIMEZONE } from '../utils/practiceTimezone';
import { appointmentTypeForRoutingStatsKey } from '../utils/routingCalculateTimeType';
import {
  appointmentTypeNameForRoutingStats,
  estimateRoutingServiceMinutesForSelection,
  type RoutingServiceMinutesTypeSource,
} from '../utils/routingServiceMinutes';
import type { AppointmentType } from '../api/appointmentSettings';

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
  /** Number of pets in this visit — used to compute doctor-specific service minutes */
  numPets: number;
  /** Appointment types for routing duration lookup (same source as Routing workspace) */
  appointmentTypes?: AppointmentType[];
  onConfirm: (slot: SelfScheduledSlot) => void;
  onClose: () => void;
  /**
   * Called when the user taps "None of these work" — lets the parent close the
   * modal and direct attention to the scheduling-preferences field. Falls back
   * to onClose when not provided.
   */
  onRequestPreferences?: () => void;
  /** Whether this is a new (unauthenticated) client request */
  isNewClient?: boolean;
  /** New patient appointment request — filters slots to doctor workdays accepting new patients */
  isNewPatientRequest?: boolean;
  /** Raw veterinarian rows (with weeklySchedules) for new-patient day filtering */
  rawVeterinarians?: VeterinarianWithAppointmentTypes[];
  /** Appointment type id — required for online booking availability validation */
  appointmentTypeId?: number;
  /** Appointment type used to compute the client arrival window for a selected slot */
  appointmentType?: AppointmentTypeWindowSource;
  /** Practice timezone for window display (defaults to America/New_York) */
  practiceTz?: string;
  /** Pre-select doctor from the appointment form (database employee id) */
  initialDoctorId?: string | number;
  /**
   * Patient's chart primary provider — used for default selection and doctor-row ordering
   * even when they are request-only (not online-bookable).
   */
  preferredDoctorId?: string | number;
  /**
   * Pre-loaded doctor list from the form (avoids a second API call).
   * When provided the modal skips its own fetchPublicVeterinarians call.
   * Each entry needs at least { id, name }; imageUrl / employeeId are optional.
   */
  preloadedDoctors?: PublicProvider[];
  /**
   * In-zone doctors who are NOT available for online booking for this visit type.
   * Shown in the doctor row (greyed, with a badge) so clients can still request them.
   */
  requestOnlyDoctors?: PublicProvider[];
  /**
   * Called when the client requests a doctor who can't be booked online.
   * The parent records the doctor preference + preferred times and submits a manual request.
   */
  onRequestDoctor?: (args: {
    doctorId: string | number;
    doctorName: string;
    preferredTimes: string;
  }) => void;
  /** Shown when the picked slot was taken during submit — availability will refresh */
  slotPickerError?: string | null;
}

// ─── Colour tokens ────────────────────────────────────────────────────────────
const teal = '#0d9488';
const tealLight = '#ccfbf1';
const tealDark = '#0f766e';
const amber = '#d97706';
const amberLight = '#fef3c7';
const amberDark = '#92400e';
const grey50 = '#f9fafb';
const grey100 = '#f3f4f6';
const grey200 = '#e5e7eb';
const grey400 = '#9ca3af';
const grey700 = '#374151';
const grey800 = '#1f2937';
const white = '#ffffff';

function resolveSlotArrivalWindow(
  slot: MonthAvailabilityCandidate,
  appointmentType: AppointmentTypeWindowSource | undefined,
  practiceTz: string,
  serviceMinutes: number,
) {
  if (slot.windowStartIso && slot.windowEndIso) {
    const windowDisplay = formatClientArrivalWindowMessage(
      slot.windowStartIso,
      slot.windowEndIso,
      practiceTz,
    );
    if (windowDisplay) {
      return {
        windowStartIso: slot.windowStartIso,
        windowEndIso: slot.windowEndIso,
        windowDisplay,
      };
    }
  }

  const appointmentEndIso = DateTime.fromISO(slot.suggestedStartIso)
    .plus({ minutes: serviceMinutes })
    .toISO();

  return resolveClientArrivalWindowForScheduledStart(
    slot.suggestedStartIso,
    appointmentType,
    practiceTz,
    appointmentEndIso ? { appointmentEndIso } : undefined,
  );
}
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

function doctorBioFromRaw(
  doctorId: string | number,
  rawVeterinarians?: VeterinarianWithAppointmentTypes[],
): string | null {
  if (!rawVeterinarians?.length) return null;
  const raw = findVeterinarianById(rawVeterinarians, doctorId);
  const bio = raw && 'bio' in raw ? (raw as { bio?: unknown }).bio : undefined;
  return typeof bio === 'string' && bio.trim() ? bio.trim() : null;
}

// ─── Doctor headshot ──────────────────────────────────────────────────────────
function DoctorAvatar({
  doctor,
  selected,
  requestOnly = false,
  onClick,
  bioOpen = false,
  onBioToggle,
}: {
  doctor: PublicProvider;
  selected: boolean;
  requestOnly?: boolean;
  onClick: () => void;
  bioOpen?: boolean;
  onBioToggle?: () => void;
}) {
  // Prefer the stored imageUrl (already a full URL), then fall back to the
  // dynamic endpoint (requires the DB integer id), then the inline SVG fallback.
  const imgSrc = doctor.imageUrl?.trim()
    || (doctor.employeeId != null ? `${apiBaseUrl}/employees/${doctor.employeeId}/image` : null)
    || FALLBACK_AVATAR;

  const [failed, setFailed] = useState(false);
  const src = failed ? FALLBACK_AVATAR : imgSrc;

  const displayLabel = (() => {
    const stripped = doctor.name.replace(/^Dr\.?\s*/i, '').trim();
    return stripped ? `Dr. ${stripped}` : doctor.name;
  })();
  const borderColor = selected ? teal : grey200;
  const hasBio = Boolean(doctor.bio?.trim());

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          padding: '10px 12px',
          border: `2px solid ${selected ? (requestOnly ? amber : teal) : grey200}`,
          borderRadius: 12,
          background: selected ? (requestOnly ? amberLight : tealLight) : white,
          cursor: 'pointer',
          transition: 'all 0.15s',
          outline: 'none',
          minWidth: 88,
          maxWidth: 120,
        }}
      >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          overflow: 'hidden',
          border: `3px solid ${selected ? (requestOnly ? amber : teal) : borderColor}`,
          flexShrink: 0,
          backgroundColor: grey100,
        }}
      >
        <img
          src={src}
          alt={doctor.name}
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: requestOnly ? 'grayscale(0.85)' : undefined,
            opacity: requestOnly ? 0.75 : 1,
          }}
        />
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: selected ? 700 : 500,
          color: selected ? (requestOnly ? amberDark : tealDark) : grey700,
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: 108,
          wordBreak: 'break-word',
        }}
      >
        {displayLabel}
      </span>
      {requestOnly && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: amberDark,
            textAlign: 'center',
            lineHeight: 1.15,
            maxWidth: 108,
          }}
        >
          Online Booking Not Yet Available
        </span>
      )}
      </button>
      {hasBio && onBioToggle && (
        <>
          <button
            type="button"
            aria-label={`About ${displayLabel}`}
            aria-expanded={bioOpen}
            title="About this doctor"
            data-doctor-bio-trigger
            onClick={(e) => {
              e.stopPropagation();
              onBioToggle();
            }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: `1px solid ${grey200}`,
              background: white,
              fontSize: 11,
              fontWeight: 700,
              fontStyle: 'italic',
              fontFamily: 'Georgia, "Times New Roman", serif',
              color: grey700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              padding: 0,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            i
          </button>
        </>
      )}
    </div>
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
  numPets,
  appointmentTypes,
  onConfirm,
  onClose,
  onRequestPreferences,
  isNewClient = false,
  isNewPatientRequest = false,
  rawVeterinarians,
  appointmentTypeId,
  appointmentType,
  practiceTz = DEFAULT_PRACTICE_TIMEZONE,
  initialDoctorId,
  preferredDoctorId,
  preloadedDoctors,
  requestOnlyDoctors,
  onRequestDoctor,
  slotPickerError,
}: Props) {
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= 600 : false,
  );
  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth <= 600);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const [doctors, setDoctors] = useState<PublicProvider[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  // Doctors in-zone but not online-bookable for this visit type (request-only).
  const requestDoctors = useMemo(() => requestOnlyDoctors ?? [], [requestOnlyDoctors]);
  // Preferred days/times the client types when requesting a non-bookable doctor.
  const [requestPreferredTimes, setRequestPreferredTimes] = useState('');

  const [selectedDoctorId, setSelectedDoctorId] = useState<string | number | null>(null);
  const [bioPopoverDoctorId, setBioPopoverDoctorId] = useState<string | number | null>(null);

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

  const routingTypeKey = appointmentTypeNameForRoutingStats(appointmentType as RoutingServiceMinutesTypeSource);

  const resolveRoutingAppointmentType = useCallback(
    (key: string) => {
      if (appointmentTypes && appointmentTypes.length > 0) {
        return appointmentTypeForRoutingStatsKey(key, appointmentTypes);
      }
      const single = appointmentType as RoutingServiceMinutesTypeSource | undefined;
      if (!single?.name) return undefined;
      const name = String(single.name).trim();
      const pretty = String(single.prettyName ?? '').trim();
      if (key === name || key === pretty) return single;
      return undefined;
    },
    [appointmentTypes, appointmentType],
  );

  // Public/client booking cannot call staff-only /appointments/doctor/month; use type defaults.
  const serviceMinutes = useMemo(
    () =>
      estimateRoutingServiceMinutesForSelection(
        routingTypeKey,
        numPets,
        [],
        resolveRoutingAppointmentType,
      ),
    [routingTypeKey, numPets, resolveRoutingAppointmentType],
  );

  // Doctor to prioritize for ordering + default selection (primary provider).
  const prioritizedDoctorId = preferredDoctorId ?? initialDoctorId;

  // ── 1. Load doctors ──────────────────────────────────────────────────────
  useEffect(() => {
    // Use pre-loaded list when provided (avoids a redundant API call).
    if (
      (preloadedDoctors && preloadedDoctors.length > 0) ||
      requestDoctors.length > 0
    ) {
      setDoctors(preloadedDoctors ?? []);
      const matchesPreferred = (d: PublicProvider) =>
        prioritizedDoctorId != null && String(d.id) === String(prioritizedDoctorId);
      const initial =
        requestDoctors.find(matchesPreferred)?.id ??
        (preloadedDoctors ?? []).find(matchesPreferred)?.id ??
        prioritizedDoctorId ??
        requestDoctors[0]?.id ??
        preloadedDoctors?.[0]?.id ??
        null;
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
            bio: p.bio ?? doctorBioFromRaw(p.id, rawVeterinarians),
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
  }, [practiceId, address, lat, lon, isNewClient, preloadedDoctors, requestDoctors, prioritizedDoctorId, initialDoctorId, rawVeterinarians]);

  // Keep selection in sync when the preferred doctor resolves after providers load.
  useEffect(() => {
    if (prioritizedDoctorId == null) return;
    const inRequest = requestDoctors.some(
      (d) => String(d.id) === String(prioritizedDoctorId),
    );
    const inBookable = doctors.some((d) => String(d.id) === String(prioritizedDoctorId));
    if (inRequest || inBookable) {
      setSelectedDoctorId(prioritizedDoctorId);
    }
  }, [prioritizedDoctorId, requestDoctors, doctors]);

  // ── 2. Load month availability when doctor or month changes ──────────────
  const loadMonthAvailability = useCallback(async (doctorId: string | number, month: DateTime) => {
    const key = ++monthFetchKey.current;
    setLoadingMonth(true);
    setAvailabilityError(null);
    setSelectedDay(null);
    setDayCandidates([]);
    setSelectedSlotIso(null);

    try {
      const today = DateTime.now().startOf('day');
      const monthStart = month.startOf('month');
      const rangeStart = today > monthStart ? today : monthStart;
      const startDate = rangeStart.toISODate() as string;
      const monthEnd = month.endOf('month');
      const numDays = Math.max(1, Math.ceil(monthEnd.diff(rangeStart, 'days').days) + 1);

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
  }, [practiceId, address, lat, lon, serviceMinutes, appointmentTypeId, isNewPatientRequest, rawVeterinarians, numPets]);

  useEffect(() => {
    if (selectedDoctorId == null) return;
    // Skip availability lookups for request-only doctors (no online booking).
    const isBookable = doctors.some((d) => String(d.id) === String(selectedDoctorId));
    if (!isBookable) return;
    loadMonthAvailability(selectedDoctorId, currentMonth);
  }, [selectedDoctorId, currentMonth, loadMonthAvailability, doctors]);

  // ── 3. Derive day slots ──────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDay) {
      setDayCandidates([]);
      setSelectedSlotIso(null);
      return;
    }
    const forDay = monthCandidates
      .filter((c) => c.date === selectedDay)
      .sort((a, b) => {
        const aMs = DateTime.fromISO(a.suggestedStartIso || a.iso).toMillis();
        const bMs = DateTime.fromISO(b.suggestedStartIso || b.iso).toMillis();
        return aMs - bMs;
      });
    setDayCandidates(forDay);
    setSelectedSlotIso(null);
  }, [selectedDay, monthCandidates]);

  const slotMatchesSelection = (c: MonthAvailabilityCandidate, selected: string) =>
    c.suggestedStartIso === selected || c.iso === selected;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleDoctorSelect = (id: string | number) => {
    setBioPopoverDoctorId(null);
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
    const window = resolveSlotArrivalWindow(slot, appointmentType, practiceTz, serviceMinutes);
    onConfirm({
      doctorId: selectedDoctorId,
      doctorName: doctor.name,
      appointmentStart: slot.suggestedStartIso,
      display: slot.display,
      serviceMinutes,
      windowStartIso: window?.windowStartIso,
      windowEndIso: window?.windowEndIso,
      windowDisplay: window?.windowDisplay,
    });
  };

  const selectedSlot =
    selectedSlotIso != null
      ? monthCandidates.find((c) => c.suggestedStartIso === selectedSlotIso) ??
        monthCandidates.find((c) => c.iso === selectedSlotIso)
      : null;
  const selectedSlotWindow = selectedSlot
    ? resolveSlotArrivalWindow(selectedSlot, appointmentType, practiceTz, serviceMinutes)
    : undefined;

  const availableDays = slotsToAvailableDays(monthCandidates);
  const selectedBookableDoctor = doctors.find((d) => String(d.id) === String(selectedDoctorId));
  const selectedRequestDoctor = requestDoctors.find(
    (d) => String(d.id) === String(selectedDoctorId),
  );
  const selectedDoctor = selectedBookableDoctor ?? selectedRequestDoctor;
  const isRequestOnlySelected = !selectedBookableDoctor && !!selectedRequestDoctor;
  const canConfirm = !!selectedSlotIso;

  const handleRequestDoctor = () => {
    if (!selectedDoctor) return;
    onRequestDoctor?.({
      doctorId: selectedDoctor.id,
      doctorName: selectedDoctor.name,
      preferredTimes: requestPreferredTimes.trim(),
    });
  };

  // Combined doctor row, primary/preferred provider first (bookable or request-only).
  const displayDoctors = useMemo(() => {
    const combined = [
      ...doctors.map((d) => ({ doctor: d, requestOnly: false })),
      ...requestDoctors.map((d) => ({ doctor: d, requestOnly: true })),
    ];
    if (prioritizedDoctorId != null) {
      combined.sort((a, b) => {
        const aFirst = String(a.doctor.id) === String(prioritizedDoctorId) ? 0 : 1;
        const bFirst = String(b.doctor.id) === String(prioritizedDoctorId) ? 0 : 1;
        return aFirst - bFirst;
      });
    }
    return combined;
  }, [doctors, requestDoctors, prioritizedDoctorId]);

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
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '20px 24px',
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

        <h2 style={{ fontSize: 20, fontWeight: 700, color: grey800, margin: '0 0 4px' }}>
          Pick a Date &amp; Time
        </h2>
        <p style={{ fontSize: 13, color: grey400, margin: '0 0 16px' }}>
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
        ) : doctors.length === 0 && requestDoctors.length === 0 ? (
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
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: grey700, marginBottom: 8 }}>
              Choose a doctor
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              {displayDoctors.map(({ doctor: doc, requestOnly }) => (
                <DoctorAvatar
                  key={doc.id}
                  doctor={doc}
                  requestOnly={requestOnly}
                  selected={String(doc.id) === String(selectedDoctorId)}
                  onClick={() => handleDoctorSelect(doc.id)}
                  bioOpen={String(doc.id) === String(bioPopoverDoctorId)}
                  onBioToggle={() =>
                    setBioPopoverDoctorId((cur) =>
                      String(cur) === String(doc.id) ? null : doc.id,
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Doctor bio (inline, toggled via the ⓘ on a card) ───────────── */}
        {!loadingDoctors && (() => {
          const bioDoctor = displayDoctors.find(
            (d) => String(d.doctor.id) === String(bioPopoverDoctorId),
          )?.doctor;
          if (!bioDoctor?.bio?.trim()) return null;
          const bioLabel = (() => {
            const stripped = bioDoctor.name.replace(/^Dr\.?\s*/i, '').trim();
            return stripped ? `Dr. ${stripped}` : bioDoctor.name;
          })();
          return (
            <div
              style={{
                marginBottom: 14,
                padding: '12px 14px',
                background: grey50,
                border: `1px solid ${grey200}`,
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: grey800 }}>
                  About {bioLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setBioPopoverDoctorId(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color: teal,
                  }}
                >
                  Close
                </button>
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: grey700,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {bioDoctor.bio}
              </div>
            </div>
          );
        })()}

        {/* ── Request-only doctor panel ─────────────────────────────────── */}
        {!loadingDoctors && isRequestOnlySelected && selectedDoctor && (
          <div style={{ marginBottom: 4 }}>
            <div
              style={{
                padding: '12px 14px',
                background: amberLight,
                border: `1px solid ${amber}`,
                borderRadius: 8,
                fontSize: 13,
                color: amberDark,
                lineHeight: 1.5,
                marginBottom: 14,
              }}
            >
              <strong>
                Dr. {selectedDoctor.name.replace(/^Dr\.?\s*/i, '').trim()}
              </strong>{' '}
              isn&apos;t available for online booking yet. Share your
              preferred days and times below and our team will reach out to schedule with you.
            </div>

            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: grey700,
                marginBottom: 6,
              }}
            >
              Your scheduling preferences
            </label>
            <textarea
              value={requestPreferredTimes}
              onChange={(e) => setRequestPreferredTimes(e.target.value)}
              rows={3}
              placeholder="e.g. Weekday mornings, or Tuesdays after 2pm"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `1px solid ${grey200}`,
                borderRadius: 8,
                fontSize: 14,
                fontFamily: 'inherit',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* ── Calendar ───────────────────────────────────────────────────── */}
        {!loadingDoctors && !isRequestOnlySelected && doctors.length > 0 && (
          <>
            {selectedDoctor && (
              <div
                style={{
                  fontSize: 12,
                  color: grey700,
                  marginBottom: 10,
                  padding: '7px 12px',
                  background: tealLight,
                  borderRadius: 8,
                  border: `1px solid ${teal}`,
                  lineHeight: 1.4,
                }}
              >
                Showing availability for{' '}
                <strong>
                  Dr. {selectedDoctor.name.replace(/^Dr\.?\s*/i, '').trim()}
                </strong>
                .
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

            {/* Instruction: how to read the calendar + that days are clickable */}
            {!loadingMonth && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  marginBottom: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  color: grey700,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: tealLight,
                    border: `1px solid ${teal}`,
                  }}
                />
                Tap a highlighted date to see available times
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
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: grey700, marginBottom: 8 }}>
              Available times on{' '}
              <span style={{ color: tealDark }}>
                {DateTime.fromISO(selectedDay).toFormat('cccc, LLLL d')}
              </span>
            </div>

            {dayCandidates.length === 0 && !loadingMonth ? (
              <div
                style={{
                  padding: '10px 12px',
                  background: grey50,
                  border: `1px solid ${grey200}`,
                  borderRadius: 8,
                  fontSize: 13,
                  color: grey700,
                  lineHeight: 1.5,
                }}
              >
                No pre-approved times are showing for this day, but there may still be
                availability. Submit your request and a Client Liaison will reach out to
                confirm a time with you.
              </div>
            ) : (
              <>
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
              {!loadingDoctors && doctors.length > 0 && (
                <>
                  {selectedSlotWindow?.windowDisplay && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        background: tealLight,
                        border: `1px solid ${teal}`,
                        borderRadius: 8,
                        fontSize: 13,
                        color: tealDark,
                        lineHeight: 1.5,
                      }}
                    >
                      {selectedSlotWindow.windowDisplay}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: selectedSlotWindow?.windowDisplay ? 8 : 10,
                      padding: '10px 12px',
                      background: tealLight,
                      border: '1px solid #6ee7b7',
                      borderRadius: 8,
                      fontSize: 12,
                      color: tealDark,
                      lineHeight: 1.45,
                    }}
                  >
                    <strong>These times are matched to your address.</strong> Don&apos;t see one that
                    works? Tap &lsquo;None of these work&rsquo; below, share your scheduling
                    preferences on the form, and our team will reach out with more options.
                  </div>
                </>
              )}
              </>
            )}
          </div>
        )}

        {/* ── Confirm ────────────────────────────────────────────────────── */}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            flexDirection: isNarrow ? 'column-reverse' : 'row',
            gap: 12,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onRequestPreferences ?? onClose}
            style={{
              padding: isNarrow ? '14px 20px' : '10px 20px',
              width: isNarrow ? '100%' : undefined,
              borderRadius: 8,
              border: `1px solid ${grey200}`,
              background: white,
              color: grey700,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            None of these work
          </button>
          {isRequestOnlySelected ? (
            <button
              type="button"
              onClick={handleRequestDoctor}
              style={{
                padding: isNarrow ? '14px 24px' : '10px 24px',
                width: isNarrow ? '100%' : undefined,
                borderRadius: 8,
                border: 'none',
                background: amber,
                color: white,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              Request {selectedDoctor ? `Dr. ${selectedDoctor.name.replace(/^Dr\.?\s*/i, '').split(' ')[0]}` : 'This Doctor'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              style={{
                padding: isNarrow ? '14px 24px' : '10px 24px',
                width: isNarrow ? '100%' : undefined,
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
          )}
        </div>
      </div>
    </div>
  );
}
