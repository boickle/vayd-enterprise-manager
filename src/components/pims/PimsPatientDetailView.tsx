import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  PawPrint,
  AlertTriangle,
  MapPin,
  Plus,
  Phone,
  Mail,
  Stethoscope,
  User,
  Weight,
  ChevronRight,
  ChevronDown,
  Check,
  UserX,
  UserCheck,
  Activity,
  Pill,
  Lock,
  Camera,
  Bell,
  Heart,
  Sparkles,
  NotebookPen,
  X,
} from 'lucide-react';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { PetThumb, publicMediaUrl } from './PetThumb';
import {
  ClientReachEmailLink,
  ClientReachHost,
  ClientReachLink,
  useClientReach,
} from './ClientReachHub';
import {
  clientReachEmails,
  clientReachPets,
  clientReachPhones,
} from '../../utils/clientReachContacts';
import { formatClientDisplayName } from '../../utils/clientNamePrefix';
import { patchReminder } from '../../api/careOutreach';
import {
  deactivatePatient,
  fetchPatientByIdStaff,
  fetchPatientMedicalRecordStaff,
  patchPatient,
  reactivatePatient,
  uploadPetImage,
  type ScoutPatientWrite,
} from '../../api/patients';
import {
  getPatientTreatmentHistory,
  getPatientTreatmentMedications,
  type TreatmentWithItems,
} from '../../api/treatments';
import {
  isScoutWrittenPrescription,
  listEncounters,
  listProblems,
  listPatientPrescriptions,
  listPatientVisitCharges,
  updateProblem,
  updatePatientPrescription,
  type PatientProblem,
  type PatientPrescription,
  type PostedVisitCharge,
  type SoapEncounter,
} from '../../api/visitWorkflow';
import {
  buildChartRowsFromMedicalRecord,
  chartRowsFromClientRoomLoaders,
  chartRowsFromScoutNotes,
  filterRowsByDateRange,
  groupChartRowsByLocalDate,
  type ChartRow,
  type MedicalRecordBundle,
} from '../../utils/patientChartFromMedicalRecord';
import { searchRoomLoaders, type RoomLoader } from '../../api/roomLoader';
import { listScoutChartNotes, type ScoutChartNote } from '../../api/scoutChart';
import { defaultPimsAppointmentHistoryRangeUtc } from '../../api/pimsAppointments';
import { DateTime } from 'luxon';
import { apiBaseUrl } from '../../api/http';
import {
  htmlToPlainText,
  looksLikeHtmlFragment,
  sanitizeCommunicationHtml,
} from '../../utils/sanitizeCommunicationHtml';
import { PimsExamDetailModal } from './PimsExamDetailModal';
import { PimsMedicalNoteModal } from './PimsMedicalNoteModal';
import PimsSoapNoteModal from './PimsSoapNoteModal';
import PimsAppointmentsSection from './PimsAppointmentsSection';
import PimsChartWorkBar from './PimsChartWorkBar';
import {
  buildClientFinancialHref,
  writeFinancialPrefill,
  type FinancialRefillPrefill,
} from '../../utils/clientFinancial';
import { EmbeddedRoomLoaderModal } from './EmbeddedRoomLoaderModal';
import BriefPatientPanel, { type BriefPatientTab } from '../brief/BriefPatientPanel';
import { DEFAULT_PRACTICE_TIMEZONE, practiceTimeZoneOrDefault } from '../../utils/practiceTimezone';
import {
  parseRemindersFromMedicalRecord,
  patientMembershipFromRecord,
  splitActiveAndOverdueReminders,
} from '../../utils/routingPatientHoverData';
import { BRIEF_KIND_LABEL } from '../../utils/briefTypes';
import { listLocalBriefsForPatient } from '../../utils/briefStore';
import { listCaseHistorySummaries } from '../../utils/briefRecordStore';
import { appConfirm } from '../../utils/appDialog';
import { pushRecentRecord } from '../../utils/recentRecordsStore';
import '../../pages/BriefWorkspacePage.css';
import { scoutManagedState } from '../../utils/pimsScoutManaged';
import { patientSexDisplayFromRecord } from '../../utils/schedulerVisitDisplay';
import { useAuth } from '../../auth/AuthProvider';
import { startFreshNewAppointmentRouting } from '../../utils/routingNewAppointment';
import { writeRoutingChartBookIntent } from '../../utils/routingChartBookIntent';
import { markSchedulerHandoffPreferRoutingDoctor } from '../../utils/schedulerCalendarHandoff';
import {
  Card,
  DetailHeader,
  EditableCard,
  PimsBadge,
  TechnicalDetails,
  type CardValues,
  type FieldSpec,
} from './detail/PimsDetailKit';
import { BreedPicker, SpeciesSelect, useSpeciesCatalog } from './detail/SpeciesBreedFields';
import './detail/PimsDetailKit.css';
import './PimsPatientDetailView.css';

const PIMS_DETAIL_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function mediaUrl(path: unknown): string | null {
  return publicMediaUrl(path, apiBaseUrl);
}

function patientNameFrom(p: Record<string, unknown>): string {
  const joined = [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim();
  return (pickStr(p.name) ?? pickStr(p.patientName) ?? joined) || 'Patient';
}

function clientBlockFromPatient(p: Record<string, unknown>): Record<string, unknown> | null {
  const c = p.client;
  if (c && typeof c === 'object') return c as Record<string, unknown>;
  const clients = p.clients;
  if (Array.isArray(clients) && clients[0] && typeof clients[0] === 'object') {
    return clients[0] as Record<string, unknown>;
  }
  return null;
}

function clientDisplayName(c: Record<string, unknown>): string {
  return formatClientDisplayName(c);
}

type HouseholdPet = {
  id: string;
  name: string;
  active: boolean;
  imageUrl: string | null;
};

function householdPetsFromClient(raw: unknown, currentId: string): HouseholdPet[] {
  if (!raw || typeof raw !== 'object') return [];
  const patients = (raw as Record<string, unknown>).patients;
  if (!Array.isArray(patients)) return [];
  const pets = patients
    .filter((p): p is Record<string, unknown> => p != null && typeof p === 'object' && p.id != null)
    .map((p) => ({
      id: String(p.id),
      name: pickStr(p.name) ?? `Pet #${p.id}`,
      active: p.isActive !== false,
      imageUrl: mediaUrl(p.imageUrl),
    }));
  pets.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.id === currentId) return -1;
    if (b.id === currentId) return 1;
    return a.name.localeCompare(b.name);
  });
  return pets;
}

function formatAddressClient(c: Record<string, unknown>): string {
  const street = [
    pickStr(c.address1) ?? pickStr(c.addressLine1),
    pickStr(c.address2) ?? pickStr(c.addressLine2),
  ].filter(Boolean);
  const locality = [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ');
  const zip = pickStr(c.zip) ?? pickStr(c.zipcode);
  return [...street, locality, zip].filter(Boolean).join(', ') || '—';
}

function zoneLabel(c: Record<string, unknown> | null): string | null {
  if (!c) return null;
  const cz = c.clientZone;
  if (cz && typeof cz === 'object') {
    const name = pickStr((cz as Record<string, unknown>).name);
    if (name) return name;
  }
  const named = pickStr(c.zoneName);
  if (named) return named;
  const id = c.zoneId ?? (cz && typeof cz === 'object' ? (cz as Record<string, unknown>).id : null);
  if (id != null && String(id).trim()) return `Zone ${String(id).trim()}`;
  return null;
}

function alertFieldText(source: Record<string, unknown> | null, keys: string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) {
      const joined = v
        .map((a) => (typeof a === 'string' ? a : pickStr((a as Record<string, unknown>)?.message)))
        .filter(Boolean)
        .join(' ');
      if (joined) return joined;
    }
  }
  return null;
}

type StatusBadge = { label: string; variant: 'danger' | 'ok' | 'muted' };

function patientDetailStatus(p: Record<string, unknown>): StatusBadge {
  const st = (pickStr(p.status) ?? pickStr(p.patientStatus) ?? '').toLowerCase();
  if (st.includes('euthan')) return { label: 'Euthanized', variant: 'danger' };
  if (st.includes('deceas') || st.includes('died')) return { label: 'Deceased', variant: 'muted' };
  if (p.isActive === false || p.active === false || st.includes('inactive')) {
    return { label: 'Inactive', variant: 'muted' };
  }
  return { label: 'Active', variant: 'ok' };
}

function ageFromDob(dob: string | null): string | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  if (years < 0) return null;
  const iso = dob.slice(0, 10);
  return `${years}y / ${iso}`;
}

function formatChartDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.length >= 16 ? iso.slice(0, 16) : iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).replace(',', '');
}

