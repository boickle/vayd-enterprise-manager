/** Scroll to the first validation error on the appointment request form. */
export function scrollToFirstAppointmentFormError(errors: Record<string, string>): void {
  const keys = Object.keys(errors);
  if (keys.length === 0 || typeof document === 'undefined') return;

  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      for (const key of keys) {
        const target = findScrollTargetForErrorKey(key);
        if (!target) continue;

        target.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const focusable = target.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button[data-handling-need], button[data-pet-sex-option], button[data-how-soon], button[data-appointment-type-id], button[data-species-choice]',
        );
        if (focusable && typeof focusable.focus === 'function') {
          focusable.focus({ preventScroll: true });
        }
        return;
      }
    }, 150);
  });
}

function findScrollTargetForErrorKey(key: string): HTMLElement | null {
  const escaped = CSS.escape(key);

  const byField = document.querySelector<HTMLElement>(`[data-form-field="${escaped}"]`);
  if (byField) return byField;

  const byError = document.querySelector<HTMLElement>(`[data-form-error-for="${escaped}"]`);
  if (byError) return byError;

  const newClientPet = key.match(/^newClientPet\.([^\.]+)\.(\w+)$/);
  if (newClientPet) {
    return findPetFieldTarget(newClientPet[1], newClientPet[2]);
  }

  const existingNewPet = key.match(/^existingClientNewPet\.([^\.]+)\.(\w+)$/);
  if (existingNewPet) {
    return findPetFieldTarget(existingNewPet[1], existingNewPet[2]);
  }

  const needsToday = key.match(/^needsToday\.(.+)$/);
  if (needsToday) {
    return (
      document.querySelector<HTMLElement>(`[data-pet-id="${CSS.escape(needsToday[1])}"] [data-appointment-type-picker]`) ||
      document.querySelector<HTMLElement>(
        `[data-pet-id="${CSS.escape(needsToday[1])}"] [data-form-field="needsToday.${CSS.escape(needsToday[1])}"]`,
      )
    );
  }

  const euthanasiaReason = key.match(/^euthanasiaReason\.(.+)$/);
  if (euthanasiaReason) {
    return document.querySelector<HTMLElement>(
      `[data-pet-id="${CSS.escape(euthanasiaReason[1])}"] [data-form-field="euthanasiaReason.${CSS.escape(euthanasiaReason[1])}"]`,
    );
  }

  const interestedInOther = key.match(/^interestedInOtherOptions\.(.+)$/);
  if (interestedInOther) {
    return document.querySelector<HTMLElement>(
      `[data-pet-id="${CSS.escape(interestedInOther[1])}"] [data-form-field="interestedInOtherOptions.${CSS.escape(interestedInOther[1])}"]`,
    );
  }

  const simpleSelectors: Record<string, string> = {
    email: '[data-form-field="email"]',
    phoneNumbers: '[data-form-field="phoneNumbers"]',
    howSoon: '[data-form-field="howSoon"]',
    preferredDateTime: '[data-form-field="preferredDateTime"]',
    bestPhoneNumber: '[data-form-field="bestPhoneNumber"]',
    selectedPetIds: '[data-form-field="selectedPetIds"]',
    newClientPets: '[data-form-field="newClientPets"]',
    whatPets: '[data-form-field="whatPets"]',
    'fullName.first': '[data-form-field="fullName.first"]',
    'fullName.last': '[data-form-field="fullName.last"]',
    'physicalAddress.line1': '[data-form-field="physicalAddress.line1"]',
    'newPhysicalAddress.line1': '[data-form-field="newPhysicalAddress.line1"]',
    isThisTheAddressWhereWeWillCome: '[data-form-field="isThisTheAddressWhereWeWillCome"]',
    euthanasiaReason: '[data-form-field="euthanasiaReason"]',
    interestedInOtherOptions: '[data-form-field="interestedInOtherOptions"]',
    preferredDoctorExisting: '[data-form-field="preferredDoctorExisting"]',
    selectedDateTimeSlotsVisit: '[data-form-field="selectedDateTimeSlotsVisit"]',
    zoneNotServiced: '[data-form-field="zoneNotServiced"]',
  };

  const simple = simpleSelectors[key];
  if (simple) {
    return document.querySelector<HTMLElement>(simple);
  }

  return (
    document.querySelector<HTMLElement>(`input[name="${escaped}"], textarea[name="${escaped}"], select[name="${escaped}"]`) ||
    document.querySelector<HTMLElement>(`#${escaped}`)
  );
}

function findPetFieldTarget(petId: string, field: string): HTMLElement | null {
  const petCard = document.querySelector<HTMLElement>(`[data-pet-id="${CSS.escape(petId)}"]`);
  if (!petCard) return null;

  const fieldSelectors: Record<string, string> = {
    name: '[data-form-field$=".name"]',
    age: '[data-form-field$=".age"]',
    species: '[data-species-picker]',
    sex: '[data-pet-sex-picker]',
    handlingNeeds: '[data-handling-needs-picker]',
  };

  const selector = fieldSelectors[field];
  if (selector) {
    const match = petCard.querySelector<HTMLElement>(selector);
    if (match) return match;
  }

  return petCard.querySelector<HTMLElement>(`[data-form-field$=".${CSS.escape(field)}"]`) || petCard;
}
