import { useEffect, useMemo, useState } from 'react';
import { formatAddressFields, forwardGeocode } from '../../api/geo';
import type { PracticeBranch } from '../../api/branchInventory';
import { AddressAutocomplete, type AddressFields } from '../AddressAutocomplete';
import { EMPTY_ADDRESS_FIELDS } from '../../utils/verifiedAddress';

const CUSTOM = 'custom';

export function formatBranchAddressLabel(b: PracticeBranch): string {
  return formatAddressFields({
    line1: b.address1 ?? '',
    line2: b.address2 ?? undefined,
    city: b.city ?? '',
    state: b.state ?? '',
    zip: b.zipcode ?? '',
  }).trim();
}

function branchCoords(b: PracticeBranch): { lat?: number; lon?: number } {
  const lat = b.latitude != null ? Number(b.latitude) : NaN;
  const lon = b.longitude != null ? Number(b.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
  return { lat, lon };
}

function coordsMatch(
  a: { lat?: number; lon?: number },
  b: { lat?: number; lon?: number }
): boolean {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return false;
  return Math.abs(a.lat - b.lat) < 0.0004 && Math.abs(a.lon - b.lon) < 0.0004;
}

type Props = {
  id: string;
  branches: PracticeBranch[];
  defaultBranchId?: number | null;
  lat?: number;
  lon?: number;
  onChange: (lat?: number, lon?: number) => void;
};

export default function DepotBranchField({
  id,
  branches,
  defaultBranchId,
  lat,
  lon,
  onChange,
}: Props) {
  const current = useMemo(() => ({ lat, lon }), [lat, lon]);
  const matched = useMemo(
    () => branches.find((b) => coordsMatch(current, branchCoords(b))) ?? null,
    [branches, current]
  );
  const fallback =
    branches.find((b) => b.id === defaultBranchId) ??
    branches.find((b) => b.isDefault) ??
    branches[0] ??
    null;
  const hasCoords = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);
  const [mode, setMode] = useState<'branch' | 'custom'>(() =>
    hasCoords && !matched ? 'custom' : 'branch'
  );
  const [custom, setCustom] = useState<AddressFields>({ ...EMPTY_ADDRESS_FIELDS });
  const [resolving, setResolving] = useState(false);

  const selectedBranchId = matched?.id ?? (mode === 'custom' ? null : fallback?.id ?? null);

  useEffect(() => {
    if (hasCoords && matched) {
      setMode('branch');
      return;
    }
    if (hasCoords && !matched) {
      setMode('custom');
    }
  }, [hasCoords, matched]);

  async function applyBranch(branch: PracticeBranch) {
    const coords = branchCoords(branch);
    if (coords.lat != null && coords.lon != null) {
      onChange(coords.lat, coords.lon);
      return;
    }
    const label = formatBranchAddressLabel(branch);
    if (!label) {
      onChange(undefined, undefined);
      return;
    }
    setResolving(true);
    try {
      const geo = await forwardGeocode(label, { country: 'US' });
      if (Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
        onChange(geo.lat, geo.lon);
      } else {
        onChange(undefined, undefined);
      }
    } catch {
      onChange(undefined, undefined);
    } finally {
      setResolving(false);
    }
  }

  const onSelect = (raw: string) => {
    if (raw === CUSTOM) {
      setMode('custom');
      return;
    }
    const idNum = Number(raw);
    const branch = branches.find((b) => b.id === idNum);
    if (!branch) return;
    setMode('branch');
    void applyBranch(branch);
  };

  return (
    <div className="settings-depot-branch">
      <select
        id={id}
        className="settings-input"
        value={mode === 'custom' ? CUSTOM : selectedBranchId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        {selectedBranchId == null && mode !== 'custom' ? (
          <option value="">Select office…</option>
        ) : null}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        <option value={CUSTOM}>Other address…</option>
      </select>
      {mode === 'branch' && selectedBranchId != null ? (
        <p className="settings-depot-branch__hint">
          {formatBranchAddressLabel(
            branches.find((b) => b.id === selectedBranchId) ?? {
              id: 0,
              practiceId: 0,
              name: '',
              isDefault: false,
              isActive: true,
            }
          ) || (resolving ? 'Finding address…' : 'No address on this office yet')}
        </p>
      ) : null}
      {mode === 'custom' ? (
        <AddressAutocomplete
          id={`${id}-custom`}
          value={custom}
          onChange={(fields) => {
            setCustom(fields);
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
          }}
          placeholder="Type a custom depot address"
          inputClassName="settings-input"
          compact
          showConfirmedMessage={false}
        />
      ) : null}
    </div>
  );
}
