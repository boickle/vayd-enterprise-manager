import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, RefreshCw, X } from 'lucide-react';
import { fetchEmployee } from '../../api/appointmentSettings';
import {
  DIRECTIONS_MAX_LINES,
  directionsFitsLabel,
  listDymoPrinters,
  printPrescriptionLabel,
  printPrescriptionLabelWithSystemDialog,
  type DymoPrinter,
  type PrescriptionLabelData,
} from '../../utils/dymoPrescriptionLabel';
import { loadPracticeLetterhead, loadProviderSignature } from '../../utils/practiceLetterhead';
import DirectionsLimitHint, { directionsMaxLength } from './DirectionsLimitHint';
import { BookPatientChartButton } from '../BookPatientChartButton';
import {
  clampRefillExpiration,
  maxRefillExpirationInput,
  refillExpirationExceedsMax,
} from '../../utils/printRxLabel';
import './RxLabelModal.css';

export type RxLabelPrescriptionInput = {
  name: string;
  strength: string;
  instructions: string;
  refill: number;
  refillExpiration: string;
  startDate: string;
  acuity?: 'acute' | 'chronic' | '';
};

const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

type Props = {
  patientId?: number;
  patientName: string;
  species?: string;
  ownerName: string;
  veterinarianName: string;
  veterinarianLicense: string;
  providerEmployeeId?: number | null;
  quantity: number;
  prescription: RxLabelPrescriptionInput & { rxNumber?: number | string | null };
  /** When omitted, the label prints from the fields on this form (already-saved Rx). */
  onSavePrescription?: (value: RxLabelPrescriptionInput) => Promise<{ rxNumber: number | null }>;
  mailOrderNumber?: string | null;
  onPrinted?: (printerName: string) => void;
  onClose: () => void;
};

const LAST_PRINTER_KEY = 'soap-rx-label-dymo-printer';
const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function dateForInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addYear(dateInput: string): string {
  const date = dateInput ? new Date(`${dateInput}T12:00:00`) : new Date();
  date.setFullYear(date.getFullYear() + 1);
  return dateForInput(date);
}

