import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { findClientsMatchingVisitAddress } from '../../api/clientsByAddress';
import { fetchClientByIdStaff, searchClientsStaff, type ClientSearchRow } from '../../api/clientsStaff';
import { formatAddressFields } from '../../api/geo';
import { createClientScout, type ScoutClientWrite } from '../../api/clientsMutations';
import { searchPimsStaff } from '../../api/pimsSearch';
import { lookupClientZoneForAddress } from '../../api/zoneLookup';
import { listClientStatuses, type ClientStatusRow } from '../../api/clientStatuses';
import { fetchPrimaryProviders, type Provider } from '../../api/employee';
import { AddressAutocomplete, type AddressFields } from '../AddressAutocomplete';
import { ManualAddressFields } from '../ManualAddressFields';
import { CLIENT_NAME_PREFIX_OPTIONS } from '../../utils/clientNamePrefix';
import { formatAddressLine } from '../../utils/clientVisitAddresses';
import { EMPTY_ADDRESS_FIELDS } from '../../utils/verifiedAddress';
import { clientSearchRowHomeAddress } from '../../utils/visitAddressMatch';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

const PHONE_TYPES = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'home', label: 'Home' },
  { value: 'primary', label: 'Default / Primary' },
] as const;

const REFERRAL_OPTIONS = [
  'Referred by a friend or family',
  'Google / online search',
  'Social media',
  'Saw our van',
  'Veterinarian referral',
  'Other',
] as const;

function nestMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const msg = (data as { message?: unknown }).message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (Array.isArray(msg)) {
    const joined = msg.filter((m) => typeof m === 'string').join(' ').trim();
    return joined || null;
  }
  return null;
}

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: unknown }; message?: string };
  return nestMessage(e?.response?.data) ?? e?.message ?? 'Request failed';
}

function rowEmailMatch(row: ClientSearchRow, email: string): boolean {
  const want = email.trim().toLowerCase();
  if (!want) return false;
  const extras = Array.isArray(row.emails) ? row.emails : [];
  const nested =
    row.client && typeof row.client === 'object'
      ? (row.client as ClientSearchRow)
      : null;
  return [row.email, row.secondEmail, nested?.email, nested?.secondEmail, ...extras].some(
    (v) => typeof v === 'string' && v.trim().toLowerCase() === want,
  );
}

function unwrapSearchRow(row: ClientSearchRow): ClientSearchRow {
  const nested = row.client;
  if (nested && typeof nested === 'object') {
    return { ...(nested as ClientSearchRow), ...row, id: (nested as ClientSearchRow).id ?? row.id };
  }
  return row;
}

function existingClientLabel(row: ClientSearchRow): string {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  return name || `Client #${row.id}`;
}

function existingClientAddress(row: ClientSearchRow): string {
  return (
    clientSearchRowHomeAddress(row) ||
    formatAddressLine({
      address1: row.address1,
      city: row.city,
      state: row.state,
      zip: row.zipcode ?? row.zip,
    })
  );
}

function looksLikeEmail(value: string): boolean {
  const t = value.trim();
  const at = t.indexOf('@');
  return at > 0 && t.includes('.', at + 1) && t.length >= 6;
}

function normName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z]/g, '');
}

function firstNamesSimilar(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y || x.length < 2 || y.length < 2) return false;
  if (x === y) return true;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  return x.slice(0, 3) === y.slice(0, 3) && Math.abs(x.length - y.length) <= 2;
}

function lastNamesSimilar(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  return Boolean(x && y && x === y);
}

function clientNamesSimilar(first: string, last: string, row: ClientSearchRow): boolean {
  return lastNamesSimilar(last, String(row.lastName ?? '')) && firstNamesSimilar(first, String(row.firstName ?? ''));
}

async function findSimilarByName(first: string, last: string): Promise<ClientSearchRow[]> {
  const seen = new Map<string, ClientSearchRow>();
  for (const q of [`${first} ${last}`, last]) {
    try {
      const rows = await searchClientsStaff(q, { includeInactive: true });
      for (const row of rows) {
        if (clientNamesSimilar(first, last, row)) seen.set(String(row.id), row);
      }
    } catch {
      /* optional */
    }
  }
  return [...seen.values()].slice(0, 5);
}

