import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ChevronDown,
  ChevronRight,
  KeyRound,
  Mail,
  MapPin,
  MessageSquare,
  PawPrint,
  Pencil,
  Phone,
  User,
  UserCheck,
  UserX,
  AlertTriangle,
} from 'lucide-react';
import { listClientStatuses, type ClientStatusRow } from '../../api/clientStatuses';
import { fetchPrimaryProviders, type Provider } from '../../api/employee';
import { fetchClientByIdStaff, searchClientsStaff, type ClientSearchRow } from '../../api/clientsStaff';
import {
  deactivateClient,
  patchClientStaff,
  reactivateClient,
  type ScoutClientWrite,
} from '../../api/clientsMutations';
import { sendClientPortalAccess } from '../../api/users';
import { formatAddressFields } from '../../api/geo';
import { lookupClientZoneForAddress } from '../../api/zoneLookup';
import { apiBaseUrl } from '../../api/http';
import { AddressAutocomplete, type AddressFields } from '../AddressAutocomplete';
import { ManualAddressFields } from '../ManualAddressFields';
import { EMPTY_ADDRESS_FIELDS } from '../../utils/verifiedAddress';
import {
  addressLinesFromParts,
  extraAddressLabel,
  extraAddressParts,
  fieldsFromParts,
  formatAddressLine,
  homeAddressParts,
  mailingAddressFields,
  mailingSameAsService,
} from '../../utils/clientVisitAddresses';
import { BookPatientChartButton } from '../BookPatientChartButton';
import { PetThumb, publicMediaUrl } from './PetThumb';
import PimsAppointmentsSection from './PimsAppointmentsSection';
import ClientCommunicationsPanel from './ClientCommunicationsPanel';
import ClientFinancialWorkspace from './ClientFinancialWorkspace';
import AddPatientModal from './AddPatientModal';
import {
  ClientReachEmailLink,
  ClientReachHost,
  ClientReachLink,
  useClientReach,
} from './ClientReachHub';
import { useAuth } from '../../auth/useAuth';
import {
  readStaffClientLayout,
  writeStaffClientLayout,
  STAFF_UI_PREFS_EVENT,
} from '../../utils/staffUiPrefs';
import {
  accountBalanceFromClient,
  formatUsd,
  normalizeInvoicesFromClient,
  type NormalizedInvoice,
} from '../../utils/pimsInvoices';
import { scoutManagedState } from '../../utils/pimsScoutManaged';
import { appAlert, appConfirm } from '../../utils/appDialog';
import { CLIENT_NAME_PREFIX_OPTIONS, formatClientDisplayName } from '../../utils/clientNamePrefix';
import { pushRecentRecord } from '../../utils/recentRecordsStore';
import {
  DetailHeader,
  EditableCard,
  PimsBadge,
  TechnicalDetails,
  type CardValues,
  type FieldSpec,
} from './detail/PimsDetailKit';
import './detail/PimsDetailKit.css';
import './PimsPatientDetailView.css';
import './PimsClientDetailView.css';

const PIMS_CLIENT_DETAIL_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PIMS_CLIENT_DETAIL_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

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
  return publicMediaUrl(path, apiBaseUrl);
}

function displayName(c: Record<string, unknown>): string {
  return formatClientDisplayName(c);
}

function flagOn(v: unknown): boolean {
  return v === true || v === '1' || v === 'true';
}

function useClientSectionOpen(
  userId: string | null,
  key: 'pets' | 'visits' | 'prefs' | 'comms',
): [boolean, () => void] {
  const [open, setOpen] = useState(() => readStaffClientLayout(userId)[key]);

  useEffect(() => {
    const sync = () => setOpen(readStaffClientLayout(userId)[key]);
    sync();
    window.addEventListener(STAFF_UI_PREFS_EVENT, sync);
    return () => window.removeEventListener(STAFF_UI_PREFS_EVENT, sync);
  }, [userId, key]);

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      writeStaffClientLayout(userId, { [key]: next });
      return next;
    });
  }, [userId, key]);

  return [open, toggle];
}

function contactEmailRows(c: Record<string, unknown>): { label: string; email: string }[] {
  const primary = pickStr(c.email);
  const second = pickStr(c.secondEmail);
  const secondName = [pickStr(c.secondFirstName), pickStr(c.secondLastName)].filter(Boolean).join(' ');
  const seen = new Set<string>();
  const rows: { label: string; email: string }[] = [];
  if (primary) {
    seen.add(primary.toLowerCase());
    rows.push({ label: 'Primary', email: primary });
  }
  if (second && !seen.has(second.toLowerCase())) {
    seen.add(second.toLowerCase());
    rows.push({ label: secondName || 'Second contact', email: second });
  }
  for (const extra of readList(c.emails)) {
    if (seen.has(extra.toLowerCase())) continue;
    seen.add(extra.toLowerCase());
    rows.push({ label: 'Also on file', email: extra });
  }
  return rows;
}

function contactPhoneRows(c: Record<string, unknown>): { label: string; phone: string; sms: boolean }[] {
  const rows: { label: string; phone: string; sms: boolean }[] = [];
  const phone1 = pickStr(c.phone1);
  const phone2 = pickStr(c.phone2);
  if (phone1) rows.push({ label: 'Primary', phone: phone1, sms: c.phone1SmsEnabled !== false });
  if (phone2) rows.push({ label: 'Alternate', phone: phone2, sms: c.phone2SmsEnabled !== false });
  return rows;
}

type PortalAccount = {
  email: string | null;
  lastLoginAt: string | null;
  requiresPasswordReset: boolean;
  hasLoggedIn: boolean;
};

function portalAccountsFromRecord(c: Record<string, unknown>): PortalAccount[] {
  const raw = c.portalAccounts;
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(
    [pickStr(c.email), pickStr(c.secondEmail), ...readList(c.emails)]
      .filter((e): e is string => Boolean(e))
      .map((e) => e.toLowerCase()),
  );
  return raw
    .filter((a): a is PortalAccount => a != null && typeof a === 'object')
    .filter((a) => {
      const email = pickStr(a.email)?.toLowerCase();
      if (!email) return allowed.size === 0;
      return allowed.size === 0 || allowed.has(email);
    });
}