function displayDate(dateInput: string): string {
  const date = new Date(`${dateInput}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateInput : date.toLocaleDateString('en-US');
}

function employeeLicense(employee: unknown): string {
  const raw = (employee as { licenseNumber?: unknown } | null)?.licenseNumber;
  return typeof raw === 'string' ? raw.trim() : '';
}

export default function RxLabelModal({
  patientId,
  patientName,
  species = '',
  ownerName,
  veterinarianName: initialVeterinarianName,
  veterinarianLicense: initialVeterinarianLicense,
  providerEmployeeId,
  quantity,
  prescription,
  onSavePrescription,
  mailOrderNumber,
  onPrinted,
  onClose,
}: Props) {
  const [practiceName, setPracticeName] = useState('');
  const [practiceAddress, setPracticeAddress] = useState('');
  const [practicePhone, setPracticePhone] = useState('');
  const [practiceLogoPng, setPracticeLogoPng] = useState<string | null>(null);
  const [veterinarianName, setVeterinarianName] = useState(initialVeterinarianName);
  const [veterinarianLicense, setVeterinarianLicense] = useState(initialVeterinarianLicense);
  const [signaturePng, setSignaturePng] = useState<string | null>(null);
  const [prescriptionNumber, setPrescriptionNumber] = useState(
    prescription.rxNumber != null && String(prescription.rxNumber).trim()
      ? String(prescription.rxNumber)
      : ''
  );
  const [instructions, setInstructions] = useState(prescription.instructions);
  const [refill, setRefill] = useState(String(prescription.refill));
  const [acuity, setAcuity] = useState<'acute' | 'chronic' | ''>(prescription.acuity ?? '');
  const [startDate, setStartDate] = useState(prescription.startDate || dateForInput(new Date()));
  const [refillExpiration, setRefillExpiration] = useState(prescription.refillExpiration);
  const [discardAfter, setDiscardAfter] = useState(
    addYear(prescription.startDate || dateForInput(new Date()))
  );
  const [printers, setPrinters] = useState<DymoPrinter[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let canceled = false;
    void loadPracticeLetterhead(PRACTICE_ID).then((letterhead) => {
      if (canceled) return;
      setPracticeName(letterhead.name);
      setPracticeAddress(letterhead.address);
      setPracticePhone(letterhead.phone);
      setPracticeLogoPng(letterhead.logoDataUrl);
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (providerEmployeeId == null) return;
    let canceled = false;
    void Promise.all([
      fetchEmployee(providerEmployeeId).catch(() => null),
      loadProviderSignature(providerEmployeeId, PRACTICE_ID).catch(() => null),
    ]).then(([employee, signature]) => {
      if (canceled) return;
      const license = employeeLicense(employee);
      if (license) setVeterinarianLicense(license);
      if (employee) {
        const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ').trim();
        if (name && !initialVeterinarianName.trim()) {
          setVeterinarianName(/^dr\.?\b/i.test(name) ? name : `Dr. ${name}`);
        }
      }
      if (signature) setSignaturePng(signature);
    });
    return () => {
      canceled = true;
    };
  }, [initialVeterinarianName, providerEmployeeId]);

  const refreshPrinters = async () => {
    setLoadingPrinters(true);
    setError(null);
    try {
      const next = await listDymoPrinters();
      setPrinters(next);
      const connected = next.filter((printer) => printer.isConnected);
      const remembered = window.localStorage.getItem(LAST_PRINTER_KEY);
      const selected =
        connected.find((printer) => printer.name === remembered) ??
        connected.find((printer) =>
          /450|labelwriter/i.test(`${printer.name} ${printer.modelName}`)
        ) ??
        connected[0] ??
        next[0];
      setPrinterName(selected?.name ?? '');
      if (next.length === 0) setError('No DYMO LabelWriter printers were found.');
    } catch (e) {
      setPrinters([]);
      setPrinterName('');
      setError(e instanceof Error ? e.message : 'Could not connect to DYMO Connect.');
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    void refreshPrinters();
  }, []);

  const missing = useMemo(() => {
    const fields: Array<[string, string]> = [
      ['practice letterhead (Settings → Practice)', practiceName],
      ['practice letterhead (Settings → Practice)', practiceAddress],
      ['practice letterhead (Settings → Practice)', practicePhone],
      ['patient name', patientName],
      ['owner name', ownerName],
      ['prescriber', veterinarianName],
      ['medication name', prescription.name],
      ['directions', instructions],
      ['acute or chronic', acuity],
      ['prescribed date', startDate],
      ['discard-after date', discardAfter],
    ];
    return [...new Set(fields.filter(([, value]) => !value.trim()).map(([label]) => label))];
  }, [
    discardAfter,
    instructions,
    ownerName,
    patientName,
    practiceAddress,
    practiceName,
    practicePhone,
    prescription.name,
    startDate,
    veterinarianName,
    acuity,
  ]);

  const saveAndBuildLabel = async (): Promise<PrescriptionLabelData> => {
    if (missing.length > 0) throw new Error(`Complete: ${missing.join(', ')}.`);
    if (Math.max(0, Number(refill) || 0) > 0 && refillExpirationExceedsMax(refillExpiration)) {
      throw new Error('Refill expiration cannot be more than 1 year from today.');
    }
    const saved = onSavePrescription
      ? await onSavePrescription({
          name: prescription.name.trim(),
          strength: prescription.strength.trim(),
          instructions: instructions.trim(),
          refill: Math.max(0, Number(refill) || 0),
          refillExpiration,
          startDate,
          acuity,
        })
      : { rxNumber: null as number | null };
    const rxNumber = saved.rxNumber != null ? String(saved.rxNumber) : prescriptionNumber.trim();
    if (saved.rxNumber != null && String(saved.rxNumber) !== prescriptionNumber) {
      setPrescriptionNumber(String(saved.rxNumber));
    }
    if (onSavePrescription && !rxNumber) {
      throw new Error('Could not assign a prescription number. Restart the API and try again.');
    }
    return {
      practiceName: practiceName.trim(),
      practiceAddress: practiceAddress.trim(),
      practicePhone: practicePhone.trim(),
      patientName: patientName.trim(),
      species: species.trim(),
      ownerName: ownerName.trim(),
      prescriptionNumber: rxNumber,
      mailOrderNumber: mailOrderNumber?.trim() || null,
      prescribedDate: displayDate(startDate),
      drugName: prescription.name.trim(),
      strength: prescription.strength.trim(),
      quantity: String(quantity),
      instructions: instructions.trim(),
      refills: String(Math.max(0, Number(refill) || 0)),
      discardAfter: displayDate(discardAfter),
      veterinarianName: veterinarianName.trim(),
      veterinarianLicense: veterinarianLicense.trim(),
      veterinarianSignaturePng: signaturePng,
      practiceLogoPng,
    };
  };

  const printToDymo = async () => {
    if (!printerName) {
      setError('Choose a connected DYMO LabelWriter.');
      return;
    }
    setPrinting(true);
    setError(null);
    setSuccess(false);
    try {
      const label = await saveAndBuildLabel();
      await printPrescriptionLabel(printerName, label);
      window.localStorage.setItem(LAST_PRINTER_KEY, printerName);
      setSuccess(true);
      onPrinted?.(printerName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not print the prescription label.');
    } finally {
      setPrinting(false);
    }
  };

  const systemPrint = async () => {
    const printWindow = window.open('', '_blank', 'popup,width=720,height=500');
    if (!printWindow) {
      setError('Allow pop-ups to use the system print dialog.');
      return;
    }
    setPrinting(true);
    setError(null);
    try {
      printPrescriptionLabelWithSystemDialog(await saveAndBuildLabel(), printWindow);
    } catch (e) {
      printWindow.close();
      setError(e instanceof Error ? e.message : 'Could not open the print dialog.');
    } finally {
      setPrinting(false);
    }
  };

  const providerLine = veterinarianName;
  const directionsOver = !directionsFitsLabel(instructions);

  return createPortal(
    <div className="rx-label-backdrop">
      <div
        className="soap-modal soap-rx-label-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rx-label-title"
      >
        <div className="soap-modal-head">
          <h3 id="rx-label-title">
            <Printer size={18} /> Print prescription label
          </h3>
          <button type="button" className="soap-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="soap-modal-sub">
          Review the directions, then print a DYMO 30326 (1⅘″ × 3⅒″) label. Practice letterhead
          and Rx number come from settings and the saved prescription.
        </p>

        <div className="soap-rx-label-static">
          <p>
            <strong>{practiceName || 'Practice name missing'}</strong>
            <br />
            {[practiceAddress, practicePhone].filter(Boolean).join(' · ') ||
              'Set name, phone, and address in Settings → Practice.'}
          </p>
          <p>
            {patientName} · {ownerName}
            {prescription.strength ? ` · ${prescription.strength}` : ''}
          </p>
          <p>
            {prescription.name} · Qty {quantity}
            {` · Rx ${prescriptionNumber || 'assigned when saved'}`}
          </p>
          <p>{providerLine || 'Choose a provider on the invoice or visit.'}</p>
          {signaturePng ? (
            <img className="soap-rx-label-signature" src={signaturePng} alt="" />
          ) : null}
        </div>

        <div className="soap-rx-label-grid">
          <label className="soap-rx-label-wide">
            <span className="soap-rx-label-field-head">
              Directions (sig) *
              <DirectionsLimitHint value={instructions} />
            </span>
            <textarea
              className="soap-input"
              rows={4}
              maxLength={directionsMaxLength()}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          <label>
            <span className="soap-rx-label-field-head">
              Refills
              {patientId != null ? (
                <BookPatientChartButton
                  patientId={String(patientId)}
                  patientName={patientName}
                  practiceId={PRACTICE_ID}
                  practiceTz={PRACTICE_TZ}
                  showAlerts
                  label="View details"
                  className="soap-rx-label-details-link"
                  onApplyRefillExpiration={(dateInput) => {
                    if (refillExpirationExceedsMax(dateInput)) {
                      setError('Refill expiration cannot be more than 1 year from today.');
                      setRefillExpiration(maxRefillExpirationInput());
                      return;
                    }
                    setError(null);
                    setRefillExpiration(dateInput);
                  }}
                />
              ) : null}
            </span>
            <input
              className="soap-input soap-rx-label-refill-input"
              type="number"
              min={0}
              value={refill}
              onChange={(event) => setRefill(event.target.value)}
            />
          </label>
          <label>
            Acute or chronic *
            <select
              className="soap-input soap-select"
              value={acuity}
              aria-label="Acute or chronic prescription"
              title="Chronic meds are what a future client portal refill flow will offer"
              onChange={(event) => setAcuity(event.target.value as 'acute' | 'chronic' | '')}
            >
              <option value="">Select…</option>
              <option value="acute">Acute</option>
              <option value="chronic">Chronic</option>
            </select>
          </label>
          <label>
            Prescribed date *
            <input
              className="soap-input"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            Refill expiration
            <input
              className="soap-input"
              type="date"
              max={maxRefillExpirationInput()}
              value={refillExpiration}
              onChange={(event) => {
                const next = event.target.value;
                if (refillExpirationExceedsMax(next)) {
                  setError('Refill expiration cannot be more than 1 year from today.');
                  setRefillExpiration(maxRefillExpirationInput());
                  return;
                }
                setError(null);
                setRefillExpiration(clampRefillExpiration(next));
              }}
            />
          </label>
          <label>
            Discard after *
            <input
              className="soap-input"
              type="date"
              value={discardAfter}
              onChange={(event) => setDiscardAfter(event.target.value)}
            />
          </label>
        </div>

        <div className="soap-rx-label-printer">
          <label>
            DYMO printer
            <select
              className="soap-input soap-select"
              value={printerName}
              disabled={loadingPrinters}
              onChange={(event) => setPrinterName(event.target.value)}
            >
              <option value="">{loadingPrinters ? 'Looking for printers…' : 'Select…'}</option>
              {printers.map((printer) => (
                <option key={printer.name} value={printer.name} disabled={!printer.isConnected}>
                  {printer.name}
                  {printer.modelName ? ` (${printer.modelName})` : ''}
                  {!printer.isConnected ? ' — disconnected' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="soap-btn ghost small"
            disabled={loadingPrinters}
            onClick={() => void refreshPrinters()}
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {directionsOver ? (
          <p className="soap-rx-label-note">
            Directions must fit {DIRECTIONS_MAX_LINES} lines on the label ({directionsMaxLength()}{' '}
            characters). Shorten them to print.
          </p>
        ) : null}
        {missing.length > 0 && (
          <p className="soap-rx-label-note">Required before printing: {missing.join(', ')}.</p>
        )}
        {error && <p className="soap-dose-error">{error}</p>}
        {success && (
          <p className="soap-rx-label-success" role="status">
            Label sent to {printerName}.
          </p>
        )}

        <div className="soap-modal-actions">
          <button
            type="button"
            className="soap-btn ghost"
            disabled={printing || directionsOver}
            onClick={() => void systemPrint()}
          >
            Use system print dialog
          </button>
          <button type="button" className="soap-btn ghost" disabled={printing} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="soap-btn primary"
            disabled={printing || loadingPrinters || !printerName || missing.length > 0 || directionsOver}
            onClick={() => void printToDymo()}
          >
            <Printer size={14} /> {printing ? 'Printing…' : 'Print on DYMO'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
