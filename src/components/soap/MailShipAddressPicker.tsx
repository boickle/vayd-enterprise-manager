import { useEffect, useState } from 'react';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { patchClientStaff } from '../../api/clientsMutations';
import { AddressAutocomplete, type AddressFields } from '../AddressAutocomplete';
import {
  clientHasExtraAddress,
  extraAddressLabel,
  extraAddressParts,
  fieldsFromParts,
  formatAddressLine,
  homeAddressParts,
  mailingAddressFields,
  mailingSameAsService,
} from '../../utils/clientVisitAddresses';
import { EMPTY_ADDRESS_FIELDS } from '../../utils/verifiedAddress';
import './MailShipAddressPicker.css';

type SourceKey = 'mailing' | 'home' | 'extra' | 'new';

type Option = {
  key: Exclude<SourceKey, 'new'>;
  label: string;
  line: string;
  fields: AddressFields;
};

export type MailShipChoice = {
  fields: AddressFields;
  /** Typed in by staff and should become the client's mailing address. */
  saveAsMailing: boolean;
};

export function shipAddressComplete(fields: AddressFields | null | undefined): boolean {
  return Boolean(
    fields?.line1?.trim() && fields.city?.trim() && fields.state?.trim() && fields.zip?.trim()
  );
}

export function shipBodyFromFields(fields: AddressFields, name?: string | null) {
  return {
    name: name || undefined,
    line1: fields.line1.trim(),
    line2: fields.line2?.trim() || undefined,
    city: fields.city.trim(),
    state: fields.state.trim(),
    postal: fields.zip.trim(),
  };
}

export async function saveMailingAddressOnFile(clientId: number, fields: AddressFields) {
  await patchClientStaff(clientId, {
    mailingSameAsService: false,
    mailingAddress1: fields.line1.trim() || null,
    mailingAddress2: fields.line2?.trim() || null,
    mailingCity: fields.city.trim() || null,
    mailingState: fields.state.trim() || null,
    mailingZipcode: fields.zip.trim() || null,
    mailingCountry: 'US',
  });
}

function sameAddress(a: AddressFields, b: AddressFields): boolean {
  const norm = (f: AddressFields) =>
    formatAddressLine({
      address1: f.line1,
      address2: f.line2,
      city: f.city,
      state: f.state,
      zip: f.zip,
    }).toLowerCase();
  return norm(a) === norm(b);
}

function shipOptions(client: Record<string, unknown>): Option[] {
  const options: Option[] = [];
  const home = fieldsFromParts(homeAddressParts(client));
  const mailingSame = mailingSameAsService(client);
  if (!mailingSame) {
    const mailing = mailingAddressFields(client);
    if (shipAddressComplete(mailing) || mailing.line1) {
      options.push({
        key: 'mailing',
        label: 'Mailing address',
        line: formatAddressLine({
          address1: mailing.line1,
          address2: mailing.line2,
          city: mailing.city,
          state: mailing.state,
          zip: mailing.zip,
        }),
        fields: mailing,
      });
    }
  }
  const homeLine = formatAddressLine(homeAddressParts(client));
  if (homeLine) {
    options.push({
      key: 'home',
      label: mailingSame ? 'Home · also their mailing address' : 'Home (where we show up)',
      line: homeLine,
      fields: home,
    });
  }
  if (clientHasExtraAddress(client)) {
    const extra = fieldsFromParts(extraAddressParts(client));
    if (!options.some((o) => sameAddress(o.fields, extra))) {
      options.push({
        key: 'extra',
        label: extraAddressLabel(client),
        line: formatAddressLine(extraAddressParts(client)),
        fields: extra,
      });
    }
  }
  return options;
}

type Props = {
  clientId: number | null | undefined;
  onChange: (choice: MailShipChoice | null) => void;
  /** Address already on the order; preselected when it matches one on file. */
  current?: AddressFields | null;
};

/**
 * Pick where a mail order ships: the client's mailing address first, then their other
 * addresses on file, or a new one typed in (optionally saved as their mailing address).
 */
