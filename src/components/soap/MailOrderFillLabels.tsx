import { useState } from 'react';
import SendRxLabelButton from './SendRxLabelButton';
import {
  MAIL_ORDER_BAG_NOTES_MAX,
} from '../../utils/dymoPrescriptionLabel';
import { printMailOrderBagLabelDirect } from '../../utils/printRxLabel';
import { ensurePrintRxNumber } from '../../utils/ensurePrintRxNumber';
import type { MailOrder, MailOrderLine } from '../../api/onlineStore';

function clipNotes(value: string): string {
  const text = value.trim();
  if (text.length <= MAIL_ORDER_BAG_NOTES_MAX) return text;
  return `${text.slice(0, MAIL_ORDER_BAG_NOTES_MAX - 1).trimEnd()}…`;
}

export default function MailOrderFillLabels({
  order,
  line,
  checkNotes,
  className = 'btn secondary',
}: {
  order: MailOrder;
  line: MailOrderLine;
  checkNotes?: string;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const bagNotes = clipNotes([checkNotes, order.notes].filter(Boolean).join(' · '));
  const mailOrderNumber = `#${order.id}`;

  const printBag = async (printerName?: string) => {
    try {
      const printed = await printMailOrderBagLabelDirect({
        orderNumber: mailOrderNumber,
        clientName: order.customerName,
        patientName: line.patientName || order.patientName || 'Household',
        notes: bagNotes,
      });
      setStatus(`Printed Rx and bag labels on ${printerName || printed}.`);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Rx printed. Bag label failed: ${e.message}`
          : 'Rx printed. Could not print the bag label.',
      );
    }
  };

  return (
    <div className="mail-queue__label-actions">
      <SendRxLabelButton
        className={className}
        stopClickPropagation
        source={{
          patientId: line.patientId,
          patientName: line.patientName || order.patientName || 'Patient',
          ownerName: order.customerName,
          veterinarianName: line.primaryProviderName || order.doctorName,
          quantity: line.quantity,
          name: line.name,
          strength: line.strength,
          instructions: line.scriptText || '',
          refill: line.authorizedRefills ?? line.refillsRemaining ?? 0,
          acuity: line.autoship ? 'chronic' : 'acute',
          rxNumber: line.rxNumber,
          mailOrderNumber,
          onSavePrescription: async (value) => {
            const rxNumber = await ensurePrintRxNumber({
              existingNumber: line.rxNumber,
              patientId: line.patientId,
              name: value.name,
              inventoryItemId: line.inventoryItemId,
              instructions: value.instructions,
              refill: value.refill,
              startDate: value.startDate,
              refillExpiration: value.refillExpiration,
              acuity: value.acuity,
            });
            return { rxNumber };
          },
        }}
        onError={(message) => {
          setError(message || null);
          setStatus(null);
        }}
        onSuccess={(printerName) => {
          void printBag(printerName);
        }}
      />
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          void printBag();
        }}
      >
        Bag label only
      </button>
      {status ? <p className="settings-muted" style={{ margin: '6px 0 0' }}>{status}</p> : null}
      {error ? <p className="mail-queue__danger-text">{error}</p> : null}
    </div>
  );
}
