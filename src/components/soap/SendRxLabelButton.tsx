import { useEffect, useState, type MouseEvent } from 'react';
import { Printer } from 'lucide-react';
import RxLabelModal, { type RxLabelPrescriptionInput, type RxLabelPrintMethod } from './RxLabelModal';
import type { MailOrderBagLabelData } from '../../utils/dymoPrescriptionLabel';
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
  label = 'Print label',
  className = 'rx-label-dymo',
  disabled,
  blockedReason,
  stopClickPropagation = false,
  direct = false,
  bagLabel,
  onError,
  onSuccess,
}: {
  source: SendRxLabelSource;
  label?: string;
  className?: string;
  disabled?: boolean;
  /**
   * Not ready to print yet (e.g. script not approved). The button stays clickable and
   * shows this in red instead of silently doing nothing.
   */
  blockedReason?: string | null;
  stopClickPropagation?: boolean;
  /** Print immediately to a USB DYMO from the current fields — no review modal. */
  direct?: boolean;
  /** Mail order: print the bag label too. */
  bagLabel?: MailOrderBagLabelData | null;
  onError?: (message: string) => void;
  onSuccess?: (printerName: string, method: RxLabelPrintMethod) => void;
}) {
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  useEffect(() => {
    if (!blockedReason) setShowBlocked(false);
  }, [blockedReason]);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blockedReason) {
      if (stopClickPropagation) event.stopPropagation();
      setShowBlocked(true);
      return;
    }
    setShowBlocked(false);
    if (direct) void printNow(event);
    else openModal(event);
  };

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
      onSuccess?.(printerName, 'dymo');
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
        aria-disabled={blockedReason ? true : undefined}
        onClick={handleClick}
      >
        <Printer size={12} /> {printing ? 'Printing…' : label}
      </button>
      {showBlocked && blockedReason ? (
        <span className="rx-label-blocked" role="alert">
          {blockedReason}
        </span>
      ) : null}
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
          discardAfter={source.discardAfter}
          bagLabel={bagLabel}
          onPrinted={onSuccess}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
