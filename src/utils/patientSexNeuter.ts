// eVet stores spay/neuter inside `sex` ("MaleNeutered", "FemaleSpayed"). Scout edits sex and
// neuter status separately; the API fills `neuterStatus` from `sex` when it has none
// (vayd-api src/patients/sex-neuter.util.ts). These split the combined value for display.

const compact = (v: unknown): string => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');

const SEX_WORD: Record<string, string | null> = {
  male: 'Male',
  maleintact: 'Male',
  maleneutered: 'Male',
  neuteredmale: 'Male',
  malecastrated: 'Male',
  female: 'Female',
  femaleintact: 'Female',
  femalespayed: 'Female',
  spayedfemale: 'Female',
  unknown: null,
  notprovided: null,
  notspecified: null,
};

/** "MaleNeutered" → "Male"; large-animal values (Gelding, Mare…) are returned as stored. */
export function sexWordOf(sex: unknown): string | null {
  const key = compact(sex);
  if (!key) return null;
  return key in SEX_WORD ? SEX_WORD[key] : String(sex).trim();
}
