// src/pages/roomLoader/roomLoaderFormKeys.ts
// Form-field keys for the configuration-driven sections of the client Room Loader.
// They are flat strings because the whole answer sheet is submitted as one map and is
// replayed into the PDF and the SOAP subjective.

/** Existing key, kept so submitted forms and the PDF keep reading the same field. */
export function outdoorAccessKey(petKey: string): string {
  return `${petKey}_outdoorAccess`;
}

/** `'accepted'`, `'declined'`, or a panel option id when the rule offers a choice. */
export function panelAnswerKey(petKey: string, ruleId: string): string {
  return `${petKey}_panel_${ruleId}`;
}

/** `'yes'` / `'no'` for a test offered after its panel was crossed out. */
export function panelSubAskKey(petKey: string, subAskId: string): string {
  return `${petKey}_subask_${subAskId}`;
}

/** `'yes'` / `'no'` for a universal or gated add-on. */
export function offerKey(petKey: string, offerId: string): string {
  return `${petKey}_offer_${offerId}`;
}

/** `'yes'` / `'no'` for the item pitched off an outdoor-access yes. */
export function outdoorPitchKey(petKey: string): string {
  return `${petKey}_outdoorPitch`;
}

/** `'bring'`, `'ship'` or `'no'` for one chronic medication. */
export function chronicMedKey(petKey: string, prescriptionId: number): string {
  return `${petKey}_chronicMed_${prescriptionId}`;
}

/** Free text for a medication we have no prescription on file for. */
export function chronicMedsOtherKey(petKey: string): string {
  return `${petKey}_chronicMedsOther`;
}

/** The chosen choice id for a question triggered by an estimate line. */
export function itemQuestionKey(petKey: string, questionId: string): string {
  return `${petKey}_ask_${questionId}`;
}

/** `'accepted'` / `'declined'` for a medical-concern panel. */
export function medicalConcernPanelKey(petKey: string, optionId: string): string {
  return `${petKey}_mcPanel_${optionId}`;
}

export const PANEL_DECLINED = 'declined';
export const PANEL_ACCEPTED = 'accepted';

/** True when the client crossed this panel rule out. */
export function panelIsDeclined(answer: unknown): boolean {
  return String(answer ?? '') === PANEL_DECLINED;
}

/** The option the client chose, or null when they declined or have not answered. */
export function chosenPanelOptionId(answer: unknown, singleOptionId: string): string | null {
  const value = String(answer ?? '');
  if (value === '' || value === PANEL_DECLINED) return null;
  if (value === PANEL_ACCEPTED) return singleOptionId;
  return value;
}
