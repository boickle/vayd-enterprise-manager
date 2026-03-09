// src/pages/PIMS.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';
import {
  searchPatients,
  getPatientById,
  getPatientFullMedicalRecord,
} from '../api/patients';
import { getPatientTreatmentHistory, type TreatmentItem } from '../api/treatments';
import {
  searchClients,
  fetchClientInfo,
  getClientPatients,
} from '../api/clientPortal';
import { DateTime } from 'luxon';

// ----- Types (from full medical record response) -----
type PatientSummary = {
  id: number;
  name?: string;
  species?: string;
  breed?: string;
  dob?: string;
  alerts?: string | null;
  [k: string]: unknown;
};

type LabOrderItem = {
  order: { id: number; submittedDate?: string; labOrderType?: string; [k: string]: unknown };
  result?: { reportDate?: string; externalData?: string; [k: string]: unknown };
};

type VitalSign = {
  id?: number;
  weight?: number | null;
  weightUnitValue?: number | null;
  temperature?: number | null;
  heartRate?: number | null;
  pulseQuality?: string | null;
  respiratoryRate?: string | null;
  capillaryRefillTime?: string | null;
  mucousMembrane?: string | null;
  hydration?: string | null;
  painScore?: string | null;
  bodyConditionScore?: string | null;
  fasScore?: string | null;
  fasScoreComments?: string | null;
  [k: string]: unknown;
};

type ExamItem = {
  id: number;
  formName?: string;
  serviceDate?: string;
  comments?: string;
  employee?: { firstName?: string; lastName?: string; designation?: string; [k: string]: unknown };
  vitalSign?: VitalSign | null;
  treatmentItems?: TreatmentItem[];
  responses?: Array<{ componentName?: string; comment?: string; [k: string]: unknown }>;
  [k: string]: unknown;
};

type ComplaintItem = {
  id: number;
  complaintName?: string;
  serviceDate?: string;
  [k: string]: unknown;
};

type DiagnosisItem = {
  id: number;
  name?: string;
  description?: string;
  [k: string]: unknown;
};

type MedicationItem = {
  id: number;
  name?: string;
  dateOfService?: string;
  [k: string]: unknown;
};

type FullMedicalRecord = {
  patient: PatientSummary & { weight?: string; color?: string; sex?: string };
  practice?: { name?: string; [k: string]: unknown };
  medicalRecord?: { id: number; [k: string]: unknown };
  labOrders?: LabOrderItem[];
  complaints?: ComplaintItem[];
  diagnoses?: DiagnosisItem[];
  medications?: MedicationItem[];
  imagingStudies?: unknown[];
  dentalCharts?: unknown[];
  anestheticMonitorForms?: unknown[];
  exams?: ExamItem[];
  histories?: unknown[];
  client?: { id: number | string; firstName?: string; lastName?: string; email?: string; phone1?: string; address1?: string; city?: string; state?: string; zipcode?: string; [k: string]: unknown };
};

type ClientSearchHit = {
  id: string;
  firstName?: string;
  lastName?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  [k: string]: unknown;
};

type PatientSearchHit = {
  id: number;
  name?: string;
  species?: string;
  breed?: string;
  pimsId?: string;
  clientId?: number | string;
  clients?: Array<{ id: number | string }>;
  [k: string]: unknown;
};

const formatDate = (s: string | undefined) =>
  s ? DateTime.fromISO(s).toLocaleString(DateTime.DATE_MED) : '—';

const formatDateTime = (s: string | undefined) =>
  s ? DateTime.fromISO(s).toFormat('M/d/yyyy h:mm a') : '—';

function ageFromDob(dob: string | undefined): string {
  if (!dob) return '—';
  const d = DateTime.fromISO(dob);
  if (!d.isValid) return '—';
  const now = DateTime.now();
  const diff = now.diff(d, ['years', 'months']).toObject();
  const y = Math.floor(diff.years ?? 0);
  const m = Math.floor(diff.months ?? 0);
  if (y > 0) return `${y}y ${m}m`;
  return `${m}m`;
}

function weightWithUnit(weight: number | string | undefined | null, unitValue?: number | null): string {
  if (weight == null || weight === '') return '—';
  const w = typeof weight === 'string' ? parseFloat(weight) : weight;
  if (Number.isNaN(w)) return '—';
  const unit = unitValue === 2 ? 'kg' : 'lbs';
  if (unit === 'kg') return `${w} kg`;
  return `${w} ${unit}`;
}

// ----- Parse IDEXX lab result XML (externalData) -----
function getAttr(el: Element, name: string): string {
  const v = el.getAttribute(name) ?? el.getAttribute(`d1p1:${name}`);
  return (v ?? '').trim();
}

