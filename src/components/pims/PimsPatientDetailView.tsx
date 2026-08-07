import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  PawPrint,
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  MapPin,
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
} from 'lucide-react';
import {
  deactivatePatient,
  fetchPatientByIdStaff,
  fetchPatientMedicalRecordStaff,
  patchPatient,
  reactivatePatient,
  type ScoutPatientWrite,
} from '../../api/patients';
import {
  getPatientTreatmentHistory,
  getPatientTreatmentMedications,
  type TreatmentWithItems,
} from '../../api/treatments';
import {
  listProblems,
  listPatientPrescriptions,
  listPatientVisitCharges,
  updateProblem,
  updatePatientPrescription,
  type PatientProblem,
  type PatientPrescription,
  type PostedVisitCharge,
} from '../../api/visitWorkflow';
import {
  buildChartRowsFromMedicalRecord,
  filterRowsByDateRange,
  groupChartRowsByLocalDate,
  type ChartRow,
  type MedicalRecordBundle,
} from '../../utils/patientChartFromMedicalRecord';
import { apiBaseUrl } from '../../api/http';
import { htmlToPlainText, looksLikeHtmlFragment } from '../../utils/sanitizeCommunicationHtml';
import { PimsExamDetailModal } from './PimsExamDetailModal';
import PimsAppointmentsSection from './PimsAppointmentsSection';
import { scoutManagedState } from '../../utils/pimsScoutManaged';
import { evetPatientLink } from '../../utils/evet';
import { patientSexDisplayFromRecord } from '../../utils/schedulerVisitDisplay';
import {
  AlertBanner,
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
  const p = pickStr(path);
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return `${apiBaseUrl.replace(/\/$/, '')}/${p.replace(/^\//, '')}`;
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
  return (
    [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() ||
    pickStr(c.name) ||
    `Client #${c.id ?? ''}`
  );
}

function formatAddressClient(c: Record<string, unknown>): string {
  const parts = [
    pickStr(c.address1) ?? pickStr(c.addressLine1),
    [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', '),
    pickStr(c.zip) ?? pickStr(c.zipcode),
    pickStr(c.country) ?? 'US',
  ].filter(Boolean);
  return parts.join(', ') || '—';
}

function alertText(
  p: Record<string, unknown>,
  client: Record<string, unknown> | null
): string | null {
  const direct =
    pickStr(p.clientAlert) ??
    pickStr(p.alert) ??
    pickStr(p.drivingAlert) ??
    pickStr(p.locationAlert);
  if (direct) return direct;
  if (client) {
    const fromStrings =
      pickStr(client.clientAlert) ??
      pickStr(client.drivingDirections) ??
      pickStr(client.homeDirections) ??
      pickStr(client.alertNotes) ??
      null;
    if (fromStrings) return fromStrings;
    const ca = client.alerts;
    if (Array.isArray(ca) && ca.length) {
      return ca
        .map((a) => (typeof a === 'string' ? a : pickStr((a as Record<string, unknown>)?.message)))
        .filter(Boolean)
        .join(' ');
    }
  }
  const arr = p.alerts;
  if (Array.isArray(arr) && arr.length) {
    return arr
      .map((a) => (typeof a === 'string' ? a : pickStr((a as Record<string, unknown>)?.message)))
      .filter(Boolean)
      .join(' ');
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
  });
}

function formatChartDateShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function vaccineHintName(name: string): boolean {
  return /\b(rabies|dapp|da2pp|distemper|parvov|parvo|leptosp|lepto|lyme|bordetella|bordet|fvrcp|felv|influenza|heartworm)\b/i.test(
    name
  );
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
  | 'wellness';

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
  'exams',
  'diagnoses',
  'treatments',
  'labs',
  'online',
] as const;

