import React from 'react';
import {
  NewClientAppointmentTypePicker,
  type AppointmentTypeCardOption,
} from './NewClientAppointmentTypePicker';
import {
  appointmentTypeMatchesPatterns,
  isEuthanasiaTypeOption,
} from '../utils/petVisitQuestionUtils';

const EUTHANASIA_SHARE_PROMPT = (petLabel = 'your pet') =>
  `Share anything you'd like us to know about ${petLabel} or what led you here today`;

const EUTHANASIA_OTHER_OPTIONS_SUPPORT_TEXT =
  'No pressure at all. We simply want to make sure we support you and your pet in the best way possible.';

const EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS_LABEL =
  'Are you interested in pursuing other options other than euthanasia?';

const EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS = [
  'No. While this is very difficult, I\'ve made my decision and do not wish to explore additional options right now.',
  'Yes. I\'d like to discuss other options with the doctor.',
  "I'm not sure yet.",
] as const;

export type PetVisitPetData = {
  needsToday?: string;
  needsTodayDetails?: string;
  euthanasiaReason?: string;
  interestedInOtherOptions?: string;
  appointmentTypeId?: number;
  appointmentTypeName?: string;
};

type Props = {
  pet: { id: string; name?: string };
  petData: PetVisitPetData;
  appointmentOptions: AppointmentTypeCardOption[];
  loadingAppointmentTypes: boolean;
  selectedAppointmentType: AppointmentTypeCardOption | null;
  errors: Record<string, string>;
  onUpdatePetData: (petId: string, field: string, value: string) => void;
  onSelectAppointmentType: (option: AppointmentTypeCardOption) => void;
  inputPadding?: string;
  inputRadius?: string;
  labelMb?: number;
  sectionGap?: number;
};

export function PetVisitQuestionsBlock({
  pet,
  petData,
  appointmentOptions,
  loadingAppointmentTypes,
  selectedAppointmentType,
  errors,
  onUpdatePetData,
  onSelectAppointmentType,
  inputPadding = '8px 10px',
  inputRadius = '6px',
  labelMb = 4,
  sectionGap = 10,
}: Props) {
  const petDisplayName = pet.name?.trim() || 'your pet';
  const isEndOfLife = selectedAppointmentType ? isEuthanasiaTypeOption(selectedAppointmentType) : false;

  return (
    <div
      data-form-field={`needsToday.${pet.id}`}
      style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f3f4f6' }}
    >
      <label style={{ display: 'block', marginBottom: labelMb, fontWeight: 600, color: '#374151', fontSize: '13px' }}>
        How can we help {petDisplayName} today? <span style={{ color: '#ef4444' }}>*</span>
      </label>
      {loadingAppointmentTypes && appointmentOptions.length === 0 ? (
        <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>Loading visit options…</p>
      ) : appointmentOptions.length === 0 ? (
        <p style={{ fontSize: '13px', color: '#ef4444', margin: 0 }}>No appointment types available. Please refresh the page.</p>
      ) : (
        <NewClientAppointmentTypePicker
          options={appointmentOptions}
          selectedId={selectedAppointmentType?.id}
          onSelect={onSelectAppointmentType}
          error={errors[`needsToday.${pet.id}`]}
        />
      )}

      {selectedAppointmentType && (
        <div style={{ marginTop: sectionGap }}>
          {isEndOfLife ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: sectionGap }}>
              <div data-form-field={`euthanasiaReason.${pet.id}`}>
                <label style={{ display: 'block', marginBottom: labelMb, fontWeight: 600, color: '#374151', fontSize: '13px' }}>
                  Tell us more <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <p style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 8px', lineHeight: 1.4 }}>
                  {EUTHANASIA_SHARE_PROMPT(petDisplayName)}
                </p>
                <textarea
                  value={petData.euthanasiaReason || ''}
                  onChange={(e) => onUpdatePetData(pet.id, 'euthanasiaReason', e.target.value)}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: inputPadding,
                    border: `1px solid ${errors[`euthanasiaReason.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: inputRadius,
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
                {errors[`euthanasiaReason.${pet.id}`] && (
                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                    {errors[`euthanasiaReason.${pet.id}`]}
                  </div>
                )}
              </div>
              <div data-form-field={`interestedInOtherOptions.${pet.id}`}>
                <label style={{ display: 'block', marginBottom: labelMb, fontWeight: 600, color: '#374151', fontSize: '13px' }}>
                  {EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS_LABEL}{' '}
                  <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <p style={{ fontSize: '12px', color: '#9ca3af', margin: '0 0 8px', lineHeight: 1.4 }}>
                  {EUTHANASIA_OTHER_OPTIONS_SUPPORT_TEXT}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {EUTHANASIA_INTERESTED_IN_OTHER_OPTIONS.map((opt) => (
                    <label
                      key={opt}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        cursor: 'pointer',
                        padding: '10px 12px',
                        border: `2px solid ${petData.interestedInOtherOptions === opt ? '#10b981' : '#e5e7eb'}`,
                        borderRadius: '8px',
                        backgroundColor: petData.interestedInOtherOptions === opt ? '#f0fdf4' : '#fff',
                      }}
                    >
                      <input
                        type="radio"
                        name={`interestedInOtherOptions-${pet.id}`}
                        value={opt}
                        checked={petData.interestedInOtherOptions === opt}
                        onChange={(e) => onUpdatePetData(pet.id, 'interestedInOtherOptions', e.target.value)}
                        style={{ marginTop: '3px', flexShrink: 0, width: '18px', height: '18px', accentColor: '#10b981' }}
                      />
                      <span style={{ fontSize: '13px', lineHeight: 1.45, color: '#374151' }}>{opt}</span>
                    </label>
                  ))}
                </div>
                {errors[`interestedInOtherOptions.${pet.id}`] && (
                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>
                    {errors[`interestedInOtherOptions.${pet.id}`]}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <label style={{ display: 'block', marginBottom: labelMb, fontWeight: 600, color: '#374151', fontSize: '13px' }}>
                Tell us more
              </label>
              <textarea
                value={petData.needsTodayDetails || ''}
                onChange={(e) => onUpdatePetData(pet.id, 'needsTodayDetails', e.target.value)}
                placeholder={
                  selectedAppointmentType &&
                  appointmentTypeMatchesPatterns(selectedAppointmentType, ['wellness', 'check-up', 'annual'])
                    ? 'Do you have any specific concerns you want to discuss at the visit?'
                    : selectedAppointmentType &&
                        appointmentTypeMatchesPatterns(selectedAppointmentType, [
                          'not feeling well',
                          'illness',
                          'medical',
                          'sick',
                        ])
                      ? `Describe what is going on with ${petDisplayName}`
                      : selectedAppointmentType &&
                          appointmentTypeMatchesPatterns(selectedAppointmentType, [
                            'technician',
                            'tech visit',
                            'nail',
                            'anal gland',
                            'booster',
                            'blood draw',
                          ])
                        ? `What would you like done for ${petDisplayName}?`
                        : selectedAppointmentType &&
                            appointmentTypeMatchesPatterns(selectedAppointmentType, [
                              'recheck',
                              'follow-up',
                              'Follow Up',
                            ])
                          ? `What are we checking on for ${petDisplayName}?`
                          : 'Tell us any concerns, symptoms, timing, or goals for the visit.'
                }
                rows={3}
                style={{
                  width: '100%',
                  padding: inputPadding,
                  border: `1px solid ${errors[`needsTodayDetails.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: inputRadius,
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              {errors[`needsTodayDetails.${pet.id}`] && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                  {errors[`needsTodayDetails.${pet.id}`]}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