function formatPortalLogin(iso: string | null): string {
  if (!iso) return 'Never logged in';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never logged in';
  return `Last login ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

/** Street address on one line, city/state/ZIP on the next — the way it goes on an envelope. */
function addressLines(c: Record<string, unknown>): string[] {
  return addressLinesFromParts(homeAddressParts(c));
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
  const e = err as { response?: { data?: { message?: unknown } }; message?: string };
  const msg = e?.response?.data?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (Array.isArray(msg)) {
    const joined = msg.filter((m) => typeof m === 'string').join(' ').trim();
    if (joined) return joined;
  }
  return e?.message ?? 'Could not save client.';
}

const NAME_FIELDS: FieldSpec[] = [
  {
    key: 'namePrefix',
    label: 'Prefix',
    type: 'select',
    options: CLIENT_NAME_PREFIX_OPTIONS,
    display: (v) => v || '—',
  },
  { key: 'firstName', label: 'First name', required: true },
  { key: 'lastName', label: 'Last name', required: true },
  { key: 'secondFirstName', label: 'Second contact first name' },
  { key: 'secondLastName', label: 'Second contact last name' },
  {
    key: 'referralSource',
    label: 'How they heard about us',
    full: true,
  },
];

const ALERT_FIELDS: FieldSpec[] = [
  {
    key: 'alerts',
    label: 'Client alerts',
    type: 'textarea',
    full: true,
    placeholder: 'Gate code, aggressive dog on property, payment arrangement…',
    hint: 'Shown in red under this client’s name.',
  },
];

const CONNECTION_NOTES_FIELDS: FieldSpec[] = [
  {
    key: 'connectionNotes',
    label: 'Connection Notes (staff only)',
    type: 'textarea',
    full: true,
    placeholder: 'Daughter is a competitive dancer, just moved from…',
    hint: 'Shown in green under this client’s name. Internal only — never on forms, emails, or client-facing documents.',
  },
];

const PHONE_FIELDS: FieldSpec[] = [
  { key: 'phone1', label: 'Primary phone', type: 'tel' },
  {
    key: 'phone1Type',
    label: 'Primary phone type',
    type: 'select',
    options: [
      { value: '', label: '—' },
      { value: 'mobile', label: 'Mobile' },
      { value: 'home', label: 'Home' },
      { value: 'primary', label: 'Default / Primary' },
    ],
  },
  {
    key: 'phone1SmsEnabled',
    label: 'Primary is SMS-enabled',
    type: 'checkbox',
    hint: 'Uncheck for landlines or numbers that cannot receive texts.',
  },
  { key: 'phone2', label: 'Alternate phone', type: 'tel' },
  {
    key: 'phone2Type',
    label: 'Alternate phone type',
    type: 'select',
    options: [
      { value: '', label: '—' },
      { value: 'mobile', label: 'Mobile' },
      { value: 'home', label: 'Home' },
      { value: 'primary', label: 'Default / Primary' },
    ],
  },
  {
    key: 'phone2SmsEnabled',
    label: 'Alternate is SMS-enabled',
    type: 'checkbox',
    hint: 'Uncheck for landlines or numbers that cannot receive texts.',
  },
];

const EMAIL_FIELDS: FieldSpec[] = [
  { key: 'email', label: 'Email', type: 'email' },
  {
    key: 'noEmail',
    label: 'No Email',
    type: 'checkbox',
  },
  { key: 'secondEmail', label: 'Second contact email', type: 'email' },
];

type HeaderEdit = 'name' | 'phone' | 'email' | 'address' | 'alerts' | 'connectionNotes' | null;

function recordToAddressFields(c: Record<string, unknown>): AddressFields {
  return {
    line1: pickStr(c.address1) ?? '',
    line2: pickStr(c.address2) ?? undefined,
    city: pickStr(c.city) ?? '',
    state: pickStr(c.state) ?? '',
    zip: pickStr(c.zipcode) ?? '',
    country: 'US',
    lat: toNum(c.lat) ?? undefined,
    lon: toNum(c.lon) ?? undefined,
  };
}

function ClientHouseholdDefaultsCard({
  record,
  onSave,
}: {
  record: Record<string, unknown>;
  onSave: (body: ScoutClientWrite) => Promise<void>;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [statuses, setStatuses] = useState<ClientStatusRow[]>([]);
  const [primaryProviderId, setPrimaryProviderId] = useState(
    () => String(Number(record.primaryProviderId) > 0 ? record.primaryProviderId : ''),
  );
  const [clientStatusId, setClientStatusId] = useState(() => {
    const nested = record.clientStatus;
    const fromNested =
      nested && typeof nested === 'object' ? Number((nested as { id?: unknown }).id) : NaN;
    const fromFlat = Number(record.clientStatusId);
    const id = Number.isFinite(fromNested) && fromNested > 0 ? fromNested : fromFlat;
    return Number.isFinite(id) && id > 0 ? String(id) : '';
  });
  const [referralSource, setReferralSource] = useState(pickStr(record.referralSource) ?? '');
  const [referralClientId, setReferralClientId] = useState(
    () => String(Number(record.referralClientId) > 0 ? record.referralClientId : ''),
  );
  const [referralClientName, setReferralClientName] = useState(
    pickStr(record.referralClientName) ?? '',
  );
  const [referralQuery, setReferralQuery] = useState('');
  const [referralHits, setReferralHits] = useState<ClientSearchRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrimaryProviderId(String(Number(record.primaryProviderId) > 0 ? record.primaryProviderId : ''));
    const nested = record.clientStatus;
    const fromNested =
      nested && typeof nested === 'object' ? Number((nested as { id?: unknown }).id) : NaN;
    const fromFlat = Number(record.clientStatusId);
    const id = Number.isFinite(fromNested) && fromNested > 0 ? fromNested : fromFlat;
    setClientStatusId(Number.isFinite(id) && id > 0 ? String(id) : '');
    setReferralSource(pickStr(record.referralSource) ?? '');
    setReferralClientId(String(Number(record.referralClientId) > 0 ? record.referralClientId : ''));
    setReferralClientName(pickStr(record.referralClientName) ?? '');
    setError(null);
  }, [record]);

  useEffect(() => {
    let on = true;
    void Promise.all([
      fetchPrimaryProviders().catch(() => [] as Provider[]),
      listClientStatuses({ includeInactive: true }).catch(() => [] as ClientStatusRow[]),
    ]).then(([emps, sts]) => {
      if (!on) return;
      setProviders(emps || []);
      setStatuses(sts || []);
    });
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    const q = referralQuery.trim();
    if (q.length < 2) {
      setReferralHits([]);
      return;
    }
    let on = true;
    const t = window.setTimeout(() => {
      void searchClientsStaff(q)
        .then((rows) => {
          if (on) setReferralHits(rows.slice(0, 8));
        })
        .catch(() => {
          if (on) setReferralHits([]);
        });
    }, 250);
    return () => {
      on = false;
      window.clearTimeout(t);
    };
  }, [referralQuery]);

  async function persist() {
    setSaving(true);
    setError(null);
    try {
      const pp = Number(primaryProviderId);
      const cs = Number(clientStatusId);
      const rc = Number(referralClientId);
      await onSave({
        primaryProviderId: Number.isFinite(pp) && pp > 0 ? pp : null,
        clientStatusId: Number.isFinite(cs) && cs > 0 ? cs : null,
        referralSource: referralSource.trim() || null,
        referralClientId: Number.isFinite(rc) && rc > 0 ? rc : null,
      });
    } catch (e) {
      setError(extractErr(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pims-detail__card">
      <h3 className="pims-detail__card-title">Household defaults</h3>
      <p className="pims-detail__muted" style={{ marginTop: 0 }}>
        Primary provider is the default for new patients. Discount uses Account Status from Settings.
      </p>
      {error ? <p className="pims-detail__banner-error">{error}</p> : null}
      <div className="pims-add-client-modal__grid" style={{ marginTop: 8 }}>
        <label>
          <span className="pims-add-client-modal__label">Primary provider</span>
          <select
            className="input"
            value={primaryProviderId}
            onChange={(e) => setPrimaryProviderId(e.target.value)}
          >
            <option value="">None</option>
            {providers.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name?.trim() ||
                  [p.firstName, p.lastName].filter(Boolean).join(' ').trim() ||
                  `Provider #${p.id}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="pims-add-client-modal__label">Discount (Account Status)</span>
          <select
            className="input"
            value={clientStatusId}
            onChange={(e) => setClientStatusId(e.target.value)}
          >
            <option value="">None</option>
            {statuses.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
                {Number(s.discount) ? ` (${Number(s.discount)}%)` : ''}
                {s.isActive === false ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="pims-add-client-modal__full">
          <span className="pims-add-client-modal__label">How they heard about us</span>
          <input
            className="input"
            value={referralSource}
            onChange={(e) => setReferralSource(e.target.value)}
          />
        </label>
        <div className="pims-add-client-modal__full">
          <span className="pims-add-client-modal__label">Referring client (friend/family)</span>
          {referralClientId ? (
            <div className="pims-add-patient__owner-selected">
              <span>{referralClientName || `Client #${referralClientId}`}</span>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setReferralClientId('');
                  setReferralClientName('');
                }}
              >
                Clear
              </button>
            </div>
          ) : (
            <>
              <input
                className="input"
                value={referralQuery}
                onChange={(e) => setReferralQuery(e.target.value)}
                placeholder="Search clients…"
              />
              {referralHits.length ? (
                <ul className="pims-add-patient__owner-results">
                  {referralHits.map((row) => {
                    const label =
                      [row.firstName, row.lastName].filter(Boolean).join(' ').trim() ||
                      `Client #${row.id}`;
                    return (
                      <li key={String(row.id)}>
                        <button
                          type="button"
                          className="pims-add-patient__owner-option"
                          onClick={() => {
                            setReferralClientId(String(row.id));
                            setReferralClientName(label);
                            setReferralHits([]);
                            setReferralQuery('');
                          }}
                        >
                          {label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn" disabled={saving} onClick={() => void persist()}>
          {saving ? 'Saving…' : 'Save household defaults'}
        </button>
      </div>
    </div>
  );
}

function ReachEditButton({
  label,
  expanded,
  onClick,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="pims-client-detail__reach-edit"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <Pencil size={13} aria-hidden />
    </button>
  );
}

function ClientCommunicationPrefsCard({
  record,
  onSave,
  collapsed,
  onToggleCollapse,
}: {
  record: Record<string, unknown>;
  onSave: (body: ScoutClientWrite) => Promise<void>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [doNotEmail, setDoNotEmail] = useState(flagOn(record.doNotEmail));
  const [doNotSms, setDoNotSms] = useState(flagOn(record.doNotSms) || flagOn(record.smsOptOut));
  const [doNotSendReminders, setDoNotSendReminders] = useState(flagOn(record.doNotSendReminders));
  const [preferSms, setPreferSms] = useState(record.preferSms !== false);
  const [preferPhone, setPreferPhone] = useState(record.preferPhone !== false);
  const [preferEmail, setPreferEmail] = useState(record.preferEmail !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDoNotEmail(flagOn(record.doNotEmail));
    setDoNotSms(flagOn(record.doNotSms) || flagOn(record.smsOptOut));
    setDoNotSendReminders(flagOn(record.doNotSendReminders));
    setPreferSms(record.preferSms !== false);
    setPreferPhone(record.preferPhone !== false);
    setPreferEmail(record.preferEmail !== false);
    setError(null);
  }, [record]);

  async function persist(next: {
    doNotEmail: boolean;
    doNotSms: boolean;
    doNotSendReminders: boolean;
    preferSms: boolean;
    preferPhone: boolean;
    preferEmail: boolean;
  }) {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        doNotEmail: next.doNotEmail,
        doNotSms: next.doNotSms,
        smsOptOut: next.doNotSms,
        doNotSendReminders: next.doNotSendReminders,
        preferSms: next.preferSms,
        preferPhone: next.preferPhone,
        preferEmail: next.preferEmail,
      });
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pims-emr-story__card pims-client-detail__comms-prefs" aria-labelledby="pims-client-prefs">
      {onToggleCollapse ? (
        <button
          type="button"
          id="pims-client-prefs"
          className="pims-emr-story__collapse"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          <MessageSquare size={15} aria-hidden />
          Communication
        </button>
      ) : (
        <h3 id="pims-client-prefs">
          <MessageSquare size={15} aria-hidden />
          Communication
        </h3>
      )}
      {collapsed ? null : (
      <>
      {error ? (
        <p className="pims-detail__form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pims-client-detail__comms-cols">
        <fieldset className="pims-client-detail__comms-set" disabled={saving}>
          <legend>Do not contact</legend>
          <label>
            <input
              type="checkbox"
              checked={doNotEmail}
              onChange={(e) => {
                const next = e.target.checked;
                setDoNotEmail(next);
                if (next) setPreferEmail(false);
                void persist({
                  doNotEmail: next,
                  doNotSms,
                  doNotSendReminders,
                  preferSms,
                  preferPhone,
                  preferEmail: next ? false : preferEmail,
                });
              }}
            />
            Do not email
          </label>
          <label>
            <input
              type="checkbox"
              checked={doNotSms}
              onChange={(e) => {
                const next = e.target.checked;
                setDoNotSms(next);
                if (next) setPreferSms(false);
                void persist({
                  doNotEmail,
                  doNotSms: next,
                  doNotSendReminders,
                  preferSms: next ? false : preferSms,
                  preferPhone,
                  preferEmail,
                });
              }}
            />
            Do not SMS
          </label>
          <label>
            <input
              type="checkbox"
              checked={doNotSendReminders}
              onChange={(e) => {
                const next = e.target.checked;
                setDoNotSendReminders(next);
                void persist({
                  doNotEmail,
                  doNotSms,
                  doNotSendReminders: next,
                  preferSms,
                  preferPhone,
                  preferEmail,
                });
              }}
            />
            Do not send reminders
          </label>
          <p className="pims-client-detail__comms-hint">
            Blocks automated email/SMS. Staff can still text after a warning.
          </p>
        </fieldset>
        <fieldset className="pims-client-detail__comms-set" disabled={saving}>
          <legend>Communication preferences</legend>
          <label>
            <input
              type="checkbox"
              checked={preferSms}
              disabled={doNotSms}
              onChange={(e) => {
                const next = e.target.checked;
                setPreferSms(next);
                void persist({
                  doNotEmail,
                  doNotSms,
                  doNotSendReminders,
                  preferSms: next,
                  preferPhone,
                  preferEmail,
                });
              }}
            />
            SMS
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferPhone}
              onChange={(e) => {
                const next = e.target.checked;
                setPreferPhone(next);
                void persist({
                  doNotEmail,
                  doNotSms,
                  doNotSendReminders,
                  preferSms,
                  preferPhone: next,
                  preferEmail,
                });
              }}
            />
            Phone call
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferEmail}
              disabled={doNotEmail}
              onChange={(e) => {
                const next = e.target.checked;
                setPreferEmail(next);
                void persist({
                  doNotEmail,
                  doNotSms,
                  doNotSendReminders,
                  preferSms,
                  preferPhone,
                  preferEmail: next,
                });
              }}
            />
            Email
          </label>
          <p className="pims-client-detail__comms-hint">
            Same choices the client can set in the client portal.
          </p>
        </fieldset>
      </div>
      </>
      )}
    </section>
  );
}

function ClientAddressEditor({
  record,
  zoneText,
  geo,
  onCancel,
  onSave,
}: {
  record: Record<string, unknown>;
  zoneText: string | null;
  geo: { text: string; tone: 'ok' | 'warn' | 'muted' };
  onCancel: () => void;
  onSave: (body: ScoutClientWrite) => Promise<void>;
}) {
  const [addr, setAddr] = useState<AddressFields>(() => recordToAddressFields(record));
  const [unit, setUnit] = useState(() => pickStr(record.address2) ?? '');
  const [address3, setAddress3] = useState(() => pickStr(record.address3) ?? '');
  const [county, setCounty] = useState(() => pickStr(record.county) ?? '');
  const [mailingSame, setMailingSame] = useState(() => mailingSameAsService(record));
  const [mailingManual, setMailingManual] = useState(() => {
    const line = pickStr(record.mailingAddress1) ?? '';
    return /p\.?\s*o\.?\s*box/i.test(line);
  });
  const [mailing, setMailing] = useState<AddressFields>(() =>
    mailingSameAsService(record) ? { ...EMPTY_ADDRESS_FIELDS } : mailingAddressFields(record),
  );
  const [extraLabel, setExtraLabel] = useState(() => pickStr(record.extraAddressLabel) ?? '');
  const [hasExtra, setHasExtra] = useState(() => Boolean(pickStr(record.extraAddress1)));
  const [extra, setExtra] = useState<AddressFields>(() =>
    pickStr(record.extraAddress1)
      ? fieldsFromParts(extraAddressParts(record))
      : { ...EMPTY_ADDRESS_FIELDS },
  );
  const [zonePreview, setZonePreview] = useState<string | null>(zoneText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const line = formatAddressFields({ ...addr, line2: unit || addr.line2 });
    if (!addr.line1.trim() || !addr.city.trim() || !addr.state.trim()) {
      setZonePreview(zoneText);
      return;
    }
    let cancelled = false;
    lookupClientZoneForAddress(line)
      .then((z) => {
        if (cancelled) return;
        setZonePreview(z?.displayLabel ?? null);
      })
      .catch(() => {
        if (!cancelled) setZonePreview(zoneText);
      });
    return () => {
      cancelled = true;
    };
  }, [addr.line1, addr.city, addr.state, addr.zip, unit, addr.line2, zoneText]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!addr.line1.trim()) {
      setError('Street address is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const line = formatAddressFields({ ...addr, line2: unit || addr.line2 });
      let zoneId: number | null | undefined;
      try {
        const zone = await lookupClientZoneForAddress(line);
        if (zone) zoneId = zone.isOutOfServiceArea ? null : zone.zoneId;
      } catch {
        zoneId = undefined;
      }
      if (!mailingSame && !mailing.line1.trim()) {
        setError('Enter a mailing address or keep “Same as location” checked.');
        setSaving(false);
        return;
      }
      if (hasExtra && !extra.line1.trim()) {
        setError('Enter the second visit address or turn it off.');
        setSaving(false);
        return;
      }
      const lat = addr.lat != null && Number.isFinite(addr.lat) ? addr.lat : null;
      const lon = addr.lon != null && Number.isFinite(addr.lon) ? addr.lon : null;
      const extraLat = extra.lat != null && Number.isFinite(extra.lat) ? extra.lat : null;
      const extraLon = extra.lon != null && Number.isFinite(extra.lon) ? extra.lon : null;
      await onSave({
        address1: addr.line1.trim() || null,
        address2: (unit.trim() || addr.line2?.trim() || '') || null,
        address3: address3.trim() || null,
        city: addr.city.trim() || null,
        state: addr.state.trim() || null,
        zipcode: addr.zip.trim() || null,
        county: county.trim() || null,
        country: 'US',
        lat,
        lon,
        latLonValidated: lat != null && lon != null,
        ...(zoneId !== undefined ? { zoneId } : {}),
        mailingSameAsService: mailingSame,
        mailingAddress1: mailingSame ? null : mailing.line1.trim() || null,
        mailingAddress2: mailingSame ? null : mailing.line2?.trim() || null,
        mailingCity: mailingSame ? null : mailing.city.trim() || null,
        mailingState: mailingSame ? null : mailing.state.trim() || null,
        mailingZipcode: mailingSame ? null : mailing.zip.trim() || null,
        mailingCountry: mailingSame ? null : 'US',
        extraAddressLabel: hasExtra ? extraLabel.trim() || 'Other address' : null,
        extraAddress1: hasExtra ? extra.line1.trim() || null : null,
        extraAddress2: hasExtra ? extra.line2?.trim() || null : null,
        extraCity: hasExtra ? extra.city.trim() || null : null,
        extraState: hasExtra ? extra.state.trim() || null : null,
        extraZipcode: hasExtra ? extra.zip.trim() || null : null,
        extraCountry: hasExtra ? 'US' : null,
        extraLat: hasExtra ? extraLat : null,
        extraLon: hasExtra ? extraLon : null,
        extraLatLonValidated: hasExtra && extraLat != null && extraLon != null,
      });
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pims-detail__card">
      <header className="pims-detail__card-head">
        <h3 className="pims-detail__card-title">
          <span className="pims-detail__card-icon">
            <MapPin size={16} aria-hidden />
          </span>
          Address
        </h3>
      </header>
      <div className="pims-detail__card-body">
        <form onSubmit={submit}>
          {error ? (
            <p className="pims-detail__form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="pims-detail__field-grid pims-detail__field-grid--2">
            <div className="pims-detail__field pims-detail__field--full">
              <label className="pims-detail__field-label" htmlFor="pims-client-address-search">
                Location — where we show up
              </label>
              <AddressAutocomplete
                id="pims-client-address-search"
                value={addr}
                onChange={(next) => {
                  setAddr({ ...next, country: 'US' });
                  if (next.line2) setUnit(next.line2);
                }}
                placeholder="Start typing the street address"
                compact
                inputClassName="input"
              />
            </div>
            <div className="pims-detail__field pims-detail__field--full">
              <label className="pims-detail__field-label" htmlFor="pims-client-address-unit">
                Apartment, suite, unit
              </label>
              <input
                id="pims-client-address-unit"
                className="input"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
            <div className="pims-detail__field pims-detail__field--full">
              <label className="pims-detail__field-label" htmlFor="pims-client-address-line3">
                Additional address line
              </label>
              <input
                id="pims-client-address-line3"
                className="input"
                value={address3}
                onChange={(e) => setAddress3(e.target.value)}
              />
            </div>
            <div className="pims-detail__field">
              <label className="pims-detail__field-label" htmlFor="pims-client-address-county">
                County
              </label>
              <input
                id="pims-client-address-county"
                className="input"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
              />
            </div>
          </div>
          <div className="pims-detail__field pims-detail__field--full" style={{ marginTop: 16 }}>
            <label className="pims-detail__field-label">
              <input
                type="checkbox"
                checked={mailingSame}
                onChange={(e) => {
                  setMailingSame(e.target.checked);
                  if (e.target.checked) {
                    setMailing({ ...EMPTY_ADDRESS_FIELDS });
                    setMailingManual(false);
                  }
                }}
              />{' '}
              Mailing address is the same as the location
            </label>
          </div>
          {!mailingSame ? (
            <div className="pims-detail__field-grid pims-detail__field-grid--2">
              <div className="pims-detail__field pims-detail__field--full">
                <label className="pims-detail__field-label">
                  <input
                    type="checkbox"
                    checked={mailingManual}
                    onChange={(e) => setMailingManual(e.target.checked)}
                  />{' '}
                  PO Box or address that is not listed
                </label>
                {mailingManual ? (
                  <ManualAddressFields
                    value={mailing}
                    onChange={setMailing}
                    errorPrefix="mailing"
                    line1Placeholder="PO Box 123 or street address"
                  />
                ) : (
                  <AddressAutocomplete
                    id="pims-client-mailing-search"
                    value={mailing}
                    onChange={(next) => setMailing({ ...next, country: 'US' })}
                    placeholder="Start typing the mailing address"
                    compact
                    inputClassName="input"
                  />
                )}
              </div>
            </div>
          ) : null}

          <div className="pims-detail__field pims-detail__field--full" style={{ marginTop: 16 }}>
            <label className="pims-detail__field-label">
              <input
                type="checkbox"
                checked={hasExtra}
                onChange={(e) => {
                  setHasExtra(e.target.checked);
                  if (!e.target.checked) {
                    setExtra({ ...EMPTY_ADDRESS_FIELDS });
                    setExtraLabel('');
                  }
                }}
              />{' '}
              Add a second visit address (work, mom’s house, etc.)
            </label>
          </div>
          {hasExtra ? (
            <div className="pims-detail__field-grid pims-detail__field-grid--2">
              <div className="pims-detail__field">
                <label className="pims-detail__field-label" htmlFor="pims-client-extra-label">
                  Label
                </label>
                <input
                  id="pims-client-extra-label"
                  className="input"
                  value={extraLabel}
                  onChange={(e) => setExtraLabel(e.target.value)}
                  placeholder="Mom’s house"
                />
              </div>
              <div className="pims-detail__field pims-detail__field--full">
                <label className="pims-detail__field-label" htmlFor="pims-client-extra-search">
                  Second visit address
                </label>
                <AddressAutocomplete
                  id="pims-client-extra-search"
                  value={extra}
                  onChange={(next) => setExtra({ ...next, country: 'US' })}
                  placeholder="Start typing the other address"
                  compact
                  inputClassName="input"
                />
              </div>
            </div>
          ) : null}

          <div className="pims-client-detail__routing">
            <span className="pims-detail__stat-label">Routing</span>
            <div className="pims-client-detail__routing-row">
              <PimsBadge tone={geo.tone}>{geo.text}</PimsBadge>
              {zonePreview ? <PimsBadge tone="muted">{zonePreview}</PimsBadge> : null}
            </div>
          </div>
          <div className="pims-detail__form-actions">
            <button
              type="button"
              className="pims-detail__btn-secondary"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="pims-detail__btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

type Props = {
  clientId: string;
  onBack: () => void;
};

export default function PimsClientDetailView({ clientId, onBack }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { employeeId, userId } = useAuth();
  const financialTab = searchParams.get('tab') === 'financial';
  const invoiceParam = searchParams.get('invoice');
  const patientParam = searchParams.get('patientId');
  const appointmentParam = searchParams.get('appointmentId');
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [headerEdit, setHeaderEdit] = useState<HeaderEdit>(null);
  const [commsTick, setCommsTick] = useState(0);
  const [headerBalance, setHeaderBalance] = useState<number | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const financialRef = useRef<HTMLDivElement>(null);
  const [petsOpen, togglePetsOpen] = useClientSectionOpen(userId, 'pets');
  const [visitsOpen, toggleVisitsOpen] = useClientSectionOpen(userId, 'visits');
  const [prefsOpen, togglePrefsOpen] = useClientSectionOpen(userId, 'prefs');
  const [commsOpen, toggleCommsOpen] = useClientSectionOpen(userId, 'comms');
  const reach = useClientReach();
  const [addPetOpen, setAddPetOpen] = useState(false);

  const patientsBasePath = '/schedule/patients';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    setActionError(null);
    setHeaderEdit(null);
    setHeaderBalance(null);
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

  useEffect(() => {
    if (!payload) return;
    const name = displayName(payload);
    if (!name) return;
    pushRecentRecord({ kind: 'client', id: clientId, name });
  }, [clientId, payload]);

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

  const toggleHeaderEdit = useCallback((next: HeaderEdit) => {
    setHeaderEdit((cur) => (cur === next ? null : next));
  }, []);

  const openFinancial = useCallback(
    (invoice?: string | null) => {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'financial');
      if (invoice) next.set('invoice', invoice);
      else next.delete('invoice');
      setSearchParams(next, { replace: false });
      requestAnimationFrame(() => {
        financialRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (!financialTab || loading) return;
    financialRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [financialTab, loading, clientId]);

  if (loading) return <div className="pims-detail__loading">Loading client…</div>;

  if (error || !payload) {
    return (
      <div className="pims-detail">
        <div className="pims-detail__error">{error ?? 'Client not found.'}</div>
        <button type="button" className="pims-detail__link" onClick={onBack}>
          Close
        </button>
      </div>
    );
  }

  const record = payload;
  const name = displayName(record);
  const evetBalance = accountBalanceFromClient(record);
  const scoutState = scoutManagedState(record, 'client');
  const isActive = record.isActive === true;
  const alerts = pickStr(record.alerts);
  const connectionNotes = pickStr(record.connectionNotes);
  const emailRows = contactEmailRows(record);
  const phoneRows = contactPhoneRows(record);
  const portalAccounts = portalAccountsFromRecord(record);
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
      const ok = await appConfirm({
        title: 'Deactivate client?',
        message: `Deactivate ${name}? They stay in Scout with all history and appointments intact, but are hidden from active lists.`,
        confirmLabel: 'Deactivate',
        danger: true,
      });
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

  async function handleSendResetPassword() {
    if (!primaryEmail) {
      await appAlert({
        title: 'No email on file',
        message: 'Add an email before sending a portal password reset.',
      });
      return;
    }
    const ok = await appConfirm({
      title: 'Send reset password?',
      message: `Email a portal password reset to ${primaryEmail}? If they do not have an account yet, this invites them instead.`,
      confirmLabel: 'Send',
    });
    if (!ok) return;
    setResetBusy(true);
    setActionError(null);
    try {
      const result = await sendClientPortalAccess(Number(clientId));
      await appAlert({
        title: result.invited ? 'Portal invite sent' : 'Reset email sent',
        message: result.invited
          ? `An invite to set up the client portal was sent to ${primaryEmail}.`
          : `A password reset link was sent to ${primaryEmail}.`,
      });
    } catch (err) {
      setActionError(extractErr(err));
    } finally {
      setResetBusy(false);
    }
  }

  const nameValues: CardValues = {
    namePrefix: pickStr(record.namePrefix) ?? '',
    firstName: pickStr(record.firstName) ?? '',
    lastName: pickStr(record.lastName) ?? '',
    secondFirstName: pickStr(record.secondFirstName) ?? '',
    secondLastName: pickStr(record.secondLastName) ?? '',
    referralSource: pickStr(record.referralSource) ?? '',
  };

  const phoneValues: CardValues = {
    phone1: phone1 ?? '',
    phone1Type: pickStr(record.phone1Type) ?? '',
    phone1SmsEnabled: record.phone1SmsEnabled === false ? '0' : '1',
    phone2: phone2 ?? '',
    phone2Type: pickStr(record.phone2Type) ?? '',
    phone2SmsEnabled: record.phone2SmsEnabled === false ? '0' : '1',
  };

  const doNotEmail = flagOn(record.doNotEmail);
  const doNotSms = flagOn(record.doNotSms) || flagOn(record.smsOptOut);
  const doNotSendReminders = flagOn(record.doNotSendReminders);

  // Only the stored `email` column is editable. `emails` can be a multi-address list from
  // eVet, and round-tripping a comma-joined version of it would collapse them into one value.
  const emailValues: CardValues = {
    email: pickStr(record.email) ?? '',
    noEmail: record.noEmail === true ? '1' : '0',
    secondEmail: pickStr(record.secondEmail) ?? '',
  };

  const financialPets = patients
    .map((p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) return null;
      const nested = p.primaryProvider;
      const fromNested =
        nested && typeof nested === 'object' ? Number((nested as { id?: unknown }).id) : NaN;
      const fromFlat = Number(p.primaryProviderId);
      const primaryProviderId = Number.isFinite(fromNested) && fromNested > 0
        ? fromNested
        : Number.isFinite(fromFlat) && fromFlat > 0
          ? fromFlat
          : null;
      return { id, name: pickStr(p.name) ?? `Pet #${id}`, primaryProviderId };
    })
    .filter((p): p is { id: number; name: string; primaryProviderId: number | null } => p != null);

  const zoneText = zone ? `Zone ${zone.replace(/^Zone\s+/i, '')}` : null;

  return (
    <div className="pims-detail pims-detail--emr">
      <DetailHeader
        avatar={
          <div className="pims-detail__avatar" aria-hidden>
            <User size={26} strokeWidth={1.6} />
          </div>
        }
        title={
          <span className="pims-client-detail__title">
            {name}
            <ReachEditButton
              label="Edit contact"
              expanded={headerEdit === 'name'}
              onClick={() => toggleHeaderEdit('name')}
            />
          </span>
        }
        badges={
          <>
            <PimsBadge tone={isActive ? 'ok' : 'muted'}>{isActive ? 'Active' : 'Inactive'}</PimsBadge>
            {scoutState.scoutManaged ? (
              <PimsBadge tone="info" title={scoutState.title}>
                {scoutState.label}
              </PimsBadge>
            ) : null}
            {discount != null && discount > 0 ? (
              <PimsBadge tone="warn">{discount}% discount</PimsBadge>
            ) : null}
            {doNotEmail ? <PimsBadge tone="warn">Do not email</PimsBadge> : null}
            {doNotSms ? <PimsBadge tone="warn">Do not SMS</PimsBadge> : null}
            {doNotSendReminders ? <PimsBadge tone="warn">No reminders</PimsBadge> : null}
            {portalAccounts.some((a) => a.hasLoggedIn) ? (
              <PimsBadge tone="ok">Portal login</PimsBadge>
            ) : portalAccounts.length ? (
              <PimsBadge tone="muted">Portal unused</PimsBadge>
            ) : (
              <PimsBadge tone="muted">No portal</PimsBadge>
            )}
          </>
        }
        reach={
          <>
            {phoneRows.length ? (
              phoneRows.map((row, i) => (
                <li key={`${row.label}-${row.phone}`}>
                  <Phone size={15} aria-hidden />
                  {phoneRows.length > 1 ? (
                    <span className="pims-client-detail__addr-kind">{row.label}</span>
                  ) : null}
                  <ClientReachLink onClick={(el) => reach.openPhoneMenu(row.phone, el)}>
                    {row.phone}
                  </ClientReachLink>
                  {row.sms ? <span className="pims-client-detail__sms-tag">SMS</span> : null}
                  {i === 0 ? (
                    <ReachEditButton
                      label="Edit phone"
                      expanded={headerEdit === 'phone'}
                      onClick={() => toggleHeaderEdit('phone')}
                    />
                  ) : null}
                </li>
              ))
            ) : (
              <li>
                <Phone size={15} aria-hidden />
                <span className="pims-client-detail__reach-empty">No phone</span>
                <ReachEditButton
                  label="Edit phone"
                  expanded={headerEdit === 'phone'}
                  onClick={() => toggleHeaderEdit('phone')}
                />
              </li>
            )}
            {emailRows.length ? (
              emailRows.map((row, i) => (
                <li key={`${row.label}-${row.email}`}>
                  <Mail size={15} aria-hidden />
                  {emailRows.length > 1 ? (
                    <span className="pims-client-detail__addr-kind">{row.label}</span>
                  ) : null}
                  <ClientReachEmailLink onClick={() => reach.openEmail(row.email)}>
                    {row.email}
                  </ClientReachEmailLink>
                  {i === 0 ? (
                    <ReachEditButton
                      label="Edit email"
                      expanded={headerEdit === 'email'}
                      onClick={() => toggleHeaderEdit('email')}
                    />
                  ) : null}
                </li>
              ))
            ) : (
              <li>
                <Mail size={15} aria-hidden />
                <span className="pims-client-detail__reach-empty">No email</span>
                <ReachEditButton
                  label="Edit email"
                  expanded={headerEdit === 'email'}
                  onClick={() => toggleHeaderEdit('email')}
                />
              </li>
            )}
            <li>
              <MapPin size={15} aria-hidden />
              {address.length ? (
                <span>{address.join(', ')}</span>
              ) : (
                <span className="pims-client-detail__reach-empty">No address on file</span>
              )}
              {zoneText ? <span className="pims-emr-zone-badge">{zoneText}</span> : null}
              <ReachEditButton
                label="Edit address"
                expanded={headerEdit === 'address'}
                onClick={() => toggleHeaderEdit('address')}
              />
            </li>
            {!mailingSameAsService(record) ? (
              <li>
                <span className="pims-client-detail__addr-kind">Mailing</span>
                {formatAddressLine({
                  address1: record.mailingAddress1,
                  address2: record.mailingAddress2,
                  city: record.mailingCity,
                  state: record.mailingState,
                  zip: record.mailingZipcode,
                }) || '—'}
              </li>
            ) : null}
            {pickStr(record.extraAddress1) ? (
              <li>
                <span className="pims-client-detail__addr-kind">{extraAddressLabel(record)}</span>
                {formatAddressLine(extraAddressParts(record))}
              </li>
            ) : null}
          </>
        }
        afterReach={
            <div
              className={`pims-emr-header-alerts${
                ' pims-emr-header-alerts--pair'
              }`}
            >
              <div className="pims-emr-alert-box" role={alerts ? 'alert' : undefined}>
                <div className="pims-emr-alert-box__head">
                  <span className="pims-emr-alert-box__label">Client alerts</span>
                  <ReachEditButton
                    label="Edit client alerts"
                    expanded={headerEdit === 'alerts'}
                    onClick={() => toggleHeaderEdit('alerts')}
                  />
                </div>
                {alerts ? (
                  alerts
                ) : (
                  <span className="pims-emr-alert-box__empty">No client alerts</span>
                )}
              </div>
              <div className="pims-emr-alert-box pims-emr-alert-box--connection">
                <div className="pims-emr-alert-box__head">
                  <span className="pims-emr-alert-box__label">Connection Notes (staff only)</span>
                  <ReachEditButton
                    label="Edit connection notes"
                    expanded={headerEdit === 'connectionNotes'}
                    onClick={() => toggleHeaderEdit('connectionNotes')}
                  />
                </div>
                {connectionNotes ? (
                  connectionNotes
                ) : (
                  <span className="pims-emr-alert-box__empty">No connection notes</span>
                )}
              </div>
            </div>
        }
        stat={
          <button
            type="button"
            className="pims-detail__stat pims-detail__stat--link"
            onClick={() => openFinancial()}
          >
            <span className="pims-detail__stat-label">
              {(headerBalance ?? evetBalance ?? 0) > 0.005
                ? 'Balance due'
                : (headerBalance ?? evetBalance ?? 0) < -0.005
                  ? 'Credit'
                  : 'Balance'}
            </span>
            <span
              className={`pims-detail__stat-value${
                (headerBalance ?? evetBalance ?? 0) > 0.005
                  ? ' pims-detail__stat-value--owed'
                  : (headerBalance ?? evetBalance ?? 0) < -0.005
                    ? ' pims-detail__stat-value--credit'
                    : ''
              }`}
            >
              {formatUsd(Math.abs(headerBalance ?? evetBalance ?? 0))}
            </span>
          </button>
        }
        actions={
          <>
            <button type="button" className="pims-detail__btn-primary" onClick={() => openFinancial()}>
              Invoices
            </button>
            <button
              type="button"
              className="pims-detail__btn-secondary"
              onClick={() => void handleSendResetPassword()}
              disabled={resetBusy || busy}
              title={primaryEmail ? `Send a portal password reset to ${primaryEmail}` : 'Add an email first'}
            >
              <KeyRound size={14} aria-hidden />
              {resetBusy ? 'Sending…' : 'Send Reset Password'}
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

      {actionError ? <p className="pims-detail__banner-error">{actionError}</p> : null}

      {headerEdit === 'name' ? (
        <div className="pims-client-detail__header-edit">
          <EditableCard
            title="Contact"
            icon={<User size={16} aria-hidden />}
            fields={NAME_FIELDS}
            values={nameValues}
            defaultEditing
            onCancel={() => setHeaderEdit(null)}
            onSave={async (v) => {
              await saveFields({
                namePrefix: v.namePrefix.trim() || null,
                firstName: v.firstName.trim() || null,
                lastName: v.lastName.trim() || null,
                secondFirstName: v.secondFirstName.trim() || null,
                secondLastName: v.secondLastName.trim() || null,
                referralSource: v.referralSource.trim() || null,
              });
              setHeaderEdit(null);
            }}
          />
        </div>
      ) : null}

      {headerEdit === 'alerts' ? (
        <div className="pims-client-detail__header-edit">
          <EditableCard
            title="Client alerts"
            icon={<AlertTriangle size={16} aria-hidden />}
            fields={ALERT_FIELDS}
            values={{ alerts: alerts ?? '' }}
            defaultEditing
            onCancel={() => setHeaderEdit(null)}
            emptyHint="No client alerts."
            onSave={async (v) => {
              await saveFields({ alerts: v.alerts.trim() || null });
              setHeaderEdit(null);
            }}
          />
        </div>
      ) : null}

      {headerEdit === 'connectionNotes' ? (
        <div className="pims-client-detail__header-edit">
          <EditableCard
            title="Connection Notes"
            icon={<MessageSquare size={16} aria-hidden />}
            fields={CONNECTION_NOTES_FIELDS}
            values={{ connectionNotes: connectionNotes ?? '' }}
            defaultEditing
            onCancel={() => setHeaderEdit(null)}
            emptyHint="No connection notes."
            onSave={async (v) => {
              await saveFields({ connectionNotes: v.connectionNotes.trim() || null });
              setHeaderEdit(null);
            }}
          />
        </div>
      ) : null}

      {headerEdit === 'phone' ? (
        <div className="pims-client-detail__header-edit">
          <EditableCard
            title="Phone"
            icon={<Phone size={16} aria-hidden />}
            fields={PHONE_FIELDS}
            values={phoneValues}
            defaultEditing
            onCancel={() => setHeaderEdit(null)}
            emptyHint="No phone on file."
            onSave={async (v) => {
              await saveFields({
                phone1: v.phone1.trim() || null,
                phone1Type: v.phone1Type.trim() || null,
                phone2: v.phone2.trim() || null,
                phone2Type: v.phone2Type.trim() || null,
                phone1SmsEnabled: v.phone1SmsEnabled !== '0',
                phone2SmsEnabled: v.phone2SmsEnabled !== '0',
              });
              setHeaderEdit(null);
            }}
          />
        </div>
      ) : null}

      {headerEdit === 'email' ? (
        <div className="pims-client-detail__header-edit">
          <EditableCard
            title="Email"
            icon={<Mail size={16} aria-hidden />}
            fields={EMAIL_FIELDS}
            values={emailValues}
            defaultEditing
            onCancel={() => setHeaderEdit(null)}
            emptyHint="No email on file."
            onSave={async (v) => {
              const noEmail = v.noEmail === '1' || v.noEmail === 'true';
              await saveFields({
                noEmail,
                email: noEmail ? null : v.email.trim() || null,
                secondEmail: v.secondEmail.trim() || null,
              });
              setHeaderEdit(null);
            }}
          >
            {extraEmails.length ? (
              <p className="pims-detail__muted pims-client-detail__extra-emails">
                Also on file from eVet: {extraEmails.join(', ')}
              </p>
            ) : null}
          </EditableCard>
        </div>
      ) : null}

      {headerEdit === 'address' ? (
        <div className="pims-client-detail__address-edit">
          <ClientAddressEditor
            record={record}
            zoneText={zoneText}
            geo={geo}
            onCancel={() => setHeaderEdit(null)}
            onSave={async (body) => {
              await saveFields(body);
              setHeaderEdit(null);
            }}
          />
        </div>
      ) : null}

      <ClientCommunicationPrefsCard
        record={record}
        onSave={saveFields}
        collapsed={!prefsOpen}
        onToggleCollapse={togglePrefsOpen}
      />

      <ClientHouseholdDefaultsCard record={record} onSave={saveFields} />

      <div className="pims-client-detail__story">
        <section className="pims-emr-story__card" aria-labelledby="pims-client-pets">
          <div className="pims-emr-story__collapse-row">
            <button
              type="button"
              id="pims-client-pets"
              className="pims-emr-story__collapse"
              onClick={togglePetsOpen}
              aria-expanded={petsOpen}
            >
              {petsOpen ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
              <PawPrint size={15} aria-hidden />
              Pets ({patients.length})
            </button>
            <button
              type="button"
              className="pims-detail__btn-quiet"
              onClick={() => setAddPetOpen(true)}
            >
              + Add pet
            </button>
          </div>
          {!petsOpen ? null : patients.length === 0 ? (
            <p className="pims-emr-story__muted">
              No pets on this client yet. Add one here to make them bookable.
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
                    <PetThumb src={img} size={44} className="pims-client-detail__pet-img" />
                    <div className="pims-client-detail__pet-main">
                      <div className="pims-client-detail__pet-name">
                        {pid ? (
                          <Link to={href}>{pickStr(p.name) ?? `Pet #${pid}`}</Link>
                        ) : (
                          <span>{pickStr(p.name) ?? 'Pet'}</span>
                        )}
                        {!petActive ? <PimsBadge tone="muted">Inactive</PimsBadge> : null}
                        {pid ? (
                          <BookPatientChartButton
                            patientId={pid}
                            patientName={pickStr(p.name) ?? `Pet #${pid}`}
                            practiceId={PIMS_CLIENT_DETAIL_PRACTICE_ID}
                            practiceTz={PIMS_CLIENT_DETAIL_TZ}
                            label="View details"
                          />
                        ) : null}
                      </div>
                      <p className="pims-client-detail__pet-summary">{petSummary(p)}</p>
                      {petAlerts ? (
                        <p className="pims-client-detail__pet-alert">
                          <AlertTriangle size={13} aria-hidden />
                          {petAlerts}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="pims-client-detail__story-stack">
          <section className="pims-emr-story__card pims-emr-story__card--visits">
            <PimsAppointmentsSection
              variant="client"
              compact
              collapsed={!visitsOpen}
              onToggleCollapse={toggleVisitsOpen}
              practiceId={PIMS_CLIENT_DETAIL_PRACTICE_ID}
              clientId={clientId}
              patients={patients}
            />
          </section>
        </div>
      </div>

      <div id="client-financial" ref={financialRef} className="pims-client-detail__financial">
        <ClientFinancialWorkspace
          clientId={Number(clientId)}
          clientName={name}
          evetBalance={evetBalance}
          evetInvoices={invoices}
          pets={financialPets}
          cashierEmployeeId={employeeId != null ? Number(employeeId) : null}
          clientEmail={primaryEmail}
          clientPhone={phone1}
          clientDoNotSms={doNotSms}
          initialInvoiceId={invoiceParam && invoiceParam !== 'new' ? invoiceParam : null}
          openNew={invoiceParam === 'new'}
          initialPatientId={patientParam ? Number(patientParam) : null}
          initialAppointmentId={appointmentParam ? Number(appointmentParam) : null}
          onCommunicationLogged={() => setCommsTick((n) => n + 1)}
          onCombinedBalance={setHeaderBalance}
          onSelectInvoice={(id) => {
            const next = new URLSearchParams(searchParams);
            next.set('tab', 'financial');
            if (id && id !== 'new') next.set('invoice', id);
            else if (id === 'new') next.set('invoice', 'new');
            else next.delete('invoice');
            setSearchParams(next, { replace: true });
          }}
        />
      </div>

      <ClientCommunicationsPanel
        clientId={Number(clientId)}
        refreshKey={commsTick}
        collapsed={!commsOpen}
        onToggleCollapse={toggleCommsOpen}
      />

      {Number.isFinite(Number(clientId)) ? (
        <ClientReachHost
          action={reach.action}
          onAction={reach.setAction}
          clientId={Number(clientId)}
          clientLabel={name}
          phones={phoneRows}
          pets={financialPets.map((p) => ({ id: p.id, name: p.name }))}
          defaultPatientIds={
            patientParam && Number.isFinite(Number(patientParam)) && Number(patientParam) > 0
              ? [Number(patientParam)]
              : []
          }
          doNotSms={doNotSms}
          epiphanyPatientId={patientParam}
          onRecordsChanged={() => setCommsTick((n) => n + 1)}
        />
      ) : null}

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
          {
            label: 'Portal login',
            value:
              portalAccounts.length === 0
                ? 'No portal account'
                : portalAccounts
                    .map((a) =>
                      [
                        a.email,
                        a.hasLoggedIn
                          ? formatPortalLogin(a.lastLoginAt)
                          : a.requiresPasswordReset
                            ? 'Invited, never logged in'
                            : 'Last login not recorded',
                      ]
                        .filter(Boolean)
                        .join(' — '),
                    )
                    .join('; '),
          },
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
          { label: 'Do not email', value: yn(record.doNotEmail) },
          { label: 'Do not SMS', value: yn(doNotSms) },
          { label: 'Do not send reminders', value: yn(record.doNotSendReminders) },
          { label: 'Prefer email', value: yn(record.preferEmail !== false) },
          { label: 'Prefer SMS', value: yn(record.preferSms !== false) },
          { label: 'Prefer phone', value: yn(record.preferPhone !== false) },
          { label: 'Primary SMS-enabled', value: yn(record.phone1SmsEnabled !== false) },
          { label: 'Alternate SMS-enabled', value: yn(record.phone2SmsEnabled !== false) },
          { label: 'Deleted', value: yn(record.isDeleted) },
        ]}
      />
      <AddPatientModal
        open={addPetOpen}
        defaultOwner={{ id: clientId, name }}
        onClose={() => setAddPetOpen(false)}
        onCreated={async () => {
          setAddPetOpen(false);
          await applyWriteResult(undefined);
        }}
      />
    </div>
  );
}
