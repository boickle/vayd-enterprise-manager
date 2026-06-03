import { useEffect, useMemo, useState } from 'react';
import { reverseGeocode } from '../api/geo';
import { AddressAutocomplete, type AddressFields } from './AddressAutocomplete';

type DepotLocationFieldProps = {
  lat?: number | null;
  lon?: number | null;
  onChange: (lat: number | undefined, lon: number | undefined) => void;
  id: string;
  placeholder?: string;
};

function emptyAddress(): AddressFields {
  return { line1: '', city: '', state: '', zip: '', country: 'US' };
}

function hasCoords(lat?: number | null, lon?: number | null): lat is number {
  return lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);
}

export function DepotLocationField({
  lat,
  lon,
  onChange,
  id,
  placeholder = 'Start typing an address',
}: DepotLocationFieldProps) {
  const [address, setAddress] = useState<AddressFields>(emptyAddress);
  const [hydrating, setHydrating] = useState(false);

  const coordKey = useMemo(() => {
    if (!hasCoords(lat, lon)) return '';
    return `${lat},${lon}`;
  }, [lat, lon]);

  useEffect(() => {
    if (!coordKey) {
      setAddress(emptyAddress());
      return;
    }

    if (
      address.lat === lat &&
      address.lon === lon &&
      address.line1?.trim()
    ) {
      return;
    }

    let cancelled = false;
    setHydrating(true);
    (async () => {
      try {
        const formatted = await reverseGeocode(lat!, lon!);
        if (cancelled) return;
        setAddress({
          line1: formatted,
          city: '',
          state: '',
          zip: '',
          country: 'US',
          lat: lat!,
          lon: lon!,
        });
      } catch {
        if (!cancelled) setAddress(emptyAddress());
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coordKey, lat, lon]);

  const handleAddressChange = (fields: AddressFields) => {
    setAddress(fields);
    if (
      fields.lat != null &&
      fields.lon != null &&
      Number.isFinite(fields.lat) &&
      Number.isFinite(fields.lon)
    ) {
      onChange(fields.lat, fields.lon);
    } else {
      onChange(undefined, undefined);
    }
  };

  return (
    <div className="settings-depot-location-field">
      {hydrating && (
        <div className="settings-muted" style={{ fontSize: 12, marginBottom: 4 }}>
          Loading address…
        </div>
      )}
      <AddressAutocomplete
        id={id}
        value={address}
        onChange={handleAddressChange}
        placeholder={placeholder}
        singleLine
        inputClassName="settings-input"
        showConfirmedMessage={false}
      />
    </div>
  );
}
