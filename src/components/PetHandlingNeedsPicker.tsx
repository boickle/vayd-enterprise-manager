import React from 'react';

export type HandlingNeedKey = 'calming' | 'muzzle' | 'extra' | 'none';

export type PetHandlingFields = {
  needsCalmingMedications?: '' | 'Yes' | 'No';
  needsMuzzleOrSpecialHandling?: '' | 'Yes' | 'No';
  needsExtraHandling?: '' | 'Yes' | 'No';
  /** True when the client explicitly chose "None" (distinct from unanswered or multi-select No values). */
  handlingNeedsExplicitNone?: boolean;
};

const HANDLING_OPTIONS: {
  key: HandlingNeedKey;
  label: string;
}[] = [
  { key: 'calming', label: 'Calming meds' },
  { key: 'muzzle', label: 'Muzzle' },
  { key: 'extra', label: 'Additional handling support' },
  { key: 'none', label: 'None' },
];

export function getHandlingNeedsFromPet(pet: PetHandlingFields): HandlingNeedKey[] {
  if (pet.handlingNeedsExplicitNone) {
    return ['none'];
  }
  const needs: HandlingNeedKey[] = [];
  if (pet.needsCalmingMedications === 'Yes') needs.push('calming');
  if (pet.needsMuzzleOrSpecialHandling === 'Yes') needs.push('muzzle');
  if (pet.needsExtraHandling === 'Yes') needs.push('extra');
  return needs;
}

export function petFieldsFromHandlingNeeds(needs: HandlingNeedKey[]): PetHandlingFields {
  if (needs.length === 0) {
    return {
      needsCalmingMedications: '',
      needsMuzzleOrSpecialHandling: '',
      needsExtraHandling: '',
      handlingNeedsExplicitNone: false,
    };
  }
  if (needs.includes('none')) {
    return {
      needsCalmingMedications: 'No',
      needsMuzzleOrSpecialHandling: 'No',
      needsExtraHandling: 'No',
      handlingNeedsExplicitNone: true,
    };
  }
  return {
    needsCalmingMedications: needs.includes('calming') ? 'Yes' : 'No',
    needsMuzzleOrSpecialHandling: needs.includes('muzzle') ? 'Yes' : 'No',
    needsExtraHandling: needs.includes('extra') ? 'Yes' : 'No',
    handlingNeedsExplicitNone: false,
  };
}

export function toggleHandlingNeed(current: HandlingNeedKey[], key: HandlingNeedKey): HandlingNeedKey[] {
  if (key === 'none') {
    if (current.includes('none')) return [];
    return ['none'];
  }
  if (current.includes('none')) {
    return [key];
  }
  if (current.includes(key)) {
    return current.filter((n) => n !== key);
  }
  return [...current, key];
}

export function hasHandlingNeedsAnswer(pet: PetHandlingFields): boolean {
  if (pet.handlingNeedsExplicitNone) return true;
  return (
    pet.needsCalmingMedications !== '' &&
    pet.needsCalmingMedications !== undefined &&
    pet.needsMuzzleOrSpecialHandling !== '' &&
    pet.needsMuzzleOrSpecialHandling !== undefined &&
    pet.needsExtraHandling !== '' &&
    pet.needsExtraHandling !== undefined
  );
}

/** True when calming meds, muzzle, or additional handling support is selected. */
export function hasSpecialHandlingNeeds(pet: PetHandlingFields): boolean {
  return (
    pet.needsCalmingMedications === 'Yes' ||
    pet.needsMuzzleOrSpecialHandling === 'Yes' ||
    pet.needsExtraHandling === 'Yes'
  );
}

/**
 * Online self-scheduling is only offered when every pet with a handling question
 * explicitly chose "None" (not unanswered, not calming/muzzle/extra).
 */
export function petsAllowOnlineScheduling(pets: PetHandlingFields[]): boolean {
  if (pets.length === 0) return true;
  return pets.every((p) => p.handlingNeedsExplicitNone === true);
}

function HandlingNeedCard({
  label,
  active,
  onClick,
  optionKey,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  optionKey: HandlingNeedKey;
}) {
  return (
    <button
      type="button"
      data-handling-need={optionKey}
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        minHeight: '44px',
        padding: '10px 12px',
        margin: 0,
        border: `2px solid ${active ? '#10b981' : '#e5e7eb'}`,
        borderRadius: '8px',
        backgroundColor: active ? '#f0fdf4' : '#fff',
        color: active ? '#047857' : '#374151',
        fontSize: '14px',
        fontWeight: active ? 600 : 500,
        lineHeight: 1.3,
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
        boxSizing: 'border-box',
      }}
    >
      {label}
    </button>
  );
}

type Props = {
  pet: PetHandlingFields;
  petName?: string;
  onChange: (fields: PetHandlingFields) => void;
  error?: string;
  sectionGap?: number;
  labelMb?: number;
};

export function PetHandlingNeedsPicker({
  pet,
  petName = 'your pet',
  onChange,
  error,
  sectionGap = 10,
  labelMb = 6,
}: Props) {
  const selected = getHandlingNeedsFromPet(pet);

  const handleToggle = (key: HandlingNeedKey) => {
    const next = toggleHandlingNeed(selected, key);
    onChange(petFieldsFromHandlingNeeds(next));
  };

  return (
    <div
      data-handling-needs-picker
      style={{
        marginTop: 24,
        paddingTop: 20,
        borderTop: '1px solid #d1d5db',
      }}
    >
      <p style={{ fontSize: '15px', fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
        Anything we should know to help make the visit as smooth and stress-free as possible for{' '}
        {petName}?
      </p>
      <p style={{ fontSize: '12px', color: '#9ca3af', margin: `0 0 ${sectionGap}px`, lineHeight: 1.45 }}>
        No judgment. We ask every family so we can create the best experience possible.
      </p>

      <p
        style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#111827',
          margin: `0 0 ${labelMb}px`,
        }}
      >
        Has {petName} ever needed: (can choose multiple){' '}
        <span style={{ color: '#ef4444' }}>*</span>
      </p>

      <div
        role="group"
        aria-label="Handling needs, choose one or more"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: sectionGap,
          columnGap: sectionGap + 8,
        }}
      >
        {HANDLING_OPTIONS.map((option) => (
          <HandlingNeedCard
            key={option.key}
            optionKey={option.key}
            label={option.label}
            active={selected.includes(option.key)}
            onClick={() => handleToggle(option.key)}
          />
        ))}
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>{error}</div>
      )}
    </div>
  );
}
