// src/pages/Scheduler.tsx — Practice-wide appointment calendar (GET /appointments/range)
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { AlertTriangle, Cat, Check, Dog, Heart, Printer, X } from 'lucide-react';
import {
  appointmentZoneFullName,
  appointmentZoneShortLabel,
  deleteAppointment,
  depotOfficeTownLabel,
  fetchAppointmentsRange,
  isAppointmentCancelledOnPracticeCalendar,
  isFlexBlockItem,
  patchAppointment,
  type DoctorDayPatientPrimaryProvider,
} from '../api/appointments';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { patchPatient } from '../api/patients';
import { http } from '../api/http';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { fetchAllAppointmentTypes, type AppointmentType } from '../api/appointmentSettings';
import { createRoomLoaders, type Appointment, type Client, type Patient } from '../api/roomLoader';
import {
  computeHoverPopoverPosition,
  rectFromElement,
} from '../utils/hoverPopoverPosition';
import { useAuth } from '../auth/useAuth';
import {
  fetchSchedulerDoctorDayBundle,
  fetchSchedulerDriveEtasForDayBundle,
  schedulerDriveScheduleOnlyFromBundle,
  type DriveIsoPair,
  type SchedulerDoctorDayAppointmentZones,
  type SchedulerDoctorDayMembership,
} from '../utils/schedulerDriveEta';
import { buildGoogleMapsLinksForDay, type Stop } from '../utils/maps';
import { colorForDrive } from '../utils/statsFormat';
import { formatIsoInPracticeZone, formatIsoTimeShortInPracticeZone } from '../utils/practiceTimezone';
import {
  buildMyWeekDriveSegmentsFromLayout,
  computeMyWeekDayColumnLayout,
  dayPoints,
  dayTotalDriveSeconds,
  timeStrToMinutesFromMidnight,
  type DayData,
  type WeekGridMetrics,
} from './MyWeek';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import {
  SchedulerBookModal,
  extractPatientsFromClientPayload,
  type SchedulerBookPrefill,
  type SchedulerBookSlot,
} from './SchedulerBookModal';
import {
  SchedulerAppointmentContextMenu,
  type SchedulerContextMenuAction,
} from './SchedulerContextMenu';
import { SchedulerEditVisitModal } from './SchedulerEditVisitModal';
import {
  clearRoutingCalendarPreview,
  readRoutingCalendarPreview,
  ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT,
  SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID,
  type RoutingCalendarPreviewPayloadV1,
} from '../utils/routingCalendarPreviewStorage';
import { clearRoutingPersistenceAfterSchedulerBook } from '../utils/routingUiSnapshot';
import { buildMyDayVisualPdfExportPayloadFromDayData } from '../utils/myDayVisualPdfFromDayData';
import { exportMyDayVisualPdf } from '../utils/myDayVisualPdfExport';
import './Scheduler.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

/** Extra line for last drive hatched band (depot return), when not already in segment title from layout. */
function schedulerDriveHoverExtraLine(
  seg: { title: string; kind: 'buffer' | 'drive' },
  segIndex: number,
  segs: { title: string; kind: 'buffer' | 'drive' }[],
  dayData: DayData
): string | null {
  if (seg.kind !== 'drive') return null;
  let lastDriveIdx = -1;
  for (let j = segs.length - 1; j >= 0; j--) {
    if (segs[j].kind === 'drive') {
      lastDriveIdx = j;
      break;
    }
  }
  if (segIndex !== lastDriveIdx) return null;
  if (seg.title.includes('Arrival:')) return null;
  const tz = (dayData.timezone && dayData.timezone.trim()) || PRACTICE_TZ;
  const iso = dayData.backToDepotIso?.trim();
  if (iso) {
    const dt = DateTime.fromISO(iso);
    if (dt.isValid) {
      const t = formatIsoInPracticeZone(iso, tz);
      if (t) return `Back at depot: ${t}`;
    }
  }
  const edt = dayData.endDepotTime?.trim();
  if (edt) return `Scheduled depot return: ${edt}`;
  return null;
}

type SchedulerProps = {
  /** Calendar pane beside Routing; preview sync does not navigate away from `/schedule/routing`. */
  embedInRoutingWorkspace?: boolean;
};

/** Delay before the visit hover card appears (avoids popover noise on quick passes). */
const SCHEDULER_HOVER_POPOVER_DELAY_MS = 750;
/** Match My Week column layout / drive segment math (`MyWeek.tsx` PPM). */
const PPM = 1.1;
/** Spacer under nav + height of `.scheduler-day-header` (must stay in sync with CSS). */
const SCHEDULER_DAY_HEADER_STACK_PX = 96;
const SLOT_MINUTES = 15;
const DEFAULT_GRID_START = 7 * 60;
const DEFAULT_GRID_END = 17 * 60;
/** Minutes of grid past depot and past first/last timed item (same as My Week depot lead-in). */
const SCHEDULER_GRID_EDGE_BUFFER_MIN = 30;

/** Unified all-day strip: row height, vertical padding, max visible rows (then scroll inside strip). */
const SCHEDULER_ALL_DAY_ROW_PX = 22;
const SCHEDULER_ALL_DAY_PAD_Y = 6;
const SCHEDULER_ALL_DAY_MAX_VISIBLE_ROWS = 8;

const TYPE_COLOR_FALLBACK = [
  '#16a34a',
  '#2563eb',
  '#db2777',
  '#ca8a04',
  '#9333ea',
  '#dc2626',
  '#64748b',
  '#0d9488',
  '#ea580c',
  '#4f46e5',
];

function hashColorKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return TYPE_COLOR_FALLBACK[Math.abs(h) % TYPE_COLOR_FALLBACK.length];
}

function normalizeHex(c: string | null | undefined): string | null {
  if (!c || typeof c !== 'string') return null;
  const t = c.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) return t;
  return null;
}

/** Background from appointment type row: calendarColor / colorHex / color (hex or CSS named e.g. pink). */
function typeBackgroundFromRow(
  t: { calendarColor?: string | null; colorHex?: string | null; color?: string | null } | null | undefined
): string | null {
  if (!t) return null;
  const hex =
    normalizeHex(t.calendarColor) ?? normalizeHex(t.colorHex) ?? normalizeHex(t.color);
  if (hex) return hex;
  const named = pickStr(t.color);
  if (named && /^[a-z]{2,20}$/i.test(named)) return named.toLowerCase();
  return null;
}

