import { fetchEmployee } from '../api/appointmentSettings';
import type { RxLabelPrescriptionInput } from '../components/soap/RxLabelModal';
import {
  DIRECTIONS_MAX_LINES,
  directionsFitsLabel,
  listDymoPrinters,
  printMailOrderBagLabel,
  printPrescriptionLabel,
  type MailOrderBagLabelData,
  type PrescriptionLabelData,
} from './dymoPrescriptionLabel';
import { loadPracticeLetterhead, loadProviderSignature } from './practiceLetterhead';

export const LAST_DYMO_PRINTER_KEY = 'soap-rx-label-dymo-printer';
const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export function dateForInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addCalendarYear(dateInput: string): string {
  const date = dateInput ? new Date(`${dateInput}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return dateForInput(new Date());
  date.setFullYear(date.getFullYear() + 1);
  return dateForInput(date);
}

export function todayInput(): string {
  return dateForInput(new Date());
}

export function tomorrowInput(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return dateForInput(date);
}

export function dateIsTodayOrBefore(value: string, from: string = todayInput()): boolean {
  const date = toDateInput(value);
  return Boolean(date && date <= from);
}

/** Latest refill-through date Maine / clinic policy allows: one year from today. */
export function maxRefillExpirationInput(from: string = todayInput()): string {
  return addCalendarYear(from);
}

export function clampRefillExpiration(value: string, from: string = todayInput()): string {
  const date = toDateInput(value);
  if (!date) return '';
  const max = maxRefillExpirationInput(from);
  return date > max ? max : date;
}

export function refillExpirationExceedsMax(value: string, from: string = todayInput()): boolean {
  const date = toDateInput(value);
  return Boolean(date && date > maxRefillExpirationInput(from));
}

export function displayDate(dateInput: string): string {
  const date = new Date(`${dateInput}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateInput : date.toLocaleDateString('en-US');
}

export function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  const iso = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return dateForInput(parsed);
}

function employeeLicense(employee: unknown): string {
  const raw = (employee as { licenseNumber?: unknown } | null)?.licenseNumber;
  return typeof raw === 'string' ? raw.trim() : '';
}

function employeeDisplayName(employee: { firstName?: string; lastName?: string } | null): string {
  if (!employee) return '';
  const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim();
  if (!name) return '';
  return /^dr\.?\b/i.test(name) ? name : `Dr. ${name}`;
}

async function chooseConnectedPrinter(): Promise<string> {
  const printers = await listDymoPrinters();
  const connected = printers.filter((printer) => printer.isConnected);
  const remembered = window.localStorage.getItem(LAST_DYMO_PRINTER_KEY);
  const selected =
    connected.find((printer) => printer.name === remembered) ??
    connected.find((printer) => /450|labelwriter/i.test(`${printer.name} ${printer.modelName}`)) ??
    connected[0];
  if (!selected) {
    throw new Error(
      printers.length === 0
        ? 'No DYMO LabelWriter printers were found.'
        : 'Connect a DYMO LabelWriter and try again.'
    );
  }
  return selected.name;
}

export type DirectRxLabelInput = {
  patientName: string;
  species?: string | null;
  ownerName: string;
  veterinarianName?: string | null;
  veterinarianLicense?: string | null;
  providerEmployeeId?: number | null;
  quantity: number;
  name: string;
  strength?: string | null;
  instructions: string;
  refill: number;
  refillExpiration?: string;
  startDate: string;
  discardAfter: string;
  acuity?: 'acute' | 'chronic' | '' | null;
  existingRxNumber?: string | number | null;
  mailOrderNumber?: string | null;
  onSavePrescription?: (value: RxLabelPrescriptionInput) => Promise<{ rxNumber: number | null }>;
};