function excerptText(raw: string, max = 320): string {
  const plain = raw.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${(lastStop > 80 ? cut.slice(0, lastStop) : cut).trim()}…`;
}

function formatChartDateShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function chartRowHasBody(r: ChartRow): boolean {
  return Boolean((r.detailText && r.detailText.trim()) || r.detailHtml);
}

function ChartRowExpandBody({ row }: { row: ChartRow }) {
  if (row.detailHtml) {
    return (
      <>
        {row.detailText?.trim() ? (
          <div className="pims-patient-detail__detail-meta">{row.detailText}</div>
        ) : null}
        <div
          className="pims-patient-detail__html-body"
          dangerouslySetInnerHTML={{ __html: row.detailHtml }}
        />
      </>
    );
  }
  const text = (row.detailText || '').trim();
  if (!text) {
    return <div className="pims-patient-detail__expand-text">No additional detail.</div>;
  }
  if (looksLikeHtmlFragment(text)) {
    return (
      <div
        className="pims-patient-detail__html-body"
        dangerouslySetInnerHTML={{ __html: sanitizeCommunicationHtml(text) }}
      />
    );
  }
  return <div className="pims-patient-detail__expand-text">{text}</div>;
}

function groupPrescriptionTreatmentRows(items: unknown[]) {
  type Group = { code: string; displayName: string; entries: Record<string, unknown>[] };
  const map = new Map<string, Group>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const inv =
      row.inventoryItem && typeof row.inventoryItem === 'object'
        ? (row.inventoryItem as Record<string, unknown>)
        : null;
    const presc =
      row.prescription && typeof row.prescription === 'object'
        ? (row.prescription as Record<string, unknown>)
        : null;
    const code =
      pickStr(row.productCode) ??
      pickStr(row.code) ??
      pickStr(row.medicationCode) ??
      (inv ? pickStr(inv.code) : null) ??
      pickStr(row.pimsId) ??
      'RX';
    const displayName =
      pickStr(row.productName) ??
      pickStr(row.name) ??
      (presc ? pickStr(presc.name) : null) ??
      (inv ? pickStr(inv.name) : null) ??
      code;
    if (!map.has(code)) map.set(code, { code, displayName, entries: [] });
    map.get(code)!.entries.push(row);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.entries.sort((a, b) => {
      const ta = Date.parse(pickStr(a.serviceDate) ?? '') || 0;
      const tb = Date.parse(pickStr(b.serviceDate) ?? '') || 0;
      return tb - ta;
    });
  }
  groups.sort((a, b) => {
    const da = a.entries[0] ? Date.parse(pickStr(a.entries[0].serviceDate) ?? '') || 0 : 0;
    const db = b.entries[0] ? Date.parse(pickStr(b.entries[0].serviceDate) ?? '') || 0 : 0;
    return db - da;
  });
  return groups;
}

function employeeFromRow(row: Record<string, unknown>): string {
  return employeeNameFromUnknown(row.employee ?? row.doctor ?? row.provider);
}

/** Prescription history DTO (`PatientPrescriptionHistoryItemDto`) — prescriber is a flat string when present. */
function writtenDirections(row: Record<string, unknown>): string | null {
  const presc =
    row.prescription && typeof row.prescription === 'object'
      ? (row.prescription as Record<string, unknown>)
      : null;
  return (
    pickStr(row.instructions) ??
    pickStr(row.directions) ??
    pickStr(row.sig) ??
    (presc
      ? pickStr(presc.instructions) ?? pickStr(presc.directions) ?? pickStr(presc.sig)
      : null)
  );
}

function refillPrefillFromRxRow(row: Record<string, unknown>, fallbackName: string): FinancialRefillPrefill {
  const qty = Number(row.quantity);
  const catalogId = Number(row.inventoryItemId);
  return {
    name: pickStr(row.productName) ?? pickStr(row.name) ?? fallbackName,
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    instructions: writtenDirections(row) ?? '',
    catalogItemId: Number.isFinite(catalogId) && catalogId > 0 ? catalogId : null,
  };
}

function prescriberFromRxRow(row: Record<string, unknown>): string {
  const named = pickStr(row.prescriberName);
  if (named) return named;
  return employeeFromRow(row);
}

function weightSparklinePoints(points: { serviceDate: string; weight: number }[]): string {
  if (points.length < 2) return '';
  const w = 200;
  const h = 52;
  const pad = 4;
  const weights = points.map((p) => p.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 1;
  const n = points.length;
  return points
    .map((p, i) => {
      const x = pad + (n === 1 ? w / 2 - pad : (i / (n - 1)) * (w - 2 * pad));
      const y = pad + (1 - (p.weight - minW) / range) * (h - 2 * pad);
      return `${x},${y}`;
    })
    .join(' ');
}

function WeightSparkline({ points }: { points: { serviceDate: string; weight: number }[] }) {
  if (points.length < 2) {
    return (
      <p className="pims-patient-detail__muted pims-patient-detail__spark-empty">
        Two or more recorded weights are needed to show a trend.
      </p>
    );
  }
  const pts = weightSparklinePoints(points);
  return (
    <svg
      className="pims-patient-detail__spark"
      width={200}
      height={52}
      viewBox="0 0 200 52"
      aria-hidden
    >
      <polyline fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function employeeNameFromUnknown(e: unknown): string {
  if (!e || typeof e !== 'object') return '—';
  const o = e as Record<string, unknown>;
  const fn = pickStr(o.firstName);
  const ln = pickStr(o.lastName);
  const j = [fn, ln].filter(Boolean).join(' ').trim();
  return j || pickStr(o.name) || '—';
}

function extractPatientSaveErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Could not save patient.';
}

function DeleteReminderConfirm({
  reminder,
  patientName,
  busy,
  onCancel,
  onConfirm,
}: {
  reminder: { id: string; label: string };
  patientName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  if (typeof document === 'undefined') return null;
  const whose = patientName.trim() || 'this patient';
  return createPortal(
    <div
      className="pims-chart-pick pims-detail--emr"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pims-reminder-delete-title"
    >
      <button
        type="button"
        className="pims-chart-pick__backdrop"
        aria-label="Keep this reminder"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div className="pims-chart-pick__card pims-chart-confirm">
        <div className="pims-chart-pick__head">
          <h3 id="pims-reminder-delete-title">Delete this reminder?</h3>
          <button
            type="button"
            className="pims-chart-pick__close"
            aria-label="Keep this reminder"
            disabled={busy}
            onClick={onCancel}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <p className="pims-chart-confirm__body">
          It will come off {whose}’s chart and the client portal.
        </p>
        <p className="pims-chart-confirm__quote">{reminder.label}</p>
        <div className="pims-chart-pick__foot pims-chart-confirm__foot">
          <button type="button" className="brief-btn" disabled={busy} onClick={onCancel}>
            Keep it
          </button>
          <button
            type="button"
            className="brief-btn danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A stored date, normalized for a `<input type="date">`. */
function dobForInput(p: Record<string, unknown>): string {
  const raw = pickStr(p.dob) ?? pickStr(p.dateOfBirth) ?? '';
  if (!raw) return '';
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

/** Noon UTC keeps a date-only birthday from shifting a day in either direction. */
function dobToApi(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00.000Z` : raw;
}

const SEX_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
];

const NEUTER_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'Intact', label: 'Intact' },
  { value: 'Spayed', label: 'Spayed' },
  { value: 'Neutered', label: 'Neutered' },
];

/**
 * The clinical one-liner vets read first: altered status, sex, age, breed, weight.
 * Anything missing is dropped rather than padded with placeholders.
 */
function signalmentParts(p: Record<string, unknown>, ageStr: string | null, weight: string | null) {
  const sexDisplay = patientSexDisplayFromRecord(p);
  const breed = pickStr(p.breed) ?? pickStr(p.breedDescription);
  const species = pickStr(p.species) ?? pickStr(p.speciesName);
  const mixed = p.isMixed === true || (breed ?? '').toLowerCase().includes('mixed');
  let breedLine = [breed, breed && species && breed !== species ? null : species]
    .filter(Boolean)
    .join(' ');
  if (mixed && breedLine && !breedLine.toLowerCase().includes('mixed')) breedLine += ' (mixed)';
  return [sexDisplay, ageStr, breedLine || null, weight].filter(Boolean) as string[];
}

type MrTab =
  | 'highlights'
  | 'groups'
  | 'byDate'
  | 'byDateDetail'
  | 'monitoring'
  | 'prescriptions'
  | 'wellness'
  | 'labs';

type Props = {
  patientId: string;
  onBack: () => void;
  /** Breadcrumb “Patients” link; default PIMS list. */
  patientsListPath?: string;
};

const GROUP_KEYS = [
  'visits',
  'communications',
  'histories',
  'soapNotes',
  'exams',
  'diagnoses',
  'treatments',
  'labs',
  'documents',
  'online',
] as const;

type PatientChartSection = 'chart' | Exclude<BriefPatientTab, 'info'>;

const PATIENT_CHART_TABS: { id: PatientChartSection; label: string }[] = [
  { id: 'chart', label: 'Chart' },
  { id: 'history', label: 'Case history' },
  { id: 'sessions', label: 'Prep' },
  { id: 'calls', label: 'Calls' },
  { id: 'review', label: 'Record review' },
  { id: 'merge', label: 'Merge' },
];