export default function PimsPatientDetailView({
  patientId,
  onBack,
  patientsListPath = '/pims/patients',
}: Props) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [medicalRecord, setMedicalRecord] = useState<MedicalRecordBundle | null>(null);
  const [mrLoadError, setMrLoadError] = useState<string | null>(null);
  const [rxItems, setRxItems] = useState<unknown[]>([]);
  const [problems, setProblems] = useState<PatientProblem[]>([]);
  const [visitCharges, setVisitCharges] = useState<PostedVisitCharge[]>([]);
  const [chronicMedications, setChronicMedications] = useState<PatientPrescription[]>([]);
  const [resolvingProblemId, setResolvingProblemId] = useState<string | null>(null);
  const [discontinuingRxId, setDiscontinuingRxId] = useState<number | null>(null);
  const [treatments, setTreatments] = useState<TreatmentWithItems[] | null>(null);
  const [treatmentsLoading, setTreatmentsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mrTab, setMrTab] = useState<MrTab>('byDate');
  const [dateStart, setDateStart] = useState('2000-01-01');
  const [dateEnd, setDateEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [expandedChartRowIds, setExpandedChartRowIds] = useState<Set<string>>(() => new Set());
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [selectedExam, setSelectedExam] = useState<Record<string, unknown> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const practiceId = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
  const speciesOptions = useSpeciesCatalog(practiceId);

  const location = useLocation();
  const clientsBasePath = location.pathname.startsWith('/schedule/')
    ? '/schedule/clients'
    : '/pims/clients';

  const reloadChartData = useCallback(
    async (isStale?: () => boolean) => {
      const id = patientId;
      setMrLoadError(null);
      const [patientData, mrData, rxData, problemRows, chronicMedRows, chargeRows] =
        await Promise.all([
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
          listPatientPrescriptions(Number(id), { activeChronicOnly: true }).catch(
            () => [] as PatientPrescription[]
          ),
          listPatientVisitCharges(Number(id)).catch(() => [] as PostedVisitCharge[]),
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
      setChronicMedications(chronicMedRows);
      setVisitCharges(chargeRows);
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
    setVisitCharges([]);
    setTreatments(null);
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
  }, [patientId]);

  useEffect(() => {
    setSaveError(null);
    setBusy(false);
  }, [patientId]);

  useEffect(() => {
    if (mrTab !== 'groups' || treatments != null || treatmentsLoading) return;
    let on = true;
    setTreatmentsLoading(true);
    getPatientTreatmentHistory(patientId)
      .then((rows) => {
        if (on) setTreatments(rows);
      })
      .catch(() => {
        if (on) setTreatments([]);
      })
      .finally(() => {
        if (on) setTreatmentsLoading(false);
      });
    return () => {
      on = false;
    };
  }, [mrTab, patientId, treatments, treatmentsLoading]);

  const client = payload ? clientBlockFromPatient(payload) : null;
  const pname = payload ? patientNameFrom(payload) : '';
  const patientPimsId = payload ? (pickStr(payload.pimsId) ?? String(payload.id ?? patientId)) : '';
  const cname = client ? clientDisplayName(client) : (pickStr(payload?.clientName) ?? '—');
  const alert = payload ? alertText(payload, client) : null;
  const badge = payload ? patientDetailStatus(payload) : { label: '—', variant: 'muted' as const };

  const chartRows = useMemo(
    () => buildChartRowsFromMedicalRecord(medicalRecord, problems, visitCharges),
    [medicalRecord, problems, visitCharges]
  );

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
      setChronicMedications((prev) =>
        updated.discontinuedAt
          ? prev.filter((m) => m.id !== rx.id)
          : prev.map((m) => (m.id === rx.id ? updated : m))
      );
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
  const prescriptionCount = rxItems.length;

  const complaints = medicalRecord?.complaints ?? [];
  const communicationLogs = medicalRecord?.communicationLogs ?? [];
  const histories = medicalRecord?.histories ?? [];
  const exams = medicalRecord?.exams ?? [];
  const diagnoses = medicalRecord?.diagnoses ?? [];
  const labPairs = medicalRecord?.labOrders ?? [];
  const remindersList = medicalRecord?.reminders ?? [];
  const vaccinationLogs = medicalRecord?.vaccinationLogs ?? [];
  const wellnessPlans = medicalRecord?.wellnessPlans ?? [];

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

  const remindersSorted = useMemo(() => {
    const rows = [...remindersList].filter((r) => r && typeof r === 'object') as Record<
      string,
      unknown
    >[];
    const due = (o: Record<string, unknown>) =>
      Date.parse(
        pickStr(o.dueDate) ??
          pickStr(o.reminderDate) ??
          pickStr(o.serviceDate) ??
          pickStr(o.createdAt) ??
          ''
      ) || 0;
    rows.sort((a, b) => due(a) - due(b));
    return rows;
  }, [remindersList]);

  const openExamFromChartRow = useCallback((r: ChartRow, examList: unknown[]) => {
    if (r.source !== 'exam') return;
    const m = /^exam:(.+)$/.exec(r.id);
    if (!m) return;
    const found = examList.find((e) => {
      if (!e || typeof e !== 'object') return false;
      return String((e as Record<string, unknown>).id) === m[1];
    });
    if (found && typeof found === 'object') setSelectedExam(found as Record<string, unknown>);
  }, []);

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
          Back to list
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

  async function handleToggleActive() {
    if (isActive) {
      const ok = window.confirm(
        `Deactivate ${pname}? The pet stays in Scout with its full medical history, but is hidden from active lists.`
      );
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
  const secondContact = client
    ? (pickStr(client.secondaryContact) ?? pickStr(client.secondOwnerName))
    : null;

  /** A 404 from the medical-record endpoint, as opposed to a record that exists but is empty. */
  const mrNotFound = medicalRecord === null && !mrLoadError;
  const wellnessPlanCount = wellnessPlans.length;
  const latestWeightPoint = weightHistoryPoints[weightHistoryPoints.length - 1];

  const signalment = signalmentParts(record, ageStr, weightLine);
  const clientId = client?.id != null ? String(client.id) : null;
  const petPhoto = mediaUrl(record.imageUrl);

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
    weight: pickStr(record.weight) ?? '',
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
    { key: 'weight', label: 'Weight', type: 'number', display: (v) => `${v} lbs` },
  ];

  return (
    <div className="pims-detail">
      <button type="button" className="pims-detail__back" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden />
        Back to patients
      </button>

      <DetailHeader
        avatar={
          petPhoto ? (
            <img
              className="pims-detail__avatar pims-detail__avatar--img"
              src={petPhoto}
              alt=""
              width={56}
              height={56}
            />
          ) : (
            <div className="pims-detail__avatar" aria-hidden>
              <PawPrint size={26} strokeWidth={1.6} />
            </div>
          )
        }
        title={pname}
        badges={
          <>
            <PimsBadge tone={badge.variant}>{badge.label}</PimsBadge>
            <PimsBadge tone={scoutState.scoutManaged ? 'info' : 'muted'} title={scoutState.title}>
              {scoutState.label}
            </PimsBadge>
          </>
        }
        summary={signalment.length ? signalment.join(' · ') : 'No signalment recorded'}
        reach={
          <>
            <li>
              <User size={15} aria-hidden />
              {clientId ? (
                <Link to={`${clientsBasePath}?clientId=${encodeURIComponent(clientId)}`}>
                  {cname}
                </Link>
              ) : (
                cname
              )}
            </li>
            {clientPhone ? (
              <li>
                <Phone size={15} aria-hidden />
                <a href={`tel:${clientPhone.replace(/[^\d+]/g, '')}`}>{clientPhone}</a>
              </li>
            ) : null}
            {clientEmail ? (
              <li>
                <Mail size={15} aria-hidden />
                <a href={`mailto:${clientEmail}`}>{clientEmail}</a>
              </li>
            ) : null}
          </>
        }
        actions={
          <>
            <a
              className="pims-detail__btn-secondary"
              href={evetPatientLink(patientPimsId)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} aria-hidden />
              eVet
            </a>
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

      {saveError ? <p className="pims-detail__banner-error">{saveError}</p> : null}

      {alert ? (
        <AlertBanner icon={<AlertTriangle size={20} aria-hidden />}>{alert}</AlertBanner>
      ) : null}

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
              const w = Number(v.weight.trim());
              body.weight = v.weight.trim() && Number.isFinite(w) ? w : null;

              // Prefer the catalog row; the API keeps the denormalized name column in step.
              // Free text is only sent when no row was picked, which preserves eVet oddities.
              const sid = parseInt((v.speciesId ?? '').trim(), 10);
              if (Number.isFinite(sid)) body.speciesId = sid;
              else body.species = v.species.trim() || null;

              const bid = parseInt((v.breedId ?? '').trim(), 10);
              if (Number.isFinite(bid)) body.breedId = bid;
              else body.breed = v.breed.trim() || null;

              return saveFields(body);
            }}
          />

          <EditableCard
            title="Alerts"
            icon={<AlertTriangle size={16} aria-hidden />}
            fields={[
              {
                key: 'alerts',
                label: 'Patient alerts',
                type: 'textarea',
                full: true,
                placeholder: 'Muzzle required, drug reaction, handling notes…',
                hint: 'Shown as a banner at the top of this pet and on their visits.',
              },
            ]}
            values={{ alerts: pickStr(record.alerts) ?? '' }}
            columns={1}
            emptyHint="No alerts. Add one for anything staff should know before handling this pet."
            onSave={(v) => saveFields({ alerts: v.alerts.trim() || null })}
          />
        </div>

        <div className="pims-detail__col">
          <Card title="Owner" icon={<User size={16} aria-hidden />}>
            <dl className="pims-detail__facts pims-detail__facts--1">
              <div className="pims-detail__fact">
                <dt>Client</dt>
                <dd>
                  {clientId ? (
                    <Link
                      className="pims-detail__link"
                      to={`${clientsBasePath}?clientId=${encodeURIComponent(clientId)}`}
                    >
                      {cname}
                    </Link>
                  ) : (
                    cname
                  )}
                </dd>
              </div>
              <div className="pims-detail__fact">
                <dt>Address</dt>
                <dd className={client ? undefined : 'pims-detail__fact-empty'}>
                  {client ? formatAddressClient(client) : '—'}
                </dd>
              </div>
              {secondContact ? (
                <div className="pims-detail__fact">
                  <dt>Second contact</dt>
                  <dd>{secondContact}</dd>
                </div>
              ) : null}
            </dl>
            <p className="pims-detail__muted pims-patient-detail__owner-note">
              <MapPin size={13} aria-hidden /> Owner details are edited on the client record.
            </p>
          </Card>

          <Card title="Weight" icon={<Weight size={16} aria-hidden />}>
            <dl className="pims-detail__facts pims-detail__facts--2">
              <div className="pims-detail__fact">
                <dt>On file</dt>
                <dd className={weightLine ? undefined : 'pims-detail__fact-empty'}>
                  {weightLine ?? '—'}
                </dd>
              </div>
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
          </Card>

          <TechnicalDetails
            note={
              scoutState.scoutManaged
                ? 'Scout owns this record. eVet imports will not overwrite the fields above.'
                : 'eVet still owns this record. Editing any field above hands ownership to Scout.'
            }
            rows={[
              { label: 'Scout ID', value: String(record.id ?? patientId) },
              { label: 'PIMS ID', value: pickStr(record.pimsId) },
              { label: 'PIMS type', value: pickStr(record.pimsType) },
              { label: 'Microchip', value: pickStr(record.microchip) },
              { label: 'Rabies tag', value: pickStr(record.rabiesTag) },
              { label: 'Created in Scout', value: formatChartDateTime(pickStr(record.created)) },
              { label: 'Updated in Scout', value: formatChartDateTime(pickStr(record.updated)) },
              {
                label: 'Created in eVet',
                value: formatChartDateShort(pickStr(record.externalCreated)),
              },
              {
                label: 'Last Scout edit',
                value: formatChartDateTime(pickStr(record.externalUpdated)),
              },
              {
                label: 'Last eVet sync',
                value: formatChartDateTime(pickStr(record.lastPimsSyncedAt)),
              },
              { label: 'Deleted', value: record.isDeleted === true ? 'Yes' : 'No' },
            ]}
          />
        </div>
      </div>

      <PimsAppointmentsSection
        variant="patient"
        practiceId={PIMS_DETAIL_PRACTICE_ID}
        patientId={patientId}
        patientRecord={record}
      />

      {chronicProblems.length > 0 && (
        <section
          className="pims-patient-detail__chronic"
          aria-labelledby="pims-chronic-problems-heading"
        >
          <h2
            id="pims-chronic-problems-heading"
            className="pims-patient-detail__mr-heading pims-patient-detail__chronic-heading"
          >
            <Activity size={17} aria-hidden />
            Chronic problems
          </h2>
          <ul className="pims-patient-detail__chronic-list">
            {chronicProblems.map((p) => (
              <li key={p.id}>
                <span className="pims-patient-detail__chronic-label">{p.label}</span>
                {p.postedToRecordAt && (
                  <span className="pims-patient-detail__chronic-since">
                    since {formatChartDateShort(p.postedToRecordAt)}
                  </span>
                )}
                <button
                  type="button"
                  className="pims-patient-detail__chronic-resolve"
                  disabled={resolvingProblemId != null}
                  onClick={() => void resolveProblem(p)}
                >
                  <Check size={13} aria-hidden /> Resolved
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chronicMedications.length > 0 && (
        <section
          className="pims-patient-detail__chronic pims-patient-detail__chronic--meds"
          aria-labelledby="pims-chronic-meds-heading"
        >
          <h2
            id="pims-chronic-meds-heading"
            className="pims-patient-detail__mr-heading pims-patient-detail__chronic-heading"
          >
            <Pill size={17} aria-hidden />
            Chronic medications
          </h2>
          <ul className="pims-patient-detail__chronic-list">
            {chronicMedications.map((rx) => (
              <li key={rx.id}>
                <span className="pims-patient-detail__chronic-label">{rx.name}</span>
                {rx.startDate && (
                  <span className="pims-patient-detail__chronic-since">
                    since {formatChartDateShort(rx.startDate)}
                  </span>
                )}
                <button
                  type="button"
                  className="pims-patient-detail__chronic-resolve"
                  disabled={discontinuingRxId != null}
                  onClick={() => void discontinueMedication(rx)}
                >
                  No longer taking
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pims-patient-detail__mr" aria-labelledby="pims-mr-heading">
        <h2 id="pims-mr-heading" className="pims-patient-detail__mr-heading">
          <Stethoscope size={17} aria-hidden />
          Medical record
        </h2>
        <div className="pims-patient-detail__tabs" role="tablist">
          {(
            [
              ['highlights', 'Summary'],
              ['byDate', 'Timeline'],
              ['byDateDetail', 'Timeline with details'],
              ['groups', 'By category'],
              ['monitoring', `Anesthesia monitoring (${monitoringCount})`],
              ['prescriptions', `Prescriptions (${prescriptionCount})`],
              ['wellness', `Wellness plans (${wellnessPlanCount})`],
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
              <table className="pims-patient-detail__mr-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="pims-patient-detail__th-icon" aria-label="Complete" />
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
                      ...rows.map((r: ChartRow) => (
                        <tr
                          key={r.id}
                          className={
                            r.source === 'exam'
                              ? 'pims-patient-detail__mr-row--clickable'
                              : undefined
                          }
                          onClick={
                            r.source === 'exam' ? () => openExamFromChartRow(r, exams) : undefined
                          }
                        >
                          <td>{r.typeLabel}</td>
                          <td>
                            {(r.source === 'lab' || r.source === 'communication') && r.hasResult ? (
                              <Check
                                size={16}
                                className="pims-patient-detail__row-icon pims-patient-detail__check"
                                aria-label="Complete"
                              />
                            ) : (
                              <span className="pims-patient-detail__dash">—</span>
                            )}
                          </td>
                          <td>
                            {r.isCovered ? (
                              <span title="Membership covered" aria-label="Membership covered">
                                ❤️{' '}
                              </span>
                            ) : null}
                            {r.description}
                          </td>
                          <td>{r.provider}</td>
                          <td>{formatChartDateTime(r.serviceDateIso)}</td>
                        </tr>
                      )),
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
              <table className="pims-patient-detail__mr-table pims-patient-detail__mr-table--detail">
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
                            className={
                              r.source === 'exam'
                                ? 'pims-patient-detail__mr-row--clickable'
                                : undefined
                            }
                            onClick={
                              r.source === 'exam' ? () => openExamFromChartRow(r, exams) : undefined
                            }
                          >
                            <td onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="pims-patient-detail__cell-expand"
                                onClick={() => toggleChartRowExpand(r.id)}
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
                ['exams', 'Exams', exams.length, exams, false],
                ['diagnoses', 'Diagnoses', diagnoses.length, diagnoses, false],
                ['treatments', 'Treatments', treatments?.length ?? 0, [], true],
                ['labs', 'Lab orders', labPairs.length, labPairs, false],
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
                      {isTr && (treatmentsLoading ? ' (…)' : ` (${treatments?.length ?? 0})`)}
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
                          {treatmentsLoading && (
                            <p className="pims-patient-detail__muted">Loading treatments…</p>
                          )}
                          {!treatmentsLoading && (treatments?.length ?? 0) === 0 && (
                            <p className="pims-patient-detail__muted">
                              No treatment plans recorded.
                            </p>
                          )}
                          {!treatmentsLoading &&
                            (treatments ?? []).map((t) => (
                              <div key={t.id} className="pims-patient-detail__group-line">
                                <strong>Plan #{t.id}</strong>
                                {t.pimsId ? <span> · {t.pimsId}</span> : null}
                                <span className="pims-patient-detail__muted">
                                  {' '}
                                  · {t.treatmentItems?.length ?? 0} line item(s)
                                </span>
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
                          const text =
                            pickStr(o.subject) ??
                            pickStr(o.description) ??
                            pickStr(nested?.message) ??
                            pickStr(nested?.body) ??
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
                              {truncated} —{' '}
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
                            <div key={String(o.id)} className="pims-patient-detail__group-line">
                              {pickStr(o.formName) ?? 'History'} —{' '}
                              {formatChartDateTime(pickStr(o.serviceDate))}
                            </div>
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

        {mrTab === 'prescriptions' && (
          <div className="pims-patient-detail__rx">
            <h3 className="pims-patient-detail__rx-title">Prescriptions</h3>
            {prescriptionGroups.length === 0 ? (
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
                        <th>Start date</th>
                        <th>Doctor</th>
                        <th>Name</th>
                        <th>Quantity</th>
                        <th>Refill</th>
                        <th>Refills</th>
                        <th>Treatment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.entries.map((row, i) => {
                        const go =
                          row.goToTreatment && typeof row.goToTreatment === 'object'
                            ? (row.goToTreatment as Record<string, unknown>)
                            : null;
                        const treatmentId = row.treatmentId ?? go?.treatmentId;
                        const treatmentItemId = row.treatmentItemId ?? go?.treatmentItemId;
                        const qtyLabel =
                          pickStr(row.quantityLabel) ??
                          (row.quantity != null ? String(row.quantity) : null) ??
                          pickStr(row.quantityDispensed);
                        const refillsAllowed =
                          typeof row.refillsAllowed === 'number'
                            ? row.refillsAllowed
                            : Number(row.refillsAllowed);
                        const hasRefills = row.hasRefills === true;
                        return (
                          <tr key={`${g.code}-${i}`}>
                            <td>{formatChartDateShort(pickStr(row.serviceDate))}</td>
                            <td>{prescriberFromRxRow(row)}</td>
                            <td>
                              {pickStr(row.productName) ?? pickStr(row.name) ?? g.displayName}
                            </td>
                            <td>{qtyLabel ?? '—'}</td>
                            <td>{hasRefills ? 'Yes' : 'No'}</td>
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
                              {treatmentId != null || treatmentItemId != null ? (
                                <button
                                  type="button"
                                  className="pims-patient-detail__linkish"
                                  title={`Treatment ${String(treatmentId ?? '—')}, item ${String(treatmentItemId ?? '—')}`}
                                >
                                  Go to Treatment
                                </button>
                              ) : (
                                <span className="pims-patient-detail__muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        )}

        {mrTab === 'highlights' && (
          <div className="pims-patient-detail__highlights">
            <div className="pims-patient-detail__hl-card">
              <div className="pims-patient-detail__hl-card-head">
                <h3>Weight history</h3>
              </div>
              <p>
                <strong>Profile weight (patient row):</strong>{' '}
                {pickStr(payload.weight) ?? weightLine ?? '—'}
              </p>
              {latestWeightPoint && (
                <p>
                  <strong>Latest exam weight:</strong> {latestWeightPoint.weight}
                  {latestWeightPoint.serviceDate ? (
                    <span className="pims-patient-detail__muted">
                      {' '}
                      · entered {formatChartDateShort(latestWeightPoint.serviceDate)}
                    </span>
                  ) : null}
                </p>
              )}
              <WeightSparkline points={weightHistoryPoints} />
              <p className="pims-patient-detail__muted pims-patient-detail__spark-empty">
                Weights recorded during exams.
              </p>
            </div>
            <div className="pims-patient-detail__hl-card">
              <div className="pims-patient-detail__hl-card-head">
                <h3>Core vaccines</h3>
              </div>
              <ul className="pims-patient-detail__hl-list">
                {vaccinationLogs.slice(0, 20).map((v) => {
                  const o = v as Record<string, unknown>;
                  const inv =
                    o.inventoryItem && typeof o.inventoryItem === 'object'
                      ? (o.inventoryItem as Record<string, unknown>)
                      : null;
                  const label =
                    pickStr(o.vaccineName) ??
                    pickStr(o.name) ??
                    pickStr(o.description) ??
                    (inv ? pickStr(inv.name) : null) ??
                    'Vaccine';
                  return (
                    <li key={String(o.id)}>
                      {label}{' '}
                      <span className="pims-patient-detail__muted">
                        ·{' '}
                        {formatChartDateShort(pickStr(o.dateVaccinated) ?? pickStr(o.serviceDate))}
                      </span>
                    </li>
                  );
                })}
                {vaccinationLogs.length === 0 &&
                  (medicalRecord?.medications ?? [])
                    .map((m) => m as Record<string, unknown>)
                    .filter((m) => vaccineHintName(pickStr(m.name) ?? ''))
                    .slice(0, 8)
                    .map((m) => (
                      <li key={`med-fallback-${String(m.id)}`}>
                        {pickStr(m.name) ?? '—'}{' '}
                        <span className="pims-patient-detail__muted">
                          · {formatChartDateShort(pickStr(m.dateOfService))}{' '}
                          <em>(from chart medications)</em>
                        </span>
                      </li>
                    ))}
                {vaccinationLogs.length === 0 &&
                  (medicalRecord?.medications ?? []).every(
                    (m) => !vaccineHintName(pickStr((m as Record<string, unknown>).name) ?? '')
                  ) && <li className="pims-patient-detail__muted">No vaccinations recorded.</li>}
              </ul>
            </div>
            <div className="pims-patient-detail__hl-card">
              <div className="pims-patient-detail__hl-card-head">
                <h3>Reminders</h3>
              </div>
              {remindersSorted.length === 0 ? (
                <p className="pims-patient-detail__muted">No reminders on this medical record.</p>
              ) : (
                <ul className="pims-patient-detail__hl-list">
                  {remindersSorted.slice(0, 25).map((o) => {
                    const title =
                      pickStr(o.title) ?? pickStr(o.name) ?? pickStr(o.description) ?? 'Reminder';
                    const due =
                      pickStr(o.dueDate) ??
                      pickStr(o.reminderDate) ??
                      pickStr(o.serviceDate) ??
                      pickStr(o.createdAt);
                    return (
                      <li key={String(o.id)}>
                        {title}{' '}
                        <span className="pims-patient-detail__muted">
                          · due {formatChartDateShort(due)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
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

      {selectedExam && medicalRecord ? (
        <PimsExamDetailModal
          exam={selectedExam}
          weightHistory={medicalRecord.weightHistory ?? []}
          patientAgeLabel={ageStr}
          patientWeightDisplay={weightLine}
          onClose={() => setSelectedExam(null)}
        />
      ) : null}
    </div>
  );
}