export default function MailShipAddressPicker({ clientId, onChange, current }: Props) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceKey>('new');
  const [typed, setTyped] = useState<AddressFields>(() =>
    current && shipAddressComplete(current) ? current : { ...EMPTY_ADDRESS_FIELDS }
  );
  const [saveAsMailing, setSaveAsMailing] = useState(true);
  const [manual, setManual] = useState(() => /\bp\.?\s*o\.?\s*box\b/i.test(current?.line1 ?? ''));

  const setTypedField = (key: 'line1' | 'line2' | 'city' | 'state' | 'zip', value: string) =>
    setTyped((prev) => ({ ...prev, [key]: value, lat: undefined, lon: undefined }));

  useEffect(() => {
    if (!clientId) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchClientByIdStaff(clientId)
      .then((raw) => {
        if (cancelled) return;
        const next = raw && typeof raw === 'object' ? shipOptions(raw as Record<string, unknown>) : [];
        setOptions(next);
        const matched =
          current && shipAddressComplete(current)
            ? next.find((o) => sameAddress(o.fields, current))
            : null;
        if (matched) setSource(matched.key);
        else if (current && shipAddressComplete(current)) setSource('new');
        else setSource(next[0]?.key ?? 'new');
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the addresses on file. Type one below.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (loading) return;
    if (source === 'new') {
      onChange(shipAddressComplete(typed) ? { fields: typed, saveAsMailing: Boolean(clientId) && saveAsMailing } : null);
      return;
    }
    const picked = options.find((o) => o.key === source);
    onChange(picked && shipAddressComplete(picked.fields) ? { fields: picked.fields, saveAsMailing: false } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, source, typed, saveAsMailing, options, clientId]);

  if (loading) {
    return <p className="mail-ship-picker__hint">Loading addresses on file…</p>;
  }

  const picked = options.find((o) => o.key === source);
  const pickedIncomplete = picked && !shipAddressComplete(picked.fields);

  return (
    <fieldset className="mail-ship-picker">
      <legend>Ship to</legend>
      {loadError ? <p className="mail-ship-picker__error">{loadError}</p> : null}
      {!options.length && !loadError ? (
        <p className="mail-ship-picker__hint">No address on file for this client. Type one below.</p>
      ) : null}
      {options.map((option) => (
        <label
          key={option.key}
          className={`mail-ship-picker__option${source === option.key ? ' is-on' : ''}`}
        >
          <input
            type="radio"
            name="mail-ship-source"
            checked={source === option.key}
            onChange={() => setSource(option.key)}
          />
          <span>
            {option.label}
            <span className="mail-ship-picker__line">{option.line}</span>
          </span>
        </label>
      ))}
      <label className={`mail-ship-picker__option${source === 'new' ? ' is-on' : ''}`}>
        <input
          type="radio"
          name="mail-ship-source"
          checked={source === 'new'}
          onChange={() => setSource('new')}
        />
        <span>{options.length ? 'A different address' : 'Address'}</span>
      </label>
      {source === 'new' ? (
        <div className="mail-ship-picker__new">
          {manual ? (
            <div className="mail-ship-picker__manual">
              <input
                className="mail-ship-picker__input"
                aria-label="Address line 1"
                placeholder="Street or PO Box"
                value={typed.line1}
                onChange={(e) => setTypedField('line1', e.target.value)}
                autoFocus
              />
              <input
                className="mail-ship-picker__input"
                aria-label="Address line 2"
                placeholder="Apt, suite (optional)"
                value={typed.line2 ?? ''}
                onChange={(e) => setTypedField('line2', e.target.value)}
              />
              <div className="mail-ship-picker__row">
                <input
                  className="mail-ship-picker__input mail-ship-picker__city"
                  aria-label="City"
                  placeholder="City"
                  value={typed.city}
                  onChange={(e) => setTypedField('city', e.target.value)}
                />
                <input
                  className="mail-ship-picker__input mail-ship-picker__state"
                  aria-label="State"
                  placeholder="ME"
                  maxLength={2}
                  value={typed.state}
                  onChange={(e) => setTypedField('state', e.target.value.toUpperCase())}
                />
                <input
                  className="mail-ship-picker__input mail-ship-picker__zip"
                  aria-label="ZIP"
                  placeholder="ZIP"
                  inputMode="numeric"
                  maxLength={10}
                  value={typed.zip}
                  onChange={(e) => setTypedField('zip', e.target.value)}
                />
              </div>
              <button type="button" className="mail-ship-picker__link" onClick={() => setManual(false)}>
                Search addresses instead
              </button>
            </div>
          ) : (
            <>
              <AddressAutocomplete
                value={typed}
                onChange={setTyped}
                placeholder="Start typing the shipping address"
                compact
                showConfirmedMessage={false}
              />
              {typed.line1 && !shipAddressComplete(typed) ? (
                <p className="mail-ship-picker__error">
                  Pick the address from the list so city, state, and ZIP fill in.
                </p>
              ) : null}
              <button type="button" className="mail-ship-picker__link" onClick={() => setManual(true)}>
                PO Box or not listed? Type it in
              </button>
            </>
          )}
          {clientId ? (
            <label className="mail-ship-picker__save">
              <input
                type="checkbox"
                checked={saveAsMailing}
                onChange={(e) => setSaveAsMailing(e.target.checked)}
              />
              Save as their mailing address
            </label>
          ) : null}
        </div>
      ) : null}
      {pickedIncomplete ? (
        <p className="mail-ship-picker__error">
          This address is missing a city, state, or ZIP. Choose another or type it in.
        </p>
      ) : null}
    </fieldset>
  );
}
