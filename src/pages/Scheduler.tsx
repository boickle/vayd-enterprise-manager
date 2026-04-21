// src/pages/Scheduler.tsx — Practice-wide appointment calendar (GET /appointments/range)
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { DateTime } from 'luxon';
import { Heart } from 'lucide-react';
import {
  deleteAppointment,
  fetchAppointmentsRange,
  patchAppointment,
} from '../api/appointments';
import { createRoomLoaders } from '../api/roomLoader';
import { patchPatient } from '../api/patients';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { fetchAllAppointmentTypes, type AppointmentType } from '../api/appointmentSettings';
import type { Appointment, Client, Patient } from '../api/roomLoader';
import {
  computeHoverPopoverPosition,
  rectFromElement,
} from '../utils/hoverPopoverPosition';
import { useAuth } from '../auth/useAuth';
import {
  fetchSchedulerDriveIsoByAppointmentId,
  type DriveIsoPair,
} from '../utils/schedulerDriveEta';
import { evetClientLink, evetPatientLink } from '../utils/evet';
import { SchedulerBookModal, type SchedulerBookSlot } from './SchedulerBookModal';
import {
  SchedulerAppointmentContextMenu,
  type SchedulerContextMenuAction,
} from './SchedulerContextMenu';
import { SchedulerEditVisitModal } from './SchedulerEditVisitModal';
import './Scheduler.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

const PPM = 1.15;
const SLOT_MINUTES = 15;
const DEFAULT_GRID_START = 7 * 60;
const DEFAULT_GRID_END = 17 * 60;

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

/** Same membership source as My Week: appointment root or nested patient. */
function appointmentPatientMember(appt: Appointment): {
  isMember: boolean;
  membershipName: string | null;
} {
  const pat = appt.patient;
  const isMember = Boolean(appt.isMember ?? pat?.isMember);
  const raw = appt.membershipName ?? pat?.membershipName;
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

function patientAgePhrase(dobIso: string | null | undefined): string | null {
  if (!dobIso) return null;
  const d = DateTime.fromISO(dobIso);
  if (!d.isValid) return null;
  const now = DateTime.now();
  const y = Math.floor(now.diff(d, 'years').years);
  const afterY = d.plus({ years: y });
  const months = Math.floor(now.diff(afterY, 'months').months);
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  if (parts.length === 0) parts.push('under 1 month');
  return parts.join(' ');
}

function patientBreedDisplayLine(p: Patient): string | null {
  const species = pickStr(p.speciesEntity?.name) ?? pickStr(p.species);
  const breed = pickStr(p.breedEntity?.name) ?? pickStr(p.breed);
  const color = pickStr(p.color);
  const parts = [species, breed, color].filter(Boolean);
  return parts.length ? parts.join(' - ') : null;
}

function formatWeightLbsKg(w: unknown): string | null {
  if (w == null || String(w).trim() === '') return null;
  const n = typeof w === 'number' ? w : parseFloat(String(w));
  if (!Number.isFinite(n)) return String(w);
  const kg = n * 0.45359237;
  return `${n} LBS (${kg.toFixed(4)}KG)`;
}

function formatApptDateTimeMed(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso);
  return dt.isValid ? dt.toLocaleString(DateTime.DATETIME_SHORT) : iso;
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

function formatDobDisplay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = DateTime.fromISO(iso);
  return d.isValid ? d.toLocaleString(DateTime.DATE_MED) : iso;
}

/** Support `patients[]` from API when present; otherwise single `patient`. */
function patientsForAppointment(a: Appointment): Patient[] {
  const multi = (a as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) return multi;
  return a.patient ? [a.patient] : [];
}

function patientSpeciesBreed(p: Patient): string | null {
  const species = pickStr(p.speciesEntity?.name) ?? pickStr(p.species);
  const breed = pickStr(p.breedEntity?.name) ?? pickStr(p.breed);
  if (species && breed) return `${species} · ${breed}`;
  return species || breed || null;
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

function SchedulerModalKv({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: ReactNode;
  fullWidth?: boolean;
}) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div className={`scheduler-modal-kv${fullWidth ? ' scheduler-modal-kv-full' : ''}`}>
      <span className="scheduler-modal-k">{label}</span>
      <span className="scheduler-modal-v">{value}</span>
    </div>
  );
}

