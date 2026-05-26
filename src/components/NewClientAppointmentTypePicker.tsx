import React from 'react';

export type AppointmentTypeCardOption = { id: number; name: string; prettyName: string };

type Props = {
  options: AppointmentTypeCardOption[];
  selectedId?: number;
  onSelect: (option: AppointmentTypeCardOption) => void;
  error?: string;
};

function isEuthanasiaType(option: AppointmentTypeCardOption): boolean {
  return (
    option.name === 'Euthanasia' ||
    option.name.toLowerCase().includes('euthanasia') ||
    option.prettyName.toLowerCase().includes('euthanasia')
  );
}

function matchesPatterns(option: AppointmentTypeCardOption, patterns: string[]): boolean {
  const nameLower = option.name.toLowerCase();
  const prettyLower = option.prettyName.toLowerCase();
  return patterns.some((p) => nameLower.includes(p) || prettyLower.includes(p));
}

/** Cypress / analytics slug when a known category applies. */
export function getAppointmentTypeVisitReasonSlug(
  option: AppointmentTypeCardOption,
): string | undefined {
  if (isEuthanasiaType(option)) return 'end-of-life';
  if (matchesPatterns(option, ['wellness', 'check-up', 'annual'])) return 'wellness';
  if (matchesPatterns(option, ['not feeling well', 'illness', 'medical', 'sick'])) return 'not-feeling-well';
  return undefined;
}

export function NewClientAppointmentTypePicker({ options, selectedId, onSelect, error }: Props) {
  if (!options.length) {
    return null;
  }

  return (
    <div data-appointment-type-picker>
      <div
        role="radiogroup"
        aria-label="How can we help today"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '8px',
        }}
      >
        {options.map((option) => {
          const active = selectedId === option.id;
          const slug = getAppointmentTypeVisitReasonSlug(option);
          return (
            <button
              key={option.id}
              type="button"
              data-appointment-type-id={option.id}
              {...(slug ? { 'data-visit-reason': slug } : {})}
              aria-pressed={active}
              aria-label={option.prettyName}
              onClick={() => onSelect(option)}
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
                  lineHeight: 1.3,
                  textAlign: 'center',
                }}
              >
                {option.prettyName}
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
