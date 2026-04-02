import { useEffect, useMemo, useState } from 'react';
import type { Pet } from '../api/clientPortal';
import MembershipSignup, { type MembershipSignupPaymentState } from '../pages/MembershipSignup';
import MembershipPayment from '../pages/MembershipPayment';

export type MembershipEnrollmentEligiblePet = {
  id: string;
  name: string;
  species?: string;
  isBackendPet: boolean;
};

type MembershipModalStep = 'choose-pet' | 'signup' | 'payment' | 'success';

export type MembershipEnrollmentModalProps = {
  open: boolean;
  onClose: () => void;
  /** Pets that can still be enrolled (caller refetches to update after enrollment). */
  eligiblePets: MembershipEnrollmentEligiblePet[];
  /** Build the pet object MembershipSignup expects (include dbId/patientId for backend pets). */
  getPetForSignup: (
    pet: MembershipEnrollmentEligiblePet
  ) => Pet | { id: string; name: string; species?: string; breed?: string; age?: string; dob?: string } | undefined;
  modalClientInfo: {
    email?: string;
    fullName?: { first?: string; last?: string; middle?: string; prefix?: string; suffix?: string };
  };
  /** After payment success + user finishes flow (Done). Use to refetch server data. */
  onEnrollmentFlowCompleted?: () => void | Promise<void>;
  /** After each successful payment or upgrade (and when choosing “sign up another pet”). Refetch so pricing/membership flags update under the modal. Pass enrolled pet id when known (room loader multi-pet credit). */
  onAfterPetEnrolled?: (enrolledPetId?: string) => void | Promise<void>;
  /** Label for the final dismiss button (default: appointment request copy). */
  doneButtonLabel?: string;
  /** Public room-loader: omit client-portal NOTE on embedded payment success screen. */
  fromRoomLoaderPublicForm?: boolean;
};

/**
 * Same membership enrollment flow as the appointment request form: choose pet → MembershipSignup → MembershipPayment → success.
 */
