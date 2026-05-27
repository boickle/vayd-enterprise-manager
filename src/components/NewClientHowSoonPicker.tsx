import React from 'react';

/** Canonical how-soon values shown on cards and stored in the appointment request payload. */
export const HOW_SOON_CHOICES = [
  'Emergent – today',
  'Urgent – within 24–48 hours',
  'Soon – sometime this week',
  'Flexible',
  "I'm not sure",
] as const;

export type HowSoonChoiceValue = (typeof HOW_SOON_CHOICES)[number];

/** @deprecated Use HOW_SOON_CHOICES */
export const HOW_SOON_CARDS = HOW_SOON_CHOICES.map((value) => ({ value, label: value }));

/** @deprecated Use HowSoonChoiceValue */
export type NewClientHowSoonValue = HowSoonChoiceValue;

/** @deprecated Use HOW_SOON_CHOICES */
export const NEW_CLIENT_HOW_SOON_CARDS = HOW_SOON_CARDS;

export const HOW_SOON_OPTION_VALUES: HowSoonChoiceValue[] = [...HOW_SOON_CHOICES];

type Props = {
  value: HowSoonChoiceValue | '';
  onChange: (value: HowSoonChoiceValue) => void;
  error?: string;
};

export function NewClientHowSoonPicker({ value, onChange, error }: Props) {
  return (
    <div data-form-field="howSoon">
      <div
        role="radiogroup"
        aria-label="How soon do you need to be seen"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        {HOW_SOON_CHOICES.map((option) => {
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              data-how-soon={option}
              aria-pressed={active}
              onClick={() => onChange(option)}
              style={{
                flex: '0 0 calc((100% - 8px) / 2)',
                width: 'calc((100% - 8px) / 2)',
                maxWidth: 'calc((100% - 8px) / 2)',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 12px',
                margin: 0,
                border: `2px solid ${active ? '#10b981' : '#e5e7eb'}`,
                borderRadius: '8px',
                backgroundColor: active ? '#f0fdf4' : '#fff',
                color: active ? '#047857' : '#374151',
                fontSize: '14px',
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
                boxSizing: 'border-box',
              }}
            >
              <span
                style={{
                  textAlign: 'center',
                  lineHeight: 1.3,
                }}
              >
                {option}
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
