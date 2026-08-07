import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ArrowLeft,
  ExternalLink,
  Mail,
  MapPin,
  PawPrint,
  Phone,
  Receipt,
  User,
  UserCheck,
  UserX,
  Wallet,
  AlertTriangle,
} from 'lucide-react';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import {
  deactivateClient,
  patchClientStaff,
  reactivateClient,
  type ScoutClientWrite,
} from '../../api/clientsMutations';
import { apiBaseUrl } from '../../api/http';
import PimsAppointmentsSection from './PimsAppointmentsSection';
import ClientInvoiceDetailModal from './ClientInvoiceDetailModal';
import {
  accountBalanceFromClient,
  normalizeInvoicesFromClient,
  type NormalizedInvoice,
} from '../../utils/pimsInvoices';
import { scoutManagedState } from '../../utils/pimsScoutManaged';
import { evetClientLink } from '../../utils/evet';
import {
  AlertBanner,
  Card,
  CollapsibleCard,
  DetailHeader,
  EditableCard,
  PimsBadge,
  TechnicalDetails,
  type CardValues,
  type FieldSpec,
} from './detail/PimsDetailKit';
import './detail/PimsDetailKit.css';
import './PimsClientDetailView.css';

const PIMS_CLIENT_DETAIL_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function readList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string' || typeof item === 'number') {
        const s = String(item).trim();
        if (s) out.push(s);
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const line =
          pickStr(o.phone) ??
          pickStr(o.number) ??
          pickStr(o.email) ??
          pickStr(o.label) ??
          pickStr(o.name);
        if (line) out.push(line);
      }
    }
    return out;
  }
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return [];
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/[$,]/g, '');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatTs(iso: unknown): string {
  const s = pickStr(iso);
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDateOnly(iso: unknown): string {
  const s = pickStr(iso);
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function yn(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '—';
}

function mediaUrl(path: unknown): string | null {
  const p = pickStr(path);
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  const base = apiBaseUrl.replace(/\/$/, '');
  return `${base}/${p.replace(/^\//, '')}`;
}

function displayName(c: Record<string, unknown>): string {
  const both = [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ');
  return both || `Client #${pickStr(c.id) ?? ''}`;
}

function clientEmails(c: Record<string, unknown>): string | null {
  return pickStr(c.email) ?? (readList(c.emails).join(', ') || null);
}

/** Street address on one line, city/state/ZIP on the next — the way it goes on an envelope. */
function addressLines(c: Record<string, unknown>): string[] {
  const street = [pickStr(c.address1), pickStr(c.address2), pickStr(c.address3)].filter(Boolean);
  const locality = [
    [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', '),
    pickStr(c.zipcode),
  ]
    .filter(Boolean)
    .join(' ');
  return [...street, locality].filter(Boolean) as string[];
}

function zoneLabel(c: Record<string, unknown>): string | null {
  const cz = c.clientZone;
  if (cz && typeof cz === 'object') {
    const name = pickStr((cz as Record<string, unknown>).name);
    if (name) return name;
  }
  return pickStr(c.zoneName);
}

/** How the coordinates were derived, in words rather than the raw match-level enum. */
function geocodeSummary(c: Record<string, unknown>): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  const hasCoords = toNum(c.lat) != null && toNum(c.lon) != null;
  if (!hasCoords) return { text: 'Not located yet', tone: 'warn' };
  const level = (pickStr(c.latLonMatchLevel) ?? '').toLowerCase();
  if (level === 'manual') return { text: 'Pinned manually', tone: 'ok' };
  if (c.latLonValidated === true) return { text: 'Verified address', tone: 'ok' };
  if (level.includes('street') || level.includes('rooftop') || level.includes('premise')) {
    return { text: 'Matched to street address', tone: 'ok' };
  }
  if (level) return { text: `Approximate (${level})`, tone: 'warn' };
  return { text: 'Located', tone: 'muted' };
}

/** Pet identity for the household list: "Spayed Female · 3y · Mini Goldendoodle". */
function petSummary(p: Record<string, unknown>): string {
  const sex = pickStr(p.sex);
  const neuter = pickStr(p.neuterStatus);
  const sexBit = [neuter, sex].filter(Boolean).join(' ') || null;
  const dob = pickStr(p.dob) ?? pickStr(p.dateOfBirth);
  const age = ageFromDob(dob);
  const breed = pickStr(p.breed) ?? pickStr(p.species);
  return [sexBit, age, breed].filter(Boolean).join(' · ') || 'No details recorded';
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
  if (years === 0) {
    const months = Math.max(
      0,
      (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()),
    );
    return `${months}mo`;
  }
  return `${years}y`;
}

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Could not save client.';
}

const NAME_FIELDS: FieldSpec[] = [
  { key: 'firstName', label: 'First name', required: true },
  { key: 'lastName', label: 'Last name', required: true },
  { key: 'secondFirstName', label: 'Second contact first name' },
  { key: 'secondLastName', label: 'Second contact last name' },
];

const CONTACT_FIELDS: FieldSpec[] = [
  { key: 'phone1', label: 'Primary phone', type: 'tel' },
  { key: 'phone2', label: 'Alternate phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'secondEmail', label: 'Second contact email', type: 'email' },
];

const ADDRESS_FIELDS: FieldSpec[] = [
  { key: 'address1', label: 'Street address', full: true },
  { key: 'address2', label: 'Apartment, suite, unit', full: true },
  { key: 'address3', label: 'Additional address line', full: true },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zipcode', label: 'ZIP code' },
  { key: 'county', label: 'County' },
  { key: 'country', label: 'Country' },
];

const LOCATION_FIELDS: FieldSpec[] = [
  {
    key: 'lat',
    label: 'Latitude',
    type: 'number',
    hint: 'Only set these to override an address that geocodes to the wrong spot.',
  },
  { key: 'lon', label: 'Longitude', type: 'number' },
];

const BILLING_FIELDS: FieldSpec[] = [
  {
    key: 'discount',
    label: 'Standing discount (%)',
    type: 'number',
    display: (v) => `${v}%`,
  },
];

type Props = {
  clientId: string;
  onBack: () => void;
};

export default function PimsClientDetailView({ clientId, onBack }: Props) {
  const location = useLocation();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<NormalizedInvoice | null>(null);

  const patientsBasePath = useMemo(
    () => (location.pathname.startsWith('/schedule/') ? '/schedule/patients' : '/pims/patients'),
    [location.pathname],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    setInvoiceDetail(null);
    setActionError(null);
    (async () => {
      try {
        const data = await fetchClientByIdStaff(clientId);
        if (cancelled) return;
        if (data && typeof data === 'object') setPayload(data as Record<string, unknown>);
        else setError('Client not found.');
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load client.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  /** Refreshes local state from a write response, falling back to a re-fetch. */
  const applyWriteResult = useCallback(
    async (updated: unknown) => {
      let next: Record<string, unknown> | null = null;
      if (updated && typeof updated === 'object' && !Array.isArray(updated)) {
        next = updated as Record<string, unknown>;
      } else {
        const data = await fetchClientByIdStaff(clientId);
        next = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
      }
      if (next) setPayload(next);
    },
    [clientId],
  );

  const saveFields = useCallback(
    async (body: ScoutClientWrite) => {
      await applyWriteResult(await patchClientStaff(clientId, body));
    },
    [applyWriteResult, clientId],
  );

  const invoices = useMemo(
    (): NormalizedInvoice[] => (payload ? normalizeInvoicesFromClient(payload) : []),
    [payload],
  );

  const patients = useMemo(() => {
    if (!payload) return [] as Record<string, unknown>[];
    const raw = payload.patients;
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is Record<string, unknown> => p != null && typeof p === 'object');
  }, [payload]);

  if (loading) return <div className="pims-detail__loading">Loading client…</div>;

  if (error || !payload) {
    return (
      <div className="pims-detail">
        <div className="pims-detail__error">{error ?? 'Client not found.'}</div>
        <button type="button" className="pims-detail__link" onClick={onBack}>
          Back to list
        </button>
      </div>
    );
  }

  const record = payload;
  const name = displayName(record);
  const balance = accountBalanceFromClient(record);
  const scoutState = scoutManagedState(record, 'client');
  const isActive = record.isActive === true;
  const clientPimsId = pickStr(record.pimsId) ?? String(record.id ?? clientId);
  const alerts = pickStr(record.alerts);
  const emails = clientEmails(record);
  const primaryEmail = pickStr(record.email);
  const extraEmails = readList(record.emails).filter((e) => e !== primaryEmail);
  const phone1 = pickStr(record.phone1);
  const phone2 = pickStr(record.phone2);
  const address = addressLines(record);
  const geo = geocodeSummary(record);
  const zone = zoneLabel(record);
  const discount = toNum(record.discount);

  async function handleToggleActive() {
    if (isActive) {
      const ok = window.confirm(
        `Deactivate ${name}? They stay in Scout with all history and appointments intact, but are hidden from active lists.`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await applyWriteResult(
        isActive ? await deactivateClient(clientId) : await reactivateClient(clientId),
      );
    } catch (err) {
      setActionError(extractErr(err));
    } finally {
      setBusy(false);
    }
  }

  const nameValues: CardValues = {
    firstName: pickStr(record.firstName) ?? '',
    lastName: pickStr(record.lastName) ?? '',
    secondFirstName: pickStr(record.secondFirstName) ?? '',
    secondLastName: pickStr(record.secondLastName) ?? '',
  };

  // Only the stored `email` column is editable. `emails` can be a multi-address list from
  // eVet, and round-tripping a comma-joined version of it would collapse them into one value.
  const contactValues: CardValues = {
    phone1: phone1 ?? '',
    phone2: phone2 ?? '',
    email: pickStr(record.email) ?? '',
    secondEmail: pickStr(record.secondEmail) ?? '',
  };

  const addressValues: CardValues = {
    address1: pickStr(record.address1) ?? '',
    address2: pickStr(record.address2) ?? '',
    address3: pickStr(record.address3) ?? '',
    city: pickStr(record.city) ?? '',
    state: pickStr(record.state) ?? '',
    zipcode: pickStr(record.zipcode) ?? '',
    county: pickStr(record.county) ?? '',
    country: pickStr(record.country) ?? '',
  };

  const locationValues: CardValues = {
    lat: toNum(record.lat) != null ? String(toNum(record.lat)) : '',
    lon: toNum(record.lon) != null ? String(toNum(record.lon)) : '',
  };

  const billingValues: CardValues = {
    discount: discount != null ? String(discount) : '',
  };

  const balanceTone =
    balance == null || Math.abs(balance) < 0.005
      ? ''
      : balance > 0
        ? ' pims-detail__stat-value--owed'
        : ' pims-detail__stat-value--credit';

  return (
    <div className="pims-detail">
      <button type="button" className="pims-detail__back" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden />
        Back to list
      </button>

      <DetailHeader
        avatar={
          <div className="pims-detail__avatar" aria-hidden>
            <User size={26} strokeWidth={1.6} />
          </div>
        }
        title={name}
        badges={
          <>
            <PimsBadge tone={isActive ? 'ok' : 'muted'}>{isActive ? 'Active' : 'Inactive'}</PimsBadge>
            <PimsBadge tone={scoutState.scoutManaged ? 'info' : 'muted'} title={scoutState.title}>
              {scoutState.label}
            </PimsBadge>
            {discount != null && discount > 0 ? (
              <PimsBadge tone="warn">{discount}% discount</PimsBadge>
            ) : null}
          </>
        }
        reach={
          <>
            {phone1 || phone2 ? (
              <li>
                <Phone size={15} aria-hidden />
                <a href={`tel:${(phone1 ?? phone2 ?? '').replace(/[^\d+]/g, '')}`}>
                  {[phone1, phone2].filter(Boolean).join(' · ')}
                </a>
              </li>
            ) : null}
            {emails ? (
              <li>
                <Mail size={15} aria-hidden />
                <a href={`mailto:${emails.split(',')[0].trim()}`}>{emails}</a>
              </li>
            ) : null}
            {address.length ? (
              <li>
                <MapPin size={15} aria-hidden />
                {address.join(', ')}
              </li>
            ) : null}
          </>
        }
        stat={
          balance != null ? (
            <div className="pims-detail__stat">
              <span className="pims-detail__stat-label">
                {balance > 0.005 ? 'Balance due' : balance < -0.005 ? 'Credit' : 'Balance'}
              </span>
              <span className={`pims-detail__stat-value${balanceTone}`}>
                {formatUsd(Math.abs(balance))}
              </span>
            </div>
          ) : null
        }
        actions={
          <>
            <a
              className="pims-detail__btn-secondary"
              href={evetClientLink(clientPimsId)}
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

      {actionError ? <p className="pims-detail__banner-error">{actionError}</p> : null}

      {alerts ? (
        <AlertBanner icon={<AlertTriangle size={20} aria-hidden />}>{alerts}</AlertBanner>
      ) : null}

      <div className="pims-detail__columns">
        <div className="pims-detail__col">
          <Card
            title={`Pets (${patients.length})`}
            icon={<PawPrint size={16} aria-hidden />}
            padded={patients.length === 0}
          >
            {patients.length === 0 ? (
              <p className="pims-detail__muted">
                No pets on this client yet. Add one from the Patients page to make them bookable.
              </p>
            ) : (
              <ul className="pims-client-detail__pets">
                {patients.map((p, idx) => {
                  const pid = p.id != null ? String(p.id) : '';
                  const href = pid
                    ? `${patientsBasePath}?patientId=${encodeURIComponent(pid)}`
                    : patientsBasePath;
                  const img = mediaUrl(p.imageUrl);
                  const petActive = p.isActive !== false;
                  const petAlerts = pickStr(p.alerts);
                  return (
                    <li
                      key={pid || pickStr(p.pimsId) || `pet-${idx}`}
                      className="pims-client-detail__pet"
                    >
                      {img ? (
                        <img
                          className="pims-client-detail__pet-img"
                          src={img}
                          alt=""
                          width={44}
                          height={44}
                        />
                      ) : (
                        <span className="pims-client-detail__pet-img pims-client-detail__pet-img--ph">
                          <PawPrint size={18} aria-hidden />
                        </span>
                      )}
                      <div className="pims-client-detail__pet-main">
                        <div className="pims-client-detail__pet-name">
                          {pid ? (
                            <Link to={href}>{pickStr(p.name) ?? `Pet #${pid}`}</Link>
                          ) : (
                            <span>{pickStr(p.name) ?? 'Pet'}</span>
                          )}
                          {!petActive ? <PimsBadge tone="muted">Inactive</PimsBadge> : null}
                          {petAlerts ? (
                            <span className="pims-client-detail__pet-alert" title={petAlerts}>
                              <AlertTriangle size={13} aria-hidden />
                              Alert
                            </span>
                          ) : null}
                        </div>
                        <p className="pims-client-detail__pet-summary">{petSummary(p)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <PimsAppointmentsSection
            variant="client"
            practiceId={PIMS_CLIENT_DETAIL_PRACTICE_ID}
            clientId={clientId}
            patients={patients}
          />

          <CollapsibleCard
            title="Invoices"
            icon={<Receipt size={16} aria-hidden />}
            count={invoices.length}
            defaultOpen={invoices.length > 0}
          >
            {invoices.length === 0 ? (
              <p className="pims-detail__muted">No invoices for this client yet.</p>
            ) : (
              <>
                <div className="pims-client-detail__invoice-list-scroll">
                  <table className="pims-client-detail__table pims-client-detail__table--invoice-summary">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Status</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => (
                        <tr
                          key={inv.key}
                          className="pims-client-detail__invoice-row--clickable"
                          tabIndex={0}
                          role="button"
                          aria-label={`Invoice ${inv.number}, ${inv.status}`}
                          onClick={() => setInvoiceDetail(inv)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setInvoiceDetail(inv);
                            }
                          }}
                        >
                          <td>
                            <span className="pims-client-detail__invoice-row-title">
                              #{inv.number} · {inv.date}
                            </span>
                          </td>
                          <td>{inv.status}</td>
                          <td>{formatUsd(inv.total)}</td>
                          <td>{formatUsd(inv.paid)}</td>
                          <td>{formatUsd(inv.due)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="pims-detail__muted">Select an invoice for line items and payments.</p>
              </>
            )}
          </CollapsibleCard>
        </div>

        <div className="pims-detail__col">
          <EditableCard
            title="Name"
            icon={<User size={16} aria-hidden />}
            fields={NAME_FIELDS}
            values={nameValues}
            onSave={(v) =>
              saveFields({
                firstName: v.firstName.trim() || null,
                lastName: v.lastName.trim() || null,
                secondFirstName: v.secondFirstName.trim() || null,
                secondLastName: v.secondLastName.trim() || null,
              })
            }
          />

          <EditableCard
            title="Contact"
            icon={<Phone size={16} aria-hidden />}
            fields={CONTACT_FIELDS}
            values={contactValues}
            emptyHint="No phone or email on file."
            onSave={(v) =>
              saveFields({
                phone1: v.phone1.trim() || null,
                phone2: v.phone2.trim() || null,
                email: v.email.trim() || null,
                secondEmail: v.secondEmail.trim() || null,
              })
            }
          >
            {extraEmails.length ? (
              <p className="pims-detail__muted pims-client-detail__extra-emails">
                Also on file from eVet: {extraEmails.join(', ')}
              </p>
            ) : null}
          </EditableCard>

          <EditableCard
            title="Address"
            icon={<MapPin size={16} aria-hidden />}
            fields={ADDRESS_FIELDS}
            values={addressValues}
            emptyHint="No address on file. Visits can't be routed without one."
            onSave={(v) =>
              saveFields({
                address1: v.address1.trim() || null,
                address2: v.address2.trim() || null,
                address3: v.address3.trim() || null,
                city: v.city.trim() || null,
                state: v.state.trim() || null,
                zipcode: v.zipcode.trim() || null,
                county: v.county.trim() || null,
                country: v.country.trim() || null,
              })
            }
            footer={
              <div className="pims-client-detail__routing">
                <span className="pims-detail__stat-label">Routing</span>
                <div className="pims-client-detail__routing-row">
                  <PimsBadge tone={geo.tone}>{geo.text}</PimsBadge>
                  {zone ? <PimsBadge tone="muted">{zone}</PimsBadge> : null}
                </div>
              </div>
            }
          />

          <EditableCard
            title="Map coordinates"
            icon={<MapPin size={16} aria-hidden />}
            fields={LOCATION_FIELDS}
            values={locationValues}
            emptyHint="Derived from the address automatically. Set these only to correct a bad match."
            onSave={(v) => {
              const lat = toNum(v.lat);
              const lon = toNum(v.lon);
              if (!v.lat.trim() && !v.lon.trim()) {
                return saveFields({ lat: null, lon: null });
              }
              if (lat == null || lon == null) {
                throw new Error('Enter both latitude and longitude, or clear both.');
              }
              return saveFields({ lat, lon, latLonValidated: true });
            }}
          />

          <EditableCard
            title="Alerts"
            icon={<AlertTriangle size={16} aria-hidden />}
            fields={[
              {
                key: 'alerts',
                label: 'Client alerts',
                type: 'textarea',
                full: true,
                placeholder: 'Gate code, aggressive dog on property, payment arrangement…',
                hint: 'Shown as a banner at the top of this client and on their visits.',
              },
            ]}
            values={{ alerts: alerts ?? '' }}
            columns={1}
            emptyHint="No alerts. Add one for anything staff should know before a visit."
            onSave={(v) => saveFields({ alerts: v.alerts.trim() || null })}
          />

          <EditableCard
            title="Billing"
            icon={<Wallet size={16} aria-hidden />}
            fields={BILLING_FIELDS}
            values={billingValues}
            columns={1}
            emptyHint="No standing discount."
            onSave={(v) => {
              const raw = v.discount.trim();
              if (!raw) return saveFields({ discount: null });
              const n = toNum(raw);
              if (n == null) throw new Error('Discount must be a number.');
              return saveFields({ discount: n });
            }}
          />

          <TechnicalDetails
            note={
              scoutState.scoutManaged
                ? 'Scout owns this record. eVet imports will not overwrite the fields above.'
                : 'eVet still owns this record. Editing any field above hands ownership to Scout.'
            }
            rows={[
              { label: 'Scout ID', value: String(record.id ?? clientId) },
              { label: 'PIMS ID', value: pickStr(record.pimsId) },
              { label: 'PIMS type', value: pickStr(record.pimsType) },
              { label: 'Portal username', value: pickStr(record.username) },
              { label: 'Created in Scout', value: formatTs(record.created) },
              { label: 'Updated in Scout', value: formatTs(record.updated) },
              { label: 'Created in eVet', value: formatDateOnly(record.externalCreated) },
              { label: 'Last Scout edit', value: formatTs(record.externalUpdated) },
              { label: 'Last eVet sync', value: formatTs(record.lastPimsSyncedAt) },
              {
                label: 'Coordinates',
                value:
                  toNum(record.lat) != null && toNum(record.lon) != null
                    ? `${toNum(record.lat)!.toFixed(6)}, ${toNum(record.lon)!.toFixed(6)}`
                    : null,
              },
              { label: 'Geocode match', value: pickStr(record.latLonMatchLevel) },
              { label: 'Address verified', value: yn(record.latLonValidated) },
              { label: 'SMS opted out', value: yn(record.smsOptOut) },
              { label: 'Deleted', value: yn(record.isDeleted) },
            ]}
          />
        </div>
      </div>

      {invoiceDetail ? (
        <ClientInvoiceDetailModal
          inv={invoiceDetail}
          balance={balance}
          onClose={() => setInvoiceDetail(null)}
        />
      ) : null}
    </div>
  );
}
