import React from 'react';

export const PET_SEX_OPTIONS = [
  'Female Intact',
  'Female Spayed',
  'Male Intact',
  'Male Neutered',
  'Unknown',
] as const;

export type PetSexOption = (typeof PET_SEX_OPTIONS)[number];

export function isPetSexOption(value: string): value is PetSexOption {
  return (PET_SEX_OPTIONS as readonly string[]).includes(value);
}

export function spayedNeuteredFromPetSex(sex: string | undefined): string {
  if (sex === 'Female Spayed' || sex === 'Male Neutered') return 'Yes';
  if (sex === 'Female Intact' || sex === 'Male Intact') return 'No';
  return '';
}

const SEX_STATUS_CHOICES: {
  value: PetSexOption;
  label: string;
  icon: string;
  iconColor?: string;
}[] = [
  { value: 'Female Intact', label: 'Intact Female', icon: '♀' },
  { value: 'Female Spayed', label: 'Spayed Female', icon: '♀' },
  { value: 'Male Intact', label: 'Intact Male', icon: '♂' },
  { value: 'Male Neutered', label: 'Neutered Male', icon: '♂' },
  { value: 'Unknown', label: 'Unknown / Not Sure', icon: '?' },
];

type Props = {
  value: string;
  onChange: (value: PetSexOption) => void;
  error?: string;
  labelMb?: number;
  fontSize?: string;
  sectionGap?: number;
};

function SexStatusButton({
  choice,
  selected,
  onSelect,
  subdued,
}: {
  choice: (typeof SEX_STATUS_CHOICES)[number];
  selected: boolean;
  onSelect: (value: PetSexOption) => void;
  subdued?: boolean;
}) {
  return (
    <button
      type="button"
      data-pet-sex-option={choice.value}
      aria-pressed={selected}
      aria-label={choice.label}
      onClick={() => onSelect(choice.value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: subdued ? '6px' : '8px',
        width: '100%',
        minHeight: subdued ? '38px' : '44px',
        padding: subdued ? '8px 14px' : '10px 12px',
        margin: 0,
        border: `2px solid ${selected ? '#10b981' : '#e5e7eb'}`,
        borderRadius: '8px',
        backgroundColor: selected ? '#f0fdf4' : '#fff',
        color: selected ? '#047857' : subdued ? '#6b7280' : '#374151',
        fontSize: subdued ? '13px' : '14px',
        fontWeight: selected ? 600 : subdued ? 500 : 500,
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
        boxSizing: 'border-box',
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: '16px',
          lineHeight: 1,
          color: choice.iconColor ?? '#111827',
          flexShrink: 0,
        }}
      >
        {choice.icon}
      </span>
      <span>{choice.label}</span>
    </button>
  );
}

export function PetSexSelect({
  value,
  onChange,
  error,
  labelMb = 4,
  fontSize = '13px',
  sectionGap = 8,
}: Props) {
  const [femaleIntact, femaleSpayed, maleIntact, maleNeutered, unknown] = SEX_STATUS_CHOICES;

  return (
    <div data-pet-sex-picker>
      <label
        style={{
          display: 'block',
          marginBottom: labelMb,
          fontWeight: 600,
          color: '#374151',
          fontSize,
        }}
      >
        Sex / Status <span style={{ color: '#ef4444' }}>*</span>
      </label>

      <div
        role="radiogroup"
        aria-label="Sex / Status"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: sectionGap,
        }}
      >
        <SexStatusButton choice={femaleIntact} selected={value === femaleIntact.value} onSelect={onChange} />
        <SexStatusButton choice={femaleSpayed} selected={value === femaleSpayed.value} onSelect={onChange} />
        <SexStatusButton choice={maleIntact} selected={value === maleIntact.value} onSelect={onChange} />
        <SexStatusButton choice={maleNeutered} selected={value === maleNeutered.value} onSelect={onChange} />
        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            justifyContent: 'center',
            marginTop: 2,
          }}
        >
          <div style={{ width: 'min(72%, 220px)' }}>
            <SexStatusButton
              choice={unknown}
              selected={value === unknown.value}
              onSelect={onChange}
              subdued
            />
          </div>
        </div>
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>{error}</div>
      )}
    </div>
  );
}
