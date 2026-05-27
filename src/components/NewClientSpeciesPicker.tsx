import React from 'react';

export type NewClientSpeciesChoice = 'Dog' | 'Cat' | 'Other';

const SPECIES_OPTIONS: Array<{
  id: NewClientSpeciesChoice;
  label: string;
  imageSrc: string;
}> = [
  { id: 'Dog', label: 'Dog', imageSrc: '/images/species-dog.png' },
  { id: 'Cat', label: 'Cat', imageSrc: '/images/species-cat.png' },
  { id: 'Other', label: 'Other', imageSrc: '/images/species-other.png' },
];

type Props = {
  value: NewClientSpeciesChoice | '';
  onChange: (choice: NewClientSpeciesChoice) => void;
  error?: string;
};

export function NewClientSpeciesPicker({ value, onChange, error }: Props) {
  return (
    <div data-species-picker>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '8px',
          width: '100%',
        }}
      >
        {SPECIES_OPTIONS.map(({ id, label, imageSrc }) => {
          const active = value === id;
          return (
            <button
              key={id}
              type="button"
              data-species-choice={id}
              aria-pressed={active}
              aria-label={`${label} species`}
              onClick={() => onChange(id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '4px',
                width: '100%',
                minWidth: 0,
                minHeight: '88px',
                padding: '8px 4px 6px',
                boxSizing: 'border-box',
                border: `2px solid ${active ? '#10b981' : '#e5e7eb'}`,
                borderRadius: '10px',
                backgroundColor: active ? '#f0fdf4' : '#fff',
                cursor: 'pointer',
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '44px',
                  width: '100%',
                  background: 'transparent',
                  lineHeight: 0,
                }}
              >
                <img
                  src={imageSrc}
                  alt=""
                  aria-hidden
                  style={{
                    display: 'block',
                    height: '40px',
                    width: 'auto',
                    maxWidth: '100%',
                    objectFit: 'contain',
                    background: 'transparent',
                  }}
                />
              </span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: active ? 700 : 600,
                  color: active ? '#047857' : '#6b7280',
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
