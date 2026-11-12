import React from 'react';
import { NewClientSpeciesPicker, type NewClientSpeciesChoice } from './NewClientSpeciesPicker';
import type { HouseholdPet } from '../utils/appointmentRequestHouseholdPets';

type Props = {
  /** 'new' = new client; 'existing' = logged-in client (asks about pets not yet on file). */
  clientType: 'new' | 'existing';
  answer: 'Yes' | 'No' | '';
  onAnswer: (answer: 'Yes' | 'No') => void;
  pets: HouseholdPet[];
  onAdd: () => void;
  onRemove: (petId: string) => void;
  onUpdate: (petId: string, patch: Partial<HouseholdPet>) => void;
  onSpeciesChoice: (petId: string, choice: NewClientSpeciesChoice) => void;
  /** Moves the pet out of the household list and into the visit. */
  onAddToVisit: (pet: HouseholdPet) => void;
  errors: Record<string, string>;
  marginTop?: number;
};

const errorText: React.CSSProperties = { color: '#ef4444', fontSize: '12px', marginTop: '4px' };
const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontWeight: 600,
  color: '#111827',
  fontSize: '14px',
};

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '8px 10px',
    border: `1px solid ${hasError ? '#ef4444' : '#d1d5db'}`,
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box',
  };
}

function choiceButton(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '10px 12px',
    border: `2px solid ${active ? '#10b981' : '#e5e7eb'}`,
    borderRadius: '8px',
    backgroundColor: active ? '#f0fdf4' : '#fff',
    color: '#111827',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  };
}

export function HouseholdPetsSection({
  clientType,
  answer,
  onAnswer,
  pets,
  onAdd,
  onRemove,
  onUpdate,
  onSpeciesChoice,
  onAddToVisit,
  errors,
  marginTop = 24,
}: Props) {
  const question =
    clientType === 'new'
      ? 'Do you have any other pets at home?'
      : 'Do you have any pets at home that we don’t have on file yet?';

  return (
    <div
      data-household-pets
      style={{ marginTop, paddingTop: 20, borderTop: '1px solid #d1d5db', marginBottom: 20 }}
    >
      <div data-form-field="hasOtherPetsAtHome">
        <label style={labelStyle}>
          {question} <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#4b5563' }}>
          They don’t need a visit. We’ll add them to your account so booking them later is quick and
          we can remind you when vaccines are due.
        </p>
        <div style={{ display: 'flex', gap: 8 }} role="radiogroup" aria-label={question}>
          {(['Yes', 'No'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={answer === option}
              data-other-pets-answer={option}
              onClick={() => onAnswer(option)}
              style={choiceButton(answer === option)}
            >
              {option}
            </button>
          ))}
        </div>
        {errors.hasOtherPetsAtHome && <div style={errorText}>{errors.hasOtherPetsAtHome}</div>}
      </div>

      {answer === 'Yes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {pets.map((pet, index) => {
            const nameKey = `householdPet.${pet.id}.name`;
            const speciesKey = `householdPet.${pet.id}.species`;
            return (
              <div
                key={pet.id}
                data-household-pet-id={pet.id}
                style={{
                  padding: 12,
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#111827' }}>
                    {pet.name.trim() || `Other pet ${index + 1}`}
                  </h4>
                  <button
                    type="button"
                    onClick={() => onRemove(pet.id)}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: '#fee2e2',
                      color: '#991b1b',
                      border: '1px solid #fecaca',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </div>

                <div style={{ marginBottom: 10 }} data-form-field={nameKey}>
                  <label htmlFor={`${pet.id}-name`} style={labelStyle}>
                    Pet name <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    id={`${pet.id}-name`}
                    type="text"
                    value={pet.name}
                    maxLength={100}
                    onChange={(e) => onUpdate(pet.id, { name: e.target.value })}
                    placeholder="Enter pet name"
                    style={inputStyle(!!errors[nameKey])}
                  />
                  {errors[nameKey] && <div style={errorText}>{errors[nameKey]}</div>}
                </div>

                <div style={{ marginBottom: 10 }} data-form-field={speciesKey}>
                  <div style={labelStyle}>
                    Species <span style={{ color: '#ef4444' }}>*</span>
                  </div>
                  <NewClientSpeciesPicker
                    value={pet.speciesChoice}
                    onChange={(choice) => onSpeciesChoice(pet.id, choice)}
                    error={errors[speciesKey]}
                  />
                  {pet.speciesChoice === 'Other' && (
                    <input
                      type="text"
                      value={pet.otherSpecies ?? ''}
                      maxLength={100}
                      onChange={(e) => onUpdate(pet.id, { otherSpecies: e.target.value })}
                      placeholder="What kind of animal? (optional)"
                      style={{ ...inputStyle(false), marginTop: 8 }}
                    />
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label htmlFor={`${pet.id}-age`} style={labelStyle}>
                    Approximate age{' '}
                    <span style={{ color: '#6b7280', fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    id={`${pet.id}-age`}
                    type="text"
                    value={pet.age ?? ''}
                    maxLength={100}
                    onChange={(e) => onUpdate(pet.id, { age: e.target.value })}
                    placeholder="e.g. 5 years"
                    style={inputStyle(false)}
                  />
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: '13px', color: '#065f46', flex: '1 1 200px' }}>
                    We’re already coming to your home. Adding {pet.name.trim() || 'this pet'} to
                    this visit saves you a separate house-call fee.
                  </span>
                  <button
                    type="button"
                    data-household-add-to-visit={pet.id}
                    onClick={() => onAddToVisit(pet)}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Add to this visit
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={onAdd}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: '#fff',
              color: '#10b981',
              border: '2px dashed #10b981',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add another pet at home
          </button>
        </div>
      )}
    </div>
  );
}