export default function PimsPatientDetailView({
  patientId,
  onBack,
  patientsListPath = '/schedule/patients',
}: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { abilities } = useAuth() as { abilities?: string[] };
  const canBookAppointment = !abilities || abilities.includes('canSeeRouting');
  const practiceTz = practiceTimeZoneOrDefault(DEFAULT_PRACTICE_TIMEZONE);
  const [chartSection, setChartSection] = useState<PatientChartSection>('chart');
  const [summarizeRequestId, setSummarizeRequestId] = useState(0);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [medicalRecord, setMedicalRecord] = useState<MedicalRecordBundle | null>(null);
  const [mrLoadError, setMrLoadError] = useState<string | null>(null);
  const [rxItems, setRxItems] = useState<unknown[]>([]);
  const [problems, setProblems] = useState<PatientProblem[]>([]);
  const [visitCharges, setVisitCharges] = useState<PostedVisitCharge[]>([]);
  /** Every prescription on this patient — Scout-written (SOAP orders, EMR pins) and eVet. */
  const [prescriptions, setPrescriptions] = useState<PatientPrescription[]>([]);
  const [resolvingProblemId, setResolvingProblemId] = useState<string | null>(null);
  const [discontinuingRxId, setDiscontinuingRxId] = useState<number | null>(null);
  const [treatments, setTreatments] = useState<TreatmentWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mrTab, setMrTab] = useState<MrTab>('byDate');
  const [showAbout, setShowAbout] = useState(false);
  const [showEditPet, setShowEditPet] = useState(false);
  const [dateStart, setDateStart] = useState('2000-01-01');
  const [dateEnd, setDateEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [expandedChartRowIds, setExpandedChartRowIds] = useState<Set<string>>(() => new Set());
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [selectedExam, setSelectedExam] = useState<Record<string, unknown> | null>(null);
  const [selectedMedicalNote, setSelectedMedicalNote] = useState<{
    title: string;
    record: Record<string, unknown>;
  } | null>(null);
  /** Scout-native SOAP notes for this patient (separate from eVet-imported exams). */
  const [soapNotes, setSoapNotes] = useState<SoapEncounter[]>([]);
  const [clientRoomLoaders, setClientRoomLoaders] = useState<RoomLoader[]>([]);
  const [scoutNotes, setScoutNotes] = useState<ScoutChartNote[]>([]);
  const [embeddedRoomLoaderId, setEmbeddedRoomLoaderId] = useState<number | null>(null);
  const [selectedSoapNote, setSelectedSoapNote] = useState<SoapEncounter | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingDeleteReminder, setPendingDeleteReminder] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [removingReminderId, setRemovingReminderId] = useState<string | null>(null);
  const [expandedRxKeys, setExpandedRxKeys] = useState<Set<string>>(() => new Set());
  const [householdPets, setHouseholdPets] = useState<HouseholdPet[]>([]);
  const [householdClient, setHouseholdClient] = useState<Record<string, unknown> | null>(null);
  const reach = useClientReach();

  const practiceId = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
  const speciesOptions = useSpeciesCatalog(practiceId);

  const clientsBasePath = '/schedule/clients';

  const reloadChartData = useCallback(
    async (isStale?: () => boolean) => {
      const id = patientId;
      setMrLoadError(null);
      const [
        patientData,
        mrData,
        rxData,
        problemRows,
        prescriptionRows,
        chargeRows,
        soapRows,
        treatmentRows,
        completedRoomLoaders,
        scoutNoteRows,
      ] = await Promise.all([
          fetchPatientByIdStaff(id),
          fetchPatientMedicalRecordStaff(id).catch((e: unknown) => {
            if (!isStale?.()) {
              setMrLoadError(e instanceof Error ? e.message : 'Medical record request failed.');
            }
            return null as MedicalRecordBundle | null;
          }),
          getPatientTreatmentMedications(id).catch(() => [] as unknown[]),
          // Master Problem List, the source of both the chronic problems box and the problem rows on
          // the timeline. A patient never charted in Scout simply has none.
          listProblems(Number(id)).catch(() => [] as PatientProblem[]),
          // Every Rx, not just active chronic ones: acute meds written on a SOAP have to show
          // up in the Prescriptions tab, which otherwise only lists eVet treatment lines.
          listPatientPrescriptions(Number(id)).catch(() => [] as PatientPrescription[]),
          listPatientVisitCharges(Number(id)).catch(() => [] as PostedVisitCharge[]),
          // Scout-native SOAP notes. Separate from eVet-imported `exams`, which carry no
          // signed/open state and cannot take addenda.
          listEncounters({ patientId: Number(id) }).catch(() => [] as SoapEncounter[]),
          getPatientTreatmentHistory(id).catch(() => [] as TreatmentWithItems[]),
          (() => {
            const range = defaultPimsAppointmentHistoryRangeUtc();
            return searchRoomLoaders({
              practiceId: PIMS_DETAIL_PRACTICE_ID,
              patientId: Number(id),
              sentStatus: 'completed',
              activeOnly: true,
              appointmentFrom: DateTime.fromISO(range.start).toFormat('yyyy-LL-dd'),
              appointmentTo: DateTime.fromISO(range.end).toFormat('yyyy-LL-dd'),
            }).catch(() => [] as RoomLoader[]);
          })(),
          listScoutChartNotes(Number(id), 'finalized').catch(() => [] as ScoutChartNote[]),
        ]);
      if (isStale?.()) return;
      if (patientData && typeof patientData === 'object') {
        setPayload(patientData as Record<string, unknown>);
      } else {
        setPayload(null);
      }
      setMedicalRecord(mrData);
      setRxItems(rxData);
      setProblems(problemRows);
      setPrescriptions(prescriptionRows);
      setVisitCharges(chargeRows);
      setSoapNotes(soapRows);
      setTreatments(treatmentRows);
      setClientRoomLoaders(completedRoomLoaders);
      setScoutNotes(scoutNoteRows);
    },
    [patientId]
  );

  useEffect(() => {
    let cancelled = false;
    const stale = () => cancelled;
    setLoading(true);
    setError(null);
    setPayload(null);
    setMedicalRecord(null);
    setMrLoadError(null);
    setRxItems([]);
    setProblems([]);
    setPrescriptions([]);
        setVisitCharges([]);
        setSoapNotes([]);
        setClientRoomLoaders([]);
        setScoutNotes([]);
        setEmbeddedRoomLoaderId(null);
        setTreatments([]);
    setPhotoFailed(false);
    (async () => {
      try {
        await reloadChartData(stale);
        if (cancelled) return;
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load patient.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, reloadChartData]);

  useEffect(() => {
    setSelectedExam(null);
    setSelectedMedicalNote(null);
    setSelectedSoapNote(null);
    setExpandedRxKeys(new Set());
  }, [patientId]);

  useEffect(() => {
    setSaveError(null);
    setBusy(false);
  }, [patientId]);

  const client = payload ? clientBlockFromPatient(payload) : null;
  const pname = payload ? patientNameFrom(payload) : '';
  const cname = client ? clientDisplayName(client) : (pickStr(payload?.clientName) ?? '—');
  const householdClientId = client?.id != null ? String(client.id) : null;

  useEffect(() => {
    if (!householdClientId) {
      setHouseholdPets([]);
      setHouseholdClient(null);
      return;
    }
    let cancelled = false;
    void fetchClientByIdStaff(householdClientId)
      .then((raw) => {
        if (cancelled) return;
        const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        setHouseholdClient(rec);
        setHouseholdPets(householdPetsFromClient(raw, patientId));
      })
      .catch(() => {
        if (cancelled) return;
        setHouseholdClient(null);
        setHouseholdPets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, householdClientId]);

  useEffect(() => {
    if (!payload || !pname) return;
    const ownerId = client?.id != null ? String(client.id) : null;
    if (ownerId && cname && cname !== '—') {
      pushRecentRecord({ kind: 'client', id: ownerId, name: cname });
    }
    pushRecentRecord({
      kind: 'patient',
      id: patientId,
      name: pname,
      subtitle: cname !== '—' ? cname : undefined,
    });
  }, [patientId, payload, pname, cname, client]);
  const patientAlert = payload
    ? alertFieldText(payload, ['alerts', 'alert'])
    : null;
  const ownerAlert = alertFieldText(client, ['alerts', 'clientAlert', 'alertNotes']);
  const connectionNotes = alertFieldText(client, ['connectionNotes']);
  const addressLine = client ? formatAddressClient(client) : null;
  const ownerZone = zoneLabel(client);
  const badge = payload ? patientDetailStatus(payload) : { label: '—', variant: 'muted' as const };

  const chartRows = useMemo(() => {
    const base = buildChartRowsFromMedicalRecord(
      medicalRecord,
      problems,
      visitCharges,
      treatments,
      true,
      [...rxItems, ...prescriptions],
    );
    const loaders = chartRowsFromClientRoomLoaders(clientRoomLoaders, patientId);
    const notes = chartRowsFromScoutNotes(scoutNotes);
    return [...base, ...loaders, ...notes].sort((a, b) => b.sortTime - a.sortTime);
  }, [medicalRecord, problems, visitCharges, treatments, rxItems, prescriptions, clientRoomLoaders, scoutNotes, patientId]);

  /** Ongoing problems, pinned above the record so they are not buried in the timeline. */
  const chronicProblems = useMemo(
    () => problems.filter((p) => p.acuity === 'chronic' && p.status !== 'resolved'),
    [problems]
  );

  const resolveProblem = async (p: PatientProblem) => {
    setResolvingProblemId(p.id);
    try {
      const updated = await updateProblem(p.id, { status: 'resolved' });
      setProblems((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
    } finally {
      setResolvingProblemId(null);
    }
  };

  const discontinueMedication = async (rx: PatientPrescription) => {
    setDiscontinuingRxId(rx.id);
    try {
      const updated = await updatePatientPrescription(rx.id, { discontinued: true });
      setPrescriptions((prev) => prev.map((m) => (m.id === rx.id ? updated : m)));
    } finally {
      setDiscontinuingRxId(null);
    }
  };

  const dateRangeMs = useMemo(() => {
    const start = Date.parse(dateStart);
    const end = Date.parse(dateEnd + 'T23:59:59');
    return { start, end, valid: Number.isFinite(start) && Number.isFinite(end) };
  }, [dateStart, dateEnd]);

  const filteredChartRows = useMemo(() => {
    if (!dateRangeMs.valid) return chartRows;
    return filterRowsByDateRange(chartRows, dateRangeMs.start, dateRangeMs.end);
  }, [chartRows, dateRangeMs]);

  const groupedByDate = useMemo(
    () => groupChartRowsByLocalDate(filteredChartRows),
    [filteredChartRows]
  );

  const monitoringForms = medicalRecord?.anestheticMonitorForms ?? [];
  const monitoringCount = monitoringForms.length;
  const prescriptionGroups = useMemo(() => groupPrescriptionTreatmentRows(rxItems), [rxItems]);

  const chronicMedications = useMemo(
    () => prescriptions.filter((rx) => rx.acuity === 'chronic' && !rx.discontinuedAt),
    [prescriptions]
  );
  /**
   * Rx written in Scout. eVet rows are excluded because they already appear in
   * `prescriptionGroups`, which is built from the imported treatment lines.
   */
  const scoutPrescriptions = useMemo(
    () => prescriptions.filter(isScoutWrittenPrescription),
    [prescriptions]
  );
  const prescriptionCount = rxItems.length + scoutPrescriptions.length;

  const complaints = medicalRecord?.complaints ?? [];
  const communicationLogs = medicalRecord?.communicationLogs ?? [];
  const histories = medicalRecord?.histories ?? [];
  const exams = medicalRecord?.exams ?? [];
  const examIdParam = searchParams.get('examId');
  const historyIdParam = searchParams.get('historyId');
  const noteIdParam = searchParams.get('noteId');
  const chartNotes = medicalRecord?.chartNotes ?? [];
  const chartDocuments = medicalRecord?.chartDocuments ?? [];

  useEffect(() => {
    if (!examIdParam || exams.length === 0) return;
    const found = exams.find((e) => {
      if (!e || typeof e !== 'object') return false;
      return String((e as Record<string, unknown>).id) === examIdParam;
    });
    if (found && typeof found === 'object') setSelectedExam(found as Record<string, unknown>);
  }, [examIdParam, exams]);

  useEffect(() => {
    if (!historyIdParam || histories.length === 0) return;
    const found = histories.find((e) => {
      if (!e || typeof e !== 'object') return false;
      return String((e as Record<string, unknown>).id) === historyIdParam;
    });
    if (found && typeof found === 'object') {
      setSelectedMedicalNote({
        title: 'Medical note',
        record: found as Record<string, unknown>,
      });
    }
  }, [historyIdParam, histories]);

  useEffect(() => {
    if (!noteIdParam || chartNotes.length === 0) return;
    const found = chartNotes.find((e) => {
      if (!e || typeof e !== 'object') return false;
      return String((e as Record<string, unknown>).id) === noteIdParam;
    });
    if (found && typeof found === 'object') {
      setSelectedMedicalNote({
        title: 'Medical note',
        record: found as Record<string, unknown>,
      });
    }
  }, [noteIdParam, chartNotes]);

  const diagnoses = medicalRecord?.diagnoses ?? [];
  const labPairs = medicalRecord?.labOrders ?? [];
  const labChartRows = useMemo(
    () => chartRows.filter((r) => r.source === 'lab'),
    [chartRows]
  );
  const wellnessPlans = medicalRecord?.wellnessPlans ?? [];
  const reminderSplit = useMemo(() => {
    const lines = parseRemindersFromMedicalRecord(medicalRecord, practiceTz);
    return splitActiveAndOverdueReminders(lines);
  }, [medicalRecord, practiceTz]);
  const briefs = useMemo(() => {
    return listLocalBriefsForPatient(patientId)
      .filter((s) => s.status !== 'archived')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [patientId, chartSection]);
  const latestBrief = briefs[0] ?? null;
  const latestCaseSummary = useMemo(
    () => listCaseHistorySummaries(patientId)[0] ?? null,
    [patientId, chartSection]
  );

  const weightHistoryPoints = useMemo(() => {
    const wh = medicalRecord?.weightHistory ?? [];
    const pts: { serviceDate: string; weight: number }[] = [];
    for (const raw of wh) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const w = Number(o.weight);
      const sd = pickStr(o.serviceDate);
      if (!sd || !Number.isFinite(w)) continue;
      pts.push({ serviceDate: sd, weight: w });
    }
    pts.sort((a, b) => Date.parse(a.serviceDate) - Date.parse(b.serviceDate));
    return pts;
  }, [medicalRecord]);

  const toggleRxExpand = (id: string) => {
    setExpandedRxKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openFinancial = (refill?: FinancialRefillPrefill | null) => {
    if (!clientId) return;
    writeFinancialPrefill(refill ?? null);
    navigate(
      buildClientFinancialHref({
        clientId,
        invoice: 'new',
        patientId,
      })
    );
  };

  const toggleChartRowExpand = (id: string) => {
    setExpandedChartRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroupExpanded = (key: string, open: boolean) => {
    setGroupOpen((o) => ({ ...o, [key]: open }));
  };

  const expandAllGroups = () => {
    const next: Record<string, boolean> = {};
    for (const k of GROUP_KEYS) next[k] = true;
    setGroupOpen(next);
  };

  const showDateFilters = mrTab === 'byDate' || mrTab === 'byDateDetail';

  const handleMrShowAll = () => {
    setDateStart('2000-01-01');
    setDateEnd(new Date().toISOString().slice(0, 10));
  };

  if (loading) {
    return <div className="pims-detail__loading">Loading patient…</div>;
  }

  if (error || !payload) {
    return (
      <div className="pims-detail">
        <div className="pims-detail__error">{error ?? 'Patient not found.'}</div>
        <button type="button" className="pims-detail__link" onClick={onBack}>
          Close
        </button>
      </div>
    );
  }

  const record = payload as Record<string, unknown>;
  const scoutState = scoutManagedState(record, 'patient');
  const isActive = record.isActive === true || record.active === true;

  /** Refreshes local state from a write response, falling back to a re-fetch. */
  async function applyWriteResult(updated: unknown) {
    let next: Record<string, unknown> | null = null;
    if (updated && typeof updated === 'object' && !Array.isArray(updated)) {
      next = updated as Record<string, unknown>;
    } else {
      const data = await fetchPatientByIdStaff(patientId);
      next = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    }
    if (next) setPayload(next);
  }

  async function saveFields(body: ScoutPatientWrite) {
    await applyWriteResult(await patchPatient(patientId, body));
  }

  async function handlePhotoUpload(file: File | null) {
    if (!file || uploadingPhoto) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setSaveError('Choose a JPEG, PNG, GIF, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setSaveError('The image must be 5 MB or smaller.');
      return;
    }

    setUploadingPhoto(true);
    setSaveError(null);
    try {
      const result = await uploadPetImage(patientId, file);
      setPayload((current) =>
        current ? { ...current, imageUrl: result.imageUrl } : current
      );
      setPhotoFailed(false);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Could not upload the patient photo.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  function requestSummarize() {
    setChartSection('history');
    setSummarizeRequestId((n) => n + 1);
  }

  function startEpiphanyForThisPatient() {
    navigate(`/schedule/epiphany?new=1&patientId=${encodeURIComponent(patientId)}&view=patients`);
  }

  function startAppointmentForThisPatient() {
    if (!canBookAppointment) {
      navigate('/schedule/home');
      return;
    }
    if (!startFreshNewAppointmentRouting()) return;
    if (clientId) {
      writeRoutingChartBookIntent({
        clientId,
        patientId,
        clientDisplayLabel: cname !== '—' ? cname : undefined,
        patientName: pname || undefined,
      });
    }
    markSchedulerHandoffPreferRoutingDoctor();
    navigate('/schedule/routing');
  }

  async function handleRemoveReminder(reminder: { id: string; label: string }) {
    const reminderId = Number(reminder.id);
    if (!Number.isFinite(reminderId) || reminderId <= 0) {
      setSaveError('Could not delete this reminder.');
      setPendingDeleteReminder(null);
      return;
    }
    setRemovingReminderId(reminder.id);
    setSaveError(null);
    try {
      await patchReminder(reminderId, { isHidden: true });
      setMedicalRecord((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          reminders: (prev.reminders ?? []).filter((row) => {
            if (!row || typeof row !== 'object') return true;
            return String((row as Record<string, unknown>).id) !== reminder.id;
          }),
        };
      });
      setPendingDeleteReminder(null);
    } catch (err) {
      setSaveError(extractPatientSaveErr(err));
    } finally {
      setRemovingReminderId(null);
    }
  }

  async function handleToggleActive() {
    if (isActive) {
      const ok = await appConfirm({
        title: 'Deactivate pet?',
        message: `Deactivate ${pname}? The pet stays in Scout with its full medical history, but is hidden from active lists.`,
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      await applyWriteResult(
        isActive ? await deactivatePatient(patientId) : await reactivatePatient(patientId)
      );
    } catch (err) {
      setSaveError(extractPatientSaveErr(err));
    } finally {
      setBusy(false);
    }
  }

  const dob = pickStr(payload.dateOfBirth) ?? pickStr(payload.dob);
  const ageStr = ageFromDob(dob);
  const weightLb = pickStr(payload.weight) ?? pickStr(payload.weightLbs);
  const weightKg = pickStr(payload.weightKg);
  const weightLine =
    weightLb || weightKg
      ? [weightLb ? `${weightLb} lbs` : null, weightKg ? `${weightKg} kg` : null]
          .filter(Boolean)
          .join(' / ')
      : null;

  const clientPhone =
    client &&
    (pickStr(client.phone) ?? pickStr(client.mobilePhone) ?? pickStr(client.homePhone) ?? null);
  const clientEmail =
    (client && pickStr(client.email)) ??
    pickStr(payload.clientEmail) ??
    pickStr(payload.ownerEmail);
  const reachPhones = clientReachPhones(householdClient ?? client);
  const reachEmails = clientReachEmails(householdClient ?? client);
  const reachPets = (() => {
    const fromHousehold = clientReachPets(householdClient?.patients);
    if (fromHousehold.length) return fromHousehold;
    const id = Number(patientId);
    if (Number.isFinite(id) && id > 0 && pname) return [{ id, name: pname }];
    return [];
  })();
  const defaultEmrPatientIds = Number.isFinite(Number(patientId)) && Number(patientId) > 0
    ? [Number(patientId)]
    : [];

  /** A 404 from the medical-record endpoint, as opposed to a record that exists but is empty. */
  const mrNotFound = medicalRecord === null && !mrLoadError;
  const wellnessPlanCount = wellnessPlans.length;
  const latestWeightPoint = weightHistoryPoints[weightHistoryPoints.length - 1];

  const signalment = signalmentParts(record, ageStr, weightLine);
  const clientId = client?.id != null ? String(client.id) : null;
  const petPhoto = mediaUrl(record.imageUrl);
  const membership = patientMembershipFromRecord(record);
  const membershipLabel =
    membership.membershipName?.trim() ||
    (wellnessPlans[0] && typeof wellnessPlans[0] === 'object'
      ? pickStr((wellnessPlans[0] as Record<string, unknown>).name) ??
        pickStr((wellnessPlans[0] as Record<string, unknown>).planName)
      : null) ||
    'Member';

  const detailValues: CardValues = {
    name: pickStr(record.name) ?? pname,
    dob: dobForInput(record),
    species: pickStr(record.species) ?? pickStr(record.speciesName) ?? '',
    speciesId: pickStr(record.speciesId) ?? '',
    breed: pickStr(record.breed) ?? pickStr(record.breedDescription) ?? '',
    breedId: pickStr(record.breedId) ?? '',
    sex: pickStr(record.sex) ?? '',
    neuterStatus: pickStr(record.neuterStatus) ?? '',
    color: pickStr(record.color) ?? '',
  };

  const detailFields: FieldSpec[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'dob', label: 'Date of birth', type: 'date', display: () => ageStr ?? dob ?? '' },
    {
      key: 'species',
      label: 'Species',
      renderInput: ({ values, setValue, id }) => (
        <SpeciesSelect
          id={id}
          speciesName={values.species ?? ''}
          speciesId={values.speciesId ?? ''}
          options={speciesOptions}
          onPick={({ speciesId, speciesName }) => {
            setValue('speciesId', speciesId);
            setValue('species', speciesName);
            setValue('breed', '');
            setValue('breedId', '');
          }}
        />
      ),
    },
    {
      key: 'breed',
      label: 'Breed',
      renderInput: ({ values, setValue, id }) => (
        <BreedPicker
          id={id}
          practiceId={practiceId}
          speciesId={values.speciesId ?? ''}
          breedName={values.breed ?? ''}
          onPick={({ breedId, breedName }) => {
            setValue('breedId', breedId);
            setValue('breed', breedName);
          }}
        />
      ),
    },
    { key: 'sex', label: 'Sex', type: 'select', options: SEX_OPTIONS },
    { key: 'neuterStatus', label: 'Spay / neuter', type: 'select', options: NEUTER_OPTIONS },
    { key: 'color', label: 'Color' },
  ];

  return (
    <div className="pims-detail pims-detail--emr">
      {householdClientId || householdPets.length ? (
        <nav className="pims-emr-household" aria-label="Household">
          {householdClientId ? (
            <Link
              className="pims-emr-household__client"
              to={`${clientsBasePath}?clientId=${encodeURIComponent(householdClientId)}`}
            >
              <User size={14} aria-hidden />
              <span>
                <span className="pims-emr-household__kind">Client</span>
                {cname}
              </span>
            </Link>
          ) : null}
          {householdPets.length ? (
            <ul className="pims-emr-household__pets">
              {householdPets.map((pet) => {
                const current = pet.id === patientId;
                return (
                  <li key={pet.id}>
                    {current ? (
                      <span className="pims-emr-household__pet is-current" aria-current="page">
                        <PetThumb src={pet.imageUrl} size={22} className="pims-emr-household__pet-img" />
                        {pet.name}
                      </span>
                    ) : (
                      <Link
                        className={`pims-emr-household__pet${pet.active ? '' : ' is-inactive'}`}
                        to={`${patientsListPath}?patientId=${encodeURIComponent(pet.id)}`}
                      >
                        <PetThumb src={pet.imageUrl} size={22} className="pims-emr-household__pet-img" />
                        {pet.name}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </nav>
      ) : null}

      <DetailHeader
        avatar={
          petPhoto && !photoFailed ? (
            <img
              className="pims-detail__avatar pims-detail__avatar--img"
              src={petPhoto}
              alt={`${pname}`}
              width={56}
              height={56}
              onError={() => setPhotoFailed(true)}
            />
          ) : undefined
        }
        title={
          <span className="pims-emr-title">
            {pname}
            {membership.isMember ? (
              <Heart
                className="pims-emr-title__heart"
                size={18}
                fill="#dc2626"
                color="#dc2626"
                strokeWidth={1.75}
                aria-label={membershipLabel}
              />
            ) : null}
          </span>
        }
        badges={
          <>
            <PimsBadge tone={badge.variant}>{badge.label}</PimsBadge>
            {scoutState.scoutManaged ? (
              <PimsBadge tone="info" title={scoutState.title}>
                {scoutState.label}
              </PimsBadge>
            ) : null}
          </>
        }
        summary={
          <>
            {membership.isMember ? (
              <span className="pims-emr-membership">
                <Heart size={12} fill="#dc2626" color="#dc2626" strokeWidth={1.75} aria-hidden />
                {membershipLabel}
              </span>
            ) : null}
            {signalment.length ? signalment.join(' · ') : 'No signalment recorded'}
          </>
        }
        reach={
          <>
            <li>
              <User size={15} aria-hidden />
              {clientId ? (
                <Link
                  className="pims-detail__reach-client"
                  to={`${clientsBasePath}?clientId=${encodeURIComponent(clientId)}`}
                >
                  {cname}
                </Link>
              ) : (
                cname
              )}
            </li>
            {addressLine && addressLine !== '—' ? (
              <li>
                <MapPin size={15} aria-hidden />
                <span>
                  {addressLine}
                  {ownerZone ? (
                    <span className="pims-emr-zone-badge">Zone {ownerZone.replace(/^Zone\s+/i, '')}</span>
                  ) : null}
                </span>
              </li>
            ) : ownerZone ? (
              <li>
                <MapPin size={15} aria-hidden />
                <span className="pims-emr-zone-badge">Zone {ownerZone.replace(/^Zone\s+/i, '')}</span>
              </li>
            ) : null}
            {(reachPhones.length ? reachPhones : clientPhone ? [{ label: 'Primary', phone: clientPhone, sms: true }] : []).map(
              (row) => (
                <li key={`${row.label}-${row.phone}`}>
                  <Phone size={15} aria-hidden />
                  {reachPhones.length > 1 ? (
                    <span className="client-reach-kind">{row.label}</span>
                  ) : null}
                  <ClientReachLink onClick={(el) => reach.openPhoneMenu(row.phone, el)}>
                    {row.phone}
                  </ClientReachLink>
                </li>
              ),
            )}
            {(reachEmails.length ? reachEmails : clientEmail ? [{ label: 'Primary', email: clientEmail }] : []).map(
              (row) => (
                <li key={`${row.label}-${row.email}`}>
                  <Mail size={15} aria-hidden />
                  {reachEmails.length > 1 ? (
                    <span className="client-reach-kind">{row.label}</span>
                  ) : null}
                  <ClientReachEmailLink onClick={() => reach.openEmail(row.email)}>
                    {row.email}
                  </ClientReachEmailLink>
                </li>
              ),
            )}
          </>
        }
        afterReach={
          patientAlert || ownerAlert || connectionNotes ? (
            <div
              className={`pims-emr-header-alerts${
                [patientAlert, ownerAlert, connectionNotes].filter(Boolean).length === 1
                  ? ' pims-emr-header-alerts--single'
                  : ''
              }`}
            >
              {patientAlert ? (
                <div className="pims-emr-alert-box" role="alert">
                  <span className="pims-emr-alert-box__label">Patient alerts</span>
                  {patientAlert}
                </div>
              ) : null}
              {ownerAlert ? (
                <div className="pims-emr-alert-box" role="alert">
                  <span className="pims-emr-alert-box__label">Client alerts</span>
                  {ownerAlert}
                </div>
              ) : null}
              {connectionNotes ? (
                <div className="pims-emr-alert-box pims-emr-alert-box--connection">
                  <span className="pims-emr-alert-box__label">Connection Notes (staff only)</span>
                  {connectionNotes}
                </div>
              ) : null}
            </div>
          ) : null
        }
        actions={
          <>
            <label
              className="pims-detail__btn-secondary"
              aria-disabled={uploadingPhoto}
            >
              <Camera size={14} aria-hidden />
              {uploadingPhoto ? 'Uploading…' : petPhoto && !photoFailed ? 'Change photo' : 'Add photo'}
              <input
                className="pims-detail__photo-input"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                disabled={uploadingPhoto}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0] ?? null;
                  void handlePhotoUpload(file);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <button
              type="button"
              className="pims-detail__btn-primary"
              onClick={startAppointmentForThisPatient}
            >
              <Plus size={14} aria-hidden />
              Appointment
            </button>
            <button
              type="button"
              className="pims-detail__btn-danger"
              onClick={handleToggleActive}
              disabled={busy}
            >
              {isActive ? <UserX size={14} aria-hidden /> : <UserCheck size={14} aria-hidden />}
              {isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          </>
        }
      />

      <div className="brief-pills" role="tablist" aria-label="Patient record sections">
        {PATIENT_CHART_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={chartSection === t.id}
            className={`brief-pill${chartSection === t.id ? ' is-active' : ''}`}
            onClick={() => setChartSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <PimsChartWorkBar
        patientId={patientId}
        patientName={pname}
        clientId={clientId}
        clientName={cname !== '—' ? cname : 'Client'}
        clientPhone={clientPhone || reachPhones[0]?.phone || null}
        onSummarize={requestSummarize}
        onEpiphany={startEpiphanyForThisPatient}
        onInvoice={() => openFinancial()}
        onRecordsChanged={() => void reloadChartData()}
        onTextClient={clientId ? () => reach.openSms(reachPhones[0]?.phone ?? clientPhone, false) : undefined}
        onEmailClient={clientId ? () => reach.openEmail(reachEmails[0]?.email ?? clientEmail) : undefined}
      />

      {chartSection !== 'chart' ? (
        <BriefPatientPanel
          patientId={patientId}
          tab={chartSection}
          onTab={(t) => setChartSection(t === 'info' ? 'chart' : t)}
          practiceTz={practiceTz}
          embedded
          summarizeRequestId={summarizeRequestId}
          onOpenSession={(id) => navigate(`/schedule/epiphany?sessionId=${encodeURIComponent(id)}`)}
          onNew={startEpiphanyForThisPatient}
        />
      ) : null}

      {chartSection === 'chart' && saveError ? <p className="pims-detail__banner-error">{saveError}</p> : null}

      {chartSection === 'chart' ? (
      <>
      <div className="pims-emr-story">
        <section className="pims-emr-story__card pims-emr-story__card--visits">
          <PimsAppointmentsSection
            variant="patient"
            compact
            practiceId={PIMS_DETAIL_PRACTICE_ID}
            patientId={patientId}
            patientRecord={record}
          />
        </section>

        <section className="pims-emr-story__card" aria-labelledby="pims-emr-reminders">
          <h3 id="pims-emr-reminders">
            <Bell size={15} aria-hidden />
            Reminders
          </h3>
          <div className="pims-emr-story__block">
            <h4 className="pims-emr-story__sub pims-emr-story__sub--overdue">
              Past due ({reminderSplit.overdue.length})
            </h4>
            {reminderSplit.overdue.length === 0 ? (
              <p className="pims-emr-story__muted">None</p>
            ) : (
              <ul className="pims-emr-story__list pims-emr-story__list--overdue">
                {reminderSplit.overdue.map((r) => (
                  <li key={r.id} className="pims-emr-story__reminder">
                    <span>{r.label}</span>
                    <button
                      type="button"
                      className="pims-emr-story__reminder-remove"
                      aria-label={`Delete reminder ${r.label}`}
                      disabled={removingReminderId === r.id}
                      onClick={() => setPendingDeleteReminder(r)}
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="pims-emr-story__block">
            <h4 className="pims-emr-story__sub">Upcoming ({reminderSplit.active.length})</h4>
            {reminderSplit.active.length === 0 ? (
              <p className="pims-emr-story__muted">None</p>
            ) : (
              <ul className="pims-emr-story__list">
                {reminderSplit.active.map((r) => (
                  <li key={r.id} className="pims-emr-story__reminder">
                    <span>{r.label}</span>
                    <button
                      type="button"
                      className="pims-emr-story__reminder-remove"
                      aria-label={`Delete reminder ${r.label}`}
                      disabled={removingReminderId === r.id}
                      onClick={() => setPendingDeleteReminder(r)}
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="pims-emr-story__card" aria-labelledby="pims-emr-care">
          <h3 id="pims-emr-care">
            <Activity size={15} aria-hidden />
            Ongoing care
          </h3>
          <div className="pims-emr-story__block">
            <h4 className="pims-emr-story__sub">Problems</h4>
            {chronicProblems.length === 0 ? (
              <p className="pims-emr-story__muted">No chronic problems</p>
            ) : (
              <ul className="pims-emr-story__chips">
                {chronicProblems.map((p) => (
                  <li key={p.id}>
                    <span>{p.label}</span>
                    <button
                      type="button"
                      disabled={resolvingProblemId != null}
                      onClick={() => void resolveProblem(p)}
                    >
                      Resolved
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="pims-emr-story__block">
            <h4 className="pims-emr-story__sub">
              <Pill size={13} aria-hidden /> Medications
            </h4>
            {chronicMedications.length === 0 ? (
              <p className="pims-emr-story__muted">No chronic medications</p>
            ) : (
              <ul className="pims-emr-story__chips pims-emr-story__chips--meds">
                {chronicMedications.map((rx) => (
                  <li key={rx.id}>
                    <span>{rx.name}</span>
                    <button
                      type="button"
                      disabled={discontinuingRxId != null}
                      onClick={() => void discontinueMedication(rx)}
                    >
                      Stop
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="pims-emr-prep">
        <section className="pims-emr-prep__card" aria-labelledby="pims-emr-case">
          <h3 id="pims-emr-case">
            <Sparkles size={15} aria-hidden />
            Case summary
          </h3>
          {latestCaseSummary ? (
            <>
              <p className="pims-emr-prep__excerpt">{excerptText(latestCaseSummary.summary)}</p>
              <p className="pims-emr-prep__meta">
                As of {formatChartDateShort(latestCaseSummary.asOfDate || latestCaseSummary.createdAt)}
              </p>
            </>
          ) : (
            <p className="pims-emr-story__muted">
              No chart summary yet. Summarize as of today before you walk in.
            </p>
          )}
          <div className="pims-emr-story__actions">
            <button type="button" onClick={requestSummarize}>
              {latestCaseSummary ? 'Open case history' : 'Summarize as of today'}
            </button>
          </div>
        </section>

        <section className="pims-emr-prep__card" aria-labelledby="pims-emr-epiphany">
          <h3 id="pims-emr-epiphany">
            <NotebookPen size={15} aria-hidden />
            Epiphany
          </h3>
          {latestBrief ? (
            <>
              <p className="pims-emr-prep__title">{latestBrief.title}</p>
              <p className="pims-emr-prep__meta">
                {BRIEF_KIND_LABEL[latestBrief.kind]} · {formatChartDateShort(latestBrief.updatedAt)}
                {briefs.length > 1 ? ` · ${briefs.length} notes` : null}
              </p>
              {latestBrief.transcript.trim() ? (
                <p className="pims-emr-prep__excerpt">{excerptText(latestBrief.transcript, 220)}</p>
              ) : null}
            </>
          ) : soapNotes.length > 0 ? (
            <p className="pims-emr-story__line">{soapNotes.length} SOAP note(s) in Scout</p>
          ) : (
            <p className="pims-emr-story__muted">
              No prep notes yet. Record one here and it will inject into SOAP Subjective.
            </p>
          )}
          <div className="pims-emr-story__actions">
            {latestBrief ? (
              <button
                type="button"
                onClick={() =>
                  navigate(`/schedule/epiphany?sessionId=${encodeURIComponent(latestBrief.id)}`)
                }
              >
                Open last note
              </button>
            ) : null}
            <button type="button" onClick={() => setChartSection('sessions')}>
              All prep
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/schedule/epiphany?new=1&patientId=${encodeURIComponent(patientId)}&view=patients`
                )
              }
            >
              New prep
            </button>
          </div>
        </section>
      </div>

      <div className="pims-emr-about-row">
        <button
          type="button"
          className="pims-emr-about-toggle"
          aria-expanded={showAbout}
          onClick={() => {
            setShowAbout((v) => !v);
            setShowEditPet(false);
          }}
        >
          {showAbout ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          Weight
        </button>
        <button
          type="button"
          className="pims-emr-about-toggle"
          aria-expanded={showEditPet}
          onClick={() => {
            setShowEditPet((v) => !v);
            setShowAbout(false);
          }}
        >
          {showEditPet ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          Edit pet
        </button>
      </div>
      {showAbout ? (
        <div className="pims-patient-detail__weight-only">
          <EditableCard
            title="Weight"
            icon={<Weight size={16} aria-hidden />}
            fields={[
              {
                key: 'weight',
                label: 'On file',
                type: 'number',
                display: (v) => `${v} lbs`,
              },
            ]}
            values={{ weight: pickStr(record.weight) ?? '' }}
            columns={1}
            emptyHint="No weight on file."
            onSave={(v) => {
              const w = Number(v.weight.trim());
              return saveFields({
                weight: v.weight.trim() && Number.isFinite(w) ? w : null,
              });
            }}
          >
            <dl className="pims-detail__facts pims-detail__facts--1 pims-emr-weight-exam">
              <div className="pims-detail__fact">
                <dt>Last exam</dt>
                <dd className={latestWeightPoint ? undefined : 'pims-detail__fact-empty'}>
                  {latestWeightPoint
                    ? `${latestWeightPoint.weight} lbs · ${formatChartDateShort(latestWeightPoint.serviceDate)}`
                    : '—'}
                </dd>
              </div>
            </dl>
            <WeightSparkline points={weightHistoryPoints} />
          </EditableCard>
          <TechnicalDetails
            note="Identifiers and implant tags. Chart edits stay in Scout."
            rows={[
              { label: 'Scout ID', value: String(record.id ?? patientId) },
              { label: 'Microchip', value: pickStr(record.microchip) },
              { label: 'Rabies tag', value: pickStr(record.rabiesTag) },
              { label: 'Created', value: formatChartDateTime(pickStr(record.created)) },
              { label: 'Updated', value: formatChartDateTime(pickStr(record.updated)) },
            ]}
          />
        </div>
      ) : null}
      {showEditPet ? (
        <div className="pims-detail__columns pims-patient-detail__summary-cols">
          <div className="pims-detail__col">
            <EditableCard
              title="Pet details"
              icon={<PawPrint size={16} aria-hidden />}
              fields={detailFields}
              values={detailValues}
              onSave={(v) => {
                const body: ScoutPatientWrite = {
                  name: v.name.trim() || null,
                  color: v.color.trim() || null,
                  sex: v.sex.trim() || null,
                  neuterStatus: v.neuterStatus.trim() || null,
                  dob: dobToApi(v.dob),
                };

                const sid = parseInt((v.speciesId ?? '').trim(), 10);
                if (Number.isFinite(sid)) body.speciesId = sid;
                else body.species = v.species.trim() || null;

                const bid = parseInt((v.breedId ?? '').trim(), 10);
                if (Number.isFinite(bid)) body.breedId = bid;
                else body.breed = v.breed.trim() || null;

                return saveFields(body);
              }}
            />
          </div>
          <div className="pims-detail__col">
            <EditableCard
              title="Patient alerts"
              icon={<AlertTriangle size={16} aria-hidden />}
              fields={[
                {
                  key: 'alerts',
                  label: 'Patient alerts',
                  type: 'textarea',
                  full: true,
                  placeholder: 'Muzzle required, drug reaction, handling notes…',
                  hint: 'Shown in red under this pet’s name.',
                },
              ]}
              values={{ alerts: pickStr(record.alerts) ?? '' }}
              columns={1}
              emptyHint="No patient alerts."
              onSave={(v) => saveFields({ alerts: v.alerts.trim() || null })}
            />
          </div>
        </div>
      ) : null}

      <section className="pims-patient-detail__mr" aria-labelledby="pims-mr-heading">
        <h2 id="pims-mr-heading" className="pims-patient-detail__mr-heading">
          <Stethoscope size={17} aria-hidden />
          Timeline
        </h2>
        <div className="pims-patient-detail__tabs" role="tablist">
          {(
            [
              ['byDate', 'By date'],
              ['prescriptions', `Rx (${prescriptionCount})`],
              ['labs', `Labs (${labPairs.length})`],
              ['wellness', `Wellness (${wellnessPlanCount})`],
              ['groups', 'By category'],
              ['monitoring', `Anesthesia (${monitoringCount})`],
              ['byDateDetail', 'Row details'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mrTab === id}
              className={`pims-patient-detail__tab${mrTab === id ? ' pims-patient-detail__tab--active' : ''}`}
              onClick={() => setMrTab(id as MrTab)}
            >
              {label}
            </button>
          ))}
        </div>

        {mrLoadError && (
          <p className="pims-patient-detail__mr-inline-error" role="status">
            {mrLoadError}
          </p>
        )}

        {showDateFilters && (
          <div className="pims-patient-detail__filters">
            <label>
              From
              <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </label>
            <button type="button" onClick={handleMrShowAll}>
              All dates
            </button>
            <button type="button" onClick={() => reloadChartData()}>
              Refresh
            </button>
          </div>
        )}

        {mrTab === 'byDate' && (
          <>
            <p className="pims-patient-detail__mr-count">
              Showing {filteredChartRows.length} out of {chartRows.length} entries
            </p>
            <div className="pims-patient-detail__mr-table-wrap">
              <table className="pims-patient-detail__mr-table pims-patient-detail__mr-table--condensed">
                <thead>
                  <tr>
                    <th className="pims-patient-detail__th-icon" aria-label="Expand" />
                    <th>Type</th>
                    <th>Description</th>
                    <th>Provider</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {mrNotFound ? (
                    <tr>
                      <td colSpan={5} className="pims-patient-detail__empty-cell">
                        This pet has no medical record yet.
                      </td>
                    </tr>
                  ) : groupedByDate.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="pims-patient-detail__empty-cell">
                        No entries in this date range.
                      </td>
                    </tr>
                  ) : (
                    groupedByDate.flatMap(({ dateKey, rows }) => [
                      <tr key={`g-${dateKey}`} className="pims-patient-detail__date-group">
                        <td colSpan={5}>{dateKey}</td>
                      </tr>,
                      ...rows.flatMap((r: ChartRow) => {
                        const open = expandedChartRowIds.has(r.id);
                        const canExpand = chartRowHasBody(r);
                        return [
                          <tr
                            key={r.id}
                            className={
                              canExpand ? 'pims-patient-detail__mr-row--clickable' : undefined
                            }
                            onClick={canExpand ? () => toggleChartRowExpand(r.id) : undefined}
                            aria-expanded={canExpand ? open : undefined}
                          >
                            <td className="pims-patient-detail__view-cell">
                              {canExpand ? (
                                open ? (
                                  <ChevronDown size={14} aria-hidden />
                                ) : (
                                  <ChevronRight size={14} aria-hidden />
                                )
                              ) : null}
                            </td>
                            <td>
                              <span className="pims-patient-detail__type-inner">
                                <Check
                                  size={13}
                                  className="pims-patient-detail__row-icon pims-patient-detail__check"
                                  aria-hidden
                                />
                                {r.typeLabel}
                              </span>
                            </td>
                            <td>
                              {r.isCovered ? (
                                <span title="Membership covered" aria-label="Membership covered">
                                  ❤️{' '}
                                </span>
                              ) : null}
                              {r.description}
                            </td>
                            <td className="pims-patient-detail__provider">{r.provider}</td>
                            <td className="pims-patient-detail__when">
                              {formatChartDateTime(r.serviceDateIso)}
                            </td>
                          </tr>,
                          open ? (
                            <tr key={`${r.id}-body`} className="pims-patient-detail__expand-row">
                              <td colSpan={5}>
                                <ChartRowExpandBody row={r} />
                              </td>
                            </tr>
                          ) : null,
                        ];
                      }),
                    ])
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {mrTab === 'byDateDetail' && (
          <>
            <p className="pims-patient-detail__mr-count">
              Showing {filteredChartRows.length} out of {chartRows.length} entries
            </p>
            <div className="pims-patient-detail__mr-table-wrap">
              <table className="pims-patient-detail__mr-table pims-patient-detail__mr-table--detail pims-patient-detail__mr-table--condensed">
                <thead>
                  <tr>
                    <th className="pims-patient-detail__th-icon" aria-label="Expand" />
                    <th>Type</th>
                    <th>Description</th>
                    <th>Details</th>
                    <th>Provider</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {mrNotFound ? (
                    <tr>
                      <td colSpan={6} className="pims-patient-detail__empty-cell">
                        This pet has no medical record yet.
                      </td>
                    </tr>
                  ) : groupedByDate.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="pims-patient-detail__empty-cell">
                        No entries in this date range.
                      </td>
                    </tr>
                  ) : (
                    groupedByDate.flatMap(({ dateKey, rows }) => [
                      <tr key={`gd-${dateKey}`} className="pims-patient-detail__date-group">
                        <td colSpan={6}>{dateKey}</td>
                      </tr>,
                      ...rows.map((r: ChartRow) => {
                        const open = expandedChartRowIds.has(r.id);
                        return (
                          <tr
                            key={r.id}
                            className="pims-patient-detail__mr-row--clickable"
                            onClick={() => toggleChartRowExpand(r.id)}
                          >
                            <td>
                              <button
                                type="button"
                                className="pims-patient-detail__cell-expand"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleChartRowExpand(r.id);
                                }}
                                aria-expanded={open}
                                aria-label={open ? 'Collapse row' : 'Expand row'}
                              >
                                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            </td>
                            <td>{r.typeLabel}</td>
                            <td>
                              {r.isCovered ? (
                                <span title="Membership covered" aria-label="Membership covered">
                                  ❤️{' '}
                                </span>
                              ) : null}
                              {r.description}
                            </td>
                            <td
                              className={[
                                'pims-patient-detail__detail-cell',
                                open && r.detailHtml
                                  ? 'pims-patient-detail__detail-cell--rich'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {open ? (
                                r.detailHtml ? (
                                  <>
                                    {r.detailText?.trim() ? (
                                      <div className="pims-patient-detail__detail-meta">
                                        {r.detailText}
                                      </div>
                                    ) : null}
                                    <div
                                      className="pims-patient-detail__html-body"
                                      dangerouslySetInnerHTML={{ __html: r.detailHtml }}
                                    />
                                  </>
                                ) : (
                                  r.detailText || '—'
                                )
                              ) : (
                                (() => {
                                  if (r.detailHtml) {
                                    const meta = (r.detailText || '').trim();
                                    const plain = htmlToPlainText(r.detailHtml)
                                      .replace(/\s+/g, ' ')
                                      .trim();
                                    const joined = [meta, plain].filter(Boolean).join(' — ');
                                    return joined.length > 120
                                      ? `${joined.slice(0, 120)}…`
                                      : joined || '—';
                                  }
                                  const t = r.detailText || '—';
                                  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
                                })()
                              )}
                            </td>
                            <td>{r.provider}</td>
                            <td>{formatChartDateTime(r.serviceDateIso)}</td>
                          </tr>
                        );
                      }),
                    ])
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {mrTab === 'groups' && (
          <div className="pims-patient-detail__groups">
            <button
              type="button"
              className="pims-patient-detail__expand-all"
              onClick={expandAllGroups}
            >
              Expand All
            </button>
            {(
              [
                ['visits', 'Reason for Visits', complaints.length, complaints, false],
                [
                  'communications',
                  'Communications',
                  communicationLogs.length,
                  communicationLogs,
                  false,
                ],
                ['histories', 'History', histories.length, histories, false],
                ['soapNotes', 'SOAP notes (Scout)', soapNotes.length, soapNotes, false],
                ['exams', 'Exams', exams.length, exams, false],
                ['diagnoses', 'Diagnoses', diagnoses.length, diagnoses, false],
                ['treatments', 'Treatments', treatments?.length ?? 0, [], true],
                ['labs', 'Lab orders', labPairs.length, labPairs, false],
                [
                  'documents',
                  'Documents',
                  chartDocuments.length + clientRoomLoaders.length,
                  chartDocuments,
                  false,
                ],
                ['online', 'Online Activity', 0, [], false],
              ] as const
            ).map(([key, title, count, list, isTreatments]) => {
              const open = groupOpen[key] === true;
              const isTr = isTreatments;
              return (
                <div key={key} className="pims-patient-detail__accordion">
                  <button
                    type="button"
                    className="pims-patient-detail__accordion-head"
                    onClick={() => setGroupExpanded(key, !open)}
                    aria-expanded={open}
                  >
                    <span className="pims-patient-detail__accordion-chev">{open ? '▼' : '▶'}</span>
                    <span>
                      {title}
                      {!isTr && ` (${count})`}
                      {isTr && ` (${treatments.length})`}
                    </span>
                  </button>
                  {open && (
                    <div className="pims-patient-detail__accordion-body">
                      {key === 'online' && (
                        <p className="pims-patient-detail__muted">
                          Online retail activity isn&rsquo;t tracked in Scout.
                        </p>
                      )}
                      {key === 'treatments' && (
                        <>
                          {treatments.length === 0 && (
                            <p className="pims-patient-detail__muted">
                              No treatment plans recorded.
                            </p>
                          )}
                          {treatments.map((t) => (
                            <div key={t.id} className="pims-patient-detail__group-line">
                              <strong>Plan #{t.id}</strong>
                              {t.pimsId ? <span> · {t.pimsId}</span> : null}
                              <ul className="pims-patient-detail__muted">
                                {(t.treatmentItems ?? [])
                                  .filter((item) => !item.isDeleted && !item.isDeclined)
                                  .map((item) => {
                                    const name =
                                      item.inventoryItem?.name ||
                                      item.procedure?.name ||
                                      item.lab?.name ||
                                      'Line';
                                    return (
                                      <li key={item.id}>
                                        {name}
                                        {item.serviceDate
                                          ? ` — ${formatChartDateTime(item.serviceDate)}`
                                          : ''}
                                      </li>
                                    );
                                  })}
                              </ul>
                            </div>
                          ))}
                        </>
                      )}
                      {list &&
                        Array.isArray(list) &&
                        key !== 'treatments' &&
                        key !== 'online' &&
                        (list as unknown[]).length === 0 && (
                          <p className="pims-patient-detail__muted">No entries.</p>
                        )}
                      {key === 'visits' &&
                        complaints.map((row) => {
                          const o = row as Record<string, unknown>;
                          return (
                            <div key={String(o.id)} className="pims-patient-detail__group-line">
                              {pickStr(o.complaintName) ?? 'Complaint'} —{' '}
                              {formatChartDateTime(pickStr(o.serviceDate))}
                            </div>
                          );
                        })}
                      {key === 'communications' &&
                        communicationLogs.map((row) => {
                          const o = row as Record<string, unknown>;
                          const nested =
                            o.communicationMessageLog &&
                            typeof o.communicationMessageLog === 'object'
                              ? (o.communicationMessageLog as Record<string, unknown>)
                              : null;
                          const typeLabel =
                            pickStr(nested?.communicationTypeLabel) ??
                            pickStr(o.communicationTypeLabel);
                          const text =
                            pickStr(nested?.message) ??
                            pickStr(o.subject) ??
                            pickStr(o.description) ??
                            pickStr(nested?.body) ??
                            typeLabel ??
                            'Communication';
                          const displayLine = looksLikeHtmlFragment(text)
                            ? htmlToPlainText(text).replace(/\s+/g, ' ').trim()
                            : String(text).trim();
                          const truncated =
                            displayLine.length > 160
                              ? `${displayLine.slice(0, 160)}…`
                              : displayLine;
                          return (
                            <div key={String(o.id)} className="pims-patient-detail__group-line">
                              {typeLabel && typeLabel !== truncated
                                ? `${typeLabel} — ${truncated}`
                                : truncated}{' '}
                              —{' '}
                              {formatChartDateTime(
                                pickStr(o.serviceDate) ?? pickStr(o.sentAt) ?? pickStr(o.createdAt)
                              )}
                            </div>
                          );
                        })}
                      {key === 'histories' &&
                        histories.map((row) => {
                          const o = row as Record<string, unknown>;
                          return (
                            <button
                              key={String(o.id)}
                              type="button"
                              className="pims-patient-detail__exam-row"
                              onClick={() =>
                                setSelectedMedicalNote({ title: 'Medical note', record: o })
                              }
                            >
                              <span className="pims-patient-detail__exam-row-icons" aria-hidden>
                                <ChevronRight size={14} />
                              </span>
                              <span className="pims-patient-detail__exam-row-name">
                                {pickStr(o.formName) ?? 'Medical note'}
                              </span>
                              <span className="pims-patient-detail__exam-row-date">
                                {formatChartDateTime(pickStr(o.serviceDate))}
                              </span>
                            </button>
                          );
                        })}
                      {key === 'soapNotes' && soapNotes.length === 0 && (
                        <p className="pims-patient-detail__muted">
                          No SOAP notes charted in Scout for this patient.
                        </p>
                      )}
                      {key === 'soapNotes' &&
                        soapNotes.map((note) => {
                          const signed = note.status === 'completed';
                          const when = signed ? note.completedAt : note.created;
                          return (
                            <button
                              key={note.id}
                              type="button"
                              className="pims-patient-detail__exam-row"
                              onClick={() => setSelectedSoapNote(note)}
                            >
                              <span className="pims-patient-detail__exam-row-icons" aria-hidden>
                                {signed ? <Lock size={13} /> : <ChevronRight size={14} />}
                              </span>
                              <span className="pims-patient-detail__exam-row-name">
                                {note.mode === 'quick' ? 'Quick SOAP' : 'Comprehensive SOAP'}
                                <span
                                  className={`pims-patient-detail__soap-badge${
                                    signed ? '' : ' pims-patient-detail__soap-badge--open'
                                  }`}
                                >
                                  {signed ? 'Signed & locked' : 'Open'}
                                </span>
                              </span>
                              <span className="pims-patient-detail__exam-row-visit">
                                Visit #{note.appointmentId}
                              </span>
                              <span className="pims-patient-detail__exam-row-date">
                                {formatChartDateTime(when)}
                              </span>
                            </button>
                          );
                        })}
                      {key === 'exams' &&
                        exams.map((row) => {
                          const o = row as Record<string, unknown>;
                          const iso = pickStr(o.serviceDate);
                          const d = iso ? new Date(iso) : null;
                          const ampm =
                            d && !Number.isNaN(d.getTime())
                              ? d.getHours() < 12
                                ? 'AM'
                                : 'PM'
                              : '—';
                          return (
                            <button
                              key={String(o.id)}
                              type="button"
                              className="pims-patient-detail__exam-row"
                              onClick={() => setSelectedExam(o)}
                            >
                              <span className="pims-patient-detail__exam-row-icons" aria-hidden>
                                <ChevronRight size={14} />
                              </span>
                              <span className="pims-patient-detail__exam-row-name">
                                {pickStr(o.formName) ?? 'Exam — General'}
                              </span>
                              <span className="pims-patient-detail__exam-row-ampm">{ampm}</span>
                              <span className="pims-patient-detail__exam-row-date">
                                {formatChartDateTime(iso)}
                              </span>
                            </button>
                          );
                        })}
                      {key === 'diagnoses' &&
                        diagnoses.map((row) => {
                          const o = row as Record<string, unknown>;
                          return (
                            <div key={String(o.id)} className="pims-patient-detail__group-line">
                              {pickStr(o.name) ?? 'Diagnosis'} —{' '}
                              {formatChartDateTime(pickStr(o.serviceDate))}
                            </div>
                          );
                        })}
                      {key === 'labs' &&
                        labPairs.map((pair, idx) => {
                          const p = pair as { order?: Record<string, unknown> };
                          const o = p.order ?? {};
                          return (
                            <div
                              key={String(o.id ?? idx)}
                              className="pims-patient-detail__group-line"
                            >
                              {pickStr(o.labOrderType) ?? 'Lab'} —{' '}
                              {formatChartDateTime(pickStr(o.submittedDate))}
                            </div>
                          );
                        })}
                      {key === 'documents' &&
                        chartDocuments.map((row) => {
                          const o = row as Record<string, unknown>;
                          const kind = pickStr(o.description);
                          const name = pickStr(o.name) ?? 'Document';
                          return (
                            <button
                              key={String(o.id)}
                              type="button"
                              className="pims-patient-detail__exam-row"
                              onClick={() =>
                                setSelectedMedicalNote({ title: 'Document', record: o })
                              }
                            >
                              <span className="pims-patient-detail__exam-row-icons" aria-hidden>
                                <ChevronRight size={14} />
                              </span>
                              <span className="pims-patient-detail__exam-row-name">
                                {kind ? `${kind} — ${name}` : name}
                              </span>
                              <span className="pims-patient-detail__exam-row-date">
                                {formatChartDateTime(pickStr(o.serviceDate))}
                              </span>
                            </button>
                          );
                        })}
                      {key === 'documents' &&
                        clientRoomLoaders.map((rl) => {
                          const when =
                            rl.appointments?.[0]?.appointmentStart ?? rl.updated ?? rl.created ?? null;
                          return (
                            <button
                              key={`rl-${rl.id}`}
                              type="button"
                              className="pims-patient-detail__exam-row"
                              onClick={() => setEmbeddedRoomLoaderId(rl.id)}
                            >
                              <span className="pims-patient-detail__exam-row-icons" aria-hidden>
                                <ChevronRight size={14} />
                              </span>
                              <span className="pims-patient-detail__exam-row-name">
                                Room Loader — client submitted
                              </span>
                              <span className="pims-patient-detail__exam-row-date">
                                {formatChartDateTime(when)}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {mrTab === 'monitoring' && (
          <div className="pims-patient-detail__mr-table-wrap">
            <table className="pims-patient-detail__mr-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Service date</th>
                  <th>Surgeon / staff</th>
                  <th>Anesthesia</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {monitoringForms.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="pims-patient-detail__empty-cell">
                      No anesthesia monitoring recorded.
                    </td>
                  </tr>
                ) : (
                  monitoringForms.map((raw) => {
                    const o = raw as Record<string, unknown>;
                    const start = pickStr(o.anesthesiaStart);
                    const end = pickStr(o.anesthesiaEnd);
                    return (
                      <tr key={String(o.id)}>
                        <td>{pickStr(o.name) ?? '—'}</td>
                        <td>{formatChartDateTime(pickStr(o.serviceDate))}</td>
                        <td>{employeeNameFromUnknown(o.surgeonEmployee)}</td>
                        <td>{start || end ? `${start ?? '?'} → ${end ?? '?'}` : '—'}</td>
                        <td>{pickStr(o.description) ?? '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {mrTab === 'labs' && (
          <div className="pims-patient-detail__mr-table-wrap">
            <table className="pims-patient-detail__mr-table pims-patient-detail__mr-table--condensed">
              <thead>
                <tr>
                  <th className="pims-patient-detail__th-icon" aria-label="Expand" />
                  <th>Type</th>
                  <th>Notes / result</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {labChartRows.length === 0 && labPairs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="pims-patient-detail__empty-cell">
                      No lab orders on this chart.
                    </td>
                  </tr>
                ) : labChartRows.length > 0 ? (
                  labChartRows.flatMap((r) => {
                    const open = expandedChartRowIds.has(r.id);
                    const canExpand = chartRowHasBody(r);
                    return [
                      <tr
                        key={r.id}
                        className={canExpand ? 'pims-patient-detail__mr-row--clickable' : undefined}
                        onClick={canExpand ? () => toggleChartRowExpand(r.id) : undefined}
                        aria-expanded={canExpand ? open : undefined}
                      >
                        <td className="pims-patient-detail__view-cell">
                          {canExpand ? (
                            open ? (
                              <ChevronDown size={14} aria-hidden />
                            ) : (
                              <ChevronRight size={14} aria-hidden />
                            )
                          ) : null}
                        </td>
                        <td>
                          <span className="pims-patient-detail__type-inner">{r.typeLabel}</span>
                        </td>
                        <td>{r.description}</td>
                        <td className="pims-patient-detail__when">
                          {formatChartDateTime(r.serviceDateIso)}
                        </td>
                      </tr>,
                      open ? (
                        <tr key={`${r.id}-body`} className="pims-patient-detail__expand-row">
                          <td colSpan={4}>
                            <ChartRowExpandBody row={r} />
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })
                ) : (
                  labPairs.map((pair, idx) => {
                    const p = pair as { order?: Record<string, unknown>; result?: Record<string, unknown> };
                    const o = p.order ?? {};
                    const result = p.result;
                    return (
                      <tr key={String(o.id ?? idx)}>
                        <td />
                        <td>{pickStr(o.labOrderType) ?? 'Lab'}</td>
                        <td>
                          {[
                            pickStr(o.notes),
                            result ? pickStr(result.comments) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                        <td className="pims-patient-detail__when">
                          {formatChartDateTime(
                            pickStr(result?.reportDate) ??
                              pickStr(o.submittedDate) ??
                              pickStr(o.orderDate)
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {mrTab === 'prescriptions' && (
          <div className="pims-patient-detail__rx">
            <h3 className="pims-patient-detail__rx-title">Prescriptions</h3>

            {scoutPrescriptions.length > 0 && (
              <div className="pims-patient-detail__rx-group">
                <div className="pims-patient-detail__rx-group-head">
                  <span className="pims-patient-detail__rx-code">SCOUT</span>
                  <span>Written in Scout</span>
                </div>
                <table className="pims-patient-detail__mr-table">
                  <thead>
                    <tr>
                      <th className="pims-patient-detail__th-icon" />
                      <th>Start date</th>
                      <th>Name</th>
                      <th>Strength</th>
                      <th>Type</th>
                      <th>Refills</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {scoutPrescriptions.map((rx) => {
                      const key = `scout-rx-${rx.id}`;
                      const open = expandedRxKeys.has(key);
                      const directions = pickStr(rx.instructions);
                      return [
                        <tr
                          key={key}
                          className="pims-patient-detail__mr-row--clickable"
                          onClick={() => toggleRxExpand(key)}
                        >
                          <td className="pims-patient-detail__view-cell">
                            {open ? (
                              <ChevronDown size={14} className="pims-patient-detail__row-icon" />
                            ) : (
                              <ChevronRight size={14} className="pims-patient-detail__row-icon" />
                            )}
                          </td>
                          <td>{formatChartDateShort(rx.startDate)}</td>
                          <td>{rx.name}</td>
                          <td>{rx.strength ?? '—'}</td>
                          <td>
                            {rx.acuity === 'chronic'
                              ? 'Chronic'
                              : rx.acuity === 'acute'
                                ? 'Acute'
                                : '—'}
                          </td>
                          <td>
                            {rx.refill != null ? `${rx.refill} allowed` : '—'}
                            {rx.refillExpiration ? (
                              <span className="pims-patient-detail__muted">
                                {' '}
                                (exp {formatChartDateShort(rx.refillExpiration)})
                              </span>
                            ) : null}
                          </td>
                          <td>
                            {rx.discontinuedAt ? (
                              <span className="pims-patient-detail__muted">
                                Stopped {formatChartDateShort(rx.discontinuedAt)}
                              </span>
                            ) : (
                              'Active'
                            )}
                          </td>
                          <td>
                            {rx.discontinuedAt ? null : (
                              <button
                                type="button"
                                className="pims-patient-detail__linkish"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openFinancial({
                                    name: rx.name,
                                    qty: 1,
                                    instructions: directions ?? '',
                                    catalogItemId: rx.inventoryItemId,
                                  });
                                }}
                              >
                                Refill
                              </button>
                            )}
                          </td>
                        </tr>,
                        open ? (
                          <tr key={`${key}-body`} className="pims-patient-detail__expand-row">
                            <td colSpan={8}>
                              <div className="pims-patient-detail__expand-text">
                                {directions || 'No written directions on this prescription.'}
                              </div>
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {prescriptionGroups.length === 0 && scoutPrescriptions.length === 0 ? (
              <p className="pims-patient-detail__muted">No prescriptions recorded for this pet.</p>
            ) : (
              prescriptionGroups.map((g) => (
                <div key={g.code} className="pims-patient-detail__rx-group">
                  <div className="pims-patient-detail__rx-group-head">
                    <span className="pims-patient-detail__rx-code">{g.code}</span>
                    <span>{g.displayName}</span>
                  </div>
                  <table className="pims-patient-detail__mr-table">
                    <thead>
                      <tr>
                        <th className="pims-patient-detail__th-icon" />
                        <th>Start date</th>
                        <th>Doctor</th>
                        <th>Name</th>
                        <th>Quantity</th>
                        <th>Refills</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {g.entries.map((row, i) => {
                        const key = `${g.code}-${row.treatmentItemId ?? i}`;
                        const open = expandedRxKeys.has(key);
                        const directions = writtenDirections(row);
                        const qtyLabel =
                          pickStr(row.quantityLabel) ??
                          (row.quantity != null ? String(row.quantity) : null) ??
                          pickStr(row.quantityDispensed);
                        const refillsAllowed =
                          typeof row.refillsAllowed === 'number'
                            ? row.refillsAllowed
                            : Number(row.refillsAllowed);
                        return [
                          <tr
                            key={key}
                            className="pims-patient-detail__mr-row--clickable"
                            onClick={() => toggleRxExpand(key)}
                          >
                            <td className="pims-patient-detail__view-cell">
                              {open ? (
                                <ChevronDown size={14} className="pims-patient-detail__row-icon" />
                              ) : (
                                <ChevronRight size={14} className="pims-patient-detail__row-icon" />
                              )}
                            </td>
                            <td>{formatChartDateShort(pickStr(row.serviceDate))}</td>
                            <td>{prescriberFromRxRow(row)}</td>
                            <td>
                              {pickStr(row.productName) ?? pickStr(row.name) ?? g.displayName}
                            </td>
                            <td>{qtyLabel ?? '—'}</td>
                            <td>
                              {Number.isFinite(refillsAllowed) ? `${refillsAllowed} allowed` : '—'}
                              {pickStr(row.refillExpiration) ? (
                                <span className="pims-patient-detail__muted">
                                  {' '}
                                  (exp {formatChartDateShort(pickStr(row.refillExpiration))})
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="pims-patient-detail__linkish"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openFinancial(refillPrefillFromRxRow(row, g.displayName));
                                }}
                              >
                                Refill
                              </button>
                            </td>
                          </tr>,
                          open ? (
                            <tr key={`${key}-body`} className="pims-patient-detail__expand-row">
                              <td colSpan={7}>
                                <div className="pims-patient-detail__expand-text">
                                  {directions || 'No written directions on this prescription.'}
                                </div>
                              </td>
                            </tr>
                          ) : null,
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        )}

        {mrTab === 'wellness' && (
          <div className="pims-patient-detail__wellness">
            {wellnessPlans.length === 0 ? (
              <p className="pims-patient-detail__muted">
                No wellness plans on this medical record.
              </p>
            ) : (
              <ul className="pims-patient-detail__wellness-list">
                {wellnessPlans.map((raw) => {
                  const p = raw as Record<string, unknown>;
                  const label =
                    pickStr(p.name) ??
                    pickStr(p.planName) ??
                    pickStr(p.description) ??
                    `Plan #${String(p.id ?? '')}`;
                  return (
                    <li key={String(p.id)}>
                      <strong>{label}</strong>
                      {pickStr(p.pimsId) ? (
                        <span className="pims-patient-detail__muted"> · {pickStr(p.pimsId)}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
      </>
      ) : null}

      {selectedExam && medicalRecord ? (
        <PimsExamDetailModal
          exam={selectedExam}
          weightHistory={medicalRecord.weightHistory ?? []}
          patientAgeLabel={ageStr}
          patientWeightDisplay={weightLine}
          onClose={() => setSelectedExam(null)}
        />
      ) : null}

      {selectedMedicalNote ? (
        <PimsMedicalNoteModal
          title={selectedMedicalNote.title}
          record={selectedMedicalNote.record}
          onClose={() => setSelectedMedicalNote(null)}
        />
      ) : null}

      {selectedSoapNote ? (
        <PimsSoapNoteModal
          encounter={selectedSoapNote}
          patientName={pname || null}
          onClose={() => setSelectedSoapNote(null)}
        />
      ) : null}

      {embeddedRoomLoaderId != null ? (
        <EmbeddedRoomLoaderModal
          roomLoaderId={embeddedRoomLoaderId}
          onClose={() => setEmbeddedRoomLoaderId(null)}
        />
      ) : null}

      {pendingDeleteReminder ? (
        <DeleteReminderConfirm
          reminder={pendingDeleteReminder}
          patientName={pname}
          busy={removingReminderId === pendingDeleteReminder.id}
          onCancel={() => {
            if (removingReminderId) return;
            setPendingDeleteReminder(null);
          }}
          onConfirm={() => void handleRemoveReminder(pendingDeleteReminder)}
        />
      ) : null}

      {clientId && Number.isFinite(Number(clientId)) ? (
        <ClientReachHost
          action={reach.action}
          onAction={reach.setAction}
          clientId={Number(clientId)}
          clientLabel={cname !== '—' ? cname : 'Client'}
          phones={reachPhones.length ? reachPhones : clientPhone ? [{ label: 'Primary', phone: clientPhone, sms: true }] : []}
          pets={reachPets}
          defaultPatientIds={defaultEmrPatientIds}
          epiphanyPatientId={patientId}
          onRecordsChanged={() => void reloadChartData()}
        />
      ) : null}

    </div>
  );
}
