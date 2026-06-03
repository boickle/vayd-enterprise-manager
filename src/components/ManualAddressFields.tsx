import React from 'react';
import type { AddressFields } from './AddressAutocomplete';

type ManualAddressFieldsProps = {
  value: AddressFields;
  onChange: (address: AddressFields) => void;
  errors?: Record<string, string>;
  errorPrefix: string;
  isMobile?: boolean;
  line1Placeholder?: string;
};

const inputStyle = (hasError: boolean): React.CSSProperties => ({
  padding: '12px',
  border: `1px solid ${hasError ? '#ef4444' : '#d1d5db'}`,
  borderRadius: '8px',
  fontSize: '14px',
  width: '100%',
});

export function ManualAddressFields({
  value,
  onChange,
  errors = {},
  errorPrefix,
  isMobile = false,
  line1Placeholder = 'PO Box 123 or street address',
}: ManualAddressFieldsProps) {
  const update = (field: keyof AddressFields, fieldValue: string) => {
    onChange({
      ...value,
      [field]: fieldValue,
      country: value.country || 'US',
      lat: undefined,
      lon: undefined,
    });
  };

  return (
    <div>
      <input
        type="text"
        value={value.line1 || ''}
        onChange={(e) => update('line1', e.target.value)}
        placeholder={line1Placeholder}
        style={{ ...inputStyle(Boolean(errors[`${errorPrefix}.line1`])), marginBottom: '12px' }}
      />
      {errors[`${errorPrefix}.line1`] && (
        <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '-8px', marginBottom: '12px' }}>
          {errors[`${errorPrefix}.line1`]}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr',
          gap: '12px',
        }}
      >
        <input
          type="text"
          value={value.city || ''}
          onChange={(e) => update('city', e.target.value)}
          placeholder="City"
          style={inputStyle(Boolean(errors[`${errorPrefix}.city`]))}
        />
        <input
          type="text"
          value={value.state || ''}
          onChange={(e) => update('state', e.target.value)}
          placeholder="State"
          style={inputStyle(Boolean(errors[`${errorPrefix}.state`]))}
        />
        <input
          type="text"
          value={value.zip || ''}
          onChange={(e) => update('zip', e.target.value)}
          placeholder="Zip"
          style={inputStyle(Boolean(errors[`${errorPrefix}.zip`]))}
        />
      </div>
      {(errors[`${errorPrefix}.city`] ||
        errors[`${errorPrefix}.state`] ||
        errors[`${errorPrefix}.zip`]) && (
        <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
          {errors[`${errorPrefix}.city`] ||
            errors[`${errorPrefix}.state`] ||
            errors[`${errorPrefix}.zip`]}
        </div>
      )}
    </div>
  );
}
