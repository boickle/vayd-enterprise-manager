/**
 * Merge fields staff can insert into form templates (mirrors API form-merge-fields.ts).
 * Only tokens Scout can resolve are listed.
 */
export type FormMergeFieldDef = {
  token: string;
  label: string;
  group: 'Practice' | 'Client' | 'Patient' | 'Date';
};

export const FORM_MERGE_FIELDS: FormMergeFieldDef[] = [
  { token: 'practicename', label: 'Practice Name', group: 'Practice' },
  { token: 'practiceaddress', label: 'Practice Address', group: 'Practice' },
  { token: 'practicestreet1', label: 'Practice Street1', group: 'Practice' },
  { token: 'practicestreet2', label: 'Practice Street2', group: 'Practice' },
  { token: 'practicecity', label: 'Practice City', group: 'Practice' },
  { token: 'practicestate', label: 'Practice State', group: 'Practice' },
  { token: 'practicepostalcode', label: 'Practice Postal Code', group: 'Practice' },
  { token: 'practicephone', label: 'Practice Phone', group: 'Practice' },
  { token: 'practiceemail', label: 'Practice Email', group: 'Practice' },
  { token: 'practicelogo', label: 'Practice Logo', group: 'Practice' },

  { token: 'clientid', label: 'Client ID', group: 'Client' },
  { token: 'clientfirstname', label: 'Client First Name', group: 'Client' },
  { token: 'clientlastname', label: 'Client Last Name', group: 'Client' },
  { token: 'clientname', label: 'Client Name', group: 'Client' },
  { token: 'clientemail', label: 'Client Email', group: 'Client' },
  { token: 'clientphone', label: 'Client Phone', group: 'Client' },
  { token: 'clientaddress', label: 'Client Address', group: 'Client' },

  { token: 'patientid', label: 'Patient ID', group: 'Patient' },
  { token: 'patientname', label: 'Patient Name', group: 'Patient' },
  { token: 'patientbreed', label: 'Patient Breed', group: 'Patient' },
  { token: 'patientspecies', label: 'Patient Species', group: 'Patient' },
  { token: 'patientage', label: 'Patient Age', group: 'Patient' },
  { token: 'patientdob', label: 'Patient DOB', group: 'Patient' },
  { token: 'patientsex', label: 'Patient Sex', group: 'Patient' },
  { token: 'patientsexabbreviated', label: 'Patient Sex Abbreviated', group: 'Patient' },
  { token: 'patientsexhisher', label: 'Patient Sex (His/Her)', group: 'Patient' },
  { token: 'patientsexhisherlower', label: 'Patient Sex (his/her)', group: 'Patient' },
  { token: 'patientsexheshe', label: 'Patient Sex (He/She)', group: 'Patient' },
  { token: 'patientsexheshelower', label: 'Patient Sex (he/she)', group: 'Patient' },
  { token: 'patientsexhimher', label: 'Patient Sex (Him/Her)', group: 'Patient' },
  { token: 'patientsexhimherlower', label: 'Patient Sex (him/her)', group: 'Patient' },
  { token: 'patientweight', label: 'Patient Weight', group: 'Patient' },
  { token: 'patientcolor', label: 'Patient Color', group: 'Patient' },
  { token: 'patientmicrochip', label: 'Patient Microchip', group: 'Patient' },

  { token: 'currentdate', label: 'Current Date', group: 'Date' },
  { token: 'mmmm_dd_yyyy', label: 'Current Date (Month dd, yyyy)', group: 'Date' },
  { token: 'currenttime', label: 'Current Time', group: 'Date' },
];

export function mergeToken(token: string): string {
  return `%${token}%`;
}
