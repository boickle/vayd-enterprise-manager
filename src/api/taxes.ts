import { http } from './http';

/** Practice sales-tax levels for catalog pickers and Settings. */
export type PracticeTaxSettings = {
  id: number | null;
  taxLevel1Name: string;
  taxLevel1Rate: number;
  showTaxLevel2: boolean;
  taxLevel2Name: string;
  taxLevel2Rate: number;
  showTaxLevel3: boolean;
  taxLevel3Name: string;
  taxLevel3Rate: number;
  showAccumulativeTax: boolean;
  managedByScout: boolean;
};

export type PatchPracticeTaxSettings = Partial<
  Pick<
    PracticeTaxSettings,
    | 'taxLevel1Name'
    | 'taxLevel1Rate'
    | 'showTaxLevel2'
    | 'taxLevel2Name'
    | 'taxLevel2Rate'
    | 'showTaxLevel3'
    | 'taxLevel3Name'
    | 'taxLevel3Rate'
    | 'showAccumulativeTax'
  >
>;

export async function getPracticeTaxSettings(
  practiceId: number
): Promise<PracticeTaxSettings> {
  const { data } = await http.get<PracticeTaxSettings>(
    `/practice/${practiceId}/tax-settings`
  );
  return data;
}

export async function patchPracticeTaxSettings(
  practiceId: number,
  body: PatchPracticeTaxSettings
): Promise<PracticeTaxSettings> {
  const { data } = await http.patch<PracticeTaxSettings>(
    `/practice/${practiceId}/tax-settings`,
    body
  );
  return data;
}
