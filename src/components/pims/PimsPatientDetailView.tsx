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
} from 'lucide-react';
import { fetchPatientByIdStaff } from '../../api/patients';
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

type MrRow = { id: string; type: string; description: string; provider: string; date: string; sortKey: number };

function parseMrDate(v: unknown): { display: string; sort: number } {
  const s = pickStr(v);
  if (!s) return { display: '—', sort: 0 };
  const t = Date.parse(s);
  return { display: s.length >= 10 ? s.slice(0, 10) : s, sort: Number.isFinite(t) ? t : 0 };
}

function extractMedicalRows(p: Record<string, unknown>): MrRow[] {
  const keys = ['medicalRecords', 'medicalRecordEntries', 'chartEntries', 'clinicalHistory', 'services', 'mrEntries'];
  let raw: unknown[] = [];
  for (const k of keys) {
    const v = p[k];
    if (Array.isArray(v)) {
      raw = v;
      break;
    }
  }
  const out: MrRow[] = [];
  raw.forEach((row, idx) => {
    if (!row || typeof row !== 'object') return;
    const o = row as Record<string, unknown>;
    const { display, sort } = parseMrDate(
      o.date ?? o.serviceDate ?? o.performedDate ?? o.createdAt ?? o.recordDate
    );
    const prov =
      pickStr(o.providerName) ??
      pickStr(o.doctorName) ??
      (typeof o.provider === 'string' ? o.provider : null) ??
      (o.provider && typeof o.provider === 'object'
        ? pickStr((o.provider as Record<string, unknown>).name)
        : null) ??
      '—';
    out.push({
      id: String(o.id ?? idx),
      type: pickStr(o.type) ?? pickStr(o.entryType) ?? pickStr(o.category) ?? '—',
      description:
        pickStr(o.description) ??
        pickStr(o.note) ??
        pickStr(o.summary) ??
        pickStr(o.name) ??
        '—',
      provider: prov,
      date: display,
      sortKey: sort,
    });
  });
  return out.sort((a, b) => b.sortKey - a.sortKey);
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

type MrTab = 'highlights' | 'groups' | 'byDate' | 'byDateDetail' | 'wellness';

type Props = {
  patientId: string;
  onBack: () => void;
};

export default function PimsPatientDetailView({ patientId, onBack }: Props) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mrTab, setMrTab] = useState<MrTab>('byDate');
  const [dateStart, setDateStart] = useState('2000-01-01');
  const [dateEnd, setDateEnd] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    (async () => {
      try {
        const data = await fetchPatientByIdStaff(patientId);
        if (cancelled) return;
        if (data && typeof data === 'object') setPayload(data as Record<string, unknown>);
        else setError('Patient not found.');
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load patient.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const client = payload ? clientBlockFromPatient(payload) : null;
  const pname = payload ? patientNameFrom(payload) : '';
  const cname = client ? clientDisplayName(client) : pickStr(payload?.clientName) ?? '—';
  const alert = payload ? alertText(payload, client) : null;
  const badge = payload ? patientDetailStatus(payload) : { label: '—', variant: 'muted' as const };

  const mrRows = useMemo(() => (payload ? extractMedicalRows(payload) : []), [payload]);

  const filteredMr = useMemo(() => {
    const start = Date.parse(dateStart);
    const end = Date.parse(dateEnd + 'T23:59:59');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return mrRows;
    return mrRows.filter((r) => r.sortKey >= start && r.sortKey <= end);
  }, [mrRows, dateStart, dateEnd]);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, MrRow[]>();
    for (const r of filteredMr) {
      const key = r.date === '—' ? 'Unknown date' : r.date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  }, [filteredMr]);

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

  return (
    <div className="pims-patient-detail">
      <nav className="pims-patient-detail__crumb" aria-label="Breadcrumb">
        <Link to="/pims/patients">Patients</Link>
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
              ['wellness', 'Wellness Plan (0)'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mrTab === id}
              className={`pims-patient-detail__tab${mrTab === id ? ' pims-patient-detail__tab--active' : ''}`}
              onClick={() => setMrTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {mrTab === 'byDate' && (
          <>
            <div className="pims-patient-detail__filters">
              <label>
                Beginning Service Date
                <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
              </label>
              <label>
                Ending Service Date
                <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
              </label>
              <button type="button">Search</button>
              <button type="button">Refresh View</button>
              <button type="button">Show All</button>
            </div>
            <p className="pims-patient-detail__mr-count">
              Showing {filteredMr.length} out of {mrRows.length} entries
            </p>
            <div className="pims-patient-detail__mr-table-wrap">
              <table className="pims-patient-detail__mr-table">
                <thead>
                  <tr>
                    <th aria-label="Edit" />
                    <th aria-label="View" />
                    <th>Type</th>
                    <th>Description</th>
                    <th>Provider</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedByDate.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                        No entries in this date range.
                      </td>
                    </tr>
                  ) : (
                    groupedByDate.flatMap(([dateKey, rows]) => [
                      <tr key={`g-${dateKey}`} className="pims-patient-detail__date-group">
                        <td colSpan={6}>
                          {dateKey}
                        </td>
                      </tr>,
                      ...rows.map((r) => (
                        <tr key={r.id}>
                          <td>✎</td>
                          <td>›</td>
                          <td>{r.type}</td>
                          <td>{r.description}</td>
                          <td>{r.provider}</td>
                          <td>{r.date}</td>
                        </tr>
                      )),
                    ])
                  )}
                </tbody>
              </table>
            </div>
            {mrRows.length === 0 && (
              <div className="pims-patient-detail__api-note">
                <strong>No medical record rows on this payload.</strong> Wire{' '}
                <code>GET /patients/:id/medical-records</code> (or embed <code>medicalRecords</code> on{' '}
                <code>GET /patients/:id</code>) and this table will populate. Until then, other MR tabs are layout-only.
              </div>
            )}
          </>
        )}

        {mrTab !== 'byDate' && (
          <p className="pims-patient-detail__api-note">
            This tab is a placeholder matching the PIMS reference. Hook it to your MR API when available.
          </p>
        )}
      </section>

      <p style={{ marginTop: 20 }}>
        <button type="button" className="pims-patient-detail__link" onClick={onBack}>
          ← Back to patient search
        </button>
      </p>
    </div>
  );
}
