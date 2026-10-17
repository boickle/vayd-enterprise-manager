import {
  createFormTemplate,
  listFormTemplates,
  type FormField,
  type FormTemplate,
} from '../api/forms';

function field(
  key: string,
  type: FormField['type'],
  label: string,
  extra?: Partial<FormField>,
): FormField {
  return {
    key,
    type,
    label,
    required: type !== 'heading' && type !== 'paragraph',
    ...extra,
  };
}

export const CONSENT_FOR_TREATMENT_FORM_NAME = 'Consent for Treatment';
export const MEDICAL_WAIVER_FORM_NAME = 'Medical Waiver';

const CONSENT_FOR_TREATMENT_FIELDS: FormField[] = [
  field(
    'consent-intro',
    'paragraph',
    'I am the owner or the authorized agent for the owner of the animal described above, and I have the authority to execute this consent. My signature below also certifies that I am over eighteen years of age.',
    { required: false },
  ),
  field(
    'consent-risks',
    'paragraph',
    'I have been informed that there are certain risks and complications associated with sedation, anesthesia, and/or any operation/procedure and that the risks/complications have been explained to me. Specifically, I understand that risks include cardiac and respiratory arrest resulting in the worst and very rare case, death. I further understand that performing procedures in the home carries extra risk relative to a brick and mortar facility, albeit small, as %practicename% does not have as robust an emergency capability relative to a brick and mortar practice, should an emergency arise. Examples of life-saving equipment we do not have include but are not limited to inhalant anesthesia, certain injectable medications, defibrillator, and certain life-saving treatments. By my signature below, I accept these risks and elect to pursue this procedure at home.',
    { required: false },
  ),
  field(
    'consent-unforeseen',
    'paragraph',
    'I further understand that during the course of the operations or procedures, unforeseen conditions may arise that may necessitate the performance of additional procedures deemed necessary by the veterinarian. I am encouraged to discuss any concerns I have about these risks with the attending veterinarian before the procedure is initiated.',
    { required: false },
  ),
  field(
    'consent-meds',
    'paragraph',
    'I authorize the use of appropriate anesthesia and pain relief medication as needed before, during, and after the procedure. I have been informed that there are risks associated with the use of any medication.',
    { required: false },
  ),
  field(
    'consent-no-guarantee',
    'paragraph',
    "The nature of these operations or procedures has been explained to me and I understand what will be done. I am aware that the practice of veterinary medicine is not an exact science and, thus, there are no guarantees for successful treatment. I have been encouraged and given the opportunity to discuss any questions I may have regarding my pet's medical care and my questions have been answered to my satisfaction. I accept that my financial obligations remain regardless of the outcome.",
    { required: false },
  ),
  field(
    'consent-accept',
    'paragraph',
    'I have read and understand this authorization and hereby accept and agree to the terms of the consent for treatment.',
    { required: false },
  ),
  field('consent-cpr-heading', 'heading', 'CPR', { required: false }),
  field(
    'consent-cpr-copy',
    'paragraph',
    'In the event that %patientname% should experience cardiac or respiratory arrest while the procedure or treatments are being performed, do you give consent for resuscitative efforts to be initiated until you can be contacted further and notified of %patientname%’s status? By consenting to this service, you are also acknowledging that certain fees will apply. If you are not able to be contacted immediately, resuscitation efforts will continue to be performed at the doctor’s discretion. Please check one choice below.',
    { required: false },
  ),
  field('consent-cpr-yes', 'checkbox', 'I agree to CPR being performed in case of arrest', {
    checkboxLabel: 'I agree to CPR being performed in case of arrest',
    required: false,
  }),
  field('consent-cpr-dnr', 'checkbox', 'I elect a “Do Not Resuscitate” status in case of arrest', {
    checkboxLabel: 'I elect a “Do Not Resuscitate” status in case of arrest',
    required: false,
  }),
  field('consent-signature', 'signature', 'Signature'),
];

const MEDICAL_WAIVER_FIELDS: FormField[] = [
  field(
    'med-waiver-authority',
    'paragraph',
    'I am the owner or the authorized agent for the owner of the animal described above, and I have the authority to execute this waiver of lab work that was advised by my veterinarian.',
    { required: false },
  ),
  field(
    'med-waiver-meds',
    'paragraph',
    'My animal is being given [MEDICATION] for [DISEASE]. I understand that not giving enough of this medication may lead to [SIDE EFFECTS]. I also understand that giving too much of this medication may lead to [SIDE EFFECTS]. There can also be spontaneous (idiosyncratic) reactions to this medication such as [REACTIONS].',
    { required: false },
  ),
  field(
    'med-waiver-waive',
    'paragraph',
    'I with full knowledge and understanding, waive the lab work recommended by my veterinarian at %practicename% to screen for possible abnormalities that may result from this medication.',
    { required: false },
  ),
  field('med-waiver-signature', 'signature', 'Signature'),
];

type SeedSpec = {
  name: string;
  description: string;
  allowEditBeforeSend: boolean;
  fields: FormField[];
};

const SEEDS: SeedSpec[] = [
  {
    name: CONSENT_FOR_TREATMENT_FORM_NAME,
    description: 'Client-signed consent for in-home procedures, including a CPR / DNR choice.',
    allowEditBeforeSend: false,
    fields: CONSENT_FOR_TREATMENT_FIELDS,
  },
  {
    name: MEDICAL_WAIVER_FORM_NAME,
    description:
      'Client-signed waiver of recommended lab work. Edit the medication, disease, and side-effect placeholders before sending — same as the heartworm waiver.',
    allowEditBeforeSend: true,
    fields: MEDICAL_WAIVER_FIELDS,
  },
];

/**
 * Create the practice's standard client-signed forms if they are not already on file.
 * Existing templates with the same name are left alone so staff edits are kept.
 */
export async function ensureDefaultFormTemplates(): Promise<FormTemplate[]> {
  const existing = await listFormTemplates();
  const names = new Set(existing.map((t) => t.name.trim().toLowerCase()));
  const created: FormTemplate[] = [];
  for (const seed of SEEDS) {
    if (names.has(seed.name.trim().toLowerCase())) continue;
    created.push(
      await createFormTemplate({
        name: seed.name,
        description: seed.description,
        fields: seed.fields,
        isPublished: true,
        allowEditBeforeSend: seed.allowEditBeforeSend,
      }),
    );
  }
  return created.length ? [...created, ...existing] : existing;
}
