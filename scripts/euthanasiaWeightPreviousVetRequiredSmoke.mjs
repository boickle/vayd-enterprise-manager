/**
 * Smoke: weight + previous-vet must be required on the public appointment
 * request form (euthanasia requests / online autobooks — and whenever those
 * sections are shown).
 *
 * Slack #bugs-scout 1793977221.633279
 *
 * Run: node scripts/euthanasiaWeightPreviousVetRequiredSmoke.mjs
 *
 * Mirrors: src/utils/appointmentRequestRequiredFields.ts
 */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isEuthanasiaVisitValue(value) {
  const v = (value || '').trim().toLowerCase();
  if (!v) return false;
  return v === 'euthanasia' || v.includes('euthanasia') || v.includes('end-of-life');
}

function petSpecificIsEuthanasia(petData) {
  if (!petData) return false;
  return (
    isEuthanasiaVisitValue(petData.appointmentTypeName) ||
    isEuthanasiaVisitValue(petData.needsToday)
  );
}

function chartPetRequiresWeight(petData) {
  return petSpecificIsEuthanasia(petData);
}

function collectWeightAndPreviousVetErrors(input) {
  const errors = {};

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

  if (
    !input.hadVetCareElsewhere ||
    (input.hadVetCareElsewhere !== 'Yes' && input.hadVetCareElsewhere !== 'No')
  ) {
    errors.hadVetCareElsewhere = 'Please select Yes or No';
  } else if (
    input.hadVetCareElsewhere === 'Yes' &&
    !input.previousVeterinaryHospitals?.trim()
  ) {
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

// --- New client: blank previous vet + weight block submit ---
{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: false,
    previousVeterinaryPractices: '',
    newClientPets: [{ id: 'p1', weight: '' }],
  });
  assert(errors.previousVeterinaryPractices, 'new client previous vet required');
  assert(errors['newClientPet.p1.weight'], 'new client pet weight required');
}

{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: false,
    previousVeterinaryPractices: 'Main Street Vet',
    newClientPets: [{ id: 'p1', weight: '22 lbs' }],
  });
  assert(Object.keys(errors).length === 0, 'new client filled fields pass');
}

// --- Existing client: previous-vet Yes/No + hospitals ---
{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: true,
    hadVetCareElsewhere: '',
    selectedChartPetIds: [],
  });
  assert(errors.hadVetCareElsewhere, 'existing client must answer care elsewhere');
}

{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: true,
    hadVetCareElsewhere: 'Yes',
    previousVeterinaryHospitals: '',
    selectedChartPetIds: [],
  });
  assert(errors.previousVeterinaryHospitals, 'hospitals required when Yes');
}

{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: true,
    hadVetCareElsewhere: 'No',
    selectedChartPetIds: [],
  });
  assert(Object.keys(errors).length === 0, 'No care elsewhere needs no hospitals');
}

// --- Chart pet euthanasia requires weight; wellness does not ---
{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: true,
    hadVetCareElsewhere: 'No',
    selectedChartPetIds: ['chart-1'],
    petSpecificData: {
      'chart-1': { needsToday: 'Euthanasia', appointmentTypeName: 'Euthanasia' },
    },
  });
  assert(errors['weight.chart-1'], 'chart euthanasia weight required');
}

{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: true,
    hadVetCareElsewhere: 'No',
    selectedChartPetIds: ['chart-1'],
    petSpecificData: {
      'chart-1': {
        needsToday: 'Euthanasia',
        appointmentTypeName: 'Euthanasia',
        weight: '40 lbs',
      },
    },
  });
  assert(Object.keys(errors).length === 0, 'chart euthanasia with weight passes');
}

{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: true,
    hadVetCareElsewhere: 'No',
    selectedChartPetIds: ['chart-1'],
    petSpecificData: {
      'chart-1': { needsToday: 'Standard Visit', appointmentTypeName: 'Standard' },
    },
  });
  assert(!errors['weight.chart-1'], 'chart wellness does not require weight field');
}

// --- Existing-client new pet weight ---
{
  const errors = collectWeightAndPreviousVetErrors({
    isLoggedIn: true,
    hadVetCareElsewhere: 'No',
    existingClientNewPets: [{ id: 'new-1', weight: '' }],
    selectedChartPetIds: [],
  });
  assert(errors['existingClientNewPet.new-1.weight'], 'existing new pet weight required');
}

console.log('euthanasiaWeightPreviousVetRequiredSmoke: ok');
