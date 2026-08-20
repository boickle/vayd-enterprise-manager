// src/components/SelfScheduleCalendarModal.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DateTime } from 'luxon';
import { apiBaseUrl } from '../api/http';
import {
  fetchPublicVeterinarians,
  fetchPublicMonthAvailability,
  fetchRoutingServiceMinutes,
  type PublicProvider,
  type MonthAvailabilityCandidate,
  type SelfScheduledSlot,
  type RoutingVisitPetInput,
} from '../api/publicAppointments';
import { fetchVeterinarians } from '../api/employee';
import {
  findVeterinarianById,
  isDoctorAcceptingNewPatientsOnSlotDate,
  isOnlineBookingUnavailableError,
  isSupersededAvailabilityError,
  ONLINE_BOOKING_UNAVAILABLE_MESSAGE,
  type VeterinarianWithAppointmentTypes,
} from '../utils/onlineBooking';
import {
  resolveAvailabilitySlotArrivalWindow,
  type AppointmentTypeWindowSource,
} from '../utils/appointmentArrivalWindow';
import { DEFAULT_PRACTICE_TIMEZONE } from '../utils/practiceTimezone';
import { appointmentTypeForRoutingStatsKey } from '../utils/routingCalculateTimeType';
import {
  estimateRoutingServiceMinutesForVisit,
  type RoutingServiceMinutesTypeSource,
} from '../utils/routingServiceMinutes';
import {
  fetchAppointmentType,
  type AppointmentType,
} from '../api/appointmentSettings';

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
  /** Count of new-to-practice patients — adds tiered duration buffer to service minutes */
  newPatientCount?: number;
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
   * First online-bookable chart primary among selected pets — default calendar selection.
   */
  preferredDoctorId?: string | number;
  /**
   * Chart primary provider for the visit (bookable or request-only) — badge + leftmost card.
   */
  chartPrimaryProviderId?: string | number;
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
  /** Per-pet appointment types — server resolves doctor-specific duration. */
  visitPets?: RoutingVisitPetInput[];
  /** Selected existing pets (DB patients.id) — member elevated offer tier when any is a member. */
  patientIds?: number[];
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
  // Prefer API effective/arrival windows (depot-aware first-stop clamp). Type ±N
  // is only a fallback when the availability payload omits window fields.
  return resolveAvailabilitySlotArrivalWindow(
    slot,
    appointmentType,
    practiceTz,
    serviceMinutes,
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

function futureMonthCandidates(
  candidates: MonthAvailabilityCandidate[],
): MonthAvailabilityCandidate[] {
  const today = DateTime.now().startOf('day').toISODate() as string;
  return candidates.filter((c) => c.date >= today);
}

/** Only dates that belong on the calendar grid for this month. */
function candidatesInCalendarMonth(
  candidates: MonthAvailabilityCandidate[],
  month: DateTime,
): MonthAvailabilityCandidate[] {
  const monthKey = month.toFormat('yyyy-MM');
  return futureMonthCandidates(candidates).filter((c) => c.date.startsWith(monthKey));
}

function monthHasBookableCandidates(
  candidates: MonthAvailabilityCandidate[],
  month: DateTime,
): boolean {
  return candidatesInCalendarMonth(candidates, month).length > 0;
}

/** Backend cap on POST /public/appointments/availability `numDays`. */
const AVAILABILITY_MAX_DAYS = 45;
/** How many 45-day windows to walk when the first one has no bookable day. */
const MAX_AUTO_ADVANCE_WINDOWS = 4;

type MonthAvailabilityFetchArgs = {
  practiceId: number;
  address: string;
  lat?: number;
  lon?: number;
  serviceMinutes?: number;
  visitPets?: RoutingVisitPetInput[];
  patientIds?: number[];
  doctorId: string | number;
  appointmentTypeId?: number;
  isNewPatientRequest: boolean;
  rawVeterinarians?: VeterinarianWithAppointmentTypes[];
};

function doctorMonthCacheKey(doctorId: string | number, month: DateTime): string {
  return `${doctorId}|${month.toFormat('yyyy-MM')}`;
}

function storeCandidatesByMonth(
  cache: Map<string, MonthAvailabilityCandidate[]>,
  doctorId: string | number,
  candidates: MonthAvailabilityCandidate[],
  rangeStart: DateTime,
  rangeEnd: DateTime,
) {
  const byMonth = new Map<string, MonthAvailabilityCandidate[]>();
  for (const c of candidates) {
    const ym = c.date.slice(0, 7);
    const list = byMonth.get(ym) ?? [];
    list.push(c);
    byMonth.set(ym, list);
  }
  let cursor = rangeStart.startOf('month');
  const last = rangeEnd.startOf('month');
  while (cursor <= last) {
    const ym = cursor.toFormat('yyyy-MM');
    cache.set(`${doctorId}|${ym}`, byMonth.get(ym) ?? []);
    cursor = cursor.plus({ months: 1 });
  }
}

async function fetchAvailabilityRange(
  rangeStart: DateTime,
  rangeEnd: DateTime,
  args: MonthAvailabilityFetchArgs,
): Promise<MonthAvailabilityCandidate[]> {
  const startDate = rangeStart.toISODate() as string;
  const numDays = Math.max(
    1,
    Math.min(AVAILABILITY_MAX_DAYS, Math.ceil(rangeEnd.diff(rangeStart, 'days').days) + 1),
  );

  let candidates = await fetchPublicMonthAvailability({
    practiceId: args.practiceId,
    startDate,
    numDays,
    address: args.address,
    ...(args.visitPets?.length
      ? { visitPets: args.visitPets, doctorId: args.doctorId }
      : { serviceMinutes: args.serviceMinutes ?? 45, doctorId: args.doctorId }),
    ...(args.lat != null && args.lon != null
      ? { lat: args.lat, lon: args.lon, allowOtherDoctors: false }
      : {}),
    ...(args.appointmentTypeId != null ? { appointmentTypeId: args.appointmentTypeId } : {}),
    ...(args.patientIds?.length ? { patientIds: args.patientIds } : {}),
  });

  if (args.isNewPatientRequest && args.rawVeterinarians && args.rawVeterinarians.length > 0) {
    const vet = findVeterinarianById(args.rawVeterinarians, args.doctorId);
    candidates = candidates.filter((c) => isDoctorAcceptingNewPatientsOnSlotDate(vet, c.iso));
  }

  return candidates;
}

/** Default to chart primary when bookable; otherwise first online-bookable doctor. */
function pickDefaultDoctorId(
  bookableDoctors: PublicProvider[],
  requestOnlyDoctors: PublicProvider[],
  prioritizedDoctorId: string | number | null | undefined,
): string | number | null {
  if (bookableDoctors.length > 0) {
    if (prioritizedDoctorId != null) {
      const preferred = bookableDoctors.find(
        (d) => String(d.id) === String(prioritizedDoctorId),
      );
      if (preferred?.id != null) return preferred.id;
    }
    return bookableDoctors[0]?.id ?? null;
  }
  if (prioritizedDoctorId != null) {
    const preferred = requestOnlyDoctors.find(
      (d) => String(d.id) === String(prioritizedDoctorId),
    );
    if (preferred?.id != null) return preferred.id;
  }
  return requestOnlyDoctors[0]?.id ?? null;
}

function sortDoctorsWithPriority<T extends { doctor: PublicProvider }>(
  items: T[],
  prioritizedDoctorId: string | number | null | undefined,
): T[] {
  if (prioritizedDoctorId == null || items.length <= 1) return items;
  return [...items].sort((a, b) => {
    const aFirst = String(a.doctor.id) === String(prioritizedDoctorId) ? 0 : 1;
    const bFirst = String(b.doctor.id) === String(prioritizedDoctorId) ? 0 : 1;
    return aFirst - bFirst;
  });
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
  isPrimaryProvider = false,
  onClick,
  bioOpen = false,
  onBioToggle,
}: {
  doctor: PublicProvider;
  selected: boolean;
  requestOnly?: boolean;
  /** Pet's chart primary provider — shown when the client can choose among doctors. */
  isPrimaryProvider?: boolean;
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
  const borderColor = selected
    ? requestOnly
      ? amber
      : teal
    : isPrimaryProvider
      ? teal
      : grey200;
  const cardBackground = selected
    ? requestOnly
      ? amberLight
      : tealLight
    : isPrimaryProvider
      ? '#ecfdf5'
      : white;
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
          border: `2px solid ${borderColor}`,
          borderRadius: 12,
          background: cardBackground,
          cursor: 'pointer',
          transition: 'all 0.15s',
          outline: 'none',
          minWidth: 88,
          maxWidth: 120,
          boxShadow: isPrimaryProvider && !selected ? '0 0 0 1px rgba(13, 148, 136, 0.25)' : undefined,
        }}
      >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          overflow: 'hidden',
          border: `3px solid ${borderColor}`,
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
          fontWeight: selected || isPrimaryProvider ? 700 : 500,
          color: selected
            ? requestOnly
              ? amberDark
              : tealDark
            : isPrimaryProvider
              ? tealDark
              : grey700,
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: 108,
          wordBreak: 'break-word',
        }}
      >
        {displayLabel}
      </span>
      {isPrimaryProvider && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: tealDark,
            textAlign: 'center',
            lineHeight: 1.15,
            maxWidth: 108,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          Primary provider
        </span>
      )}
      {requestOnly ? (
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
      ) : (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: tealDark,
            textAlign: 'center',
            lineHeight: 1.15,
            maxWidth: 108,
          }}
        >
          Book Online
        </span>
      )}
      </button>
      {hasBio && onBioToggle && (
        <button
          type="button"
          aria-label={`Read bio for ${displayLabel}`}
          aria-expanded={bioOpen}
          title="Read doctor bio"
          data-doctor-bio-trigger
          onClick={(e) => {
            e.stopPropagation();
            onBioToggle();
          }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            padding: '2px 6px',
            borderRadius: 999,
            border: `1px solid ${bioOpen ? teal : grey200}`,
            background: bioOpen ? tealLight : white,
            fontSize: 10,
            fontWeight: 700,
            fontStyle: 'normal',
            fontFamily: 'inherit',
            color: bioOpen ? tealDark : grey700,
            cursor: 'pointer',
            lineHeight: 1.2,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          Bio
        </button>
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

// ─── Address-matched times notice ─────────────────────────────────────────────
function AddressMatchedTimesNotice() {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 12px',
        background: tealLight,
        border: '1px solid #6ee7b7',
        borderRadius: 8,
        fontSize: 12,
        color: tealDark,
        lineHeight: 1.45,
      }}
    >
      <strong>These times are matched to your address.</strong> Don&apos;t see one that works? Tap
      &lsquo;None of these work&rsquo; below, share your scheduling preferences on the form, and our
      team will reach out with more options.
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
  newPatientCount = 0,
  isNewPatientRequest = false,
  rawVeterinarians,
  appointmentTypeId,
  appointmentType,
  practiceTz = DEFAULT_PRACTICE_TIMEZONE,
  initialDoctorId,
  preferredDoctorId,
  chartPrimaryProviderId,
  preloadedDoctors,
  requestOnlyDoctors,
  onRequestDoctor,
  slotPickerError,
  visitPets,
  patientIds,
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

  const [hydratedAppointmentType, setHydratedAppointmentType] =
    useState<AppointmentType | null>(null);
  useEffect(() => {
    setHydratedAppointmentType(null);
    const id = Number(appointmentTypeId);
    if (isNewClient || !Number.isFinite(id) || id <= 0) return;

    let alive = true;
    void fetchAppointmentType(id)
      .then((type) => {
        if (alive) setHydratedAppointmentType(type);
      })
      .catch((error) => {
        console.warn(
          `[SelfSchedule] Could not hydrate appointment type ${id}; using list data`,
          error,
        );
      });
    return () => {
      alive = false;
    };
  }, [appointmentTypeId, isNewClient]);

  /** Resolve the booking type (with windows) by id — prop alone can miss windows via id mismatch. */
  const resolvedAppointmentType = useMemo((): AppointmentTypeWindowSource | undefined => {
    const fromList =
      appointmentTypeId != null
        ? appointmentTypes?.find((t) => Number(t.id) === Number(appointmentTypeId))
        : undefined;
    const candidate = hydratedAppointmentType ?? fromList ?? appointmentType;
    if (!candidate) return undefined;
    return {
      name: candidate.name,
      prettyName: candidate.prettyName,
      windowBeforeMinutes: candidate.windowBeforeMinutes,
      windowAfterMinutes: candidate.windowAfterMinutes,
    };
  }, [
    appointmentTypeId,
    appointmentTypes,
    appointmentType,
    hydratedAppointmentType,
  ]);

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
  /** Skip one availability reload when we programmatically change the displayed month. */
  const skipMonthEffectRef = useRef(false);
  /** User clicked prev/next — do not auto-advance to a later month. */
  const manualMonthNavRef = useRef(false);
  /** Per-doctor calendar-month slots from the last 45-day browse (avoids a second routing call). */
  const monthAvailabilityCacheRef = useRef(new Map<string, MonthAvailabilityCandidate[]>());
  /** Scroll the times list into view after the client picks a calendar day. */
  const timesSectionRef = useRef<HTMLDivElement>(null);

  const [soonestAvailabilityNote, setSoonestAvailabilityNote] = useState<string | null>(null);

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

  const resolveRoutingAppointmentTypeById = useCallback(
    (appointmentTypeId: number) =>
      appointmentTypes?.find((type) => Number(type.id) === Number(appointmentTypeId)),
    [appointmentTypes],
  );

  const fallbackServiceMinutes = useMemo(() => {
    const pets =
      visitPets ??
      (appointmentTypeId != null
        ? [{ appointmentTypeId, isNewPatient: newPatientCount > 0 }]
        : []);
    if (pets.length === 0) return 45;
    return estimateRoutingServiceMinutesForVisit(
      pets,
      [],
      (id) => resolveRoutingAppointmentTypeById(id),
      (key) => resolveRoutingAppointmentType(key),
      { newPatientCount, numPets },
    ).serviceMinutes;
  }, [
    visitPets,
    appointmentTypeId,
    newPatientCount,
    numPets,
    resolveRoutingAppointmentType,
    resolveRoutingAppointmentTypeById,
  ]);

  const [serviceMinutes, setServiceMinutes] = useState<number>(fallbackServiceMinutes);
  const [loadingServiceMinutes, setLoadingServiceMinutes] = useState(false);
  const serviceMinutesRef = useRef(serviceMinutes);
  serviceMinutesRef.current = serviceMinutes;

  useEffect(() => {
    if (selectedDoctorId == null || !visitPets?.length) {
      setServiceMinutes(fallbackServiceMinutes);
      return;
    }

    let cancelled = false;
    setLoadingServiceMinutes(true);
    void fetchRoutingServiceMinutes({
      practiceId,
      doctorId: selectedDoctorId,
      visitPets,
    })
      .then((result) => {
        if (!cancelled) setServiceMinutes(result.serviceMinutes);
      })
      .catch(() => {
        if (!cancelled) setServiceMinutes(fallbackServiceMinutes);
      })
      .finally(() => {
        if (!cancelled) setLoadingServiceMinutes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [practiceId, selectedDoctorId, visitPets, fallbackServiceMinutes]);

  // Doctor to prioritize for default calendar selection (first bookable chart primary).
  const prioritizedDoctorId = preferredDoctorId ?? initialDoctorId;
  const leadDoctorId = chartPrimaryProviderId ?? prioritizedDoctorId;

  // ── 1. Load doctors ──────────────────────────────────────────────────────
  useEffect(() => {
    // Use pre-loaded list when provided (avoids a redundant API call).
    if (
      (preloadedDoctors && preloadedDoctors.length > 0) ||
      requestDoctors.length > 0
    ) {
      setDoctors(preloadedDoctors ?? []);
      setSelectedDoctorId(
        pickDefaultDoctorId(preloadedDoctors ?? [], requestDoctors, prioritizedDoctorId),
      );
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
          setSelectedDoctorId(
            pickDefaultDoctorId(vets, [], prioritizedDoctorId),
          );
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

  // Prefer chart primary provider when they are online-bookable; never override
  // with a request-only doctor while bookable options exist.
  useEffect(() => {
    if (prioritizedDoctorId == null) return;
    const inBookable = doctors.some((d) => String(d.id) === String(prioritizedDoctorId));
    if (inBookable) {
      setSelectedDoctorId(prioritizedDoctorId);
      return;
    }
    if (doctors.length === 0) {
      const inRequest = requestDoctors.some(
        (d) => String(d.id) === String(prioritizedDoctorId),
      );
      if (inRequest) setSelectedDoctorId(prioritizedDoctorId);
    }
  }, [prioritizedDoctorId, requestDoctors, doctors]);

  // Address / visit identity — drop cached months when the search itself changed.
  const availabilitySearchKey = [
    practiceId,
    address,
    lat,
    lon,
    appointmentTypeId,
    isNewPatientRequest,
    (patientIds ?? []).join(','),
    (visitPets ?? []).map((p) => `${p.appointmentTypeId}:${p.isNewPatient ? 1 : 0}`).join(','),
  ].join('|');

  useEffect(() => {
    monthAvailabilityCacheRef.current.clear();
  }, [availabilitySearchKey]);

  // ── 2. Load month availability when doctor or month changes ──────────────
  const loadMonthAvailability = useCallback(
    async (
      doctorId: string | number,
      month: DateTime,
      opts?: { autoAdvance?: boolean },
    ) => {
      const key = ++monthFetchKey.current;
      const cache = monthAvailabilityCacheRef.current;
      const startMonth = month.startOf('month');

      const applyMonth = (
        scanMonth: DateTime,
        candidates: MonthAvailabilityCandidate[],
        noteAdvance: boolean,
      ) => {
        if (noteAdvance && candidates.length > 0 && !scanMonth.hasSame(startMonth, 'month')) {
          setSoonestAvailabilityNote(
            `Earliest open times are in ${scanMonth.toFormat('MMMM yyyy')}.`,
          );
        }
        if (!scanMonth.hasSame(month, 'month')) {
          skipMonthEffectRef.current = true;
          setCurrentMonth(scanMonth);
        }
        setMonthCandidates(candidates);
      };

      const cachedStart = cache.get(doctorMonthCacheKey(doctorId, startMonth));
      let resumeFrom: DateTime | null = null;
      if (cachedStart) {
        if (!opts?.autoAdvance || monthHasBookableCandidates(cachedStart, startMonth)) {
          applyMonth(startMonth, candidatesInCalendarMonth(cachedStart, startMonth), false);
          return;
        }
        for (let i = 1; i < 12; i++) {
          const later = startMonth.plus({ months: i });
          const cachedLater = cache.get(doctorMonthCacheKey(doctorId, later));
          if (!cachedLater) {
            resumeFrom = later;
            break;
          }
          if (monthHasBookableCandidates(cachedLater, later)) {
            applyMonth(later, candidatesInCalendarMonth(cachedLater, later), true);
            return;
          }
        }
      }

      setLoadingMonth(true);
      setAvailabilityError(null);
      setSelectedDay(null);
      setDayCandidates([]);
      setSelectedSlotIso(null);
      setSoonestAvailabilityNote(null);

      const fetchArgs: MonthAvailabilityFetchArgs = {
        practiceId,
        address,
        lat,
        lon,
        serviceMinutes: serviceMinutesRef.current,
        visitPets,
        patientIds,
        doctorId,
        appointmentTypeId,
        isNewPatientRequest,
        rawVeterinarians,
      };

      try {
        const today = DateTime.now().startOf('day');
        const resumeMonth = resumeFrom ?? startMonth;
        let windowStart = today > resumeMonth ? today : resumeMonth;
        let scanMonth = startMonth;
        let candidates: MonthAvailabilityCandidate[] = [];

        const windowCount = opts?.autoAdvance ? MAX_AUTO_ADVANCE_WINDOWS : 1;
        for (let attempt = 0; attempt < windowCount; attempt++) {
          const windowEnd = windowStart.plus({ days: AVAILABILITY_MAX_DAYS - 1 });
          const fetched = await fetchAvailabilityRange(windowStart, windowEnd, fetchArgs);
          if (key !== monthFetchKey.current) return;
          storeCandidatesByMonth(cache, doctorId, fetched, windowStart, windowEnd);

          if (!opts?.autoAdvance) {
            candidates = candidatesInCalendarMonth(fetched, startMonth);
            scanMonth = startMonth;
            break;
          }

          let found: DateTime | null = null;
          for (let i = 0; i < 12; i++) {
            const m = startMonth.plus({ months: i });
            if (m.startOf('day') > windowEnd) break;
            const monthSlots = cache.get(doctorMonthCacheKey(doctorId, m));
            if (monthSlots && monthHasBookableCandidates(monthSlots, m)) {
              found = m;
              candidates = candidatesInCalendarMonth(monthSlots, m);
              break;
            }
          }
          if (found) {
            scanMonth = found;
            break;
          }
          windowStart = windowEnd.plus({ days: 1 });
        }

        if (key !== monthFetchKey.current) return;
        applyMonth(scanMonth, candidates, Boolean(opts?.autoAdvance));
      } catch (err: unknown) {
        if (key !== monthFetchKey.current) return;
        const ax = err as { response?: { status?: number; data?: { message?: string } } };
        const message = ax?.response?.data?.message;
        // Newer browse replaced this one (or booking validation did) — leave UI loading/clear.
        if (isSupersededAvailabilityError(ax?.response?.status, message)) {
          return;
        }
        setMonthCandidates([]);
        if (isOnlineBookingUnavailableError(ax?.response?.status, message)) {
          setAvailabilityError(ONLINE_BOOKING_UNAVAILABLE_MESSAGE);
        } else {
          setAvailabilityError(
            'Unable to load availability. Please try again or submit your preferred times.',
          );
        }
      } finally {
        if (key === monthFetchKey.current) setLoadingMonth(false);
      }
    },
    [
      practiceId,
      address,
      lat,
      lon,
      visitPets,
      patientIds,
      appointmentTypeId,
      isNewPatientRequest,
      rawVeterinarians,
    ],
  );

  useEffect(() => {
    if (selectedDoctorId == null) return;
    // Server resolves duration from visitPets; waiting on the extra minutes call
    // just delayed the (much slower) month browse.
    if (loadingServiceMinutes && !(visitPets && visitPets.length > 0)) return;
    if (skipMonthEffectRef.current) {
      skipMonthEffectRef.current = false;
      return;
    }
    // Skip availability lookups for request-only doctors (no online booking).
    const isBookable = doctors.some((d) => String(d.id) === String(selectedDoctorId));
    if (!isBookable) return;
    const autoAdvance = !manualMonthNavRef.current;
    manualMonthNavRef.current = false;
    loadMonthAvailability(selectedDoctorId, currentMonth, { autoAdvance });
  }, [
    selectedDoctorId,
    currentMonth,
    loadMonthAvailability,
    doctors,
    loadingServiceMinutes,
    visitPets,
  ]);

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

  // After picking a day, scroll the times section into view (often below the fold on mobile).
  useEffect(() => {
    if (!selectedDay) return;
    const el = timesSectionRef.current;
    if (!el) return;
    const frame = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDay]);

  const slotMatchesSelection = (c: MonthAvailabilityCandidate, selected: string) =>
    c.suggestedStartIso === selected || c.iso === selected;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleDoctorSelect = (id: string | number) => {
    setBioPopoverDoctorId(null);
    setSelectedDoctorId(id);
    setAvailabilityError(null);
    setRequestPreferredTimes('');
    setSoonestAvailabilityNote(null);
    setSelectedDay(null);
    setDayCandidates([]);
    setSelectedSlotIso(null);
    // Keep the month the client is looking at. Resetting to "now" re-ran August
    // then auto-advanced back to September on every doctor tap.
    const thisMonth = DateTime.now().startOf('month');
    if (currentMonth < thisMonth) setCurrentMonth(thisMonth);
  };

  const handlePrevMonth = () => {
    manualMonthNavRef.current = true;
    setSoonestAvailabilityNote(null);
    const prev = currentMonth.minus({ months: 1 });
    const today = DateTime.now().startOf('month');
    if (prev >= today) setCurrentMonth(prev);
  };

  const handleNextMonth = () => {
    manualMonthNavRef.current = true;
    setSoonestAvailabilityNote(null);
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
    const window = resolveSlotArrivalWindow(slot, resolvedAppointmentType, practiceTz, serviceMinutes);
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
    ? resolveSlotArrivalWindow(selectedSlot, resolvedAppointmentType, practiceTz, serviceMinutes)
    : undefined;

  const availableDays = slotsToAvailableDays(monthCandidates);
  const selectedBookableDoctor = doctors.find((d) => String(d.id) === String(selectedDoctorId));
  const selectedRequestDoctor = requestDoctors.find(
    (d) => String(d.id) === String(selectedDoctorId),
  );
  const selectedDoctor = selectedBookableDoctor ?? selectedRequestDoctor;
  const isRequestOnlySelected = !selectedBookableDoctor && !!selectedRequestDoctor;
  const onlineBookingBlocked =
    availabilityError === ONLINE_BOOKING_UNAVAILABLE_MESSAGE;
  /** Doctor/type can't be booked online — collect preferred times instead of a calendar. */
  const showPreferencesPanel = isRequestOnlySelected || onlineBookingBlocked;
  const canConfirm = !!selectedSlotIso;

  const handleRequestDoctor = () => {
    if (!selectedDoctor) return;
    onRequestDoctor?.({
      doctorId: selectedDoctor.id,
      doctorName: selectedDoctor.name,
      preferredTimes: requestPreferredTimes.trim(),
    });
  };

  // Chart primary leftmost; bookable cards before request-only when no primary match.
  const displayDoctors = useMemo(() => {
    const bookable = doctors.map((d) => ({ doctor: d, requestOnly: false }));
    const requestOnly = requestDoctors.map((d) => ({ doctor: d, requestOnly: true }));
    const combined = [...bookable, ...requestOnly];
    return sortDoctorsWithPriority(combined, leadDoctorId);
  }, [doctors, requestDoctors, leadDoctorId]);

  const showPrimaryProviderBadge =
    chartPrimaryProviderId != null && displayDoctors.length > 1;

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
          {showPreferencesPanel
            ? 'Select a doctor, then share your preferred days and times below.'
            : 'Select a doctor, then choose a day and time that works for you.'}
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
            No doctors are currently available in your area. After you submit your request, our team will reach out to help with scheduling.
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
                  isPrimaryProvider={
                    showPrimaryProviderBadge &&
                    chartPrimaryProviderId != null &&
                    String(doc.id) === String(chartPrimaryProviderId)
                  }
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

        {/* ── Preferred-times panel (request-only doctor or online booking off) ── */}
        {!loadingDoctors && showPreferencesPanel && selectedDoctor && (
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
              {isRequestOnlySelected ? (
                <>
                  <strong>
                    Dr. {selectedDoctor.name.replace(/^Dr\.?\s*/i, '').trim()}
                  </strong>{' '}
                  isn&apos;t available for online booking yet. Share your
                  preferred days and times below and our team will reach out to schedule with you.
                </>
              ) : (
                ONLINE_BOOKING_UNAVAILABLE_MESSAGE
              )}
            </div>

            {slotPickerError && (
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
                {slotPickerError}
              </div>
            )}

            <label
              htmlFor="self-schedule-preferred-times"
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: grey700,
                marginBottom: 6,
              }}
            >
              Your preferred days and times
            </label>
            <textarea
              id="self-schedule-preferred-times"
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
        {!loadingDoctors && !showPreferencesPanel && doctors.length > 0 && (
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

            {soonestAvailabilityNote && !loadingMonth ? (
              <div style={{ fontSize: 12, color: tealDark, textAlign: 'center', marginTop: 8 }}>
                {soonestAvailabilityNote}
              </div>
            ) : null}

            {!loadingMonth && <AddressMatchedTimesNotice />}

            {/* Disabled prev-month hint */}
            {isPrevDisabled && currentMonth <= DateTime.now().startOf('month') && (
              <div style={{ fontSize: 11, color: grey400, textAlign: 'center', marginTop: 6 }}>
                Showing from this month forward
              </div>
            )}
          </>
        )}

        {/* ── Time slots ─────────────────────────────────────────────────── */}
        {!showPreferencesPanel && selectedDay && (
          <div ref={timesSectionRef} style={{ marginTop: 14, scrollMarginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: grey700, marginBottom: 4 }}>
              Available times on{' '}
              <span style={{ color: tealDark }}>
                {DateTime.fromISO(selectedDay).toFormat('cccc, LLLL d')}
              </span>
            </div>
            <div style={{ fontSize: 12, color: grey400, marginBottom: 8 }}>
              Tap a time to select it
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
                availability. Submit your request and our team will reach out to
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
              {!loadingDoctors && doctors.length > 0 && selectedSlotWindow?.windowDisplay && (
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
            justifyContent: showPreferencesPanel ? 'space-between' : 'flex-end',
          }}
        >
          {showPreferencesPanel ? (
            <>
              <button
                type="button"
                onClick={onClose}
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
                Cancel
              </button>
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
                {isRequestOnlySelected
                  ? `Request ${selectedDoctor ? `Dr. ${selectedDoctor.name.replace(/^Dr\.?\s*/i, '').split(' ')[0]}` : 'This Doctor'}`
                  : 'Save preferred times'}
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