export default function MembershipEnrollmentModal({
  open,
  onClose,
  eligiblePets,
  getPetForSignup,
  modalClientInfo,
  onEnrollmentFlowCompleted,
  onAfterPetEnrolled,
  doneButtonLabel = 'Done – back to appointment request',
  fromRoomLoaderPublicForm = false,
}: MembershipEnrollmentModalProps) {
  const [membershipModalStep, setMembershipModalStep] = useState<MembershipModalStep>('choose-pet');
  const [membershipPaymentState, setMembershipPaymentState] = useState<MembershipSignupPaymentState | null>(null);
  const [lastSignedUpPetIds, setLastSignedUpPetIds] = useState<string[]>([]);
  const [selectedMembershipPet, setSelectedMembershipPet] = useState<MembershipEnrollmentEligiblePet | null>(null);
  const [selectedMembershipPetId, setSelectedMembershipPetId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMembershipModalStep('choose-pet');
    setMembershipPaymentState(null);
    setLastSignedUpPetIds([]);
    setSelectedMembershipPet(null);
    setSelectedMembershipPetId(null);
  }, [open]);

  const membershipEligiblePets = useMemo(() => {
    const exclude = new Set(lastSignedUpPetIds);
    return eligiblePets.filter((p) => !exclude.has(p.id));
  }, [eligiblePets, lastSignedUpPetIds]);

  const openMembershipSignupForPet = (pet: MembershipEnrollmentEligiblePet) => {
    setSelectedMembershipPet(pet);
    setMembershipModalStep('signup');
  };

  const getModalPetForSignup = ():
    | Pet
    | { id: string; name: string; species?: string; breed?: string; age?: string; dob?: string }
    | undefined => {
    if (!selectedMembershipPet) return undefined;
    return getPetForSignup(selectedMembershipPet);
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={() => {
        if (membershipModalStep === 'choose-pet') onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: membershipModalStep === 'choose-pet' || membershipModalStep === 'success' ? '32px' : '0',
          maxWidth: membershipModalStep === 'signup' || membershipModalStep === 'payment' ? 'min(1120px, 96vw)' : '480px',
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {membershipEligiblePets.length > 1 && membershipModalStep !== 'success' && (
          <div
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 8,
              color: '#166534',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Enroll more than one pet and receive a $75 credit for each additional pet. Credits may be used at any future Vet At Your Door visit.
          </div>
        )}
        {membershipModalStep === 'choose-pet' && (
          <>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>Explore membership</h2>
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '20px', lineHeight: 1.5 }}>
              Choose a pet to explore membership plans. You can explore memberships for additional pets after completing this one.
            </p>
            {membershipEligiblePets.length === 0 ? (
              <>
                <p style={{ fontSize: '15px', color: '#374151', marginBottom: '24px' }}>
                  All pets already have an active membership, or none are eligible. You can close this window and continue.
                </p>
                <button
                  type="button"
                  onClick={() => onClose()}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </>
            ) : membershipEligiblePets.length === 1 ? (
              <div style={{ marginBottom: '24px' }}>
                <p style={{ fontSize: '15px', color: '#374151', marginBottom: '12px' }}>
                  Explore membership recommendations for <strong>{membershipEligiblePets[0].name}</strong>.
                </p>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => openMembershipSignupForPet(membershipEligiblePets[0])}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Explore Membership Options
                  </button>
                  <button
                    type="button"
                    onClick={() => onClose()}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p style={{ fontSize: '15px', color: '#374151', marginBottom: '12px' }}>Which pet would you like to explore membership for?</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                  {membershipEligiblePets.map((p) => (
                    <label
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px',
                        cursor: 'pointer',
                        borderRadius: '8px',
                        border: `2px solid ${selectedMembershipPetId === p.id ? '#10b981' : '#e5e7eb'}`,
                        backgroundColor: selectedMembershipPetId === p.id ? '#f0fdf4' : '#fff',
                      }}
                    >
                      <input
                        type="radio"
                        name="membership-pet-enrollment"
                        checked={selectedMembershipPetId === p.id}
                        onChange={() => setSelectedMembershipPetId(p.id)}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <span style={{ fontWeight: 500, color: '#111827' }}>{p.name}</span>
                      {p.species && <span style={{ fontSize: '13px', color: '#6b7280' }}>({p.species})</span>}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={!selectedMembershipPetId}
                    onClick={() => {
                      const pet = membershipEligiblePets.find((p) => p.id === selectedMembershipPetId);
                      if (pet) openMembershipSignupForPet(pet);
                    }}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: selectedMembershipPetId ? '#10b981' : '#d1d5db',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: selectedMembershipPetId ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Explore Membership Options
                  </button>
                  <button
                    type="button"
                    onClick={() => onClose()}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {membershipModalStep === 'signup' && getModalPetForSignup() && (
          <div style={{ padding: '16px' }}>
            <MembershipSignup
              fromModal
              modalPet={getModalPetForSignup()}
              modalClientInfo={modalClientInfo}
              fromRoomLoaderPublicForm={fromRoomLoaderPublicForm}
              onProceedToPayment={(state) => {
                setMembershipPaymentState(state);
                setMembershipModalStep('payment');
              }}
              onCancel={() => {
                setMembershipModalStep('choose-pet');
                setSelectedMembershipPet(null);
              }}
            />
          </div>
        )}

        {membershipModalStep === 'payment' && membershipPaymentState && (
          <div style={{ padding: '16px' }}>
            <MembershipPayment
              fromModal
              initialState={membershipPaymentState as any}
              onEnrollmentSucceeded={() => {
                void onAfterPetEnrolled?.(membershipPaymentState.petId);
              }}
              onSuccess={() => {
                setLastSignedUpPetIds((prev) => [...prev, membershipPaymentState.petId]);
                setMembershipModalStep('success');
              }}
              onBack={() => setMembershipModalStep('signup')}
              onSignUpAnother={async (signedUpPetId) => {
                await onAfterPetEnrolled?.(signedUpPetId);
                setLastSignedUpPetIds((prev) => [...prev, signedUpPetId]);
                setMembershipPaymentState(null);
                setMembershipModalStep('choose-pet');
                setSelectedMembershipPet(null);
                setSelectedMembershipPetId(null);
              }}
            />
          </div>
        )}

        {membershipModalStep === 'success' && (
          <>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>Payment successful</h2>
            <p style={{ fontSize: '15px', color: '#374151', marginBottom: lastSignedUpPetIds.length >= 2 ? '12px' : '24px' }}>
              Membership signup is complete. You can sign up another pet or return to your form.
            </p>
            {lastSignedUpPetIds.length >= 2 && (
              <p
                style={{
                  fontSize: '15px',
                  padding: '12px 16px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  color: '#166534',
                  marginBottom: '24px',
                  lineHeight: 1.5,
                }}
              >
                You will be receiving a $75 credit in your VAYD account to be used at any visit of your choosing — this won&apos;t expire.
              </p>
            )}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {membershipEligiblePets.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMembershipModalStep('choose-pet');
                    setSelectedMembershipPet(null);
                    setSelectedMembershipPetId(null);
                  }}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Sign up another pet
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await onEnrollmentFlowCompleted?.();
                  setMembershipModalStep('choose-pet');
                  setMembershipPaymentState(null);
                  setSelectedMembershipPet(null);
                  setSelectedMembershipPetId(null);
                  onClose();
                }}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {doneButtonLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