function getText(el: Element, tagLocalName: string): string {
  const list = el.getElementsByTagName('*');
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const tag = (t.tagName || '').toLowerCase();
    if (tag === tagLocalName.toLowerCase() || tag.endsWith(`:${tagLocalName.toLowerCase()}`)) {
      return (t.textContent || '').trim();
    }
  }
  return '';
}

function isTag(el: Element, localName: string): boolean {
  const tag = (el.tagName || '').toLowerCase();
  return tag === localName.toLowerCase() || tag.endsWith(`:${localName.toLowerCase()}`);
}

export type ParsedLabTest = {
  name: string;
  result: string;
  unit: string;
  lowRange: string;
  highRange: string;
  notes: string;
};

export type ParsedLabPanel = {
  name: string;
  code: string;
  tests: ParsedLabTest[];
  subPanels: ParsedLabPanel[];
};

function collectTests(el: Element): ParsedLabTest[] {
  const tests: ParsedLabTest[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const node = el.children[i] as Element;
    if (!isTag(node, 'tests')) continue;
    const name = getAttr(node, 'name');
    const result = getAttr(node, 'result') || getText(node, 'result');
    const resultUOM = getAttr(node, 'resultUOM') || getText(node, 'resultUOM');
    const lowRange = getAttr(node, 'lowRange') || getText(node, 'lowRange');
    const highRange = getAttr(node, 'highRange') || getText(node, 'highRange');
    const notes = getAttr(node, 'notes') || getText(node, 'notes');
    tests.push({ name, result, unit: resultUOM, lowRange, highRange, notes });
  }
  return tests;
}

function collectPanels(el: Element, depth: number): ParsedLabPanel[] {
  const panels: ParsedLabPanel[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i] as Element;
    if (!isTag(child, 'panels')) continue;
    const name = getAttr(child, 'name');
    const code = getAttr(child, 'code');
    const tests = collectTests(child);
    const subPanels = collectPanels(child, depth + 1);
    panels.push({ name, code, tests, subPanels });
  }
  return panels;
}

function parseIdexxLabXml(xmlString: string): ParsedLabPanel[] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    if (doc.querySelector('parsererror')) return [];
    const root = doc.documentElement;
    let resultsEl: Element | null = null;
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      if (isTag(all[i], 'results')) {
        resultsEl = all[i];
        break;
      }
    }
    const container = resultsEl || root;
    return collectPanels(container, 0);
  } catch {
    return [];
  }
}