export async function printRxLabelDirect(input: DirectRxLabelInput): Promise<string> {
  const instructions = input.instructions.trim();
  const startDate = toDateInput(input.startDate) || dateForInput(new Date());
  const discardAfter = toDateInput(input.discardAfter) || addCalendarYear(startDate);
  const acuity = input.acuity === 'acute' || input.acuity === 'chronic' ? input.acuity : '';

  if (!instructions) throw new Error('Add directions before printing the label.');
  if (!directionsFitsLabel(instructions)) {
    throw new Error(`Directions must fit ${DIRECTIONS_MAX_LINES} lines on the label.`);
  }
  if (!acuity) throw new Error('Choose acute or chronic before printing the label.');
  if (input.refill > 0 && refillExpirationExceedsMax(input.refillExpiration ?? '')) {
    throw new Error('Refill expiration cannot be more than 1 year from today.');
  }
  if (!input.patientName.trim()) throw new Error('Choose a pet before printing the label.');
  if (!input.ownerName.trim()) throw new Error('Owner name is missing.');
  if (!input.name.trim()) throw new Error('Medication name is missing.');

  const [letterhead, employee, signature] = await Promise.all([
    loadPracticeLetterhead(PRACTICE_ID),
    input.providerEmployeeId != null
      ? fetchEmployee(input.providerEmployeeId).catch(() => null)
      : Promise.resolve(null),
    input.providerEmployeeId != null
      ? loadProviderSignature(input.providerEmployeeId, PRACTICE_ID).catch(() => null)
      : Promise.resolve(null),
  ]);

  const veterinarianName =
    input.veterinarianName?.trim() || employeeDisplayName(employee) || '';
  const veterinarianLicense =
    input.veterinarianLicense?.trim() || employeeLicense(employee);

  if (!letterhead.name.trim() || !letterhead.address.trim() || !letterhead.phone.trim()) {
    throw new Error('Set practice name, address, and phone in Settings → Practice.');
  }
  if (!veterinarianName) throw new Error('Choose a provider before printing the label.');

  const saved = input.onSavePrescription
    ? await input.onSavePrescription({
        name: input.name.trim(),
        strength: (input.strength ?? '').trim(),
        instructions,
        refill: Math.max(0, Number(input.refill) || 0),
        refillExpiration: toDateInput(input.refillExpiration),
        startDate,
        acuity,
      })
    : { rxNumber: null as number | null };

  const rxNumber =
    saved.rxNumber != null
      ? String(saved.rxNumber)
      : input.existingRxNumber != null && String(input.existingRxNumber).trim()
        ? String(input.existingRxNumber)
        : '';
  if (input.onSavePrescription && !rxNumber) {
    throw new Error('Could not assign a prescription number. Restart the API and try again.');
  }

  const printerName = await chooseConnectedPrinter();
  const label: PrescriptionLabelData = {
    practiceName: letterhead.name.trim(),
    practiceAddress: letterhead.address.trim(),
    practicePhone: letterhead.phone.trim(),
    patientName: input.patientName.trim(),
    species: (input.species ?? '').trim(),
    ownerName: input.ownerName.trim(),
    prescriptionNumber: rxNumber,
    mailOrderNumber: input.mailOrderNumber?.trim() || null,
    prescribedDate: displayDate(startDate),
    drugName: input.name.trim(),
    strength: (input.strength ?? '').trim(),
    quantity: String(input.quantity),
    instructions,
    refills: String(Math.max(0, Number(input.refill) || 0)),
    discardAfter: displayDate(discardAfter),
    veterinarianName,
    veterinarianLicense,
    veterinarianSignaturePng: signature,
    practiceLogoPng: letterhead.logoDataUrl,
  };
  await printPrescriptionLabel(printerName, label);
  window.localStorage.setItem(LAST_DYMO_PRINTER_KEY, printerName);
  return printerName;
}

export async function printMailOrderBagLabelDirect(
  data: MailOrderBagLabelData,
): Promise<string> {
  const printerName = await chooseConnectedPrinter();
  await printMailOrderBagLabel(printerName, data);
  window.localStorage.setItem(LAST_DYMO_PRINTER_KEY, printerName);
  return printerName;
}
