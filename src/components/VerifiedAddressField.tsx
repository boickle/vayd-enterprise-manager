import { AddressAutocomplete, type AddressFields } from './AddressAutocomplete';
import { addressFieldsDisplayText, addressFieldsVerified } from '../utils/verifiedAddress';

type VerifiedAddressFieldProps = {
  value: AddressFields;
  onChange: (address: AddressFields) => void;
  error?: string | null;
  label: string;
  hint?: string;
  placeholder?: string;
  inputClassName?: string;
};

/** Address entry with Places autocomplete and routing-style verified checkmark. */
export function VerifiedAddressField({
  value,
  onChange,
  error,
  label,
  hint,
  placeholder = 'Start typing the visit address',
  inputClassName = 'scheduler-book-input',
}: VerifiedAddressFieldProps) {
  const verified = addressFieldsVerified(value);

  return (
    <label className="scheduler-book-field scheduler-book-field--full">
      <span className="scheduler-book-field-label">{label}</span>
      <div className="scheduler-verified-address-row">
        <div className="scheduler-verified-address-input">
          <AddressAutocomplete
            value={value}
            onChange={onChange}
            error={error ?? undefined}
            placeholder={placeholder}
            inputClassName={inputClassName}
            showConfirmedMessage={false}
            compact
          />
        </div>
        {verified ? (
          <span className="scheduler-verified-address-ok" title="Address verified" aria-hidden>
            ✓
          </span>
        ) : null}
      </div>
      {hint ? <p className="scheduler-book-hint muted">{hint}</p> : null}
      {!verified && addressFieldsDisplayText(value) ? (
        <p className="scheduler-book-hint muted" style={{ marginTop: 4 }}>
          Pick an address from the list, or save to verify the typed address.
        </p>
      ) : null}
    </label>
  );
}