export default function PIMSPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const patientIdParam = searchParams.get('patientId');
  const clientIdParam = searchParams.get('clientId');

  const [query, setQuery] = useState('');
  const [patientResults, setPatientResults] = useState<PatientSearchHit[]>([]);
  const [clientResults, setClientResults] = useState<ClientSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<FullMedicalRecord | null>(null);
  const [selectedPatientLoading, setSelectedPatientLoading] = useState(false);
  const [selectedPatientError, setSelectedPatientError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [clientPatients, setClientPatients] = useState<PatientSearchHit[]>([]);
  const [selectedClientLoading, setSelectedClientLoading] = useState(false);
  const [selectedClientError, setSelectedClientError] = useState<string | null>(null);
  const [labResultModal, setLabResultModal] = useState<LabOrderItem | null>(null);
  const [examModal, setExamModal] = useState<ExamItem | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef<string>('');

  // Sync URL -> load patient or client
  useEffect(() => {
    if (patientIdParam) {
      const id = parseInt(patientIdParam, 10);
      if (Number.isFinite(id) && (!selectedPatient || selectedPatient.patient?.id !== id)) {
        setSelectedClient(null);
        setClientPatients([]);
        setSelectedPatientError(null);
        setSelectedPatientLoading(true);
        setSelectedPatient(null);
        getPatientFullMedicalRecord(id)
          .then((data) => {
            setSelectedPatient(data);
            setSelectedPatientError(null);
          })
          .catch((e) => {
            setSelectedPatientError(e?.response?.data?.message || e?.message || 'Failed to load medical record');
            setSelectedPatient(null);
          })
          .finally(() => setSelectedPatientLoading(false));
      }
    } else {
      setSelectedPatient(null);
      setSelectedPatientError(null);
    }
  }, [patientIdParam]);

  useEffect(() => {
    if (clientIdParam) {
      setSelectedPatient(null);
      setSelectedPatientError(null);
      setSelectedClientError(null);
      setSelectedClientLoading(true);
      setSelectedClient(null);
      setClientPatients([]);
      Promise.all([
        fetchClientInfo(clientIdParam),
        getClientPatients(clientIdParam),
      ])
        .then(([info, patients]) => {
          setSelectedClient(info || null);
          const list = Array.isArray(patients) && patients.length > 0
            ? patients
            : Array.isArray(info?.patients) ? info.patients : [];
          setClientPatients(list);
          if (!info) setSelectedClientError('Client not found');
        })
        .catch((e) => {
          setSelectedClientError(e?.response?.data?.message || e?.message || 'Failed to load client');
          setSelectedClient(null);
          setClientPatients([]);
        })
        .finally(() => setSelectedClientLoading(false));
    } else {
      setSelectedClient(null);
      setClientPatients([]);
      setSelectedClientError(null);
    }
  }, [clientIdParam]);

  // Search when query changes (debounced)
  useEffect(() => {
    const q = query.trim();
    latestQueryRef.current = q;
    if (!q) {
      setPatientResults([]);
      setClientResults([]);
      setShowDropdown(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const [patientRes, clientList] = await Promise.all([
          searchPatients({ name: q }).then((r: any) => r?.data ?? r),
          searchClients(q),
        ]);
        if (latestQueryRef.current !== q) return;
        const patients = Array.isArray(patientRes) ? patientRes : patientRes?.rows ?? patientRes?.data ?? [];
        setPatientResults(Array.isArray(patients) ? patients : []);
        setClientResults(Array.isArray(clientList) ? clientList : []);
        setShowDropdown(true);
      } catch (e) {
        console.error('PIMS search failed', e);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const openPatient = useCallback(
    (id: number) => {
      setSearchParams({ patientId: String(id) });
      setQuery('');
      setShowDropdown(false);
    },
    [setSearchParams]
  );

  const openClient = useCallback(
    (id: string) => {
      setSearchParams({ clientId: String(id) });
      setQuery('');
      setShowDropdown(false);
    },
    [setSearchParams]
  );

  const clearView = useCallback(() => {
    setSearchParams({});
    setSelectedPatient(null);
    setSelectedClient(null);
    setClientPatients([]);
    setSelectedPatientError(null);
    setSelectedClientError(null);
  }, [setSearchParams]);

  const getPatientClientId = useCallback(async (patientId: number): Promise<string | number | null> => {
    try {
      const res = await getPatientById(patientId);
      const data = res?.data ?? res;
      const id = data?.clientId ?? data?.client?.id ?? data?.clients?.[0]?.id;
      return id != null ? id : null;
    } catch {
      return null;
    }
  }, []);

  const hasResults = patientResults.length > 0 || clientResults.length > 0;
  const showPatientView = selectedPatient != null || selectedPatientLoading || selectedPatientError;
  const showClientView = selectedClient != null || selectedClientLoading || selectedClientError;

  return (
    <div className="pims-page" style={{ padding: '1rem 0', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>PIMS</h1>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search by patient or client name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => hasResults && setShowDropdown(true)}
          style={{ width: '100%', maxWidth: 400, padding: '8px 12px', fontSize: '1rem' }}
        />
        {searching && (
          <span style={{ marginLeft: 8, color: '#666', fontSize: '0.9rem' }}>Searching...</span>
        )}
        {showDropdown && hasResults && (
          <div
            className="dropdown"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              maxWidth: 500,
              maxHeight: 320,
              overflow: 'auto',
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              zIndex: 100,
              marginTop: 4,
            }}
          >
            {patientResults.length > 0 && (
              <div style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
                <div style={{ padding: '4px 12px', fontWeight: 600, color: '#555' }}>Patients</div>
                {patientResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openPatient(p.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 12px',
                      textAlign: 'left',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {p.name ?? 'Unnamed'} {p.species && `(${p.species})`} — ID {p.id}
                  </button>
                ))}
              </div>
            )}
            {clientResults.length > 0 && (
              <div style={{ padding: '8px 0' }}>
                <div style={{ padding: '4px 12px', fontWeight: 600, color: '#555' }}>Clients</div>
                {clientResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openClient(String(c.id))}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '8px 12px',
                      textAlign: 'left',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {[c.firstName, c.lastName].filter(Boolean).join(' ')} — ID {c.id}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Clear view when both panels hidden */}
      {(showPatientView || showClientView) && (
        <button type="button" onClick={clearView} style={{ marginBottom: '1rem' }}>
          Clear view
        </button>
      )}

      {/* Patient (full medical record) view */}
      {selectedPatientLoading && (
        <p style={{ color: '#666' }}>Loading medical record...</p>
      )}
      {selectedPatientError && (
        <p style={{ color: '#c00' }}>{selectedPatientError}</p>
      )}
      {selectedPatient && (
        <PatientView
          record={selectedPatient}
          onViewClient={() => {
            if (selectedPatient.client) setSearchParams({ clientId: String(selectedPatient.client.id) });
          }}
          onViewClientId={openClient}
          getPatientClientId={getPatientClientId}
          examModal={examModal}
          setExamModal={setExamModal}
          labResultModal={labResultModal}
          setLabResultModal={setLabResultModal}
        />
      )}

      <ExamModal
        exam={examModal}
        patientId={selectedPatient?.patient?.id}
        onClose={() => setExamModal(null)}
      />
      <LabResultModal labOrder={labResultModal} onClose={() => setLabResultModal(null)} />

      {/* Client view */}
      {selectedClientLoading && (
        <p style={{ color: '#666' }}>Loading client...</p>
      )}
      {selectedClientError && (
        <p style={{ color: '#c00' }}>{selectedClientError}</p>
      )}
      {selectedClient && (
        <div className="pims-client-view" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginBottom: 12 }}>Client: {[selectedClient.firstName, selectedClient.lastName].filter(Boolean).join(' ') || '—'}</h2>
          <section style={{ marginBottom: 24 }}>
            <p>
              {selectedClient.address1 && <span>{selectedClient.address1}<br /></span>}
              {[selectedClient.city, selectedClient.state, selectedClient.zipcode || selectedClient.zip].filter(Boolean).join(', ')}
            </p>
            {(selectedClient.phone1 || selectedClient.email) && (
              <p>Phone: {selectedClient.phone1 ?? '—'} | Email: {selectedClient.email ?? '—'}</p>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 8 }}>Patients</h3>
            {clientPatients.length === 0 ? (
              <p style={{ color: '#666' }}>No patients listed for this client. Try searching for a patient to open their record.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {clientPatients.map((p: PatientSearchHit) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => openPatient(p.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                    >
                      {p.name ?? 'Unnamed'} {p.species && `(${p.species})`} — ID {p.id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {!showPatientView && !showClientView && query.trim() === '' && (
        <p style={{ color: '#666' }}>Search for a patient or client above to view their record.</p>
      )}
    </div>
  );
}

// ----- Timeline entry for MR View By Date -----
type TimelineEntry =
  | { type: 'exam'; date: string; sortKey: number; exam: ExamItem }
  | { type: 'lab'; date: string; sortKey: number; labOrder: LabOrderItem }
  | { type: 'medication'; date: string; sortKey: number; medication: MedicationItem }
  | { type: 'complaint'; date: string; sortKey: number; complaint: ComplaintItem };

function buildTimeline(record: FullMedicalRecord): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  (record.exams || []).forEach((e) => {
    const d = e.serviceDate;
    if (d) entries.push({ type: 'exam', date: d, sortKey: new Date(d).getTime(), exam: e });
  });
  (record.labOrders || []).forEach((lo, i) => {
    const d = lo.result?.reportDate ?? lo.order?.submittedDate;
    if (d) entries.push({ type: 'lab', date: d, sortKey: new Date(d).getTime() + i * 0.001, labOrder: lo });
  });
  (record.medications || []).forEach((m) => {
    const d = m.dateOfService;
    if (d) entries.push({ type: 'medication', date: d, sortKey: new Date(d).getTime(), medication: m });
  });
  (record.complaints || []).forEach((c) => {
    const d = c.serviceDate;
    if (d) entries.push({ type: 'complaint', date: d, sortKey: new Date(d).getTime(), complaint: c });
  });
  entries.sort((a, b) => b.sortKey - a.sortKey);
  return entries;
}

function getLatestVitalSign(record: FullMedicalRecord): VitalSign | null {
  if (!record.exams?.length) return null;
  const withVitals = record.exams.filter((e) => e.vitalSign && typeof e.vitalSign === 'object');
  if (withVitals.length === 0) return null;
  withVitals.sort((a, b) => {
    const da = a.serviceDate ? new Date(a.serviceDate).getTime() : 0;
    const db = b.serviceDate ? new Date(b.serviceDate).getTime() : 0;
    return db - da;
  });
  return withVitals[0].vitalSign as VitalSign;
}

function PatientView({
  record,
  onViewClient,
  onViewClientId,
  getPatientClientId,
  examModal,
  setExamModal,
  labResultModal,
  setLabResultModal,
}: {
  record: FullMedicalRecord;
  onViewClient: () => void;
  onViewClientId: (id: string) => void;
  getPatientClientId: (id: number) => Promise<string | number | null>;
  examModal: ExamItem | null;
  setExamModal: (e: ExamItem | null) => void;
  labResultModal: LabOrderItem | null;
  setLabResultModal: (lo: LabOrderItem | null) => void;
}) {
  const timeline = buildTimeline(record);
  const latestVital = getLatestVitalSign(record);
  const patient = record.patient;
  const client = record.client;

  const patientSummaryLine = [
    patient?.species,
    patient?.breed,
    patient?.sex,
    ageFromDob(patient?.dob),
    patient?.dob ? formatDate(patient.dob) : null,
    patient?.weight ? weightWithUnit(patient.weight) : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const entriesByDate = timeline.reduce<Record<string, TimelineEntry[]>>((acc, entry) => {
    const dateKey = DateTime.fromISO(entry.date).toFormat('M/d/yyyy');
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(entry);
    return acc;
  }, {});
  const dateGroups = Object.entries(entriesByDate).sort((a, b) => {
    const tA = DateTime.fromFormat(a[0], 'M/d/yyyy').toMillis();
    const tB = DateTime.fromFormat(b[0], 'M/d/yyyy').toMillis();
    return tB - tA;
  });

  return (
    <div className="pims-patient-view" style={{ marginTop: '1rem' }}>
      {patient?.alerts && (
        <div
          style={{
            background: '#dc2626',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>⚠</span>
          <strong>Patient Alerts</strong> — {patient.alerts}
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Main content */}
        <div style={{ flex: '1 1 65%', minWidth: 0 }}>
          {/* Patient & Owner card */}
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              overflow: 'hidden',
              marginBottom: 16,
              background: '#fef7f0',
            }}
          >
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#fce7d6', fontWeight: 600 }}>
              Patient &amp; Owner
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <strong>{patient?.name ?? '—'}</strong> {patient?.id && <span style={{ color: '#6b7280' }}>ID {patient.id}</span>}
                <br />
                <span style={{ fontSize: 14, color: '#374151' }}>{patientSummaryLine}</span>
                {patient?.alerts && (
                  <div style={{ marginTop: 6, color: '#b45309', fontSize: 14 }}>Alert: {patient.alerts}</div>
                )}
                {(() => {
                  const sorted = [...(record.exams || [])].sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || ''));
                  const emp = sorted[0]?.employee;
                  return emp ? (
                    <div style={{ marginTop: 4, fontSize: 14 }}>
                      Primary Provider: {[emp.firstName, emp.lastName, emp.designation].filter(Boolean).join(' ')}
                    </div>
                  ) : null;
                })()}
              </div>
              {client ? (
                <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                  <strong>{[client.firstName, client.lastName].filter(Boolean).join(' ')}</strong>
                  {client.id != null && <span style={{ color: '#6b7280', marginLeft: 6 }}>ID {client.id}</span>}
                  {(client.phone1 || client.email) && (
                    <div style={{ marginTop: 4, fontSize: 14 }}>
                      {client.phone1 && <span>{client.phone1}</span>}
                      {client.phone1 && client.email && ' · '}
                      {client.email && <span>{client.email}</span>}
                    </div>
                  )}
                  {(client.address1 || client.city) && (
                    <div style={{ marginTop: 2, fontSize: 14 }}>
                      {[client.address1, client.city, client.state, client.zipcode].filter(Boolean).join(', ')}
                    </div>
                  )}
                  <button type="button" onClick={onViewClient} style={{ marginTop: 8, fontSize: 13, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    View client
                  </button>
                </div>
              ) : (
                patient?.id && (
                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                    <ClientLinkButton patientId={patient.id} onClientId={onViewClientId} getPatientClientId={getPatientClientId} />
                  </div>
                )
              )}
            </div>
          </div>

          {/* MR View By Date */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>
              MR View By Date
            </div>
            <div style={{ padding: '8px 0', maxHeight: '60vh', overflow: 'auto' }}>
              {dateGroups.length === 0 ? (
                <div style={{ padding: 24, color: '#6b7280', textAlign: 'center' }}>No entries</div>
              ) : (
                dateGroups.map(([dateLabel, entries]) => (
                  <div key={dateLabel}>
                    <div style={{ padding: '6px 16px', background: '#f3f4f6', fontSize: 13, fontWeight: 600 }}>
                      {dateLabel}
                    </div>
                    {entries.map((entry, idx) => {
                      if (entry.type === 'exam') {
                        const e = entry.exam;
                        const desc = e.formName ?? 'Exam';
                        const provider = e.employee ? [e.employee.firstName, e.employee.lastName, e.employee.designation].filter(Boolean).join(' ') : '—';
                        return (
                          <div
                            key={`exam-${e.id}-${idx}`}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr auto',
                              gap: 12,
                              padding: '10px 16px',
                              borderBottom: '1px solid #eee',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>Exam Form</span>
                            <button
                              type="button"
                              onClick={() => setExamModal(e)}
                              style={{ textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit' }}
                            >
                              {desc}
                            </button>
                            <span style={{ fontSize: 13, color: '#6b7280' }}>{provider} — {formatDateTime(entry.date)}</span>
                          </div>
                        );
                      }
                      if (entry.type === 'lab') {
                        const lo = entry.labOrder;
                        const desc = lo.result ? `Final — ${lo.order?.labOrderType ?? 'Lab'}` : (lo.order?.labOrderType ?? 'Lab');
                        const provider = '—';
                        return (
                          <div
                            key={`lab-${lo.order?.id}-${idx}`}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr auto',
                              gap: 12,
                              padding: '10px 16px',
                              borderBottom: '1px solid #eee',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>Lab</span>
                            <button
                              type="button"
                              onClick={() => setLabResultModal(lo)}
                              style={{ textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit' }}
                            >
                              {desc}
                            </button>
                            <span style={{ fontSize: 13, color: '#6b7280' }}>{formatDateTime(entry.date)}</span>
                          </div>
                        );
                      }
                      if (entry.type === 'medication') {
                        const m = entry.medication;
                        return (
                          <div
                            key={`med-${m.id}-${idx}`}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr auto',
                              gap: 12,
                              padding: '10px 16px',
                              borderBottom: '1px solid #eee',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>Medication</span>
                            <span>{(m.name ?? '—').slice(0, 60)}{((m.name ?? '').length > 60 ? '…' : '')}</span>
                            <span style={{ fontSize: 13, color: '#6b7280' }}>{formatDateTime(entry.date)}</span>
                          </div>
                        );
                      }
                      const c = entry.complaint;
                      return (
                        <div
                          key={`complaint-${c.id}-${idx}`}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr auto',
                            gap: 12,
                            padding: '10px 16px',
                            borderBottom: '1px solid #eee',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>Complaint</span>
                          <span>{c.complaintName ?? '—'}</span>
                          <span style={{ fontSize: 13, color: '#6b7280' }}>{formatDateTime(entry.date)}</span>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: '8px 16px', fontSize: 13, color: '#6b7280', borderTop: '1px solid #e5e7eb' }}>
              Showing {timeline.length} entries
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ width: 320, flexShrink: 0 }}>
          {/* Patient summary (compact) */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, padding: 12, background: '#fff' }}>
            <strong>{patient?.name ?? '—'}</strong> {patient?.id && <span style={{ color: '#6b7280' }}>{patient.id}</span>}
            <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>{patient?.species} {patient?.breed}</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{patientSummaryLine.split('|').slice(2, 6).join(' | ')}</div>
            {patient?.alerts && <div style={{ marginTop: 6, color: '#b45309', fontSize: 12 }}>Alert: {patient.alerts}</div>}
          </div>

          {/* Latest Vital Signs */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 14 }}>
              Latest Vital Signs
            </div>
            <div style={{ padding: 12, fontSize: 14 }}>
              {latestVital ? (
                <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                  {latestVital.weight != null && <li>Weight: {weightWithUnit(latestVital.weight, latestVital.weightUnitValue)}</li>}
                  {latestVital.temperature != null && <li>Temperature: {latestVital.temperature}°</li>}
                  {latestVital.heartRate != null && <li>Heart Rate: {latestVital.heartRate}</li>}
                  {latestVital.respiratoryRate && <li>Respiratory Rate: {latestVital.respiratoryRate}</li>}
                  {latestVital.pulseQuality && <li>Pulse Quality: {latestVital.pulseQuality}</li>}
                  {latestVital.capillaryRefillTime && <li>Capillary Refill Time: {latestVital.capillaryRefillTime}</li>}
                  {latestVital.mucousMembrane && <li>Mucous Membrane: {latestVital.mucousMembrane}</li>}
                  {latestVital.hydration && <li>Hydration: {latestVital.hydration}</li>}
                  {latestVital.painScore && <li>Pain Score: {latestVital.painScore}</li>}
                  {latestVital.bodyConditionScore && <li>Body Condition Score: {latestVital.bodyConditionScore}</li>}
                  {latestVital.fasScore && <li>FAS Score: {latestVital.fasScore}{latestVital.fasScoreComments ? ` (${latestVital.fasScoreComments})` : ''}</li>}
                  {!latestVital.weight && !latestVital.temperature && !latestVital.heartRate && !latestVital.capillaryRefillTime && !latestVital.mucousMembrane && !latestVital.bodyConditionScore && !latestVital.fasScore && (
                    <li>No vital signs recorded</li>
                  )}
                </ul>
              ) : (
                <span style={{ color: '#6b7280' }}>No vital signs on file</span>
              )}
            </div>
          </div>

          {/* Medications */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 14 }}>
              Medications
            </div>
            <div style={{ padding: 12, fontSize: 14 }}>
              {(record.medications?.length ?? 0) === 0 ? (
                <span style={{ color: '#6b7280' }}>None</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {record.medications!.map((m) => (
                    <li key={m.id} style={{ marginBottom: 4 }}>
                      {(m.name ?? '—').slice(0, 50)}{((m.name ?? '').length > 50 ? '…' : '')} — {formatDate(m.dateOfService)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Master Problem (diagnoses) */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 14 }}>
              Master Problem
            </div>
            <div style={{ padding: 12, fontSize: 14 }}>
              {(record.diagnoses?.length ?? 0) === 0 ? (
                <span style={{ color: '#6b7280' }}>None</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {record.diagnoses!.map((d: DiagnosisItem) => (
                    <li key={d.id}>{d.name ?? d.description ?? `Diagnosis ${d.id}`}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LabResultModal({
  labOrder,
  onClose,
}: {
  labOrder: LabOrderItem | null;
  onClose: () => void;
}) {
  const open = labOrder != null;
  const result = labOrder?.result;
  const externalData = typeof result?.externalData === 'string' ? result.externalData : '';
  const parsed = externalData ? parseIdexxLabXml(externalData) : [];

  const title = open
    ? `Lab result — Order ${labOrder?.order?.id ?? '—'}${result?.reportDate ? ` · Report ${formatDate(result.reportDate)}` : ''}`
    : '';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {parsed.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            {parsed.map((panel, idx) => (
              <LabPanelBlock key={idx} panel={panel} />
            ))}
          </div>
        ) : externalData ? (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              maxHeight: '70vh',
              overflow: 'auto',
              background: '#f5f5f5',
              padding: 12,
              borderRadius: 8,
            }}
          >
            {externalData}
          </pre>
        ) : (
          <p style={{ color: '#666' }}>No result data available.</p>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function treatmentItemName(item: TreatmentItem): string {
  if (item.procedure?.name) return item.procedure.name;
  if (item.inventoryItem?.name) return item.inventoryItem.name;
  if (item.lab?.name) return item.lab.name;
  return 'Treatment item';
}

function ExamModal({
  exam,
  patientId,
  onClose,
}: {
  exam: ExamItem | null;
  patientId?: number;
  onClose: () => void;
}) {
  const open = exam != null;
  const title = open ? `${exam.formName ?? 'Exam'} — ${formatDate(exam.serviceDate)}` : '';

  const [fetchedTreatmentItems, setFetchedTreatmentItems] = useState<TreatmentItem[]>([]);
  const [treatmentItemsLoading, setTreatmentItemsLoading] = useState(false);

  useEffect(() => {
    if (!open || !exam?.serviceDate || !patientId) {
      setFetchedTreatmentItems([]);
      return;
    }
    const examDay = DateTime.fromISO(exam.serviceDate).toFormat('yyyy-MM-dd');
    setTreatmentItemsLoading(true);
    getPatientTreatmentHistory(patientId)
      .then((treatments) => {
        const items: TreatmentItem[] = [];
        treatments.forEach((t) => {
          (t.treatmentItems || []).forEach((item) => {
            const itemDay = DateTime.fromISO(item.serviceDate).toFormat('yyyy-MM-dd');
            if (itemDay === examDay) items.push(item);
          });
        });
        setFetchedTreatmentItems(items);
      })
      .catch(() => setFetchedTreatmentItems([]))
      .finally(() => setTreatmentItemsLoading(false));
  }, [open, exam?.serviceDate, patientId]);

  const treatmentItems = (exam?.treatmentItems && exam.treatmentItems.length > 0)
    ? exam.treatmentItems
    : fetchedTreatmentItems;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {exam && (
          <div style={{ marginTop: 8 }}>
            {exam.employee && (
              <p style={{ margin: '0 0 12px' }}>
                <strong>Provider:</strong> {[exam.employee.firstName, exam.employee.lastName, exam.employee.designation].filter(Boolean).join(' ')}
              </p>
            )}
            {exam.vitalSign && typeof exam.vitalSign === 'object' && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                <strong>Vital Signs</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {exam.vitalSign.weight != null && <li>Weight: {weightWithUnit(exam.vitalSign.weight, exam.vitalSign.weightUnitValue)}</li>}
                  {exam.vitalSign.temperature != null && <li>Temperature: {exam.vitalSign.temperature}°</li>}
                  {exam.vitalSign.heartRate != null && <li>Heart Rate: {exam.vitalSign.heartRate}</li>}
                  {exam.vitalSign.respiratoryRate && <li>Respiratory Rate: {exam.vitalSign.respiratoryRate}</li>}
                  {exam.vitalSign.capillaryRefillTime && <li>Capillary Refill Time: {exam.vitalSign.capillaryRefillTime}</li>}
                  {exam.vitalSign.mucousMembrane && <li>Mucous Membrane: {exam.vitalSign.mucousMembrane}</li>}
                  {exam.vitalSign.bodyConditionScore && <li>Body Condition Score: {exam.vitalSign.bodyConditionScore}</li>}
                  {exam.vitalSign.fasScore && <li>FAS Score: {exam.vitalSign.fasScore}{exam.vitalSign.fasScoreComments ? ` — ${exam.vitalSign.fasScoreComments}` : ''}</li>}
                </ul>
              </div>
            )}
            {/* Treatment items for this exam */}
            {(treatmentItems.length > 0 || treatmentItemsLoading) && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f0fdf4', borderRadius: 8 }}>
                <strong>Treatment items</strong>
                {treatmentItemsLoading ? (
                  <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6b7280' }}>Loading…</p>
                ) : (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                    {treatmentItems.map((item, idx) => (
                      <li key={item.id ?? idx} style={{ marginBottom: 4 }}>
                        {treatmentItemName(item)}
                        {item.quantity > 1 && <span> × {item.quantity}</span>}
                        {item.totalPrice != null && typeof item.totalPrice === 'number' && (
                          <span style={{ color: '#6b7280', marginLeft: 6 }}>${item.totalPrice.toFixed(2)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {exam.comments && (
              <p style={{ margin: '0 0 12px' }}>
                <strong>Comments:</strong>
                <br />
                {exam.comments}
              </p>
            )}
            {exam.responses && exam.responses.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {exam.responses.map((r, i) =>
                  r.comment ? (
                    <div key={i} style={{ marginBottom: 12 }}>
                      {r.componentName && <strong>{r.componentName}:</strong>}
                      <div style={{ marginTop: 4 }} dangerouslySetInnerHTML={{ __html: r.comment }} />
                    </div>
                  ) : null
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function LabPanelBlock({ panel }: { panel: ParsedLabPanel }) {
  const hasTests = panel.tests.length > 0 || panel.subPanels.some((s) => s.tests.length > 0 || s.subPanels.length > 0);
  if (!panel.name && !hasTests) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      {panel.name && (
        <h4 style={{ margin: '0 0 8px', fontSize: '1rem', color: '#333' }}>{panel.name}</h4>
      )}
      {panel.tests.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #ddd' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Test</th>
              <th style={{ textAlign: 'right', padding: '6px 8px' }}>Result</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Unit</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Reference range</th>
            </tr>
          </thead>
          <tbody>
            {panel.tests.map((t, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '6px 8px' }}>{t.name || '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>{t.result || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{t.unit || '—'}</td>
                <td style={{ padding: '6px 8px' }}>
                  {[t.lowRange, t.highRange].filter(Boolean).length
                    ? `${t.lowRange || '—'} - ${t.highRange || '—'}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {panel.tests.some((t) => t.notes) && (
        <div style={{ marginTop: 8 }}>
          {panel.tests.map((t, i) =>
            t.notes ? (
              <div key={i} style={{ marginBottom: 6, fontSize: 13, color: '#555' }}>
                <strong>{t.name}:</strong> {t.notes}
              </div>
            ) : null
          )}
        </div>
      )}
      {panel.subPanels.map((sub, j) => (
        <div key={j} style={{ marginLeft: 16, marginTop: 12 }}>
          <LabPanelBlock panel={sub} />
        </div>
      ))}
    </div>
  );
}

function ClientLinkButton({
  patientId,
  onClientId,
  getPatientClientId,
}: {
  patientId: number;
  onClientId: (id: string) => void;
  getPatientClientId: (id: number) => Promise<string | number | null>;
}) {
  const [loading, setLoading] = useState(false);
  const [clientId, setClientId] = useState<string | number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPatientClientId(patientId).then((id) => {
      if (!cancelled) {
        setClientId(id);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [patientId, getPatientClientId]);

  if (loading) return <span style={{ color: '#666' }}>Loading client...</span>;
  if (clientId == null) return null;
  return (
    <button type="button" onClick={() => onClientId(String(clientId))}>
      View client
    </button>
  );
}
