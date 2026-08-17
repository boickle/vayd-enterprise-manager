import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, RefreshCw, X } from 'lucide-react';
import { fetchPracticeInfo } from '../../api/clientPortal';
import {
  listDymoPrinters,
  printPrescriptionLabel,
  printPrescriptionLabelWithSystemDialog,
  type DymoPrinter,
  type PrescriptionLabelData,
} from '../../utils/dymoPrescriptionLabel';

export type RxLabelPrescriptionInput = {
  name: string;
  strength: string;
  instructions: string;
  refill: number;
  refillExpiration: string;
  startDate: string;
};

type Props = {
  patientName: string;
  species: string;
  ownerName: string;
  veterinarianName: string;
  veterinarianLicense: string;
  quantity: number;
  prescription: RxLabelPrescriptionInput & { rxNumber?: number | null };
  onSavePrescription: (value: RxLabelPrescriptionInput) => Promise<{ rxNumber: number | null }>;
  onClose: () => void;
};

const LAST_PRINTER_KEY = 'soap-rx-label-dymo-printer';

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

export default function RxLabelModal({
  patientName: initialPatientName,
  species: initialSpecies,
  ownerName: initialOwnerName,
  veterinarianName: initialVeterinarianName,
  veterinarianLicense: initialVeterinarianLicense,
  quantity,
  prescription,
  onSavePrescription,
  onClose,
}: Props) {
  const [practiceName, setPracticeName] = useState('');
  const [practiceAddress, setPracticeAddress] = useState('');
  const [practicePhone, setPracticePhone] = useState('');
  const [patientName, setPatientName] = useState(initialPatientName);
  const [species, setSpecies] = useState(initialSpecies);
  const [ownerName, setOwnerName] = useState(initialOwnerName);
  const [veterinarianName, setVeterinarianName] = useState(initialVeterinarianName);
  const [veterinarianLicense, setVeterinarianLicense] = useState(initialVeterinarianLicense);
  const [prescriptionNumber, setPrescriptionNumber] = useState(
    prescription.rxNumber != null ? String(prescription.rxNumber) : ''
  );
  const [drugName, setDrugName] = useState(prescription.name);
  const [strength, setStrength] = useState(prescription.strength);
  const [instructions, setInstructions] = useState(prescription.instructions);
  const [refill, setRefill] = useState(String(prescription.refill));
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
    void fetchPracticeInfo().then((practice) => {
      if (!practice) return;
      setPracticeName(practice.name?.trim() ?? '');
      setPracticeAddress(
        [
          practice.address1 ?? practice.address,
          [practice.city, practice.state, practice.zip].filter(Boolean).join(', '),
        ]
          .filter(Boolean)
          .join(' · ')
      );
      setPracticePhone((practice.phone ?? practice.phone1 ?? practice.phone2 ?? '').trim());
    });
  }, []);

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
      ['practice name', practiceName],
      ['practice address', practiceAddress],
      ['practice phone', practicePhone],
      ['patient name', patientName],
      ['owner name', ownerName],
      ['prescriber', veterinarianName],
      ['prescriber license', veterinarianLicense],
      ['Rx number', prescriptionNumber],
      ['medication name', drugName],
      ['strength', strength],
      ['directions', instructions],
      ['prescribed date', startDate],
      ['discard-after date', discardAfter],
    ];
    return fields.filter(([, value]) => !value.trim()).map(([label]) => label);
  }, [
    discardAfter,
    drugName,
    instructions,
    ownerName,
    patientName,
    practiceAddress,
    practiceName,
    practicePhone,
    prescriptionNumber,
    startDate,
    strength,
    veterinarianLicense,
    veterinarianName,
  ]);

  const saveAndBuildLabel = async (): Promise<PrescriptionLabelData> => {
    if (missing.length > 0) throw new Error(`Complete: ${missing.join(', ')}.`);
    const saved = await onSavePrescription({
      name: drugName.trim(),
      strength: strength.trim(),
      instructions: instructions.trim(),
      refill: Math.max(0, Number(refill) || 0),
      refillExpiration,
      startDate,
    });
    // The backend assigns the Rx number asynchronously (and not at all for some
    // in-visit saves), so fall back to whatever the doctor entered on the label.
    const rxNumber = saved.rxNumber != null ? String(saved.rxNumber) : prescriptionNumber.trim();
    if (saved.rxNumber != null && String(saved.rxNumber) !== prescriptionNumber) {
      setPrescriptionNumber(String(saved.rxNumber));
    }
    return {
      practiceName: practiceName.trim(),
      practiceAddress: practiceAddress.trim(),
      practicePhone: practicePhone.trim(),
      patientName: patientName.trim(),
      species: species.trim(),
      ownerName: ownerName.trim(),
      prescriptionNumber: rxNumber,
      prescribedDate: displayDate(startDate),
      drugName: drugName.trim(),
      strength: strength.trim(),
      quantity: String(quantity),
      instructions: instructions.trim(),
      refills: String(Math.max(0, Number(refill) || 0)),
      discardAfter: displayDate(discardAfter),
      veterinarianName: veterinarianName.trim(),
      veterinarianLicense: veterinarianLicense.trim(),
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

  return createPortal(
    <div className="scheduler-modal-backdrop">
      <div
        className="scheduler-modal soap-modal soap-rx-label-modal"
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
          Review the required label information, then print a DYMO 30326 (1⅘″ × 3⅒″) label on the
          LabelWriter 450 Turbo.
        </p>

        <div className="soap-rx-label-grid">
          <label>
            Practice name *
            <input
              className="soap-input"
              value={practiceName}
              onChange={(event) => setPracticeName(event.target.value)}
            />
          </label>
          <label>
            Practice phone *
            <input
              className="soap-input"
              value={practicePhone}
              onChange={(event) => setPracticePhone(event.target.value)}
            />
          </label>
          <label className="soap-rx-label-wide">
            Practice address *
            <input
              className="soap-input"
              value={practiceAddress}
              onChange={(event) => setPracticeAddress(event.target.value)}
            />
          </label>
          <label>
            Patient *
            <input
              className="soap-input"
              value={patientName}
              onChange={(event) => setPatientName(event.target.value)}
            />
          </label>
          <label>
            Species
            <input
              className="soap-input"
              value={species}
              onChange={(event) => setSpecies(event.target.value)}
            />
          </label>
          <label>
            Owner *
            <input
              className="soap-input"
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
            />
          </label>
          <label>
            Rx number *
            <input
              className="soap-input"
              value={prescriptionNumber}
              onChange={(event) => setPrescriptionNumber(event.target.value)}
              placeholder="Assigned on save, or enter manually"
            />
          </label>
          <label>
            Quantity
            <input className="soap-input" value={quantity} disabled />
          </label>
          <label>
            Medication *
            <input
              className="soap-input"
              value={drugName}
              onChange={(event) => setDrugName(event.target.value)}
            />
          </label>
          <label>
            Strength *
            <input
              className="soap-input"
              value={strength}
              onChange={(event) => setStrength(event.target.value)}
            />
          </label>
          <label className="soap-rx-label-wide">
            Directions (sig) *
            <textarea
              className="soap-input"
              rows={2}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          <label>
            Refills
            <input
              className="soap-input"
              type="number"
              min={0}
              value={refill}
              onChange={(event) => setRefill(event.target.value)}
            />
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
              value={refillExpiration}
              onChange={(event) => setRefillExpiration(event.target.value)}
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
          <label>
            Prescriber *
            <input
              className="soap-input"
              value={veterinarianName}
              onChange={(event) => setVeterinarianName(event.target.value)}
            />
          </label>
          <label>
            License number *
            <input
              className="soap-input"
              value={veterinarianLicense}
              onChange={(event) => setVeterinarianLicense(event.target.value)}
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

        {missing.length > 0 && (
          <p className="soap-rx-label-note">Required before printing: {missing.join(', ')}.</p>
        )}
        {error && <p className="soap-dose-error">{error}</p>}
        {success && (
          <p className="soap-rx-label-success" role="status">
            Label sent to {printerName}.
          </p>
        )}
        <p className="soap-rx-label-help">
          Direct printing requires DYMO Connect to be installed and running on this computer.
        </p>

        <div className="soap-modal-actions">
          <button
            type="button"
            className="soap-btn ghost"
            disabled={printing}
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
            disabled={printing || loadingPrinters || !printerName || missing.length > 0}
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
