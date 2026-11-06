/**
 * Required-field rules for the public appointment request form.
 *
 * Staff need weight + previous-vet answers on euthanasia requests and online
 * autobooks (and in practice whenever those form sections are shown) so care
 * liaisons are not chasing blanks after submit.
 */

export function isEuthanasiaVisitValue(value?: string | null): boolean {
  const v = (value || '').trim().toLowerCase();
  if (!v) return false;
  return v === 'euthanasia' || v.includes('euthanasia') || v.includes('end-of-life');
}

export function petSpecificIsEuthanasia(petData?: {
  needsToday?: string;
  appointmentTypeName?: string;
} | null): boolean {
  if (!petData) return false;
  return (
    isEuthanasiaVisitValue(petData.appointmentTypeName) ||
    isEuthanasiaVisitValue(petData.needsToday)
  );
}

/** Chart pets only collect weight when the visit is euthanasia. */
export function chartPetRequiresWeight(petData?: {
  needsToday?: string;
  appointmentTypeName?: string;
} | null): boolean {
  return petSpecificIsEuthanasia(petData);
}

export type WeightAndPreviousVetErrors = Record<string, string>;

/**
 * Validate weight + previous-vet fields that staff called out as mandatory.
 * Keys match AppointmentRequestForm `data-form-field` / error map conventions.
 */
export function collectWeightAndPreviousVetErrors(input: {
  isLoggedIn: boolean;
  previousVeterinaryPractices?: string;
  hadVetCareElsewhere?: string;
  previousVeterinaryHospitals?: string;
  newClientPets?: Array<{ id: string; weight?: string }>;
  /** Selected existing-client new pets that are part of the visit. */
  existingClientNewPets?: Array<{ id: string; weight?: string }>;
  /** Chart pets currently selected for the visit. */
  selectedChartPetIds?: string[];
  petSpecificData?: Record<
    string,
    {
      needsToday?: string;
      appointmentTypeName?: string;
      weight?: string;
    }
  >;
}): WeightAndPreviousVetErrors {
  const errors: WeightAndPreviousVetErrors = {};

  if (!input.isLoggedIn) {
    if (!input.previousVeterinaryPractices?.trim()) {
      errors.previousVeterinaryPractices =
        'Please tell us which veterinary practice(s) you have used previously';
    }
    for (const pet of input.newClientPets || []) {
      if (!pet.weight?.trim()) {
        errors[`newClientPet.${pet.id}.weight`] = 'Weight is required';
      }
    }
    return errors;
  }

  if (!input.hadVetCareElsewhere || (input.hadVetCareElsewhere !== 'Yes' && input.hadVetCareElsewhere !== 'No')) {
    errors.hadVetCareElsewhere = 'Please select Yes or No';
  } else if (input.hadVetCareElsewhere === 'Yes' && !input.previousVeterinaryHospitals?.trim()) {
    errors.previousVeterinaryHospitals =
      'Please tell us which veterinary hospitals you went to';
  }

  for (const pet of input.existingClientNewPets || []) {
    if (!pet.weight?.trim()) {
      errors[`existingClientNewPet.${pet.id}.weight`] = 'Weight is required';
    }
  }

  for (const petId of input.selectedChartPetIds || []) {
    const petData = input.petSpecificData?.[petId];
    if (!chartPetRequiresWeight(petData)) continue;
    if (!petData?.weight?.trim()) {
      errors[`weight.${petId}`] = 'Weight is required';
    }
  }

  return errors;
}
