import { useState, type MouseEvent } from 'react';
import { Printer } from 'lucide-react';
import RxLabelModal, { type RxLabelPrescriptionInput } from './RxLabelModal';
import { addCalendarYear, dateForInput, printRxLabelDirect, toDateInput } from '../../utils/printRxLabel';
import './RxLabelModal.css';

export type SendRxLabelSource = {
  patientId?: number | null;
  patientName: string;
  species?: string | null;
  ownerName: string;
  veterinarianName?: string | null;
  veterinarianLicense?: string | null;
  providerEmployeeId?: number | null;
  quantity?: number | string | null;
  name: string;
  strength?: string | null;
  instructions?: string | null;
  refill?: number | string | null;
  refillExpiration?: string | null;
  startDate?: string | null;
  discardAfter?: string | null;
  rxNumber?: number | string | null;
  mailOrderNumber?: string | null;
  acuity?: 'acute' | 'chronic' | '' | null;
  onSavePrescription?: (value: RxLabelPrescriptionInput) => Promise<{ rxNumber: number | null }>;
};

function quantityOf(value: number | string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default function SendRxLabelButton({
  source,
  label = 'Send label to DYMO',
  className = 'rx-label-dymo',
  disabled,
  stopClickPropagation = false,
  direct = false,
  onError,
  onSuccess,
}: {
  source: SendRxLabelSource;
  label?: string;
  className?: string;
  disabled?: boolean;
  stopClickPropagation?: boolean;
  /** Print immediately from the current fields — no review modal. */
  direct?: boolean;
  onError?: (message: string) => void;
  onSuccess?: (printerName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(false);

  const openModal = (event: MouseEvent<HTMLButtonElement>) => {
    if (stopClickPropagation) event.stopPropagation();
    setOpen(true);
  };

  const printNow = async (event: MouseEvent<HTMLButtonElement>) => {
    if (stopClickPropagation) event.stopPropagation();
    setPrinting(true);
    onError?.('');
    try {
      const startDate = toDateInput(source.startDate) || dateForInput(new Date());
      const printerName = await printRxLabelDirect({
        patientName: source.patientName,
        species: source.species,
        ownerName: source.ownerName,
        veterinarianName: source.veterinarianName,
        veterinarianLicense: source.veterinarianLicense,
        providerEmployeeId: source.providerEmployeeId,
        quantity: quantityOf(source.quantity),
        name: source.name,
        strength: source.strength,
        instructions: source.instructions ?? '',
        refill: Math.max(0, Number(source.refill) || 0),
        refillExpiration: source.refillExpiration ?? '',
        startDate,
        discardAfter: source.discardAfter || addCalendarYear(startDate),
        acuity: source.acuity,
        existingRxNumber: source.rxNumber,
        mailOrderNumber: source.mailOrderNumber,
        onSavePrescription: source.onSavePrescription,
      });
      onSuccess?.(printerName);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not print the prescription label.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || printing}
        onClick={direct ? (event) => void printNow(event) : openModal}
      >
        <Printer size={12} /> {printing ? 'Printing…' : label}
      </button>
      {!direct && open && (
        <RxLabelModal
          patientId={source.patientId ?? undefined}
          patientName={source.patientName}
          species={source.species ?? ''}
          ownerName={source.ownerName}
          veterinarianName={source.veterinarianName ?? ''}
          veterinarianLicense={source.veterinarianLicense ?? ''}
          providerEmployeeId={source.providerEmployeeId}
          quantity={quantityOf(source.quantity)}
          prescription={{
            name: source.name,
            strength: source.strength ?? '',
            instructions: source.instructions ?? '',
            refill: Math.max(0, Number(source.refill) || 0),
            refillExpiration: toDateInput(source.refillExpiration),
            startDate: toDateInput(source.startDate) || toDateInput(new Date().toISOString()),
            rxNumber: source.rxNumber ?? null,
            acuity: source.acuity === 'acute' || source.acuity === 'chronic' ? source.acuity : '',
          }}
          onSavePrescription={source.onSavePrescription}
          mailOrderNumber={source.mailOrderNumber}
          onPrinted={onSuccess}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
