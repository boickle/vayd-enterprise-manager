import type { FormField } from '../api/forms';
import type { PracticeLetterhead } from './practiceLetterhead';

/** Sample household used when staff preview a form (merge tags). */
const SAMPLE: Record<string, string> = {
  practicename: 'Vet At Your Door',
  practiceaddress: '123 Clinic Way, Anytown, ST 00000',
  practicestreet1: '123 Clinic Way',
  practicestreet2: '',
  practicecity: 'Anytown',
  practicestate: 'ST',
  practicepostalcode: '00000',
  practicephone: '(555) 010-0100',
  practiceemail: 'hello@example.com',
  practicelogo: '',

  clientid: '1001',
  clientfirstname: 'Alex',
  clientlastname: 'Rivera',
  clientname: 'Alex Rivera',
  clientemail: 'alex@example.com',
  clientphone: '(555) 010-0200',
  clientaddress: '45 Oak St, Anytown, ST 00000',

  patientid: '2002',
  patientname: 'Bodhi',
  patientbreed: 'Labrador Retriever',
  patientspecies: 'Canine',
  patientage: '4 years',
  patientdob: '3/12/2022',
  patientsex: 'Male Neutered',
  patientsexabbreviated: 'MN',
  patientsexhisher: 'His',
  patientsexhisherlower: 'his',
  patientsexheshe: 'He',
  patientsexheshelower: 'he',
  patientsexhimher: 'Him',
  patientsexhimherlower: 'him',
  patientweight: '62 lbs',
  patientcolor: 'Black',
  patientmicrochip: '985112004567890',
};

function formatDate(d = new Date()): string {
  return d.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatLongDate(d = new Date()): string {
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(d = new Date()): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function buildPreviewValues(letterhead?: PracticeLetterhead | null): Record<string, string> {
  const logo = letterhead?.logoDataUrl?.trim() ?? '';
  const logoHtml =
    logo.startsWith('data:image/')
      ? `<img src="${logo}" alt="Practice logo" style="max-height:72px;max-width:220px;height:auto;width:auto" />`
      : '';

  return {
    ...SAMPLE,
    practicename: letterhead?.name?.trim() || SAMPLE.practicename,
    practiceaddress: letterhead?.address?.trim() || SAMPLE.practiceaddress,
    practicephone: letterhead?.phone?.trim() || SAMPLE.practicephone,
    practicelogo: logoHtml,
    currentdate: formatDate(),
    mmmm_dd_yyyy: formatLongDate(),
    currenttime: formatTime(),
  };
}

function applyMerge(text: string, values: Record<string, string>): string {
  if (!text) return text;
  return text.replace(/%([^%]+)%/g, (full, raw: string) => {
    const token = String(raw).trim().toLowerCase().replace(/\s+/g, '');
    if (Object.prototype.hasOwnProperty.call(values, token)) {
      return values[token] ?? '';
    }
    const compact = token.replace(/[^a-z0-9]/g, '');
    for (const [k, v] of Object.entries(values)) {
      if (k.replace(/[^a-z0-9]/g, '') === compact) return v;
    }
    return full;
  });
}

/** Resolve merge tags with sample (or letterhead) data for the owner preview. */
export function applyFormMergePreview(
  fields: FormField[],
  letterhead?: PracticeLetterhead | null,
): FormField[] {
  const values = buildPreviewValues(letterhead);
  return fields.map((f) => ({
    ...f,
    label: applyMerge(f.label ?? '', values),
    checkboxLabel: f.checkboxLabel ? applyMerge(f.checkboxLabel, values) : f.checkboxLabel,
    hint: f.hint ? applyMerge(f.hint, values) : f.hint,
  }));
}

export function formPreviewSampleNames(letterhead?: PracticeLetterhead | null): {
  practiceName: string;
  clientName: string;
  patientName: string;
} {
  return {
    practiceName: letterhead?.name?.trim() || SAMPLE.practicename,
    clientName: SAMPLE.clientname,
    patientName: SAMPLE.patientname,
  };
}