async function findSimilarByAddress(line: string): Promise<ClientSearchRow[]> {
  try {
    const { ranked } = await findClientsMatchingVisitAddress(DEFAULT_PRACTICE_ID, line);
    return ranked
      .filter((hit) => hit.quality === 'exact' || hit.quality === 'strong')
      .map((hit) => hit.row)
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function findClientByEmail(email: string): Promise<ClientSearchRow | null> {
  const trimmed = email.trim();
  if (!looksLikeEmail(trimmed)) return null;

  const candidates: ClientSearchRow[] = [];
  try {
    const rows = await searchClientsStaff(trimmed, { includeInactive: true });
    candidates.push(...rows.map(unwrapSearchRow));
  } catch {
    /* keep going */
  }
  try {
    const pims = await searchPimsStaff(trimmed, {
      practiceId: DEFAULT_PRACTICE_ID,
      includeInactive: true,
    });
    candidates.push(...pims.clients.map(unwrapSearchRow));
  } catch {
    /* optional unified search */
  }

  const exact = candidates.find((row) => rowEmailMatch(row, trimmed));
  if (exact) return exact;

  for (const row of candidates.slice(0, 8)) {
    if (row.id == null) continue;
    try {
      const full = await fetchClientByIdStaff(row.id);
      if (full && typeof full === 'object' && rowEmailMatch(full as ClientSearchRow, trimmed)) {
        return full as ClientSearchRow;
      }
    } catch {
      /* optional enrich */
    }
  }
  return null;
}

function createdClientId(result: unknown): string | null {
  if (result && typeof result === 'object' && 'id' in (result as object)) {
    const id = (result as { id: unknown }).id;
    if (id != null) return String(id);
  }
  return null;
}

function providerLabel(p: Provider): string {
  return p.name?.trim() || [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || `Provider #${p.id}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** Receives the new client's internal id so the parent can open its detail view. */
  onCreated?: (clientId: string) => void;
};

/**
 * Creates a client that lives only in Scout (pimsType VAYD).
 */
export default function AddClientModal({ open, onClose, onCreated }: Props) {
  const [namePrefix, setNamePrefix] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [noEmail, setNoEmail] = useState(false);
  const [phone1, setPhone1] = useState('');
  const [phone1Type, setPhone1Type] = useState('mobile');
  const [phone1SmsEnabled, setPhone1SmsEnabled] = useState(true);
  const [phone2, setPhone2] = useState('');
  const [phone2Type, setPhone2Type] = useState('home');
  const [phone2SmsEnabled, setPhone2SmsEnabled] = useState(true);
  const [hasSecondPerson, setHasSecondPerson] = useState(false);
  const [secondFirstName, setSecondFirstName] = useState('');
  const [secondLastName, setSecondLastName] = useState('');
  const [secondEmail, setSecondEmail] = useState('');
  const [addr, setAddr] = useState<AddressFields>({ ...EMPTY_ADDRESS_FIELDS });
  const [unit, setUnit] = useState('');
  const [mailingSame, setMailingSame] = useState(true);
  const [mailingManual, setMailingManual] = useState(false);
  const [mailing, setMailing] = useState<AddressFields>({ ...EMPTY_ADDRESS_FIELDS });
  const [hasExtra, setHasExtra] = useState(false);
  const [extraLabel, setExtraLabel] = useState('');
  const [extra, setExtra] = useState<AddressFields>({ ...EMPTY_ADDRESS_FIELDS });
  const [alerts, setAlerts] = useState('');
  const [connectionNotes, setConnectionNotes] = useState('');
  const [referralSource, setReferralSource] = useState('');
  const [referralOther, setReferralOther] = useState('');
  const [referralClient, setReferralClient] = useState<ClientSearchRow | null>(null);
  const [referralQuery, setReferralQuery] = useState('');
  const [referralHits, setReferralHits] = useState<ClientSearchRow[]>([]);
  const [primaryProviderId, setPrimaryProviderId] = useState('');
  const [clientStatusId, setClientStatusId] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [statuses, setStatuses] = useState<ClientStatusRow[]>([]);
  const [preferSms, setPreferSms] = useState(true);
  const [preferPhone, setPreferPhone] = useState(true);
  const [preferEmail, setPreferEmail] = useState(true);
  const [doNotEmail, setDoNotEmail] = useState(false);
  const [doNotSms, setDoNotSms] = useState(false);
  const [doNotSendReminders, setDoNotSendReminders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailHit, setEmailHit] = useState<ClientSearchRow | null>(null);
  const [nameHits, setNameHits] = useState<ClientSearchRow[]>([]);
  const [addressHits, setAddressHits] = useState<ClientSearchRow[]>([]);

  const friendFamilyReferral = referralSource === 'Referred by a friend or family';

  const reset = useCallback(() => {
    setNamePrefix('');
    setFirstName('');
    setLastName('');
    setEmail('');
    setNoEmail(false);
    setPhone1('');
    setPhone1Type('mobile');
    setPhone1SmsEnabled(true);
    setPhone2('');
    setPhone2Type('home');
    setPhone2SmsEnabled(true);
    setHasSecondPerson(false);
    setSecondFirstName('');
    setSecondLastName('');
    setSecondEmail('');
    setAddr({ ...EMPTY_ADDRESS_FIELDS });
    setUnit('');
    setMailingSame(true);
    setMailingManual(false);
    setMailing({ ...EMPTY_ADDRESS_FIELDS });
    setHasExtra(false);
    setExtraLabel('');
    setExtra({ ...EMPTY_ADDRESS_FIELDS });
    setAlerts('');
    setConnectionNotes('');
    setReferralSource('');
    setReferralOther('');
    setReferralClient(null);
    setReferralQuery('');
    setReferralHits([]);
    setPrimaryProviderId('');
    setClientStatusId('');
    setPreferSms(true);
    setPreferPhone(true);
    setPreferEmail(true);
    setDoNotEmail(false);
    setDoNotSms(false);
    setDoNotSendReminders(false);
    setError(null);
    setEmailHit(null);
    setNameHits([]);
    setAddressHits([]);
  }, []);

  const goToClient = useCallback(
    (id: string | number) => {
      reset();
      onClose();
      onCreated?.(String(id));
    },
    [onClose, onCreated, reset],
  );

  const handleClose = useCallback(() => {
    if (!submitting) {
      reset();
      onClose();
    }
  }, [onClose, reset, submitting]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      fetchPrimaryProviders().catch(() => [] as Provider[]),
      listClientStatuses().catch(() => [] as ClientStatusRow[]),
    ]).then(([emps, sts]) => {
      if (cancelled) return;
      setProviders(emps || []);
      setStatuses(sts || []);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || noEmail || !looksLikeEmail(email)) {
      setEmailHit(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findClientByEmail(email).then((hit) => {
        if (!cancelled) setEmailHit(hit);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [email, noEmail, open]);

  useEffect(() => {
    if (!open) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (fn.length < 2 || ln.length < 2) {
      setNameHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findSimilarByName(fn, ln).then((hits) => {
        if (!cancelled) setNameHits(hits);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [firstName, lastName, open]);

  useEffect(() => {
    if (!open) return;
    if (!addr.line1.trim() || !addr.city.trim() || !addr.state.trim()) {
      setAddressHits([]);
      return;
    }
    const line = formatAddressFields({ ...addr, line2: unit || addr.line2 });
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findSimilarByAddress(line).then((hits) => {
        if (!cancelled) setAddressHits(hits);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addr, unit, open]);

  useEffect(() => {
    if (!open || !friendFamilyReferral) {
      setReferralHits([]);
      return;
    }
    const q = referralQuery.trim();
    if (q.length < 2) {
      setReferralHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchClientsStaff(q)
        .then((rows) => {
          if (!cancelled) setReferralHits(rows.slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setReferralHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [friendFamilyReferral, open, referralQuery]);

  const similarHits = useMemo(() => {
    const byId = new Map<string, { row: ClientSearchRow; reasons: string[] }>();
    const add = (row: ClientSearchRow, reason: string) => {
      const id = String(row.id);
      if (emailHit && id === String(emailHit.id)) return;
      const cur = byId.get(id);
      if (cur) {
        if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
        return;
      }
      byId.set(id, { row, reasons: [reason] });
    };
    for (const row of nameHits) add(row, 'name');
    for (const row of addressHits) add(row, 'address');
    return [...byId.values()].slice(0, 3);
  }, [addressHits, emailHit, nameHits]);

  if (!open) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      setError('First and last name are required.');
      return;
    }
    if (!noEmail && !email.trim()) {
      setError('Email is required, or check “No Email”.');
      return;
    }
    if (!noEmail && email.trim() && !looksLikeEmail(email)) {
      setError('Enter a valid email, or check “No Email”.');
      return;
    }
    if (!phone1.trim()) {
      setError('Phone is required.');
      return;
    }
    if (!addr.line1.trim() || !addr.city.trim() || !addr.state.trim()) {
      setError('Location (street, city, and state) is required.');
      return;
    }
    if (friendFamilyReferral && !referralClient) {
      setError('Select the friend or family member who referred them.');
      return;
    }

    setSubmitting(true);
    setError(null);

    if (!noEmail) {
      const duplicate = emailHit ?? (await findClientByEmail(email));
      if (duplicate) {
        setEmailHit(duplicate);
        setSubmitting(false);
        return;
      }
    }

    if (!mailingSame && !mailing.line1.trim()) {
      setError('Enter a mailing address or keep “Same as location” checked.');
      setSubmitting(false);
      return;
    }
    if (hasExtra && !extra.line1.trim()) {
      setError('Enter the second visit address or turn it off.');
      setSubmitting(false);
      return;
    }

    const lat = addr.lat != null && Number.isFinite(addr.lat) ? addr.lat : null;
    const lon = addr.lon != null && Number.isFinite(addr.lon) ? addr.lon : null;
    const extraLat = extra.lat != null && Number.isFinite(extra.lat) ? extra.lat : null;
    const extraLon = extra.lon != null && Number.isFinite(extra.lon) ? extra.lon : null;
    let zoneId: number | null | undefined;
    try {
      const zone = await lookupClientZoneForAddress(
        formatAddressFields({ ...addr, line2: unit || addr.line2 }),
      );
      if (zone) zoneId = zone.isOutOfServiceArea ? null : zone.zoneId;
    } catch {
      zoneId = undefined;
    }

    const referralText =
      referralSource === 'Other'
        ? referralOther.trim() || 'Other'
        : referralSource.trim() || null;

    const providerId = Number(primaryProviderId);
    const statusId = Number(clientStatusId);

    const body: ScoutClientWrite & { practiceId: number; firstName: string } = {
      practiceId: DEFAULT_PRACTICE_ID,
      namePrefix: namePrefix.trim() || null,
      firstName: fn,
      lastName: ln,
      noEmail,
      email: noEmail ? null : email.trim() || null,
      phone1: phone1.trim() || null,
      phone1Type: phone1Type || null,
      phone1SmsEnabled,
      phone2: hasSecondPerson || phone2.trim() ? phone2.trim() || null : null,
      phone2Type: phone2.trim() || hasSecondPerson ? phone2Type || null : null,
      phone2SmsEnabled,
      secondFirstName: hasSecondPerson ? secondFirstName.trim() || null : null,
      secondLastName: hasSecondPerson ? secondLastName.trim() || null : null,
      secondEmail: hasSecondPerson ? secondEmail.trim() || null : null,
      address1: addr.line1.trim() || null,
      address2: (unit.trim() || addr.line2?.trim() || '') || null,
      city: addr.city.trim() || null,
      state: addr.state.trim() || null,
      zipcode: addr.zip.trim() || null,
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
      alerts: alerts.trim() || null,
      connectionNotes: connectionNotes.trim() || null,
      referralSource: referralText,
      referralClientId: friendFamilyReferral && referralClient?.id != null
        ? Number(referralClient.id)
        : null,
      primaryProviderId: Number.isFinite(providerId) && providerId > 0 ? providerId : null,
      clientStatusId: Number.isFinite(statusId) && statusId > 0 ? statusId : null,
      preferSms,
      preferPhone,
      preferEmail,
      doNotEmail,
      doNotSms,
      smsOptOut: doNotSms,
      doNotSendReminders,
    };

    try {
      const result = await createClientScout(body);
      const newId = createdClientId(result);
      reset();
      onClose();
      if (newId && onCreated) onCreated(newId);
    } catch (err) {
      setError(extractErr(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pims-add-client-modal-root" role="presentation">
      <button type="button" className="pims-add-client-modal-backdrop" aria-label="Close" onClick={handleClose} />
      <div className="pims-add-client-modal" role="dialog" aria-modal="true" aria-labelledby="pims-add-client-title">
        <div className="pims-add-client-modal__head">
          <h2 id="pims-add-client-title">Add client</h2>
          <button type="button" className="pims-add-client-modal__close" onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className="pims-add-client-modal__form" onSubmit={onSubmit}>
          {error ? <div className="pims-add-client-modal__error">{error}</div> : null}
          <div className="pims-add-client-modal__grid">
            <div className="pims-add-client-modal__name-row">
              <label>
                <span className="pims-add-client-modal__label">Prefix</span>
                <select className="input" value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)}>
                  {CLIENT_NAME_PREFIX_OPTIONS.map((o) => (
                    <option key={o.value || 'none'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="pims-add-client-modal__label">First name *</span>
                <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </label>
              <label>
                <span className="pims-add-client-modal__label">Last name *</span>
                <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
              </label>
            </div>
            {similarHits.length ? (
              <div className="pims-add-client-modal__full pims-add-client-modal__warn" role="status">
                {similarHits.map(({ row, reasons }) => {
                  const why =
                    reasons.includes('name') && reasons.includes('address')
                      ? 'same name and address'
                      : reasons.includes('name')
                        ? 'similar name'
                        : 'similar address';
                  const address = existingClientAddress(row);
                  return (
                    <div key={String(row.id)} className="pims-add-client-modal__warn-row">
                      <div>
                        This looks like a similar client ({why}): <strong>{existingClientLabel(row)}</strong>
                        {address ? ` — ${address}` : ''}.
                      </div>
                      <button
                        type="button"
                        className="pims-add-client-modal__warn-go"
                        onClick={() => goToClient(row.id)}
                      >
                        Go to client
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="pims-add-client-modal__email-row">
              <label>
                <span className="pims-add-client-modal__label">Email *</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={noEmail}
                />
              </label>
              <label className="pims-add-client-modal__inline-check">
                <input
                  type="checkbox"
                  checked={noEmail}
                  onChange={(e) => {
                    setNoEmail(e.target.checked);
                    if (e.target.checked) {
                      setEmail('');
                      setEmailHit(null);
                      setPreferEmail(false);
                    }
                  }}
                />
                No Email
              </label>
            </div>
            {emailHit && !noEmail ? (
              <div className="pims-add-client-modal__full pims-add-client-modal__warn" role="status">
                <div className="pims-add-client-modal__warn-row">
                  <div>
                    This email is associated with another client:{' '}
                    <strong>{existingClientLabel(emailHit)}</strong>.
                  </div>
                  <button
                    type="button"
                    className="pims-add-client-modal__warn-go"
                    onClick={() => goToClient(emailHit.id)}
                  >
                    Go to client
                  </button>
                </div>
              </div>
            ) : null}
            <div className="pims-add-client-modal__phone-row">
              <label>
                <span className="pims-add-client-modal__label">Phone *</span>
                <input
                  className="input"
                  type="tel"
                  value={phone1}
                  onChange={(e) => setPhone1(e.target.value)}
                  required
                />
              </label>
              <label>
                <span className="pims-add-client-modal__label">Phone type</span>
                <select className="input" value={phone1Type} onChange={(e) => setPhone1Type(e.target.value)}>
                  {PHONE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pims-add-client-modal__inline-check">
                <input
                  type="checkbox"
                  checked={phone1SmsEnabled}
                  onChange={(e) => setPhone1SmsEnabled(e.target.checked)}
                />
                SMS-enabled
              </label>
            </div>
            <label className="pims-add-client-modal__full pims-add-client-modal__check">
              <input
                type="checkbox"
                checked={hasSecondPerson}
                onChange={(e) => {
                  setHasSecondPerson(e.target.checked);
                  if (!e.target.checked) {
                    setSecondFirstName('');
                    setSecondLastName('');
                    setSecondEmail('');
                  }
                }}
              />
              Add another person (second contact on this client)
            </label>
            {hasSecondPerson ? (
              <>
                <label>
                  <span className="pims-add-client-modal__label">Second first name</span>
                  <input
                    className="input"
                    value={secondFirstName}
                    onChange={(e) => setSecondFirstName(e.target.value)}
                  />
                </label>
                <label>
                  <span className="pims-add-client-modal__label">Second last name</span>
                  <input
                    className="input"
                    value={secondLastName}
                    onChange={(e) => setSecondLastName(e.target.value)}
                  />
                </label>
                <label>
                  <span className="pims-add-client-modal__label">Second email</span>
                  <input
                    className="input"
                    type="email"
                    value={secondEmail}
                    onChange={(e) => setSecondEmail(e.target.value)}
                  />
                </label>
                <label>
                  <span className="pims-add-client-modal__label">Their phone</span>
                  <input className="input" type="tel" value={phone2} onChange={(e) => setPhone2(e.target.value)} />
                </label>
                <label>
                  <span className="pims-add-client-modal__label">Their phone type</span>
                  <select className="input" value={phone2Type} onChange={(e) => setPhone2Type(e.target.value)}>
                    {PHONE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pims-add-client-modal__check">
                  <input
                    type="checkbox"
                    checked={phone2SmsEnabled}
                    onChange={(e) => setPhone2SmsEnabled(e.target.checked)}
                  />
                  Their phone is SMS-enabled
                </label>
              </>
            ) : (
              <>
                <label>
                  <span className="pims-add-client-modal__label">Alternate phone</span>
                  <input className="input" type="tel" value={phone2} onChange={(e) => setPhone2(e.target.value)} />
                </label>
                <label>
                  <span className="pims-add-client-modal__label">Alternate type</span>
                  <select className="input" value={phone2Type} onChange={(e) => setPhone2Type(e.target.value)}>
                    {PHONE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pims-add-client-modal__check">
                  <input
                    type="checkbox"
                    checked={phone2SmsEnabled}
                    onChange={(e) => setPhone2SmsEnabled(e.target.checked)}
                  />
                  Alternate is SMS-enabled
                </label>
              </>
            )}
            <div className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Location — where we show up *</span>
              <AddressAutocomplete
                id="pims-add-client-address"
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
            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Apartment, suite, unit</span>
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
            <label className="pims-add-client-modal__full pims-add-client-modal__check">
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
              />
              Mailing address is the same as the location
            </label>
            {!mailingSame ? (
              <div className="pims-add-client-modal__full">
                <label className="pims-add-client-modal__check">
                  <input
                    type="checkbox"
                    checked={mailingManual}
                    onChange={(e) => setMailingManual(e.target.checked)}
                  />
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
                    id="pims-add-client-mailing"
                    value={mailing}
                    onChange={(next) => setMailing({ ...next, country: 'US' })}
                    placeholder="Start typing the mailing address"
                    compact
                    inputClassName="input"
                  />
                )}
              </div>
            ) : null}
            <label className="pims-add-client-modal__full pims-add-client-modal__check">
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
              />
              Add a second visit address (work, mom’s house, etc.)
            </label>
            {hasExtra ? (
              <>
                <label>
                  <span className="pims-add-client-modal__label">Label</span>
                  <input
                    className="input"
                    value={extraLabel}
                    onChange={(e) => setExtraLabel(e.target.value)}
                    placeholder="Mom’s house"
                  />
                </label>
                <div className="pims-add-client-modal__full">
                  <span className="pims-add-client-modal__label">Second visit address</span>
                  <AddressAutocomplete
                    id="pims-add-client-extra"
                    value={extra}
                    onChange={(next) => setExtra({ ...next, country: 'US' })}
                    placeholder="Start typing the other address"
                    compact
                    inputClassName="input"
                  />
                </div>
              </>
            ) : null}
            <label>
              <span className="pims-add-client-modal__label">Primary provider</span>
              <select
                className="input"
                value={primaryProviderId}
                onChange={(e) => setPrimaryProviderId(e.target.value)}
              >
                <option value="">Select…</option>
                {providers.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {providerLabel(p)}
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
                  </option>
                ))}
              </select>
            </label>
            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">How did they hear about us?</span>
              <select
                className="input"
                value={referralSource}
                onChange={(e) => {
                  setReferralSource(e.target.value);
                  if (e.target.value !== 'Referred by a friend or family') {
                    setReferralClient(null);
                    setReferralQuery('');
                  }
                  if (e.target.value !== 'Other') setReferralOther('');
                }}
              >
                <option value="">Select…</option>
                {REFERRAL_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            {referralSource === 'Other' ? (
              <label className="pims-add-client-modal__full">
                <span className="pims-add-client-modal__label">Please specify</span>
                <input
                  className="input"
                  value={referralOther}
                  onChange={(e) => setReferralOther(e.target.value)}
                />
              </label>
            ) : null}
            {friendFamilyReferral ? (
              <div className="pims-add-client-modal__full">
                <span className="pims-add-client-modal__label">Referring client *</span>
                {referralClient ? (
                  <div className="pims-add-patient__owner-selected">
                    <span>{existingClientLabel(referralClient)}</span>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setReferralClient(null);
                        setReferralQuery('');
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="input"
                      value={referralQuery}
                      onChange={(e) => setReferralQuery(e.target.value)}
                      placeholder="Search clients by name…"
                    />
                    {referralHits.length ? (
                      <ul className="pims-add-patient__owner-results">
                        {referralHits.map((row) => (
                          <li key={String(row.id)}>
                            <button
                              type="button"
                              className="pims-add-patient__owner-option"
                              onClick={() => {
                                setReferralClient(row);
                                setReferralHits([]);
                              }}
                            >
                              {existingClientLabel(row)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            <div className="pims-add-client-modal__full" style={{ display: 'grid', gap: 6 }}>
              <span className="pims-add-client-modal__label">Communication preferences</span>
              <label className="pims-add-client-modal__check">
                <input type="checkbox" checked={preferSms} onChange={(e) => setPreferSms(e.target.checked)} />
                Prefer SMS
              </label>
              <label className="pims-add-client-modal__check">
                <input type="checkbox" checked={preferPhone} onChange={(e) => setPreferPhone(e.target.checked)} />
                Prefer phone
              </label>
              <label className="pims-add-client-modal__check">
                <input
                  type="checkbox"
                  checked={preferEmail}
                  onChange={(e) => setPreferEmail(e.target.checked)}
                  disabled={noEmail}
                />
                Prefer email
              </label>
              <label className="pims-add-client-modal__check">
                <input type="checkbox" checked={doNotSms} onChange={(e) => setDoNotSms(e.target.checked)} />
                Do not SMS
              </label>
              <label className="pims-add-client-modal__check">
                <input type="checkbox" checked={doNotEmail} onChange={(e) => setDoNotEmail(e.target.checked)} />
                Do not email
              </label>
              <label className="pims-add-client-modal__check">
                <input
                  type="checkbox"
                  checked={doNotSendReminders}
                  onChange={(e) => setDoNotSendReminders(e.target.checked)}
                />
                Do not send reminders
              </label>
            </div>
            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Alerts</span>
              <input className="input" value={alerts} onChange={(e) => setAlerts(e.target.value)} />
            </label>
            <label className="pims-add-client-modal__full">
              <span className="pims-add-client-modal__label">Connection Notes (staff only)</span>
              <input
                className="input"
                value={connectionNotes}
                onChange={(e) => setConnectionNotes(e.target.value)}
                placeholder="Personal details — internal only"
              />
            </label>
          </div>
          <div className="pims-add-client-modal__actions">
            <button type="button" className="btn secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={submitting || (!!emailHit && !noEmail)}>
              {submitting ? 'Saving…' : 'Save client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