function hexToRgbChannels(hex7: string): { r: number; g: number; b: number } | null {
  let h = hex7.trim();
  if (!h.startsWith('#')) return null;
  h = h.slice(1);
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Readable default label color on top of arbitrary fill (hex or simple named). */
function readableTextOnBackground(fill: string): string {
  const hx = normalizeHex(fill);
  if (hx) {
    const rgb = hexToRgbChannels(hx);
    if (rgb) {
      const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
      return lum > 0.55 ? '#0f172a' : '#f8fafc';
    }
  }
  const named = fill.trim().toLowerCase();
  const lightish = new Set([
    'white',
    'yellow',
    'pink',
    'lightgray',
    'wheat',
    'ivory',
    'beige',
    'honeydew',
    'azure',
    'mintcream',
    'lemonchiffon',
    'cornsilk',
    'linen',
    'oldlace',
    'floralwhite',
    'snow',
    'ghostwhite',
    'lightyellow',
    'lightcyan',
  ]);
  if (lightish.has(named)) return '#0f172a';
  return '#f8fafc';
}

function resolveForegroundCss(raw: string | null | undefined): string | null {
  const t = pickStr(raw);
  if (!t) return null;
  const hx = normalizeHex(t);
  if (hx) return hx;
  if (/^rgba?\(/i.test(t)) return t;
  if (/^hsla?\(/i.test(t)) return t;
  if (/^[a-z]{2,20}$/i.test(t)) return t.toLowerCase();
  return null;
}

function buildTypeFillMap(types: AppointmentType[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const t of types) {
    const bg = typeBackgroundFromRow(t);
    if (bg) m.set(t.id, bg);
  }
  return m;
}

function colorsForAppointment(
  a: Appointment,
  typeList: AppointmentType[],
  typeFillMap: Map<number, string>
): { fill: string; text: string } {
  const tid = a.appointmentType?.id;
  const fromList = tid != null ? typeList.find((x) => x.id === tid) : undefined;
  const mergedRow = fromList ?? (a.appointmentType as AppointmentType | undefined);

  let fill =
    typeBackgroundFromRow(mergedRow) ??
    (tid != null && typeFillMap.has(tid) ? typeFillMap.get(tid)! : null) ??
    typeBackgroundFromRow(a.appointmentType as AppointmentType);

  if (!fill) {
    const name = a.appointmentType?.prettyName || a.appointmentType?.name || 'type';
    fill = hashColorKey(`${tid ?? ''}:${name}`);
  }

  const textRaw = pickStr(fromList?.textColor) ?? pickStr((a.appointmentType as { textColor?: string })?.textColor);
  const text = resolveForegroundCss(textRaw) ?? readableTextOnBackground(fill);
  return { fill, text };
}

function clientLabel(c: Appointment['client']): string {
  if (!c) return '—';
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.join(' ').trim() || '—';
}

/** Support `patients[]` from API when present; otherwise single `patient`. */
function patientsForAppointment(a: Appointment): Patient[] {
  const multi = (a as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) return multi;
  return a.patient ? [a.patient] : [];
}

/** Same membership source as My Week: appointment root, primary patient, or any nested patient. */
function appointmentPatientMember(appt: Appointment): {
  isMember: boolean;
  membershipName: string | null;
} {
  const patients = patientsForAppointment(appt);
  const pat = appt.patient;
  const isMember = Boolean(
    appt.isMember ?? pat?.isMember ?? patients.some((p) => p.isMember)
  );
  let raw = appt.membershipName ?? pat?.membershipName;
  if (raw == null || String(raw).trim() === '') {
    const mem = patients.find((p) => p.isMember && p.membershipName != null && String(p.membershipName).trim() !== '');
    raw = mem?.membershipName ?? null;
  }
  const membershipName =
    typeof raw === 'string' && raw.trim()
      ? raw.trim()
      : raw != null && String(raw).trim()
        ? String(raw).trim()
        : null;
  return { isMember, membershipName };
}

function providerLabel(p: Appointment['primaryProvider']): string {
  if (!p) return '—';
  return [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || '—';
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

const SCHEDULER_ZONE_BADGE_COLORS = [
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
  '#1d4ed8',
  '#6d28d9',
  '#86198f',
  '#0369a1',
  '#047857',
  '#7c3aed',
  '#be185d',
];

function schedulerZoneBadgeTextColor(zoneKey: string): string {
  let h = 2166136261;
  const s = zoneKey.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return SCHEDULER_ZONE_BADGE_COLORS[Math.abs(h) % SCHEDULER_ZONE_BADGE_COLORS.length];
}

function SchedulerZoneBadgeInline({
  zoneShort,
  title: titleAttr,
  compact,
}: {
  zoneShort: string;
  title?: string | null;
  compact?: boolean;
}) {
  const color = schedulerZoneBadgeTextColor(zoneShort);
  return (
    <span
      className={
        compact
          ? 'scheduler-client-zone-badge scheduler-client-zone-badge--compact'
          : 'scheduler-client-zone-badge'
      }
      style={{ color, borderColor: color }}
      title={titleAttr ?? undefined}
    >
      {zoneShort}
    </span>
  );
}

function SchedulerClientZoneBadge({
  appt,
  compact,
}: {
  appt: Appointment;
  compact?: boolean;
}) {
  const zone = appointmentZoneShortLabel(appt);
  if (!zone) return null;
  return (
    <SchedulerZoneBadgeInline
      zoneShort={zone}
      title={appointmentZoneFullName(appt)}
      compact={compact}
    />
  );
}

/** Plain-text label for aria-label / context (avoid `title` on grid events — native tooltips clash with Visit Highlights). */
function schedulerEventAppointmentTitle(appt: Appointment): string {
  const c = appt.client;
  const clientLast = pickStr(c?.lastName);
  const pats = patientsForAppointment(appt);
  const petNames = pats.map((p) => pickStr(p.name)).filter((s): s is string => Boolean(s));
  if (petNames.length === 0) {
    return (
      clientLabel(c) ||
      pickStr(appt.description) ||
      appt.appointmentType?.prettyName ||
      appt.appointmentType?.name ||
      'Appointment'
    );
  }
  let petPart: string;
  if (petNames.length === 1) petPart = petNames[0];
  else if (petNames.length === 2) petPart = `${petNames[0]} & ${petNames[1]}`;
  else petPart = `${petNames[0]} +${petNames.length - 1}`;
  const tail = clientLast ? ` ${clientLast}` : '';
  const out = `${petPart}${tail}`.trim();
  return out || 'Appointment';
}

/** "Complete" label beside appointment type (hover + modal) — green border + glow. */
function SchedulerTypeCompletePill() {
  return <span className="scheduler-type-complete-pill">Complete</span>;
}

/** Green check in a white box — timed / all-day chip when visit is marked complete. */
function SchedulerApptCompleteBadge({ appt }: { appt: Appointment }) {
  if (!appt.isComplete) return null;
  return (
    <span className="scheduler-appt-complete-badge" title="Complete" aria-label="Complete">
      <Check size={9} strokeWidth={2.75} className="scheduler-appt-complete-badge__icon" aria-hidden />
    </span>
  );
}

/** Timed calendar chip: zone is on the time row; title is pet names + client. All-day: zone may appear in the title chip. */
function SchedulerEventTitleBlock({
  appt,
  variant = 'timed',
}: {
  appt: Appointment;
  variant?: 'timed' | 'allDay';
}) {
  const c = appt.client;
  const clientLast = pickStr(c?.lastName);
  const pats = patientsForAppointment(appt);
  const pets = pats
    .map((p) => ({ id: p.id, name: pickStr(p.name) }))
    .filter((x): x is { id: number; name: string } => Boolean(x.name));
  const zone = appointmentZoneShortLabel(appt);
  const zoneTitle = appointmentZoneFullName(appt);
  const zoneInTitle = variant === 'allDay';

  const Shell = variant === 'allDay' ? 'span' : 'div';
  const rootClass =
    variant === 'allDay'
      ? 'scheduler-all-day-span-bar-text scheduler-event-title scheduler-event-title--structured scheduler-event-title--all-day-chip'
      : 'scheduler-event-title scheduler-event-title--structured';

  const desc = pickStr(appt.description);
  if (variant === 'allDay' && desc) {
    return (
      <Shell className={rootClass}>
        <span className="scheduler-event-title-fallback">{desc}</span>
        {zoneInTitle && zone ? <SchedulerZoneBadgeInline zoneShort={zone} title={zoneTitle} compact /> : null}
        <SchedulerApptCompleteBadge appt={appt} />
      </Shell>
    );
  }

  if (pets.length === 0) {
    const fallback =
      clientLabel(c) ||
      pickStr(appt.description) ||
      appt.appointmentType?.prettyName ||
      appt.appointmentType?.name ||
      'Appointment';
    return (
      <Shell className={rootClass}>
        <span className="scheduler-event-title-fallback">{fallback}</span>
        {zoneInTitle && zone ? <SchedulerZoneBadgeInline zoneShort={zone} title={zoneTitle} compact /> : null}
        <SchedulerApptCompleteBadge appt={appt} />
      </Shell>
    );
  }

  return (
    <Shell className={rootClass}>
      {pets.map((pet, idx) => (
        <span key={pet.id} className="scheduler-event-title-pet">
          {idx > 0 ? (
            <span className="scheduler-event-title-sep">{pets.length === 2 ? ' & ' : ', '}</span>
          ) : null}
          <span className="scheduler-event-title-pet-name">{pet.name}</span>
          {zoneInTitle && zone ? <SchedulerZoneBadgeInline zoneShort={zone} title={zoneTitle} compact /> : null}
        </span>
      ))}
      {clientLast ? (
        <>
          <span className="scheduler-event-title-client-last"> {clientLast}</span>
          <SchedulerApptCompleteBadge appt={appt} />
        </>
      ) : (
        <SchedulerApptCompleteBadge appt={appt} />
      )}
    </Shell>
  );
}

/** Provider line for hover: "Julie Greenlaw, BVMS" */
function providerLabelFormal(p: Appointment['primaryProvider']): string {
  if (!p) return '—';
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  if (suffix && name) return `${name}, ${suffix}`;
  return name || '—';
}

function clientAddressOneLine(c: Client | undefined): string | null {
  if (!c) return null;
  const line1 = pickStr(c.address1);
  const line2 = pickStr(c.address2);
  const cityState = [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ');
  const zip = pickStr(c.zipcode);
  const tail = [cityState, zip].filter(Boolean).join(cityState && zip ? ' ' : '');
  const parts = [line1, line2, tail].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Primary + secondary household names when present */
function fullClientHouseholdName(c: Client | undefined): string {
  if (!c) return '—';
  const primary = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  const second = [c.secondFirstName, c.secondLastName].filter(Boolean).join(' ').trim();
  if (primary && second) return `${primary} · ${second}`;
  return primary || second || '—';
}

function clientPhonesLine(c: Client | undefined): string | null {
  if (!c) return null;
  const parts = [pickStr(c.phone1), pickStr(c.phone2)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function clientEmailsLine(c: Client | undefined): string | null {
  if (!c) return null;
  const parts = [pickStr(c.email), pickStr(c.secondEmail)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function clientAddressMultiline(c: Client | undefined): string | null {
  if (!c) return null;
  const line1 = pickStr(c.address1);
  const line2 = pickStr(c.address2);
  const cityState = [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ');
  const zip = pickStr(c.zipcode);
  const line3 = [cityState, zip].filter(Boolean).join(cityState && zip ? ' ' : '');
  const lines = [line1, line2, line3].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

/** Single-stop Google Maps link from client address or coordinates. */
function googleMapsUrlForAppointment(a: Appointment): string | null {
  const c = a.client;
  if (!c) return null;
  if (typeof c.lat === 'number' && typeof c.lon === 'number') {
    return `https://www.google.com/maps?q=${c.lat},${c.lon}`;
  }
  const line = clientAddressOneLine(c);
  if (!line) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`;
}

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : `tel:${phone}`;
}

/** Patient ids already on the schedule for this client in an overlapping interval (UTC compare). */
function patientIdsBookedForClientAtOverlap(
  clientId: string,
  rangeStartIso: string,
  rangeEndIso: string,
  appointments: Appointment[]
): string[] {
  const start = DateTime.fromISO(rangeStartIso, { zone: 'utc' });
  const end = DateTime.fromISO(rangeEndIso, { zone: 'utc' });
  if (!start.isValid || !end.isValid) return [];
  const out = new Set<string>();
  for (const a of appointments) {
    if (!isAppointmentVisible(a)) continue;
    if (a.allDay) continue;
    if (a.client?.id == null || String(a.client.id) !== clientId) continue;
    const as = DateTime.fromISO(a.appointmentStart, { zone: 'utc' });
    const ae = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' });
    if (!as.isValid || !ae.isValid) continue;
    if (as < end && ae > start) {
      for (const p of patientsForAppointment(a)) {
        if (p.id != null) out.add(String(p.id));
      }
    }
  }
  return [...out];
}

function appointmentSupportsEmployeeCoVisitPet(appt: Appointment): boolean {
  if (appt.allDay) return false;
  return appt.client?.id != null;
}

function patientSpeciesBreed(p: Patient): string | null {
  const species = pickStr(p.speciesEntity?.name) ?? pickStr(p.species);
  const breed = pickStr(p.breedEntity?.name) ?? pickStr(p.breed);
  if (species && breed) return `${species} · ${breed}`;
  return species || breed || null;
}

/** Breed name only (Visit Highlights patient line — no leading species). */
function patientBreedDisplayOnly(p: Patient): string | null {
  return pickStr(p.breedEntity?.name) ?? pickStr(p.breed) ?? null;
}

/** Compact sex for tooltip, e.g. FS / FI / MN / MI. */
function patientSexAbbrevDisplay(p: Patient): string | null {
  const raw = pickStr(p.sex)?.trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s._-]+/g, '').toLowerCase();
  if (compact === 'fs' || compact === 'sf') return 'FS';
  if (compact === 'fi') return 'FI';
  if (compact === 'mn') return 'MN';
  if (compact === 'mi') return 'MI';
  if (compact === 'cm') return 'CM';
  if (compact === 'f') return 'F';
  if (compact === 'm') return 'M';
  const s = raw.toLowerCase();
  const spayed = s.includes('spayed') || /\bspay\b/.test(s);
  const neutered = s.includes('neutered') || s.includes('castrat') || /\bneuter\b/.test(s);
  if (s.includes('female') || s.includes('bitch') || s.includes('queen')) {
    return spayed ? 'FS' : 'FI';
  }
  if (s.includes('male') && !s.includes('female')) {
    return neutered ? 'MN' : 'MI';
  }
  if (spayed && !s.includes('male')) return 'FS';
  if (neutered && !s.includes('female')) return 'MN';
  if (raw.length <= 4 && /^[A-Za-z]+$/i.test(raw)) return raw.toUpperCase();
  return null;
}

/** Age from DOB at practice-local "today", e.g. `9y 1m`, `6m`, `3w`. */
function patientAgeYearsMonthsDisplay(p: Patient): string | null {
  const dobIso = pickStr(p.dob);
  if (!dobIso) return null;
  const birth = DateTime.fromISO(dobIso);
  if (!birth.isValid) return null;
  const ref = DateTime.now().setZone(PRACTICE_TZ).startOf('day');
  const b = birth.setZone(PRACTICE_TZ).startOf('day');
  if (!b.isValid || ref < b) return null;
  let years = ref.year - b.year;
  let months = ref.month - b.month;
  const dayDiff = ref.day - b.day;
  if (dayDiff < 0) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0 || (years === 0 && months < 0)) return null;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (parts.length > 0) return parts.join(' ');
  const ageDays = Math.floor(ref.diff(b, 'days').days);
  if (ageDays < 0) return null;
  if (ageDays < 7) return ageDays <= 0 ? '<1d' : `${ageDays}d`;
  const w = Math.floor(ageDays / 7);
  return `${Math.max(1, w)}w`;
}

/** e.g. `3yo`, `9mo`, `2wk` for modal patient one-liner. */
function patientAgeCompactYoDisplay(p: Patient): string | null {
  const dobIso = pickStr(p.dob);
  if (!dobIso) return null;
  const birth = DateTime.fromISO(dobIso);
  if (!birth.isValid) return null;
  const ref = DateTime.now().setZone(PRACTICE_TZ).startOf('day');
  const b = birth.setZone(PRACTICE_TZ).startOf('day');
  if (!b.isValid || ref < b) return null;
  let years = ref.year - b.year;
  let months = ref.month - b.month;
  const dayDiff = ref.day - b.day;
  if (dayDiff < 0) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0 || (years === 0 && months < 0)) return null;
  if (years > 0 && months > 0) return `${years}yo ${months}mo`;
  if (years > 0) return `${years}yo`;
  if (months > 0) return `${months}mo`;
  const ageDays = Math.floor(ref.diff(b, 'days').days);
  if (ageDays < 0) return null;
  if (ageDays < 7) return ageDays <= 0 ? '<1d' : `${ageDays}d`;
  const wk = Math.floor(ageDays / 7);
  return `${Math.max(1, wk)}wk`;
}

function titleCaseWords(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  return t
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

function patientBreedTitleCase(p: Patient): string | null {
  return titleCaseWords(patientBreedDisplayOnly(p));
}

/** Dog vs cat icon in Visit Highlights when species is canine / feline. */
function patientSpeciesIconKind(p: Patient): 'dog' | 'cat' | null {
  const spec = (pickStr(p.speciesEntity?.name) ?? pickStr(p.species) ?? '').toLowerCase();
  if (!spec) return null;
  if (spec.includes('canine') || spec.includes('dog')) return 'dog';
  if (spec.includes('feline') || spec.includes('cat')) return 'cat';
  return null;
}

/** Blue vs pink patient highlight from PIMS sex string (best-effort); recognizes FS/FI/MN/MI etc. */
function patientSexHighlightTone(p: Patient): 'male' | 'female' | 'neutral' {
  const raw = (pickStr(p.sex) ?? '').trim();
  if (!raw) return 'neutral';
  const compact = raw.replace(/[\s._-]+/g, '').toLowerCase();
  if (compact === 'fs' || compact === 'fi' || compact === 'sf' || compact === 'f') return 'female';
  if (compact === 'mn' || compact === 'mi' || compact === 'm') return 'male';
  const s = raw.toLowerCase();
  if (s.includes('female') || s.includes('bitch') || s.includes('queen')) return 'female';
  if (s.includes('male') && !s.includes('female')) return 'male';
  if (s.includes('spayed') || /\bspay\b/.test(s)) return 'female';
  if (s.includes('neutered') || s.includes('castrat') || /\bneuter\b/.test(s)) return 'male';
  return 'neutral';
}

function userLikeLabel(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t || null;
  }
  if (typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const combined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
  return pickStr(o.name) ?? pickStr(o.displayName) ?? (combined || null);
}

function appointmentCreatedByPerson(appt: Appointment): string | null {
  const o = appt as unknown as Record<string, unknown>;
  return (
    pickStr(appt.createdByName) ??
    userLikeLabel(appt.createdByUser) ??
    userLikeLabel(appt.createdByEmployee) ??
    (typeof appt.createdBy === 'string' ? pickStr(appt.createdBy) : userLikeLabel(appt.createdBy)) ??
    pickStr(o.createdByUserName) ??
    pickStr(o.createdByUsername) ??
    userLikeLabel(o.createdByUser) ??
    userLikeLabel(o.createdByEmployee)
  );
}

/** ISO instant for "last modified" — prefers `modified`, then legacy `updated`. */
function appointmentModifiedAtIso(appt: Appointment): string | undefined {
  return pickStr(appt.modified) ?? pickStr(appt.updated) ?? undefined;
}

function appointmentModifiedByPerson(appt: Appointment): string | null {
  const o = appt as unknown as Record<string, unknown>;
  return (
    pickStr(appt.modifiedByName) ??
    pickStr(appt.updatedByName) ??
    userLikeLabel(appt.modifiedByUser) ??
    userLikeLabel(appt.updatedByUser) ??
    userLikeLabel(appt.modifiedByEmployee) ??
    userLikeLabel(appt.updatedByEmployee) ??
    (typeof appt.updatedBy === 'string' ? pickStr(appt.updatedBy) : userLikeLabel(appt.updatedBy)) ??
    pickStr(o.modifiedByName as string | undefined) ??
    pickStr(o.updatedByUserName as string | undefined) ??
    pickStr(o.updatedByUsername as string | undefined) ??
    userLikeLabel(o.modifiedByUser) ??
    userLikeLabel(o.updatedByUser) ??
    userLikeLabel(o.modifiedByEmployee) ??
    userLikeLabel(o.updatedByEmployee)
  );
}

function formatAppointmentAuditDisplay(iso: string | undefined, byPerson: string | null): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return null;
  const when = dt.toLocaleString(DateTime.DATETIME_MED);
  return byPerson ? `${when} by ${byPerson}` : when;
}

/** Resolve chart patient's PIMS primary provider from flexible range/detail payloads. */
function primaryProviderFromPatientRecord(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const flat =
    pickStr(o.primaryProviderName) ??
    pickStr(o.primaryProviderFullName) ??
    pickStr(o.primaryCareProviderName) ??
    pickStr(o.pimsPrimaryProviderName) ??
    pickStr(o.primary_provider_name);
  if (flat) return flat;

  const raw =
    o.primaryProvider ??
    o.primary_provider ??
    o.primaryCareProvider ??
    /** Some integrations attach the vet as `employee` on the patient. */
    o.employee;
  if (!raw || typeof raw !== 'object') return null;
  const pr = raw as Record<string, unknown>;
  const first = pickStr(pr.firstName);
  const last = pickStr(pr.lastName);
  const byParts = [first, last].filter(Boolean).join(' ').trim();
  if (byParts) {
    return providerNameWithSignatorySuffix({
      firstName: first,
      lastName: last,
      designation: pickStr(pr.designation),
      title: pickStr(pr.title),
    });
  }
  const composed =
    pickStr(pr.name) ??
    pickStr(pr.fullName) ??
    pickStr(pr.displayName) ??
    '';
  if (!composed) return null;
  const suffix = pickStr(pr.designation) ?? pickStr(pr.credentials) ?? pickStr(pr.title);
  if (suffix && !composed.toLowerCase().includes(suffix.toLowerCase())) return `${composed}, ${suffix}`;
  return composed;
}

/**
 * Patient record primary provider (not {@link Appointment.primaryProvider}, which is the visit assignee).
 * Range payloads often hydrate `patient` on the appointment but send a slimmer `patients[]` — merge from the matching singular row.
 */
function patientPrimaryProviderDisplay(p: Patient, appt: Appointment): string | null {
  const fromPet = primaryProviderFromPatientRecord(p);
  if (fromPet) return fromPet;
  const sing = appt.patient;
  if (sing && String(sing.id) === String(p.id)) {
    return primaryProviderFromPatientRecord(sing);
  }
  return null;
}

/** Name segment before first comma (strip ", D.V.M." etc.) for assignee vs chart PCP comparison. */
function primaryProviderLabelNameOnlyForCompare(label: string): string {
  const idx = label.indexOf(',');
  return (idx >= 0 ? label.slice(0, idx) : label).trim();
}

function providerNameWithSignatorySuffix(args: {
  firstName?: string | null;
  lastName?: string | null;
  designation?: string | null;
  title?: string | null;
}): string | null {
  const name = [pickStr(args.firstName), pickStr(args.lastName)].filter(Boolean).join(' ').trim();
  if (!name) return null;
  const suffix = pickStr(args.designation) ?? pickStr(args.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function labelFromAppointmentPatientPrimaryProvider(
  ref: Appointment['patientPrimaryProvider'] | null | undefined
): string | null {
  if (!ref) return null;
  return providerNameWithSignatorySuffix({
    firstName: ref.firstName,
    lastName: ref.lastName,
    designation: ref.designation,
    title: ref.title,
  });
}

function findProviderRowForChartPcp(
  providers: readonly Provider[] | undefined,
  ref: NonNullable<Appointment['patientPrimaryProvider']>
): Provider | null {
  if (!providers?.length) return null;
  const rid = ref.id;
  if (rid == null || !Number.isFinite(Number(rid))) return null;
  const n = Number(rid);
  return (
    providers.find((p) => Number(p.id) === n) ??
    providers.find((p) => p.pimsId != null && Number(p.pimsId) === n) ??
    providers.find((p) => String(p.id) === String(rid)) ??
    null
  );
}

/** "First Last, DVM" from `/employees/providers` row — same pattern as {@link providerLabelFormal} for assignees. */
function providerLabelFormalFromProviderRow(p: Provider): string | null {
  const name =
    [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim() || pickStr(p.name);
  if (!name) return null;
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function chartPrimaryProviderLabelFromRefAndProviders(
  ref: Appointment['patientPrimaryProvider'] | null | undefined,
  providers: readonly Provider[] | undefined
): string | null {
  if (!ref) return null;
  const row = findProviderRowForChartPcp(providers, ref);
  if (!row) return null;
  return providerLabelFormalFromProviderRow(row);
}

/**
 * Chart primary provider: resolve by id from `/employees/providers` when possible, else doctor-day ref
 * fields, else patient payload.
 */
function appointmentPatientChartPrimaryProviderLabel(
  appt: Appointment,
  providers?: readonly Provider[] | null
): string | null {
  const fromEmployees = chartPrimaryProviderLabelFromRefAndProviders(
    appt.patientPrimaryProvider,
    providers ?? undefined
  );
  if (fromEmployees) return fromEmployees;
  const fromDoctor = labelFromAppointmentPatientPrimaryProvider(appt.patientPrimaryProvider);
  if (fromDoctor) return fromDoctor;
  for (const p of patientsForAppointment(appt)) {
    const v = patientPrimaryProviderDisplay(p, appt);
    if (v) return v;
  }
  return null;
}

function appointmentNamesRoughlyEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

function appointmentChartPrimaryProviderDiffersFromAssignee(
  appt: Appointment,
  chartLabel: string
): boolean {
  const assignee = providerLabel(appt.primaryProvider);
  if (!assignee || assignee === '—') return false;
  if (appointmentNamesRoughlyEqual(assignee, primaryProviderLabelNameOnlyForCompare(chartLabel)))
    return false;
  const aid = appt.primaryProvider?.id;
  const pref = appt.patientPrimaryProvider;
  if (aid != null && pref && Number(pref.id) === Number(aid)) return false;
  return true;
}

/** Last recorded weight when the range payload includes it (`weight`, `lastWeight`, `weightLbs`, etc.). */
function patientLastWeightDisplay(p: Patient): string | null {
  const o = p as unknown as Record<string, unknown>;
  const raw =
    p.weight ??
    p.lastWeight ??
    p.weightLbs ??
    p.lastWeightLbs ??
    o.lastRecordedWeight ??
    o.last_weight ??
    o.weight_lbs;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const hasUnit = /\b(kg|lbs?)\b/i.test(s) || s.includes('/');
  const weightPart = hasUnit ? s : `${s} lbs`;
  const dateRaw =
    pickStr(p.lastWeightDate ?? undefined) ??
    pickStr(p.weightDate ?? undefined) ??
    pickStr(o.lastWeightDate as string | undefined) ??
    pickStr(o.last_weight_date as string | undefined);
  if (dateRaw) {
    const d = DateTime.fromISO(dateRaw);
    if (d.isValid) return `${weightPart} (${d.toFormat('M/d/yyyy')})`;
  }
  return weightPart;
}

function VisitHighlightsRow({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === '') return null;
  return (
    <div className="scheduler-tooltip-vh-row">
      <div className="scheduler-tooltip-vh-k">{label}</div>
      <div className="scheduler-tooltip-vh-v">{children}</div>
    </div>
  );
}

/** Single-line "Label: value" for modal sections; `fullWidth` spans both columns in a 2-col grid. */
function SchedulerModalKvCondensed({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: ReactNode;
  /** Use for long / multiline values so they do not share a row with another field. */
  fullWidth?: boolean;
}) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div
      className={
        fullWidth
          ? 'scheduler-modal-kv-condensed scheduler-modal-kv-condensed--full'
          : 'scheduler-modal-kv-condensed'
      }
      role="group"
    >
      <span className="scheduler-modal-kv-condensed-k">{label}:</span>{' '}
      <span className="scheduler-modal-kv-condensed-v">{value}</span>
    </div>
  );
}

const DRIVE_STRIPE_BG =
  'repeating-linear-gradient(135deg, #e2e8f0 0px, #e2e8f0 6px, #cbd5e1 6px, #cbd5e1 12px)';
const BUFFER_STRIPE_BG = 'rgba(255, 255, 255, 0.35)';
const BUFFER_STRIPE_BORDER = '1px dashed #d1d5db';

function schedulerHouseholdFixedTimeApprox(h: {
  isPersonalBlock?: boolean;
  primary?: unknown;
  patients?: { type?: string | null }[];
}): boolean {
  if (h.isPersonalBlock && !isFlexBlockItem(h.primary as { blockLabel?: string; title?: string })) return true;
  const primary = h.primary as Record<string, unknown> | undefined;
  const at = primary?.appointmentType as { name?: string; prettyName?: string } | undefined;
  const nested = at && typeof at === 'object' ? String(at.name ?? at.prettyName ?? '').toLowerCase() : '';
  const flat = String(primary?.appointmentTypeName ?? primary?.appointmentType ?? '').toLowerCase();
  const typeLower = nested || flat;
  if (typeLower === 'fixed time' || typeLower.includes('fixed time')) return true;
  return (h.patients?.[0]?.type || '').toLowerCase() === 'fixed time';
}

function driveHouseholdAndSlotForAppointment(
  dayData: DayData,
  apptId: string | number
): { h: DayData['households'][number]; slot: DayData['timeline'][number] } | null {
  const apptKey = String(apptId);
  const households = dayData.households;
  for (let j = 0; j < households.length; j++) {
    const hx = households[j] as { sourceAppointmentIds?: (string | number)[] };
    const ids = hx.sourceAppointmentIds;
    if (!ids?.some((id) => String(id) === apptKey)) continue;
    const slot = dayData.timeline[j] ?? {};
    return { h: households[j], slot };
  }
  return null;
}

function dayKeyFromIso(iso: string): string | null {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(PRACTICE_TZ);
  return dt.isValid ? dt.toISODate() : null;
}

type SchedulerHoverDriveHint = {
  practiceTz: string;
  etaIso: string | null;
  etdIso: string | null;
  windowStartIso: string | null;
  windowEndIso: string | null;
  schedStartIso: string | null;
  schedEndIso: string | null;
  isPersonalBlock: boolean;
  isFixedTime: boolean;
};

function buildSchedulerDriveHintForAppt(
  appt: Appointment,
  showByDriveTime: boolean,
  resolvedPrimaryProviderId: string,
  driveDayByDate: Map<string, DayData> | null | undefined
): SchedulerHoverDriveHint | null {
  if (!showByDriveTime || !resolvedPrimaryProviderId.trim()) return null;
  const dk = dayKeyFromIso(appt.appointmentStart);
  if (!dk) return null;
  const dayData = driveDayByDate?.get(dk);
  if (!dayData) return null;
  const row = driveHouseholdAndSlotForAppointment(dayData, appt.id);
  if (!row) return null;
  const { h, slot } = row;
  const practiceTz = dayData.timezone || PRACTICE_TZ;
  const isFixedTime = schedulerHouseholdFixedTimeApprox(h);
  const etaIso = slot?.eta ?? null;
  const etdIso = slot?.etd ?? null;
  const windowStartIso =
    (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowStartIso : null) ??
    (h as { windowStartIso?: string | null }).windowStartIso ??
    (h as { effectiveWindow?: { startIso?: string } }).effectiveWindow?.startIso ??
    null;
  const windowEndIso =
    (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowEndIso : null) ??
    (h as { windowEndIso?: string | null }).windowEndIso ??
    (h as { effectiveWindow?: { endIso?: string } }).effectiveWindow?.endIso ??
    null;
  return {
    practiceTz,
    etaIso,
    etdIso,
    windowStartIso,
    windowEndIso,
    schedStartIso: h.startIso ?? null,
    schedEndIso: h.endIso ?? null,
    isPersonalBlock: Boolean(h.isPersonalBlock),
    isFixedTime,
  };
}

function visitDetailsEtaEtdLine(driveHint: SchedulerHoverDriveHint | null | undefined): string | null {
  if (!driveHint) return null;
  if (!(driveHint.etaIso || driveHint.etdIso)) return null;
  const tz = driveHint.practiceTz;
  const e = driveHint.etaIso ? formatIsoTimeShortInPracticeZone(driveHint.etaIso, tz) : '—';
  const d = driveHint.etdIso ? formatIsoTimeShortInPracticeZone(driveHint.etdIso, tz) : '—';
  return `${e} – ${d}`;
}

/** Window / arrival range: drive-day slot when available, else appointment `arrivalWindow`. */
function visitDetailsWindowLine(
  appt: Appointment,
  driveHint: SchedulerHoverDriveHint | null | undefined
): string | null {
  if (driveHint) {
    const showWindow =
      !!(driveHint.windowStartIso || driveHint.windowEndIso) &&
      !(driveHint.isPersonalBlock && driveHint.isFixedTime);
    if (showWindow) {
      const tz = driveHint.practiceTz;
      if (driveHint.isFixedTime && !driveHint.isPersonalBlock) {
        const a = driveHint.schedStartIso
          ? formatIsoTimeShortInPracticeZone(driveHint.schedStartIso, tz)
          : '—';
        const b = driveHint.schedEndIso
          ? formatIsoTimeShortInPracticeZone(driveHint.schedEndIso, tz)
          : '—';
        return `${a} – ${b}`;
      }
      const a = driveHint.windowStartIso
        ? formatIsoTimeShortInPracticeZone(driveHint.windowStartIso, tz)
        : '—';
      const b = driveHint.windowEndIso
        ? formatIsoTimeShortInPracticeZone(driveHint.windowEndIso, tz)
        : '—';
      return `${a} – ${b}`;
    }
  }
  const aw = appt.arrivalWindow;
  if (aw?.windowStartLocal && aw?.windowEndLocal) {
    return `${aw.windowStartLocal} – ${aw.windowEndLocal}`;
  }
  const ws = pickStr(aw?.windowStartIso);
  const we = pickStr(aw?.windowEndIso);
  if (ws && we) {
    return `${formatIsoTimeShortInPracticeZone(ws, PRACTICE_TZ)} – ${formatIsoTimeShortInPracticeZone(we, PRACTICE_TZ)}`;
  }
  return null;
}

function SchedulerHoverContent({
  appt,
  driveHint,
  providers,
}: {
  appt: Appointment;
  driveHint?: SchedulerHoverDriveHint | null;
  /** Practice provider list (`/employees/providers`) — used to resolve chart Primary Provider by id. */
  providers?: readonly Provider[] | null;
}) {
  const c = appt.client;
  const patients = patientsForAppointment(appt);
  const member = appointmentPatientMember(appt);
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const end = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const typeRaw =
    pickStr(appt.appointmentType?.name) ??
    pickStr(appt.appointmentType?.prettyName) ??
    null;
  const desc = appt.description?.trim() || null;
  const instr = appt.instructions?.trim() || null;
  const descCombined = [desc, instr].filter(Boolean).join(' · ') || null;
  const clientAlerts = c?.alerts?.trim() || null;
  const addrLine = clientAddressOneLine(c ?? undefined);
  const phoneLine = clientPhonesLine(c ?? undefined);
  const providerLine = providerLabelFormal(appt.primaryProvider);
  const chartPrimaryProviderLabel = appointmentPatientChartPrimaryProviderLabel(appt, providers);
  const appointmentVsChartProviderMismatch =
    !!chartPrimaryProviderLabel &&
    appointmentChartPrimaryProviderDiffersFromAssignee(appt, chartPrimaryProviderLabel);
  const createdLine = formatAppointmentAuditDisplay(
    pickStr(appt.created) ?? undefined,
    appointmentCreatedByPerson(appt)
  );
  const modifiedLine = formatAppointmentAuditDisplay(
    appointmentModifiedAtIso(appt),
    appointmentModifiedByPerson(appt)
  );
  const showAuditFooter = !!(createdLine || modifiedLine);

  return (
    <>
      <div className="scheduler-tooltip-vh-header">Visit Highlights</div>
      <div className="scheduler-tooltip-vh-body">
        <div className="scheduler-tooltip-vh-preamble">
          {typeRaw || appt.isComplete ? (
            <div className="scheduler-tooltip-vh-type-row">
              {typeRaw ? <div className="scheduler-tooltip-vh-type">{typeRaw}</div> : null}
              {appt.isComplete ? <SchedulerTypeCompletePill /> : null}
            </div>
          ) : null}
          {descCombined ? <div className="scheduler-tooltip-vh-desc">{descCombined}</div> : null}
          <div className="scheduler-tooltip-vh-provider-row">
            <span className="scheduler-tooltip-vh-provider">{providerLine}</span>
            {appointmentVsChartProviderMismatch ? (
              <span
                className="scheduler-tooltip-vh-provider-pcp-mismatch"
                role="status"
                title={
                  chartPrimaryProviderLabel
                    ? `Primary Provider on chart: ${chartPrimaryProviderLabel}`
                    : undefined
                }
              >
                <AlertTriangle
                  size={12}
                  strokeWidth={2.25}
                  className="scheduler-tooltip-vh-provider-pcp-mismatch__icon"
                  aria-hidden
                />
                <span>≠ chart PCP</span>
              </span>
            ) : null}
          </div>
        </div>
        <hr className="scheduler-tooltip-vh-divider" />

        <VisitHighlightsRow label="Scheduled">
          {start.isValid && end.isValid
            ? `${start.toFormat('M/d/yyyy h:mm a')} – ${end.toFormat('h:mm a')}`
            : null}
        </VisitHighlightsRow>
        {driveHint ? (
          (() => {
            const showArrive = !!(driveHint.etaIso || driveHint.etdIso);
            const showWindow =
              !!(driveHint.windowStartIso || driveHint.windowEndIso) &&
              !(driveHint.isPersonalBlock && driveHint.isFixedTime);
            if (!showArrive && !showWindow) return null;
            return (
              <div className="scheduler-tooltip-drive-block">
                {showArrive ? (
                  <VisitHighlightsRow label="ETA / ETD">
                    {driveHint.etaIso
                      ? formatIsoTimeShortInPracticeZone(driveHint.etaIso, driveHint.practiceTz)
                      : '—'}
                    {' – '}
                    {driveHint.etdIso
                      ? formatIsoTimeShortInPracticeZone(driveHint.etdIso, driveHint.practiceTz)
                      : '—'}
                  </VisitHighlightsRow>
                ) : null}
                {showWindow ? (
                  <VisitHighlightsRow label="Window of arrival">
                    {driveHint.isFixedTime && !driveHint.isPersonalBlock ? (
                      <>
                        {driveHint.schedStartIso
                          ? formatIsoTimeShortInPracticeZone(driveHint.schedStartIso, driveHint.practiceTz)
                          : '—'}
                        {' – '}
                        {driveHint.schedEndIso
                          ? formatIsoTimeShortInPracticeZone(driveHint.schedEndIso, driveHint.practiceTz)
                          : '—'}
                      </>
                    ) : (
                      <>
                        {driveHint.windowStartIso
                          ? formatIsoTimeShortInPracticeZone(driveHint.windowStartIso, driveHint.practiceTz)
                          : '—'}
                        {' – '}
                        {driveHint.windowEndIso
                          ? formatIsoTimeShortInPracticeZone(driveHint.windowEndIso, driveHint.practiceTz)
                          : '—'}
                      </>
                    )}
                  </VisitHighlightsRow>
                ) : null}
              </div>
            );
          })()
        ) : null}

        {c ? (
          <div className="scheduler-tooltip-vh-block">
            <div className="scheduler-tooltip-vh-block-title">Client</div>
            <div className="scheduler-tooltip-vh-client-line">
              <strong>{clientLabel(c)}</strong>
              <SchedulerClientZoneBadge appt={appt} />
              <span className="scheduler-tooltip-vh-id"> (#{c.id})</span>
            </div>
            {addrLine ? <div className="scheduler-tooltip-vh-detail">{addrLine}</div> : null}
            {phoneLine ? (
              <div className="scheduler-tooltip-vh-detail">
                Phone: {phoneLine}
              </div>
            ) : null}
            {clientEmailsLine(c) ? (
              <div className="scheduler-tooltip-vh-detail">{clientEmailsLine(c)}</div>
            ) : null}
            {clientAlerts ? (
              <div className="scheduler-tooltip-vh-alerts" role="status">
                <span className="scheduler-tooltip-vh-alerts-title">Client alerts</span>
                {clientAlerts}
              </div>
            ) : null}
          </div>
        ) : null}

        {patients.length > 0 || member.isMember || chartPrimaryProviderLabel ? (
          <div className="scheduler-tooltip-vh-block">
            <div className="scheduler-tooltip-vh-block-title">Patient</div>
            {patients.map((p, idx) => {
              const pid = p.pimsId != null && String(p.pimsId).trim() !== '' ? p.pimsId : p.id;
              const pAlerts = p.alerts?.trim();
              const sexAbbr = patientSexAbbrevDisplay(p);
              const ageStr = patientAgeYearsMonthsDisplay(p);
              const breedOnly = patientBreedDisplayOnly(p);
              const breedShort =
                breedOnly && breedOnly.length > 42 ? `${breedOnly.slice(0, 40).trim()}…` : breedOnly;
              const sexTone = patientSexHighlightTone(p);
              const speciesIcon = patientSpeciesIconKind(p);
              return (
                <div key={p.id} className={idx > 0 ? 'scheduler-tooltip-vh-patient-entry' : undefined}>
                  <div
                    className={`scheduler-tooltip-vh-patient-highlight scheduler-tooltip-vh-patient-highlight--${sexTone}`}
                  >
                    {patients.length > 1 ? (
                      <div className="scheduler-tooltip-vh-patient-subtitle">Patient {idx + 1}</div>
                    ) : null}
                    <div className="scheduler-tooltip-vh-patient-line scheduler-tooltip-vh-patient-line--with-icon">
                      {speciesIcon === 'dog' ? (
                        <Dog
                          size={18}
                          strokeWidth={2}
                          className="scheduler-tooltip-vh-patient-species-icon scheduler-tooltip-vh-dog-lucide"
                          aria-hidden
                        />
                      ) : speciesIcon === 'cat' ? (
                        <Cat
                          size={18}
                          strokeWidth={2}
                          className="scheduler-tooltip-vh-patient-species-icon"
                          aria-hidden
                        />
                      ) : null}
                      <div className="scheduler-tooltip-vh-patient-line-text">
                        <strong>{p.name}</strong>
                        {ageStr ? (
                          <span className="scheduler-tooltip-vh-patient-meta"> · {ageStr}</span>
                        ) : null}
                        {sexAbbr ? (
                          <span className="scheduler-tooltip-vh-patient-meta"> · {sexAbbr}</span>
                        ) : null}
                        {breedShort ? (
                          <span className="scheduler-tooltip-vh-patient-breed"> · {breedShort}</span>
                        ) : null}
                        <span className="scheduler-tooltip-vh-id"> (#{pid})</span>
                      </div>
                    </div>
                    <VisitHighlightsRow label="Last weight">{patientLastWeightDisplay(p)}</VisitHighlightsRow>
                    {pAlerts ? (
                      <div className="scheduler-tooltip-vh-alerts scheduler-tooltip-vh-alerts--patient">
                        <span className="scheduler-tooltip-vh-alerts-title">Patient alerts</span>
                        {pAlerts}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {chartPrimaryProviderLabel ? (
              <div
                className={
                  patients.length > 0 ? 'scheduler-tooltip-vh-patient-block-pcp' : undefined
                }
              >
                <VisitHighlightsRow label="Primary Provider">{chartPrimaryProviderLabel}</VisitHighlightsRow>
              </div>
            ) : null}
            {member.isMember ? (
              <div className="scheduler-tooltip-vh-patient-membership">
                <div className="scheduler-tooltip-vh-patient-membership-label">Membership</div>
                <div className="scheduler-tooltip-vh-membership">
                  <Heart size={11} fill="#dc2626" color="#dc2626" strokeWidth={1.75} aria-hidden />
                  <span>{member.membershipName?.trim() || 'Member'}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {showAuditFooter ? (
          <>
            <hr className="scheduler-tooltip-vh-divider" />
            <VisitHighlightsRow label="Date created">{createdLine}</VisitHighlightsRow>
            <VisitHighlightsRow label="Date modified">{modifiedLine}</VisitHighlightsRow>
          </>
        ) : null}
      </div>
    </>
  );
}

function SchedulerAppointmentModal({
  appt,
  driveHint,
  accentColor,
  onClose,
  providers,
}: {
  appt: Appointment;
  driveHint?: SchedulerHoverDriveHint | null;
  accentColor: string;
  onClose: () => void;
  providers?: readonly Provider[] | null;
}) {
  const patients = patientsForAppointment(appt);
  const c = appt.client;
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const end = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const typeName = appt.appointmentType?.name || appt.appointmentType?.prettyName || 'Appointment';
  const clientAddr = c ? clientAddressMultiline(c) : null;
  const etaLine = visitDetailsEtaEtdLine(driveHint ?? null);
  const windowLine = visitDetailsWindowLine(appt, driveHint ?? null);
  const clientAlertsTrim = pickStr(c?.alerts)?.trim() ?? '';
  const chartPrimaryProviderLabel = appointmentPatientChartPrimaryProviderLabel(appt, providers);
  const appointmentVsChartProviderMismatch =
    !!chartPrimaryProviderLabel &&
    appointmentChartPrimaryProviderDiffersFromAssignee(appt, chartPrimaryProviderLabel);

  return (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="scheduler-modal"
        role="dialog"
        aria-modal
        aria-labelledby="scheduler-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">
              <span className="scheduler-modal-eyebrow-type">{typeName}</span>
              {appt.isComplete ? <SchedulerTypeCompletePill /> : null}
            </p>
            <h2 id="scheduler-modal-title" className="scheduler-modal-title-h">
              <span className="scheduler-modal-title-client">{fullClientHouseholdName(c)}</span>
              <SchedulerClientZoneBadge appt={appt} compact />
            </h2>
            {patients.length > 0 ? (
              <div className="scheduler-modal-patient-header-block">
                {patients.map((p) => {
                  const tone = patientSexHighlightTone(p);
                  const age = patientAgeCompactYoDisplay(p);
                  const sex = patientSexAbbrevDisplay(p);
                  const breed = patientBreedTitleCase(p);
                  const speciesLine = titleCaseWords(pickStr(p.speciesEntity?.name) ?? pickStr(p.species));
                  const tail = [age, sex, breed ?? speciesLine].filter(Boolean).join(' ');
                  const pAlerts = pickStr(p.alerts)?.trim();
                  return (
                    <div key={p.id} className="scheduler-modal-patient-header-entry">
                      <div
                        className={`scheduler-modal-patient-signalment scheduler-modal-patient-signalment--${tone}`}
                      >
                        <p
                          className={`scheduler-modal-patient-header-line scheduler-modal-patient-header-line--${tone}`}
                        >
                          <span className="scheduler-modal-patient-header-line-main">
                            <strong>{p.name}</strong>
                            {tail ? (
                              <span className="scheduler-modal-patient-header-line-tail"> - {tail}</span>
                            ) : null}
                          </span>
                        </p>
                      </div>
                      {pAlerts ? (
                        <div className="scheduler-modal-alerts-box" role="alert">
                          <span className="scheduler-modal-alerts-box-label">Patient alerts</span>
                          {pAlerts}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {chartPrimaryProviderLabel ? (
                  <div className="scheduler-modal-chart-pcp">
                    <span className="scheduler-modal-chart-pcp-k">Primary Provider:</span>{' '}
                    <span className="scheduler-modal-chart-pcp-v">{chartPrimaryProviderLabel}</span>
                  </div>
                ) : null}
                {appointmentVsChartProviderMismatch ? (
                  <div className="scheduler-modal-provider-mismatch" role="status">
                    <span className="scheduler-modal-provider-mismatch-title">
                      Different from appointment provider
                    </span>
                    This visit is assigned to <strong>{providerLabel(appt.primaryProvider)}</strong>; the
                    Primary Provider on chart is <strong>{chartPrimaryProviderLabel}</strong>.
                  </div>
                ) : null}
              </div>
            ) : null}
            {start.isValid && end.isValid ? (
              <p className="scheduler-modal-subtitle">
                {start.toFormat('EEEE, MMMM d, yyyy')}
                <span className="scheduler-modal-subtitle-sep">·</span>
                {start.toFormat('h:mm a')} – {end.toFormat('h:mm a')}
              </p>
            ) : null}
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body">
          <section className="scheduler-modal-section">
            <h3 className="scheduler-modal-h3">Visit details</h3>
            <div className="scheduler-modal-kv-grid">
              <SchedulerModalKvCondensed
                label="Appointment provider"
                value={providerLabel(appt.primaryProvider)}
              />
              <SchedulerModalKvCondensed label="Status" value={pickStr(appt.statusName)} />
              <SchedulerModalKvCondensed label="Confirm status" value={pickStr(appt.confirmStatusName)} />
              {etaLine ? (
                <SchedulerModalKvCondensed label="ETA/ETD" value={etaLine} />
              ) : null}
              {windowLine ? (
                <SchedulerModalKvCondensed label="Window" value={windowLine} />
              ) : null}
              <SchedulerModalKvCondensed label="Booked date" value={pickStr(appt.bookedDate ?? undefined)} />
              <SchedulerModalKvCondensed
                label="Description"
                fullWidth
                value={appt.description?.trim() || null}
              />
              {appt.description?.trim() ? (
                <hr className="scheduler-modal-kv-grid-divider" aria-hidden />
              ) : null}
              <SchedulerModalKvCondensed
                label="Instructions"
                fullWidth
                value={appt.instructions?.trim() || null}
              />
              <SchedulerModalKvCondensed label="Equipment" fullWidth value={appt.equipment?.trim() || null} />
              <SchedulerModalKvCondensed label="Medications" fullWidth value={appt.medications?.trim() || null} />
              <SchedulerModalKvCondensed
                label="Date created"
                value={formatAppointmentAuditDisplay(
                  pickStr(appt.created) ?? undefined,
                  appointmentCreatedByPerson(appt)
                )}
              />
              <SchedulerModalKvCondensed
                label="Date modified"
                value={formatAppointmentAuditDisplay(
                  appointmentModifiedAtIso(appt),
                  appointmentModifiedByPerson(appt)
                )}
              />
            </div>
          </section>

          {c ? (
            <section className="scheduler-modal-section">
              <h3 className="scheduler-modal-h3">Client</h3>
              <div className="scheduler-modal-kv-grid">
                <SchedulerModalKvCondensed label="Name" value={fullClientHouseholdName(c)} />
                <SchedulerModalKvCondensed label="Email" value={clientEmailsLine(c)} />
                <SchedulerModalKvCondensed label="Phone" value={clientPhonesLine(c)} />
                <SchedulerModalKvCondensed
                  label="Address"
                  fullWidth
                  value={
                    clientAddr ? (
                      <span className="scheduler-modal-multiline">{clientAddr}</span>
                    ) : null
                  }
                />
                <SchedulerModalKvCondensed label="County" value={pickStr(c.county)} />
                <SchedulerModalKvCondensed label="Username" value={pickStr(c.username)} />
              </div>
              {clientAlertsTrim ? (
                <div className="scheduler-modal-alerts-box" role="alert">
                  <span className="scheduler-modal-alerts-box-label">Client alerts</span>
                  {clientAlertsTrim}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function sundayWeekStart(d: DateTime): DateTime {
  const day = d.setZone(PRACTICE_TZ).startOf('day');
  const dow = day.weekday; // 1=Mon … 7=Sun
  const daysSinceSun = dow === 7 ? 0 : dow;
  return day.minus({ days: daysSinceSun });
}

function wallMinutes(iso: string): number {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(PRACTICE_TZ);
  if (!dt.isValid) return 0;
  return dt.hour * 60 + dt.minute + dt.second / 60;
}

/** Pixels from grid top for depot HH:mm line; matches My Week `depotTimeToPx` + half-line vertical centering. */
const SCHEDULER_DEPOT_LINE_PX = 5;

function schedulerDepotLineTopPx(
  gridStartMin: number,
  totalMin: number,
  timeStr: string | null | undefined
): number | null {
  const s = typeof timeStr === 'string' ? timeStr.trim() : '';
  if (!s) return null;
  const m = timeStrToMinutesFromMidnight(s);
  const fromStart = m - gridStartMin;
  const clampedMin = Math.max(0, Math.min(totalMin, fromStart));
  return clampedMin * PPM - Math.floor(SCHEDULER_DEPOT_LINE_PX / 2);
}

/** Practice-local week column key for routing preview (`option.date` may omit TZ). */
function routingPreviewPracticeDateKey(
  opt: { date?: unknown; suggestedStartIso?: unknown } | null | undefined
): string | null {
  if (!opt) return null;
  const dateRaw =
    typeof opt.date === 'string'
      ? opt.date.trim()
      : opt.date != null
        ? String(opt.date).trim()
        : '';
  if (dateRaw) {
    const d = DateTime.fromISO(dateRaw.includes('T') ? dateRaw : `${dateRaw}T12:00:00`, {
      zone: PRACTICE_TZ,
    });
    if (d.isValid) return d.toISODate();
  }
  const startRaw =
    typeof opt.suggestedStartIso === 'string'
      ? opt.suggestedStartIso.trim()
      : opt.suggestedStartIso != null
        ? String(opt.suggestedStartIso).trim()
        : '';
  if (!startRaw) return null;
  const d = DateTime.fromISO(startRaw, { zone: 'utc' }).setZone(PRACTICE_TZ);
  return d.isValid ? d.toISODate() : null;
}

/** Timed routing preview participates in `assignColumnsForDay` so real visits reflow like overlap layout. */
function buildRoutingPreviewSyntheticAppointment(
  preview: RoutingCalendarPreviewPayloadV1,
  types: AppointmentType[]
): Appointment | null {
  const opt = preview.option;
  const startRaw = String(opt.suggestedStartIso ?? '').trim();
  if (!startRaw) return null;
  const startUtc = DateTime.fromISO(startRaw, { zone: 'utc' });
  if (!startUtc.isValid) return null;
  const mins = Math.max(1, Math.floor(preview.serviceMinutes) || 30);
  const startIso = startUtc.toUTC().toISO()!;
  const endIso = startUtc.plus({ minutes: mins }).toUTC().toISO()!;
  const appointmentType = types.find((t) => t.id === preview.appointmentTypeId);
  const label =
    preview.clientDisplayLabel?.trim() ||
    (typeof (opt as { clientName?: string }).clientName === 'string'
      ? (opt as { clientName?: string }).clientName
      : null) ||
    'Proposed visit';
  const zOpt = opt as {
    clientZone?: Appointment['clientZone'];
    effectiveZone?: Appointment['effectiveZone'];
  };
  return {
    id: SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID,
    isActive: true,
    isDeleted: false,
    isComplete: false,
    allDay: false,
    appointmentStart: startIso,
    appointmentEnd: endIso,
    appointmentType,
    description: label,
    pimsId: null,
    confirmStatusName: null,
    statusName: null,
    ...(zOpt.clientZone != null ? { clientZone: zOpt.clientZone } : {}),
    ...(zOpt.effectiveZone != null ? { effectiveZone: zOpt.effectiveZone } : {}),
  };
}

/**
 * All-day span in practice TZ: half-open [start, end) by local start-of-day — `appointmentEnd` at
 * local midnight is the first day NOT included (e.g. Apr 20 … Apr 28 end → Apr 20–27).
 */
function allDayLocalStartEndExclusive(a: Appointment): {
  start: DateTime;
  endExclusive: DateTime;
} | null {
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ).startOf('day');
  const endExclusive = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ).startOf('day');
  if (!start.isValid) return null;
  return { start, endExclusive };
}

function allDayRangeContainsLocalDate(a: Appointment, dateIso: string): boolean {
  const bounds = allDayLocalStartEndExclusive(a);
  if (!bounds) return false;
  const { start, endExclusive } = bounds;
  const d = DateTime.fromISO(dateIso, { zone: PRACTICE_TZ }).startOf('day');
  if (!d.isValid) return false;
  if (!endExclusive.isValid || endExclusive <= start) return d.equals(start);
  return d >= start && d < endExclusive;
}

function appointmentCoversPracticeLocalDate(a: Appointment, dateIso: string): boolean {
  if (a.allDay) return allDayRangeContainsLocalDate(a, dateIso);
  return dayKeyFromIso(a.appointmentStart) === dateIso;
}

function dayKeysForAllDayRange(a: Appointment): string[] {
  const bounds = allDayLocalStartEndExclusive(a);
  if (!bounds) return [];
  const { start, endExclusive } = bounds;
  if (!endExclusive.isValid || endExclusive <= start) {
    return [start.toISODate()!];
  }
  const keys: string[] = [];
  for (let d = start; d < endExclusive; d = d.plus({ days: 1 })) {
    keys.push(d.toISODate()!);
  }
  return keys;
}

type ViewMode = 'month' | 'week' | 'day';

type PlacedAppt = {
  appt: Appointment;
  col: number;
  colCount: number;
};

function assignColumns(
  appointments: Appointment[],
  displayRange: (a: Appointment) => { startIso: string; endIso: string }
): PlacedAppt[] {
  const sorted = [...appointments].sort(
    (a, b) =>
      new Date(displayRange(a).startIso).getTime() - new Date(displayRange(b).startIso).getTime()
  );
  const colEnds: number[] = [];
  const placed: PlacedAppt[] = [];
  for (const appt of sorted) {
    const { startIso, endIso } = displayRange(appt);
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end);
    } else {
      colEnds[col] = Math.max(colEnds[col], end);
    }
    placed.push({ appt, col, colCount: 0 });
  }
  const n = Math.max(colEnds.length, 1);
  for (const p of placed) p.colCount = n;
  return placed;
}

function intervalsOverlapMs(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

/** Split into connected overlap groups so non-overlapping visits each get full column width. */
function buildOverlapComponents(
  appointments: Appointment[],
  displayRange: (a: Appointment) => { startIso: string; endIso: string }
): Appointment[][] {
  if (appointments.length === 0) return [];
  const items = appointments.map((appt) => {
    const { startIso, endIso } = displayRange(appt);
    return {
      appt,
      start: new Date(startIso).getTime(),
      end: new Date(endIso).getTime(),
    };
  });
  const n = items.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (intervalsOverlapMs(items[i], items[j])) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const visited = new Array(n).fill(false);
  const components: Appointment[][] = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const stack = [i];
    visited[i] = true;
    const comp: Appointment[] = [];
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(items[u].appt);
      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = true;
          stack.push(v);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

function assignColumnsForDay(
  appointments: Appointment[],
  displayRange: (a: Appointment) => { startIso: string; endIso: string }
): PlacedAppt[] {
  const components = buildOverlapComponents(appointments, displayRange);
  const out: PlacedAppt[] = [];
  for (const comp of components) {
    out.push(...assignColumns(comp, displayRange));
  }
  return out;
}

function isAppointmentVisible(a: Appointment): boolean {
  if (a.isDeleted) return false;
  if (a.isActive === false) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return true;
}

export default function Scheduler({ embedInRoutingWorkspace = false }: SchedulerProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<ViewMode>('week');
  const [anchorDate, setAnchorDate] = useState(() =>
    DateTime.now().setZone(PRACTICE_TZ).toISODate()
  );
  const [providerFilter, setProviderFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoadState, setProvidersLoadState] = useState<'pending' | 'resolved'>('pending');
  const [typeList, setTypeList] = useState<AppointmentType[]>([]);
  const [rawAppointments, setRawAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  /** After the first in-flight range fetch, keep the calendar mounted so outlet scroll is not reset on prev/next week. */
  const appointmentRangeBlockingLoadDone = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const [modalAppt, setModalAppt] = useState<Appointment | null>(null);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [contextMenu, setContextMenu] = useState<{ appt: Appointment; x: number; y: number } | null>(
    null
  );
  /** null = not applicable or loading; true = at least one pet can be added; false = none left */
  const [addAnotherPetMenuReady, setAddAnotherPetMenuReady] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** YYYY-MM-DD of the day column while its My Day — Visual PDF is generating. */
  const [practicePdfExportingKey, setPracticePdfExportingKey] = useState<string | null>(null);
  /** When true and a single provider is selected, timed events use ETA/ETD from /appointments/doctor + /routing/eta (same as My Week). */
  const [showByDriveTime, setShowByDriveTime] = useState(true);
  const [driveIsoByApptId, setDriveIsoByApptId] = useState<Map<string, DriveIsoPair> | null>(null);
  const [driveDayByDate, setDriveDayByDate] = useState<Map<string, DayData> | null>(null);
  const [driveEtaLoading, setDriveEtaLoading] = useState(false);
  /** From GET /appointments/doctor — range payload often omits `isMember` / `membershipName`. */
  const [doctorDayMembershipByApptId, setDoctorDayMembershipByApptId] = useState<
    Map<string, SchedulerDoctorDayMembership>
  >(() => new Map());
  /** From GET /appointments/doctor — range payload often omits `clientZone` / `effectiveZone`. */
  const [doctorDayZonesByApptId, setDoctorDayZonesByApptId] = useState<
    Map<string, SchedulerDoctorDayAppointmentZones>
  >(() => new Map());
  const [doctorDayPatientPcpByApptId, setDoctorDayPatientPcpByApptId] = useState<
    Map<string, DoctorDayPatientPrimaryProvider | null>
  >(() => new Map());
  /** Bump after mutations that change route order so drive/ETA refetches (avoids tying drive load to every `rawAppointments` refresh). */
  const [driveRefreshNonce, setDriveRefreshNonce] = useState(0);
  const [bookSlot, setBookSlot] = useState<SchedulerBookSlot | null>(null);
  const [bookPrefill, setBookPrefill] = useState<SchedulerBookPrefill | null>(null);
  /** Routing → My Week: proposed slot until booked or dismissed. */
  const [routingPreview, setRoutingPreview] = useState<RoutingCalendarPreviewPayloadV1 | null>(null);
  const [hover, setHover] = useState<{
    appt: Appointment;
    x: number;
    y: number;
    el: HTMLElement | null;
  } | null>(null);

  const [driveHoverCard, setDriveHoverCard] = useState<{
    segmentKey: string;
    x: number;
    y: number;
    heading: string;
    body: string;
    extraLine?: string | null;
  } | null>(null);

  const hoverRevealTimerRef = useRef<number | null>(null);
  const hoverRevealPendingRef = useRef<{
    appt: Appointment;
    el: HTMLElement;
    x: number;
    y: number;
  } | null>(null);

  const cancelScheduledHoverPopover = useCallback(() => {
    if (hoverRevealTimerRef.current != null) {
      clearTimeout(hoverRevealTimerRef.current);
      hoverRevealTimerRef.current = null;
    }
    hoverRevealPendingRef.current = null;
  }, []);

  const armHoverPopover = useCallback(
    (appt: Appointment, ev: MouseEvent<HTMLElement>) => {
      cancelScheduledHoverPopover();
      const el = ev.currentTarget;
      hoverRevealPendingRef.current = {
        appt,
        el,
        x: ev.clientX,
        y: ev.clientY,
      };
      hoverRevealTimerRef.current = window.setTimeout(() => {
        hoverRevealTimerRef.current = null;
        const pending = hoverRevealPendingRef.current;
        hoverRevealPendingRef.current = null;
        if (!pending) return;
        setHover({
          appt: pending.appt,
          x: pending.x,
          y: pending.y,
          el: pending.el,
        });
      }, SCHEDULER_HOVER_POPOVER_DELAY_MS);
    },
    [cancelScheduledHoverPopover]
  );

  const trackHoverPopoverMove = useCallback((appt: Appointment, ev: MouseEvent<HTMLElement>) => {
    const p = hoverRevealPendingRef.current;
    if (p && p.appt.id === appt.id) {
      p.x = ev.clientX;
      p.y = ev.clientY;
      p.el = ev.currentTarget;
      return;
    }
    setHover((prev) =>
      prev && prev.appt.id === appt.id
        ? { ...prev, x: ev.clientX, y: ev.clientY, el: ev.currentTarget }
        : prev
    );
  }, []);

  const endHoverPopoverForAppt = useCallback(
    (apptId: string | number) => {
      cancelScheduledHoverPopover();
      setHover((prev) => (prev?.appt.id === apptId ? null : prev));
    },
    [cancelScheduledHoverPopover]
  );

  useEffect(() => () => cancelScheduledHoverPopover(), [cancelScheduledHoverPopover]);

  /** Practice-local "now" for the current-time indicator on the grid (updates on an interval). */
  const [practiceClock, setPracticeClock] = useState(() => DateTime.now().setZone(PRACTICE_TZ));

  const { doctorId: authDoctorId, role } = useAuth() as { doctorId: string | null; role?: string | string[] };

  const rolesLower = useMemo(() => {
    const arr = Array.isArray(role) ? role : role != null ? [role] : [];
    return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  }, [role]);
  const canManualBookOnCalendar = useMemo(
    () => rolesLower.includes('admin') || rolesLower.includes('superadmin'),
    [rolesLower]
  );
  const showEmployeeAddCoVisitPet = useMemo(
    () =>
      rolesLower.includes('employee') ||
      rolesLower.includes('admin') ||
      rolesLower.includes('superadmin'),
    [rolesLower]
  );

  useEffect(() => {
    if (!contextMenu) {
      setAddAnotherPetMenuReady(null);
      return;
    }
    const appt = contextMenu.appt;
    if (!showEmployeeAddCoVisitPet || !appointmentSupportsEmployeeCoVisitPet(appt)) {
      setAddAnotherPetMenuReady(null);
      return;
    }
    const clientId = appt.client!.id;
    let cancelled = false;
    setAddAnotherPetMenuReady(null);
    (async () => {
      try {
        const payload = await fetchClientByIdStaff(String(clientId));
        if (cancelled) return;
        const pets = extractPatientsFromClientPayload(payload);
        const exclude = new Set(
          patientIdsBookedForClientAtOverlap(
            String(clientId),
            appt.appointmentStart,
            appt.appointmentEnd,
            rawAppointments
          )
        );
        const hasAvailable = pets.some((p) => !exclude.has(String(p.id)));
        setAddAnotherPetMenuReady(hasAvailable);
      } catch {
        if (!cancelled) setAddAnotherPetMenuReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contextMenu, showEmployeeAddCoVisitPet, rawAppointments]);

  const applyRoutingCalendarPreviewFromStorage = useCallback(() => {
    const p = readRoutingCalendarPreview();
    if (!p?.option?.suggestedStartIso || !p.option.doctorPimsId || !p.option.date) {
      clearRoutingCalendarPreview();
      setRoutingPreview(null);
      return;
    }
    setRoutingPreview(p);
    setProviderFilter(String(p.option.doctorPimsId));
    setAnchorDate(String(p.option.date));
    setView('week');
    setShowByDriveTime(true);
  }, []);

  useEffect(() => {
    if (searchParams.get('routingPreview') !== '1') return;
    applyRoutingCalendarPreviewFromStorage();
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, applyRoutingCalendarPreviewFromStorage]);

  useEffect(() => {
    if (!embedInRoutingWorkspace) return;
    const onPreview = () => {
      applyRoutingCalendarPreviewFromStorage();
    };
    window.addEventListener(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT, onPreview);
    return () => window.removeEventListener(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT, onPreview);
  }, [embedInRoutingWorkspace, applyRoutingCalendarPreviewFromStorage]);

  /** Routing preview only supports week/day — leave month if preview opens while on month. */
  useEffect(() => {
    if (routingPreview && view === 'month') setView('week');
  }, [routingPreview, view]);

  /** My Day → Practice calendar: `?fromMyDay=1&date=YYYY-MM-DD&provider=<id>` (provider optional). */
  useEffect(() => {
    if (searchParams.get('fromMyDay') !== '1') return;
    const dateQ = searchParams.get('date');
    const providerQ = (searchParams.get('provider') ?? '').trim();
    const d =
      dateQ && DateTime.fromISO(dateQ, { zone: PRACTICE_TZ }).isValid
        ? DateTime.fromISO(dateQ, { zone: PRACTICE_TZ }).toISODate()!
        : null;
    if (d) setAnchorDate(d);
    if (providersLoadState !== 'resolved') return;

    const next = new URLSearchParams(searchParams);
    next.delete('fromMyDay');
    next.delete('date');
    next.delete('provider');
    setSearchParams(next, { replace: true });

    if (providerQ && providers.some((p) => String(p.id) === providerQ)) {
      setProviderFilter(providerQ);
    }
  }, [searchParams, providers, providersLoadState, setSearchParams]);

  /** Calendar always scopes to one primary provider — never "(Show all)". */
  useLayoutEffect(() => {
    if (providers.length === 0) return;
    setProviderFilter((current) => {
      const t = current.trim();
      if (t && providers.some((p) => String(p.id) === t)) return current;
      if (routingPreview && t) return current;
      const raw = authDoctorId?.trim();
      if (raw && providers.some((p) => String(p.id) === String(raw))) return String(raw);
      return String(providers[0].id);
    });
  }, [providers, authDoctorId, routingPreview]);

  /** Stable provider id for range + drive APIs so we do not double-fetch when `providerFilter` syncs from "" to the same doctor. */
  const resolvedPrimaryProviderId = useMemo(() => {
    if (providers.length === 0) return '';
    const t = providerFilter.trim();
    if (t && providers.some((p) => String(p.id) === t)) return t;
    if (routingPreview && t) return t;
    const raw = authDoctorId?.trim();
    if (raw && providers.some((p) => String(p.id) === String(raw))) return String(raw);
    return String(providers[0].id);
  }, [providers, providerFilter, authDoctorId, routingPreview]);

  /** Match routing preview doctor to provider list (internal id or PIMS); fall back to employee APIs. */
  useEffect(() => {
    if (!routingPreview?.option) return;
    const raw = String(routingPreview.option.doctorPimsId ?? '').trim();
    if (!raw || providers.length === 0) return;

    if (providers.some((p) => String(p.id) === raw)) {
      setProviderFilter((f) => (f === raw ? f : raw));
      return;
    }
    const byPims = providers.find((p) => p.pimsId != null && String(p.pimsId) === raw);
    if (byPims) {
      const resolved = String(byPims.id);
      setProviderFilter((f) => (f === resolved ? f : resolved));
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        let emp: unknown;
        try {
          const { data } = await http.get(`/employees/pims/${encodeURIComponent(raw)}`);
          emp = Array.isArray(data) ? data[0] : data;
        } catch {
          const { data } = await http.get(`/employees/${encodeURIComponent(raw)}`);
          emp = Array.isArray(data) ? data[0] : data;
        }
        if (cancelled || !emp || typeof emp !== 'object') return;
        const e = emp as Record<string, unknown>;
        const internal =
          (e.id != null ? String(e.id) : undefined) ??
          (e.employee && typeof e.employee === 'object' && (e.employee as { id?: unknown }).id != null
            ? String((e.employee as { id?: unknown }).id)
            : undefined);
        const empRec = e.employee && typeof e.employee === 'object' ? (e.employee as Record<string, unknown>) : null;
        const pimsStr =
          e.pimsId != null
            ? String(e.pimsId)
            : empRec?.pimsId != null
              ? String(empRec.pimsId)
              : undefined;
        if (cancelled) return;
        const match =
          internal && providers.some((p) => String(p.id) === internal)
            ? providers.find((p) => String(p.id) === internal)
            : pimsStr
              ? providers.find((p) => p.pimsId != null && String(p.pimsId) === pimsStr)
              : undefined;
        if (match) {
          const resolved = String(match.id);
          setProviderFilter((f) => (f === resolved ? f : resolved));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routingPreview, providers]);

  useEffect(() => {
    const tick = () => setPracticeClock(DateTime.now().setZone(PRACTICE_TZ));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const typeFillMap = useMemo(() => buildTypeFillMap(typeList), [typeList]);

  const rangeUtc = useMemo(() => {
    const anchor = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }).startOf('day');
    let startL: DateTime;
    let endL: DateTime;
    if (view === 'day') {
      startL = anchor;
      endL = anchor.plus({ days: 1 });
    } else if (view === 'week') {
      startL = sundayWeekStart(anchor);
      endL = startL.plus({ days: 7 });
    } else {
      startL = anchor.startOf('month');
      endL = startL.plus({ months: 1 });
    }
    return {
      startUtc: startL.toUTC().toISO()!,
      endUtc: endL.toUTC().toISO()!,
      startLocal: startL,
      endLocalExclusive: endL,
    };
  }, [anchorDate, view]);

  const weekDays = useMemo(() => {
    const start = sundayWeekStart(DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }));
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  }, [anchorDate]);

  const dayColumnDates = useMemo(() => {
    if (view === 'month') return [];
    if (view === 'day') {
      return [DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }).startOf('day')];
    }
    return weekDays;
  }, [view, anchorDate, weekDays]);

  const driveFetchKey = useMemo(
    () => dayColumnDates.map((d) => d.toISODate()).join(','),
    [dayColumnDates]
  );

  const routingPreviewColumnKey = useMemo(
    () => routingPreviewPracticeDateKey(routingPreview?.option ?? null),
    [routingPreview]
  );

  const routingPreviewFocusDim = useMemo(
    () => Boolean(routingPreview && routingPreviewColumnKey),
    [routingPreview, routingPreviewColumnKey]
  );

  const rangeTitle = useMemo(() => {
    if (view === 'day') {
      const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
      return d.toFormat('MMMM d, yyyy');
    }
    if (view === 'month') {
      const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
      return d.toFormat('MMMM yyyy');
    }
    const a = weekDays[0];
    const b = weekDays[6];
    return `${a.toFormat('MMMM d, yyyy')} – ${b.toFormat('MMMM d, yyyy')}`;
  }, [view, anchorDate, weekDays]);

  useEffect(() => {
    let on = true;
    Promise.all([fetchPrimaryProviders(), fetchAllAppointmentTypes(PRACTICE_ID)])
      .then(([providerRows, typeRows]) => {
        if (!on) return;
        setProviders(Array.isArray(providerRows) ? providerRows : []);
        const types = Array.isArray(typeRows)
          ? typeRows.filter((t) => t.isActive !== false && !t.isDeleted)
          : [];
        setTypeList(types);
      })
      .catch(() => {
        if (!on) return;
        setProviders([]);
        setTypeList([]);
      })
      .finally(() => {
        if (on) setProvidersLoadState('resolved');
      });
    return () => {
      on = false;
    };
  }, []);

  const loadRange = useCallback(
    async (opts?: { refreshDrive?: boolean }) => {
      if (providers.length === 0) {
        setRawAppointments([]);
        if (providersLoadState === 'resolved') setLoading(false);
        return;
      }
      const primaryId = resolvedPrimaryProviderId.trim() || String(providers[0].id);
      if (!appointmentRangeBlockingLoadDone.current) {
        setLoading(true);
      }
      setError(null);
      try {
        const rows = await fetchAppointmentsRange({
          practiceId: PRACTICE_ID,
          start: rangeUtc.startUtc,
          end: rangeUtc.endUtc,
          primaryProviderId: primaryId,
        });
        if (!Array.isArray(rows)) {
          setRawAppointments([]);
          return;
        }
        setRawAppointments(rows);
        if (opts?.refreshDrive) setDriveRefreshNonce((n) => n + 1);
      } catch (e: unknown) {
        const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : 'Failed to load';
        setError(msg);
        setRawAppointments([]);
      } finally {
        appointmentRangeBlockingLoadDone.current = true;
        setLoading(false);
      }
    },
    [rangeUtc.startUtc, rangeUtc.endUtc, resolvedPrimaryProviderId, providers, providersLoadState]
  );

  useEffect(() => {
    loadRange();
  }, [loadRange]);

  useEffect(() => {
    const docId = resolvedPrimaryProviderId.trim();
    const loadDoctorDaySidecar = Boolean(docId) && (view === 'week' || view === 'day');
    if (!loadDoctorDaySidecar) {
      setDriveIsoByApptId(null);
      setDriveDayByDate(null);
      setDoctorDayMembershipByApptId(new Map());
      setDoctorDayZonesByApptId(new Map());
      setDoctorDayPatientPcpByApptId(new Map());
      setDriveEtaLoading(false);
      return;
    }
    const dates = driveFetchKey.split(',').filter(Boolean);
    if (dates.length === 0) {
      setDriveIsoByApptId(null);
      setDriveDayByDate(null);
      setDoctorDayMembershipByApptId(new Map());
      setDoctorDayZonesByApptId(new Map());
      setDoctorDayPatientPcpByApptId(new Map());
      setDriveEtaLoading(false);
      return;
    }

    const canDrive = showByDriveTime;

    let cancelled = false;
    let pending = dates.length;
    let firstDataLanded = false;

    setDoctorDayMembershipByApptId(new Map());
    setDoctorDayZonesByApptId(new Map());
    setDoctorDayPatientPcpByApptId(new Map());
    if (canDrive) {
      setDriveIsoByApptId(new Map());
      setDriveDayByDate(new Map());
      setDriveEtaLoading(true);
    } else {
      setDriveIsoByApptId(null);
      setDriveDayByDate(null);
      setDriveEtaLoading(false);
    }

    const markFirstData = () => {
      if (cancelled || firstDataLanded) return;
      firstDataLanded = true;
      setDriveEtaLoading(false);
    };

    const bumpDone = () => {
      if (cancelled) return;
      pending -= 1;
      if (pending <= 0 && !firstDataLanded) {
        setDriveEtaLoading(false);
      }
    };

    const driveRoutingOpts =
      routingPreview && routingPreviewColumnKey
        ? { routingPreview, previewPracticeDateKey: routingPreviewColumnKey }
        : null;

    for (const date of dates) {
      void (async () => {
        try {
          const { bundle: dayIn, membershipByApptId, zonesByApptId, patientPrimaryProviderByApptId } =
            await fetchSchedulerDoctorDayBundle(date, docId, driveRoutingOpts);
          if (cancelled) return;
          setDoctorDayMembershipByApptId((prev) => {
            const m = new Map(prev);
            for (const [k, v] of membershipByApptId) {
              m.set(k, v);
            }
            return m;
          });
          setDoctorDayZonesByApptId((prev) => {
            const m = new Map(prev);
            for (const [k, v] of zonesByApptId) {
              m.set(k, v);
            }
            return m;
          });
          setDoctorDayPatientPcpByApptId((prev) => {
            const m = new Map(prev);
            for (const [k, v] of patientPrimaryProviderByApptId) {
              m.set(k, v);
            }
            return m;
          });

          if (!canDrive || !dayIn) {
            return;
          }

          const interim = schedulerDriveScheduleOnlyFromBundle(dayIn);
          setDriveDayByDate((prev) => new Map(prev).set(interim.date, interim.dayData));
          setDriveIsoByApptId((prev) => {
            const m = new Map(prev);
            for (const [k, v] of interim.isoPairs) {
              m.set(k, v);
            }
            return m;
          });
          markFirstData();

          const r = await fetchSchedulerDriveEtasForDayBundle(dayIn, docId, driveRoutingOpts);
          if (cancelled) return;
          setDriveDayByDate((prev) => new Map(prev).set(r.date, r.dayData));
          setDriveIsoByApptId((prev) => {
            const m = new Map(prev);
            for (const [k, v] of r.isoPairs) {
              m.set(k, v);
            }
            return m;
          });
        } catch {
          /* skip day — other dates may still succeed */
        } finally {
          bumpDone();
        }
      })();
    }

    return () => {
      cancelled = true;
      setDriveEtaLoading(false);
    };
  }, [driveFetchKey, resolvedPrimaryProviderId, showByDriveTime, view, driveRefreshNonce, routingPreview, routingPreviewColumnKey]);

  const filteredAppointments = useMemo(() => {
    const filtered = rawAppointments.filter((a) => {
      if (!isAppointmentVisible(a)) return false;
      if (typeFilter) {
        const id = String(a.appointmentType?.id ?? '');
        if (id !== typeFilter) return false;
      }
      return true;
    });
    if (
      doctorDayMembershipByApptId.size === 0 &&
      doctorDayZonesByApptId.size === 0 &&
      doctorDayPatientPcpByApptId.size === 0
    ) {
      return filtered;
    }
    return filtered.map((a) => {
      let next: Appointment = a;
      const doc = doctorDayMembershipByApptId.get(String(a.id));
      if (doc) {
        const isMember = Boolean(a.isMember || doc.isMember);
        const nameFromAppt = pickStr(a.membershipName);
        const membershipName = nameFromAppt ?? doc.membershipName;
        if (isMember || membershipName || a.isMember || pickStr(a.membershipName)) {
          next = { ...next, isMember, membershipName: membershipName ?? null };
        }
      }
      const z = doctorDayZonesByApptId.get(String(a.id));
      if (z && (z.clientZone != null || z.effectiveZone != null)) {
        next = {
          ...next,
          clientZone: z.clientZone ?? next.clientZone,
          effectiveZone: z.effectiveZone ?? next.effectiveZone,
        };
      }
      if (doctorDayPatientPcpByApptId.has(String(a.id))) {
        next = {
          ...next,
          patientPrimaryProvider: doctorDayPatientPcpByApptId.get(String(a.id)) ?? null,
        };
      }
      return next;
    });
  }, [rawAppointments, typeFilter, doctorDayMembershipByApptId, doctorDayZonesByApptId, doctorDayPatientPcpByApptId]);

  const displayRangeForAppt = useMemo(() => {
    return (a: Appointment) => {
      if (showByDriveTime && resolvedPrimaryProviderId.trim() && driveIsoByApptId?.has(String(a.id))) {
        const p = driveIsoByApptId.get(String(a.id))!;
        return { startIso: p.startIso, endIso: p.endIso };
      }
      return { startIso: a.appointmentStart, endIso: a.appointmentEnd };
    };
  }, [showByDriveTime, resolvedPrimaryProviderId, driveIsoByApptId]);

  const gridBounds = useMemo(() => {
    const buf = SCHEDULER_GRID_EDGE_BUFFER_MIN;

    let earliestApptMin: number | null = null;
    let latestApptMin: number | null = null;
    for (const a of filteredAppointments) {
      if (a.allDay) continue;
      const { startIso, endIso } = displayRangeForAppt(a);
      const sm = wallMinutes(startIso);
      const em = wallMinutes(endIso);
      earliestApptMin = earliestApptMin === null ? sm : Math.min(earliestApptMin, sm);
      latestApptMin = latestApptMin === null ? em : Math.max(latestApptMin, em);
    }

    if (routingPreview?.option?.suggestedStartIso) {
      const previewKey = routingPreviewPracticeDateKey(routingPreview.option);
      const syn =
        previewKey && dayColumnDates.some((d) => d.toISODate() === previewKey)
          ? buildRoutingPreviewSyntheticAppointment(routingPreview, typeList)
          : null;
      if (syn) {
        const sm = wallMinutes(syn.appointmentStart);
        const em = wallMinutes(syn.appointmentEnd);
        earliestApptMin = earliestApptMin === null ? sm : Math.min(earliestApptMin, sm);
        latestApptMin = latestApptMin === null ? em : Math.max(latestApptMin, em);
      }
    }

    const fromAppts =
      earliestApptMin !== null
        ? Math.max(0, Math.floor(earliestApptMin / SLOT_MINUTES) * SLOT_MINUTES - buf)
        : null;
    const toAppts =
      latestApptMin !== null
        ? Math.min(24 * 60, Math.ceil(latestApptMin / SLOT_MINUTES) * SLOT_MINUTES + buf)
        : null;

    let fromDepot: number | null = null;
    let toDepot: number | null = null;
    if (showByDriveTime && driveDayByDate && resolvedPrimaryProviderId.trim()) {
      for (const dayDt of dayColumnDates) {
        const key = dayDt.toISODate()!;
        const row = driveDayByDate.get(key);
        const sdt = row?.startDepotTime?.trim();
        if (sdt) {
          const depotMin = timeStrToMinutesFromMidnight(sdt);
          const candidate = Math.max(0, Math.floor(depotMin / SLOT_MINUTES) * SLOT_MINUTES - buf);
          fromDepot = fromDepot === null ? candidate : Math.min(fromDepot, candidate);
        }
        const edt = row?.endDepotTime?.trim();
        if (edt) {
          const depotEndMin = timeStrToMinutesFromMidnight(edt);
          const candidate = Math.min(
            24 * 60,
            Math.ceil(depotEndMin / SLOT_MINUTES) * SLOT_MINUTES + buf
          );
          toDepot = toDepot === null ? candidate : Math.max(toDepot, candidate);
        }
      }
    }

    const startCandidates: number[] = [];
    if (fromAppts !== null) startCandidates.push(fromAppts);
    if (fromDepot !== null) startCandidates.push(fromDepot);
    let start =
      startCandidates.length > 0
        ? Math.min(...startCandidates)
        : Math.max(0, DEFAULT_GRID_START - SLOT_MINUTES);
    start = Math.max(0, Math.floor(start / SLOT_MINUTES) * SLOT_MINUTES);

    const endCandidates: number[] = [DEFAULT_GRID_END];
    if (toAppts !== null) endCandidates.push(toAppts);
    if (toDepot !== null) endCandidates.push(toDepot);
    let end = Math.min(24 * 60, Math.max(...endCandidates));
    end = Math.min(24 * 60, Math.ceil(end / SLOT_MINUTES) * SLOT_MINUTES);
    if (end <= start) end = start + 60;
    return { gridStartMin: start, gridEndMin: end, totalMin: end - start };
  }, [
    filteredAppointments,
    displayRangeForAppt,
    showByDriveTime,
    driveDayByDate,
    resolvedPrimaryProviderId,
    dayColumnDates,
    routingPreview,
    typeList,
  ]);

  const gridHeightPx = gridBounds.totalMin * PPM;

  const weekGridMetrics: WeekGridMetrics = useMemo(
    () => ({
      gridStartMinutesFromMidnight: gridBounds.gridStartMin,
      totalMinutes: gridBounds.totalMin,
    }),
    [gridBounds.gridStartMin, gridBounds.totalMin]
  );

  const timeLabels = useMemo(() => {
    const out: { min: number; label: string; major: boolean }[] = [];
    for (let m = gridBounds.gridStartMin; m < gridBounds.gridEndMin; m += SLOT_MINUTES) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      const dt = DateTime.fromObject({ hour: h, minute: mm }, { zone: PRACTICE_TZ });
      out.push({
        min: m,
        label: mm === 0 ? dt.toFormat('h:mm a') : '',
        major: mm === 0,
      });
    }
    return out;
  }, [gridBounds.gridStartMin, gridBounds.gridEndMin]);

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const d of dayColumnDates) {
      const key = d.toISODate()!;
      map.set(key, []);
    }
    for (const a of filteredAppointments) {
      if (a.allDay) {
        for (const key of dayKeysForAllDayRange(a)) {
          if (map.has(key)) map.get(key)!.push(a);
        }
      } else {
        const key = dayKeyFromIso(a.appointmentStart);
        if (key && map.has(key)) map.get(key)!.push(a);
      }
    }
    return map;
  }, [filteredAppointments, dayColumnDates]);

  /**
   * Week view: days with no appointments (and no routing preview on that day) use half the
   * horizontal flex weight of days that have appointments, so empty columns stay narrower.
   * All-day bar positions use the same weights so spanning bars align with headers/bodies.
   */
  const dayTimeColumnLayout = useMemo(() => {
    const n = dayColumnDates.length;
    const keys = dayColumnDates.map((d) => d.toISODate()!);
    if (n === 0) {
      return {
        flexStyleForIndex: (_i: number) => ({ flex: '1 1 0' as const, minWidth: 90 }),
        barLeftPct: (_s: number) => 0,
        barWidthPct: (_s: number, _e: number) => 0,
      };
    }
    if (view !== 'week') {
      return {
        flexStyleForIndex: (_i: number) => ({
          flex: '1 1 0' as const,
          minWidth: n === 1 ? 200 : 90,
        }),
        barLeftPct: (s: number) => (s / n) * 100,
        barWidthPct: (s: number, e: number) => ((e - s + 1) / n) * 100,
      };
    }
    const flexGrow = keys.map((k) => {
      const has = (appointmentsByDay.get(k) ?? []).length > 0;
      const hasPreview = Boolean(routingPreview && routingPreviewColumnKey === k);
      return has || hasPreview ? 2 : 1;
    });
    const total = flexGrow.reduce((a, b) => a + b, 0);
    const colWidthFrac = flexGrow.map((w) => w / total);
    const cumLeftFrac: number[] = [];
    let acc = 0;
    for (const frac of colWidthFrac) {
      cumLeftFrac.push(acc);
      acc += frac;
    }
    return {
      flexStyleForIndex: (i: number) => ({
        flex: `${flexGrow[i]} 1 0` as const,
        minWidth: flexGrow[i] >= 2 ? 90 : 48,
      }),
      barLeftPct: (s: number) => cumLeftFrac[s] * 100,
      barWidthPct: (s: number, e: number) =>
        colWidthFrac.slice(s, e + 1).reduce((a, b) => a + b, 0) * 100,
    };
  }, [dayColumnDates, view, appointmentsByDay, routingPreview, routingPreviewColumnKey]);

  /** Spanning all-day bars + lane stacking; visible strip height capped at 8 rows with internal scroll. */
  const allDaySpanLayout = useMemo(() => {
    const visibleDayIsos = dayColumnDates.map((d) => d.toISODate()!);
    const n = visibleDayIsos.length;
    if (n === 0) {
      return { bars: [] as Array<{ appt: Appointment; s: number; e: number; lane: number }>, visibleHeightPx: 28, contentHeightPx: 28 };
    }

    const segments: { appt: Appointment; s: number; e: number }[] = [];
    for (const a of filteredAppointments) {
      if (!a.allDay) continue;
      const keys = new Set(dayKeysForAllDayRange(a));
      let s = -1;
      let e = -1;
      for (let i = 0; i < n; i++) {
        if (!keys.has(visibleDayIsos[i])) continue;
        if (s < 0) s = i;
        e = i;
      }
      if (s < 0) continue;
      segments.push({ appt: a, s, e });
    }

    function intervalsOverlap(x: { s: number; e: number }, y: { s: number; e: number }) {
      return x.s <= y.e && y.s <= x.e;
    }

    segments.sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s));

    const lastOnLane: { s: number; e: number }[] = [];
    const bars: Array<{ appt: Appointment; s: number; e: number; lane: number }> = [];

    for (const seg of segments) {
      let lane = 0;
      for (; ; lane++) {
        if (lane === lastOnLane.length) {
          lastOnLane.push({ s: seg.s, e: seg.e });
          bars.push({ appt: seg.appt, s: seg.s, e: seg.e, lane });
          break;
        }
        const prev = lastOnLane[lane];
        if (!intervalsOverlap(prev, seg)) {
          lastOnLane[lane] = { s: seg.s, e: seg.e };
          bars.push({ appt: seg.appt, s: seg.s, e: seg.e, lane });
          break;
        }
      }
    }

    const laneCount = lastOnLane.length;
    const innerPad = SCHEDULER_ALL_DAY_PAD_Y;
    const contentHeightPx =
      segments.length === 0 ? 28 : innerPad + laneCount * SCHEDULER_ALL_DAY_ROW_PX;
    const maxContent =
      innerPad + SCHEDULER_ALL_DAY_MAX_VISIBLE_ROWS * SCHEDULER_ALL_DAY_ROW_PX;
    const visibleHeightPx = Math.min(Math.max(28, contentHeightPx), Math.max(28, maxContent));

    return { bars, visibleHeightPx, contentHeightPx };
  }, [filteredAppointments, dayColumnDates]);

  const monthCells = useMemo(() => {
    if (view !== 'month') return [];
    const monthStart = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }).startOf('month');
    const gridStart = sundayWeekStart(monthStart);
    const cells: { date: DateTime; inMonth: boolean; count: number }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = gridStart.plus({ days: i });
      const inMonth = d.month === monthStart.month;
      const key = d.toISODate()!;
      const count = filteredAppointments.filter((a) => appointmentCoversPracticeLocalDate(a, key)).length;
      cells.push({ date: d, inMonth, count });
    }
    return cells;
  }, [view, anchorDate, filteredAppointments]);

  const goPrev = () => {
    const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
    if (view === 'day') setAnchorDate(d.minus({ days: 1 }).toISODate()!);
    else if (view === 'week') setAnchorDate(d.minus({ weeks: 1 }).toISODate()!);
    else setAnchorDate(d.minus({ months: 1 }).toISODate()!);
  };

  const goNext = () => {
    const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
    if (view === 'day') setAnchorDate(d.plus({ days: 1 }).toISODate()!);
    else if (view === 'week') setAnchorDate(d.plus({ weeks: 1 }).toISODate()!);
    else setAnchorDate(d.plus({ months: 1 }).toISODate()!);
  };

  const goToday = () => {
    setAnchorDate(DateTime.now().setZone(PRACTICE_TZ).toISODate()!);
  };

  const onPickGoToDate = (iso: string) => {
    if (!iso) return;
    setAnchorDate(iso);
  };

  const hoverDriveHint = useMemo((): SchedulerHoverDriveHint | null => {
    if (!hover) return null;
    return buildSchedulerDriveHintForAppt(
      hover.appt,
      showByDriveTime,
      resolvedPrimaryProviderId,
      driveDayByDate
    );
  }, [hover, showByDriveTime, resolvedPrimaryProviderId, driveDayByDate]);

  const modalDriveHint = useMemo((): SchedulerHoverDriveHint | null => {
    if (!modalAppt) return null;
    return buildSchedulerDriveHintForAppt(
      modalAppt,
      showByDriveTime,
      resolvedPrimaryProviderId,
      driveDayByDate
    );
  }, [modalAppt, showByDriveTime, resolvedPrimaryProviderId, driveDayByDate]);

  const tooltipPos = useMemo(() => {
    if (!hover) return { left: 0, top: 0, width: 300, maxCardH: 0 };
    const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
    return computeHoverPopoverPosition({
      anchor: rectFromElement(hover.el),
      x: hover.x,
      y: hover.y,
      vwW,
      vwH,
      cardMaxW: 380,
      cardMinW: 280,
      padding: 8,
      offset: 8,
      cardEstH: Math.min(520, Math.max(400, Math.floor(vwH * 0.42))),
    });
  }, [hover]);

  const showTimeGrid = view === 'week' || view === 'day';

  /** Scroll to the proposed slot once per routing preview candidate (after grid paint). */
  const routingPreviewScrollSigRef = useRef<string>('');
  useLayoutEffect(() => {
    if (!routingPreview?.option?.suggestedStartIso) {
      routingPreviewScrollSigRef.current = '';
      return;
    }
    if (loading || !showTimeGrid) return;
    const opt = routingPreview.option;
    const sig = [
      String(opt.suggestedStartIso),
      String(opt.date ?? ''),
      String(opt.doctorPimsId ?? ''),
      routingPreviewColumnKey ?? '',
    ].join('|');
    if (routingPreviewScrollSigRef.current === sig) return;
    const el = document.querySelector('[data-routing-preview-slot="1"]');
    if (!(el instanceof HTMLElement)) return;
    routingPreviewScrollSigRef.current = sig;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' });
      });
    });
  }, [routingPreview, loading, showTimeGrid, routingPreviewColumnKey]);

  const practiceTodayIso = practiceClock.toISODate()!;
  const nowWallMinutes =
    practiceClock.hour * 60 + practiceClock.minute + practiceClock.second / 60;

  const handleDayBodyDoubleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>, dayDt: DateTime) => {
      if (!canManualBookOnCalendar) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const rawMin = gridBounds.gridStartMin + y / PPM;
      const snapped = Math.round(rawMin / SLOT_MINUTES) * SLOT_MINUTES;
      const clamped = Math.max(
        gridBounds.gridStartMin,
        Math.min(gridBounds.gridEndMin - SLOT_MINUTES, snapped)
      );
      const dayStart = dayDt.setZone(PRACTICE_TZ).startOf('day');
      const start = dayStart.plus({ minutes: clamped });
      const end = start.plus({ minutes: 30 });
      setBookPrefill(null);
      setBookSlot({ start, end });
    },
    [gridBounds.gridStartMin, gridBounds.gridEndMin, canManualBookOnCalendar]
  );

  const dismissRoutingPreview = useCallback(() => {
    clearRoutingCalendarPreview();
    setRoutingPreview(null);
    setBookSlot(null);
    setBookPrefill(null);
    if (!embedInRoutingWorkspace) {
      navigate('/schedule/routing');
    }
  }, [navigate, embedInRoutingWorkspace]);

  const exportPracticeDayMyDayPdf = useCallback(
    async (dayIso: string) => {
      const docId = resolvedPrimaryProviderId.trim();
      if (!docId) return;
      const day = driveDayByDate?.get(dayIso);
      if (!day?.households?.length) return;
      setPracticePdfExportingKey(dayIso);
      try {
        const doctorName = providers.find((p) => String(p.id) === docId)?.name ?? 'Provider';
        const tz = (day.timezone && day.timezone.trim()) || PRACTICE_TZ;
        const { stats, rows } = buildMyDayVisualPdfExportPayloadFromDayData({
          day,
          showByDriveTime,
          practiceTimeZone: tz,
          dateIso: dayIso,
        });
        const dateLabel = DateTime.fromISO(dayIso).toLocaleString(DateTime.DATE_MED);
        const safeName = doctorName.replace(/\s+/g, '_').replace(/[^\w.-]+/g, '');
        await exportMyDayVisualPdf({
          doctorName,
          dateLabel,
          showByDriveTime,
          practiceTimeZone: tz,
          stats,
          rows,
          filenameStem: `MyDay_Visual_${safeName}_${dayIso}`,
        });
      } catch (e) {
        console.error(e);
        setToast('Could not create PDF. Try again.');
      } finally {
        setPracticePdfExportingKey(null);
      }
    },
    [driveDayByDate, resolvedPrimaryProviderId, providers, showByDriveTime]
  );

  const openRoutingBookForm = useCallback(() => {
    if (!routingPreview) return;
    const clientIdRaw = routingPreview.newApptMeta?.clientId?.trim();
    if (!clientIdRaw) {
      setToast('Missing client for this routing preview.');
      return;
    }
    if (!Number.isFinite(Number(clientIdRaw))) {
      setToast('Invalid client on routing preview.');
      return;
    }
    const opt = routingPreview.option;
    const startUtc = DateTime.fromISO(String(opt.suggestedStartIso), { zone: 'utc' });
    if (!startUtc.isValid) {
      setToast('Invalid suggested start time.');
      return;
    }
    const mins = Math.max(1, Math.floor(routingPreview.serviceMinutes) || 30);
    const start = startUtc.setZone(PRACTICE_TZ);
    const end = start.plus({ minutes: mins });
    const isAdminOrSuper = rolesLower.includes('admin') || rolesLower.includes('superadmin');
    setBookPrefill({
      clientId: clientIdRaw,
      clientLabel: routingPreview.clientDisplayLabel,
      appointmentTypeId: routingPreview.appointmentTypeId,
      lockClient: !isAdminOrSuper,
      disableClientSearch: true,
      preserveDurationFromSlot: true,
      defaultDescription: `Routing — ${String(opt.doctorName ?? 'Doctor')} ${String(opt.date)}`,
    });
    setBookSlot({ start, end });
  }, [routingPreview, rolesLower]);

  const closeBookModal = useCallback(() => {
    setBookSlot(null);
    setBookPrefill(null);
  }, []);

  const handleSchedulerBooked = useCallback(() => {
    void loadRange({ refreshDrive: true });
    if (routingPreview) {
      clearRoutingPersistenceAfterSchedulerBook();
      clearRoutingCalendarPreview();
      setRoutingPreview(null);
    }
    setToast('Appointment saved to the schedule.');
  }, [loadRange, routingPreview]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  const handleAppointmentContextMenu = useCallback((e: MouseEvent<HTMLDivElement>, appt: Appointment) => {
    e.preventDefault();
    e.stopPropagation();
    cancelScheduledHoverPopover();
    setHover(null);
    setContextMenu({ appt, x: e.clientX, y: e.clientY });
  }, [cancelScheduledHoverPopover]);

  const handleAppointmentMenuAction = useCallback(
    async (action: SchedulerContextMenuAction, appt: Appointment) => {
      if (action.kind !== 'remove') setContextMenu(null);
      const patients = patientsForAppointment(appt);
      const client = appt.client;
      const firstPatient = patients[0];

      const fail = (msg: string) => showToast(msg);

      try {
        switch (action.kind) {
          case 'view':
            setModalAppt(appt);
            return;
          case 'edit':
            setEditAppt(appt);
            return;
          case 'addAnotherPet': {
            if (addAnotherPetMenuReady !== true) {
              fail('No additional pets available for this time.');
              return;
            }
            if (!appointmentSupportsEmployeeCoVisitPet(appt)) {
              fail('This appointment cannot add another pet here.');
              return;
            }
            const c = appt.client!;
            const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
            const end = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ);
            if (!start.isValid || !end.isValid) {
              fail('Invalid appointment time.');
              return;
            }
            const exclude = patientIdsBookedForClientAtOverlap(
              String(c.id),
              appt.appointmentStart,
              appt.appointmentEnd,
              rawAppointments
            );
            const provId = appt.primaryProvider?.id != null ? String(appt.primaryProvider.id) : '';
            const rawTypeId = appt.appointmentType?.id;
            const typeNum =
              rawTypeId != null && (typeof rawTypeId === 'number' || typeof rawTypeId === 'string')
                ? Number(rawTypeId)
                : NaN;
            const fn = pickStr(c.firstName) ?? '';
            const ln = pickStr(c.lastName) ?? '';
            const clientLabel = [fn, ln].filter(Boolean).join(' ').trim() || undefined;
            setBookPrefill({
              clientId: String(c.id),
              clientLabel,
              appointmentTypeId: Number.isFinite(typeNum) ? typeNum : undefined,
              lockClient: true,
              lockProvider: true,
              lockSlotTimes: true,
              preserveDurationFromSlot: true,
              coVisitAddPet: true,
              providerId: provId || undefined,
              excludePatientIds: exclude,
              modalTitle: 'Add another pet to this visit',
              defaultDescription: '',
            });
            setBookSlot({ start, end });
            return;
          }
          case 'complete':
            await patchAppointment(appt.id, { isComplete: true });
            await loadRange({ refreshDrive: true });
            return;
          case 'remove':
            if (!window.confirm('Remove this appointment?')) return;
            setContextMenu(null);
            await deleteAppointment(appt.id);
            await loadRange({ refreshDrive: true });
            return;
          case 'setStatus':
            await patchAppointment(appt.id, { statusName: action.value });
            await loadRange();
            return;
          case 'setConfirm':
            await patchAppointment(appt.id, { confirmStatusName: action.value });
            await loadRange();
            return;
          case 'googleMaps': {
            const url = googleMapsUrlForAppointment(appt);
            if (!url) {
              fail('No address or coordinates for this client.');
              return;
            }
            window.open(url, '_blank', 'noopener,noreferrer');
            return;
          }
          case 'sendForm': {
            const patientIds = patients
              .map((p) => p.id)
              .filter((id) => id != null)
              .map((id) => Number(id))
              .filter((n) => Number.isFinite(n));
            const body: {
              practice: { id: number };
              appointments: { id: number }[];
              patients?: { id: number }[];
            } = {
              practice: { id: PRACTICE_ID },
              appointments: [{ id: Number(appt.id) }],
            };
            if (patientIds.length) body.patients = patientIds.map((id) => ({ id }));
            const created = await createRoomLoaders(body);
            const rows = Array.isArray(created) ? created : [];
            const rl = rows[0];
            if (!rl?.id) {
              fail('Could not create a room loader for this visit.');
              return;
            }
            navigate('/room-loader', { state: { openRoomLoaderId: rl.id } });
            return;
          }
          case 'enterWeight': {
            if (!firstPatient?.id) {
              fail('No patient on this appointment.');
              return;
            }
            const raw = window.prompt(
              'Weight (lbs)',
              firstPatient.weight != null ? String(firstPatient.weight) : ''
            );
            if (raw == null || raw.trim() === '') return;
            const n = parseFloat(raw.replace(/,/g, ''));
            if (!Number.isFinite(n)) {
              fail('Enter a valid number.');
              return;
            }
            await patchPatient(firstPatient.id, { weight: n });
            showToast('Weight saved.');
            await loadRange();
            return;
          }
          case 'goMr': {
            const pid = pickStr(firstPatient?.pimsId);
            if (!pid) {
              fail('Patient has no PIMS id (eVet link unavailable).');
              return;
            }
            window.open(evetPatientLink(pid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'goClient': {
            const cid = pickStr(client?.pimsId);
            if (!cid) {
              fail('Client has no PIMS id (eVet link unavailable).');
              return;
            }
            window.open(evetClientLink(cid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'quickInvoice': {
            const cid = pickStr(client?.pimsId);
            if (!cid) {
              fail('Client has no PIMS id (eVet link unavailable).');
              return;
            }
            window.open(evetClientLink(cid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'checkout': {
            const pid = pickStr(firstPatient?.pimsId);
            if (!pid) {
              fail('Patient has no PIMS id (eVet link unavailable).');
              return;
            }
            window.open(evetPatientLink(pid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'contact': {
            if (!client) {
              fail('No client on this appointment.');
              return;
            }
            if (action.channel === 'phone1' && client.phone1) {
              window.location.href = telHref(client.phone1);
              return;
            }
            if (action.channel === 'phone2' && client.phone2) {
              window.location.href = telHref(client.phone2);
              return;
            }
            if (action.channel === 'email1' && client.email) {
              window.location.href = `mailto:${client.email}`;
              return;
            }
            if (action.channel === 'email2' && client.secondEmail) {
              window.location.href = `mailto:${client.secondEmail}`;
              return;
            }
            return;
          }
          default:
            return;
        }
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
        const m = ax?.response?.data?.message;
        if (Array.isArray(m)) fail(m.join(', '));
        else if (typeof m === 'string' && m.trim()) fail(m);
        else if (ax?.message) fail(ax.message);
        else fail('Something went wrong.');
      }
    },
    [loadRange, navigate, showToast, rawAppointments, addAnotherPetMenuReady]
  );

  const addAnotherPetMenuOpts = useMemo(() => {
    if (
      !contextMenu ||
      !showEmployeeAddCoVisitPet ||
      !appointmentSupportsEmployeeCoVisitPet(contextMenu.appt)
    ) {
      return { show: false, disabled: true as boolean, title: undefined as string | undefined };
    }
    const disabled = addAnotherPetMenuReady !== true;
    const title =
      addAnotherPetMenuReady === false
        ? 'Every pet for this client already has an appointment overlapping this time.'
        : addAnotherPetMenuReady === null
          ? 'Checking which pets can be added…'
          : undefined;
    return { show: true, disabled, title };
  }, [contextMenu, showEmployeeAddCoVisitPet, addAnotherPetMenuReady]);

  const showEmbeddedCalendarOverlay = embedInRoutingWorkspace && (driveEtaLoading || loading);
  const showFullBleedDriveOverlay = driveEtaLoading && !embedInRoutingWorkspace;
  const showDriveLoadingOverlay = showEmbeddedCalendarOverlay || showFullBleedDriveOverlay;

  const practiceCalendarStickyWeekChrome = showTimeGrid && !embedInRoutingWorkspace;

  const practiceRangeNav = (
          <div className="scheduler-range-above-grid">
            <div className="scheduler-range-above-grid-leading">
              <label
                className="scheduler-drive-toggle scheduler-drive-toggle--in-range-row"
                title={
                  view === 'month'
                    ? 'Switch to week or day view for drive times.'
                    : 'When on, visits use routed arrive/leave times (drive legs and ETAs), like My Week. When off, the grid uses booked appointment start and end times only.'
                }
              >
                <span className="scheduler-drive-toggle-row">
                  <input
                    type="checkbox"
                    checked={showByDriveTime}
                    disabled={view === 'month' || providers.length === 0}
                    onChange={(e) => setShowByDriveTime(e.target.checked)}
                  />
                  <span>Routed timeline</span>
                </span>
              </label>
            </div>
            <div className="scheduler-range-above-grid-center">
              <div className="scheduler-range-nav" role="group" aria-label="Navigate calendar range">
                <button
                  type="button"
                  className="scheduler-range-nav-btn"
                  onClick={goPrev}
                  aria-label={
                    view === 'day' ? 'Previous day' : view === 'week' ? 'Previous week' : 'Previous month'
                  }
                >
                  ←
                </button>
                <p className="scheduler-range-above-grid-title" role="status" aria-live="polite">
                  {rangeTitle}
                </p>
                <button
                  type="button"
                  className="scheduler-range-nav-btn"
                  onClick={goNext}
                  aria-label={view === 'day' ? 'Next day' : view === 'week' ? 'Next week' : 'Next month'}
                >
                  →
                </button>
              </div>
            </div>
            <div className="scheduler-range-above-grid-actions">
              <div className="scheduler-view-toggle" role="group" aria-label="Calendar view">
                {(['month', 'week', 'day'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-active={view === v}
                    disabled={
                      Boolean(routingPreview) &&
                      (v === 'month' || (!embedInRoutingWorkspace && v === 'day'))
                    }
                    title={
                      routingPreview && v === 'month'
                        ? 'Month view is unavailable while a routing preview is open.'
                        : routingPreview && v === 'day' && !embedInRoutingWorkspace
                          ? 'Switch to week view to finish booking this routing preview.'
                          : undefined
                    }
                    onClick={() => setView(v)}
                  >
                    {v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'Day'}
                  </button>
                ))}
              </div>
            </div>
          </div>
  );

  const renderPracticeWeekFrozenChrome = () => (
            <div className="scheduler-calendar-frozen">
                <div className="scheduler-time-col scheduler-time-col--frozen" style={{ paddingTop: 0 }}>
                  <div
                    className="scheduler-time-col-header-spacer"
                    style={{ height: SCHEDULER_DAY_HEADER_STACK_PX, flexShrink: 0 }}
                    aria-hidden
                  />
                  <div
                    className="scheduler-time-col-allday"
                    style={{ height: allDaySpanLayout.visibleHeightPx, flexShrink: 0 }}
                  >
                    <span className="scheduler-time-col-allday-label">all-day</span>
                  </div>
                </div>
                <div className="scheduler-days-frozen">
                  <div className="scheduler-day-headers-row">
                {dayColumnDates.map((dayDt, dayIdx) => {
                  const key = dayDt.toISODate()!;
                  const dayData = driveDayByDate?.get(key);
                  const hasStops = (dayData?.households?.length ?? 0) > 0;
                  const pts = dayData ? dayPoints(dayData.households) : 0;
                  const driveSec = dayData ? dayTotalDriveSeconds(dayData) : 0;
                  const driveMin = Math.round(driveSec / 60);
                  const driveColor = colorForDrive(driveMin);
                  const stops: Stop[] =
                    hasStops && dayData
                      ? dayData.households
                          .filter(
                            (h) =>
                              !h.isNoLocation &&
                              Number.isFinite(h.lat) &&
                              Number.isFinite(h.lon) &&
                              Math.abs(h.lat) > 1e-6 &&
                              Math.abs(h.lon) > 1e-6
                          )
                          .map((h) => ({
                            lat: h.lat,
                            lon: h.lon,
                            label: h.client,
                            address: h.address,
                          }))
                      : [];
                  const mapsLinks = stops.length ? buildGoogleMapsLinksForDay(stops, {
                    start: dayData?.startDepot
                      ? { lat: dayData.startDepot.lat, lon: dayData.startDepot.lon }
                      : undefined,
                    end: dayData?.endDepot
                      ? { lat: dayData.endDepot.lat, lon: dayData.endDepot.lon }
                      : undefined,
                  }) : [];
                  const scheduleLoaderHref =
                    resolvedPrimaryProviderId.trim() && hasStops
                      ? `/schedule/scheduling-tools/schedule-loader?targetDate=${key}&doctorId=${encodeURIComponent(resolvedPrimaryProviderId.trim())}`
                      : null;
                  const startDepot = dayData?.startDepot ?? null;
                  const officeTown =
                    (dayData?.startDepotTown?.trim() || null) ?? depotOfficeTownLabel(startDepot);
                  return (
                    <div key={key} className="scheduler-day-header" style={dayTimeColumnLayout.flexStyleForIndex(dayIdx)}>
                      <div className="scheduler-day-header-date">
                        {dayDt.toFormat('ccc')}, {dayDt.month}/{dayDt.day}
                      </div>
                      <div className="scheduler-day-header-metrics">
                        {dayData ? (
                          <>
                            <div className="scheduler-day-header-metrics-row">
                              {pts > 0 ? (
                                <span>
                                  <strong>Points:</strong> {pts}
                                </span>
                              ) : null}
                              {showByDriveTime && resolvedPrimaryProviderId.trim() && driveMin > 0 ? (
                                <span style={driveColor ? { color: driveColor } : undefined}>
                                  <strong>Drive:</strong> {driveMin} min
                                </span>
                              ) : null}
                            </div>
                            {hasStops && (scheduleLoaderHref || mapsLinks.length > 0) ? (
                              <div className="scheduler-day-header-actions">
                                {scheduleLoaderHref ? (
                                  <a
                                    href={scheduleLoaderHref}
                                    className="scheduler-day-header-btn"
                                    title={`Open Fill for ${key}`}
                                  >
                                    Fill
                                  </a>
                                ) : null}
                                {mapsLinks.length > 0 ? (
                                  <a
                                    href={mapsLinks[0]}
                                    className="scheduler-day-header-btn"
                                    target="_blank"
                                    rel="noreferrer"
                                    title={
                                      mapsLinks.length > 1
                                        ? `Open segment 1 of ${mapsLinks.length} in Google Maps`
                                        : 'Open this day in Google Maps'
                                    }
                                  >
                                    Maps
                                  </a>
                                ) : null}
                                <button
                                  type="button"
                                  className="scheduler-day-header-btn scheduler-day-header-btn--icon"
                                  title={`Download My Day — Visual PDF (${dayDt.toFormat('ccc M/d')})`}
                                  aria-label={`Download My Day PDF for ${key}`}
                                  disabled={practicePdfExportingKey === key}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void exportPracticeDayMyDayPdf(key);
                                  }}
                                >
                                  <Printer size={14} strokeWidth={2} aria-hidden />
                                </button>
                              </div>
                            ) : null}
                            {officeTown ? (
                              <div className="scheduler-day-header-office">Office: {officeTown}</div>
                            ) : null}
                          </>
                        ) : (
                          <div className="scheduler-day-header-metrics-placeholder" aria-hidden />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                className={
                  routingPreviewFocusDim
                    ? 'scheduler-all-day-unified-outer scheduler-all-day-unified-outer--routing-preview-focus'
                    : 'scheduler-all-day-unified-outer'
                }
                style={{ height: allDaySpanLayout.visibleHeightPx }}
              >
                <div
                  className="scheduler-all-day-unified-inner"
                  style={{ height: allDaySpanLayout.contentHeightPx }}
                >
                  {allDaySpanLayout.bars.map(({ appt, s, e, lane }) => {
                    const n = dayColumnDates.length;
                    const leftPct = dayTimeColumnLayout.barLeftPct(s);
                    const widthPct = dayTimeColumnLayout.barWidthPct(s, e);
                    const apptColors = colorsForAppointment(appt, typeList, typeFillMap);
                    const topPad = SCHEDULER_ALL_DAY_PAD_Y / 2;
                    const member = appointmentPatientMember(appt);
                    return (
                      <div
                        key={appt.id}
                        role="button"
                        tabIndex={0}
                        className="scheduler-all-day-span-bar"
                        aria-label={pickStr(appt.description) || schedulerEventAppointmentTitle(appt)}
                        style={{
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                          top: topPad + lane * SCHEDULER_ALL_DAY_ROW_PX,
                          height: SCHEDULER_ALL_DAY_ROW_PX - 2,
                          background: apptColors.fill,
                          color: apptColors.text,
                        }}
                        onDoubleClick={(ev) => {
                          ev.stopPropagation();
                          setModalAppt(appt);
                        }}
                        onKeyDown={(ke) => ke.key === 'Enter' && setModalAppt(appt)}
                        onMouseEnter={(ev) => armHoverPopover(appt, ev)}
                        onMouseMove={(ev) => trackHoverPopoverMove(appt, ev)}
                        onMouseLeave={() => endHoverPopoverForAppt(appt.id)}
                        onContextMenu={(ev) => handleAppointmentContextMenu(ev, appt)}
                      >
                        {member.isMember && (
                          <span
                            className="scheduler-appt-member-heart"
                            aria-hidden
                          >
                            <Heart size={10} fill="#dc2626" color="#dc2626" strokeWidth={1.5} />
                          </span>
                        )}
                        <SchedulerEventTitleBlock appt={appt} variant="allDay" />
                      </div>
                    );
                  })}
                </div>
              </div>
                </div>
              </div>
  );

  const renderPracticeWeekTimedGrid = () => (
              <div className="scheduler-calendar-scroll">
                <div className="scheduler-time-col scheduler-time-col--scroll" style={{ paddingTop: 0 }}>
                  <div style={{ height: gridHeightPx, position: 'relative', flexShrink: 0 }}>
                    {timeLabels.map(({ min, label, major }) => (
                      <div
                        key={min}
                        className="scheduler-time-slot"
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: (min - gridBounds.gridStartMin) * PPM,
                          height: SLOT_MINUTES * PPM,
                          borderTop: major ? '1px solid #e2e8f0' : '1px solid #f1f5f9',
                        }}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="scheduler-day-bodies-scroll">
                  <div className="scheduler-day-bodies-row">
                {dayColumnDates.map((dayDt, dayIdx) => {
                  const key = dayDt.toISODate()!;
                  const dayDataCol = driveDayByDate?.get(key);
                  const dayAppts = appointmentsByDay.get(key) ?? [];
                  const timedBase = dayAppts.filter((a) => !a.allDay);
                  const previewSyn =
                    routingPreview &&
                    routingPreviewColumnKey === key &&
                    buildRoutingPreviewSyntheticAppointment(routingPreview, typeList);
                  const timed = previewSyn ? [...timedBase, previewSyn] : timedBase;
                  const placed = assignColumnsForDay(timed, displayRangeForAppt);
                  const currentTimeLineTop =
                    key === practiceTodayIso
                      ? (nowWallMinutes - gridBounds.gridStartMin) * PPM
                      : null;
                  const showCurrentTimeLine =
                    currentTimeLineTop != null &&
                    currentTimeLineTop >= 0 &&
                    currentTimeLineTop <= gridHeightPx;

                  return (
                    <div key={key} className="scheduler-day-col" style={dayTimeColumnLayout.flexStyleForIndex(dayIdx)}>
                      <div
                        className={
                          routingPreviewFocusDim
                            ? 'scheduler-day-body scheduler-day-body--routing-preview-focus'
                            : 'scheduler-day-body'
                        }
                        style={{ height: gridHeightPx, position: 'relative' }}
                        onDoubleClick={(e) => handleDayBodyDoubleClick(e, dayDt)}
                        aria-label={
                          canManualBookOnCalendar
                            ? 'Day column: double-click to book (admin)'
                            : 'Day column: use Routing, My Week to book new appointments'
                        }
                      >
                        {timeLabels.map(({ min, major }) => (
                          <div
                            key={min}
                            className={`scheduler-grid-line ${major ? 'major' : ''}`}
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: (min - gridBounds.gridStartMin) * PPM,
                              height: 1,
                            }}
                          />
                        ))}
                        {routingPreviewFocusDim ? (
                          <div className="scheduler-routing-focus-dim" aria-hidden />
                        ) : null}
                        {showByDriveTime &&
                        resolvedPrimaryProviderId.trim() &&
                        dayDataCol?.startDepotTime?.trim() &&
                        (() => {
                          const top = schedulerDepotLineTopPx(
                            gridBounds.gridStartMin,
                            gridBounds.totalMin,
                            dayDataCol.startDepotTime
                          );
                          if (top == null) return null;
                          return (
                            <div
                              key={`depot-start-${key}`}
                              className="scheduler-day-depot-line"
                              style={{ top }}
                              title={`Leave depot (${dayDataCol.startDepotTime})`}
                              aria-hidden
                            />
                          );
                        })()}
                        {showByDriveTime &&
                        resolvedPrimaryProviderId.trim() &&
                        dayDataCol?.endDepotTime?.trim() &&
                        (() => {
                          const top = schedulerDepotLineTopPx(
                            gridBounds.gridStartMin,
                            gridBounds.totalMin,
                            dayDataCol.endDepotTime
                          );
                          if (top == null) return null;
                          return (
                            <div
                              key={`depot-end-${key}`}
                              className="scheduler-day-depot-line"
                              style={{ top }}
                              title={`Return to depot (${dayDataCol.endDepotTime})`}
                              aria-hidden
                            />
                          );
                        })()}
                        {showByDriveTime &&
                        resolvedPrimaryProviderId.trim() &&
                        dayDataCol &&
                        (() => {
                          const layout = computeMyWeekDayColumnLayout(
                            dayDataCol,
                            weekGridMetrics,
                            key,
                            showByDriveTime,
                            dayDataCol.appointmentBufferMinutes ?? 5
                          );
                          if (!layout) return null;
                          const segs = buildMyWeekDriveSegmentsFromLayout(
                            layout,
                            dayDataCol,
                            weekGridMetrics,
                            key
                          );
                          return segs.map((seg, i) => {
                            const segmentKey = `${key}-drive-${i}`;
                            const extraLine = schedulerDriveHoverExtraLine(seg, i, segs, dayDataCol);
                            return (
                            <div
                              key={`sched-drive-${key}-${i}`}
                              className="scheduler-day-drive-segment"
                              style={{
                                top: seg.top,
                                height: seg.height,
                                background: seg.kind === 'buffer' ? BUFFER_STRIPE_BG : DRIVE_STRIPE_BG,
                                border: seg.kind === 'buffer' ? BUFFER_STRIPE_BORDER : undefined,
                              }}
                              onMouseEnter={(ev) => {
                                setDriveHoverCard({
                                  segmentKey,
                                  x: ev.clientX,
                                  y: ev.clientY,
                                  heading: seg.kind === 'buffer' ? 'Buffer' : 'Driving',
                                  body: seg.title,
                                  extraLine,
                                });
                              }}
                              onMouseMove={(ev) => {
                                setDriveHoverCard((prev) =>
                                  prev && prev.segmentKey === segmentKey
                                    ? { ...prev, x: ev.clientX, y: ev.clientY }
                                    : prev
                                );
                              }}
                              onMouseLeave={() => {
                                setDriveHoverCard((prev) =>
                                  prev?.segmentKey === segmentKey ? null : prev
                                );
                              }}
                            />
                          );
                          });
                        })()}
                        {placed.map(({ appt, col, colCount }) => {
                          const isRoutingPreviewSlot = appt.id === SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID;
                          const { startIso, endIso } = displayRangeForAppt(appt);
                          const sm = wallMinutes(startIso);
                          const em = wallMinutes(endIso);
                          const rawTop = (sm - gridBounds.gridStartMin) * PPM;
                          const rawH = (em - sm) * PPM;
                          const top = Math.max(0, rawTop);
                          const bottom = Math.min(gridHeightPx, rawTop + Math.max(rawH, 16));
                          const h = Math.max(18, bottom - top);
                          const wPct = 100 / colCount;
                          const leftPct = (100 * col) / colCount;
                          const apptColors = colorsForAppointment(appt, typeList, typeFillMap);
                          const member = appointmentPatientMember(appt);
                          const schedStart = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(
                            PRACTICE_TZ
                          );
                          const schedEnd = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(
                            PRACTICE_TZ
                          );
                          const scheduledTimeLabel =
                            schedStart.isValid && schedEnd.isValid
                              ? `${schedStart.toFormat('h:mm a')} – ${schedEnd.toFormat('h:mm a')}`
                              : schedStart.isValid
                                ? schedStart.toFormat('h:mm a')
                                : null;
                          const descTrim = appt.description?.trim() ?? '';
                          const instrTrim = appt.instructions?.trim() ?? '';
                          const notesCombined = [descTrim, instrTrim].filter(Boolean).join(' · ');
                          if (isRoutingPreviewSlot) {
                            const previewLabel = descTrim || 'Proposed visit';
                            return (
                              <div
                                key="routing-preview-slot"
                                data-routing-preview-slot="1"
                                className="scheduler-event scheduler-routing-preview-slot scheduler-routing-preview-slot--in-column"
                                tabIndex={0}
                                aria-label={previewLabel}
                                style={{
                                  top,
                                  height: h,
                                  left: `${leftPct}%`,
                                  width: `${wPct}%`,
                                }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onContextMenu={(e) => e.preventDefault()}
                              >
                                <div className="scheduler-routing-preview-slot-default">
                                  <div className="scheduler-event-time">
                                    <SchedulerClientZoneBadge appt={appt} compact />
                                    {scheduledTimeLabel ? (
                                      <span className="scheduler-event-time-text">{scheduledTimeLabel}</span>
                                    ) : null}
                                  </div>
                                  <div className="scheduler-event-title">{previewLabel}</div>
                                </div>
                                <div
                                  className="scheduler-routing-preview-slot-hover"
                                  role="group"
                                  aria-label="Routing preview actions"
                                >
                                  <div className="scheduler-routing-preview-slot-hover-actions">
                                    <button
                                      type="button"
                                      className="btn scheduler-routing-preview-slot-hover-book"
                                      disabled={bookSlot != null}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openRoutingBookForm();
                                      }}
                                    >
                                      Book
                                    </button>
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      className="scheduler-routing-preview-slot-hover-dismiss"
                                      aria-label="Dismiss routing preview"
                                      title="Dismiss"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        dismissRoutingPreview();
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          dismissRoutingPreview();
                                        }
                                      }}
                                    >
                                      <X size={32} strokeWidth={3} aria-hidden />
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={appt.id}
                              className="scheduler-event"
                              aria-label={schedulerEventAppointmentTitle(appt)}
                              style={{
                                top,
                                height: h,
                                left: `${leftPct}%`,
                                width: `${wPct}%`,
                                background: apptColors.fill,
                                color: apptColors.text,
                              }}
                              role="button"
                              tabIndex={0}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setModalAppt(appt);
                              }}
                              onKeyDown={(e) => e.key === 'Enter' && setModalAppt(appt)}
                              onMouseEnter={(e) => armHoverPopover(appt, e)}
                              onMouseMove={(e) => trackHoverPopoverMove(appt, e)}
                              onMouseLeave={() => endHoverPopoverForAppt(appt.id)}
                              onContextMenu={(e) => handleAppointmentContextMenu(e, appt)}
                            >
                              <div className="scheduler-event-time">
                                <SchedulerClientZoneBadge appt={appt} compact />
                                {scheduledTimeLabel ? (
                                  <span className="scheduler-event-time-text">{scheduledTimeLabel}</span>
                                ) : null}
                              </div>
                              <div className="scheduler-event-title-row">
                                {member.isMember && (
                                  <span
                                    className="scheduler-appt-member-heart"
                                    aria-hidden
                                  >
                                    <Heart size={10} fill="#dc2626" color="#dc2626" strokeWidth={1.5} />
                                  </span>
                                )}
                                <SchedulerEventTitleBlock appt={appt} />
                              </div>
                              {notesCombined ? (
                                <div className="scheduler-event-notes">
                                  {notesCombined}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                        {showCurrentTimeLine && (
                          <div
                            className="scheduler-current-time-line"
                            style={{ top: currentTimeLineTop! }}
                            title={practiceClock.toFormat('h:mm:ss a')}
                            aria-label={`Current time ${practiceClock.toFormat('h:mm a')}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                  </div>
                </div>
              </div>
  );
  return (
    <div
      className={[
        'scheduler-page',
        embedInRoutingWorkspace ? 'scheduler-page--embedded' : '',
        routingPreview ? 'scheduler-page--routing-preview' : '',
        routingPreviewFocusDim ? 'scheduler-page--routing-preview-focus' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {toast ? (
        <div className="scheduler-toast" role="status">
          {toast}
        </div>
      ) : null}

      {routingPreview && !embedInRoutingWorkspace ? (
        <div className="scheduler-routing-preview-banner" role="region" aria-label="Routing calendar preview">
          <div className="scheduler-routing-preview-banner-text">
            <strong>Routing preview</strong>
            <span className="scheduler-routing-preview-banner-meta">
              {String(routingPreview.option.doctorName ?? 'Provider')} ·{' '}
              {DateTime.fromISO(String(routingPreview.option.date), { zone: PRACTICE_TZ }).toFormat(
                'cccc LLL d, yyyy'
              )}{' '}
              @ {DateTime.fromISO(String(routingPreview.option.suggestedStartIso)).toFormat('t')} (
              {Math.max(1, Math.floor(routingPreview.serviceMinutes) || 30)} min)
              {routingPreview.clientDisplayLabel ? (
                <span className="scheduler-routing-preview-client"> · {routingPreview.clientDisplayLabel}</span>
              ) : null}
            </span>
          </div>
          <div className="scheduler-routing-preview-banner-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={dismissRoutingPreview}
              disabled={bookSlot != null}
            >
              Back to routing results
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => openRoutingBookForm()}
              disabled={bookSlot != null}
            >
              Book now
            </button>
          </div>
        </div>
      ) : null}
      <div
        className={[
          'scheduler-toolbar-calendar-merge',
          practiceCalendarStickyWeekChrome ? 'scheduler-toolbar-calendar-merge--sticky-week' : '',
          embedInRoutingWorkspace && routingPreview
            ? 'scheduler-toolbar-calendar-merge--routing-preview-halo'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role={embedInRoutingWorkspace && routingPreview ? 'region' : undefined}
        aria-label={
          embedInRoutingWorkspace && routingPreview
            ? `Routing preview: ${String(routingPreview.option.doctorName ?? 'Provider')} · ${DateTime.fromISO(String(routingPreview.option.date), { zone: PRACTICE_TZ }).toFormat('cccc LLL d, yyyy')} @ ${DateTime.fromISO(String(routingPreview.option.suggestedStartIso)).toFormat('t')}`
            : undefined
        }
      >
        {embedInRoutingWorkspace && routingPreview ? (
          <div className="scheduler-embedded-preview-bar" role="status" aria-live="polite">
            <span className="scheduler-embedded-preview-bar-badge">Preview</span>
            <span className="scheduler-embedded-preview-bar-msg">
              Not booked. In Week or Day, hover the slot on the grid to book or dismiss.
            </span>
          </div>
        ) : null}
      {!routingPreview ? (
      <div className="scheduler-toolbar">
        <div className="scheduler-toolbar-row scheduler-toolbar-row--combined">
          <div className="scheduler-toolbar-cluster scheduler-toolbar-cluster--left">
            <div className="scheduler-go-date-cluster">
              <label className="scheduler-go-date-heading" htmlFor="scheduler-anchor-date">
                Go to date
              </label>
              <div className="scheduler-go-date-controls">
                <input
                  id="scheduler-anchor-date"
                  type="date"
                  value={anchorDate ?? ''}
                  onChange={(e) => onPickGoToDate(e.target.value)}
                />
                <div className="scheduler-nav scheduler-nav--today-only">
                  <button type="button" onClick={goToday}>
                    Today
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="scheduler-toolbar-cluster scheduler-toolbar-cluster--right">
            <div className="scheduler-filters">
              <label>
                Appointment type
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="">(Show all)</option>
                  {typeList.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.prettyName || t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Primary provider
                <select
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  disabled={Boolean(routingPreview) || providers.length === 0}
                  title={
                    routingPreview
                      ? embedInRoutingWorkspace
                        ? 'Provider is fixed for this routing preview. Dismiss the preview from the calendar slot to change.'
                        : 'Provider is fixed for this routing preview. Use Back to routing results to change.'
                      : providers.length === 0
                        ? 'Loading providers…'
                        : 'Show this doctor’s appointments only.'
                  }
                >
                  {providers.length === 0 ? (
                    <option value="">Loading providers…</option>
                  ) : (
                    providers.map((p) => (
                      <option key={String(p.id)} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>
      ) : null}

      {!loading && (showTimeGrid || view === 'month') && (
        <div
          className={[
            'scheduler-calendar-shell',
            practiceCalendarStickyWeekChrome ? 'scheduler-calendar-shell--sticky-week' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {view === 'month' ? (
            <>
              {practiceRangeNav}
            <div className="scheduler-month-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div
                  key={d}
                  style={{
                    background: '#f8fafc',
                    padding: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#64748b',
                    textAlign: 'center',
                  }}
                >
                  {d}
                </div>
              ))}
              {monthCells.map((cell) => (
                <button
                  key={cell.date.toISODate()}
                  type="button"
                  className={`scheduler-month-cell ${cell.inMonth ? '' : 'muted'}`}
                  onClick={() => {
                    setAnchorDate(cell.date.toISODate()!);
                    setView('day');
                  }}
                >
                  <div className="d">{cell.date.day}</div>
                  <div className="n">{cell.count ? `${cell.count} appt` : '—'}</div>
                </button>
              ))}
            </div>
            </>
          ) : null}
          {showTimeGrid && (
          <>
          {embedInRoutingWorkspace ? practiceRangeNav : null}
          <div className="scheduler-scroll">
            <div className="scheduler-grid-wrap">
              {!embedInRoutingWorkspace ? (
              <div className="scheduler-sticky-practice-week-head">
                {practiceRangeNav}
                {renderPracticeWeekFrozenChrome()}
              </div>
              ) : (
                renderPracticeWeekFrozenChrome()
              )}
              {renderPracticeWeekTimedGrid()}
            </div>
          </div>
          </>
          )}
        </div>
      )}
      </div>

      {loading && !embedInRoutingWorkspace && <p className="scheduler-status">Loading appointments…</p>}
      {error && <p className="scheduler-status error">{error}</p>}

      {hover &&
        createPortal(
          <div
            className="scheduler-tooltip scheduler-tooltip--visit-highlights"
            style={{
              left: tooltipPos.left,
              width: tooltipPos.width,
              ...(tooltipPos.bottom != null
                ? { top: 'auto', bottom: tooltipPos.bottom }
                : { top: tooltipPos.top }),
              maxWidth: tooltipPos.width,
              maxHeight: tooltipPos.maxCardH,
            }}
          >
            <SchedulerHoverContent appt={hover.appt} driveHint={hoverDriveHint} providers={providers} />
          </div>,
          document.body
        )}

      {driveHoverCard &&
        createPortal(
          (() => {
            const PADDING = 12;
            const OFFSET = 14;
            const CARD_W = 280;
            const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
            const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
            let left = driveHoverCard.x + OFFSET;
            if (left + CARD_W > vwW - PADDING) left = vwW - PADDING - CARD_W;
            if (left < PADDING) left = PADDING;
            let top = driveHoverCard.y - 12;
            if (top + 120 > vwH - PADDING) top = vwH - PADDING - 120;
            if (top < PADDING) top = PADDING;
            return (
              <div
                className="scheduler-drive-hover-card"
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 9999,
                  minWidth: 200,
                  maxWidth: CARD_W,
                  pointerEvents: 'none',
                }}
              >
                <div className="scheduler-drive-hover-card-heading">{driveHoverCard.heading}</div>
                <div className="scheduler-drive-hover-card-body">{driveHoverCard.body}</div>
                {driveHoverCard.extraLine ? (
                  <div className="scheduler-drive-hover-card-extra">{driveHoverCard.extraLine}</div>
                ) : null}
              </div>
            );
          })(),
          document.body
        )}

      {modalAppt &&
        createPortal(
          <SchedulerAppointmentModal
            appt={modalAppt}
            driveHint={modalDriveHint}
            accentColor={colorsForAppointment(modalAppt, typeList, typeFillMap).fill}
            onClose={() => setModalAppt(null)}
            providers={providers}
          />,
          document.body
        )}

      <SchedulerBookModal
        open={bookSlot != null}
        slot={bookSlot}
        practiceId={PRACTICE_ID}
        practiceTz={PRACTICE_TZ}
        appointmentTypes={typeList}
        providers={providers}
        defaultProviderId={(() => {
          const id = resolvedPrimaryProviderId.trim();
          if (id) return id;
          if (providers[0]) return String(providers[0].id);
          const auth = authDoctorId?.trim();
          return auth || null;
        })()}
        prefill={bookPrefill}
        onClose={closeBookModal}
        onBooked={handleSchedulerBooked}
      />

      {contextMenu ? (
        <SchedulerAppointmentContextMenu
          appt={contextMenu.appt}
          client={contextMenu.appt.client ?? undefined}
          anchorPoint={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onAction={(a) => {
            void handleAppointmentMenuAction(a, contextMenu.appt);
          }}
          showAddAnotherPet={addAnotherPetMenuOpts.show}
          addAnotherPetDisabled={addAnotherPetMenuOpts.disabled}
          addAnotherPetTitle={addAnotherPetMenuOpts.title}
        />
      ) : null}

      {editAppt &&
        createPortal(
          <SchedulerEditVisitModal
            appt={editAppt}
            practiceTz={PRACTICE_TZ}
            appointmentTypes={typeList}
            providers={providers}
            accentColor={colorsForAppointment(editAppt, typeList, typeFillMap).fill}
            onClose={() => setEditAppt(null)}
            onSaved={() => void loadRange({ refreshDrive: true })}
          />,
          document.body
        )}

      {showDriveLoadingOverlay ? (
        <div
          className={`scheduler-drive-overlay${embedInRoutingWorkspace ? ' scheduler-drive-overlay--embedded' : ''}`}
          role="alert"
          aria-busy="true"
          aria-live="polite"
          aria-label={driveEtaLoading ? 'Loading drive times' : 'Loading appointments'}
        >
          <div className="scheduler-drive-overlay-card">
            <div className="scheduler-drive-spinner" aria-hidden />
            <p className="scheduler-drive-overlay-text">
              {driveEtaLoading ? 'Loading drive times…' : 'Loading appointments…'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
