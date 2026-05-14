import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PawPrint,
  AlertTriangle,
  MapPin,
  Phone,
  Mail,
  MoreVertical,
  Gem,
  Printer,
  Search,
  ChevronRight,
  ChevronDown,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { fetchPatientByIdStaff, fetchPatientMedicalRecordStaff } from '../../api/patients';
import {
  getPatientTreatmentHistory,
  getPatientTreatmentMedications,
  type TreatmentWithItems,
} from '../../api/treatments';
import {
  buildChartRowsFromMedicalRecord,
  filterRowsByDateRange,
  groupChartRowsByLocalDate,
  type ChartRow,
  type MedicalRecordBundle,
} from '../../utils/patientChartFromMedicalRecord';
import { htmlToPlainText, looksLikeHtmlFragment } from '../../utils/sanitizeCommunicationHtml';
import { PimsExamDetailModal } from './PimsExamDetailModal';
import './PimsPatientDetailView.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
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

function alertText(p: Record<string, unknown>, client: Record<string, unknown> | null): string | null {
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
    const inv = row.inventoryItem && typeof row.inventoryItem === 'object' ? (row.inventoryItem as Record<string, unknown>) : null;
    const presc = row.prescription && typeof row.prescription === 'object' ? (row.prescription as Record<string, unknown>) : null;
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
      <p className="pims-patient-detail__muted" style={{ marginTop: 8 }}>
        At least two exam weight points are needed for a sparkline (from <code>weightHistory</code> on the medical
        record).
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

const QUICK_ACTIONS = [
  'Quick Invoicing',
  'Add Medical Note',
  'Check Out',
  'Add Communication',
  'Email Client',
  'Treatment',
  'Schedule Appointment',
  'Exam',
  'Generate Patient Document',
  'Enter Weight',
  'Vaccination Log',
  'Upload File',
  'Add Treatment Bundle',
  'Send Form',
];

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

  const reloadChartData = useCallback(async (isStale?: () => boolean) => {
    const id = patientId;
    setMrLoadError(null);
    const [patientData, mrData, rxData] = await Promise.all([
      fetchPatientByIdStaff(id),
      fetchPatientMedicalRecordStaff(id).catch((e: unknown) => {
        if (!isStale?.()) {
          setMrLoadError(e instanceof Error ? e.message : 'Medical record request failed.');
        }
        return null as MedicalRecordBundle | null;
      }),
      getPatientTreatmentMedications(id).catch(() => [] as unknown[]),
    ]);
    if (isStale?.()) return;
    if (patientData && typeof patientData === 'object') {
      setPayload(patientData as Record<string, unknown>);
    } else {
      setPayload(null);
    }
    setMedicalRecord(mrData);
    setRxItems(rxData);
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    const stale = () => cancelled;
    setLoading(true);
    setError(null);
    setPayload(null);
    setMedicalRecord(null);
    setMrLoadError(null);
    setRxItems([]);
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
  const cname = client ? clientDisplayName(client) : pickStr(payload?.clientName) ?? '—';
  const alert = payload ? alertText(payload, client) : null;
  const badge = payload ? patientDetailStatus(payload) : { label: '—', variant: 'muted' as const };

  const chartRows = useMemo(() => buildChartRowsFromMedicalRecord(medicalRecord), [medicalRecord]);

  const dateRangeMs = useMemo(() => {
    const start = Date.parse(dateStart);
    const end = Date.parse(dateEnd + 'T23:59:59');
    return { start, end, valid: Number.isFinite(start) && Number.isFinite(end) };
  }, [dateStart, dateEnd]);

  const filteredChartRows = useMemo(() => {
    if (!dateRangeMs.valid) return chartRows;
    return filterRowsByDateRange(chartRows, dateRangeMs.start, dateRangeMs.end);
  }, [chartRows, dateRangeMs]);

  const groupedByDate = useMemo(() => groupChartRowsByLocalDate(filteredChartRows), [filteredChartRows]);

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
    const rows = [...remindersList].filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
    const due = (o: Record<string, unknown>) =>
      Date.parse(
        pickStr(o.dueDate) ?? pickStr(o.reminderDate) ?? pickStr(o.serviceDate) ?? pickStr(o.createdAt) ?? ''
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

  const handleMrSearch = () => {
    /* date range is applied reactively via filteredChartRows */
  };

  const handleMrShowAll = () => {
    setDateStart('2000-01-01');
    setDateEnd(new Date().toISOString().slice(0, 10));
  };

  const speciesLine = useCallback((p: Record<string, unknown>) => {
    const sp = pickStr(p.species) ?? pickStr(p.speciesName) ?? '';
    const br = pickStr(p.breed) ?? pickStr(p.breedDescription) ?? '';
    const mixed = p.isMixed === true || pickStr(p.breed)?.toLowerCase().includes('mixed');
    const parts = [sp, br].filter(Boolean);
    if (!parts.length) return '—';
    let s = parts.join(' ');
    if (mixed && !s.toLowerCase().includes('mixed')) s += ' (Mixed)';
    return s;
  }, []);

  const sexLine = useCallback((p: Record<string, unknown>) => {
    const sx = pickStr(p.sex) ?? pickStr(p.gender) ?? '';
    const nn = pickStr(p.neuterStatus) ?? pickStr(p.spayNeuterStatus) ?? pickStr(p.alteredStatus) ?? '';
    if (sx && nn) return `${sx} (${nn})`;
    return sx || nn || '—';
  }, []);

  if (loading) {
    return <div className="pims-patient-detail__loading">Loading patient…</div>;
  }

  if (error || !payload) {
    return (
      <div className="pims-patient-detail">
        <div className="pims-patient-detail__error">{error ?? 'Patient not found.'}</div>
        <button type="button" className="pims-patient-detail__link" onClick={onBack}>
          Back to list
        </button>
      </div>
    );
  }

  const dob = pickStr(payload.dateOfBirth) ?? pickStr(payload.dob);
  const ageStr = ageFromDob(dob);
  const weightLb = pickStr(payload.weight) ?? pickStr(payload.weightLbs);
  const weightKg = pickStr(payload.weightKg);
  const weightLine =
    weightLb || weightKg
      ? [weightLb ? `${weightLb} lbs` : null, weightKg ? `${weightKg} kg` : null].filter(Boolean).join(' / ')
      : null;

  const clientPhone =
    client &&
    (pickStr(client.phone) ??
      pickStr(client.mobilePhone) ??
      pickStr(client.homePhone) ??
      null);
  const clientEmail =
    (client && pickStr(client.email)) ?? pickStr(payload.clientEmail) ?? pickStr(payload.ownerEmail);
  const secondContact = client ? pickStr(client.secondaryContact) ?? pickStr(client.secondOwnerName) : null;

  /** `GET /patients/:id/medical-record` returned 404 — distinct from an empty record (empty arrays). */
  const mrNotFound = medicalRecord === null && !mrLoadError;
  const wellnessPlanCount = wellnessPlans.length;
  const latestWeightPoint = weightHistoryPoints[weightHistoryPoints.length - 1];

  return (
    <div className="pims-patient-detail">
      <nav className="pims-patient-detail__crumb" aria-label="Breadcrumb">
        <Link to={patientsListPath}>Patients</Link>
        <span aria-hidden> / </span>
        <span>{pname}</span>
      </nav>

      <h1 className="pims-patient-detail__title">{pname}</h1>
      <div className="pims-patient-detail__subhead">
        <span>
          <strong>{cname}</strong>
          <span aria-hidden> | </span>
          <strong>{pname}</strong>
        </span>
      </div>

      {alert && (
        <div className="pims-patient-detail__alert" role="alert">
          <AlertTriangle className="pims-patient-detail__alert-icon" size={22} aria-hidden />
          <div>{alert}</div>
        </div>
      )}

      <div className="pims-patient-detail__card">
        <div className="pims-patient-detail__card-col">
          <div className="pims-patient-detail__avatar" aria-hidden>
            <PawPrint size={32} strokeWidth={1.5} />
          </div>
          <div className="pims-patient-detail__card-body">
            <div className="pims-patient-detail__card-title">
              {pname}
              <span className="pims-patient-detail__meta-line" style={{ fontWeight: 500, margin: 0 }}>
                {' '}
                | {String(payload.id ?? patientId)}
              </span>
              <span className={`pims-patient-detail__badge pims-patient-detail__badge--${badge.variant}`}>
                {badge.label}
              </span>
              <div className="pims-patient-detail__card-tools">
                <button type="button" className="pims-patient-detail__icon-btn" title="Highlight">
                  <Gem size={18} />
                </button>
                <button type="button" className="pims-patient-detail__icon-btn" title="More">
                  <MoreVertical size={18} />
                </button>
              </div>
            </div>
            <p className="pims-patient-detail__meta-line">{speciesLine(payload)}</p>
            <p className="pims-patient-detail__meta-line">{sexLine(payload)}</p>
            <p className="pims-patient-detail__meta-line">
              {[ageStr, weightLine].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        </div>

        <div className="pims-patient-detail__card-col">
          <div className="pims-patient-detail__card-body" style={{ width: '100%' }}>
            <div className="pims-patient-detail__card-title">
              {client ? (
                <>
                  {clientDisplayName(client)}
                  <span className="pims-patient-detail__meta-line" style={{ fontWeight: 500, margin: 0 }}>
                    {' '}
                    | {String(client.id ?? '—')}
                  </span>
                </>
              ) : (
                <>
                  {cname}
                  <span className="pims-patient-detail__meta-line" style={{ fontWeight: 500, margin: 0 }}>
                    {' '}
                    | —
                  </span>
                </>
              )}
              <div className="pims-patient-detail__card-tools">
                <button type="button" className="pims-patient-detail__icon-btn" title="More">
                  <MoreVertical size={18} />
                </button>
              </div>
            </div>
            {clientPhone && (
              <p className="pims-patient-detail__meta-line">
                <Phone size={16} style={{ verticalAlign: 'text-top', marginRight: 6 }} aria-hidden />
                {clientPhone}
              </p>
            )}
            {clientEmail && (
              <p className="pims-patient-detail__meta-line">
                <Mail size={16} style={{ verticalAlign: 'text-top', marginRight: 6 }} aria-hidden />
                {clientEmail}
              </p>
            )}
            <p className="pims-patient-detail__meta-line">
              <MapPin size={16} style={{ verticalAlign: 'text-top', marginRight: 6 }} aria-hidden />
              {client ? formatAddressClient(client) : '—'}
            </p>
            {alert && (
              <p className="pims-patient-detail__meta-line" style={{ color: '#991b1b' }}>
                {alert.length > 180 ? `${alert.slice(0, 180)}…` : alert}
              </p>
            )}
            {secondContact && (
              <p className="pims-patient-detail__meta-line">
                <strong>Second person:</strong> {secondContact}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="pims-patient-detail__quick">
        {QUICK_ACTIONS.map((label) => (
          <button key={label} type="button">
            {label}
          </button>
        ))}
      </div>

      <section className="pims-patient-detail__mr" aria-labelledby="pims-mr-heading">
        <div className="pims-patient-detail__mr-head">
          <button type="button" className="pims-patient-detail__icon-btn" title="Print" aria-label="Print">
            <Printer size={18} />
          </button>
          <button type="button" className="pims-patient-detail__icon-btn" title="Email" aria-label="Email">
            <Mail size={18} />
          </button>
          <button type="button" className="pims-patient-detail__icon-btn" title="Search" aria-label="Search">
            <Search size={18} />
          </button>
        </div>
        <h2 id="pims-mr-heading" className="visually-hidden">
          Medical records
        </h2>
        <div className="pims-patient-detail__tabs" role="tablist">
          {(
            [
              ['highlights', 'Highlights'],
              ['groups', 'MR View By Groups'],
              ['byDate', 'MR View By Date'],
              ['byDateDetail', 'MR View By Date with Details'],
              ['monitoring', `Monitoring History (${monitoringCount})`],
              ['prescriptions', `Prescription History (${prescriptionCount})`],
              ['wellness', `Wellness Plan (${wellnessPlanCount})`],
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
              Beginning Service Date
              <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            </label>
            <label>
              Ending Service Date
              <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </label>
            <button type="button" onClick={handleMrSearch}>
              Search
            </button>
            <button type="button" onClick={() => reloadChartData()}>
              Refresh View
            </button>
            <button type="button" onClick={handleMrShowAll}>
              Show All
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
                    <th className="pims-patient-detail__th-icon" aria-label="Edit" />
                    <th className="pims-patient-detail__th-icon" aria-label="View" />
                    <th>Type</th>
                    <th className="pims-patient-detail__th-icon" aria-label="Status" />
                    <th>Description</th>
                    <th>Provider</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {mrNotFound ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                        No medical record row exists for this patient yet (response from{' '}
                        <code>GET /patients/:id/medical-record</code> was empty or 404).
                      </td>
                    </tr>
                  ) : groupedByDate.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                        No entries in this date range.
                      </td>
                    </tr>
                  ) : (
                    groupedByDate.flatMap(({ dateKey, rows }) => [
                      <tr key={`g-${dateKey}`} className="pims-patient-detail__date-group">
                        <td colSpan={7}>
                          {dateKey}
                        </td>
                      </tr>,
                      ...rows.map((r: ChartRow) => (
                        <tr
                          key={r.id}
                          className={r.source === 'exam' ? 'pims-patient-detail__mr-row--clickable' : undefined}
                          onClick={
                            r.source === 'exam' ? () => openExamFromChartRow(r, exams) : undefined
                          }
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="pims-patient-detail__icon-cell"
                              title="Edit (not wired)"
                              disabled
                            >
                              <Pencil size={15} className="pims-patient-detail__row-icon" aria-hidden />
                            </button>
                          </td>
                          <td>
                            <ChevronRight size={16} className="pims-patient-detail__row-icon" aria-hidden />
                          </td>
                          <td>{r.typeLabel}</td>
                          <td>
                            {(r.source === 'lab' || r.source === 'communication') && r.hasResult ? (
                              <Check size={16} className="pims-patient-detail__row-icon pims-patient-detail__check" aria-label="Complete" />
                            ) : (
                              <span className="pims-patient-detail__dash">—</span>
                            )}
                          </td>
                          <td>{r.description}</td>
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
                    <th className="pims-patient-detail__th-icon" aria-label="Edit" />
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
                      <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                        No medical record row exists for this patient yet (empty or 404 from{' '}
                        <code>GET /patients/:id/medical-record</code>).
                      </td>
                    </tr>
                  ) : groupedByDate.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                        No entries in this date range.
                      </td>
                    </tr>
                  ) : (
                    groupedByDate.flatMap(({ dateKey, rows }) => [
                      <tr key={`gd-${dateKey}`} className="pims-patient-detail__date-group">
                        <td colSpan={7}>
                          {dateKey}
                        </td>
                      </tr>,
                      ...rows.map((r: ChartRow) => {
                        const open = expandedChartRowIds.has(r.id);
                        return (
                          <tr
                            key={r.id}
                            className={r.source === 'exam' ? 'pims-patient-detail__mr-row--clickable' : undefined}
                            onClick={
                              r.source === 'exam' ? () => openExamFromChartRow(r, exams) : undefined
                            }
                          >
                            <td onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className="pims-patient-detail__icon-cell"
                                title="Edit (not wired)"
                                disabled
                              >
                                <Pencil size={15} className="pims-patient-detail__row-icon" aria-hidden />
                              </button>
                            </td>
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
                            <td>{r.description}</td>
                            <td
                              className={[
                                'pims-patient-detail__detail-cell',
                                open && r.detailHtml ? 'pims-patient-detail__detail-cell--rich' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              {open ? (
                                r.detailHtml ? (
                                  <>
                                    {r.detailText?.trim() ? (
                                      <div className="pims-patient-detail__detail-meta">{r.detailText}</div>
                                    ) : null}
                                    <div
                                      className="pims-patient-detail__html-body"
                                      dangerouslySetInnerHTML={{ __html: r.detailHtml }}
                                    />
                                  </>
                                ) : (
                                  r.detailText || '—'
                                )
                              ) : (() => {
                                if (r.detailHtml) {
                                  const meta = (r.detailText || '').trim();
                                  const plain = htmlToPlainText(r.detailHtml).replace(/\s+/g, ' ').trim();
                                  const joined = [meta, plain].filter(Boolean).join(' — ');
                                  return joined.length > 120 ? `${joined.slice(0, 120)}…` : joined || '—';
                                }
                                const t = r.detailText || '—';
                                return t.length > 120 ? `${t.slice(0, 120)}…` : t;
                              })()}
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
            <button type="button" className="pims-patient-detail__expand-all" onClick={expandAllGroups}>
              Expand All
            </button>
            {(
              [
                ['visits', 'Reason for Visits', complaints.length, complaints, false],
                ['communications', 'Communications', communicationLogs.length, communicationLogs, false],
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
                          No online retail activity is included in the medical-record API.
                        </p>
                      )}
                      {key === 'treatments' && (
                        <>
                          {treatmentsLoading && <p className="pims-patient-detail__muted">Loading treatments…</p>}
                          {!treatmentsLoading && (treatments?.length ?? 0) === 0 && (
                            <p className="pims-patient-detail__muted">
                              No treatments from <code>GET /treatments/patient/:id/history</code>, or request failed.
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
                            o.communicationMessageLog && typeof o.communicationMessageLog === 'object'
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
                            displayLine.length > 160 ? `${displayLine.slice(0, 160)}…` : displayLine;
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
                              {pickStr(o.formName) ?? 'History'} — {formatChartDateTime(pickStr(o.serviceDate))}
                            </div>
                          );
                        })}
                      {key === 'exams' &&
                        exams.map((row) => {
                          const o = row as Record<string, unknown>;
                          const iso = pickStr(o.serviceDate);
                          const d = iso ? new Date(iso) : null;
                          const ampm =
                            d && !Number.isNaN(d.getTime()) ? (d.getHours() < 12 ? 'AM' : 'PM') : '—';
                          return (
                            <button
                              key={String(o.id)}
                              type="button"
                              className="pims-patient-detail__exam-row"
                              onClick={() => setSelectedExam(o)}
                            >
                              <span className="pims-patient-detail__exam-row-icons" aria-hidden>
                                <Pencil size={14} />
                                <ChevronRight size={14} />
                              </span>
                              <span className="pims-patient-detail__exam-row-name">
                                {pickStr(o.formName) ?? 'Exam — General'}
                              </span>
                              <span className="pims-patient-detail__exam-row-ampm">{ampm}</span>
                              <span className="pims-patient-detail__exam-row-date">
                                {formatChartDateTime(iso)}
                              </span>
                              <span className="pims-patient-detail__exam-row-del" title="Delete (not wired)">
                                <X size={14} aria-hidden />
                              </span>
                            </button>
                          );
                        })}
                      {key === 'diagnoses' &&
                        diagnoses.map((row) => {
                          const o = row as Record<string, unknown>;
                          return (
                            <div key={String(o.id)} className="pims-patient-detail__group-line">
                              {pickStr(o.name) ?? 'Diagnosis'} — {formatChartDateTime(pickStr(o.serviceDate))}
                            </div>
                          );
                        })}
                      {key === 'labs' &&
                        labPairs.map((pair, idx) => {
                          const p = pair as { order?: Record<string, unknown> };
                          const o = p.order ?? {};
                          return (
                            <div key={String(o.id ?? idx)} className="pims-patient-detail__group-line">
                              {pickStr(o.labOrderType) ?? 'Lab'} — {formatChartDateTime(pickStr(o.submittedDate))}
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
                    <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                      No anesthesia monitoring forms on this medical record.
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
                        <td>
                          {start || end ? `${start ?? '?'} → ${end ?? '?'}` : '—'}
                        </td>
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
              <p className="pims-patient-detail__muted">
                No rows from <code>GET /treatments/patient/medications/:patientId</code>, or the endpoint returned an
                empty list.
              </p>
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
                        const go = row.goToTreatment && typeof row.goToTreatment === 'object' ? (row.goToTreatment as Record<string, unknown>) : null;
                        const treatmentId = row.treatmentId ?? go?.treatmentId;
                        const treatmentItemId = row.treatmentItemId ?? go?.treatmentItemId;
                        const qtyLabel =
                          pickStr(row.quantityLabel) ??
                          (row.quantity != null ? String(row.quantity) : null) ??
                          pickStr(row.quantityDispensed);
                        const refillsAllowed =
                          typeof row.refillsAllowed === 'number' ? row.refillsAllowed : Number(row.refillsAllowed);
                        const hasRefills = row.hasRefills === true;
                        return (
                          <tr key={`${g.code}-${i}`}>
                            <td>{formatChartDateShort(pickStr(row.serviceDate))}</td>
                            <td>{prescriberFromRxRow(row)}</td>
                            <td>{pickStr(row.productName) ?? pickStr(row.name) ?? g.displayName}</td>
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
                <strong>Profile weight (patient row):</strong> {pickStr(payload.weight) ?? weightLine ?? '—'}
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
              <p className="pims-patient-detail__muted" style={{ marginTop: 8 }}>
                Points from <code>medicalRecord.weightHistory</code> (exam vitals). For a dedicated series, use{' '}
                <code>GET /patients/:id/weights</code>.
              </p>
            </div>
            <div className="pims-patient-detail__hl-card">
              <div className="pims-patient-detail__hl-card-head">
                <h3>Core vaccines</h3>
              </div>
              <ul className="pims-patient-detail__hl-list">
                {vaccinationLogs.slice(0, 20).map((v) => {
                  const o = v as Record<string, unknown>;
                  const inv = o.inventoryItem && typeof o.inventoryItem === 'object' ? (o.inventoryItem as Record<string, unknown>) : null;
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
                        · {formatChartDateShort(pickStr(o.dateVaccinated) ?? pickStr(o.serviceDate))}
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
                  ) && (
                    <li className="pims-patient-detail__muted">
                      No <code>vaccinationLogs</code> on this record and no vaccine-like chart medications.
                    </li>
                  )}
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
                    const title = pickStr(o.title) ?? pickStr(o.name) ?? pickStr(o.description) ?? 'Reminder';
                    const due =
                      pickStr(o.dueDate) ?? pickStr(o.reminderDate) ?? pickStr(o.serviceDate) ?? pickStr(o.createdAt);
                    return (
                      <li key={String(o.id)}>
                        {title}{' '}
                        <span className="pims-patient-detail__muted">· due {formatChartDateShort(due)}</span>
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
              <p className="pims-patient-detail__muted">No wellness plans on this medical record.</p>
            ) : (
              <ul className="pims-patient-detail__wellness-list">
                {wellnessPlans.map((raw) => {
                  const p = raw as Record<string, unknown>;
                  const label =
                    pickStr(p.name) ?? pickStr(p.planName) ?? pickStr(p.description) ?? `Plan #${String(p.id ?? '')}`;
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

      <p style={{ marginTop: 20 }}>
        <button type="button" className="pims-patient-detail__link" onClick={onBack}>
          ← Back to patient search
        </button>
      </p>
    </div>
  );
}