function treatmentDetailRows(treatment: unknown): { label: string; value: string }[] {
  if (treatment == null) return [];
  if (typeof treatment === 'string') return [{ label: 'Details', value: treatment }];
  if (typeof treatment !== 'object') return [{ label: 'Details', value: String(treatment) }];
  const o = treatment as Record<string, unknown>;
  const rows: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v == null || k.startsWith('_')) continue;
    if (typeof v === 'object') {
      try {
        rows.push({ label: k, value: JSON.stringify(v, null, 2) });
      } catch {
        rows.push({ label: k, value: String(v) });
      }
    } else {
      rows.push({ label: k, value: String(v) });
    }
  }
  return rows;
}

function SchedulerHoverContent({ appt }: { appt: Appointment }) {
  const c = appt.client;
  const patients = patientsForAppointment(appt);
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const end = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const typeName = appt.appointmentType?.prettyName || appt.appointmentType?.name || null;
  const desc = appt.description?.trim() || null;
  const instr = appt.instructions?.trim() || null;
  const clientAlerts = c?.alerts?.trim() || null;
  const addrLine = clientAddressOneLine(c ?? undefined);
  const phoneLine = clientPhonesLine(c ?? undefined);

  return (
    <>
      <div className="scheduler-tooltip-vh-header">Visit Highlights</div>
      <div className="scheduler-tooltip-vh-body">
        <VisitHighlightsRow label="Scheduled">
          {start.isValid && end.isValid
            ? `${start.toFormat('M/d/yyyy h:mm a')} – ${end.toFormat('h:mm a')}`
            : null}
        </VisitHighlightsRow>
        <VisitHighlightsRow label="Type">{typeName}</VisitHighlightsRow>
        <VisitHighlightsRow label="Description">{desc}</VisitHighlightsRow>
        <VisitHighlightsRow label="Instructions">{instr}</VisitHighlightsRow>
        <VisitHighlightsRow label="Appointment Provider">
          {providerLabelFormal(appt.primaryProvider)}
        </VisitHighlightsRow>

        {c ? (
          <div className="scheduler-tooltip-vh-block">
            <div className="scheduler-tooltip-vh-block-title">Client</div>
            <div className="scheduler-tooltip-vh-client-line">
              <strong>{clientLabel(c)}</strong>
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

        {patients.map((p, idx) => {
          const age = patientAgePhrase(p.dob);
          const sexAge = [pickStr(p.sex), age].filter(Boolean).join(' - ');
          const pid = p.pimsId != null && String(p.pimsId).trim() !== '' ? p.pimsId : p.id;
          const pAlerts = p.alerts?.trim();
          return (
            <div
              key={p.id}
              className={`scheduler-tooltip-vh-block${idx > 0 ? ' scheduler-tooltip-vh-block--follow' : ''}`}
            >
              <div className="scheduler-tooltip-vh-block-title">
                {patients.length > 1 ? `Patient ${idx + 1}` : 'Patient'}
              </div>
              <div className="scheduler-tooltip-vh-patient-line">
                <strong>{p.name}</strong>
                {sexAge ? <span> ({sexAge})</span> : null}
                <span className="scheduler-tooltip-vh-id"> (#{pid})</span>
              </div>
              {pAlerts ? (
                <div className="scheduler-tooltip-vh-alerts scheduler-tooltip-vh-alerts--patient">
                  <span className="scheduler-tooltip-vh-alerts-title">Patient alerts</span>
                  {pAlerts}
                </div>
              ) : null}
              <VisitHighlightsRow label="Date of Birth">{formatDobDisplay(p.dob)}</VisitHighlightsRow>
              <VisitHighlightsRow label="Weight">{formatWeightLbsKg(p.weight)}</VisitHighlightsRow>
              <VisitHighlightsRow label="Breed">{patientBreedDisplayLine(p)}</VisitHighlightsRow>
              {p.isMember ? (
                <VisitHighlightsRow label="Membership">
                  {pickStr(p.membershipName) ?? 'Member'}
                </VisitHighlightsRow>
              ) : null}
            </div>
          );
        })}

        <div className="scheduler-tooltip-vh-meta">
          <VisitHighlightsRow label="Date Created">{formatApptDateTimeMed(appt.created)}</VisitHighlightsRow>
          <VisitHighlightsRow label="Date Modified">{formatApptDateTimeMed(appt.updated)}</VisitHighlightsRow>
          {pickStr(appt.statusName) ? (
            <VisitHighlightsRow label="Status">{appt.statusName}</VisitHighlightsRow>
          ) : null}
          {pickStr(appt.confirmStatusName) ? (
            <VisitHighlightsRow label="Confirm status">{appt.confirmStatusName}</VisitHighlightsRow>
          ) : null}
        </div>
      </div>
    </>
  );
}

function SchedulerAppointmentModal({
  appt,
  accentColor,
  onClose,
}: {
  appt: Appointment;
  accentColor: string;
  onClose: () => void;
}) {
  const patients = patientsForAppointment(appt);
  const c = appt.client;
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const end = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const typeName = appt.appointmentType?.prettyName || appt.appointmentType?.name || 'Appointment';
  const treatmentRows = treatmentDetailRows(appt.treatment);
  const aw = appt.arrivalWindow;
  const clientAddr = c ? clientAddressMultiline(c) : null;

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
            <p className="scheduler-modal-eyebrow">{typeName}</p>
            <h2 id="scheduler-modal-title">
              {fullClientHouseholdName(c)}
              {patients.length === 1 ? ` · ${patients[0].name}` : ''}
            </h2>
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
              <SchedulerModalKv label="Provider" value={providerLabel(appt.primaryProvider)} />
              <SchedulerModalKv
                label="Practice"
                value={appt.practice?.name ?? (appt.practice?.id != null ? `ID ${appt.practice.id}` : null)}
              />
              <SchedulerModalKv label="Status" value={pickStr(appt.statusName)} />
              <SchedulerModalKv label="Confirm status" value={pickStr(appt.confirmStatusName)} />
              <SchedulerModalKv label="All day" value={appt.allDay ? 'Yes' : 'No'} />
              <SchedulerModalKv label="Complete" value={appt.isComplete ? 'Yes' : 'No'} />
              <SchedulerModalKv
                label="Arrival window"
                value={
                  aw?.windowStartLocal && aw?.windowEndLocal
                    ? `${aw.windowStartLocal} – ${aw.windowEndLocal}`
                    : [pickStr(aw?.windowStartIso), pickStr(aw?.windowEndIso)].filter(Boolean).join(' – ') ||
                      null
                }
              />
              <SchedulerModalKv label="Booked date" value={pickStr(appt.bookedDate ?? undefined)} />
              <SchedulerModalKv
                label="Description"
                fullWidth
                value={appt.description?.trim() || null}
              />
              <SchedulerModalKv
                label="Instructions"
                fullWidth
                value={appt.instructions?.trim() || null}
              />
              <SchedulerModalKv label="Equipment" value={appt.equipment?.trim() || null} />
              <SchedulerModalKv label="Medications" value={appt.medications?.trim() || null} />
              <SchedulerModalKv
                label="External record"
                value={appt.externallyCreated ? 'Yes' : null}
              />
              <SchedulerModalKv label="External created" value={pickStr(appt.externalCreated)} />
              <SchedulerModalKv label="Appointment ID" value={String(appt.id)} />
              <SchedulerModalKv label="PIMS ID" value={pickStr(appt.pimsId)} />
              <SchedulerModalKv label="PIMS type" value={pickStr(appt.pimsType)} />
              <SchedulerModalKv
                label="Created"
                value={
                  appt.created
                    ? DateTime.fromISO(appt.created).toLocaleString(DateTime.DATETIME_MED)
                    : null
                }
              />
              <SchedulerModalKv
                label="Updated"
                value={
                  appt.updated
                    ? DateTime.fromISO(appt.updated).toLocaleString(DateTime.DATETIME_MED)
                    : null
                }
              />
            </div>
          </section>

          {c ? (
            <section className="scheduler-modal-section">
              <h3 className="scheduler-modal-h3">Client</h3>
              <div className="scheduler-modal-kv-grid">
                <SchedulerModalKv label="Name" value={fullClientHouseholdName(c)} />
                <SchedulerModalKv label="Email" value={clientEmailsLine(c)} />
                <SchedulerModalKv label="Phone" value={clientPhonesLine(c)} />
                <SchedulerModalKv
                  label="Address"
                  fullWidth
                  value={
                    clientAddr ? (
                      <span className="scheduler-modal-multiline">{clientAddr}</span>
                    ) : null
                  }
                />
                <SchedulerModalKv label="County" value={pickStr(c.county)} />
                <SchedulerModalKv label="Country" value={pickStr(c.country)} />
                <SchedulerModalKv label="Client ID" value={String(c.id)} />
                <SchedulerModalKv label="PIMS ID" value={pickStr(c.pimsId)} />
                <SchedulerModalKv label="Username" value={pickStr(c.username)} />
                <SchedulerModalKv label="Alerts" value={pickStr(c.alerts)} />
                <SchedulerModalKv
                  label="Coordinates"
                  value={
                    c.lat != null && c.lon != null ? `${c.lat}, ${c.lon}` : null
                  }
                />
              </div>
            </section>
          ) : null}

          {patients.length > 0 ? (
            <section className="scheduler-modal-section">
              <h3 className="scheduler-modal-h3">{patients.length > 1 ? 'Patients' : 'Patient'}</h3>
              <div className="scheduler-modal-patients">
                {patients.map((p) => {
                  const speciesBreed = patientSpeciesBreed(p);
                  return (
                  <div key={p.id} className="scheduler-modal-patient-card">
                    <div className="scheduler-modal-patient-card-head">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt={p.name} className="scheduler-modal-pet-avatar" />
                      ) : (
                        <div className="scheduler-modal-pet-avatar scheduler-modal-pet-avatar-placeholder" />
                      )}
                      <div>
                        <div className="scheduler-modal-patient-card-name">{p.name}</div>
                        {speciesBreed ? (
                          <div className="scheduler-modal-patient-card-meta">{speciesBreed}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="scheduler-modal-kv-grid">
                      <SchedulerModalKv label="Patient ID" value={String(p.id)} />
                      <SchedulerModalKv label="PIMS ID" value={pickStr(p.pimsId)} />
                      <SchedulerModalKv label="Sex" value={pickStr(p.sex)} />
                      <SchedulerModalKv label="DOB" value={formatDobDisplay(p.dob)} />
                      <SchedulerModalKv
                        label="Weight"
                        value={
                          p.weight != null && String(p.weight).trim() !== '' ? String(p.weight) : null
                        }
                      />
                      <SchedulerModalKv label="Color" value={pickStr(p.color)} />
                      <SchedulerModalKv
                        label="Membership"
                        value={p.isMember ? pickStr(p.membershipName) ?? 'Yes' : null}
                      />
                      <SchedulerModalKv label="Alerts" value={pickStr(p.alerts)} />
                      <SchedulerModalKv
                        label="Primary provider"
                        value={
                          p.primaryProvider
                            ? [p.primaryProvider.firstName, p.primaryProvider.lastName]
                                .filter(Boolean)
                                .join(' ')
                            : null
                        }
                      />
                      <SchedulerModalKv
                        label="Household contacts"
                        fullWidth
                        value={
                          p.clients?.length
                            ? p.clients
                                .map((x) => [x.firstName, x.lastName].filter(Boolean).join(' ').trim())
                                .filter(Boolean)
                                .join(' · ')
                            : null
                        }
                      />
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {treatmentRows.length > 0 ? (
            <section className="scheduler-modal-section">
              <h3 className="scheduler-modal-h3">Treatment / plan</h3>
              <div className="scheduler-modal-treatment">
                {treatmentRows.map((row, idx) => (
                  <div key={`${row.label}-${idx}`} className="scheduler-modal-treatment-row">
                    <span className="scheduler-modal-treatment-k">{row.label}</span>
                    <pre className="scheduler-modal-treatment-v">{row.value}</pre>
                  </div>
                ))}
              </div>
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

function dayKeyFromIso(iso: string): string | null {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(PRACTICE_TZ);
  return dt.isValid ? dt.toISODate() : null;
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

function appointmentCoversPracticeLocalDate(a: Appointment, dateIso: string): boolean {
  if (a.allDay) return allDayRangeContainsLocalDate(a, dateIso);
  return dayKeyFromIso(a.appointmentStart) === dateIso;
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

function isAppointmentVisible(a: Appointment): boolean {
  if (a.isDeleted) return false;
  if (a.isActive === false) return false;
  return true;
}

export default function Scheduler() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('week');
  const [anchorDate, setAnchorDate] = useState(() =>
    DateTime.now().setZone(PRACTICE_TZ).toISODate()
  );
  const [providerFilter, setProviderFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const [providers, setProviders] = useState<Provider[]>([]);
  const [typeList, setTypeList] = useState<AppointmentType[]>([]);
  const [rawAppointments, setRawAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalAppt, setModalAppt] = useState<Appointment | null>(null);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [contextMenu, setContextMenu] = useState<{ appt: Appointment; x: number; y: number } | null>(
    null
  );
  const [toast, setToast] = useState<string | null>(null);
  /** When true and a single provider is selected, timed events use ETA/ETD from /appointments/doctor + /routing/eta (same as My Week). */
  const [showByDriveTime, setShowByDriveTime] = useState(false);
  const [driveIsoByApptId, setDriveIsoByApptId] = useState<Map<string, DriveIsoPair> | null>(null);
  const [driveEtaLoading, setDriveEtaLoading] = useState(false);
  const [bookSlot, setBookSlot] = useState<SchedulerBookSlot | null>(null);
  const [hover, setHover] = useState<{
    appt: Appointment;
    x: number;
    y: number;
    el: HTMLElement | null;
  } | null>(null);

  const { doctorId: authDoctorId } = useAuth() as { doctorId: string | null };

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
    if (view === 'day') {
      return [DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }).startOf('day')];
    }
    return weekDays;
  }, [view, anchorDate, weekDays]);

  const driveFetchKey = useMemo(
    () => dayColumnDates.map((d) => d.toISODate()).join(','),
    [dayColumnDates]
  );

  const rangeTitle = useMemo(() => {
    if (view === 'day') {
      const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
      return d.toFormat('MMMM d, yyyy');
    }
    if (view === 'week') {
      const a = weekDays[0];
      const b = weekDays[6];
      return `${a.toFormat('MMMM d, yyyy')} – ${b.toFormat('MMMM d, yyyy')}`;
    }
    const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
    return d.toFormat('MMMM yyyy');
  }, [view, anchorDate, weekDays]);

  useEffect(() => {
    let on = true;
    fetchPrimaryProviders()
      .then((rows) => {
        if (on) setProviders(rows);
      })
      .catch(() => {
        if (on) setProviders([]);
      });
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    let on = true;
    fetchAllAppointmentTypes(PRACTICE_ID)
      .then((rows) => {
        if (on) setTypeList(rows.filter((t) => t.isActive !== false && !t.isDeleted));
      })
      .catch(() => {
        if (on) setTypeList([]);
      });
    return () => {
      on = false;
    };
  }, []);

  const loadRange = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchAppointmentsRange({
        practiceId: PRACTICE_ID,
        start: rangeUtc.startUtc,
        end: rangeUtc.endUtc,
        primaryProviderId: providerFilter || undefined,
      });
      if (!Array.isArray(rows)) {
        setRawAppointments([]);
        return;
      }
      setRawAppointments(rows);
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : 'Failed to load';
      setError(msg);
      setRawAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [rangeUtc.startUtc, rangeUtc.endUtc, providerFilter]);

  useEffect(() => {
    loadRange();
  }, [loadRange]);

  useEffect(() => {
    if (!providerFilter.trim()) setShowByDriveTime(false);
  }, [providerFilter]);

  useEffect(() => {
    if (view === 'month') setShowByDriveTime(false);
  }, [view]);

  useEffect(() => {
    const canDrive =
      Boolean(providerFilter.trim()) && showByDriveTime && (view === 'week' || view === 'day');
    if (!canDrive) {
      setDriveIsoByApptId(null);
      setDriveEtaLoading(false);
      return;
    }
    let on = true;
    setDriveEtaLoading(true);
    const dates = driveFetchKey.split(',').filter(Boolean);
    fetchSchedulerDriveIsoByAppointmentId(dates, providerFilter.trim())
      .then((m) => {
        if (on) setDriveIsoByApptId(m);
      })
      .catch(() => {
        if (on) {
          setDriveIsoByApptId(null);
          setToast('Could not load drive times; showing scheduled times.');
        }
      })
      .finally(() => {
        if (on) setDriveEtaLoading(false);
      });
    return () => {
      on = false;
    };
  }, [driveFetchKey, providerFilter, showByDriveTime, view]);

  const filteredAppointments = useMemo(() => {
    return rawAppointments.filter((a) => {
      if (!isAppointmentVisible(a)) return false;
      if (statusFilter) {
        const sn = (a.statusName ?? '').trim();
        const cn = (a.confirmStatusName ?? '').trim();
        if (sn !== statusFilter && cn !== statusFilter) return false;
      }
      if (typeFilter) {
        const id = String(a.appointmentType?.id ?? '');
        if (id !== typeFilter) return false;
      }
      return true;
    });
  }, [rawAppointments, statusFilter, typeFilter]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of rawAppointments) {
      if (a.statusName?.trim()) set.add(a.statusName.trim());
      if (a.confirmStatusName?.trim()) set.add(a.confirmStatusName.trim());
    }
    return [...set].sort((x, y) => x.localeCompare(y));
  }, [rawAppointments]);

  const displayRangeForAppt = useMemo(() => {
    return (a: Appointment) => {
      if (showByDriveTime && providerFilter.trim() && driveIsoByApptId?.has(String(a.id))) {
        const p = driveIsoByApptId.get(String(a.id))!;
        return { startIso: p.startIso, endIso: p.endIso };
      }
      return { startIso: a.appointmentStart, endIso: a.appointmentEnd };
    };
  }, [showByDriveTime, providerFilter, driveIsoByApptId]);

  const gridBounds = useMemo(() => {
    let start = DEFAULT_GRID_START;
    let end = DEFAULT_GRID_END;
    for (const a of filteredAppointments) {
      if (a.allDay) continue;
      const { startIso, endIso } = displayRangeForAppt(a);
      const sm = wallMinutes(startIso);
      const em = wallMinutes(endIso);
      start = Math.min(start, Math.floor(sm / SLOT_MINUTES) * SLOT_MINUTES);
      end = Math.max(end, Math.ceil(em / SLOT_MINUTES) * SLOT_MINUTES);
    }
    start = Math.max(0, start - SLOT_MINUTES);
    end = Math.min(24 * 60, end + SLOT_MINUTES);
    if (end <= start) end = start + 60;
    return { gridStartMin: start, gridEndMin: end, totalMin: end - start };
  }, [filteredAppointments, displayRangeForAppt]);

  const gridHeightPx = gridBounds.totalMin * PPM;

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

  const tooltipPos = useMemo(() => {
    if (!hover) return { left: 0, top: 0, width: 300 };
    const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
    return computeHoverPopoverPosition({
      anchor: rectFromElement(hover.el),
      x: hover.x,
      y: hover.y,
      vwW,
      vwH,
      cardMaxW: 480,
      cardMinW: 320,
      padding: 8,
      offset: 10,
    });
  }, [hover]);

  const showTimeGrid = view === 'week' || view === 'day';

  const handleDayBodyDoubleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>, dayDt: DateTime) => {
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
      setBookSlot({ start, end });
    },
    [gridBounds.gridStartMin, gridBounds.gridEndMin]
  );

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
    setHover(null);
    setContextMenu({ appt, x: e.clientX, y: e.clientY });
  }, []);

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
          case 'complete':
            await patchAppointment(appt.id, { isComplete: true });
            await loadRange();
            return;
          case 'remove':
            if (!window.confirm('Remove this appointment?')) return;
            setContextMenu(null);
            await deleteAppointment(appt.id);
            await loadRange();
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
    [loadRange, navigate, showToast]
  );

  return (
    <div className="scheduler-page">
      {toast ? (
        <div className="scheduler-toast" role="status">
          {toast}
        </div>
      ) : null}
      <div className="scheduler-toolbar">
        <div className="scheduler-toolbar-row">
          <label className="scheduler-go-date">
            <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase' }}>
              Go to date
            </span>
            <input
              type="date"
              value={anchorDate ?? ''}
              onChange={(e) => onPickGoToDate(e.target.value)}
            />
          </label>
          <div className="scheduler-filters">
            <label>
              Appointment status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">(Show all)</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Appointment type
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
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
              >
                <option value="">(Show all)</option>
                {providers.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="scheduler-drive-toggle"
              title={
                providerFilter.trim()
                  ? 'Place visits by routed arrive/leave times (same as My Week).'
                  : 'Select a single primary provider to load drive times.'
              }
            >
              <input
                type="checkbox"
                checked={showByDriveTime}
                disabled={!providerFilter.trim() || view === 'month'}
                onChange={(e) => setShowByDriveTime(e.target.checked)}
              />
              <span>Show actual drive time (arrive/leave)</span>
            </label>
          </div>
        </div>
      </div>

      {showTimeGrid && (
        <p className="scheduler-book-hint-bar">
          Double-click an empty time slot in the grid to book a new appointment.
        </p>
      )}

      <div className="scheduler-subbar">
        <div className="scheduler-nav">
          <button type="button" onClick={goPrev} aria-label="Previous">
            ←
          </button>
          <button type="button" onClick={goToday}>
            Today
          </button>
          <button type="button" onClick={goNext} aria-label="Next">
            →
          </button>
        </div>
        <div className="scheduler-range-title">{rangeTitle}</div>
        <div className="scheduler-view-toggle">
          {(['month', 'week', 'day'] as const).map((v) => (
            <button
              key={v}
              type="button"
              data-active={view === v}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="scheduler-status">Loading appointments…</p>}
      {error && <p className="scheduler-status error">{error}</p>}

      {!loading && view === 'month' && (
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
      )}

      {!loading && showTimeGrid && (
        <div className="scheduler-scroll">
          <div className="scheduler-grid-wrap">
            <div className="scheduler-time-col" style={{ paddingTop: 0 }}>
              <div style={{ height: 36, flexShrink: 0 }} aria-hidden />
              <div
                className="scheduler-time-col-allday"
                style={{ height: allDaySpanLayout.visibleHeightPx, flexShrink: 0 }}
              >
                <span className="scheduler-time-col-allday-label">all-day</span>
              </div>
              <div style={{ height: gridHeightPx, position: 'relative' }}>
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
            <div className="scheduler-days-stack">
              <div className="scheduler-day-headers-row">
                {dayColumnDates.map((dayDt) => {
                  const key = dayDt.toISODate()!;
                  return (
                    <div key={key} className="scheduler-day-header">
                      {dayDt.toFormat('ccc')}, {dayDt.month}/{dayDt.day}
                    </div>
                  );
                })}
              </div>
              <div
                className="scheduler-all-day-unified-outer"
                style={{ height: allDaySpanLayout.visibleHeightPx }}
              >
                <div
                  className="scheduler-all-day-unified-inner"
                  style={{ height: allDaySpanLayout.contentHeightPx }}
                >
                  {allDaySpanLayout.bars.map(({ appt, s, e, lane }) => {
                    const n = dayColumnDates.length;
                    const leftPct = (s / n) * 100;
                    const widthPct = ((e - s + 1) / n) * 100;
                    const apptColors = colorsForAppointment(appt, typeList, typeFillMap);
                    const baseTitle =
                      pickStr(appt.description) ||
                      clientLabel(appt.client) ||
                      appt.appointmentType?.prettyName ||
                      appt.appointmentType?.name ||
                      'Appointment';
                    const prov = providerLabel(appt.primaryProvider);
                    const showProv = !providerFilter.trim() && prov && prov !== '—';
                    const title = showProv ? `${baseTitle} · ${prov}` : baseTitle;
                    const topPad = SCHEDULER_ALL_DAY_PAD_Y / 2;
                    const member = appointmentPatientMember(appt);
                    return (
                      <div
                        key={appt.id}
                        role="button"
                        tabIndex={0}
                        className="scheduler-all-day-span-bar"
                        style={{
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                          top: topPad + lane * SCHEDULER_ALL_DAY_ROW_PX,
                          height: SCHEDULER_ALL_DAY_ROW_PX - 2,
                          background: apptColors.fill,
                          color: apptColors.text,
                        }}
                        onClick={() => setModalAppt(appt)}
                        onKeyDown={(ke) => ke.key === 'Enter' && setModalAppt(appt)}
                        onMouseEnter={(ev) =>
                          setHover({ appt, x: ev.clientX, y: ev.clientY, el: ev.currentTarget })
                        }
                        onMouseMove={(ev) =>
                          setHover((h) => (h ? { ...h, x: ev.clientX, y: ev.clientY } : h))
                        }
                        onMouseLeave={() => setHover(null)}
                        onDoubleClick={(ev) => ev.stopPropagation()}
                        onContextMenu={(ev) => handleAppointmentContextMenu(ev, appt)}
                        title={title}
                      >
                        {member.isMember && (
                          <span
                            className="scheduler-appt-member-heart"
                            title={member.membershipName?.trim() || 'Member'}
                            aria-hidden
                          >
                            <Heart size={10} fill="#dc2626" color="#dc2626" strokeWidth={1.5} />
                          </span>
                        )}
                        <span
                          className="scheduler-all-day-span-bar-text"
                          style={{ paddingRight: member.isMember ? 12 : undefined }}
                        >
                          {title}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="scheduler-day-bodies-row">
                {dayColumnDates.map((dayDt) => {
                  const key = dayDt.toISODate()!;
                  const dayAppts = appointmentsByDay.get(key) ?? [];
                  const timed = dayAppts.filter((a) => !a.allDay);
                  const placed = assignColumns(timed, displayRangeForAppt);

                  return (
                    <div key={key} className="scheduler-day-col">
                      <div
                        className="scheduler-day-body"
                        style={{ height: gridHeightPx, position: 'relative' }}
                        onDoubleClick={(e) => handleDayBodyDoubleClick(e, dayDt)}
                        title="Double-click to book"
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
                        {placed.map(({ appt, col, colCount }) => {
                          const { startIso, endIso } = displayRangeForAppt(appt);
                          const sm = wallMinutes(startIso);
                          const em = wallMinutes(endIso);
                          const rawTop = (sm - gridBounds.gridStartMin) * PPM;
                          const rawH = (em - sm) * PPM;
                          const top = Math.max(0, rawTop);
                          const bottom = Math.min(gridHeightPx, rawTop + Math.max(rawH, 16));
                          const h = Math.max(18, bottom - top);
                          const wPct = 100 / colCount;
                          const leftPct = col * wPct;
                          const title =
                            clientLabel(appt.client) ||
                            appt.appointmentType?.prettyName ||
                            appt.appointmentType?.name ||
                            'Appointment';
                          const apptColors = colorsForAppointment(appt, typeList, typeFillMap);
                          const member = appointmentPatientMember(appt);
                          return (
                            <div
                              key={appt.id}
                              className="scheduler-event"
                              style={{
                                top,
                                height: h,
                                left: `calc(${leftPct}% + 1px)`,
                                width: `calc(${wPct}% - 2px)`,
                                background: apptColors.fill,
                                color: apptColors.text,
                              }}
                              role="button"
                              tabIndex={0}
                              onClick={() => setModalAppt(appt)}
                              onKeyDown={(e) => e.key === 'Enter' && setModalAppt(appt)}
                              onMouseEnter={(e) =>
                                setHover({
                                  appt,
                                  x: e.clientX,
                                  y: e.clientY,
                                  el: e.currentTarget,
                                })
                              }
                              onMouseMove={(e) =>
                                setHover((prev) =>
                                  prev && prev.appt.id === appt.id
                                    ? { ...prev, x: e.clientX, y: e.clientY }
                                    : prev
                                )
                              }
                              onMouseLeave={() =>
                                setHover((prev) => (prev?.appt.id === appt.id ? null : prev))
                              }
                              onDoubleClick={(e) => e.stopPropagation()}
                              onContextMenu={(e) => handleAppointmentContextMenu(e, appt)}
                            >
                              {member.isMember && (
                                <span
                                  className="scheduler-appt-member-heart"
                                  title={member.membershipName?.trim() || 'Member'}
                                  aria-hidden
                                >
                                  <Heart size={10} fill="#dc2626" color="#dc2626" strokeWidth={1.5} />
                                </span>
                              )}
                              <div className="scheduler-event-time">
                                {DateTime.fromISO(startIso, { zone: 'utc' })
                                  .setZone(PRACTICE_TZ)
                                  .toFormat('h:mm a')}
                              </div>
                              <div
                                className="scheduler-event-title"
                                style={member.isMember ? { paddingRight: 12 } : undefined}
                              >
                                {title}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="scheduler-legend">
        {typeList.map((t) => (
          <span key={t.id}>
            <i
              style={{
                background: typeBackgroundFromRow(t) ?? hashColorKey(String(t.id)),
              }}
            />
            <span
              style={{
                color:
                  resolveForegroundCss(t.textColor) ??
                  readableTextOnBackground(typeBackgroundFromRow(t) ?? hashColorKey(String(t.id))),
              }}
            >
              {t.prettyName || t.name}
            </span>
          </span>
        ))}
      </div>

      {hover &&
        createPortal(
          <div
            className="scheduler-tooltip scheduler-tooltip--visit-highlights"
            style={{
              left: tooltipPos.left,
              top: tooltipPos.top,
              maxWidth: tooltipPos.width,
            }}
          >
            <SchedulerHoverContent appt={hover.appt} />
          </div>,
          document.body
        )}

      {modalAppt &&
        createPortal(
          <SchedulerAppointmentModal
            appt={modalAppt}
            accentColor={colorsForAppointment(modalAppt, typeList, typeFillMap).fill}
            onClose={() => setModalAppt(null)}
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
        defaultProviderId={providerFilter.trim() || authDoctorId}
        onClose={() => setBookSlot(null)}
        onBooked={() => loadRange()}
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
            onSaved={() => loadRange()}
          />,
          document.body
        )}

      {driveEtaLoading ? (
        <div
          className="scheduler-drive-overlay"
          role="alert"
          aria-busy="true"
          aria-live="polite"
          aria-label="Loading drive times"
        >
          <div className="scheduler-drive-overlay-card">
            <div className="scheduler-drive-spinner" aria-hidden />
            <p className="scheduler-drive-overlay-text">Loading drive times…</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
